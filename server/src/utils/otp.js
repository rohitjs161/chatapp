import crypto from 'crypto';
import { BrevoClient } from '@getbrevo/brevo';
import { apiError } from './apiError.js';
import { logger } from './logger.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_FROM_NAME = 'ChatApp Support';
const DEFAULT_VERIFY_SUBJECT = 'Verify Your Email - ChatApp';
const DEFAULT_FORGOT_PASSWORD_SUBJECT = 'Reset Your Password - ChatApp';
const MAX_EMAIL_SEND_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

let brevoTransactionalClient = null;

const getTrimmedEnv = (name) => {
    const value = process.env[name];

    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
};

const isValidEmailAddress = (value = '') => EMAIL_REGEX.test(String(value || '').trim());

const normalizeEmailAddress = (value = '') => String(value || '').trim();

const extractOtpFromHtml = (htmlContent = '') => {
    const matches = String(htmlContent || '').match(/\b\d{6}\b/);
    return matches?.[0] || null;
};

const toEmailErrorMeta = (error = {}) => ({
    name: error?.name,
    message: error?.message,
    statusCode: error?.statusCode ?? error?.status ?? error?.response?.status,
    code: error?.code,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Get or initialize the Brevo transactional email client
 * @returns {BrevoClient} Brevo client instance
 * @throws {apiError} If API key is missing
 */
export const getBrevoClient = () => {
    if (brevoTransactionalClient) {
        return brevoTransactionalClient;
    }

    const apiKey = getTrimmedEnv('BREVO_API_KEY');

    if (!apiKey) {
        logger.error('❌ BREVO_API_KEY is missing');
        throw new apiError(500, 'Failed to send email. Please try again later.');
    }

    brevoTransactionalClient = new BrevoClient({ apiKey });
    logger.log('📧 Brevo transactional email client initialized');

    return brevoTransactionalClient;
};

const getSenderConfig = () => {
    const fromEmail = getTrimmedEnv('EMAIL_FROM');
    const fromName = getTrimmedEnv('EMAIL_FROM_NAME') || DEFAULT_FROM_NAME;
    const replyTo = getTrimmedEnv('EMAIL_REPLY_TO');

    if (!fromEmail) {
        logger.error('❌ EMAIL_FROM is not configured');
        throw new apiError(500, 'Failed to send email. Please try again later.');
    }

    if (!isValidEmailAddress(fromEmail)) {
        logger.error('❌ EMAIL_FROM is invalid', { email: fromEmail });
        throw new apiError(500, 'Failed to send email. Please try again later.');
    }

    if (replyTo && !isValidEmailAddress(replyTo)) {
        logger.error('❌ EMAIL_REPLY_TO is invalid', { email: replyTo });
        throw new apiError(500, 'Failed to send email. Please try again later.');
    }

    return {
        fromEmail,
        fromName,
        replyTo: replyTo || fromEmail,
    };
};

export const buildMailOptions = ({ email, subject, htmlContent }) => {
    const recipientEmail = normalizeEmailAddress(email);

    if (!recipientEmail || !isValidEmailAddress(recipientEmail)) {
        logger.error('❌ Invalid recipient email', { email: recipientEmail });
        throw new apiError(500, 'Failed to send email. Please try again later.');
    }

    const { fromEmail, fromName, replyTo } = getSenderConfig();

    return {
        sender: {
            email: fromEmail,
            name: fromName,
        },
        to: [{ email: recipientEmail }],
        subject,
        htmlContent,
        replyTo: {
            email: replyTo,
        },
    };
};

const getBrevoStatusCode = (error = {}) => {
    const statusCode = Number(error?.response?.status ?? error?.statusCode ?? error?.status);
    return Number.isFinite(statusCode) ? statusCode : 0;
};

/**
 * Check if an error is transient and should trigger a retry
 * @param {Error} error - The error to check
 * @returns {boolean} True if error is transient
 */
const isTransientBrevoError = (error = {}) => {
    const statusCode = getBrevoStatusCode(error);
    const code = String(error?.code || error?.name || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();
    const causeMessage = String(error?.cause?.message || '').toLowerCase();

    // Don't retry on client errors (4xx) that indicate configuration issues
    if ([400, 401, 403, 404, 422].includes(statusCode)) {
        return false;
    }

    // Don't retry on authentication/authorization errors
    if (message.includes('invalid api key')
        || message.includes('unauthorized')
        || message.includes('forbidden')
        || message.includes('authentication')
        || message.includes('invalid domain')
        || message.includes('invalid from')
        || message.includes('invalid email')
        || message.includes('email address is invalid')
        || causeMessage.includes('invalid api key')) {
        return false;
    }

    // Retry on server errors and rate limits
    if (statusCode === 429 || statusCode >= 500) {
        return true;
    }

    // Retry on network errors
    return [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ESOCKETTIMEDOUT',
        'EAI_AGAIN',
        'ENETUNREACH',
        'EHOSTUNREACH',
        'ECONNABORTED',
        'FETCH_ERROR',
        'UND_ERR_CONNECT_TIMEOUT',
    ].includes(code)
        || message.includes('fetch failed')
        || message.includes('network error')
        || message.includes('socket')
        || message.includes('timeout')
        || message.includes('connection reset')
        || causeMessage.includes('timeout')
        || causeMessage.includes('socket');
};

/**
 * Send email with retry logic for transient failures
 * @param {Object} mailOptions - Mail options from buildMailOptions
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<Object>} Brevo API response
 * @throws {Error} If all retry attempts fail
 */
export const sendEmailWithRetry = async (mailOptions, maxRetries = MAX_EMAIL_SEND_RETRIES) => {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        const client = getBrevoClient();

        try {
            logger.log(`📧 Attempt ${attempt}/${maxRetries} to send email to: ${mailOptions.to?.[0]?.email || 'unknown'}`);

            const result = await client.transactionalEmails.sendTransacEmail(mailOptions);

            logger.log(`✅ Brevo email sent successfully to ${mailOptions.to?.[0]?.email || 'unknown'} | Message ID: ${result?.messageId || 'unknown'}`);
            return result;
        } catch (error) {
            lastError = error;
            const statusCode = getBrevoStatusCode(error);
            const transient = isTransientBrevoError(error);
            const hasRetriesLeft = attempt < maxRetries;

            if (transient && hasRetriesLeft) {
                const delayMs = RETRY_DELAYS_MS[attempt - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
                logger.warn(`⚠️ Retrying email delivery in ${delayMs}ms`, {
                    ...toEmailErrorMeta(error),
                    email: mailOptions.to?.[0]?.email || 'unknown',
                });
                await sleep(delayMs);
                continue;
            }

            logger.error('❌ Failed to send email', {
                email: mailOptions.to?.[0]?.email || 'unknown',
                statusCode,
                ...toEmailErrorMeta(error),
            });

            if (!transient) {
                throw error;
            }

            break;
        }
    }

    throw lastError;
};

const logEmailEvent = (eventData) => {
    const timestamp = new Date().toISOString();
    logger.log('📧 Email Event:', JSON.stringify({ timestamp, ...eventData }));
};

const getVerificationTemplate = (otp) => `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f7fa;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; border-radius: 8px 8px 0 0; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 32px; font-weight: 700;">ChatApp</h1>
            <p style="margin: 8px 0 0 0; font-size: 16px; opacity: 0.95;">Welcome to ChatApp</p>
        </div>

        <!-- Body -->
        <div style="background: white; padding: 40px 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <p style="color: #333; font-size: 16px; margin-bottom: 24px; line-height: 1.6;">
                Hi there,
            </p>

            <p style="color: #666; font-size: 15px; line-height: 1.7; margin-bottom: 30px;">
                Thank you for signing up! Use the One-Time Password (OTP) below to verify your email and activate your account. <strong>This code will expire in 10 minutes.</strong>
            </p>

            <!-- OTP Box -->
            <div style="background: linear-gradient(135deg, #f5f7fa 0%, #e9ecef 100%); padding: 30px; border-radius: 8px; text-align: center; margin: 30px 0; border-left: 4px solid #667eea;">
                <p style="color: #999; font-size: 12px; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">Verification Code</p>
                <p style="font-size: 44px; font-weight: bold; color: #667eea; letter-spacing: 12px; margin: 0; font-family: 'Courier New', 'Courier', monospace; font-weight: 700;">
                    ${otp}
                </p>
                <p style="color: #aaa; font-size: 12px; margin: 12px 0 0 0;">⏰ Valid for 10 minutes</p>
            </div>

            <!-- Security Notice -->
            <div style="background: #f0f8ff; border-left: 4px solid #667eea; padding: 16px; border-radius: 4px; margin: 25px 0;">
                <p style="color: #333; font-size: 14px; margin: 0; line-height: 1.6;">
                    <strong>🔒 Security Notice:</strong> Never share this OTP with anyone. ChatApp support will never ask for your OTP via email or phone.
                </p>
            </div>

            <p style="color: #666; font-size: 14px; line-height: 1.7; margin-top: 25px;">
                If you didn't create this account, please <strong>ignore this email</strong> and your data will not be activated.
            </p>

            <!-- Footer -->
            <div style="margin-top: 35px; padding-top: 25px; border-top: 1px solid #e9ecef;">
                <p style="color: #999; font-size: 13px; margin: 0 0 10px 0;">
                    Need help? Contact us at <a href="mailto:support@yourdomain.com" style="color: #667eea; text-decoration: none;">support@yourdomain.com</a>
                </p>
                <p style="color: #aaa; font-size: 11px; margin: 10px 0 0 0; line-height: 1.5;">
                    &copy; 2024 ChatApp. All rights reserved. | <a href="https://yourdomain.com/privacy" style="color: #667eea; text-decoration: none;">Privacy Policy</a> | <a href="https://yourdomain.com/terms" style="color: #667eea; text-decoration: none;">Terms of Service</a>
                </p>
            </div>
        </div>
    </div>
`;

const getEmailTemplate = (otp) => {
    return `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f7fa;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; border-radius: 8px 8px 0 0; text-align: center; color: white;">
                <h1 style="margin: 0; font-size: 32px; font-weight: 700;">ChatApp</h1>
                <p style="margin: 8px 0 0 0; font-size: 16px; opacity: 0.95;">Password Reset Request</p>
            </div>

            <!-- Body -->
            <div style="background: white; padding: 40px 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <p style="color: #333; font-size: 16px; margin-bottom: 24px; line-height: 1.6;">
                    Hi there,
                </p>

                <p style="color: #666; font-size: 15px; line-height: 1.7; margin-bottom: 30px;">
                    We received a request to reset your password. Use the One-Time Password (OTP) below to proceed with your password reset. <strong>This code will expire in 10 minutes.</strong>
                </p>

                <!-- OTP Box -->
                <div style="background: linear-gradient(135deg, #f5f7fa 0%, #e9ecef 100%); padding: 30px; border-radius: 8px; text-align: center; margin: 30px 0; border-left: 4px solid #667eea;">
                    <p style="color: #999; font-size: 12px; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 2px; font-weight: 600;">One-Time Password</p>
                    <p style="font-size: 44px; font-weight: bold; color: #667eea; letter-spacing: 12px; margin: 0; font-family: 'Courier New', 'Courier', monospace; font-weight: 700;">
                        ${otp}
                    </p>
                    <p style="color: #aaa; font-size: 12px; margin: 12px 0 0 0;">⏰ Valid for 10 minutes</p>
                </div>

                <!-- Security Notice -->
                <div style="background: #f0f8ff; border-left: 4px solid #667eea; padding: 16px; border-radius: 4px; margin: 25px 0;">
                    <p style="color: #333; font-size: 14px; margin: 0; line-height: 1.6;">
                        <strong>🔒 Security Notice:</strong> Never share this OTP with anyone. ChatApp support will never ask for your OTP via email or phone.
                    </p>
                </div>

                <p style="color: #666; font-size: 14px; line-height: 1.7; margin-top: 25px;">
                    If you didn't request this password reset, please <strong>ignore this email</strong> and your account will remain secure.
                </p>

                <!-- Footer -->
                <div style="margin-top: 35px; padding-top: 25px; border-top: 1px solid #e9ecef;">
                    <p style="color: #999; font-size: 13px; margin: 0 0 10px 0;">
                        Need help? Contact us at <a href="mailto:support@yourdomain.com" style="color: #667eea; text-decoration: none;">support@yourdomain.com</a>
                    </p>
                    <p style="color: #aaa; font-size: 11px; margin: 10px 0 0 0; line-height: 1.5;">
                        &copy; 2024 ChatApp. All rights reserved. | <a href="https://yourdomain.com/privacy" style="color: #667eea; text-decoration: none;">Privacy Policy</a> | <a href="https://yourdomain.com/terms" style="color: #667eea; text-decoration: none;">Terms of Service</a>
                    </p>
                </div>
            </div>
        </div>
    `;
};

export const sendEmail = async ({ email, subject, htmlContent, action, context = 'email', debugOtp = null }) => {
    const recipientEmail = normalizeEmailAddress(email);

    try {
        const mailOptions = buildMailOptions({
            email: recipientEmail,
            subject,
            htmlContent,
        });

        const result = await sendEmailWithRetry(mailOptions);

        if (process.env.NODE_ENV === 'production') {
            logEmailEvent({
                email: recipientEmail,
                action,
                status: 'success',
                messageId: result?.messageId || null,
                context,
            });
        }

        return result;
    } catch (error) {
        logger.error(`❌ Failed to send ${action} email`, {
            email: recipientEmail,
            action,
            ...toEmailErrorMeta(error),
        });

        if (process.env.NODE_ENV === 'production') {
            logEmailEvent({
                email: recipientEmail,
                action,
                status: 'failed',
                error: error?.message,
                context,
            });
        }

        throw new apiError(500, 'Failed to send email. Please try again later.');
    }
};

export const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

export const hashOTP = (otp) => {
    return crypto.createHash('sha256').update(otp).digest('hex');
};

export const compareOTP = (inputOTP, storedHashedOTP) => {
    const hashedInputOTP = hashOTP(inputOTP);
    return hashedInputOTP === storedHashedOTP;
};

/**
 * Send password reset OTP email
 * @param {string} email - Recipient email
 * @param {string} otp - One-time password
 * @returns {Promise<Object>} Brevo API response
 */
export const sendEmailOTP = async (email, otp) => {
    const subject = getTrimmedEnv('EMAIL_SUBJECT_FORGOT_PASSWORD') || DEFAULT_FORGOT_PASSWORD_SUBJECT;
    const htmlContent = getEmailTemplate(otp);
    return sendEmail({
        email,
        subject,
        htmlContent,
        debugOtp: otp,
        action: 'password_reset_otp',
        context: 'forgot-password',
    });
};

/**
 * Send email verification OTP
 * @param {string} email - Recipient email
 * @param {string} otp - One-time password
 * @returns {Promise<Object>} Brevo API response
 */
export const sendEmailVerification = async (email, otp) => {
    const subject = getTrimmedEnv('EMAIL_SUBJECT_VERIFY_EMAIL') || DEFAULT_VERIFY_SUBJECT;
    const htmlContent = getVerificationTemplate(otp);
    return sendEmail({
        email,
        subject,
        htmlContent,
        debugOtp: otp,
        action: 'email_verification',
        context: 'email-change',
    });
};

/**
 * Health check for Brevo email configuration
 * @returns {Promise<boolean>} True if configuration is valid
 */
export const verifyTransporterHealth = async () => {
    try {
        getBrevoClient();
        const { fromEmail } = getSenderConfig();
        logger.log('✅ Brevo email configuration is ready', { fromEmail });
        return true;
    } catch (error) {
        logger.error('❌ Brevo health check failed', toEmailErrorMeta(error));
        return false;
    }
};

/**
 * Test Brevo email configuration by sending a test email
 * @returns {Promise<boolean>} True if test email was sent successfully
 */
export const testEmailConfiguration = async () => {
    console.log('\n🧪 Testing Brevo Configuration...\n');

    try {
        const { fromEmail, fromName } = getSenderConfig();
        const probeEmail = getTrimmedEnv('EMAIL_REPLY_TO') || fromEmail;

        console.log(`📧 From: ${fromName} <${fromEmail}>`);
        console.log(`📧 Test recipient: ${probeEmail}`);
        console.log(`📧 Node Environment: ${process.env.NODE_ENV || 'development'}`);

        const result = await sendEmail({
            email: probeEmail,
            subject: 'ChatApp - Brevo Configuration Test',
            htmlContent: '<h1>✅ Brevo Configuration Works!</h1><p>You can now use ChatApp email features.</p>',
            action: 'configuration_test',
            context: 'diagnostic',
        });

        console.log('\n🎉 Brevo configuration is working correctly!\n');
        return true;
    } catch (error) {
        console.error('\n❌ Brevo configuration test failed!');
        console.error(`Error: ${error.message}\n`);
        console.error('Debugging info:');
        console.error(`Name: ${error?.name}`);
        console.error(`Code: ${error?.code}`);
        console.error(`Status: ${error?.statusCode ?? error?.status}`);
        console.error(`Message: ${error?.message}`);
        return false;
    }
};

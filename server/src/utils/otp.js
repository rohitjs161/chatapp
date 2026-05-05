import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { apiError } from './apiError.js';
import { logger } from "./logger.js";

const getTrimmedEnv = (name) => {
    const value = process.env[name];

    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
};

const getSmtpUsername = (smtpUrl) => {
    if (!smtpUrl) {
        return '';
    }

    try {
        const parsedUrl = new URL(smtpUrl);
        return decodeURIComponent(parsedUrl.username || '').trim();
    } catch {
        return '';
    }
};

const getDefaultSenderEmail = () => {
    return getTrimmedEnv('SENDGRID_FROM_EMAIL')
        || getTrimmedEnv('EMAIL_FROM')
        || getSmtpUsername(getTrimmedEnv('SMTP_URL'))
        || getTrimmedEnv('EMAIL_USER');
};

// ============================================
// CONFIGURE TRANSPORTER BASED ON ENVIRONMENT
// ============================================
const getEmailTransporter = () => {
    const smtpUrl = getTrimmedEnv('SMTP_URL');
    const emailService = getTrimmedEnv('EMAIL_SERVICE').toLowerCase() || 'gmail';
    const nodeEnv = process.env.NODE_ENV || 'development';
    const transportTimeouts = {
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
    };

    logger.log(`📧 Configuring email service: ${emailService} (${nodeEnv})`);

    try {
        if (smtpUrl) {
            return nodemailer.createTransport({
                url: smtpUrl,
                ...transportTimeouts,
            });
        }

        // SendGrid Configuration (Production Recommended)
        if (emailService === 'sendgrid') {
            const sendgridApiKey = getTrimmedEnv('SENDGRID_API_KEY');

            if (!sendgridApiKey) {
                throw new Error('SENDGRID_API_KEY not found in .env');
            }

            return nodemailer.createTransport({
                host: 'smtp.sendgrid.net',
                port: 587,
                secure: false,
                ...transportTimeouts,
                auth: {
                    user: 'apikey',
                    pass: sendgridApiKey,
                },
            });
        }

        // Gmail Configuration (Small Scale / Development)
        if (emailService === 'gmail') {
            const emailUser = getTrimmedEnv('EMAIL_USER');
            const emailPassword = getTrimmedEnv('EMAIL_PASSWORD');

            if (!emailUser || !emailPassword) {
                throw new Error('EMAIL_USER or EMAIL_PASSWORD not found in .env');
            }

            return nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                requireTLS: true,
                tls: {
                    rejectUnauthorized: true,
                },
                family: 4,
                ...transportTimeouts,
                auth: {
                    user: emailUser,
                    pass: emailPassword,
                },
            });
        }

        // Mailgun Configuration
        if (emailService === 'mailgun') {
            const mailgunApiKey = getTrimmedEnv('MAILGUN_API_KEY');
            const mailgunDomain = getTrimmedEnv('MAILGUN_DOMAIN');

            if (!mailgunApiKey || !mailgunDomain) {
                throw new Error('MAILGUN_API_KEY or MAILGUN_DOMAIN not found in .env');
            }

            return nodemailer.createTransport({
                host: 'smtp.mailgun.org',
                port: 587,
                secure: false,
                ...transportTimeouts,
                auth: {
                    user: `postmaster@${mailgunDomain}`,
                    pass: mailgunApiKey,
                },
            });
        }

        // Ethereal Configuration (Testing Only)
        if (emailService === 'ethereal') {
            return nodemailer.createTransport({
                host: 'smtp.ethereal.email',
                port: 587,
                secure: false,
                ...transportTimeouts,
                auth: {
                    user: 'kade.howe@ethereal.email',
                    pass: 'm2xB7YgJnwsA8JtvkZ',
                },
            });
        }

        throw new Error(`Unsupported email service: ${emailService}`);
    } catch (error) {
        logger.error('❌ Email transporter configuration error:', error.message);
        throw error;
    }
};

// ============================================
// GENERATE OTP
// ============================================
export const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// ============================================
// HASH OTP
// ============================================
export const hashOTP = (otp) => {
    return crypto.createHash('sha256').update(otp).digest('hex');
};

// ============================================
// COMPARE OTP
// ============================================
export const compareOTP = (inputOTP, storedHashedOTP) => {
    const hashedInputOTP = hashOTP(inputOTP);
    return hashedInputOTP === storedHashedOTP;
};

// ============================================
// SEND EMAIL OTP
// ============================================
export const sendEmailOTP = async (email, otp) => {
    let transporter;

    try {
        // Validate email configuration
        if (!getTrimmedEnv('EMAIL_SERVICE') && !getTrimmedEnv('SMTP_URL')) {
            logger.error('❌ EMAIL_SERVICE not configured in .env');
            throw new apiError(500, 'Email service not configured. Please contact support.');
        }

        // Get configured transporter
        transporter = getEmailTransporter();

        // Verify connection
        if (process.env.NODE_ENV !== 'production') {
            try {
                await transporter.verify();
                logger.log('✅ Email service connected');
            } catch (verifyError) {
                logger.error('❌ Email authentication failed:', {
                    message: verifyError.message,
                    code: verifyError.code,
                    response: verifyError.response,
                    responseCode: verifyError.responseCode,
                    command: verifyError.command,
                });
                throw new apiError(500, 'Email service authentication failed. Check configuration.');
            }
        } else {
            logger.log('📧 Skipping SMTP verify in production; sending directly');
        }

        // Determine sender email
        const senderEmail = getDefaultSenderEmail();
        const senderName = getTrimmedEnv('EMAIL_FROM_NAME') || getTrimmedEnv('SENDGRID_FROM_NAME') || 'ChatApp Support';

        // Email options
        const mailOptions = {
            from: `${senderName} <${senderEmail}>`,
            to: email,
            subject: getTrimmedEnv('EMAIL_SUBJECT_FORGOT_PASSWORD') || 'Reset Your Password - ChatApp',
            replyTo: getTrimmedEnv('EMAIL_REPLY_TO') || senderEmail,
            html: getEmailTemplate(otp),
        };

        // Send email
        try {
            const result = await transporter.sendMail(mailOptions);
            logger.log(`✅ Email sent successfully to ${email} | Message ID: ${result.messageId}`);

            // Log for analytics (if using production service)
            if (process.env.NODE_ENV === 'production') {
                logEmailEvent({
                    email,
                    action: 'forgot_password_otp_sent',
                    status: 'success',
                    messageId: result.messageId,
                    service: process.env.EMAIL_SERVICE,
                });
            }

            return result;

        } catch (sendError) {
            logger.error('❌ Failed to send email:', {
                message: sendError.message,
                code: sendError.code,
                response: sendError.response,
                responseCode: sendError.responseCode,
                command: sendError.command,
            });

            if (process.env.NODE_ENV === 'development') {
                logger.error('📋 Full error details:', sendError);
            }

            throw new apiError(500, 'Failed to send OTP email. Please try again later.');
        }

    } catch (error) {
        logger.error('📧 Email error:', error.message);

        // Log error for debugging
        if (process.env.NODE_ENV === 'production') {
            logEmailEvent({
                email,
                action: 'forgot_password_otp_failed',
                status: 'error',
                error: error.message,
                service: process.env.EMAIL_SERVICE,
            });
        }

        throw error instanceof apiError 
            ? error 
            : new apiError(500, 'Failed to send password reset email. Please try again later.');
    }
};

// ============================================
// SEND EMAIL VERIFICATION (for email change)
// ============================================
export const sendEmailVerification = async (email, otp) => {
    let transporter;

    try {
        // Validate email configuration
        if (!getTrimmedEnv('EMAIL_SERVICE') && !getTrimmedEnv('SMTP_URL')) {
            logger.error('❌ EMAIL_SERVICE not configured in .env');
            throw new apiError(500, 'Email service not configured. Please contact support.');
        }

        // Get configured transporter
        transporter = getEmailTransporter();

        // Verify connection
        if (process.env.NODE_ENV !== 'production') {
            try {
                await transporter.verify();
                logger.log('✅ Email service connected');
            } catch (verifyError) {
                logger.error('❌ Email verification transport check failed:', {
                    message: verifyError.message,
                    code: verifyError.code,
                    response: verifyError.response,
                    responseCode: verifyError.responseCode,
                    command: verifyError.command,
                });
                throw new apiError(500, 'Email service authentication failed. Check configuration.');
            }
        } else {
            logger.log('📧 Skipping SMTP verify in production; sending verification email directly');
        }

        // Determine sender email
        const senderEmail = getDefaultSenderEmail();
        const senderName = getTrimmedEnv('EMAIL_FROM_NAME') || getTrimmedEnv('SENDGRID_FROM_NAME') || 'ChatApp Support';

        // Email options
        const mailOptions = {
            from: `${senderName} <${senderEmail}>`,
            to: email,
            subject: getTrimmedEnv('EMAIL_SUBJECT_VERIFY_EMAIL') || 'Verify Your Email - ChatApp',
            replyTo: getTrimmedEnv('EMAIL_REPLY_TO') || senderEmail,
            html: getVerificationTemplate(otp),
        };

        // Send email
        try {
            const result = await transporter.sendMail(mailOptions);
            logger.log(`✅ Email sent successfully to ${email} | Message ID: ${result.messageId}`);

            // Log for analytics (if using production service)
            if (process.env.NODE_ENV === 'production') {
                logEmailEvent({
                    email,
                    action: 'email_verification_sent',
                    status: 'success',
                    messageId: result.messageId,
                    service: process.env.EMAIL_SERVICE,
                });
            }

            return result;

        } catch (sendError) {
            logger.error('❌ Failed to send verification email:', {
                message: sendError.message,
                code: sendError.code,
                response: sendError.response,
                responseCode: sendError.responseCode,
                command: sendError.command,
            });

            if (process.env.NODE_ENV === 'development') {
                logger.error('📋 Full error details:', sendError);
            }

            throw new apiError(500, 'Failed to send verification email. Please try again later.');
        }

    } catch (error) {
        logger.error('📧 Email verification error:', error.message);

        // Log error for debugging
        if (process.env.NODE_ENV === 'production') {
            logEmailEvent({
                email,
                action: 'email_verification_failed',
                status: 'error',
                error: error.message,
                service: process.env.EMAIL_SERVICE,
            });
        }

        throw error instanceof apiError 
            ? error 
            : new apiError(500, 'Failed to send verification email. Please try again later.');
    }
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

// ============================================
// EMAIL TEMPLATE (Production Grade)
// ============================================
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

// ============================================
// EMAIL EVENT LOGGING (for analytics)
// ============================================
const logEmailEvent = (eventData) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        ...eventData,
    };

    // Log to console
    logger.log('📧 Email Event:', JSON.stringify(logEntry));

    // TODO: Send to analytics service (DataDog, Mixpanel, etc.)
    // TODO: Store in database for monitoring
};

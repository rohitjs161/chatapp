import crypto from 'crypto';
import nodemailer from 'nodemailer';
import dns from 'dns';
import { apiError } from './apiError.js';
import { logger } from "./logger.js";

// ============================================
// INITIALIZE DNS CONFIG FOR IPv4-FIRST RESOLUTION
// ============================================
// Prefer IPv4 when resolving hostnames to avoid Render IPv6 routing issues.
// Some Node versions allow configuring the default DNS result order so lookups
// return IPv4 addresses first. This reduces chances of ENETUNREACH/ESOCKET
// failures when the platform's IPv6 connectivity is unreliable.
try {
    if (typeof dns.setDefaultResultOrder === 'function') {
        dns.setDefaultResultOrder('ipv4first');
        logger.log('📧 DNS default result order set to ipv4first');
    }
} catch (e) {
    // Non-fatal: if the runtime doesn't support this API, continue and rely on
    // the explicit lookup/family settings already applied to the transporter.
    logger.warn('📧 dns.setDefaultResultOrder not available:', e?.message || e);
}

// ============================================
// GLOBAL TRANSPORTER SINGLETON (Production Safe)
// ============================================
// Maintains ONE reusable transporter instance instead of creating new ones
// on every email send. This prevents socket exhaustion and connection pooling issues
// that cause ETIMEDOUT and ESOCKET errors in production environments like Render.
let globalEmailTransporter = null;
let transitionInProgress = false;
const transporterLock = Symbol('transporter_lock');

// ============================================
// UTILITY FUNCTIONS
// ============================================
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

const parsePositiveInt = (value, fallbackValue) => {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
};

const isTransientEmailError = (error = {}) => {
    const code = String(error?.code || '').toUpperCase();
    return [
        'ENETUNREACH',
        'ESOCKET',
        'ETIMEDOUT',
        'ESOCKETTIMEDOUT',
        'ECONNREFUSED',
        'EHOSTUNREACH',
        'EAI_AGAIN',
        'ECONNRESET',
    ].includes(code);
};

const toEmailErrorMeta = (error = {}) => ({
    code: error?.code,
    message: error?.message,
    responseCode: error?.responseCode,
    command: error?.command,
    errno: error?.errno,
    syscall: error?.syscall,
});

const extractEmailAddress = (input = '') => {
    if (typeof input !== 'string') return '';
    const match = input.match(/<([^>]+)>/);
    if (match?.[1]) return String(match[1]).trim();
    return input.trim();
};

// ============================================
// PRODUCTION-SAFE GMAIL TRANSPORTER CREATION
// ============================================
// Single, reusable transporter instance for Gmail SMTP.
// Configured for Render production with:
// - IPv4-only DNS resolution (family: 4)
// - Connection pooling (pool: true, maxConnections: 5)
// - Extended timeouts (connectionTimeout: 45s, socketTimeout: 120s)
// - TLS v1.2+ with lenient cert verification
// - No transporter.verify() in production

const createGmailTransporter = () => {
    const emailUser = getTrimmedEnv('EMAIL_USER');
    const emailPassword = getTrimmedEnv('EMAIL_PASSWORD').replace(/\s+/g, '');

    if (!emailUser || !emailPassword) {
        const missingFields = [];
        if (!emailUser) missingFields.push('EMAIL_USER');
        if (!emailPassword) missingFields.push('EMAIL_PASSWORD');
        throw new Error(`Missing Gmail config: ${missingFields.join(', ')}`);
    }

    logger.log(`📧 Creating Gmail transporter - User: ${emailUser}`);
    logger.log('📧 Production Config: host=smtp.gmail.com, port=587, IPv4-only, pooled');

    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        requireTLS: true,
        authMethod: 'LOGIN',
        
        // Force IPv4 at both DNS resolution and socket level to avoid Render IPv6 routing issues
        family: 4,
        
        // Custom DNS lookup: explicitly resolve to IPv4 only
        lookup: (hostname, options, callback) => {
            return dns.lookup(hostname, { family: 4 }, (lookupError, address, family) => {
                if (lookupError) {
                    logger.error('❌ DNS lookup failed for SMTP host', {
                        hostname,
                        ...toEmailErrorMeta(lookupError),
                    });
                    callback(lookupError);
                    return;
                }
                logger.log(`📧 SMTP DNS resolved ${hostname} -> ${address} (IPv${family})`);
                callback(null, address, family);
            });
        },

        // Production-safe timeouts (extended for Render reliability)
        connectionTimeout: 45000,  // 45 seconds
        greetingTimeout: 45000,    // 45 seconds
        socketTimeout: 120000,     // 120 seconds

        // Gmail on Render is more stable when the TLS server name is explicit.
        tls: {
            // Lenient cert verification for Render stability
            // (Gmail's certs are valid, but connection negotiation can be flaky)
            rejectUnauthorized: false,
            minVersion: 'TLSv1.2',
            servername: 'smtp.gmail.com',
        },

        // Connection pool to prevent socket exhaustion
        pool: true,
        maxConnections: 1,         // Use a single pooled connection for Gmail on Render
        maxMessages: Infinity,     // Keep reusing the same connection
        rateLimit: 5,              // Emails per second
        keepAlive: true,

        // Authentication
        auth: {
            user: emailUser,
            pass: emailPassword,
        },

        // Additional production-safe options
        logger: false,      // Nodemailer internal logging (we use our logger)
        debug: false,       // No SMTP protocol debugging
        transactionLog: false, // Reduce memory usage
        dnsTimeout: 30000,
    });

    // Attach lightweight listeners to detect transport-level failures and
    // allow automatic recreation (reconnect) on next send.
    try {
        if (transporter && typeof transporter.on === 'function') {
            transporter.on('error', (err) => {
                logger.error('⚠️ Transporter error event, scheduling reconnect:', toEmailErrorMeta(err));
                // Drop the cached transporter so next getTransporter() creates a new one
                try { globalEmailTransporter = null; } catch (e) {}
            });

            transporter.on('close', () => {
                logger.warn('⚠️ Transporter closed, clearing cached transporter to trigger reconnect');
                try { globalEmailTransporter = null; } catch (e) {}
            });
        }
    } catch (e) {
        logger.warn('Could not attach transporter listeners:', e?.message || e);
    }

    return transporter;
};

// ============================================
// SINGLETON TRANSPORTER GETTER (Cache)
// ============================================
// Returns cached transporter instance. Creates on first call.
// Prevents socket exhaustion and connection pooling issues.
export const getTransporter = () => {
    if (!globalEmailTransporter) {
        try {
            globalEmailTransporter = createGmailTransporter();
            logger.log('✅ Global Gmail transporter initialized (singleton)');
        } catch (error) {
            logger.error('❌ Failed to create Gmail transporter:', error.message);
            throw error;
        }
    }
    return globalEmailTransporter;
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
// SEND EMAIL WITH EXPONENTIAL BACKOFF RETRY
// ============================================
// Retries email delivery for transient network errors with exponential backoff.
// Does NOT retry on authentication/configuration errors.
// Returns immediately after first success.
const sendEmailWithRetry = async (mailOptions, maxRetries = 3) => {
    let lastError;
    const transporter = getTransporter();

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
            logger.log(`📧 Attempt ${attempt}/${maxRetries} to send email to: ${mailOptions.to}`);
            const result = await transporter.sendMail(mailOptions);
            logger.log(`✅ Email sent successfully to ${mailOptions.to} | Message ID: ${result.messageId}`);
            return result;
        } catch (error) {
            lastError = error;
            const isNetworkError = isTransientEmailError(error);
            const hasRetriesLeft = attempt < maxRetries;

            if (isNetworkError && hasRetriesLeft) {
                // Exponential backoff: 1s, 2s, 4s, then capped at 5s
                const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                logger.warn(`⚠️ Transient network error on attempt ${attempt}, retrying in ${delayMs}ms...`, {
                    ...toEmailErrorMeta(error),
                });
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }

            if (!isNetworkError) {
                // Non-transient error: don't retry, throw immediately
                logger.error(`❌ Non-transient SMTP error (attempt ${attempt}):`, {
                    ...toEmailErrorMeta(error),
                });
                throw error;
            }

            // All retries exhausted
            logger.error(`❌ Email delivery failed after ${maxRetries} attempts:`, {
                ...toEmailErrorMeta(error),
            });
        }
    }

    // All retries exhausted for transient error
    throw lastError;
};

const isConnectionTimeoutError = (error = {}) => {
    const code = String(error?.code || '').toUpperCase();
    const command = String(error?.command || '').toUpperCase();

    return code === 'ETIMEDOUT'
        || code === 'ESOCKETTIMEDOUT'
        || command === 'CONN'
        || command === 'EHLO'
        || command === 'STARTTLS';
};
// ============================================
// CREATE MAIL OPTIONS (Reusable Helper)
// ============================================
// Centralizes mail options creation to reduce duplication.
const createMailOptions = (email, subject, htmlContent, senderEmail, senderName) => {
    return {
        from: `${senderName} <${senderEmail}>`,
        to: email,
        subject: subject,
        replyTo: getTrimmedEnv('EMAIL_REPLY_TO') || senderEmail,
        html: htmlContent,
    };
};

// ============================================
// SEND EMAIL (Reusable Helper)
// ============================================
// Unified email sending logic used by both sendEmailOTP and sendEmailVerification.
// Skips verify() in production for speed, retries on transient errors.
const sendEmail = async (email, subject, htmlContent, action, context = 'email') => {
    try {
        // Validate email configuration
        if (!getTrimmedEnv('EMAIL_USER') && !getTrimmedEnv('SMTP_URL')) {
            logger.error('❌ EMAIL_USER or SMTP_URL not configured in .env');
            throw new apiError(500, 'Email service not configured. Please contact support.');
        }

        const transporter = getTransporter();
        const senderEmail = getDefaultSenderEmail();
        const senderName = getTrimmedEnv('EMAIL_FROM_NAME') || 'ChatApp Support';

        // Development only: verify SMTP connection
        if (process.env.NODE_ENV !== 'production') {
            try {
                logger.log('📧 Development mode: Testing SMTP connection...');
                await transporter.verify();
                logger.log('✅ Email service authenticated successfully');
            } catch (verifyError) {
                logger.error('❌ Email authentication failed:', {
                    ...toEmailErrorMeta(verifyError),
                });
                
                // Helpful hints for common issues in development
                if (verifyError.code === 'ECONNREFUSED' || verifyError.errno === 'ECONNREFUSED') {
                    logger.error('💡 Cannot connect to SMTP server. Check:');
                    logger.error('   - SMTP host is correct (smtp.gmail.com for Gmail)');
                    logger.error('   - SMTP port is correct (587 for TLS)');
                    logger.error('   - Network/firewall allows outbound SMTP connections');
                } else if (verifyError.code === 535 || verifyError.message.includes('Invalid login')) {
                    logger.error('💡 Authentication failed. For Gmail:');
                    logger.error('   - Use an App Password (not your main password)');
                    logger.error('   - Get it from: https://myaccount.google.com/apppasswords');
                    logger.error('   - Enable 2-Factor Authentication first if you haven\'t');
                } else if (verifyError.code === 'ENOTFOUND' || verifyError.errno === 'ENOTFOUND') {
                    logger.error('💡 Cannot find SMTP server. Check EMAIL_SERVICE setting.');
                }
                
                throw new apiError(500, 'Email service authentication failed. Check configuration.');
            }
        } else {
            logger.log('📧 Production mode: Skipping SMTP verify; sending email directly');
        }

        // Create mail options
        const mailOptions = createMailOptions(email, subject, htmlContent, senderEmail, senderName);
        
        // Send with retry logic
        const result = await sendEmailWithRetry(mailOptions);

        // Log analytics (production only)
        if (process.env.NODE_ENV === 'production') {
            logEmailEvent({
                email,
                action,
                status: 'success',
                messageId: result.messageId,
                context,
            });
        }

        return result;

    } catch (error) {
        logger.error(`❌ Failed to send ${action} email:`, {
            email: email,
            ...toEmailErrorMeta(error),
        });

        if (isConnectionTimeoutError(error)) {
            logger.error('⏱️ SMTP timeout detected while delivering Gmail email. The transporter now uses IPv4-only DNS, pooled connections, and extended Render-safe timeouts.', {
                email,
                action,
            });
        }

        // Log error for analytics (production only)
        if (process.env.NODE_ENV === 'production') {
            logEmailEvent({
                email,
                action,
                status: 'failed',
                error: error?.message,
                context,
            });
        }

        throw error instanceof apiError 
            ? error 
            : new apiError(500, `Failed to send ${action} email. Please try again later.`);
    }
};

// ============================================
// SEND EMAIL OTP (Password Reset)
// ============================================
export const sendEmailOTP = async (email, otp) => {
    const subject = getTrimmedEnv('EMAIL_SUBJECT_FORGOT_PASSWORD') || 'Reset Your Password - ChatApp';
    const htmlContent = getEmailTemplate(otp);
    return sendEmail(email, subject, htmlContent, 'password_reset_otp', 'forgot-password');
};

// ============================================
// SEND EMAIL VERIFICATION (Email Verification)
// ============================================
export const sendEmailVerification = async (email, otp) => {
    const subject = getTrimmedEnv('EMAIL_SUBJECT_VERIFY_EMAIL') || 'Verify Your Email - ChatApp';
    const htmlContent = getVerificationTemplate(otp);
    return sendEmail(email, subject, htmlContent, 'email_verification', 'email-change');
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

// ============================================
// DIAGNOSTIC FUNCTION - Test Email Configuration
// ============================================
export const testEmailConfiguration = async () => {
    console.log('\n🧪 Testing Gmail Configuration...\n');
    
    try {
        const emailUser = getTrimmedEnv('EMAIL_USER');
        
        console.log(`📧 Gmail User: ${emailUser || '(not configured)'}`);
        console.log(`📧 Node Environment: ${process.env.NODE_ENV || 'development'}`);
        
        // Test configuration
        if (!emailUser) {
            console.error('\n❌ ERROR: EMAIL_USER not configured in .env');
            return false;
        }
        
        console.log('\n🔗 Creating Gmail transporter...');
        const transporter = getTransporter();
        console.log('✅ Transporter created');
        
        console.log('\n🔑 Verifying SMTP connection...');
        await transporter.verify();
        console.log('✅ SMTP connection verified and authenticated successfully!');
        
        console.log('\n📤 Sending test email...');
        const result = await transporter.sendMail({
            from: `ChatApp <${emailUser}>`,
            to: emailUser,
            subject: 'ChatApp - Gmail Configuration Test',
            html: '<h1>✅ Gmail Configuration Works!</h1><p>You can now use ChatApp email features.</p>',
        });
        console.log(`✅ Test email sent! Message ID: ${result.messageId}`);
        
        console.log('\n🎉 Gmail configuration is working correctly!\n');
        return true;
        
    } catch (error) {
        console.error('\n❌ Gmail configuration test failed!');
        console.error(`Error: ${error.message}\n`);
        
        if (error.code === 'ECONNREFUSED') {
            console.error('💡 Cannot connect to SMTP server. Possible causes:');
            console.error('   - SMTP server is down');
            console.error('   - Wrong SMTP host or port');
            console.error('   - Network/firewall blocking connection');
        } else if (error.code === 535 || error.message.includes('Invalid login')) {
            console.error('💡 Authentication failed. For Gmail:');
            console.error('   - Use an App Password from: https://myaccount.google.com/apppasswords');
            console.error('   - NOT your main Gmail password');
            console.error('   - Make sure 2-Factor Authentication is enabled first');
        } else if (error.code === 'ENOTFOUND') {
            console.error('💡 Cannot find SMTP server (DNS issue or wrong host)');
        } else if (error.code === 'ETIMEDOUT') {
            console.error('💡 Connection timeout. Firewall or network issue blocking SMTP port 587');
        } else if (error.code === 'ENETUNREACH' || error.code === 'ESOCKET') {
            console.error('💡 Network unreachable. Possible causes:');
            console.error('   - IPv6 routing issue (common on Render)');
            console.error('   - Firewall blocking outbound SMTP');
            console.error('   - ISP network issue');
        }
        
        console.error('\nDebugging info:');
        console.error(`Code: ${error.code}`);
        console.error(`Message: ${error.message}`);
        
        return false;
    }
};

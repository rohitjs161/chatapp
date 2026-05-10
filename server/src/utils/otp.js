import crypto from 'crypto';
import nodemailer from 'nodemailer';
import dns from 'dns';
import { apiError } from './apiError.js';
import { logger } from "./logger.js";

// Prefer IPv4 when resolving hostnames to avoid Render IPv6 routing issues
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

// ============================================
// CONFIGURE TRANSPORTER BASED ON ENVIRONMENT
// ============================================
const getEmailTransporterCandidates = () => {
    const smtpUrl = getTrimmedEnv('SMTP_URL');
    const emailService = getTrimmedEnv('EMAIL_SERVICE').toLowerCase() || 'gmail';
    const nodeEnv = process.env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';
    const transportTimeouts = {
        connectionTimeout: parsePositiveInt(process.env.EMAIL_CONNECTION_TIMEOUT_MS, isProduction ? 30000 : 20000),
        greetingTimeout: parsePositiveInt(process.env.EMAIL_GREETING_TIMEOUT_MS, isProduction ? 30000 : 20000),
        socketTimeout: parsePositiveInt(process.env.EMAIL_SOCKET_TIMEOUT_MS, isProduction ? 45000 : 30000),
    };
    const transporters = [];

    logger.log(`📧 Configuring email service: ${emailService} (${nodeEnv})`);
    logger.log(`📧 Timeouts - Connection: ${transportTimeouts.connectionTimeout}ms, Greeting: ${transportTimeouts.greetingTimeout}ms, Socket: ${transportTimeouts.socketTimeout}ms`);

    try {
        if (smtpUrl) {
            logger.log('📧 Using SMTP_URL from environment');
            transporters.push({
                name: 'smtp_url',
                transporter: nodemailer.createTransport({
                    url: smtpUrl,
                    ...transportTimeouts,
                }),
            });

            return transporters;
        }

        // SendGrid Configuration (Production Recommended)
        if (emailService === 'sendgrid') {
            const sendgridApiKey = getTrimmedEnv('SENDGRID_API_KEY');

            if (!sendgridApiKey) {
                throw new Error('SENDGRID_API_KEY not found in .env');
            }

            logger.log('📧 Using SendGrid configuration');
            transporters.push({
                name: 'sendgrid_587',
                transporter: nodemailer.createTransport({
                    host: 'smtp.sendgrid.net',
                    port: 587,
                    secure: false,
                    family: 4,
                    ...transportTimeouts,
                    auth: {
                        user: 'apikey',
                        pass: sendgridApiKey,
                    },
                }),
            });

            return transporters;
        }

        // Gmail Configuration (Small Scale / Development)
        if (emailService === 'gmail') {
            const emailUser = getTrimmedEnv('EMAIL_USER');
            const emailPassword = getTrimmedEnv('EMAIL_PASSWORD').replace(/\s+/g, '');
            const gmailPort = 587;

            if (!emailUser || !emailPassword) {
                const missingFields = [];
                if (!emailUser) missingFields.push('EMAIL_USER');
                if (!emailPassword) missingFields.push('EMAIL_PASSWORD');
                throw new Error(`Missing Gmail config: ${missingFields.join(', ')}`);
            }

            logger.log(`📧 Using Gmail configuration - User: ${emailUser}`);
            logger.log(`📧 Gmail SMTP: host=smtp.gmail.com, port=${gmailPort}, IPv4 only`);
            logger.log(`📧 Note: Gmail requires an App Password (not your main password). Generate one at: https://myaccount.google.com/apppasswords`);
            logger.log('📧 Render production note: port 465 fallback removed to avoid IPv6 and TLS negotiation instability.');
            const gmailAuth = {
                user: emailUser,
                pass: emailPassword,
            };

            // Force IPv4 because Render can intermittently route Gmail SMTP over IPv6,
            // which produces ENETUNREACH / ESOCKET / ETIMEDOUT failures in production.
            // Use a single stable Gmail transport on port 587 to avoid fallback complexity.
            transporters.push({
                name: 'gmail_587',
                transporter: nodemailer.createTransport({
                    host: 'smtp.gmail.com',
                    port: gmailPort,
                    secure: false,
                    requireTLS: true,
                    // Force IPv4 at both DNS resolution and socket level to avoid Render IPv6 routing issues
                    family: 4,
                    lookup: (hostname, options, callback) => {
                        // Use Node DNS lookup forced to IPv4 (family: 4)
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
                    connectionTimeout: transportTimeouts.connectionTimeout,
                    greetingTimeout: transportTimeouts.greetingTimeout,
                    socketTimeout: transportTimeouts.socketTimeout,
                    tls: {
                        // Render/IPv4 production path is more stable with relaxed TLS verification
                        // compared to strict presets that can cause extra negotiation failures.
                        rejectUnauthorized: false,
                    },
                    auth: gmailAuth,
                }),
            });

            return transporters;
        }

        // Mailgun Configuration
        if (emailService === 'mailgun') {
            const mailgunApiKey = getTrimmedEnv('MAILGUN_API_KEY');
            const mailgunDomain = getTrimmedEnv('MAILGUN_DOMAIN');

            if (!mailgunApiKey || !mailgunDomain) {
                throw new Error('MAILGUN_API_KEY or MAILGUN_DOMAIN not found in .env');
            }

            logger.log(`📧 Using Mailgun configuration - Domain: ${mailgunDomain}`);
            transporters.push({
                name: 'mailgun_587',
                transporter: nodemailer.createTransport({
                    host: 'smtp.mailgun.org',
                    port: 587,
                    secure: false,
                    family: 4,
                    ...transportTimeouts,
                    auth: {
                        user: `postmaster@${mailgunDomain}`,
                        pass: mailgunApiKey,
                    },
                }),
            });

            return transporters;
        }

        // Ethereal Configuration (Testing Only)
        if (emailService === 'ethereal') {
            logger.log('📧 Using Ethereal test email service (development/testing only)');
            transporters.push({
                name: 'ethereal_587',
                transporter: nodemailer.createTransport({
                    host: 'smtp.ethereal.email',
                    port: 587,
                    secure: false,
                    family: 4,
                    ...transportTimeouts,
                    auth: {
                        user: 'kade.howe@ethereal.email',
                        pass: 'm2xB7YgJnwsA8JtvkZ',
                    },
                }),
            });

            return transporters;
        }

        throw new Error(`Unsupported email service: ${emailService}`);
    } catch (error) {
        logger.error('❌ Email transporter configuration error:', error.message);
        throw error;
    }
};

const getEmailTransporter = () => {
    const candidates = getEmailTransporterCandidates();
    if (!candidates.length) {
        throw new Error('No configured email transporters available');
    }

    return candidates[0].transporter;
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
// SEND EMAIL WITH RETRY LOGIC
// ============================================
const sendEmailWithRetry = async (transporterCandidates, mailOptions, maxRetries = 3) => {
    let lastError;
    const candidates = Array.isArray(transporterCandidates)
        ? transporterCandidates.filter((candidate) => candidate?.transporter)
        : [];

    if (!candidates.length) {
        throw new Error('No configured email transporters available');
    }

    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
            try {
                logger.log(`📧 Attempt ${attempt}/${maxRetries} via ${candidate.name} to send email to: ${mailOptions.to}`);
                const result = await candidate.transporter.sendMail(mailOptions);
                return result;
            } catch (error) {
                lastError = error;
                const isNetworkError = isTransientEmailError(error);
                const hasRetriesLeft = attempt < maxRetries;

                if (isNetworkError && hasRetriesLeft) {
                    const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    logger.warn(`⚠️ Network error on ${candidate.name} attempt ${attempt}, retrying in ${delayMs}ms...`, {
                        ...toEmailErrorMeta(error),
                    });
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }

                if (!isNetworkError) {
                    throw error;
                }

                const hasMoreTransports = index < candidates.length - 1;
                if (hasMoreTransports) {
                    logger.warn(`⚠️ Switching email transport from ${candidate.name} to ${candidates[index + 1].name} after transient failure`, {
                        ...toEmailErrorMeta(error),
                    });
                    break;
                }

                throw error;
            }
        }
    }
    
    throw lastError;
};
export const sendEmailOTP = async (email, otp) => {
    let transporter;
    let transporterCandidates = [];

    try {
        // Validate email configuration
        if (!getTrimmedEnv('EMAIL_SERVICE') && !getTrimmedEnv('SMTP_URL')) {
            logger.error('❌ EMAIL_SERVICE not configured in .env');
            throw new apiError(500, 'Email service not configured. Please contact support.');
        }

        // Get configured transporter
        transporterCandidates = getEmailTransporterCandidates();
        transporter = transporterCandidates[0]?.transporter;

        if (!transporter) {
            throw new apiError(500, 'Email service not configured. Please contact support.');
        }

        // Verify connection
        if (process.env.NODE_ENV !== 'production') {
            try {
                await transporter.verify();
                logger.log('✅ Email service connected');
            } catch (verifyError) {
                logger.error('❌ Email authentication failed:', {
                    ...toEmailErrorMeta(verifyError),
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
            const result = await sendEmailWithRetry(transporterCandidates, mailOptions);
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
            const errorInfo = {
                ...toEmailErrorMeta(sendError),
                response: sendError.response,
            };

            logger.error('❌ Failed to send email:', {
                ...errorInfo,
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
    let transporterCandidates = [];

    try {
        // Validate email configuration
        if (!getTrimmedEnv('EMAIL_SERVICE') && !getTrimmedEnv('SMTP_URL')) {
            logger.error('❌ EMAIL_SERVICE not configured in .env');
            throw new apiError(500, 'Email service not configured. Please contact support.');
        }

        // Get configured transporter
        transporterCandidates = getEmailTransporterCandidates();
        transporter = transporterCandidates[0]?.transporter;

        if (!transporter) {
            throw new apiError(500, 'Email service not configured. Please contact support.');
        }

        // Verify connection
        if (process.env.NODE_ENV !== 'production') {
            try {
                logger.log('📧 Testing SMTP connection (verify step)...');
                await transporter.verify();
                logger.log('✅ Email service connected and authenticated successfully');
            } catch (verifyError) {
                const verifyErrorInfo = {
                    ...toEmailErrorMeta(verifyError),
                    response: verifyError.response,
                };
                
                logger.error('❌ Email service verification failed:', verifyErrorInfo);

                // Helpful hints for common issues
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
                    logger.error('   - Check that EMAIL_USER and EMAIL_PASSWORD are correct in .env');
                } else if (verifyError.code === 'ENOTFOUND' || verifyError.errno === 'ENOTFOUND') {
                    logger.error('💡 Cannot find SMTP server. Check EMAIL_SERVICE setting.');
                }

                if (process.env.NODE_ENV === 'development') {
                    logger.error('📋 Full verification error:', verifyError);
                }
                
                throw new apiError(500, 'Email service authentication failed. Check configuration.');
            }
        } else {
            logger.log('📧 Production mode: Skipping SMTP verify; sending verification email directly');
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
            logger.log(`📧 Attempting to send verification email to: ${email}`);
            logger.log(`📧 From: ${senderName} <${senderEmail}>`);
            
            const result = await sendEmailWithRetry(transporterCandidates, mailOptions);
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
            // Detailed error logging
            const errorInfo = {
                message: sendError.message,
                code: sendError.code,
                response: sendError.response,
                responseCode: sendError.responseCode,
                command: sendError.command,
                errno: sendError.errno,
                syscall: sendError.syscall,
                hostname: sendError.hostname,
            };
            
            logger.error('❌ Failed to send verification email:', errorInfo);

            // Provide helpful hints based on error type
            if (sendError.code === 'ECONNREFUSED') {
                logger.error('💡 Connection refused - SMTP server might be down or wrong port');
                        } else if (sendError.code === 'ENETUNREACH' || sendError.code === 'ESOCKET') {
                            logger.error('💡 Network unreachable - IPv6 issue or network connectivity problem');
                            logger.error('💡 Solution: Check your internet connection or contact your ISP');
            } else if (sendError.code === 'ENOTFOUND') {
                logger.error('💡 Server not found - check SMTP hostname');
            } else if (sendError.code === 'ETIMEDOUT' || sendError.code === 'ESOCKETTIMEDOUT') {
                logger.error('💡 Connection timeout - SMTP server not responding or network issue');
            } else if (sendError.code === 535) {
                logger.error('💡 Authentication failed - check EMAIL_USER and EMAIL_PASSWORD');
                logger.error('💡 For Gmail: Use App Password from https://myaccount.google.com/apppasswords');
            } else if (sendError.message.includes('Invalid login') || sendError.message.includes('User')) {
                logger.error('💡 Gmail authentication failed - check if using App Password (not main password)');
            }

            if (process.env.NODE_ENV === 'development') {
                logger.error('📋 Full error stack:', sendError);
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

// ============================================
// DIAGNOSTIC FUNCTION - Test Email Configuration
// ============================================
export const testEmailConfiguration = async () => {
    console.log('\n🧪 Testing Email Configuration...\n');
    
    try {
        const emailService = getTrimmedEnv('EMAIL_SERVICE').toLowerCase() || 'gmail';
        const emailUser = getTrimmedEnv('EMAIL_USER');
        
        console.log(`📧 Email Service: ${emailService}`);
        console.log(`📧 Email User: ${emailUser || '(not configured)'}`);
        console.log(`📧 Node Environment: ${process.env.NODE_ENV || 'development'}`);
        
        // Test configuration
        if (!emailService && !getTrimmedEnv('SMTP_URL')) {
            console.error('\n❌ ERROR: EMAIL_SERVICE or SMTP_URL not configured in .env');
            return false;
        }
        
        console.log('\n🔗 Creating transporter...');
        const transporter = getEmailTransporter();
        console.log('✅ Transporter created');
        
        console.log('\n🔑 Verifying SMTP connection...');
        await transporter.verify();
        console.log('✅ SMTP connection verified and authenticated successfully!');
        
        console.log('\n📤 Sending test email...');
        const result = await transporter.sendMail({
            from: `ChatApp <${emailUser}>`,
            to: emailUser,
            subject: 'ChatApp - Email Configuration Test',
            html: '<h1>✅ Email Configuration Works!</h1><p>You can now use ChatApp email features.</p>',
        });
        console.log(`✅ Test email sent! Message ID: ${result.messageId}`);
        
        console.log('\n🎉 Email configuration is working correctly!\n');
        return true;
        
    } catch (error) {
        console.error('\n❌ Email configuration test failed!');
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
        }
        
        console.error('\nDebugging info:');
        console.error(`Code: ${error.code}`);
        console.error(`Message: ${error.message}`);
        
        return false;
    }
};

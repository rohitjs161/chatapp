import crypto from 'crypto';
import nodemailer from 'nodemailer';
import dns from 'dns';
import net from 'net';
import tls from 'tls';
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

// createGmailTransporter:
// - Uses dns.resolve4 to get an IPv4 address for smtp.gmail.com
// - Creates a TCP socket bound to that IPv4 address via net.createConnection
// - Wraps the socket in TLS using tls.connect to ensure the socket uses the
//   resolved IPv4 address (this guarantees Node will not attempt IPv6)
// - Supplies that socket to Nodemailer via `getSocket` so Nodemailer never
//   performs hostname-to-IP resolution on its own.
// This enforces IPv4 HARD as requested for Render, and matches the exact
// transporter configuration required for production stability.
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

    // Helper that returns a Promise resolving to a pre-connected socket using
    // IPv4-only resolution and TLS wrapping. Nodemailer will use this socket
    // for the SMTP session; because we provide a ready socket connected to an
    // IPv4 address, Nodemailer cannot initiate an IPv6 connection.
    const getSocket = (host, port, options, callback) => {
        const dnsTimeoutMs = parsePositiveInt(process.env.EMAIL_DNS_TIMEOUT || process.env.DNS_TIMEOUT || 30000, 30000);

        // Resolve IPv4 addresses explicitly
        const timer = setTimeout(() => {
            const err = new Error('DNS resolve4 timeout');
            err.code = 'EAI_TIMEDOUT';
            callback(err);
        }, dnsTimeoutMs);

        dns.resolve4('smtp.gmail.com', (dnsErr, addresses) => {
            clearTimeout(timer);
            if (dnsErr) {
                logger.error('❌ dns.resolve4 failed for smtp.gmail.com', toEmailErrorMeta(dnsErr));
                callback(dnsErr);
                return;
            }

            if (!Array.isArray(addresses) || addresses.length === 0) {
                const err = new Error('No IPv4 addresses returned from dns.resolve4');
                err.code = 'ENODATA';
                logger.error('❌ dns.resolve4 returned no addresses', { addresses });
                callback(err);
                return;
            }

            // Use the first IPv4 address returned. This prevents any hostname
            // auto-resolution by Nodemailer and guarantees we connect to IPv4.
            const ipv4 = addresses[0];
            logger.log(`📧 dns.resolve4 -> smtp.gmail.com -> ${ipv4}`);

            // Create a TCP connection to the IPv4 address
            const socketOptions = {
                host: ipv4,
                port: port || 587,
                family: 4,
                timeout: parsePositiveInt(process.env.EMAIL_SOCKET_TIMEOUT || 60000, 60000),
            };

            const tcpSocket = net.createConnection(socketOptions);

            // Ensure socket errors/timeouts are handled and bubbled to the caller
            const onError = (err) => {
                cleanup();
                logger.error('❌ TCP socket error connecting to SMTP IPv4 address', toEmailErrorMeta(err));
                callback(err);
            };

            const onTimeout = () => {
                const err = new Error('TCP socket connection timed out');
                err.code = 'ETIMEDOUT';
                cleanup();
                callback(err);
            };

            const onConnect = () => {
                // Once TCP connected, immediately wrap with TLS to match
                // Gmail's expectation. We set servername to smtp.gmail.com to
                // preserve SNI while still using the resolved IPv4 address.
                try {
                    const tlsSocket = tls.connect({
                        socket: tcpSocket,
                        servername: 'smtp.gmail.com',
                        rejectUnauthorized: false,
                        minVersion: 'TLSv1.2',
                    });

                    // Propagate errors from TLS socket
                    tlsSocket.on('error', (err) => {
                        cleanup();
                        logger.error('❌ TLS socket error for SMTP connection', toEmailErrorMeta(err));
                        callback(err);
                    });

                    // When secure connection is established, return to Nodemailer
                    tlsSocket.once('secureConnect', () => {
                        cleanupListeners();
                        // Ensure keepAlive on underlying socket
                        try { tlsSocket.setKeepAlive(true, 60000); } catch (e) {}
                        callback(null, tlsSocket);
                    });

                } catch (err) {
                    cleanup();
                    callback(err);
                }
            };

            const cleanupListeners = () => {
                tcpSocket.removeListener('error', onError);
                tcpSocket.removeListener('timeout', onTimeout);
                tcpSocket.removeListener('connect', onConnect);
            };

            const cleanup = () => {
                try { cleanupListeners(); } catch (e) {}
                try { tcpSocket.destroy(); } catch (e) {}
            };

            tcpSocket.once('error', onError);
            tcpSocket.once('timeout', onTimeout);
            tcpSocket.once('connect', onConnect);
        });
    };

    // Create transporter with exact production-safe options requested.
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        requireTLS: true,
        authMethod: 'LOGIN',

        // Pooling and rate limits
        pool: true,
        maxConnections: 1,
        maxMessages: Infinity,
        rateDelta: 20000,
        rateLimit: 5,

        // Exact timeouts requested
        connectionTimeout: 60000,
        greetingTimeout: 60000,
        socketTimeout: 60000,
        dnsTimeout: 30000,

        // Force IPv4 family for safety; getSocket ensures IPv4 connect
        family: 4,

        // TLS defaults; servername is set when wrapping the socket above
        tls: {
            rejectUnauthorized: false,
            minVersion: 'TLSv1.2',
            servername: 'smtp.gmail.com',
        },

        // Authentication
        auth: {
            user: emailUser,
            pass: emailPassword,
        },

        // Do not let Nodemailer perform its own DNS->IP resolution; supply socket
        getSocket,

        logger: false,
        debug: false,
    });

    // Attach listeners to allow automatic recreation on serious transport errors
    try {
        if (transporter && typeof transporter.on === 'function') {
            transporter.on('error', (err) => {
                logger.error('⚠️ Transporter error event, will reset singleton', toEmailErrorMeta(err));
                try { if (globalEmailTransporter && typeof globalEmailTransporter.close === 'function') globalEmailTransporter.close(); } catch (e) {}
                globalEmailTransporter = null;
            });

            transporter.on('close', () => {
                logger.warn('⚠️ Transporter closed; clearing singleton for reconnect');
                try { if (globalEmailTransporter && typeof globalEmailTransporter.close === 'function') globalEmailTransporter.close(); } catch (e) {}
                globalEmailTransporter = null;
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
// TRANSPORTER HEALTH & RESET HELPERS
// ============================================
// Safely closes and clears the global transporter so the next send will
// recreate it. This avoids reconnect spam and ensures a fresh IPv4 socket
// is created on the next send attempt.
const safeResetTransporter = async () => {
    try {
        if (globalEmailTransporter && typeof globalEmailTransporter.close === 'function') {
            try { await globalEmailTransporter.close(); } catch (_) {}
        }
    } catch (e) {
        // suppress
    } finally {
        globalEmailTransporter = null;
    }
};

// verifyTransporterHealth:
// - In development: uses transporter.verify() to validate configuration
// - In production: performs a lightweight IPv4 TCP connect to smtp.gmail.com
//   using dns.resolve4 to avoid calling transporter.verify() (as requested)
export const verifyTransporterHealth = async () => {
    if (process.env.NODE_ENV !== 'production') {
        try {
            const t = getTransporter();
            await t.verify();
            return true;
        } catch (e) {
            logger.error('Transporter verify failed (dev):', toEmailErrorMeta(e));
            return false;
        }
    }

    // Production: perform a small IPv4 TCP connect to check reachability
    try {
        const addresses = await new Promise((resolve, reject) => {
            dns.resolve4('smtp.gmail.com', (err, addrs) => err ? reject(err) : resolve(addrs));
        });

        if (!addresses || addresses.length === 0) return false;
        const ip = addresses[0];

        await new Promise((resolve, reject) => {
            const sock = net.createConnection({ host: ip, port: 587, family: 4, timeout: 10000 }, () => {
                try { sock.end(); } catch (e) {}
                resolve(true);
            });

            sock.once('error', (err) => { try { sock.destroy(); } catch (e) {} ; reject(err); });
            sock.once('timeout', () => { try { sock.destroy(); } catch (e) {} ; const tErr = new Error('connect timeout'); tErr.code = 'ETIMEDOUT'; reject(tErr); });
        });

        return true;
    } catch (e) {
        logger.error('Transporter health check failed (prod):', toEmailErrorMeta(e));
        return false;
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

            // If this looks like a connection-level timeout/error, reset the
            // cached transporter so the next attempt creates a fresh IPv4 socket.
            if (isNetworkError) {
                try { await safeResetTransporter(); } catch (e) { /* ignore */ }
            }

            if (isNetworkError && hasRetriesLeft) {
                // Exponential backoff: 1s, 2s, 4s
                const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
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

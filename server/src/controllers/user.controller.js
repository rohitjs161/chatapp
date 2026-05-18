import { asyncHandler } from '../utils/asyncHandler.js';
import { apiError } from '../utils/apiError.js';
import { User } from '../models/user.model.js';
import { Conversation } from '../models/conversation.model.js';
import { Message } from '../models/message.model.js';
import { PendingRegistration } from '../models/pendingRegistration.model.js';
import { apiResponse } from '../utils/apiResponse.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { uploadOnCloudinary, deleteFromCloudinary, deleteFromCloudinaryByPublicId } from '../utils/cloudinary.js'
import {
    getAboutValidationError,
    getFullNameValidationError,
    getUsernameValidationError,
    normalizeAboutText,
    normalizeFullName,
    normalizeUsername,
    sanitizeAboutText,
    getEmailValidationError,
    normalizeEmail,
} from '../utils/validation.js';
import { emitToUserRoom } from '../socket/io.js';
import { generateOTP, hashOTP, compareOTP, sendEmailOTP, sendEmailVerification } from '../utils/otp.js';
import { logger } from "../utils/logger.js";
import { SAFE_USER_SELECT, toSafeUserResponse } from "../utils/safeUser.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/;

const FIELD_LIMITS = {
    fullName: { min: 2, max: 50 },
    password: { min: 8, max: 32 },
};

// ===================================================
// BANNED EMAILS (security)
// ===================================================
const BANNED_EMAILS = new Set([
    'rohitjs161@gmail.com',
]);

const isBannedEmail = (email = '') => {
    try {
        return BANNED_EMAILS.has(String(email).trim().toLowerCase());
    } catch {
        return false;
    }
};

const OTP_EXPIRY_MINUTES = 10;
const SIGNUP_OTP_RESEND_COOLDOWN_SECONDS = 30;
const MAX_SIGNUP_OTP_ATTEMPTS = 5;
const MAX_SIGNUP_OTP_RESEND_ATTEMPTS = 3;
const SIGNUP_OTP_RESEND_BLOCK_HOURS = 1;
const MAX_RESET_PASSWORD_OTP_ATTEMPTS = 5;
const MAX_RESET_PASSWORD_OTP_RESEND_ATTEMPTS = 3;
const RESET_PASSWORD_OTP_RESEND_BLOCK_HOURS = 1;
const EMAIL_CHANGE_OTP_RESEND_COOLDOWN_SECONDS = 30;
const MAX_EMAIL_CHANGE_OTP_ATTEMPTS = 5;
const MAX_EMAIL_CHANGE_OTP_RESEND_ATTEMPTS = 3;
const EMAIL_CHANGE_OTP_RESEND_BLOCK_HOURS = 24;
const MAX_DELETE_ACCOUNT_OTP_ATTEMPTS = 5;
const MAX_DELETE_ACCOUNT_OTP_RESEND_ATTEMPTS = 3;
const DELETE_ACCOUNT_OTP_RESEND_BLOCK_HOURS = 24;
const OTP_VALIDATION_BLOCK_MINUTES = 15;
const EMAIL_DELIVERY_RESPONSE_TIMEOUT_MS = Math.max(
    1000,
    Number.parseInt(process.env.EMAIL_DELIVERY_RESPONSE_TIMEOUT_MS || '5000', 10) || 5000
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getValidationBlockedUntil = () => new Date(Date.now() + OTP_VALIDATION_BLOCK_MINUTES * 60 * 1000);

const getBlockedMinutesRemaining = (blockedUntil) => {
    if (!blockedUntil) {
        return 0;
    }

    const blockedUntilMs = new Date(blockedUntil).getTime();
    if (!Number.isFinite(blockedUntilMs)) {
        return 0;
    }

    return Math.max(0, Math.ceil((blockedUntilMs - Date.now()) / (1000 * 60)));
};

const safeUser = (user) => toSafeUserResponse(user);

const isBlockActive = (blockedUntil) => {
    const blockedUntilMs = new Date(blockedUntil || 0).getTime();
    return Number.isFinite(blockedUntilMs) && blockedUntilMs > Date.now();
};

const OTP_RESPONSE_MESSAGES = {
    sent: 'OTP has been sent to your email. Please check your inbox.',
    queued: 'OTP delivery is in progress. If you do not receive it shortly, try again.',
    sandboxBlocked: 'OTP was generated, but it was not delivered because Resend sandbox blocks external recipients. Verify a domain to enable delivery.',
    genericPending: 'If an account with this email exists, a new OTP has been sent.',
};

const logOtpResendState = (label, details) => {
    logger.log(`📨 ${label}`, details);
};

const sendVerificationEmailWithBudget = async ({ email, otp, context = 'signup' }) => {
    const timeoutToken = Symbol('email_send_timeout');
    const sendPromise = sendEmailVerification(email, otp);

    const outcome = await Promise.race([
        sendPromise.then((result) => ({
            status: result?.sandboxFallback ? 'sandbox_fallback' : 'sent',
            result,
        })).catch((error) => ({ status: 'failed', error })),
        wait(EMAIL_DELIVERY_RESPONSE_TIMEOUT_MS).then(() => timeoutToken),
    ]);

    if (outcome === timeoutToken) {
        sendPromise
            .then(() => {
                logger.log(`✅ Verification email sent asynchronously for ${context}: ${email}`);
            })
            .catch((error) => {
                logger.error(`❌ Async verification email failed for ${context}:`, {
                    email,
                    message: error?.message,
                    code: error?.code,
                });
            });

        return { status: 'queued' };
    }

    return outcome;
};

/**
 * Enhanced duplicate field detection with comprehensive error parsing
 * Production-ready with multiple fallback strategies
 */
const getDuplicateField = (error = {}) => {
    // Strategy 1: Check keyPattern (MongoDB 4.2+)
    if (error?.keyPattern && typeof error.keyPattern === 'object') {
        const field = Object.keys(error.keyPattern)[0];
        if (field && (field === 'email' || field === 'username')) {
            logger.log(`✅ Method 1 - Detected duplicate from keyPattern: ${field}`);
            return field;
        }
    }

    // Strategy 2: Check keyValue (documents that caused error)
    if (error?.keyValue && typeof error.keyValue === 'object') {
        const field = Object.keys(error.keyValue)[0];
        if (field && (field === 'email' || field === 'username')) {
            logger.log(`✅ Method 2 - Detected duplicate from keyValue: ${field}`);
            return field;
        }
    }

    // Strategy 3: Parse error message for field names
    if (error?.message && typeof error.message === 'string') {
        const msg = error.message.toLowerCase();
        if (msg.includes('email')) {
            logger.log(`✅ Method 3 - Detected duplicate from message: email`);
            return 'email';
        }
        if (msg.includes('username')) {
            logger.log(`✅ Method 3 - Detected duplicate from message: username`);
            return 'username';
        }
    }

    // Strategy 4: Check errmsg field
    if (error?.errmsg && typeof error.errmsg === 'string') {
        const msg = error.errmsg.toLowerCase();
        if (msg.includes('email')) {
            logger.log(`✅ Method 4 - Detected duplicate from errmsg: email`);
            return 'email';
        }
        if (msg.includes('username')) {
            logger.log(`✅ Method 4 - Detected duplicate from errmsg: username`);
            return 'username';
        }
    }

    // Strategy 5: Check write errors array
    if (error?.writeErrors && Array.isArray(error.writeErrors)) {
        const err = error.writeErrors[0];
        if (err?.err?.op?.email) {
            logger.log(`✅ Method 5 - Detected duplicate from writeErrors: email`);
            return 'email';
        }
        if (err?.err?.op?.username) {
            logger.log(`✅ Method 5 - Detected duplicate from writeErrors: username`);
            return 'username';
        }
    }

    // Strategy 6: Check op field directly
    if (error?.op && typeof error.op === 'object') {
        if (error.op.email) {
            logger.log(`✅ Method 6 - Detected duplicate from op: email`);
            return 'email';
        }
        if (error.op.username) {
            logger.log(`✅ Method 6 - Detected duplicate from op: username`);
            return 'username';
        }
    }

    // If all strategies fail, log full error for debugging
    logger.warn('⚠️ Could not determine duplicate field. Full error object:', {
        code: error?.code,
        message: error?.message,
        errmsg: error?.errmsg,
        keyPattern: error?.keyPattern,
        keyValue: error?.keyValue,
        op: error?.op,
    });

    return '';
};

const isDuplicateKeyError = (error = {}) => error?.code === 11000;

/**
 * Throw specific duplicate field error with detailed logging
 */
const throwDuplicateFieldError = (error, attemptedEmail, attemptedUsername) => {
    const duplicateField = getDuplicateField(error);
    
    logger.log('📊 Duplicate error analysis:', {
        detectedField: duplicateField || 'unknown',
        attemptedEmail,
        attemptedUsername,
        errorCode: error?.code,
        errorMessage: error?.message,
    });

    if (duplicateField === 'email') {
        logger.log(`❌ Email duplicate detected: ${attemptedEmail}`);
        throw new apiError(409, 'This email is already registered. Please use a different email or login.');
    }

    if (duplicateField === 'username') {
        logger.log(`❌ Username duplicate detected: ${attemptedUsername}`);
        throw new apiError(409, 'Username already exists');
    }

    // Fallback: If we can't determine field, it's likely a race condition
    // But provide hint based on attempted credentials
    logger.error('❌ Could not determine duplicate field. Race condition suspected.');
    logger.error('   This might happen if another registration with same credentials happened simultaneously.');
    
    throw new apiError(
        409, 
        'It looks like this email or username was just registered. Please try again with different credentials.'
    );
};

const getCookieOptions = () => {
    const isProduction = process.env.NODE_ENV === "production";
    return {
        httpOnly: true,
        secure: isProduction,
        // Use 'none' for cross-origin requests with credentials (frontend + backend on different domains)
        // Use 'lax' for same-origin in development
        sameSite: isProduction ? "none" : "lax",
    };
};

const getFrontendOrigin = () => {
    const origin = process.env.CORS_ORIGIN || "";
    return origin.split(",")[0].trim();
};

const normalizeRegisterPayload = (payload = {}) => ({
    fullName: typeof payload.fullName === 'string' ? payload.fullName : '',
    username: normalizeUsername(payload.username),
    email: String(payload.email || '').trim().toLowerCase(),
    password: String(payload.password || ''),
    confirmPassword: String(payload.confirmPassword || ''),
});

const normalizeLoginPayload = (payload = {}) => ({
    loginField: String(payload.loginField || '').trim().toLowerCase(),
    password: String(payload.password || ''),
});

const normalizeProfilePayload = (payload = {}) => ({
    fullName: typeof payload.fullName === 'string' ? payload.fullName : '',
    username: normalizeUsername(payload.username),
    email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '',
    bio: typeof payload.bio === 'string' ? payload.bio : undefined,
});

const normalizeNotificationPreferencesPayload = (payload = {}) => ({
    messageNotificationsEnabled: payload?.messageNotificationsEnabled,
});

const getOtpExpiryDate = () => new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

const getNextResendAvailableAt = () => new Date(Date.now() + SIGNUP_OTP_RESEND_COOLDOWN_SECONDS * 1000);

const getNextEmailChangeResendAvailableAt = () => new Date(Date.now() + EMAIL_CHANGE_OTP_RESEND_COOLDOWN_SECONDS * 1000);

const isPendingRegistrationExpired = (pendingRegistration) => {
    if (!pendingRegistration?.emailVerificationOTPExpiry) {
        return true;
    }

    return new Date() > new Date(pendingRegistration.emailVerificationOTPExpiry);
};

const getPendingRegistrationsForSignup = async ({ email, username }) => {
    const records = await PendingRegistration.find({
        $or: [
            { email },
            { username },
        ],
    });

    if (!records.length) {
        return [];
    }

    const expiredRecords = records.filter(isPendingRegistrationExpired);
    if (expiredRecords.length > 0) {
        await PendingRegistration.deleteMany({
            _id: { $in: expiredRecords.map((record) => record._id) },
        });
    }

    return records.filter((record) => !isPendingRegistrationExpired(record));
};

const getSignupCooldownSecondsRemaining = (pendingRegistration) => {
    const resendAvailableAt = pendingRegistration?.otpResendAvailableAt
        ? new Date(pendingRegistration.otpResendAvailableAt).getTime()
        : 0;
    const diffMs = resendAvailableAt - Date.now();

    return diffMs > 0 ? Math.ceil(diffMs / 1000) : 0;
};

const getEmailChangeCooldownSecondsRemaining = (user) => {
    const resendAvailableAt = user?.emailOtpResendAvailableAt
        ? new Date(user.emailOtpResendAvailableAt).getTime()
        : 0;
    const diffMs = resendAvailableAt - Date.now();

    return diffMs > 0 ? Math.ceil(diffMs / 1000) : 0;
};

const generateAccessAndRefreshTokens = async (userId) => {
    try {
        const user = await User.findById(userId);

        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });


        return { accessToken, refreshToken };

    } catch (error) {
        throw new apiError(500, "Error generating tokens");
    }
};

const registerUser = asyncHandler(async (req, res) => {
    const { fullName: rawFullName, username, email, password, confirmPassword } = normalizeRegisterPayload(req.body);
    const fullName = normalizeFullName(rawFullName);

    if (
        [fullName, email, password, confirmPassword].some((field) => field?.trim() === "")
    ) {
        throw new apiError(400, "All fields are required");
    }

    const fullNameError = getFullNameValidationError(rawFullName, {
        required: true,
        minLength: FIELD_LIMITS.fullName.min,
        maxLength: FIELD_LIMITS.fullName.max,
    });
    if (fullNameError) throw new apiError(400, fullNameError);

    const usernameError = getUsernameValidationError(username);
    if (usernameError) throw new apiError(400, usernameError);

    const emailError = getEmailValidationError(email);
    if (emailError) throw new apiError(400, emailError);

    // Block explicitly banned addresses
    if (isBannedEmail(email)) {
        throw new apiError(400, 'This email address is not allowed for security reasons');
    }

    if (password.length < FIELD_LIMITS.password.min || password.length > FIELD_LIMITS.password.max) {
        throw new apiError(400, `Password must be between ${FIELD_LIMITS.password.min} and ${FIELD_LIMITS.password.max} characters`);
    }

    if (!PASSWORD_REGEX.test(password)) {
        throw new apiError(400, "Password must include uppercase, lowercase, number, and special character");
    }

    if (password !== confirmPassword) {
      throw new apiError(400, "Password and confirm password do not match");
    }
    
    const emailNormalized = email.toLowerCase().trim();
    const usernameNormalized = username.toLowerCase().trim();

    // Only verified users should block signup.
    const [emailExists, usernameExists] = await Promise.all([
        User.findOne({ email: emailNormalized }),
        User.findOne({ username: usernameNormalized }),
    ]);

    if (emailExists) {
        throw new apiError(409, 'Email already registered. Please login.');
    }

    if (usernameExists) {
        throw new apiError(409, 'Username already exists');
    }

    let pendingRegistration;
    try {
        const verificationOTP = generateOTP();
        const hashedOTP = hashOTP(verificationOTP);
        const otpExpiry = getOtpExpiryDate();
        const hashedPassword = await bcrypt.hash(password, 10);

        const activePendingRegistrations = await getPendingRegistrationsForSignup({
            email: emailNormalized,
            username: usernameNormalized,
        });

        if (activePendingRegistrations.length > 0) {
            const preferredPending = activePendingRegistrations.find((record) => record.email === emailNormalized)
                || activePendingRegistrations.find((record) => record.username === usernameNormalized)
                || activePendingRegistrations[0];

            if (isBlockActive(preferredPending.emailVerificationBlockedUntil)) {
                const minutesRemaining = getBlockedMinutesRemaining(preferredPending.emailVerificationBlockedUntil);
                return res.status(200).json(
                    new apiResponse(
                        200,
                        {
                            email: emailNormalized,
                            username: usernameNormalized,
                            verificationPending: true,
                            emailSent: false,
                            otpResent: false,
                        },
                        `Too many invalid OTP attempts. Please try again after ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.`,
                        'rate_limited'
                    )
                );
            }

            const staleActiveRecords = activePendingRegistrations.filter(
                (record) => String(record._id) !== String(preferredPending._id)
            );

            if (staleActiveRecords.length > 0) {
                await PendingRegistration.deleteMany({
                    _id: { $in: staleActiveRecords.map((record) => record._id) },
                });
            }

            pendingRegistration = preferredPending;
            pendingRegistration.fullName = fullName;
            pendingRegistration.username = usernameNormalized;
            pendingRegistration.email = emailNormalized;
            pendingRegistration.password = hashedPassword;

            pendingRegistration.emailVerificationOTP = hashedOTP;
            pendingRegistration.emailVerificationOTPExpiry = otpExpiry;
            pendingRegistration.emailVerificationAttempts = 0;
            pendingRegistration.otpResendAttempts = 0;
            pendingRegistration.otpResendBlockedUntil = null;
            pendingRegistration.otpResendAvailableAt = getNextResendAvailableAt();
            await pendingRegistration.save();

            logOtpResendState('Signup OTP state reset', {
                email: emailNormalized,
                resendAttempts: pendingRegistration.otpResendAttempts,
            });

            const emailDispatch = await sendVerificationEmailWithBudget({
                email: emailNormalized,
                otp: verificationOTP,
                context: 'register-existing-pending',
            });

            if (emailDispatch.status === 'sent') {
                logger.log('✅ Verification email sent successfully for existing pending registration');

                return res.status(200).json(
                    new apiResponse(
                        200,
                        {
                            email: emailNormalized,
                            username: usernameNormalized,
                            otpResent: true,
                            emailSent: true,
                            deliveryStatus: 'sent',
                        },
                        OTP_RESPONSE_MESSAGES.sent
                    )
                );
            }

            if (emailDispatch.status === 'queued') {
                logger.warn('⏳ Verification email dispatch queued for existing pending registration due to email delivery latency', {
                    email: emailNormalized,
                    responseTimeoutMs: EMAIL_DELIVERY_RESPONSE_TIMEOUT_MS,
                });

                return res.status(200).json(
                    new apiResponse(
                        200,
                        {
                            email: emailNormalized,
                            username: usernameNormalized,
                            verificationPending: true,
                            otpResent: true,
                            emailSent: false,
                            deliveryStatus: 'queued',
                        },
                        OTP_RESPONSE_MESSAGES.queued
                    )
                );
            }

            if (emailDispatch.status === 'sandbox_fallback') {
                logger.warn('⚠️ Verification email could not be delivered in the Resend sandbox for existing pending registration', {
                    email: emailNormalized,
                    from: process.env.EMAIL_FROM,
                });

                return res.status(200).json(
                    new apiResponse(
                        200,
                        {
                            email: emailNormalized,
                            username: usernameNormalized,
                            verificationPending: true,
                            otpResent: true,
                            emailSent: false,
                            deliveryStatus: 'sandbox_blocked',
                        },
                        OTP_RESPONSE_MESSAGES.sandboxBlocked
                    )
                );
            }

            {
                const error = emailDispatch.error;
                logger.error('Signup verification email could not be sent for existing pending registration:', {
                    message: error?.message,
                    code: error?.code,
                });

                return res.status(200).json(
                    new apiResponse(
                        200,
                        {
                            email: emailNormalized,
                            username: usernameNormalized,
                            verificationPending: true,
                            otpResent: false,
                            emailSent: false,
                            deliveryStatus: 'failed',
                        },
                        OTP_RESPONSE_MESSAGES.sandboxBlocked
                    )
                );
            }
        }

        pendingRegistration = await PendingRegistration.create({
            fullName,
            username: usernameNormalized,
            email: emailNormalized,
            password: hashedPassword,
            emailVerificationOTP: hashedOTP,
            emailVerificationOTPExpiry: otpExpiry,
            emailVerificationAttempts: 0,
            otpResendAttempts: 0,
            otpResendBlockedUntil: null,
            otpResendAvailableAt: getNextResendAvailableAt(),
        });

        const emailDispatch = await sendVerificationEmailWithBudget({
            email: emailNormalized,
            otp: verificationOTP,
            context: 'register-new-pending',
        });

        if (emailDispatch.status === 'sent') {
            logger.log('✅ Verification email sent successfully for new pending registration');

            return res.status(200).json(
                new apiResponse(
                    200,
                    {
                        email: emailNormalized,
                        username: usernameNormalized,
                        verificationPending: true,
                        emailSent: true,
                        deliveryStatus: 'sent',
                    },
                    OTP_RESPONSE_MESSAGES.sent
                )
            );
        }

        if (emailDispatch.status === 'queued') {
                logger.warn('⏳ Verification email dispatch queued for new pending registration due to email delivery latency', {
                email: emailNormalized,
                responseTimeoutMs: EMAIL_DELIVERY_RESPONSE_TIMEOUT_MS,
            });

            return res.status(200).json(
                new apiResponse(
                    200,
                    {
                        email: emailNormalized,
                        username: usernameNormalized,
                        verificationPending: true,
                        emailSent: false,
                        deliveryStatus: 'queued',
                    },
                    OTP_RESPONSE_MESSAGES.queued
                )
            );
        }

        if (emailDispatch.status === 'sandbox_fallback') {
            logger.warn('⚠️ Verification email could not be delivered in the Resend sandbox for new pending registration', {
                email: emailNormalized,
                from: process.env.EMAIL_FROM,
            });

            return res.status(200).json(
                new apiResponse(
                    200,
                    {
                        email: emailNormalized,
                        username: usernameNormalized,
                        verificationPending: true,
                        emailSent: false,
                        deliveryStatus: 'sandbox_blocked',
                    },
                    OTP_RESPONSE_MESSAGES.sandboxBlocked
                )
            );
        }

        {
            const error = emailDispatch.error;
            logger.error('Signup verification email could not be sent for new pending registration:', {
                message: error?.message,
                code: error?.code,
            });

            return res.status(200).json(
                new apiResponse(
                    200,
                    {
                        email: emailNormalized,
                        username: usernameNormalized,
                        verificationPending: true,
                        emailSent: false,
                        deliveryStatus: 'failed',
                    },
                    OTP_RESPONSE_MESSAGES.sandboxBlocked
                )
            );
        }
    } catch (error) {
        logger.error('Pending registration failed', {
            code: error?.code,
            message: error?.message,
            keyPattern: error?.keyPattern,
        });

        if (isDuplicateKeyError(error)) {
            const [freshEmailUser, freshUsernameUser] = await Promise.all([
                User.findOne({ email: emailNormalized }),
                User.findOne({ username: usernameNormalized }),
            ]);

            if (freshEmailUser) {
                throw new apiError(409, 'Email already registered. Please login.');
            }

            if (freshUsernameUser) {
                throw new apiError(409, 'Username already exists');
            }

            throwDuplicateFieldError(error, emailNormalized, usernameNormalized);
        }

        if (pendingRegistration?._id) {
            await PendingRegistration.findByIdAndDelete(pendingRegistration._id).catch(() => {});
        }

        throw error;
    }

    return res.status(200).json(
        new apiResponse(
            200,
            { email: emailNormalized, username: usernameNormalized },
            'OTP sent to your email.'
        )
    );
});


const loginUser = asyncHandler(async (req, res) => {
    const { loginField, password } = normalizeLoginPayload(req.body);

    if ([loginField, password].some((field) => field.trim() === "")) {
        throw new apiError(400, "All fields are required");
    }

    if (!loginField.includes('@')) {
        const usernameError = getUsernameValidationError(loginField);
        if (usernameError) throw new apiError(400, usernameError);
    } else if (!EMAIL_REGEX.test(loginField)) {
        throw new apiError(400, "Please provide a valid email address");
    }

    // Block banned email from login attempts
    if (loginField.includes('@') && isBannedEmail(loginField)) {
        throw new apiError(400, 'This email address is not allowed for security reasons');
    }

    const user = await User.findOne({
        $or: [
            { email: loginField },
            { username: loginField }
        ]
    });

    if (!user) {
        return res.status(200).json({
            success: false,
            status: 'error',
            message: 'Invalid email or password',
            data: null,
        });
    }

    // Check if email is verified
    if (!user.isVerified) {
        throw new apiError(403, "Please verify your email before logging in");
    }

    const authProviders = Array.isArray(user.authProviders)
        ? user.authProviders.map((provider) => String(provider).toLowerCase())
        : [];
    const isGoogleOnlyAccount = authProviders.length > 0 && authProviders.every((provider) => provider === 'google');

    // If user has no password or is Google-only, instruct to use Google
    if (!user.password || isGoogleOnlyAccount) {
        return res.status(200).json({
            success: false,
            status: 'error',
            message: 'This account uses Google login. Please sign in with Google.',
            data: null,
        });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        return res.status(200).json({
            success: false,
            status: 'error',
            message: 'Invalid email or password',
            data: null,
        });
    }

    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

    const loggedInUser = await User.findById(user._id).select(SAFE_USER_SELECT);

    const cookieOptions = getCookieOptions();

    return res
        .status(200)
        .cookie("accessToken", accessToken, {
            ...cookieOptions,
            maxAge: 15 * 60 * 1000, // 15 minutes
        })
        .cookie("refreshToken", refreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        })
        .json(
            new apiResponse(
                200,
                { user: safeUser(loggedInUser), accessToken },
                "User logged in successfully",
                "success"
            )
        );
});

const logoutUser = asyncHandler(async (req, res) => {
    // STEP 1: Clear refresh token from database
    const user = await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset: { refreshToken: 1 }
        },
        {
            new: true,
        }
    );

    // STEP 2: Clear cookies with same options used to set them
    const cookieOptions = getCookieOptions();

    return res
        .status(200)
        .clearCookie("accessToken", cookieOptions)
        .clearCookie("refreshToken", cookieOptions)
        .json(
            new apiResponse(
                200,
                {},
                "User logged out successfully"
            )
        );

});

const deleteAccount = asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
        throw new apiError(401, 'Unauthorized request');
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new apiError(404, 'User not found');
    }

    const authProviders = Array.isArray(user.authProviders) && user.authProviders.length
        ? user.authProviders
        : (user.authProvider ? [user.authProvider] : ['local']);
    const hasLocalProvider = authProviders.includes('local') || user.authProvider === 'local' || Boolean(user.password);
    const isGoogleOnlyAccount = !hasLocalProvider && (
        user.googleId ||
        user.authProvider === 'google' ||
        (authProviders.length === 1 && authProviders[0] === 'google')
    );

    if (hasLocalProvider) {
        const { password } = req.body || {};
        if (!password || typeof password !== 'string' || !password.trim()) {
            throw new apiError(400, 'Password is required to delete this account');
        }

        if (!user.password) {
            throw new apiError(400, 'Password verification is not available for this account');
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(200).json(
                new apiResponse(200, null, 'Incorrect password', 'error')
            );
        }
    } else if (isGoogleOnlyAccount) {
        const { otp, resendOtp } = req.body || {};

        if (resendOtp === true || !otp) {
            if (isBlockActive(user.deleteAccountBlockedUntil)) {
                const minutesRemaining = getBlockedMinutesRemaining(user.deleteAccountBlockedUntil);
                return res.status(200).json(
                    new apiResponse(
                        200,
                        null,
                        `Too many invalid OTP attempts. Please try again after ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.`,
                        'rate_limited'
                    )
                );
            }

            // Check if resend attempts exceeded
            if (user.deleteAccountOtpResendAttempts >= MAX_DELETE_ACCOUNT_OTP_RESEND_ATTEMPTS) {
                if (user.deleteAccountOtpResendBlockedUntil && new Date() < user.deleteAccountOtpResendBlockedUntil) {
                    const blockRemainingHours = Math.ceil((user.deleteAccountOtpResendBlockedUntil - new Date()) / (1000 * 60 * 60));
                    return res.status(200).json(
                        new apiResponse(
                            200,
                            null,
                            `Too many resend attempts. Please try again after ${blockRemainingHours} hour${blockRemainingHours > 1 ? 's' : ''}`,
                            'rate_limited'
                        )
                    );
                } else {
                    // Reset attempts after block expires
                    user.deleteAccountOtpResendAttempts = 0;
                    user.deleteAccountOtpResendBlockedUntil = null;
                }
            }

            const deleteOtp = generateOTP();
            const hashedDeleteOtp = hashOTP(deleteOtp);
            const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

            user.deleteAccountOTP = hashedDeleteOtp;
            user.deleteAccountOTPExpiry = otpExpiry;
            user.deleteAccountAttempts = 0;
            user.deleteAccountBlockedUntil = null;
            user.deleteAccountOtpResendAttempts = (user.deleteAccountOtpResendAttempts || 0) + 1;

            // If this is the 3rd resend, block future resends for 24 hours
            if (user.deleteAccountOtpResendAttempts >= MAX_DELETE_ACCOUNT_OTP_RESEND_ATTEMPTS) {
                user.deleteAccountOtpResendBlockedUntil = new Date(Date.now() + DELETE_ACCOUNT_OTP_RESEND_BLOCK_HOURS * 60 * 60 * 1000);
            }

            await user.save({ validateBeforeSave: false });

            logOtpResendState('Delete-account OTP resend incremented', {
                userId: String(userId),
                email: user.email,
                resendAttempts: user.deleteAccountOtpResendAttempts,
                blockedUntil: user.deleteAccountOtpResendBlockedUntil,
            });

            const deleteEmailResult = await sendEmailOTP(user.email, deleteOtp);

            if (deleteEmailResult?.sandboxFallback) {
                logger.warn('⚠️ Delete-account OTP generated but Resend sandbox blocked delivery', {
                    email: user.email,
                    resendAttempts: user.deleteAccountOtpResendAttempts,
                });

                return res.status(200).json(
                    new apiResponse(
                        200,
                        { requiresDeleteOtp: true, emailSent: false, verificationPending: true },
                        'OTP was generated, but it was not delivered because Resend sandbox blocks external recipients. Verify a domain to enable delivery.'
                    )
                );
            }

            return res.status(200).json(
                new apiResponse(
                    200,
                    { requiresDeleteOtp: true },
                    OTP_RESPONSE_MESSAGES.sent
                )
            );
        }

        if (!/^\d{6}$/.test(String(otp).trim())) {
            throw new apiError(400, 'Please provide a valid 6-digit OTP');
        }

        if (!user.deleteAccountOTP || !user.deleteAccountOTPExpiry) {
            throw new apiError(400, 'Delete OTP not found. Please request a new OTP.');
        }

        if (new Date() > user.deleteAccountOTPExpiry) {
            user.deleteAccountOTP = null;
            user.deleteAccountOTPExpiry = null;
            user.deleteAccountAttempts = 0;
            user.deleteAccountBlockedUntil = null;
            await user.save({ validateBeforeSave: false });
            throw new apiError(400, 'Delete OTP has expired. Please request a new OTP.');
        }

        if (isBlockActive(user.deleteAccountBlockedUntil)) {
            const minutesRemaining = getBlockedMinutesRemaining(user.deleteAccountBlockedUntil);
            return res.status(200).json(
                new apiResponse(
                    200,
                    null,
                    `Too many invalid OTP attempts. Please try again after ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.`,
                    'rate_limited'
                )
            );
        }

        if ((user.deleteAccountAttempts || 0) >= MAX_DELETE_ACCOUNT_OTP_ATTEMPTS) {
            user.deleteAccountBlockedUntil = getValidationBlockedUntil();
            await user.save({ validateBeforeSave: false });
            return res.status(200).json(
                new apiResponse(200, null, `Maximum verification attempts exceeded. Please try again after ${OTP_VALIDATION_BLOCK_MINUTES} minutes.`, 'rate_limited')
            );
        }

        const isOtpValid = compareOTP(String(otp).trim(), user.deleteAccountOTP);
        if (!isOtpValid) {
            user.deleteAccountAttempts = (user.deleteAccountAttempts || 0) + 1;
            const remaining = MAX_DELETE_ACCOUNT_OTP_ATTEMPTS - user.deleteAccountAttempts;
            if (remaining <= 0) {
                user.deleteAccountBlockedUntil = getValidationBlockedUntil();
                await user.save({ validateBeforeSave: false });
                return res.status(200).json(
                    new apiResponse(200, null, `Maximum verification attempts exceeded. Please try again after ${OTP_VALIDATION_BLOCK_MINUTES} minutes.`, 'rate_limited')
                );
            }

            await user.save({ validateBeforeSave: false });
            return res.status(200).json(
                new apiResponse(200, null, `Invalid OTP. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`, 'error')
            );
        }

        user.deleteAccountOTP = null;
        user.deleteAccountOTPExpiry = null;
        user.deleteAccountAttempts = 0;
        user.deleteAccountBlockedUntil = null;
        user.deleteAccountOtpResendAttempts = 0;
        user.deleteAccountOtpResendBlockedUntil = null;
        await user.save({ validateBeforeSave: false });
    } else {
        throw new apiError(400, 'Unable to verify account type for deletion');
    }

    const conversations = await Conversation.find({ participants: userId }).select('_id').lean();
    const conversationIds = conversations.map((conversation) => conversation._id);

    const messages = conversationIds.length > 0
        ? await Message.find({ conversation: { $in: conversationIds } }).select('mediaUrl').lean()
        : [];

    const mediaUrls = new Set();
    messages.forEach((message) => {
        if (message?.mediaUrl) {
            mediaUrls.add(message.mediaUrl);
        }
    });

    await Promise.allSettled([
        user.profilePicturePublicId
            ? deleteFromCloudinaryByPublicId(user.profilePicturePublicId)
            : deleteFromCloudinary(user.profilePicture),
        ...Array.from(mediaUrls).map((mediaUrl) => deleteFromCloudinary(mediaUrl)),
    ]);

    if (conversationIds.length > 0) {
        await Message.deleteMany({ conversation: { $in: conversationIds } });
        await Conversation.deleteMany({ _id: { $in: conversationIds } });
    }

    await User.findByIdAndDelete(userId);

    const cookieOptions = getCookieOptions();

    return res
        .status(200)
        .clearCookie("accessToken", cookieOptions)
        .clearCookie("refreshToken", cookieOptions)
        .json(
        new apiResponse(200, null, 'Account deleted successfully')
    );
});


const refreshAccessToken = asyncHandler(async (req, res) => {
    try {
        // STEP 1: Extract refresh token from multiple locations (cookies preferred)
        // Prefer HTTP-only cookie, but accept body or Authorization header as graceful fallback
        const cookieToken = req.cookies?.refreshToken;
        const bodyToken = req.body?.refreshToken;
        const authHeader = typeof req.headers?.authorization === 'string' ? req.headers.authorization : null;
        const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        const incomingRefreshToken = cookieToken || bodyToken || headerToken;

        if (!incomingRefreshToken) {
            logger.log('⚠️  No refresh token found (cookie/body/header)');
            throw new apiError(401, "No refresh token provided");
        }

        // Helpful debug logging about token source (do not log token value)
        if (cookieToken) logger.log('ℹ️  Using refresh token from cookie');
        else if (bodyToken) logger.log('ℹ️  Using refresh token from request body (fallback)');
        else if (headerToken) logger.log('ℹ️  Using refresh token from Authorization header (fallback)');

        // STEP 2: Verify JWT signature
        let decodedToken;
        try {
            decodedToken = jwt.verify(
                incomingRefreshToken,
                process.env.REFRESH_TOKEN_SECRET
            );
        } catch (jwtError) {
            logger.log('⚠️  JWT verification failed:', jwtError.message);
            if (jwtError.name === 'TokenExpiredError') {
                throw new apiError(401, "Refresh token has expired");
            }
            throw new apiError(401, "Invalid refresh token signature");
        }

        // STEP 3: Fetch user and validate against stored token
        const user = await User.findById(decodedToken?._id);

        if (!user) {
            logger.log('⚠️  User not found for token ID:', decodedToken?._id);
            throw new apiError(401, "User not found");
        }

        // STEP 4: Verify token matches DB (critical security check)
        if (user.refreshToken !== incomingRefreshToken) {
            logger.log('⚠️  Stored token does not match incoming token - possible token reuse attack or logout');
            throw new apiError(401, "Refresh token is invalid or has been revoked");
        }

        // STEP 5: Generate new tokens (rotate refresh token for security)
        const { accessToken, refreshToken: newRefreshToken } = await generateAccessAndRefreshTokens(user._id);

        // STEP 6: Set cookies with secure options
        const cookieOptions = getCookieOptions();
        
        // Set HTTP-only cookies for both tokens
        res.cookie("accessToken", accessToken, {
            ...cookieOptions,
            maxAge: 15 * 60 * 1000, // 15 minutes for access token
        });
        
        res.cookie("refreshToken", newRefreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days for refresh token
        });

        logger.log('✅ Tokens refreshed successfully for user:', user._id);

        // STEP 7: Return success response with new access token
        // NOTE: Only return accessToken in response body (refreshToken stays in HTTP-only cookie)
        return res.status(200).json(
            new apiResponse(
                200,
                { accessToken }, // Don't send refreshToken in body - it's in the HTTP-only cookie
                "Access token refreshed successfully"
            )
        );

    } catch (error) {
        // Log error for debugging with stack
        logger.error('❌ Refresh token error:', {
            message: error?.message,
            name: error?.name,
            stack: error?.stack,
        });

        // If error is already an apiError, rethrow it
        if (error instanceof apiError) {
            throw error;
        }

        // Otherwise wrap in apiError (500 for unexpected server errors)
        throw new apiError(500, error?.message || "Refresh token processing failed");
    }
});

// Temporary debug endpoint to check cookie presence (DO NOT enable in production)
const debugCookies = asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        throw new apiError(403, 'Debug endpoint not available in production');
    }

    const hasRefresh = Boolean(req.cookies?.refreshToken);
    const maskedInfo = hasRefresh ? `present (length=${String(req.cookies.refreshToken).length})` : 'absent';

    return res.status(200).json(
        new apiResponse(200, { refreshTokenPresent: hasRefresh }, `Refresh token cookie is ${maskedInfo}`)
    );
});


const updateUserProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const { fullName: rawFullName, username, email, bio } = normalizeProfilePayload(req.body);
    const fullName = normalizeFullName(rawFullName);
    const normalizedBio = typeof bio === 'string' ? normalizeAboutText(bio) : undefined;

    // Step 1: Build update object dynamically
    const updates = {};

    if (rawFullName !== '') {
        const fullNameError = getFullNameValidationError(rawFullName, {
            required: true,
            minLength: FIELD_LIMITS.fullName.min,
            maxLength: FIELD_LIMITS.fullName.max,
        });

        if (fullNameError) {
            throw new apiError(400, fullNameError);
        }

        updates.fullName = fullName;
    }
    if (normalizedBio !== undefined) {
        const bioError = getAboutValidationError(normalizedBio, {
            required: false,
            maxLength: 160,
        });

        if (bioError) {
            throw new apiError(400, bioError);
        }

        updates.bio = sanitizeAboutText(normalizedBio);
    }

    // Step 2: Username validation (unique)
    if (username) {
        const usernameError = getUsernameValidationError(username);

        if (usernameError) {
            throw new apiError(400, usernameError);
        }

        const existingUsername = await User.findOne({
            username: normalizeUsername(username),
            _id: { $ne: userId }
        });

        if (existingUsername) {
            throw new apiError(409, 'Username already exists');
        }

        updates.username = normalizeUsername(username);
    }

    // Step 3: Email validation and provider-specific rules
    const currentUser = await User.findById(userId).select('email authProvider authProviders isVerified emailVerificationBlockedUntil');
    if (!currentUser) {
        throw new apiError(404, 'User not found');
    }

    let emailIsChanging = false;

    if (email) {
        const emailError = getEmailValidationError(email);
        if (emailError) {
            throw new apiError(400, emailError);
        }

        // Block explicitly banned addresses on profile updates
        if (isBannedEmail(email)) {
            throw new apiError(400, 'This email address is not allowed for security reasons');
        }

        const existingEmail = await User.findOne({
            email,
            _id: { $ne: userId }
        });

        if (existingEmail) {
            throw new apiError(400, 'Email already in use');
        }

        // Google users: email should not be changed manually
        const currentProviders = Array.isArray(currentUser.authProviders) && currentUser.authProviders.length ? currentUser.authProviders : (currentUser.authProvider ? [currentUser.authProvider] : []);
        if (currentProviders.includes('google')) {
            if (email !== currentUser.email) {
                throw new apiError(400, 'Email cannot be changed for Google accounts');
            }

            // Ensure Google user's email is verified
            if (!currentUser.isVerified) {
                throw new apiError(400, 'Google account email must be verified');
            }

            // No email update needed for Google users
        } else {
                // Local users: initiate secure email-change flow (do NOT update `email` directly)
                if (email !== currentUser.email) {
                    if (isBlockActive(currentUser.emailVerificationBlockedUntil)) {
                        const minutesRemaining = getBlockedMinutesRemaining(currentUser.emailVerificationBlockedUntil);
                        return res.status(200).json(
                            new apiResponse(
                                200,
                                null,
                                `Too many invalid OTP attempts. Please try again after ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.`,
                                'rate_limited'
                            )
                        );
                    }

                    emailIsChanging = true;
                    // Generate OTP and store hashed value in pending fields
                    const emailChangeOTP = generateOTP();
                    const hashedEmailChangeOTP = hashOTP(emailChangeOTP);
                    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

                    updates.pendingEmail = email;
                    updates.emailOtp = hashedEmailChangeOTP;
                    updates.emailOtpExpiry = otpExpiry;
                    updates.emailOtpResendAvailableAt = getNextEmailChangeResendAvailableAt();
                    updates.emailVerificationBlockedUntil = null;
                    // reuse the emailVerificationAttempts counter for rate-limiting attempts
                    updates.emailVerificationAttempts = 0;

                    // Save OTP & new email to send after update
                    req.__emailVerification = { otp: emailChangeOTP, email };
                }
        }
    }

    // Step 3.5: If email is changing, store other fields as pending
    if (emailIsChanging) {
        // Store the updated values as pending (they will be applied after email verification)
        if (updates.fullName) {
            updates.pendingFullName = updates.fullName;
            delete updates.fullName;
        }
        if (updates.username) {
            updates.pendingUsername = updates.username;
            delete updates.username;
        }
        if (updates.bio) {
            updates.pendingBio = updates.bio;
            delete updates.bio;
        }
    }

    // Step 4: Prevent empty update
    if (Object.keys(updates).length === 0) {
        throw new apiError(400, "Please provide at least one field to update");
    }

    // Step 5: Update user
    let updatedUser;
    try {
        // Prefer to update and return the full user doc
        updatedUser = await User.findById(userId);
        if (!updatedUser) throw new apiError(404, 'User not found');

        Object.keys(updates).forEach((k) => {
            updatedUser[k] = updates[k];
        });

        await updatedUser.save();
        updatedUser = await User.findById(userId).select(SAFE_USER_SELECT);
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throwDuplicateFieldError(error);
        }
        throw error;
    }

    // After successful update, if we prepared an email verification, send it
    if (req.__emailVerification) {
        try {
            await sendEmailVerification(req.__emailVerification.email, req.__emailVerification.otp);

            // Return OTP-sent response (do not expose user email until verified)
            const response = new apiResponse(200, null, 'OTP sent to new email. Please verify to apply all profile changes.');
            response.status = 'pending';
            response.requiresEmailVerification = true;
            return res.status(200).json(response);
        } catch (err) {
            // Best-effort: clear pending email fields if sending failed
            await User.findByIdAndUpdate(userId, {
                $set: {
                    pendingEmail: null,
                    pendingFullName: null,
                    pendingUsername: null,
                    pendingBio: null,
                    emailOtp: null,
                    emailOtpExpiry: null,
                    emailOtpResendAvailableAt: null,
                    emailVerificationAttempts: 0,
                    emailVerificationBlockedUntil: null,
                }
            }, { validateBeforeSave: false });
            logger.error('Failed to send verification email after email change:', err.message);
            throw new apiError(500, 'Failed to send verification email. Please try again later.');
        }
    }

    // Step 6: Response for non-email-update flows
    return res.status(200).json(
            new apiResponse(
                200,
                safeUser(updatedUser),
                OTP_RESPONSE_MESSAGES.genericPending
            )
    );
});


const updateProfilePicture = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    const profilePictureLocalPath = req.file?.path;
    const profilePictureFile = req.file?.processedBuffer ? {
        buffer: req.file.processedBuffer,
        mimetype: req.file.processedMimetype,
        secureFilename: req.file.secureFilename,
        originalname: req.file.originalname,
    } : null;

    if (!profilePictureLocalPath && !profilePictureFile) {
        throw new apiError(400, "Profile picture is required");
    }
    logger.log('📁 Profile picture input detected');

    // --------------------------------------------------
    // STEP 1: Get current user to check if old picture exists
    // --------------------------------------------------
    const currentUser = await User.findById(userId);
    if (!currentUser) {
        throw new apiError(404, "User not found");
    }

    // --------------------------------------------------
    // STEP 2: Delete old profile picture from Cloudinary
    // --------------------------------------------------
    if (currentUser.profilePicturePublicId || currentUser.profilePicture) {
        const deleteSuccess = currentUser.profilePicturePublicId
            ? await deleteFromCloudinaryByPublicId(currentUser.profilePicturePublicId)
            : await deleteFromCloudinary(currentUser.profilePicture);
        if (!deleteSuccess) {
            logger.warn("⚠️ Warning: Could not delete old profile picture from Cloudinary");
            // Continue anyway, as the upload might still succeed
        }
    }

    // --------------------------------------------------
    // STEP 3: Upload new profile picture to Cloudinary
    // --------------------------------------------------
    logger.log('📤 Uploading profile picture to Cloudinary');
    const profilePicture = profilePictureFile
        ? await uploadOnCloudinary(profilePictureFile)
        : await uploadOnCloudinary(profilePictureLocalPath);
    logger.log('📤 Cloudinary upload result', { url: profilePicture?.url, public_id: profilePicture?.public_id });

    if (!profilePicture?.url) {
        throw new apiError(500, "Error uploading profile picture to Cloudinary");
    }

    // --------------------------------------------------
    // STEP 4: Update user with new profile picture URL
    // --------------------------------------------------
    const user = await User.findByIdAndUpdate(
        userId,
        { $set: { profilePicture: profilePicture.url, profilePicturePublicId: profilePicture.public_id || null } },
        { new: true }
    ).select(SAFE_USER_SELECT);

    // --------------------------------------------------
    // STEP 5: Success response
    // --------------------------------------------------
    return res.status(200).json(
        new apiResponse(
            200,
            { user: safeUser(user) },
            "Profile picture updated successfully"
        )
    );
});

const discoverUsers = asyncHandler(async (req, res) => {
    const currentUserId = req.user?._id;
    const query = String(req.query?.q || "").trim();
    const limitParam = Number.parseInt(req.query?.limit, 10);
    const limit = Number.isFinite(limitParam)
        ? Math.min(Math.max(limitParam, 1), 50)
        : 50;

    const searchFilter = query
        ? {
            $or: [
                { fullName: { $regex: query, $options: "i" } },
                { username: { $regex: query, $options: "i" } },
                { email: { $regex: query, $options: "i" } },
            ],
        }
        : {};

    const users = await User.find({
        _id: { $ne: currentUserId },
        ...searchFilter,
    })
        .select("fullName username email profilePicture bio createdAt")
        .sort({ fullName: 1, username: 1 })
        .limit(limit)
        .lean();

    return res.status(200).json(
        new apiResponse(200, users, "Users fetched successfully")
    );
});

const getNotificationPreferences = asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
        throw new apiError(401, 'Unauthorized request');
    }

    const user = await User.findById(userId)
        .select('notificationPreferences')
        .lean();

    if (!user) {
        throw new apiError(404, 'User not found');
    }

    const preferences = {
        messageNotificationsEnabled: user.notificationPreferences?.messageNotificationsEnabled !== false,
    };

    return res.status(200).json(
        new apiResponse(
            200,
            preferences,
            'Notification preferences fetched successfully'
        )
    );
});

const updateNotificationPreferences = asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
        throw new apiError(401, 'Unauthorized request');
    }

    const { messageNotificationsEnabled } = normalizeNotificationPreferencesPayload(req.body);

    if (typeof messageNotificationsEnabled !== 'boolean') {
        throw new apiError(400, 'messageNotificationsEnabled must be a boolean');
    }

    const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
            $set: {
                'notificationPreferences.messageNotificationsEnabled': messageNotificationsEnabled,
            },
        },
        {
            new: true,
            runValidators: true,
        }
    ).select('notificationPreferences');

    if (!updatedUser) {
        throw new apiError(404, 'User not found');
    }

    const preferences = {
        messageNotificationsEnabled: updatedUser.notificationPreferences?.messageNotificationsEnabled !== false,
    };

    emitToUserRoom(String(userId), 'notification-preferences-updated', preferences);

    return res.status(200).json(
        new apiResponse(
            200,
            preferences,
            'Notification preferences updated successfully'
        )
    );
});

// ===================================================
// FORGOT PASSWORD CONTROLLER
// ===================================================
/**
 * POST /api/v1/user/forgot-password
 * Request body: { email }
 * Response: Generic success message (security best practice)
 */
const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;

    // Always return the same generic success response for security
    // and to avoid noisy client-side network errors for user-input mistakes.
    const genericResponse = (otpSent = false) => res.status(200).json(
        new apiResponse(
            200,
            { otpSent },
            OTP_RESPONSE_MESSAGES.genericPending
        )
    );

    // Validate email input
    if (!email || typeof email !== 'string' || !email.trim()) {
        return genericResponse(false);
    }

    const normalizedEmail = email.trim().toLowerCase();

    const emailError = getEmailValidationError(normalizedEmail);
    if (emailError) {
        return genericResponse(false);
    }

    // Block banned email for forgot-password requests (keep generic response)
    if (isBannedEmail(normalizedEmail)) {
        return genericResponse(false);
    }

    // Find the real user account by email
    const user = await User.findOne({ email: normalizedEmail });

    // If user not found, return generic response (do not reveal existence)
    if (!user) {
        return genericResponse(false);
    }

    const authProviders = Array.isArray(user.authProviders) && user.authProviders.length
        ? user.authProviders
        : (user.authProvider ? [user.authProvider] : []);
    const hasLocalLogin = authProviders.includes('local') || !!user.password;

    // Google-only accounts cannot use password reset
    if (!hasLocalLogin) {
        return genericResponse(false);
    }

    if (isBlockActive(user.resetPasswordBlockedUntil)) {
        return genericResponse(false);
    }

    // Only for users with a password: generate and save OTP, then send email
    const otp = generateOTP();
    const hashedOTP = hashOTP(otp);

    // Set OTP expiry to 10 minutes from now
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // Update user with OTP
    user.resetPasswordOTP = hashedOTP;
    user.resetPasswordOTPExpiry = otpExpiry;
    user.resetPasswordAttempts = 0;
    user.resetPasswordBlockedUntil = null;
    user.resetPasswordOtpResendAttempts = 0;
    user.resetPasswordOtpResendBlockedUntil = null;

    await user.save({ validateBeforeSave: false });

    try {
        // Send OTP via email
        await sendEmailOTP(user.email, otp);
    } catch (error) {
        // Clear OTP if email sending fails
        user.resetPasswordOTP = null;
        user.resetPasswordOTPExpiry = null;
        await user.save({ validateBeforeSave: false });
        throw new apiError(500, 'Failed to send password reset email. Please try again later.');
    }

    return genericResponse(true);
});

// ===================================================
// RESET PASSWORD CONTROLLER
// ===================================================
/**
 * POST /api/v1/user/reset-password
 * Request body: { email, otp, newPassword, confirmPassword }
 * Response: Success/Error message
 */
const resetPassword = asyncHandler(async (req, res) => {
    const { email, otp, newPassword, confirmPassword } = req.body;

    // Validate inputs
    if (!email || !otp || !newPassword || !confirmPassword) {
        throw new apiError(400, 'Email, OTP, and new password are required');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const otpString = String(otp).trim();
    const newPasswordString = String(newPassword).trim();
    const confirmPasswordString = String(confirmPassword).trim();

    const emailError = getEmailValidationError(normalizedEmail);
    if (emailError) {
        throw new apiError(400, emailError);
    }

    // Block explicitly banned addresses
    if (isBannedEmail(normalizedEmail)) {
        throw new apiError(400, 'This email address is not allowed for security reasons');
    }

    if (newPasswordString.length < FIELD_LIMITS.password.min || newPasswordString.length > FIELD_LIMITS.password.max) {
        throw new apiError(
            400,
            `Password must be between ${FIELD_LIMITS.password.min} and ${FIELD_LIMITS.password.max} characters`
        );
    }

    if (!PASSWORD_REGEX.test(newPasswordString)) {
        throw new apiError(400, 'Password must include uppercase, lowercase, number, and special character');
    }

    if (newPasswordString !== confirmPasswordString) {
        throw new apiError(400, 'Password and confirm password do not match');
    }

    // Find user
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
        throw new apiError(404, 'User not found');
    }

    // If user has no password (Google-only account), block password reset
    if (!user.password) {
        throw new apiError(400, 'Password reset is not allowed for this account');
    }

    // Atomic consume: match hashed OTP and expiry on the user document and clear it in the same operation
    const hashedOTP = hashOTP(otpString);
    const now = new Date();

    const matched = await User.findOneAndUpdate(
        {
            email: normalizedEmail,
            resetPasswordOTP: hashedOTP,
            resetPasswordOTPExpiry: { $gt: now },
        },
        {
            $set: {
                resetPasswordOTP: null,
                resetPasswordOTPExpiry: null,
                resetPasswordAttempts: 0,
                resetPasswordBlockedUntil: null,
            },
        },
        { new: false }
    );

    if (!matched) {
        // No atomic match: determine reason without leaking OTPs
        const fresh = await User.findOne({ email: normalizedEmail });
        if (!fresh || !fresh.resetPasswordOTP || !fresh.resetPasswordOTPExpiry) {
            return res.status(200).json({ success: false, status: 'error', message: 'No password reset request found. Please request a new OTP.', data: null });
        }

        if (isBlockActive(fresh.resetPasswordBlockedUntil)) {
            const minutesRemaining = getBlockedMinutesRemaining(fresh.resetPasswordBlockedUntil);
            return res.status(200).json({ success: false, status: 'rate_limited', message: `Too many invalid OTP attempts. Please try again after ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.`, data: { attemptsRemaining: 0 } });
        }

        if (new Date() > fresh.resetPasswordOTPExpiry) {
            await User.findByIdAndUpdate(fresh._id, { $set: { resetPasswordOTP: null, resetPasswordOTPExpiry: null, resetPasswordAttempts: 0, resetPasswordBlockedUntil: null } });
            return res.status(200).json({ success: false, status: 'error', message: 'OTP has expired. Please request a new OTP.', data: null });
        }

        // Increment attempts
        const updated = await User.findByIdAndUpdate(fresh._id, { $inc: { resetPasswordAttempts: 1 } }, { new: true });
        const remainingAttempts = Math.max(0, MAX_RESET_PASSWORD_OTP_ATTEMPTS - (updated.resetPasswordAttempts || 0));
        if (remainingAttempts <= 0) {
            await User.findByIdAndUpdate(fresh._id, { $set: { resetPasswordBlockedUntil: getValidationBlockedUntil() } });
            return res.status(200).json({ success: false, status: 'rate_limited', message: `Maximum password reset attempts exceeded. Please try again after ${OTP_VALIDATION_BLOCK_MINUTES} minutes.`, data: { attemptsRemaining: 0 } });
        }

        return res.status(200).json({ success: false, status: 'error', message: `Invalid OTP. You have ${remainingAttempts} attempt${remainingAttempts > 1 ? 's' : ''} remaining.`, data: { attemptsRemaining: remainingAttempts } });
    }

    // Matched: proceed to update password using the matched document
    await User.findByIdAndUpdate(matched._id, { $set: { password: newPasswordString, resetPasswordOTP: null, resetPasswordOTPExpiry: null, resetPasswordAttempts: 0, resetPasswordBlockedUntil: null, resetPasswordOtpResendAttempts: 0, resetPasswordOtpResendBlockedUntil: null } });

    return res.status(200).json(new apiResponse(200, null, 'Password reset successfully. Please log in with your new password.'));
});

// ===================================================
// RESEND OTP CONTROLLER
// ===================================================
/**
 * POST /api/v1/user/resend-otp
 * Request body: { email }
 * Response: Generic success message
 */
const resendOTP = asyncHandler(async (req, res) => {
    const { email } = req.body;

    // Validate email input
    if (!email || typeof email !== 'string' || !email.trim()) {
        throw new apiError(400, 'Email is required');
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
        throw new apiError(400, 'Please provide a valid email address');
    }

    const pendingRegistration = await PendingRegistration.findOne({ email: normalizedEmail });
    const user = pendingRegistration ? null : await User.findOne({ email: normalizedEmail });

    // Always return generic success message for security
    if (!pendingRegistration && !user) {
        return res.status(200).json(
            new apiResponse(
                200,
                null,
                'If an account with this email exists, a new OTP has been sent',
                'pending'
            )
        );
    }

    if (pendingRegistration) {
        if (!pendingRegistration.emailVerificationOTPExpiry) {
            return res.status(200).json(
                new apiResponse(
                    200,
                    null,
                    'If an account with this email exists, a new OTP has been sent',
                    'pending'
                )
            );
        }

        if (isBlockActive(pendingRegistration.emailVerificationBlockedUntil)) {
            const minutesRemaining = getBlockedMinutesRemaining(pendingRegistration.emailVerificationBlockedUntil);
            return res.status(200).json(
                new apiResponse(
                    200,
                    null,
                    `Too many invalid OTP attempts. Please try again after ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.`,
                    'rate_limited'
                )
            );
        }

        if (isPendingRegistrationExpired(pendingRegistration)) {
            return res.status(200).json(
                new apiResponse(
                    200,
                    null,
                    'If an account with this email exists, a new OTP has been sent',
                    'pending'
                )
            );
        }

        if ((pendingRegistration.otpResendAttempts || 0) >= MAX_SIGNUP_OTP_RESEND_ATTEMPTS) {
            const blockedUntil = pendingRegistration.otpResendBlockedUntil
                ? new Date(pendingRegistration.otpResendBlockedUntil).getTime()
                : 0;

            if (blockedUntil > Date.now()) {
                const remainingMinutes = Math.max(1, Math.ceil((blockedUntil - Date.now()) / (1000 * 60)));
                return res.status(200).json({
                    success: false,
                    status: 'rate_limited',
                    message: `Too many OTP resend attempts. Please try again after ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}.`,
                    data: {
                        blockedUntil: pendingRegistration.otpResendBlockedUntil,
                        resendAttempts: pendingRegistration.otpResendAttempts,
                    },
                });
            }

            pendingRegistration.otpResendAttempts = 0;
            pendingRegistration.otpResendBlockedUntil = null;
        }

        const cooldownRemaining = getSignupCooldownSecondsRemaining(pendingRegistration);
        if (cooldownRemaining > 0) {
            return res.status(200).json({
                success: false,
                status: 'rate_limited',
                message: `Please wait ${cooldownRemaining}s before requesting another OTP.`,
                data: {
                    cooldownRemaining,
                },
            });
        }

        const otp = generateOTP();
        const hashedOTP = hashOTP(otp);
        const otpExpiry = getOtpExpiryDate();

        pendingRegistration.emailVerificationOTP = hashedOTP;
        pendingRegistration.emailVerificationOTPExpiry = otpExpiry;
        pendingRegistration.emailVerificationAttempts = 0;
        pendingRegistration.otpResendAttempts = (pendingRegistration.otpResendAttempts || 0) + 1;
        if (pendingRegistration.otpResendAttempts >= MAX_SIGNUP_OTP_RESEND_ATTEMPTS) {
            pendingRegistration.otpResendBlockedUntil = new Date(Date.now() + SIGNUP_OTP_RESEND_BLOCK_HOURS * 60 * 60 * 1000);
        }
        pendingRegistration.otpResendAvailableAt = getNextResendAvailableAt();

        await pendingRegistration.save({ validateBeforeSave: false });

        logOtpResendState('Signup OTP resend incremented', {
            email: pendingRegistration.email,
            resendAttempts: pendingRegistration.otpResendAttempts,
            blockedUntil: pendingRegistration.otpResendBlockedUntil,
        });

        const emailDispatch = await sendVerificationEmailWithBudget({
            email: pendingRegistration.email,
            otp,
            context: 'resend-signup-otp',
        });

        if (emailDispatch.status === 'sent') {
            logger.log('✅ Resend OTP email sent successfully');

            return res.status(200).json(
                new apiResponse(
                    200,
                    {
                        email: pendingRegistration.email,
                        otpResent: true,
                        emailSent: true,
                        deliveryStatus: 'sent',
                    },
                    OTP_RESPONSE_MESSAGES.sent
                )
            );
        }

        if (emailDispatch.status === 'sandbox_fallback') {
            logger.warn('⚠️ Signup resend generated an OTP but Resend sandbox blocked delivery', {
                email: pendingRegistration.email,
                resendAttempts: pendingRegistration.otpResendAttempts,
            });

            return res.status(200).json(
                new apiResponse(
                    200,
                    {
                        email: pendingRegistration.email,
                        otpResent: true,
                        emailSent: false,
                        verificationPending: true,
                        deliveryStatus: 'sandbox_blocked',
                    },
                    OTP_RESPONSE_MESSAGES.sandboxBlocked
                )
            );
        }

        if (emailDispatch.status === 'queued') {
            logger.warn('⏳ Resend OTP dispatch queued due to email delivery latency', {
                email: pendingRegistration.email,
                responseTimeoutMs: EMAIL_DELIVERY_RESPONSE_TIMEOUT_MS,
            });

            return res.status(200).json(
                new apiResponse(
                    200,
                    {
                        email: pendingRegistration.email,
                        otpResent: true,
                        verificationPending: true,
                        emailSent: false,
                        deliveryStatus: 'queued',
                    },
                    OTP_RESPONSE_MESSAGES.queued
                )
            );
        }

        {
            const error = emailDispatch.error;
            logger.error('❌ Resend OTP email could not be sent:', {
                message: error?.message,
                code: error?.code,
            });

            return res.status(200).json(
                new apiResponse(
                    200,
                    {
                        email: pendingRegistration.email,
                        verificationPending: true,
                        emailSent: false,
                        deliveryStatus: 'failed',
                    },
                    OTP_RESPONSE_MESSAGES.sandboxBlocked
                )
            );
        }
    } else {
        // Password reset flow: keep existing behavior for reset-password OTP resend
        if (!user.resetPasswordOTPExpiry) {
            return res.status(200).json(
                new apiResponse(
                    200,
                    null,
                    'If an account with this email exists, a new OTP has been sent'
                )
            );
        }

        if (isBlockActive(user.resetPasswordBlockedUntil)) {
            const minutesRemaining = getBlockedMinutesRemaining(user.resetPasswordBlockedUntil);
            return res.status(200).json({
                success: false,
                status: 'rate_limited',
                message: `Too many invalid OTP attempts. Please try again after ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.`,
                data: { attemptsRemaining: 0 },
            });
        }

        if ((user.resetPasswordOtpResendAttempts || 0) >= MAX_RESET_PASSWORD_OTP_RESEND_ATTEMPTS) {
            const blockedUntil = user.resetPasswordOtpResendBlockedUntil
                ? new Date(user.resetPasswordOtpResendBlockedUntil).getTime()
                : 0;

            if (blockedUntil > Date.now()) {
                const remainingMinutes = Math.max(1, Math.ceil((blockedUntil - Date.now()) / (1000 * 60)));
                return res.status(200).json({
                    success: false,
                    status: 'rate_limited',
                    message: `Too many password reset OTP resends. Please try again after ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}.`,
                    data: {
                        blockedUntil: user.resetPasswordOtpResendBlockedUntil,
                        resendAttempts: user.resetPasswordOtpResendAttempts,
                    },
                });
            }

            user.resetPasswordOtpResendAttempts = 0;
            user.resetPasswordOtpResendBlockedUntil = null;
        }

        const otp = generateOTP();
        const hashedOTP = hashOTP(otp);
        const otpExpiry = getOtpExpiryDate();

        user.resetPasswordOTP = hashedOTP;
        user.resetPasswordOTPExpiry = otpExpiry;
        user.resetPasswordAttempts = 0;
        user.resetPasswordOtpResendAttempts = (user.resetPasswordOtpResendAttempts || 0) + 1;
        if (user.resetPasswordOtpResendAttempts >= MAX_RESET_PASSWORD_OTP_RESEND_ATTEMPTS) {
            user.resetPasswordOtpResendBlockedUntil = new Date(Date.now() + RESET_PASSWORD_OTP_RESEND_BLOCK_HOURS * 60 * 60 * 1000);
        }

        await user.save({ validateBeforeSave: false });

        logOtpResendState('Password-reset OTP resend incremented', {
            userId: String(user._id),
            email: user.email,
            resendAttempts: user.resetPasswordOtpResendAttempts,
            blockedUntil: user.resetPasswordOtpResendBlockedUntil,
        });

        try {
            const emailResult = await sendEmailOTP(user.email, otp);

            if (emailResult?.sandboxFallback) {
                logger.warn('⚠️ Password-reset OTP generated but Resend sandbox blocked delivery', {
                    email: user.email,
                    resendAttempts: user.resetPasswordOtpResendAttempts,
                });

                return res.status(200).json({
                    success: true,
                    status: 'pending',
                    message: OTP_RESPONSE_MESSAGES.sandboxBlocked,
                    data: { otpSent: false, verificationPending: true },
                });
            }
        } catch (error) {
            user.resetPasswordOTP = null;
            user.resetPasswordOTPExpiry = null;
            user.resetPasswordOtpResendAttempts = 0;
            user.resetPasswordOtpResendBlockedUntil = null;
            await user.save({ validateBeforeSave: false });

            throw new apiError(500, 'Failed to send OTP email. Please try again later.');
        }
    }

    return res.status(200).json(
        new apiResponse(
            200,
            null,
            'If an account with this email exists, a new OTP has been sent',
            'pending'
        )
    );
});

const getCurrentUser = asyncHandler(async (req, res) => {
    return res.status(200).json(
        new apiResponse(200, safeUser(req.user), "Current user fetched successfully")
    );
});



const googleAuthCallback = asyncHandler(async (req, res) => {
    try {
        if (!req.user) {
            throw new apiError(401, "Authentication failed. Please try again.");
        }

        const user = req.user;
        logger.log(`✅ Google Auth Success for user: ${user.email}`);

        // Generate tokens
        const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

        const cookieOptions = getCookieOptions();

        // Set cookies with explicit max-age for reliability
        res.cookie("accessToken", accessToken, {
            ...cookieOptions,
            maxAge: 15 * 60 * 1000, // 15 minutes
        });
        res.cookie("refreshToken", refreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        logger.log(`✅ Tokens generated and cookies set for Google OAuth user: ${user.email}`);

        // Redirect to OAuth callback bridge so frontend can finalize auth before route guards run.
        const redirectUrl = `${getFrontendOrigin()}/oauth/callback`;
        return res.redirect(redirectUrl);

    } catch (error) {
        logger.error('❌ Google Auth Callback Error:', error.message);
        const errorMessage = error.message || 'Authentication failed. Please try again.';
        const errorUrl = `${getFrontendOrigin()}/login?auth=failed&error=${encodeURIComponent(errorMessage)}`;
        return res.redirect(errorUrl);
    }
});

// ===================================================
// CHECK EMAIL EXISTENCE CONTROLLER
// ===================================================
const checkEmailExists = asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
        throw new apiError(400, 'Email is required');
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Validate email format first
    const emailError = getEmailValidationError(normalizedEmail);
    if (emailError) {
        throw new apiError(400, emailError);
    }

    // Availability checks should be based on final users only.
    const existingUser = await User.findOne({ email: normalizedEmail });
    const available = !existingUser;

    return res.status(200).json(
        new apiResponse(
            200,
            { available, exists: !available },
            'Email availability check completed'
        )
    );
});

// ===================================================
// CHECK USERNAME EXISTENCE CONTROLLER
// ===================================================
const checkUsernameExists = asyncHandler(async (req, res) => {
    const { username } = req.body;

    if (getUsernameValidationError(username)) {
        throw new apiError(400, 'Invalid username');
    }

    const normalizedUsername = normalizeUsername(username);

    const usernameError = getUsernameValidationError(normalizedUsername);
    if (usernameError) {
        throw new apiError(400, usernameError);
    }

    const existingUser = await User.findOne({ username: normalizedUsername });
    const available = !existingUser;

    return res.status(200).json(
        new apiResponse(
            200,
            { available, exists: !available },
            'Username availability check completed'
        )
    );
});

// ===================================================
// VERIFY EMAIL OTP CONTROLLER
// ===================================================
/**
 * POST /api/v1/user/verify-email
 * Request body: { email, otp }
 * Response: Success/Error message
 */
const verifyEmailOTP = asyncHandler(async (req, res) => {
    const { email, otp } = req.body;

    // Validate inputs
    if (!email || !otp) {
        throw new apiError(400, 'Email and OTP are required');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const otpString = String(otp).trim();

    // Validate email format
    const emailError = getEmailValidationError(normalizedEmail);
    if (emailError) {
        throw new apiError(400, emailError);
    }

    // For single-use and atomic verification we match the hashed OTP directly
    const hashedOTP = hashOTP(otpString);

    // Try to atomically consume the OTP and clear it if matched and not expired
    const now = new Date();
    const pending = await PendingRegistration.findOneAndUpdate(
        {
            email: normalizedEmail,
            emailVerificationOTP: hashedOTP,
            emailVerificationOTPExpiry: { $gt: now },
        },
        {
            $set: {
                emailVerificationOTP: null,
                emailVerificationOTPExpiry: null,
                emailVerificationAttempts: 0,
                emailVerificationBlockedUntil: null,
            },
        },
        { new: false }
    );

    // If we successfully consumed the OTP, proceed to create the user atomically from the pending doc
    if (pending) {
        // Check for existing user collisions (race-safe)
        const existingUser = await User.findOne({
            $or: [
                { email: normalizedEmail },
                { username: pending.username },
            ],
        });

        if (existingUser) {
            // Remove the pending record and respond safely
            await PendingRegistration.findByIdAndDelete(pending._id);
            if (existingUser.email === normalizedEmail) {
                return res.status(200).json({ success: false, status: 'error', message: 'Email already registered. Please login.', data: null });
            }

            return res.status(200).json({ success: false, status: 'error', message: 'Username already exists', data: null });
        }

        let createdUser;
        try {
            createdUser = await User.create({
                fullName: pending.fullName,
                username: pending.username,
                email: pending.email,
                password: pending.password,
                authProvider: 'local',
                authProviders: ['local'],
                isVerified: true,
            });
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                await PendingRegistration.findByIdAndDelete(pending._id);
                throwDuplicateFieldError(error, normalizedEmail, pending.username);
            }

            throw error;
        }

        await PendingRegistration.findByIdAndDelete(pending._id);

        logger.log(`✅ Email verified and user created: ${createdUser.email}`);

        return res.status(200).json(new apiResponse(200, {
            email: createdUser.email,
            isVerified: true,
            user: { _id: createdUser._id, fullName: createdUser.fullName, username: createdUser.username, email: createdUser.email },
        }, 'Email verified successfully. Your account has been created.'));
    }

    // If atomic consume failed, provide safe error handling and increment attempts where appropriate
    const pendingRegistration = await PendingRegistration.findOne({ email: normalizedEmail });
    if (!pendingRegistration) {
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(200).json({ success: false, status: 'error', message: 'Email already registered. Please login.', data: null });
        }

        return res.status(200).json({ success: false, status: 'error', message: 'No pending registration found for this email. Please sign up again.', data: null });
    }

    // If OTP missing or expired, remove pending and respond generically
    if (!pendingRegistration.emailVerificationOTP || !pendingRegistration.emailVerificationOTPExpiry || new Date() > pendingRegistration.emailVerificationOTPExpiry) {
        await PendingRegistration.findByIdAndDelete(pendingRegistration._id);
        return res.status(200).json({ success: false, status: 'error', message: 'OTP has expired or is invalid. Please request a new OTP.', data: null });
    }

    if (isBlockActive(pendingRegistration.emailVerificationBlockedUntil)) {
        const minutesRemaining = getBlockedMinutesRemaining(pendingRegistration.emailVerificationBlockedUntil);
        return res.status(200).json({ success: false, status: 'rate_limited', message: `Too many invalid OTP attempts. Please try again after ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.`, data: { attemptsRemaining: 0 } });
    }

    // Increment attempts atomically and enforce blocking if exceeded
    const updated = await PendingRegistration.findByIdAndUpdate(
        pendingRegistration._id,
        { $inc: { emailVerificationAttempts: 1 } },
        { new: true }
    );

    const remainingAttempts = Math.max(0, MAX_SIGNUP_OTP_ATTEMPTS - (updated.emailVerificationAttempts || 0));
    if (remainingAttempts <= 0) {
        await PendingRegistration.findByIdAndUpdate(pendingRegistration._id, { $set: { emailVerificationBlockedUntil: getValidationBlockedUntil() } });
        return res.status(200).json({ success: false, status: 'rate_limited', message: `Maximum verification attempts exceeded. Please try again after ${OTP_VALIDATION_BLOCK_MINUTES} minutes.`, data: { attemptsRemaining: 0 } });
    }

    return res.status(200).json({ success: false, status: 'error', message: `Invalid OTP. ${remainingAttempts} attempt${remainingAttempts > 1 ? 's' : ''} remaining.`, data: { attemptsRemaining: remainingAttempts } });
});

/**
 * POST /api/v1/user/verify-email-change
 * Body: { otp }
 * Protected: requires authentication
 */
const verifyEmailChange = asyncHandler(async (req, res) => {
    const { otp } = req.body;

    if (!otp || typeof otp !== 'string' || !otp.trim()) {
        return res.status(200).json({
            success: false,
            status: 'error',
            message: 'OTP is required',
            data: null,
        });
    }

    const userId = req.user?._id;
    if (!userId) throw new apiError(401, 'Unauthorized request');

    const user = await User.findById(userId);
    if (!user) throw new apiError(404, 'User not found');

    if (!user.pendingEmail) {
        return res.status(200).json({
            success: false,
            status: 'error',
            message: 'No email change request found',
            data: null,
        });
    }

    if (!user.emailOtp || !user.emailOtpExpiry) {
        return res.status(200).json({ success: false, status: 'error', message: 'OTP expired', data: null });
    }

    // Atomic consume of email change OTP
    const hashedOTP = hashOTP(String(otp).trim());
    const now = new Date();

    const matchedUser = await User.findOneAndUpdate(
        { _id: user._id, emailOtp: hashedOTP, emailOtpExpiry: { $gt: now } },
        {
            $set: {
                emailOtp: null,
                emailOtpExpiry: null,
                emailVerificationAttempts: 0,
                emailVerificationBlockedUntil: null,
            },
        },
        { new: false }
    );

    if (!matchedUser) {
        const fresh = await User.findById(user._id);
        if (!fresh || !fresh.emailOtp || !fresh.emailOtpExpiry) {
            // Clear pending fields if expired
            if (fresh) {
                await User.findByIdAndUpdate(fresh._id, { $set: { pendingEmail: null, emailOtp: null, emailOtpExpiry: null, emailOtpResendAvailableAt: null, emailVerificationAttempts: 0, emailVerificationBlockedUntil: null } });
            }
            return res.status(200).json({ success: false, status: 'error', message: 'OTP expired', data: null });
        }

        if (isBlockActive(fresh.emailVerificationBlockedUntil)) {
            const minutesRemaining = getBlockedMinutesRemaining(fresh.emailVerificationBlockedUntil);
            return res.status(200).json({ success: false, status: 'rate_limited', message: `Too many invalid OTP attempts. Please try again after ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.`, data: { attemptsRemaining: 0 } });
        }

        // Increment attempts
        const updated = await User.findByIdAndUpdate(fresh._id, { $inc: { emailVerificationAttempts: 1 } }, { new: true });
        const remaining = Math.max(0, MAX_EMAIL_CHANGE_OTP_ATTEMPTS - (updated.emailVerificationAttempts || 0));
        if (remaining <= 0) {
            await User.findByIdAndUpdate(fresh._id, { $set: { emailVerificationBlockedUntil: getValidationBlockedUntil() } });
            return res.status(200).json({ success: false, status: 'rate_limited', message: `Too many invalid OTP attempts. Please try again after ${OTP_VALIDATION_BLOCK_MINUTES} minutes.`, data: { attemptsRemaining: 0 } });
        }

        return res.status(200).json({ success: false, status: 'error', message: `Invalid OTP. ${remaining} attempts remaining.`, data: { attemptsRemaining: remaining } });
    }

    // OTP valid — finalize email change
    const newEmail = matchedUser.pendingEmail;

    // Ensure newEmail isn't used by another account (race check)
    const existingEmail = await User.findOne({ email: newEmail, _id: { $ne: user._id } });
    if (existingEmail) {
        // Clear pending fields
        user.pendingEmail = null;
        user.emailOtp = null;
        user.emailOtpExpiry = null;
        user.emailOtpResendAvailableAt = null;
        user.emailOtpResendAttempts = 0;
        user.emailOtpResendBlockedUntil = null;
        user.emailVerificationAttempts = 0;
        user.pendingFullName = null;
        user.pendingUsername = null;
        user.pendingBio = null;
        await user.save({ validateBeforeSave: false });

        throw new apiError(409, 'This email is already registered. Please use a different email.');
    }

    // Update email
    user.email = newEmail;
    user.isVerified = true;

    // Apply pending profile changes
    if (user.pendingFullName) {
        user.fullName = user.pendingFullName;
    }
    if (user.pendingUsername) {
        user.username = user.pendingUsername;
    }
    if (user.pendingBio) {
        user.bio = user.pendingBio;
    }

    // Clear all pending fields
    user.pendingEmail = null;
    user.emailOtp = null;
    user.emailOtpExpiry = null;
    user.emailOtpResendAvailableAt = null;
    user.emailOtpResendAttempts = 0;
    user.emailOtpResendBlockedUntil = null;
    user.emailVerificationAttempts = 0;
    user.emailVerificationBlockedUntil = null;
    user.pendingFullName = null;
    user.pendingUsername = null;
    user.pendingBio = null;

    await user.save();

    return res.status(200).json(
        new apiResponse(
            200,
            null,
            'Email and profile updated successfully',
            'verified'
        )
    );
});

/**
 * POST /api/v1/user/resend-email-change
 * Body: none (user must be authenticated)
 */
const resendEmailChange = asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId) throw new apiError(401, 'Unauthorized request');

    const user = await User.findById(userId);
    if (!user) throw new apiError(404, 'User not found');

    if (!user.pendingEmail) {
        return res.status(200).json(
            new apiResponse(200, null, OTP_RESPONSE_MESSAGES.genericPending, 'pending')
        );
    }

    if (isBlockActive(user.emailVerificationBlockedUntil)) {
        const minutesRemaining = getBlockedMinutesRemaining(user.emailVerificationBlockedUntil);
        return res.status(200).json(
            new apiResponse(
                200,
                null,
                `Too many invalid OTP attempts. Please try again after ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}.`,
                'rate_limited'
            )
        );
    }

    // Check if resend attempts exceeded
    if (user.emailOtpResendAttempts >= MAX_EMAIL_CHANGE_OTP_RESEND_ATTEMPTS) {
        if (user.emailOtpResendBlockedUntil && new Date() < user.emailOtpResendBlockedUntil) {
            const blockRemainingHours = Math.ceil((user.emailOtpResendBlockedUntil - new Date()) / (1000 * 60 * 60));
            return res.status(200).json(
                new apiResponse(
                    200,
                    null,
                    `Too many resend attempts. Please try again after ${blockRemainingHours} hour${blockRemainingHours > 1 ? 's' : ''}`,
                    'rate_limited'
                )
            );
        } else {
            // Reset attempts after block expires
            user.emailOtpResendAttempts = 0;
            user.emailOtpResendBlockedUntil = null;
        }
    }

    const cooldownRemaining = getEmailChangeCooldownSecondsRemaining(user);
    if (cooldownRemaining > 0) {
        throw new apiError(429, 'Too many requests. Please wait 30 seconds before retrying.');
    }

    // Generate new OTP
    const otp = generateOTP();
    const hashed = hashOTP(otp);
    const expiry = new Date(Date.now() + 10 * 60 * 1000);
    const resendAvailableAt = getNextEmailChangeResendAvailableAt();

    user.emailOtp = hashed;
    user.emailOtpExpiry = expiry;
    user.emailOtpResendAvailableAt = resendAvailableAt;
    user.emailVerificationAttempts = 0;
    user.emailOtpResendAttempts = (user.emailOtpResendAttempts || 0) + 1;

    // If this is the 5th resend, block future resends for 24 hours
    if (user.emailOtpResendAttempts >= MAX_EMAIL_CHANGE_OTP_RESEND_ATTEMPTS) {
        user.emailOtpResendBlockedUntil = new Date(Date.now() + EMAIL_CHANGE_OTP_RESEND_BLOCK_HOURS * 60 * 60 * 1000);
    }

    await user.save({ validateBeforeSave: false });

    logOtpResendState('Email-change OTP resend incremented', {
        userId: String(userId),
        email: user.pendingEmail,
        resendAttempts: user.emailOtpResendAttempts,
        blockedUntil: user.emailOtpResendBlockedUntil,
    });

    try {
        const result = await sendEmailVerification(user.pendingEmail, otp);

        if (result?.sandboxFallback) {
            logger.warn('⚠️ Email-change OTP generated but Resend sandbox blocked delivery', {
                email: user.pendingEmail,
                resendAttempts: user.emailOtpResendAttempts,
            });

            return res.status(200).json(
                new apiResponse(
                    200,
                    {
                        email: user.pendingEmail,
                        verificationPending: true,
                        emailSent: false,
                    },
                    OTP_RESPONSE_MESSAGES.sandboxBlocked
                )
            );
        }
    } catch (err) {
        logger.error('Failed to resend email-change verification email:', {
            message: err?.message,
            code: err?.code,
        });

        return res.status(200).json(
            new apiResponse(
                200,
                {
                    email: user.pendingEmail,
                    verificationPending: true,
                    emailSent: false,
                },
                OTP_RESPONSE_MESSAGES.sandboxBlocked
            )
        );
    }

    return res.status(200).json(
        new apiResponse(200, null, OTP_RESPONSE_MESSAGES.genericPending, 'pending')
    );
});

/**
 * ========================================
 * DATABASE MAINTENANCE ENDPOINTS (ADMIN)
 * ========================================
 */

/**
 * Check database indexes and duplicate records
 * GET /api/v1/user/admin/check-db-health
 * (Protected - Admin only in production)
 */
const checkDatabaseHealth = asyncHandler(async (req, res) => {
    const { fullDatabaseCleanup, checkForDuplicates, getUserIndexes } = await import('../utils/indexManager.js');

    try {
        logger.log('\n📊 Checking database health...\n');
        
        const indexes = await getUserIndexes();
        const duplicates = await checkForDuplicates();
        
        return res.status(200).json(
            new apiResponse(
                200,
                {
                    indexes: Object.keys(indexes),
                    duplicates,
                    status: 'Database health check complete'
                },
                'Database health checked successfully'
            )
        );
    } catch (error) {
        logger.error('❌ Database health check failed:', error.message);
        throw new apiError(500, `Database health check failed: ${error.message}`);
    }
});

/**
 * Rebuild database indexes
 * POST /api/v1/user/admin/rebuild-indexes
 * (Protected - Admin only in production)
 */
const rebuildDatabaseIndexes = asyncHandler(async (req, res) => {
    const { rebuildUniqueIndexes } = await import('../utils/indexManager.js');

    try {
        logger.log('\n🔄 Rebuilding database indexes...\n');
        
        const result = await rebuildUniqueIndexes();
        
        return res.status(200).json(
            new apiResponse(
                200,
                result,
                'Database indexes rebuilt successfully'
            )
        );
    } catch (error) {
        logger.error('❌ Index rebuild failed:', error.message);
        throw new apiError(500, `Index rebuild failed: ${error.message}`);
    }
});

/**
 * Remove duplicate users from database
 * POST /api/v1/user/admin/cleanup-duplicates
 * (Protected - Admin only in production)
 */
const cleanupDuplicateUsers = asyncHandler(async (req, res) => {
    const { removeDuplicates } = await import('../utils/indexManager.js');

    try {
        logger.log('\n🗑️  Cleaning up duplicate users...\n');
        
        const result = await removeDuplicates();
        
        return res.status(200).json(
            new apiResponse(
                200,
                result,
                'Duplicate users cleaned up successfully'
            )
        );
    } catch (error) {
        logger.error('❌ Cleanup failed:', error.message);
        throw new apiError(500, `Cleanup failed: ${error.message}`);
    }
});

/**
 * Full database cleanup and verification
 * POST /api/v1/user/admin/full-cleanup
 * (Protected - Admin only in production)
 */
const fullDatabaseMaintenance = asyncHandler(async (req, res) => {
    const { fullDatabaseCleanup } = await import('../utils/indexManager.js');

    try {
        logger.log('\n🚀 Starting full database maintenance...\n');
        
        const result = await fullDatabaseCleanup();
        
        return res.status(200).json(
            new apiResponse(
                200,
                result,
                'Full database maintenance completed successfully'
            )
        );
    } catch (error) {
        logger.error('❌ Full maintenance failed:', error.message);
        throw new apiError(500, `Full maintenance failed: ${error.message}`);
    }
});

export {
    registerUser,
    loginUser,
    logoutUser,
    deleteAccount,
    refreshAccessToken,
    updateUserProfile,
    updateProfilePicture,
    discoverUsers,
    getNotificationPreferences,
    updateNotificationPreferences,
    forgotPassword,
    resetPassword,
    resendOTP,
    getCurrentUser,
    googleAuthCallback,
    checkEmailExists,
    checkUsernameExists,
    verifyEmailOTP,
    verifyEmailChange,
    resendEmailChange,
    debugCookies,
    checkDatabaseHealth,
    rebuildDatabaseIndexes,
    cleanupDuplicateUsers,
    fullDatabaseMaintenance,
};

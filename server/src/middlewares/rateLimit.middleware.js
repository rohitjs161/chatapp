import rateLimit from "express-rate-limit";

// --------------------------------------------------
// HELPER — Create rate limiter with custom options
// --------------------------------------------------
const createRateLimiter = (windowMinutes, maxRequests, message) => {
    return rateLimit({
        windowMs: windowMinutes * 60 * 1000,
        max: maxRequests,
        message: {
            success: false,
            status: "rate_limited",
            statusCode: 429,
            message,
        },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res, next, options) => {
            res.status(429).json(options.message);
        },
    });
};

// Public routes
export const registerLimiter = createRateLimiter(
    60, 5,
    "Too many registration attempts. Please try again after 1 hour."
);

export const signupEmailVerifyLimiter = createRateLimiter(
    15, 5,
    "Too many signup email verification attempts. Please try again after 15 minutes."
);

export const signupEmailResendLimiter = createRateLimiter(
    15, 3,
    "Too many signup OTP resend requests. Please wait and try again."
);

export const loginLimiter = createRateLimiter(
    15, 10,
    "Too many login attempts. Please try again after 15 minutes."
);

export const refreshTokenLimiter = createRateLimiter(
    15, 20,
    "Too many token refresh attempts. Please try again later."
);

// User routes
export const profilePictureLimiter = createRateLimiter(
    60, 5,
    "Too many profile picture updates. Please try again after 1 hour."
);

export const updateProfileLimiter = createRateLimiter(
    15, 10,
    "Too many profile update attempts. Please try again after 15 minutes."
);

export const notificationPreferencesLimiter = createRateLimiter(
    1, 60,
    "Too many notification toggle attempts. Please wait a moment and try again."
);

// Conversation routes
export const conversationLimiter = createRateLimiter(
    1, 30,
    "Too many conversation requests. Please try again after 1 minute."
);

// Password reset (OTP) routes
export const forgotPasswordSendOtpLimiter = createRateLimiter(
    15, 5,
    "Too many password reset requests. Please try again after 15 minutes."
);

export const forgotPasswordVerifyOtpLimiter = createRateLimiter(
    15, 5,
    "Too many password reset attempts. Please try again after 15 minutes."
);

export const forgotPasswordResendOtpLimiter = createRateLimiter(
    15, 3,
    "Too many password reset OTP resend requests. Please wait and try again."
);

export const verifyEmailChangeLimiter = createRateLimiter(
    15, 5,
    "Too many profile email verification attempts. Please try again after 15 minutes."
);

export const resendEmailChangeLimiter = createRateLimiter(
    5, 3,
    "Too many profile email OTP resend requests. Please wait 5 minutes before trying again."
);

// Backward-compatible aliases used by existing imports in case other files still reference old names
export const forgotPasswordLimiter = forgotPasswordSendOtpLimiter;
export const resetPasswordLimiter = forgotPasswordVerifyOtpLimiter;
export const resendOTPLimiter = forgotPasswordResendOtpLimiter;

export const deleteAccountLimiter = createRateLimiter(
    15, 8,
    "Too many delete account verification attempts. Please try again after 15 minutes."
);

export const deleteConversationLimiter = createRateLimiter(
    15, 10,
    "Too many conversation deletions. Please try again after 15 minutes."
);

// Message routes
export const sendMessageLimiter = createRateLimiter(
    1, 30,
    "Too many messages sent. Please slow down."
);

export const editMessageLimiter = createRateLimiter(
    1, 30,
    "Too many message edits. Please slow down."
);

export const deleteMessageLimiter = createRateLimiter(
    15, 20,
    "Too many message deletions. Please try again after 15 minutes."
);

export const markAsReadLimiter = createRateLimiter(
    1, 120,
    "Too many read requests. Please slow down."
);

// General
export const generalLimiter = createRateLimiter(
    1, 100,
    "Too many requests. Please try again after 1 minute."
);
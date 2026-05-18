import { Router } from "express";
import passport from "passport";
import {
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
    checkDatabaseHealth,
    rebuildDatabaseIndexes,
    cleanupDuplicateUsers,
    fullDatabaseMaintenance,
} from "../controllers/user.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload, validateImageUpload } from "../middlewares/multer.middleware.js";
import {
    registerLimiter,
    signupEmailVerifyLimiter,
    signupEmailResendLimiter,
    loginLimiter,
    refreshTokenLimiter,
    profilePictureLimiter,
    updateProfileLimiter,
    notificationPreferencesLimiter,
    generalLimiter,
    forgotPasswordSendOtpLimiter,
    forgotPasswordVerifyOtpLimiter,
    forgotPasswordResendOtpLimiter,
    verifyEmailChangeLimiter,
    resendEmailChangeLimiter,
    deleteAccountLimiter,
} from "../middlewares/rateLimit.middleware.js";

const router = Router();

// Public routes
router.route("/register").post(registerLimiter, registerUser);
router.route("/login").post(loginLimiter, loginUser);
router.route("/verify-email").post(signupEmailVerifyLimiter, verifyEmailOTP);
router.route("/verify-email-change").post(verifyJWT, verifyEmailChangeLimiter, verifyEmailChange);
router.route("/check-email").post(generalLimiter, checkEmailExists);
router.route("/check-username").post(generalLimiter, checkUsernameExists);

// Google OAuth routes
router.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
router.get("/auth/google/callback", passport.authenticate("google", { session: false }), googleAuthCallback);

router.route("/refresh-token").post(refreshTokenLimiter, refreshAccessToken);
router.route("/forgot-password").post(forgotPasswordSendOtpLimiter, forgotPassword);
router.route("/reset-password").post(forgotPasswordVerifyOtpLimiter, resetPassword);
router.route("/resend-otp").post(forgotPasswordResendOtpLimiter, resendOTP);
router.route("/resend-signup-otp").post(signupEmailResendLimiter, resendOTP);
router.route("/resend-forgot-password-otp").post(forgotPasswordResendOtpLimiter, resendOTP);
router.route("/resend-email-change").post(verifyJWT, resendEmailChangeLimiter, resendEmailChange);
router.route("/me").get(verifyJWT, generalLimiter, getCurrentUser);

// Protected routes
router.route("/discover").get(verifyJWT, generalLimiter, discoverUsers);
router.route("/logout").post(verifyJWT, logoutUser);
router.delete("/delete-account", verifyJWT, deleteAccountLimiter, deleteAccount);
router.route("/update-profile").patch(
    verifyJWT,
    updateProfileLimiter,
    updateUserProfile
);
router.route("/profile-picture").patch(
    verifyJWT,
    profilePictureLimiter,
    upload.single("profilePicture"),
    validateImageUpload,
    updateProfilePicture
);
router.route('/notification-preferences')
    .get(verifyJWT, generalLimiter, getNotificationPreferences)
    .patch(verifyJWT, notificationPreferencesLimiter, updateNotificationPreferences);

/**
 * ========================================
 * ADMIN MAINTENANCE ROUTES
 * ========================================
 * NOTE: In production, add authentication middleware to verify admin role
 * For development, these are protected with general rate limiter only
 */
// Check database health
router.route('/admin/check-db-health').get(generalLimiter, checkDatabaseHealth);

// Rebuild indexes
router.route('/admin/rebuild-indexes').post(generalLimiter, rebuildDatabaseIndexes);

// Cleanup duplicates
router.route('/admin/cleanup-duplicates').post(generalLimiter, cleanupDuplicateUsers);

// Full database maintenance
router.route('/admin/full-cleanup').post(generalLimiter, fullDatabaseMaintenance);

export default router;
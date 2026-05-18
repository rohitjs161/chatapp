import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User } from '../models/user.model.js';
import { apiError } from '../utils/apiError.js';
import { logger } from "../utils/logger.js";

const sanitizeGoogleUsernameBase = (value = '') => {
    const normalized = String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, '')
        .replace(/\.{2,}/g, '.')
        .replace(/_{2,}/g, '_')
        .replace(/^[._]+|[._]+$/g, '');

    return normalized || 'user';
};

const generateUniqueGoogleUsername = async (email) => {
    const base = sanitizeGoogleUsernameBase(String(email || '').split('@')[0]).slice(0, 12) || 'user';

    for (let attempt = 0; attempt < 8; attempt += 1) {
        const suffix = attempt === 0
            ? ''
            : `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;

        const candidate = `${base}${suffix}`.slice(0, 20).replace(/[._]+$/g, '') || 'user';
        const existingUser = await User.findOne({ username: candidate });

        if (!existingUser) {
            return candidate;
        }
    }

    return `${base}${Math.random().toString(36).slice(2, 8)}`.slice(0, 20).replace(/[._]+$/g, '') || 'user';
};

/**
 * Configure Passport with Google OAuth strategy
 * Handles user lookup/creation and linking existing accounts
 */
const configurePassport = () => {
    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: process.env.GOOGLE_CALLBACK_URL,
            },
            async (accessToken, refreshToken, profile, done) => {
                try {
                    // Extract profile data
                    const email = profile.emails?.[0]?.value;
                    const name = profile.displayName;
                    const photo = profile.photos?.[0]?.value;
                    const googleId = profile.id;

                    // Validate email exists
                    if (!email) {
                        return done(new apiError(400, 'Email not provided by Google'));
                    }

                    // Check if user exists
                    let user = await User.findOne({ email });

                    if (user) {
                        // User exists - link Google account if not already linked
                        let modified = false;
                        if (!user.googleId) {
                            user.googleId = googleId;
                            modified = true;
                        }

                        // Keep Google photo in sync only when the user has not uploaded a custom image.
                        // Custom uploads store profilePicturePublicId and should never be overwritten by Google login.
                        const hasCustomUploadedProfilePicture = Boolean(user.profilePicturePublicId);
                        if (!hasCustomUploadedProfilePicture && photo && user.profilePicture !== photo) {
                            user.profilePicture = photo;
                            modified = true;
                        }

                        // Ensure authProviders includes 'google'
                        if (!Array.isArray(user.authProviders) || !user.authProviders.includes('google')) {
                            user.authProviders = Array.isArray(user.authProviders) ? user.authProviders : (user.authProvider ? [user.authProvider] : []);
                            if (!user.authProviders.includes('google')) user.authProviders.push('google');
                            modified = true;
                        }

                        // Keep backward-compatible authProvider string
                        if (user.authProvider !== 'google') {
                            user.authProvider = 'google';
                            modified = true;
                        }

                        if (!user.isVerified) {
                            user.isVerified = true;
                            modified = true;
                        }

                        if (modified) await user.save();
                        return done(null, user);
                    }

                    // User doesn't exist - create new user
                    const username = await generateUniqueGoogleUsername(email);


                    const newUser = new User({
                        fullName: name || email.split('@')[0],
                        username: username,
                        email: email,
                        googleId: googleId,
                        authProvider: 'google',
                        authProviders: ['google'],
                        isVerified: true,
                        profilePicture: photo || '',
                        // No password for Google users
                    });

                    await newUser.save();
                    return done(null, newUser);

                } catch (error) {
                    logger.error('Passport Google Strategy Error:', error);
                    return done(error);
                }
            }
        )
    );

    // Serialize user for session (minimal data)
    passport.serializeUser((user, done) => {
        done(null, user._id);
    });

    // Deserialize user from session
    passport.deserializeUser(async (id, done) => {
        try {
            const user = await User.findById(id);
            done(null, user);
        } catch (error) {
            done(error);
        }
    });
};

export default configurePassport;

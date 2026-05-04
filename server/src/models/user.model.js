import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import {
    getAboutValidationError,
    getFullNameValidationError,
    normalizeAboutText,
    normalizeFullName,
} from '../utils/validation.js';

const USERNAME_REGEX = /^[a-zA-Z0-9._]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new Schema({
    fullName: {
        type: String,
        required: true,
        set: (value) => normalizeFullName(value),
        validate: {
            validator: (value) => !getFullNameValidationError(value, { required: true, minLength: 2, maxLength: 50 }),
            message: ({ value }) => getFullNameValidationError(value, { required: true, minLength: 2, maxLength: 50 }) || 'Invalid full name',
        },
    },
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        minlength: 3,
        maxlength: 20,
        match: [USERNAME_REGEX, 'Username can only use letters, numbers, periods, and underscores'],
        validate: [
            {
                validator: (value) => !/^[._]|[._]$/.test(value),
                message: 'Username cannot start or end with a period or underscore',
            },
            {
                validator: (value) => !/\.\./.test(value),
                message: 'Username cannot contain consecutive periods',
            },
        ],
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        match: [EMAIL_REGEX, 'Please provide a valid email address'],
    },
    password: {
        type: String,
        required: function() {
            const providers = Array.isArray(this.authProviders) && this.authProviders.length ? this.authProviders : (this.authProvider ? [this.authProvider] : ['local']);
            return providers.includes('local');
        },
        trim: true,
        minlength: 8,
        maxlength: 128,
    },
    googleId: {
        type: String,
        trim: true,
    },
    authProvider: {
        type: String,
        enum: ['local', 'google'],
        default: 'local',
    },
    authProviders: {
        type: [String],
        default: ['local'],
    },
    isVerified: {
        type: Boolean,
        default: false,
    },
    profilePicture: {
        type: String,
        default: "",
    },
    profilePicturePublicId: {
        type: String,
        default: null,
    },
    bio: {
        type: String,
        default: "Hey there! I am using ChatApp.",
        set: (value) => normalizeAboutText(value),
        validate: {
            validator: (value) => !getAboutValidationError(value, { required: false, maxLength: 160 }),
            message: ({ value }) => getAboutValidationError(value, { required: false, maxLength: 160 }) || 'Invalid bio',
        },
    },
    notificationPreferences: {
        messageNotificationsEnabled: {
            type: Boolean,
            default: true,
        },
    },
    refreshToken: {
            type: String
    },
    resetPasswordOTP: {
        type: String,
        default: null,
    },
    resetPasswordOTPExpiry: {
        type: Date,
        default: null,
    },
    resetPasswordAttempts: {
        type: Number,
        default: 0,
    },
    resetPasswordOtpResendAttempts: {
        type: Number,
        default: 0,
    },
    resetPasswordOtpResendBlockedUntil: {
        type: Date,
        default: null,
    },
    deleteAccountOTP: {
        type: String,
        default: null,
    },
    deleteAccountOTPExpiry: {
        type: Date,
        default: null,
    },
    deleteAccountAttempts: {
        type: Number,
        default: 0,
    },
    deleteAccountOtpResendAttempts: {
        type: Number,
        default: 0,
    },
    deleteAccountOtpResendBlockedUntil: {
        type: Date,
        default: null,
    },
    
    emailVerificationOTP: {
        type: String,
        default: null,
    },
    emailVerificationOTPExpiry: {
        type: Date,
        default: null,
    },
    emailVerificationAttempts: {
        type: Number,
        default: 0,
    }
    ,
    // Pending email change fields (used for secure email update flow)
    pendingEmail: {
        type: String,
        default: null,
        trim: true,
        lowercase: true,
        match: [EMAIL_REGEX, 'Please provide a valid email address'],
    },
    emailOtp: {
        type: String,
        default: null,
    },
    emailOtpExpiry: {
        type: Date,
        default: null,
    },
    emailOtpResendAvailableAt: {
        type: Date,
        default: null,
    },
    emailOtpResendAttempts: {
        type: Number,
        default: 0,
    },
    emailOtpResendBlockedUntil: {
        type: Date,
        default: null,
    },
    // Pending profile changes (applied after email verification)
    pendingFullName: {
        type: String,
        default: null,
    },
    pendingUsername: {
        type: String,
        default: null,
    },
    pendingBio: {
        type: String,
        default: null,
    }
},
{
    timestamps: true,
});

userSchema.index({ username: 1 }, { unique: true, name: 'uniq_username' });
userSchema.index({ email: 1 }, { unique: true, name: 'uniq_email' });
userSchema.index(
    { googleId: 1 },
    {
        unique: true,
        name: 'uniq_googleId',
        partialFilterExpression: { googleId: { $type: 'string' } },
    }
);

userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    
    // Only hash password if it exists (local auth only)
    if (this.password) {
        const bcryptHashPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

        if (bcryptHashPattern.test(this.password)) {
            return next();
        }

        this.password = await bcrypt.hash(this.password, 10);
    }
    
    next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
    // Return false if no password (Google auth users)
    if (!this.password) {
        return false;
    }
    return await bcrypt.compare(candidatePassword, this.password);
}

userSchema.methods.generateAccessToken = function() {
    return jwt.sign(
        {  
            _id: this._id,
            username: this.username,
            email: this.email,
        },
        process.env.ACCESS_TOKEN_SECRET,
        { 
            expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '1d'
        }
    );
};

userSchema.methods.generateRefreshToken = function() {
    return jwt.sign(
        {  
            _id: this._id,
        },
        process.env.REFRESH_TOKEN_SECRET,
        { 
            expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d'
        }
    );
};

export const User = mongoose.model('User', userSchema);

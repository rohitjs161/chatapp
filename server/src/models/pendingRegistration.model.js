import mongoose, { Schema } from 'mongoose';
import { normalizeUsername } from '../utils/validation.js';

const pendingRegistrationSchema = new Schema(
    {
        fullName: {
            type: String,
            required: true,
            trim: true,
        },
        username: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            set: (value) => normalizeUsername(value),
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        password: {
            type: String,
            required: true,
        },
        emailVerificationOTP: {
            type: String,
            required: true,
        },
        emailVerificationOTPExpiry: {
            type: Date,
            required: true,
        },
        emailVerificationAttempts: {
            type: Number,
            default: 0,
        },
        emailVerificationBlockedUntil: {
            type: Date,
            default: null,
        },
        otpResendAttempts: {
            type: Number,
            default: 0,
        },
        otpResendBlockedUntil: {
            type: Date,
            default: null,
        },
        otpResendAvailableAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

pendingRegistrationSchema.index({ email: 1 }, { unique: true, name: 'uniq_pending_email' });
pendingRegistrationSchema.index({ username: 1 }, { unique: true, name: 'uniq_pending_username' });
pendingRegistrationSchema.index({ emailVerificationOTPExpiry: 1 }, { expireAfterSeconds: 0, name: 'ttl_pending_registration_otp' });

export const PendingRegistration = mongoose.model('PendingRegistration', pendingRegistrationSchema);

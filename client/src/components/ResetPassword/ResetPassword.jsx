import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { resetPassword, resendForgotPasswordOTP } from '../../api/auth.api.js';
import '../../styles/ResetPassword.css';

// Password validation regex (same as sign-up)
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/;

const ResetPassword = () => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [resendLoading, setResendLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [resendTimer, setResendTimer] = useState(0);
    const [otpLocked, setOtpLocked] = useState(false);

    // Retrieve email from localStorage or redirect
    useEffect(() => {
        const storedEmail = localStorage.getItem('resetEmail');
        if (!storedEmail) {
            navigate('/forgot-password', { replace: true });
            return;
        }
        setEmail(storedEmail);
    }, [navigate]);

    // Countdown timer for resend OTP
    useEffect(() => {
        let interval;
        if (resendTimer > 0) {
            interval = setInterval(() => {
                setResendTimer((prev) => prev - 1);
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [resendTimer]);

    const handleOtpChange = (e) => {
        const value = e.target.value.replace(/\D/g, '').slice(0, 6);
        setOtp(value);
        setError('');
    };

    const handlePasswordChange = (e) => {
        setNewPassword(e.target.value);
        setError('');
    };

    const handleConfirmPasswordChange = (e) => {
        setConfirmPassword(e.target.value);
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // Validate inputs
            if (!otp.trim()) {
                throw new Error('OTP is required');
            }

            if (otp.length !== 6) {
                throw new Error('OTP must be 6 digits');
            }

            if (!newPassword) {
                throw new Error('New password is required');
            }

            if (!confirmPassword) {
                throw new Error('Confirm password is required');
            }

            if (newPassword.length < 8 || newPassword.length > 32) {
                throw new Error('Password must be between 8 and 32 characters');
            }

            if (!PASSWORD_REGEX.test(newPassword)) {
                throw new Error('Password must include uppercase, lowercase, number, and special character');
            }

            if (!confirmPassword) {
                throw new Error('Confirm password is required');
            }

            if (newPassword !== confirmPassword) {
                throw new Error('Password and confirm password do not match');
            }

            // Call API
            const response = await resetPassword({
                email,
                otp,
                newPassword,
                confirmPassword,
            });

            if (response?.success === false) {
                if (response?.status === 'rate_limited' || Number(response?.data?.attemptsRemaining) <= 0) {
                    setOtpLocked(true);
                }
                setError(response?.message || 'Failed to reset password. Please try again.');
                setOtp('');
                return;
            }

            // Show success message
            setSuccess(true);

            // Clear localStorage
            localStorage.removeItem('resetEmail');

            // Redirect after 2 seconds
            setTimeout(() => {
                navigate('/login', { replace: true });
            }, 2000);
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Failed to reset password. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleResendOTP = async () => {
        setError('');
        setResendLoading(true);

        try {
            if (!email) {
                throw new Error('Email not found');
            }

            const response = await resendForgotPasswordOTP(email);

            if (response?.success === false) {
                const blockedUntil = response?.data?.blockedUntil
                    ? new Date(response.data.blockedUntil).getTime()
                    : null;
                if (blockedUntil && blockedUntil > Date.now()) {
                    setResendTimer(Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000)));
                } else {
                    setResendTimer(60);
                }
                setError(response?.message || 'Please wait before requesting another OTP.');
                return;
            }

            setOtpLocked(false);
            setResendTimer(60);
            setOtp('');
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Failed to resend OTP. Please try again.');
        } finally {
            setResendLoading(false);
        }
    };

    return (
        <div className="reset-password-container">
            <div className="reset-password-card">
                <h1 className="reset-password-title">Reset Your Password</h1>
                <p className="reset-password-subtitle">
                    Enter the OTP sent to {email} and create a new password.
                </p>

                {error && (
                    <div className="error-message">
                        <span>{error}</span>
                    </div>
                )}

                {otpLocked && (
                    <div className="error-message">
                        <span>OTP entry is temporarily locked. Please resend OTP to continue.</span>
                    </div>
                )}

                {success && (
                    <div className="success-message">
                        <span>Password reset successfully! Redirecting to login...</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="reset-password-form">
                    {/* OTP Input */}
                    <div className="form-group">
                        <label htmlFor="otp">Enter OTP (6 digits)</label>
                        <input
                            type="text"
                            id="otp"
                            placeholder="000000"
                            value={otp}
                            onChange={handleOtpChange}
                            disabled={loading || success || otpLocked}
                            maxLength="6"
                            className="form-input otp-input"
                        />
                    </div>

                    {/* New Password */}
                    <div className="form-group">
                        <label htmlFor="newPassword">New Password</label>
                        <div className="password-wrapper">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                id="newPassword"
                                placeholder="Enter new password"
                                value={newPassword}
                                onChange={handlePasswordChange}
                                disabled={loading || success}
                                className="form-input"
                            />
                            <button
                                type="button"
                                className="toggle-password"
                                onClick={() => setShowPassword(!showPassword)}
                                disabled={loading || success}
                            >
                                {showPassword ? '👁️' : '👁️‍🗨️'}
                            </button>
                        </div>
                    </div>

                    {/* Confirm Password */}
                    <div className="form-group">
                        <label htmlFor="confirmPassword">Confirm Password</label>
                        <div className="password-wrapper">
                            <input
                                type={showConfirmPassword ? 'text' : 'password'}
                                id="confirmPassword"
                                placeholder="Confirm your password"
                                value={confirmPassword}
                                onChange={handleConfirmPasswordChange}
                                disabled={loading || success}
                                className="form-input"
                            />
                            <button
                                type="button"
                                className="toggle-password"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                disabled={loading || success}
                            >
                                {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || success || otpLocked}
                        className="btn-submit"
                    >
                        {loading ? 'Resetting Password...' : 'Reset Password'}
                    </button>
                </form>

                {/* Resend OTP */}
                <div className="resend-otp-section">
                    <p>Didn't receive the OTP?</p>
                    <button
                        type="button"
                        onClick={handleResendOTP}
                        disabled={resendLoading || resendTimer > 0 || success}
                        className="btn-resend-otp"
                    >
                        {resendLoading
                            ? 'Sending...'
                            : resendTimer > 0
                            ? `Resend OTP in ${resendTimer}s`
                            : 'Resend OTP'}
                    </button>
                </div>

                <div className="reset-password-footer">
                    <p>
                        Remember your password?{' '}
                        <a href="/login" className="login-link">
                            Login here
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ResetPassword;

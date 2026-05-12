import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { forgotPassword } from '../../api/auth.api.js';
import { isBannedEmail } from '../../utils/validation.js';
import '../../styles/ForgotPassword.css';

const ForgotPassword = () => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleEmailChange = (e) => {
        setEmail(e.target.value);
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // Validate email
            if (!email.trim()) {
                setError('Email address is required');
                setLoading(false);
                return;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                setError('Please enter a valid email address (e.g., user@example.com)');
                setLoading(false);
                return;
            }

            if (isBannedEmail(email)) {
                setError('This email address is not allowed for security reasons');
                setLoading(false);
                return;
            }

            // Call API to send OTP
            const resp = await forgotPassword(email.trim());
            const otpSent = resp?.data?.otpSent;

            if (otpSent) {
                // Email exists and OTP was sent successfully
                setSuccess(true);
                localStorage.setItem('resetEmail', email.trim());

                // Redirect after a short delay
                setTimeout(() => {
                    navigate('/reset-password', { replace: true });
                }, 1500);
            } else {
                // Email doesn't exist or account doesn't have local password
                setError(
                    `No account found with email "${email.trim()}". ` +
                    'Please check your email or sign up for a new account. ' +
                    'If you signed up with Google, please use "Sign in with Google".'
                );
            }
        } catch (err) {
            const errorMessage = err.response?.data?.message || err.message;

            if (err.response?.status === 429) {
                setError('Too many attempts. Please try again later.');
            } else if (errorMessage?.includes('Email is required')) {
                setError('Email address is required');
            } else if (errorMessage?.includes('valid email')) {
                setError('Please enter a valid email address');
            } else {
                setError(errorMessage || 'Failed to send OTP. Please try again later.');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="forgot-password-container">
            <div className="forgot-password-card">
                <h1 className="forgot-password-title">Forgot Password?</h1>
                <p className="forgot-password-subtitle">
                    Enter your email address and we'll send you an OTP to reset your password.
                </p>

                {error && (
                    <div className="error-message">
                        <span>{error}</span>
                    </div>
                )}

                {success && (
                    <div className="success-message">
                        <span>OTP sent successfully! Redirecting...</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="forgot-password-form">
                    <div className="form-group">
                        <label htmlFor="email">Email Address</label>
                        <input
                            type="email"
                            id="email"
                            placeholder="Enter your email"
                            value={email}
                            onChange={handleEmailChange}
                            disabled={loading || success}
                            className="form-input"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || success}
                        className="btn-submit"
                    >
                        {loading ? 'Sending OTP...' : 'Send OTP'}
                    </button>
                </form>

                <div className="forgot-password-footer">
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

export default ForgotPassword;

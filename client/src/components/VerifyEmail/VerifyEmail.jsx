import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/auth.store.js';
import useActionLock from '../../hooks/useActionLock.js';
import { verifyEmailOTP, resendSignupOTP, verifyEmailChange, resendEmailChange } from '../../api/auth.api.js';

const RESEND_COOLDOWN_SECONDS = 30;

const getAuthFriendlyErrorMessage = (error, fallbackMessage) => {
  const status = Number(error?.response?.status);
  const backendMessage = error?.response?.data?.message;

  if (status === 401) {
    return 'Invalid credentials';
  }

  if (status === 429) {
    return 'Please wait before requesting another OTP';
  }

  if (typeof backendMessage === 'string' && backendMessage.trim()) {
    return backendMessage;
  }

  return fallbackMessage;
};

const VerifyEmail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email;
  const initialEmailSent = location.state?.emailSent !== false; // Default to true if not specified
  const flowType = location.pathname === '/verify-email-change' ? 'email-change' : 'signup';
  const { updateUser, user } = useAuthStore();
  const { isLocked: isSubmitting, runLockedAction } = useActionLock();
  const initialResendAvailableAt = user?.emailOtpResendAvailableAt
    ? new Date(user.emailOtpResendAvailableAt).getTime()
    : Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
  const initialResendRemaining = Math.max(0, Math.ceil((initialResendAvailableAt - Date.now()) / 1000));

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDisabled, setResendDisabled] = useState(initialResendRemaining > 0);
  const [resendTimer, setResendTimer] = useState(initialResendRemaining);
  const [resendNotice, setResendNotice] = useState('');
  const [otpLocked, setOtpLocked] = useState(false);
  const [deliveryState, setDeliveryState] = useState(initialEmailSent ? 'sent' : 'failed');
  const inputRefs = useRef([]);
  const resendToastTimerRef = useRef(null);
  const [resendAvailableAt, setResendAvailableAt] = useState(initialResendAvailableAt);

  // Redirect to the appropriate page if the required context is missing
  useEffect(() => {
    if (!email) {
      navigate(flowType === 'email-change' ? '/chat' : '/signup', { replace: true });
    }
  }, [email, flowType, navigate]);

  useEffect(() => {
    const remaining = Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000));
    setResendTimer(remaining);
    setResendDisabled(remaining > 0);

    if (remaining === 0) {
      return undefined;
    }

    const interval = setInterval(() => {
      const nextRemaining = Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000));
      setResendTimer(nextRemaining);
      setResendDisabled(nextRemaining > 0);
    }, 1000);

    return () => clearInterval(interval);
  }, [resendAvailableAt]);

  useEffect(() => {
    if (!resendNotice) {
      return undefined;
    }

    if (resendToastTimerRef.current) {
      clearTimeout(resendToastTimerRef.current);
    }

    resendToastTimerRef.current = setTimeout(() => {
      setResendNotice('');
    }, 3000);

    return () => {
      if (resendToastTimerRef.current) {
        clearTimeout(resendToastTimerRef.current);
      }
    };
  }, [resendNotice]);

  useEffect(() => {
    if (flowType !== 'signup' || initialEmailSent) {
      return;
    }

    setDeliveryState('failed');
  }, [flowType, initialEmailSent]);

  const handleOtpChange = (index, value) => {
    if (otpLocked) return;

    // Only allow numeric input
    if (!/^\d*$/.test(value)) return;
    
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    setError('');

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (otpLocked) return;

    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading || isSubmitting || otpLocked) {
      if (otpLocked) {
        setError('Too many invalid OTP attempts. Request a new OTP to continue.');
      }
      return;
    }

    const otpValue = otp.join('');
    if (otpValue.length !== 6) {
      setError('Please enter a 6-digit OTP');
      return;
    }

    try {
        await runLockedAction(async () => {
        setIsLoading(true);
        if (flowType === 'email-change') {
          // Logged-in user: verify pending email change
          const response = await verifyEmailChange(otpValue);
          if (response?.success === false) {
            if (response?.status === 'rate_limited' || Number(response?.data?.attemptsRemaining) <= 0) {
              setOtpLocked(true);
            }
            setError(response?.message || 'Failed to verify OTP. Please try again.');
            setOtp(['', '', '', '', '', '']);
            inputRefs.current[0]?.focus();
            return;
          }
          // Update user with verified email and clear pending fields
          updateUser({ 
            ...user, 
            email: email || user?.pendingEmail || user?.email,
            fullName: user?.pendingFullName || user?.fullName,
            username: user?.pendingUsername || user?.username,
            bio: user?.pendingBio || user?.bio,
            pendingEmail: undefined,
            pendingFullName: undefined,
            pendingUsername: undefined,
            pendingBio: undefined
          })
          // On success, redirect back to profile
          navigate('/profile');
        } else {
          const response = await verifyEmailOTP(email, otpValue);
          if (response?.success === false) {
            if (response?.status === 'rate_limited' || Number(response?.data?.attemptsRemaining) <= 0) {
              setOtpLocked(true);
            }
            setError(response?.message || 'Failed to verify OTP. Please try again.');
            setOtp(['', '', '', '', '', '']);
            inputRefs.current[0]?.focus();
            return;
          }
          // Redirect to login on success (signup flow)
          navigate('/login');
        }
      });
    } catch (err) {
      setError(getAuthFriendlyErrorMessage(err, 'Failed to verify OTP. Please try again.'));
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendDisabled) return;

    try {
      setResendLoading(true);
      let response;
      if (flowType === 'email-change') {
        response = await resendEmailChange();
      } else {
        response = await resendSignupOTP(email);
      }

      const emailDelivered = response?.data?.emailSent !== false;

      if (response?.success === false || !emailDelivered) {
        setDeliveryState('failed');

        const blockedUntil = response?.data?.blockedUntil ? new Date(response.data.blockedUntil).getTime() : null;
        if (blockedUntil && blockedUntil > Date.now()) {
          setResendAvailableAt(blockedUntil);
        } else if (response?.data?.cooldownRemaining) {
          setResendAvailableAt(Date.now() + Number(response.data.cooldownRemaining) * 1000);
        }
        setResendNotice(
          response?.message || 'The verification email could not be delivered. Please click "Resend OTP" below to send it again.'
        );
        return;
      }

      setOtpLocked(false);
      setDeliveryState('sent');
      setResendAvailableAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
      setOtp(['', '', '', '', '', '']);
      setError('');
      inputRefs.current[0]?.focus();
    } catch (err) {
      const status = Number(err?.response?.status);
      if (status === 429) {
        setResendAvailableAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
        setResendNotice('Please wait before requesting another OTP');
      } else {
        if (flowType === 'signup') {
          setDeliveryState('failed');
        }
        setError(getAuthFriendlyErrorMessage(err, 'Failed to resend OTP. Please try again.'));
      }
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div
      className="relative h-screen overflow-y-auto bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 flex items-center justify-center"
      style={{ height: '100dvh' }}
    >
      <div className="pointer-events-none absolute left-0 top-0 h-64 w-64 rounded-full bg-blue-200/40 blur-3xl"></div>
      <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-indigo-200/40 blur-3xl"></div>

      <div className="relative w-full max-w-md">
        <div className="rounded-3xl border border-white/70 bg-white/80 shadow-2xl backdrop-blur-md p-8">
          {resendNotice && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 shadow-sm">
              {resendNotice}
            </div>
          )}

          {deliveryState === 'failed' && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 shadow-sm">
              ⚠️ The verification email could not be delivered. Please click "Resend OTP" below to send it again.
            </div>
          )}

          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                <span className="text-3xl">✉️</span>
              </div>
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Verify Your Email</h1>
            <p className="mt-2 text-sm text-slate-600">
              {deliveryState === 'sent' ? (
                <>We've sent a 6-digit OTP to<br /></>
              ) : (
                <>Once you receive the OTP, enter it below.<br /></>
              )}
              <span className="font-semibold text-slate-800">{email}</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-3">
                Enter OTP
              </label>
              <div className="flex gap-2 justify-center">
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => (inputRefs.current[index] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength="1"
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    className={`h-14 w-14 rounded-lg border-2 text-center text-2xl font-bold transition-all focus:outline-none ${
                      digit
                        ? 'border-blue-400 bg-blue-50'
                        : error
                        ? 'border-red-400 bg-red-50'
                        : 'border-slate-200 bg-slate-50'
                    } ${error ? 'focus:ring-2 focus:ring-red-500 focus:border-red-500' : 'focus:ring-2 focus:ring-blue-500'}`}
                    disabled={isLoading || isSubmitting || otpLocked}
                  />
                ))}
              </div>
              {error && <p className="mt-2 text-center text-sm text-red-600">{error}</p>}
            </div>

            <button
              type="submit"
                disabled={isLoading || isSubmitting || otpLocked || otp.some((d) => !d)}
              className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:from-blue-600 hover:to-purple-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
            >
                {isLoading || isSubmitting ? (
                <div className="flex items-center justify-center">
                  <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  Verifying...
                </div>
                ) : otpLocked ? (
                  'Verification Locked'
              ) : (
                'Verify OTP'
              )}
            </button>

            <div className="text-center">
              <p className="text-sm text-slate-600">
                Didn't receive OTP?{' '}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendDisabled || resendLoading}
                  className="font-semibold text-blue-600 hover:text-blue-800 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
                >
                  {resendLoading ? 'Sending...' : resendDisabled ? `Resend in ${resendTimer}s` : 'Resend'}
                </button>
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate('/signup')}
              className="w-full text-center text-sm text-slate-600 hover:text-slate-800 font-medium transition-colors"
            >
              Change Email
            </button>

            {otpLocked && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700">
                Too many invalid OTP attempts. Request a new OTP to continue.
              </div>
            )}
          </form>

          <div className="mt-6 text-center text-xs text-slate-400">
            <p>© 2026 ChatApp. All rights reserved.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/auth.store.js';
import useActionLock from '../../hooks/useActionLock.js';
import {
  getEmailValidationError,
  getFullNameValidationError,
  getUsernameValidationError,
  normalizeFullName,
} from '../../utils/validation.js';
import { checkEmailExists, checkUsernameExists } from '../../api/auth.api.js';
import { getGoogleAuthUrl } from '../../utils/authLinks.js';

const FIELD_LIMITS = {
  fullName: 50,
  username: 20,
  password: 32,
};

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/;

const SignUp = () => {
  const navigate = useNavigate();
  const { register, isLoading, error, clearError } = useAuthStore();
  const { isLocked: isSubmitting, runLockedAction } = useActionLock();
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false);
  
  const [formData, setFormData] = useState({
    fullName: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    agreeToTerms: false,
  });
  const [errors, setErrors] = useState({});

  const getFieldError = (name, value, currentFormData) => {
    const trimmedValue = typeof value === 'string' ? value.trim() : value;
    switch (name) {
      case 'fullName':
        return getFullNameValidationError(value, { maxLength: FIELD_LIMITS.fullName });
      case 'username':
        return getUsernameValidationError(trimmedValue, { maxLength: FIELD_LIMITS.username });
      case 'email':
        if (!trimmedValue) return 'Email is required';
        return getEmailValidationError(trimmedValue);
      case 'password':
        if (!value) return 'Password is required';
        if (value.length < 8) return 'Password must be at least 8 characters';
        if (value.length > FIELD_LIMITS.password) return `Password must be at most ${FIELD_LIMITS.password} characters`;
        if (!PASSWORD_REGEX.test(value)) return 'Password must include uppercase, lowercase, number, and special character';
        return '';
      case 'confirmPassword':
        if (!value) return 'Please confirm your password';
        if (value !== currentFormData.password) return 'Passwords do not match';
        return '';
      case 'agreeToTerms':
        if (!value) return 'You must agree to the Terms & Privacy Policy';
        return '';
      default:
        return '';
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    const normalizedValue = name === 'username' && typeof value === 'string'
      ? value.replace(/\s+/g, '').toLowerCase()
      : value;
    const nextValue = type === 'checkbox' ? checked : normalizedValue;

    if (name === 'fullName' && typeof value === 'string' && value.length > FIELD_LIMITS.fullName) return;
    if (name === 'username' && typeof value === 'string' && value.length > FIELD_LIMITS.username) return;
    if ((name === 'password' || name === 'confirmPassword') && typeof value === 'string' && value.length > FIELD_LIMITS.password) return;

    const nextFormData = { ...formData, [name]: nextValue };
    setFormData(nextFormData);

    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: getFieldError(name, nextValue, nextFormData) }));
    }

    if (name === 'password' && errors.confirmPassword) {
      setErrors(prev => ({ ...prev, confirmPassword: getFieldError('confirmPassword', nextFormData.confirmPassword, nextFormData) }));
    }

    // Clear API error when user modifies email or username (these are the fields that could conflict)
    if ((name === 'email' || name === 'username') && error) {
      clearError();
    }

    if (error && name !== 'email' && name !== 'username') clearError();
  };

  const handleBlur = (e) => {
    const { name, type, checked, value } = e.target;
    const fieldValue = type === 'checkbox' ? checked : value;
    setErrors(prev => ({ ...prev, [name]: getFieldError(name, fieldValue, formData) }));
  };

  const validate = () => {
    const newErrors = {};
    Object.keys(formData).forEach(key => {
      const err = getFieldError(key, formData[key], formData);
      if (err) newErrors[key] = err;
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading || isSubmitting) return;
    
    if (!validate()) return;

    const payload = {
      fullName: normalizeFullName(formData.fullName),
      username: formData.username.trim().toLowerCase(),
      email: formData.email.trim().toLowerCase(),
      password: formData.password,
      confirmPassword: formData.confirmPassword,
    };

    try {
      await runLockedAction(async () => {
        // Pre-check email against disposable list and database to give immediate feedback
        try {
          const checkResp = await checkEmailExists(payload.email);
          if (checkResp?.data?.exists) {
            setErrors(prev => ({ ...prev, email: 'This email is already registered. Please use a different email or login.' }));
            return;
          }
        } catch (err) {
          // If backend validation fails (e.g., disposable email), show that message
          const serverMessage = err?.response?.data?.message || err?.message;
          if (serverMessage) {
            setErrors(prev => ({ ...prev, email: serverMessage }));
            return;
          }
        }

        try {
          const checkResp = await checkUsernameExists(payload.username);
          if (checkResp?.data?.exists) {
            setErrors(prev => ({ ...prev, username: 'This username is already taken. Please choose a different username.' }));
            return;
          }
        } catch (err) {
          const serverMessage = err?.response?.data?.message || err?.message;
          if (serverMessage) {
            setErrors(prev => ({ ...prev, username: serverMessage }));
            return;
          }
        }

        try {
          const response = await register(payload);
          navigate('/verify-otp', { state: { email: payload.email, emailSent: response?.data?.emailSent } });
        } catch (err) {
          const status = Number(err?.response?.status);
          const serverMessage = err?.response?.data?.message || err?.message || '';

          if (status === 409 || /already registered|already taken/i.test(serverMessage)) {
            if (/username/i.test(serverMessage)) {
              setErrors(prev => ({ ...prev, username: serverMessage }));
              return;
            }

            if (/email/i.test(serverMessage)) {
              setErrors(prev => ({ ...prev, email: serverMessage || 'This email is already registered. Please login instead.' }));
              return;
            }

            throw err;
          }

          throw err;
        }
      });
    } catch {
      // Error handled in store
    }
  };

  return (
    <div
      className="relative h-screen overflow-y-auto bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      style={{ height: '100dvh' }}
    >
      <div className="pointer-events-none absolute left-0 top-0 h-64 w-64 rounded-full bg-blue-200/40 blur-3xl"></div>
      <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-indigo-200/40 blur-3xl"></div>

      <div className="relative mx-auto w-full max-w-6xl py-2 sm:py-4">
        <div className="grid overflow-hidden rounded-3xl border border-white/70 bg-white/80 shadow-2xl backdrop-blur-md lg:grid-cols-2">
          <section className="relative flex flex-col justify-between bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-950 p-6 text-slate-100 sm:p-8 lg:p-10">
            <div className="absolute right-0 top-0 h-44 w-44 translate-x-10 -translate-y-10 rounded-full bg-blue-400/20 blur-3xl"></div>
            <div className="relative">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                  <span className="text-lg font-bold text-white">💬</span>
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-white">ChatApp</h1>
                  <p className="text-sm text-slate-300">Private one-to-one conversations, simplified.</p>
                </div>
              </div>
              <h2 className="text-3xl font-bold leading-tight text-white sm:text-4xl">
                Create your one-to-one chat profile in minutes.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-200 sm:text-base">
                Complete your profile details to start secure one-to-one messaging instantly.
              </p>
              <div className="mt-6 flex w-full justify-center">
                <button
                  type="button"
                  disabled={isGoogleRedirecting}
                  onClick={() => {
                    setIsGoogleRedirecting(true)
                    window.location.href = getGoogleAuthUrl()
                  }}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-white/90 px-5 py-3 text-base font-semibold text-slate-800 shadow transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70 sm:max-w-md"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <g fill="none" fillRule="evenodd">
                      <path fill="#EA4335" d="M12 7.2v3.6h5.1c-.2 1.1-.9 2-1.9 2.6v2.2h3.1c1.8-1.7 2.9-4.1 2.9-6.8 0-.6-.1-1.1-.2-1.6H12z"/>
                      <path fill="#34A853" d="M6.6 10.7c-.4 1-.4 2.1 0 3.1v2.2H9.7c-.6 1-1.6 1.8-2.8 2.2-1.9-.6-3.5-2.2-4.2-4.1 1-2.3 3.1-3.9 5.2-5.4z"/>
                      <path fill="#4A90E2" d="M12 4.5c1.5 0 2.9.5 4 1.5l3-3C17.6 1 14.9 0 12 0 8.2 0 4.9 1.9 2.8 4.9l3 2.3C7.2 6 9.4 4.5 12 4.5z"/>
                      <path fill="#FBBC05" d="M21.2 4.9l-3 2.3C16.9 6 14.7 4.5 12 4.5v3.6h5.1c-.2 1.1-.9 2-1.9 2.6l3 2.2c.9-1.6 1.4-3.4 1.4-5.4 0-.6-.1-1.1-.4-1.8z"/>
                    </g>
                  </svg>
                  {isGoogleRedirecting ? 'Redirecting to Google...' : 'Sign up with Google'}
                </button>
              </div>
            </div>
            <div className="relative mt-8 grid gap-3 text-sm text-blue-100 sm:grid-cols-2 lg:mt-10 lg:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-xl border border-blue-200/20 bg-blue-200/10 px-3 py-2">Secure one-to-one chats</div>
              <div className="rounded-xl border border-blue-200/20 bg-blue-200/10 px-3 py-2">Real-time message delivery</div>
              <div className="rounded-xl border border-blue-200/20 bg-blue-200/10 px-3 py-2">Quick contact discovery</div>
              <div className="rounded-xl border border-blue-200/20 bg-blue-200/10 px-3 py-2">Simple and distraction-free</div>
            </div>
          </section>

          <section className="bg-white p-6 sm:p-8 lg:p-10">
            <div className="mb-6">
              <h3 className="text-2xl font-bold text-slate-900">Create Account</h3>
              <p className="mt-1 text-sm text-slate-600">Enter your details to set up your secure ChatApp profile.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <input
                    type="text" name="fullName" value={formData.fullName}
                    onChange={handleInputChange} onBlur={handleBlur}
                    maxLength={FIELD_LIMITS.fullName}
                    className={`w-full rounded-xl border bg-slate-50 px-4 py-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.fullName ? 'border-red-400' : 'border-slate-200'}`}
                    placeholder="Full Name" autoComplete="name"
                  />
                  {errors.fullName && <p className="mt-1 text-xs text-red-500">{errors.fullName}</p>}
                </div>

                <div>
                  <input
                    type="text" name="username" value={formData.username}
                    onChange={handleInputChange} onBlur={handleBlur}
                    maxLength={FIELD_LIMITS.username}
                    className={`w-full rounded-xl border bg-slate-50 px-4 py-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.username ? 'border-red-400' : 'border-slate-200'}`}
                    placeholder="Username" autoComplete="username"
                  />
                  {errors.username && <p className="mt-1 text-xs text-red-500">{errors.username}</p>}
                </div>

                <div>
                  <div className="relative">
                    <input
                      type="email" name="email" value={formData.email}
                      onChange={handleInputChange} onBlur={handleBlur}
                      className={`w-full rounded-xl border bg-slate-50 px-4 py-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                        errors.email ? 'border-red-400 focus:ring-red-500' : 'border-slate-200 focus:ring-blue-500'
                      }`}
                      placeholder="Email Address" autoComplete="email"
                    />
                  </div>
                  {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
                </div>

                <div>
                  <input
                    type="password" name="password" value={formData.password}
                    onChange={handleInputChange} onBlur={handleBlur}
                    maxLength={FIELD_LIMITS.password}
                    className={`w-full rounded-xl border bg-slate-50 px-4 py-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.password ? 'border-red-400' : 'border-slate-200'}`}
                    placeholder="Password" autoComplete="new-password"
                  />
                  {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
                </div>

                <div>
                  <input
                    type="password" name="confirmPassword" value={formData.confirmPassword}
                    onChange={handleInputChange} onBlur={handleBlur}
                    maxLength={FIELD_LIMITS.password}
                    className={`w-full rounded-xl border bg-slate-50 px-4 py-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.confirmPassword ? 'border-red-400' : 'border-slate-200'}`}
                    placeholder="Confirm Password" autoComplete="new-password"
                  />
                  {errors.confirmPassword && <p className="mt-1 text-xs text-red-500">{errors.confirmPassword}</p>}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox" id="agreeToTerms" name="agreeToTerms"
                    checked={formData.agreeToTerms}
                    onChange={handleInputChange} onBlur={handleBlur}
                    className="mt-1 h-4 w-4 rounded border border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="agreeToTerms" className="select-none text-xs text-slate-700 md:text-sm">
                    I agree to the <a href="#" className="font-medium text-blue-600 hover:text-blue-800">Terms & Privacy Policy</a>
                  </label>
                </div>
              </div>

              {errors.agreeToTerms && <p className="text-xs text-red-500">{errors.agreeToTerms}</p>}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || isSubmitting}
                className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:from-blue-600 hover:to-purple-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading || isSubmitting ? (
                  <div className="flex items-center">
                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    Creating Account...
                  </div>
                ) : (
                  <>
                    Create Account
                    <svg xmlns="http://www.w3.org/2000/svg" className="ml-2 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10.293 15.707a1 1 0 010-1.414L13.586 11H3a1 1 0 110-2h10.586l-3.293-3.293a1 1 0 111.414-1.414l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            

            <div className="mt-6 text-center">
              <p className="text-sm text-slate-600">
                Already have an account?{' '}
                <button type="button" onClick={() => navigate('/login')} className="font-semibold text-blue-600 transition-colors hover:text-blue-800">
                  Sign In
                </button>
              </p>
            </div>
            <div className="mt-6 text-center text-xs text-slate-400">
              <p>© 2026 ChatApp. All rights reserved.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SignUp;
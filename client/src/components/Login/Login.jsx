import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../../store/auth.store.js'
import { getEmailValidationError, getUsernameValidationError } from '../../utils/validation.js'
import useActionLock from '../../hooks/useActionLock.js'
import { getGoogleAuthUrl } from '../../utils/authLinks.js'

const USERNAME_LIMITS = {
  min: 3,
  max: 20,
}

const Login = () => {
  const [formData, setFormData] = useState({
    loginField: '',
    password: ''
  })
  const [showPassword, setShowPassword] = useState(false)
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false)
  const [errors, setErrors] = useState({})
  const navigate = useNavigate()
  const { login, isLoading, error, clearError } = useAuthStore()
  const { isLocked: isSubmitting, runLockedAction } = useActionLock()

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }))
    if (error) clearError()
  }

  const validateForm = () => {
    const newErrors = {}
    const trimmedLoginField = formData.loginField.trim()

    if (!trimmedLoginField) {
      newErrors.loginField = 'Email or username is required'
    } else if (trimmedLoginField.includes('@')) {
      const emailError = getEmailValidationError(trimmedLoginField)
      if (emailError) newErrors.loginField = emailError
    } else {
      const usernameError = getUsernameValidationError(trimmedLoginField, {
        minLength: USERNAME_LIMITS.min,
        maxLength: USERNAME_LIMITS.max,
      })
      if (usernameError) newErrors.loginField = usernameError
    }

    if (!formData.password) {
      newErrors.password = 'Password is required'
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validateForm()) return
    const payload = {
      loginField: formData.loginField.trim(),
      password: formData.password,
    }
    try {
      await runLockedAction(async () => {
        await login(payload)
        navigate('/chat')
      })
    } catch {
      // Error handled in store
    }
  }

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
                  <p className="text-sm text-slate-300">Secure one-to-one conversations.</p>
                </div>
              </div>

              <h2 className="text-3xl font-bold leading-tight text-white sm:text-4xl">
                Welcome back to your private chat space.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-200 sm:text-base">
                Sign in with your credentials to access your direct messages and continue your one-to-one conversations.
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
                  {isGoogleRedirecting ? 'Redirecting to Google...' : 'Sign in with Google'}
                </button>
              </div>
            </div>

            <div className="relative mt-8 grid gap-3 text-sm text-blue-100 sm:grid-cols-2 lg:mt-10 lg:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-xl border border-blue-200/20 bg-blue-200/10 px-3 py-2">Private one-to-one messaging</div>
              <div className="rounded-xl border border-blue-200/20 bg-blue-200/10 px-3 py-2">Real-time message sync</div>
              <div className="rounded-xl border border-blue-200/20 bg-blue-200/10 px-3 py-2">Fast and reliable delivery</div>
              <div className="rounded-xl border border-blue-200/20 bg-blue-200/10 px-3 py-2">Focused chat experience</div>
            </div>
          </section>

          <section className="bg-white p-6 sm:p-8 lg:p-10">
            <div className="mb-6">
              <h3 className="text-2xl font-bold text-slate-900">Sign In</h3>
              <p className="mt-1 text-sm text-slate-600">Use your email or username and password to continue.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Email or Username</label>
                <input
                  type="text"
                  name="loginField"
                  value={formData.loginField}
                  onChange={handleInputChange}
                  className={`w-full rounded-xl border bg-slate-50 px-4 py-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.loginField ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}
                  placeholder="Enter your email or username"
                />
                {errors.loginField && <p className="mt-1 text-sm text-red-600">{errors.loginField}</p>}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className={`w-full rounded-xl border bg-slate-50 px-4 py-3 pr-12 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.password ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-700"
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
                {errors.password && <p className="mt-1 text-sm text-red-600">{errors.password}</p>}
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || isSubmitting}
                className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:from-blue-600 hover:to-purple-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading || isSubmitting ? (
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    Signing In...
                  </div>
                ) : (
                  <>
                    Sign In
                    <svg xmlns="http://www.w3.org/2000/svg" className="ml-2 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10.293 15.707a1 1 0 010-1.414L13.586 11H3a1 1 0 110-2h10.586l-3.293-3.293a1 1 0 111.414-1.414l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            

            <div className="mt-4 text-right">
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="text-sm font-medium text-blue-600 transition-colors hover:text-blue-800"
              >
                Forgot Password?
              </button>
            </div>

            <div className="mt-6 text-center">
              <p className="text-sm text-slate-600">
                Don&apos;t have an account?
                <button onClick={() => navigate('/signup')} className="ml-2 font-semibold text-blue-600 transition-colors hover:text-blue-800">
                  Sign Up
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
  )
}

export default Login
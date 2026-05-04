import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../../store/auth.store.js'
import { deleteAccount, updateProfile, updateProfilePicture } from '../../api/auth.api.js'
import {
  getEmailValidationError,
  getFullNameValidationError,
  getAboutValidationError,
  getUsernameValidationError,
  normalizeFullName,
  normalizeAboutText,
  sanitizeAboutText,
} from '../../utils/validation.js'
import useActionLock from '../../hooks/useActionLock.js'

const ABOUT_MAX_LENGTH = 160
const FULL_NAME_MAX_LENGTH = 50
const USERNAME_MAX_LENGTH = 20

const Profile = () => {
  const navigate = useNavigate()
  const { user, syncLogout, updateUser } = useAuthStore()
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isRedirectingToVerify, setIsRedirectingToVerify] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteOtp, setDeleteOtp] = useState('')
  const [isDeleteOtpStep, setIsDeleteOtpStep] = useState(false)
  const [deleteToast, setDeleteToast] = useState('')
  const [apiError, setApiError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const { isLocked: isSavingProfile, runLockedAction: runProfileSave } = useActionLock()
  const { isLocked: isDeletingAccount, runLockedAction: runDeleteAccount } = useActionLock()
  const deleteToastTimerRef = useRef(null)

  const authProviders = Array.isArray(user?.authProviders) ? user.authProviders : []
  const hasLocalProvider = authProviders.includes('local') || user?.authProvider === 'local' || Boolean(user?.password)
  const isGoogleOnlyAccount = !hasLocalProvider && Boolean(
    user?.googleId ||
    user?.authProvider === 'google' ||
    (authProviders.length === 1 && authProviders[0] === 'google')
  )
  const requiresDeletePassword = !isGoogleOnlyAccount

  useEffect(() => {
    if (!deleteToast) return undefined

    if (deleteToastTimerRef.current) {
      clearTimeout(deleteToastTimerRef.current)
    }

    deleteToastTimerRef.current = setTimeout(() => {
      setDeleteToast('')
    }, 3500)

    return () => {
      if (deleteToastTimerRef.current) {
        clearTimeout(deleteToastTimerRef.current)
      }
    }
  }, [deleteToast])

  const [profileData, setProfileData] = useState({
    fullName: user?.fullName || '',
    username: user?.username || '',
    email: user?.email || '',
    bio: user?.bio || '',
    profilePicture: user?.profilePicture || ''
  })

  const [editData, setEditData] = useState({ ...profileData })

  // Determine if there's a pending email change
  const hasPendingEmailChange = !!(user?.pendingEmail && user?.pendingEmail !== user?.email)

  const getAvatarText = (name) => {
    if (!name) return '?'
    const parts = name.trim().split(' ')
    return parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : name[0].toUpperCase()
  }

  const handleSave = async () => {
    if (isSavingProfile || isLoading) return

    const normalizedFullName = normalizeFullName(editData.fullName)
    const normalizedBio = normalizeAboutText(editData.bio)
    const sanitizedBio = sanitizeAboutText(normalizedBio)
    const trimmedEmail = editData.email.trim()
    const normalizedUsername = editData.username.trim().toLowerCase()
    const fullNameError = getFullNameValidationError(normalizedFullName, { maxLength: FULL_NAME_MAX_LENGTH })
    const bioError = getAboutValidationError(normalizedBio, { maxLength: ABOUT_MAX_LENGTH })
    const emailError = getEmailValidationError(trimmedEmail)
    const usernameError = getUsernameValidationError(normalizedUsername, { maxLength: USERNAME_MAX_LENGTH })

    if (fullNameError) {
      setFieldErrors(prev => ({ ...prev, fullName: fullNameError }))
      return
    }

    if (emailError) {
      setFieldErrors(prev => ({ ...prev, email: emailError }))
      return
    }

    if (bioError) {
      setFieldErrors(prev => ({ ...prev, bio: bioError }))
      return
    }

    if (usernameError) {
      setFieldErrors(prev => ({ ...prev, username: usernameError }))
      return
    }

    setIsLoading(true)
    setApiError('')
    try {
      await runProfileSave(async () => {
        const resp = await updateProfile({
          fullName: normalizedFullName,
          username: normalizedUsername,
          email: trimmedEmail.toLowerCase(),
          bio: sanitizedBio,
        })

        // If backend initiated email-change flow, redirect to OTP verification
        if (resp?.requiresEmailVerification === true) {
          setIsRedirectingToVerify(true)
          const pendingEmail = trimmedEmail.toLowerCase()
          const pendingProfileData = {
            ...editData,
            fullName: normalizedFullName,
            username: normalizedUsername,
            email: pendingEmail,
            bio: sanitizedBio,
          }
          setProfileData(pendingProfileData)
          setEditData(pendingProfileData)
          updateUser({
            ...user,
            pendingEmail,
            pendingFullName: normalizedFullName,
            pendingUsername: normalizedUsername,
            pendingBio: sanitizedBio,
            emailOtpResendAvailableAt: new Date(Date.now() + 30 * 1000).toISOString(),
          })
          setFieldErrors({})
          setIsEditing(false)
          navigate('/verify-email-change', { replace: true, state: { email: pendingEmail, type: 'email-change' } });
          return;
        }

        const nextProfileData = {
          ...editData,
          fullName: normalizedFullName,
          username: normalizedUsername,
          email: trimmedEmail.toLowerCase(),
          bio: sanitizedBio,
        }
        setProfileData(nextProfileData)
        updateUser({ ...user, ...nextProfileData })
        setFieldErrors({})
        setIsEditing(false)
      })
    } catch (err) {
      setApiError(err.response?.data?.message || 'Failed to update profile')
    } finally {
      setIsLoading(false)
    }
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setIsLoading(true)
    setApiError('')
    try {
      const response = await updateProfilePicture(file)
      const newUrl = response.data.user.profilePicture
      setEditData(prev => ({ ...prev, profilePicture: newUrl }))
      setProfileData(prev => ({ ...prev, profilePicture: newUrl }))
      updateUser({ ...user, profilePicture: newUrl })
    } catch (err) {
      setApiError(err.response?.data?.message || 'Failed to upload picture')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setEditData({ ...profileData })
    setIsEditing(false)
    setApiError('')
    setFieldErrors({})
  }

  const handleOpenDeleteModal = () => {
    if (isLoading || isDeletingAccount) return

    setDeletePassword('')
    setDeleteOtp('')
    setIsDeleteOtpStep(false)
    setDeleteToast('')
    setIsDeleteModalOpen(true)
  }

  const handleCloseDeleteModal = () => {
    if (isDeletingAccount) return

    setIsDeleteModalOpen(false)
    setDeletePassword('')
    setDeleteOtp('')
    setIsDeleteOtpStep(false)
  }

  const handleDeleteAccount = async (event) => {
    event.preventDefault()
    if (isDeletingAccount || isLoading) return

    if (requiresDeletePassword && !deletePassword.trim()) {
      setDeleteToast('Password is required to delete this account.')
      return
    }

    if (!requiresDeletePassword && isDeleteOtpStep && deleteOtp.trim().length !== 6) {
      setDeleteToast('Please enter the 6-digit OTP sent to your email.')
      return
    }

    try {
      await runDeleteAccount(async () => {
        const payload = requiresDeletePassword
          ? { password: deletePassword.trim() }
          : (isDeleteOtpStep
            ? { otp: deleteOtp.trim() }
            : {})

        const response = await deleteAccount(payload)

        // Handle semantic error responses (status: 'error' or 'rate_limited')
        if (response?.status === 'error' || response?.status === 'rate_limited') {
          setDeleteToast(response?.message || 'Failed to delete account')
          // Clear password field on error but keep OTP step if in OTP mode
          if (requiresDeletePassword) {
            setDeletePassword('')
          }
          return
        }

        if (!requiresDeletePassword && response?.data?.requiresDeleteOtp) {
          setIsDeleteOtpStep(true)
          setDeleteToast(response?.message || 'OTP sent to your email for account deletion.')
          return
        }

        // Account successfully deleted - clear everything and logout
        setIsDeleteModalOpen(false)
        setDeletePassword('')
        setDeleteOtp('')
        setIsDeleteOtpStep(false)
        syncLogout()
        navigate('/login', { replace: true })
      })
    } catch (err) {
      setDeleteToast(err.response?.data?.message || 'Failed to delete account')
    }
  }

  const handleResendDeleteOtp = async () => {
    if (isDeletingAccount || isLoading || requiresDeletePassword) return

    try {
      await runDeleteAccount(async () => {
        const response = await deleteAccount({ resendOtp: true })
        setIsDeleteOtpStep(true)
        setDeleteOtp('')
        setDeleteToast(response?.message || 'OTP resent to your email.')
      })
    } catch (err) {
      setDeleteToast(err.response?.data?.message || 'Failed to resend OTP')
    }
  }

  return (
    <div className="h-dvh w-full overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.16),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(168,85,247,0.16),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#eef2ff_100%)] px-4 py-5 sm:px-6 lg:px-8">
      {deleteToast && (
        <div className="fixed right-4 top-4 z-[60] max-w-sm rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-xl" role="alert">
          {deleteToast}
        </div>
      )}

      {isRedirectingToVerify && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="rounded-3xl border border-white/10 bg-white/10 px-6 py-5 text-center text-white shadow-2xl">
            <div className="mx-auto mb-3 h-12 w-12 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
            <p className="text-base font-semibold">Sending you to email verification...</p>
            <p className="mt-1 text-sm text-white/70">Please wait while we secure your profile update.</p>
          </div>
        </div>
      )}

      <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4">
        <div className="flex flex-shrink-0 items-center justify-between gap-3 rounded-3xl border border-white/70 bg-white/85 px-4 py-3 shadow-[0_10px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:px-5">
          <button
            onClick={() => navigate('/chat')}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition-all duration-200 hover:bg-slate-200 hover:scale-105"
            aria-label="Go back"
          >
            ←
          </button>

          <div className="min-w-0 flex-1 text-center">
            <h1 className="truncate text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              {isEditing ? 'Edit Profile' : 'Profile'}
            </h1>
            <p className="text-xs text-gray-500 sm:text-sm">Manage your account details and profile picture</p>
          </div>

          <button
            onClick={() => isEditing ? handleSave() : setIsEditing(true)}
            disabled={isLoading}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 disabled:opacity-50 ${isEditing ? 'bg-gradient-to-r from-green-400 to-green-500 text-white shadow-lg' : 'bg-slate-100 text-slate-700'}`}
            aria-label={isEditing ? 'Save profile' : 'Edit profile'}
          >
            {isLoading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
            ) : isEditing ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
        </div>

        {apiError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {apiError}
          </div>
        )}

        {isEditing ? (
          <section className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/70 bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-slate-200/80 px-5 py-4 sm:px-6">
                <h3 className="text-lg font-semibold text-slate-900">Edit Account Details</h3>
                <p className="mt-1 text-sm text-slate-500">Update your profile information and save when done.</p>
              </div>

              <div className="grid min-h-0 flex-1 gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
                <aside className="min-w-0 overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-fuchsia-600 p-6 text-center text-white shadow-xl">
                  <div className="mx-auto mb-4 w-fit">
                    <div className="relative h-28 w-28 overflow-hidden rounded-full border-4 border-white/90 bg-white/20 shadow-2xl">
                      {editData.profilePicture ? (
                        <img src={editData.profilePicture} alt="Profile" className="h-full w-full object-cover" loading="eager" decoding="async" fetchPriority="high" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-white">
                          {getAvatarText(editData.fullName)}
                        </div>
                      )}
                    </div>
                    <label className="-mt-3 ml-auto flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-white text-gray-700 shadow-lg transition-transform hover:scale-105">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                    </label>
                  </div>
                  <h4 className="overflow-hidden text-ellipsis whitespace-nowrap text-2xl font-bold" title={editData.fullName}>{editData.fullName}</h4>
                  <p className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-white/90" title={`@${editData.username}`}>@{editData.username}</p>
                </aside>

                <div className="min-h-0 overflow-y-auto pr-1">
                  <div className="grid gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Full Name</label>
                      <input
                        type="text"
                        maxLength={FULL_NAME_MAX_LENGTH}
                        value={editData.fullName}
                        onChange={(e) => {
                          const nextFullName = e.target.value.slice(0, FULL_NAME_MAX_LENGTH)
                          setEditData(prev => ({ ...prev, fullName: nextFullName }))
                          if (fieldErrors.fullName) {
                            setFieldErrors(prev => ({
                              ...prev,
                              fullName: getFullNameValidationError(nextFullName, { maxLength: FULL_NAME_MAX_LENGTH }),
                            }))
                          }
                        }}
                        onBlur={() => {
                          setFieldErrors(prev => ({
                            ...prev,
                            fullName: getFullNameValidationError(editData.fullName, { maxLength: FULL_NAME_MAX_LENGTH }),
                          }))
                        }}
                        className={`w-full rounded-2xl border bg-slate-50 px-4 py-3 font-medium text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100 ${fieldErrors.fullName ? 'border-red-400' : 'border-slate-200'}`}
                      />
                      {fieldErrors.fullName && <p className="text-xs text-red-500">{fieldErrors.fullName}</p>}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Username</label>
                      <input
                        type="text"
                        maxLength={USERNAME_MAX_LENGTH}
                        value={editData.username}
                        onChange={(e) => {
                          const nextUsername = e.target.value.replace(/\s+/g, '').toLowerCase().slice(0, USERNAME_MAX_LENGTH)
                          setEditData(prev => ({ ...prev, username: nextUsername }))
                          if (fieldErrors.username) {
                            setFieldErrors(prev => ({
                              ...prev,
                              username: getUsernameValidationError(nextUsername, { maxLength: USERNAME_MAX_LENGTH }),
                            }))
                          }
                        }}
                        onBlur={() => {
                          setFieldErrors(prev => ({
                            ...prev,
                            username: getUsernameValidationError(editData.username, { maxLength: USERNAME_MAX_LENGTH }),
                          }))
                        }}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
                      />
                      {fieldErrors.username && <p className="text-xs text-red-500">{fieldErrors.username}</p>}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Email</label>
                        <input
                          type="email"
                          value={editData.email}
                          onChange={(e) => {
                            const nextEmail = e.target.value
                            setEditData(prev => ({ ...prev, email: nextEmail }))
                            if (fieldErrors.email) {
                              setFieldErrors(prev => ({
                                ...prev,
                                email: getEmailValidationError(nextEmail.trim()),
                              }))
                            }
                          }}
                          onBlur={() => {
                            setFieldErrors(prev => ({
                              ...prev,
                              email: getEmailValidationError(editData.email.trim()),
                            }))
                          }}
                          disabled={(user?.authProviders && user?.authProviders.includes('google')) || user?.authProvider === 'google'}
                          className={`w-full rounded-2xl border bg-slate-50 px-4 py-3 font-medium text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100 ${fieldErrors.email ? 'border-red-400' : 'border-slate-200'} ${user?.authProvider === 'google' ? 'opacity-60 cursor-not-allowed' : ''}`}
                        />
                        {((user?.authProviders && user?.authProviders.includes('google')) || user?.authProvider === 'google') && (
                          <p className="text-xs text-slate-500">Email is managed by Google account and cannot be changed here.</p>
                        )}
                        {fieldErrors.email && <p className="text-xs text-red-500">{fieldErrors.email}</p>}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">About</label>
                      <textarea
                        value={editData.bio}
                        onChange={(e) => {
                          const nextBio = e.target.value.slice(0, ABOUT_MAX_LENGTH)
                          setEditData(prev => ({ ...prev, bio: nextBio }))
                          if (fieldErrors.bio) {
                            setFieldErrors(prev => ({
                              ...prev,
                              bio: getAboutValidationError(nextBio, { maxLength: ABOUT_MAX_LENGTH }),
                            }))
                          }
                        }}
                        onBlur={() => {
                          setFieldErrors(prev => ({
                            ...prev,
                            bio: getAboutValidationError(editData.bio, { maxLength: ABOUT_MAX_LENGTH }),
                          }))
                        }}
                        rows={3}
                        maxLength={ABOUT_MAX_LENGTH}
                        className={`w-full resize-none rounded-2xl border bg-slate-50 px-4 py-3 font-medium text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100 ${fieldErrors.bio ? 'border-red-400' : 'border-slate-200'}`}
                        placeholder="Tell us about yourself..."
                      />
                      {fieldErrors.bio && <p className="text-xs text-red-500">{fieldErrors.bio}</p>}
                      <p className="text-right text-xs text-slate-500">{editData.bio.length}/{ABOUT_MAX_LENGTH}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-slate-200/80 bg-white/95 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={handleCancelEdit}
                    className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isLoading || isSavingProfile}
                    className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoading || isSavingProfile ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] lg:overflow-hidden">
            <aside className="min-w-0 overflow-hidden rounded-3xl border border-white/70 bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl">
              <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-600 to-fuchsia-600 px-6 py-8 text-center text-white sm:px-8">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.22),_transparent_38%)]" />
                <div className="relative z-10">
                  <div className="mx-auto mb-4 h-28 w-28 overflow-hidden rounded-full border-4 border-white/90 bg-white/20 shadow-2xl sm:h-32 sm:w-32">
                    {profileData.profilePicture ? (
                      <img src={profileData.profilePicture} alt="Profile" className="h-full w-full object-cover" loading="eager" decoding="async" fetchPriority="high" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-white">
                        {getAvatarText(profileData.fullName)}
                      </div>
                    )}
                  </div>
                  <h2 className="overflow-hidden text-ellipsis whitespace-nowrap text-2xl font-bold drop-shadow-sm sm:text-3xl" title={profileData.fullName}>{profileData.fullName}</h2>
                  <p className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-white/90" title={`@${profileData.username}`}>@{profileData.username}</p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white/95 backdrop-blur">Active user</span>
                    <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white/95 backdrop-blur">Secure profile</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200/70 bg-white/90 p-5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Profile Summary</h4>
                <div className="mt-3 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm text-slate-700">Keep your personal details up to date so contacts can identify you quickly.</p>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
                    <span>Profile ready for collaboration</span>
                  </div>
                </div>
              </div>
            </aside>

            <section className="min-h-0 overflow-hidden rounded-3xl border border-white/70 bg-white/90 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur-xl">
              <div className="flex h-full min-h-0 flex-col">
                <div className="border-b border-slate-200/80 px-5 py-4 sm:px-6">
                  <h3 className="text-lg font-semibold text-slate-900">Account Details</h3>
                  <p className="mt-1 text-sm text-slate-500">Your personal information and account settings.</p>
                </div>

                {hasPendingEmailChange && (
                  <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 sm:px-6">
                    <div className="flex gap-2">
                      <span className="text-amber-600 font-semibold">⏳</span>
                      <div>
                        <p className="text-sm font-medium text-amber-900">Profile changes pending</p>
                        <p className="text-xs text-amber-800">Your profile changes will be applied after you verify your new email address.</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                  <div className="grid gap-4">
                    {[
                      { label: 'Full Name', value: profileData.fullName },
                      { label: 'Username', value: `@${profileData.username}` },
                      { label: 'Email', value: profileData.email },
                      { label: 'About', value: profileData.bio },
                    ].map(({ label, value }) => (
                      <div key={label} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</label>
                        </div>
                        <p className="break-words rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-medium leading-7 text-slate-900">
                          {value || 'Not set'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-200/80 bg-white/95 p-4 sm:p-5">
                  <button
                    onClick={handleOpenDeleteModal}
                    disabled={isLoading || isDeletingAccount}
                    className="w-full rounded-2xl bg-gradient-to-r from-red-500 to-red-600 px-4 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:from-red-600 hover:to-red-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoading || isDeletingAccount ? 'Deleting Account...' : 'Delete Account'}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Delete Account</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  This action is permanent and cannot be undone.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseDeleteModal}
                disabled={isDeletingAccount}
                className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-60"
                aria-label="Close delete dialog"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDeleteAccount} className="mt-5 space-y-4">
              {deleteToast && (
                <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {deleteToast}
                </div>
              )}

              {requiresDeletePassword ? (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Password</label>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-red-400 focus:bg-white focus:ring-4 focus:ring-red-100"
                    placeholder="Enter your password to confirm"
                    disabled={isDeletingAccount}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Google-only account detected. For security, OTP verification is required before deleting your account.
                  </div>

                  {isDeleteOtpStep && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-slate-700">Delete OTP</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        value={deleteOtp}
                        onChange={(e) => setDeleteOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-red-400 focus:bg-white focus:ring-4 focus:ring-red-100"
                        placeholder="Enter 6-digit OTP"
                        disabled={isDeletingAccount}
                      />
                    </div>
                  )}

                  {isDeleteOtpStep && (
                    <button
                      type="button"
                      onClick={handleResendDeleteOtp}
                      disabled={isDeletingAccount}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Resend OTP
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCloseDeleteModal}
                  disabled={isDeletingAccount}
                  className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDeletingAccount || (requiresDeletePassword && !deletePassword.trim()) || (!requiresDeletePassword && isDeleteOtpStep && deleteOtp.trim().length !== 6)}
                  className="flex-1 rounded-2xl bg-gradient-to-r from-red-500 to-red-600 px-4 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:from-red-600 hover:to-red-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDeletingAccount ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                      Deleting...
                    </span>
                  ) : (
                    requiresDeletePassword
                      ? 'Delete Account'
                      : (isDeleteOtpStep ? 'Verify OTP & Delete' : 'Send OTP')
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Profile
/**
 * Sanitizes user data to remove sensitive information before storing in browser
 * Only keeps essential, non-sensitive user information
 */
export const sanitizeUserData = (user) => {
  if (!user || typeof user !== 'object') {
    return null
  }

  // Only allow these safe fields to be stored in the browser
  const safeFields = {
    _id: user._id,
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    bio: user.bio,
    profilePicture: user.profilePicture,
    authProvider: user.authProvider,
    authProviders: user.authProviders,
    pendingEmail: user.pendingEmail,
    pendingFullName: user.pendingFullName,
    pendingUsername: user.pendingUsername,
    pendingBio: user.pendingBio,
    emailOtpResendAvailableAt: user.emailOtpResendAvailableAt,
    isVerified: user.isVerified,
    notificationPreferences: user.notificationPreferences,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }

  // Filter out undefined values
  return Object.fromEntries(
    Object.entries(safeFields).filter(([, value]) => value !== undefined)
  )
}

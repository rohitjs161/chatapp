import { create } from 'zustand'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../api/user.api.js'

const NOTIFICATION_PREFERENCES_STORAGE_KEY = 'chatapp:notification-preferences'

const defaultPreferences = {
  messageNotificationsEnabled: true,
}

const normalizeBooleanPreference = (value, fallback = true) => {
  if (typeof value === 'boolean') return value

  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true') return true
    if (lowered === 'false') return false
  }

  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }

  return fallback
}

const resolvePreferences = (value = {}) => ({
  messageNotificationsEnabled: normalizeBooleanPreference(
    value?.messageNotificationsEnabled,
    defaultPreferences.messageNotificationsEnabled
  ),
})

const readStoredPreferences = () => {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY)
    if (!raw) return null
    return resolvePreferences(JSON.parse(raw))
  } catch {
    return null
  }
}

const persistPreferences = (preferences) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      NOTIFICATION_PREFERENCES_STORAGE_KEY,
      JSON.stringify(resolvePreferences(preferences))
    )
  } catch {
    // Ignore localStorage write failures.
  }
}

let notificationToggleRequestId = 0

const useNotificationStore = create((set, get) => ({
  preferences: readStoredPreferences() || defaultPreferences,
  isLoading: false,
  isSaving: false,
  cooldownUntil: 0,
  latestRequestId: 0,
  preferenceVersion: 0,
  pendingDesiredValue: null,
  error: null,

  applyServerPreferences: (preferences) => {
    const resolved = resolvePreferences(preferences)

    // During an active toggle request, ignore conflicting sync payloads.
    const { isSaving, pendingDesiredValue } = get()
    if (isSaving && typeof pendingDesiredValue === 'boolean') {
      if (resolved.messageNotificationsEnabled !== pendingDesiredValue) {
        return
      }
    }

    persistPreferences(resolved)
    set({ preferences: resolved, error: null })
  },

  fetchPreferences: async () => {
    const fetchStartVersion = get().preferenceVersion
    set({ isLoading: true, error: null })
    try {
      const response = await getNotificationPreferences()

      // Ignore stale fetch results if preferences were changed while this request was in flight.
      if (get().preferenceVersion !== fetchStartVersion) {
        return get().preferences
      }

      const resolved = resolvePreferences(response?.data)
      persistPreferences(resolved)
      set({ preferences: resolved, error: null })
      return resolved
    } catch (error) {
      set({ error: error?.response?.data?.message || 'Failed to fetch notification preferences' })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  setMessageNotificationsEnabled: async (enabled) => {
    if (Date.now() < Number(get().cooldownUntil || 0)) {
      return get().preferences
    }

    const requestId = ++notificationToggleRequestId
    const previousPreferences = get().preferences
    const nextVersion = get().preferenceVersion + 1
    const nextPreferences = {
      messageNotificationsEnabled: normalizeBooleanPreference(enabled, defaultPreferences.messageNotificationsEnabled),
    }

    set({
      isSaving: true,
      latestRequestId: requestId,
      preferenceVersion: nextVersion,
      pendingDesiredValue: nextPreferences.messageNotificationsEnabled,
      error: null,
      preferences: nextPreferences,
    })
    persistPreferences(nextPreferences)

    try {
      const response = await updateNotificationPreferences(nextPreferences)
      if (get().latestRequestId !== requestId) {
        return get().preferences
      }

      const resolved = resolvePreferences(response?.data)
      persistPreferences(resolved)
      set({ preferences: resolved, pendingDesiredValue: null, error: null })
      return resolved
    } catch (error) {
      if (get().latestRequestId !== requestId) {
        return get().preferences
      }

      const isRateLimited = Number(error?.response?.status) === 429
      const retryAfterHeader = error?.response?.headers?.['retry-after']
      const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10)
      const nextCooldownUntil = isRateLimited && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Date.now() + retryAfterSeconds * 1000
        : get().cooldownUntil

      set({
        preferences: previousPreferences,
        pendingDesiredValue: null,
        cooldownUntil: nextCooldownUntil,
        error: error?.response?.data?.message || 'Failed to update notification preferences',
      })
      persistPreferences(previousPreferences)
      throw error
    } finally {
      if (get().latestRequestId === requestId) {
        set({ isSaving: false, pendingDesiredValue: null })
      }
    }
  },

  clearError: () => set({ error: null }),
}))

export default useNotificationStore

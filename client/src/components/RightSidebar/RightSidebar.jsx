import React, { useMemo, useState } from 'react'
import useAuthStore from '../../store/auth.store.js'
import useMessageStore from '../../store/message.store.js'
import useOnlineUsers from '../../socket/useOnlineUsers.js'
import useNotificationStore from '../../store/notification.store.js'
import { logger } from '../../utils/logger.js'

const RightSidebar = ({ selectedConversation, onClose }) => {
  const [activeTab, setActiveTab] = useState('profile')
  const { user } = useAuthStore()
  const { isUserOnline } = useOnlineUsers()
  const { messages } = useMessageStore()
  const notificationsEnabled = useNotificationStore((state) => state.preferences.messageNotificationsEnabled)
  const setMessageNotificationsEnabled = useNotificationStore((state) => state.setMessageNotificationsEnabled)
  const isNotificationSaving = useNotificationStore((state) => state.isSaving)
  const notificationError = useNotificationStore((state) => state.error)
  const cooldownUntil = useNotificationStore((state) => state.cooldownUntil)
  const isNotificationTemporarilyBlocked = Number(cooldownUntil || 0) > Date.now()

  const otherUser = selectedConversation?.participants?.find(p => p._id !== user?._id)
  const isOtherUserOnline = isUserOnline(otherUser?._id)

  const getAvatarText = (name) => {
    if (!name) return '?'
    const parts = name.trim().split(' ')
    return parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : name[0].toUpperCase()
  }

  const currentUser = otherUser || {
    fullName: 'John Doe',
    email: 'john.doe@example.com',
    bio: 'Hey there! I am using ChatApp.',
    online: false
  }

  const showOnline = otherUser ? isOtherUserOnline : false

  const handleNotificationToggle = async () => {
    const notificationState = useNotificationStore.getState()
    const isBlocked = notificationState.isSaving || Number(notificationState.cooldownUntil || 0) > Date.now()
    if (isBlocked) return

    const currentValue = notificationState.preferences.messageNotificationsEnabled
    const nextValue = !currentValue

    try {
      await setMessageNotificationsEnabled(nextValue)
    } catch (error) {
      if (Number(error?.response?.status) !== 429) {
        logger.error('Failed to update notification preference:', error)
      }
    }
  }

  const normalizeDateKey = (dateString) => {
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return ''

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
  }

  const getMonthBadgeLabel = (yearMonthKey) => {
    if (!yearMonthKey) return ''

    const [yearString, monthString] = yearMonthKey.split('-')
    const year = Number(yearString)
    const month = Number(monthString) - 1
    const today = new Date()
    const currentYear = today.getFullYear()
    const currentMonth = today.getMonth()

    if (year === currentYear && month === currentMonth) return 'This Month'

    const previousMonthDate = new Date(currentYear, currentMonth - 1, 1)
    if (year === previousMonthDate.getFullYear() && month === previousMonthDate.getMonth()) return 'Last Month'

    const parsed = new Date(year, month, 1)
    return parsed.toLocaleDateString([], { month: 'long', year: 'numeric' })
  }

  const formatMediaDate = (dateString) => {
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return ''

    return date.toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  const sharedMedia = useMemo(() => {
    if (!selectedConversation?._id) return []

    const selectedConversationId = String(selectedConversation._id)

    return messages
      .filter((message) => Boolean(message?.mediaUrl))
      .filter((message) => String(message.conversation?._id || message.conversation) === selectedConversationId)
      .map((message) => ({
        id: message._id,
        mediaUrl: message.mediaUrl,
        createdAt: message.createdAt,
        senderId: String(message.sender?._id || message.sender || ''),
        senderName: message.sender?.fullName || 'Unknown',
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }, [messages, selectedConversation?._id])

  const groupedMedia = useMemo(() => {
    const groups = new Map()

    sharedMedia.forEach((item) => {
      const monthKey = normalizeDateKey(item.createdAt)
      if (!monthKey) return

      if (!groups.has(monthKey)) {
        groups.set(monthKey, [])
      }

      groups.get(monthKey).push(item)
    })

    return Array.from(groups.entries()).map(([monthKey, items]) => ({
      monthKey,
      label: getMonthBadgeLabel(monthKey),
      items,
    }))
  }, [sharedMedia])

  return (
    <div className="flex h-full min-w-0 w-full flex-col overflow-hidden bg-white">
      <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-5 flex-shrink-0 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-800">Contact Info</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            title="Close contact info"
          >
            Close
          </button>
        </div>
      </div>

      <div className="border-b border-gray-200 bg-white p-4 flex-shrink-0 min-w-0">
        <div className="flex flex-col items-center text-center min-w-0">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center mb-3 shadow-md shrink-0 overflow-hidden">
            {currentUser.profilePicture ? (
              <img src={currentUser.profilePicture} alt={currentUser.fullName} className="h-full w-full object-cover" loading="eager" decoding="async" fetchPriority="high" referrerPolicy="no-referrer" />
            ) : (
              <span className="text-white font-bold text-2xl">{getAvatarText(currentUser.fullName)}</span>
            )}
          </div>
          <h3 className="max-w-full truncate text-xl font-semibold text-gray-800">{currentUser.fullName}</h3>
          <p className={`text-sm font-medium ${showOnline ? 'text-green-500' : 'text-gray-500'}`}>
            <span className={`inline-block w-2 h-2 rounded-full mr-1 ${showOnline ? 'bg-green-500' : 'bg-gray-500'}`}></span>
            {showOnline ? 'Online' : 'Offline'}
          </p>
        </div>
      </div>

      <div className="bg-white border-b border-gray-200 flex-shrink-0 min-w-0">
        <div className="flex">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${activeTab === 'profile' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
          >
            Profile
          </button>
          <button
            onClick={() => setActiveTab('media')}
            className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${activeTab === 'media' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
          >
            Media
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-white scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
        {activeTab === 'profile' && (
          <div className="p-4 min-w-0 space-y-3">
            <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 shadow-sm">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">About</h4>
              <p className="text-sm leading-6 text-gray-800 break-words">{currentUser.bio || 'Hey there! I am using ChatApp.'}</p>
            </section>

            <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 shadow-sm">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Username</h4>
              <p className="text-sm text-gray-800">@{currentUser.username || 'username'}</p>
            </section>

            <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Notifications</h4>
                  <p className="mt-2 text-sm text-gray-700">Get alerts for new messages.</p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={notificationsEnabled}
                  aria-disabled={isNotificationSaving || isNotificationTemporarilyBlocked}
                  aria-label="Toggle message notifications"
                  disabled={isNotificationSaving || isNotificationTemporarilyBlocked}
                  onClick={handleNotificationToggle}
                  className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full border p-0.5 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-70 ${notificationsEnabled ? 'border-blue-500 bg-gradient-to-r from-blue-500 to-indigo-500' : 'border-slate-300 bg-slate-200'}`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform duration-200 ${notificationsEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
              </div>
              {notificationError ? (
                <p className="mt-2 text-xs text-amber-600">{notificationError}</p>
              ) : null}
            </section>

            <section className="rounded-xl border border-dashed border-gray-300 bg-gradient-to-r from-blue-50 to-indigo-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Contact Summary</p>
              <p className="mt-2 text-sm text-gray-700">Profile details are up to date and ready for conversation.</p>
            </section>
          </div>
        )}

        {activeTab === 'media' && (
          <div className="p-4 min-w-0 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium text-gray-500">Shared Media</h4>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700">
                {sharedMedia.length} files
              </span>
            </div>

            {groupedMedia.length > 0 ? (
              groupedMedia.map((group) => (
                <section key={group.monthKey} className="space-y-3">
                  <div className="flex items-center justify-start">
                    <span className="rounded-full bg-sky-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                      {group.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => window.open(item.mediaUrl, '_blank', 'noopener,noreferrer')}
                        className="group relative overflow-hidden rounded-2xl bg-gray-100 shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
                        title={`Open media from ${item.senderName}`}
                      >
                        <div className="aspect-square w-full overflow-hidden">
                          <img
                            src={item.mediaUrl}
                            alt={`Shared media from ${item.senderName}`}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                        </div>

                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-left">
                          <p className="truncate text-[11px] font-medium text-white">{item.senderName}</p>
                          <p className="text-[10px] text-white/80">{formatMediaDate(item.createdAt)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
                No shared media yet
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default RightSidebar

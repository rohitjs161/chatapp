import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../../store/auth.store.js'
import useConversationStore from '../../store/conversation.store.js'
import { discoverUsers } from '../../api/user.api.js'
import useOnlineUsers from '../../socket/useOnlineUsers.js'
import useActionLock from '../../hooks/useActionLock.js'

const normalizeId = (value) => String(value?._id || value?.id || value || '')

const formatConversationLabel = (dateString) => {
  if (!dateString) return 'New chat'

  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return 'New chat'

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffInDays = Math.floor((today - target) / (24 * 60 * 60 * 1000))

  if (diffInDays === 0) return 'Today'
  if (diffInDays === 1) return 'Yesterday'
  if (diffInDays >= 2 && diffInDays <= 6) {
    return date.toLocaleDateString([], { weekday: 'long' })
  }

  return date.toLocaleDateString('en-GB')
}

const LeftSidebar = ({ onUserSelect, selectedUser }) => {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [users, setUsers] = useState([])
  const [isUsersLoading, setIsUsersLoading] = useState(false)
  const [activeUserId, setActiveUserId] = useState(null)
  const { user, logout } = useAuthStore()
  const { isUserOnline } = useOnlineUsers()
  const { conversations, fetchConversations, openConversation, isLoading, error } = useConversationStore()
  const { isLocked: isLoggingOut, runLockedAction: runLogout } = useActionLock()

  useEffect(() => {
    const loadSidebarData = async () => {
      setIsUsersLoading(true)
      try {
        await fetchConversations()
        const response = await discoverUsers({ query: '', limit: 100 })
        setUsers(Array.isArray(response?.data) ? response.data : [])
      } catch {
        setUsers([])
      } finally {
        setIsUsersLoading(false)
      }
    }

    loadSidebarData()
  }, [fetchConversations])

  const handleLogout = async () => {
    if (isLoggingOut) return

    await runLogout(async () => {
      await logout()
      navigate('/login')
    })
  }

  const getOtherParticipant = (conv) => {
    const currentUserId = normalizeId(user?._id)

    return conv.participants?.find((participant) => {
      const participantId = normalizeId(participant)
      return participantId && participantId !== currentUserId
    })
  }

  const getAvatarText = (name) => {
    if (!name) return '?'
    const parts = name.trim().split(' ')
    return parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : name[0].toUpperCase()
  }

  const filteredUsers = users.filter((candidate) => {
    const value = searchTerm.trim().toLowerCase()
    if (!value) return true

    return [candidate.fullName, candidate.username, candidate.email]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(value))
  })

  const conversationByUserId = new Map(
    conversations
      .map((conv) => {
        const participant = getOtherParticipant(conv)
        const participantId = normalizeId(participant)
        return [participantId, conv]
      })
      .filter(([participantId]) => Boolean(participantId))
  )

  const getUnreadCount = (targetUserId) => {
    const conversation = conversationByUserId.get(normalizeId(targetUserId))

    const unreadValue =
      conversation?.unreadCount ??
      conversation?.unreadMessages ??
      conversation?.unread_message_count ??
      0

    const parsedUnread = Number(unreadValue)
    if (Number.isNaN(parsedUnread) || parsedUnread < 0) return 0

    return Math.floor(parsedUnread)
  }

  const getConversationTimeLabel = (conversation) => {
    const lastMessageDate = conversation?.lastMessage?.createdAt
    const fallbackDate = conversation?.updatedAt || conversation?.createdAt
    return formatConversationLabel(lastMessageDate || fallbackDate)
  }

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const aUnread = getUnreadCount(a._id)
    const bUnread = getUnreadCount(b._id)

    if (aUnread !== bUnread) {
      return bUnread - aUnread
    }

    const aOnline = isUserOnline(a._id)
    const bOnline = isUserOnline(b._id)

    if (aOnline === bOnline) {
      return (a.fullName || '').localeCompare(b.fullName || '')
    }

    return aOnline ? -1 : 1
  })

  const onlineSortedUsers = sortedUsers.filter((candidate) => isUserOnline(candidate._id))
  const offlineSortedUsers = sortedUsers.filter((candidate) => !isUserOnline(candidate._id))

  const handleUserClick = async (targetUser) => {
    if (!targetUser?._id || activeUserId) return

    const existingConversation = conversationByUserId.get(normalizeId(targetUser._id))
    if (existingConversation) {
      onUserSelect(existingConversation)
      return
    }

    try {
      setActiveUserId(targetUser._id)
      const conversation = await openConversation(targetUser._id)
      onUserSelect(conversation)
    } catch {
      // Store handles API errors
    } finally {
      setActiveUserId(null)
    }
  }

  return (
    <div className="flex w-full flex-col bg-gray-900 text-white h-full">
      <div className="border-b border-gray-700 p-4 sm:p-5 flex-shrink-0">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold sm:text-2xl">ChatApp</h1>
          <button
            onClick={() => navigate('/profile')}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors flex-shrink-0"
            title="Settings"
          >
            <svg className="w-5 h-5 text-gray-400 hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">🔍</span>
          <input
            type="text"
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-10 pr-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900 min-h-0">
        {isLoading || isUsersLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
          </div>
        ) : (
          <>
            {!selectedUser && sortedUsers.length > 0 && (
              <div className="border-b border-blue-700 bg-blue-900 p-4">
                <p className="text-blue-200 text-sm text-center">
                  👈 Click on a user below to start chatting
                </p>
              </div>
            )}

            {sortedUsers.length > 0 && (
              <>
                {onlineSortedUsers.length > 0 && (
                  <>
                    <div className="px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-green-400">Online</div>
                    <div className="grid gap-1 p-2 sm:grid-cols-2 md:grid-cols-1">
                      {onlineSortedUsers.map((candidate) => {
                        const existingConversation = conversationByUserId.get(normalizeId(candidate._id))
                        const unreadCount = getUnreadCount(candidate._id)
                        const isOpening = activeUserId === candidate._id

                        return (
                          <button
                            key={candidate._id}
                            type="button"
                            onClick={() => handleUserClick(candidate)}
                            disabled={isOpening}
                            className={`flex items-center gap-3 rounded-2xl p-3 text-left transition-colors md:rounded-xl ${
                              selectedUser?._id === existingConversation?._id
                                ? 'bg-sky-500/25'
                                : 'hover:bg-sky-500/10'
                            }`}
                          >
                            <div className="relative flex-shrink-0">
                              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-purple-500">
                                {candidate.profilePicture ? (
                                  <img src={candidate.profilePicture} alt={candidate.fullName} className="h-full w-full object-cover" loading="eager" decoding="async" fetchPriority="high" referrerPolicy="no-referrer" />
                                ) : (
                                  <span className="text-white font-bold">{getAvatarText(candidate.fullName)}</span>
                                )}
                              </div>
                              <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-gray-900 bg-green-500"></div>
                            </div>

                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <h3 className="truncate overflow-hidden text-ellipsis whitespace-nowrap font-semibold leading-5 text-white">
                                    {candidate.fullName || 'Unknown'}
                                  </h3>
                                  <p className="truncate overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 text-gray-400">
                                    @{candidate.username || 'user'}
                                  </p>
                                </div>
                                {unreadCount > 0 ? (
                                  <span className="ml-2 inline-flex shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                  </span>
                                ) : existingConversation && (
                                  <span className="ml-2 inline-flex min-w-[4.75rem] shrink-0 justify-end whitespace-nowrap pt-0.5 text-xs font-medium leading-none text-sky-300 sm:text-sm">
                                    {getConversationTimeLabel(existingConversation)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {isOpening && (
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}

                {offlineSortedUsers.length > 0 && (
                  <>
                    <div className="px-3 pt-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Offline</div>
                    <div className="grid gap-1 p-2 sm:grid-cols-2 md:grid-cols-1">
                      {offlineSortedUsers.map((candidate) => {
                        const existingConversation = conversationByUserId.get(normalizeId(candidate._id))
                        const unreadCount = getUnreadCount(candidate._id)
                        const isOpening = activeUserId === candidate._id

                        return (
                          <button
                            key={candidate._id}
                            type="button"
                            onClick={() => handleUserClick(candidate)}
                            disabled={isOpening}
                            className={`flex items-center gap-3 rounded-2xl p-3 text-left transition-colors md:rounded-xl ${
                              selectedUser?._id === existingConversation?._id
                                ? 'bg-sky-500/25'
                                : 'hover:bg-sky-500/10'
                            }`}
                          >
                            <div className="relative flex-shrink-0">
                              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-purple-500">
                                {candidate.profilePicture ? (
                                  <img src={candidate.profilePicture} alt={candidate.fullName} className="h-full w-full object-cover" loading="eager" decoding="async" fetchPriority="high" referrerPolicy="no-referrer" />
                                ) : (
                                  <span className="text-white font-bold">{getAvatarText(candidate.fullName)}</span>
                                )}
                              </div>
                            </div>

                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <h3 className="truncate overflow-hidden text-ellipsis whitespace-nowrap font-semibold leading-5 text-white">
                                    {candidate.fullName || 'Unknown'}
                                  </h3>
                                  <p className="truncate overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 text-gray-400">
                                    @{candidate.username || 'user'}
                                  </p>
                                </div>
                                {unreadCount > 0 ? (
                                  <span className="ml-2 inline-flex shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                  </span>
                                ) : existingConversation && (
                                  <span className="ml-2 inline-flex min-w-[4.75rem] shrink-0 justify-end whitespace-nowrap pt-0.5 text-xs font-medium leading-none text-sky-300 sm:text-sm">
                                    {getConversationTimeLabel(existingConversation)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {isOpening && (
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {sortedUsers.length === 0 && (
              <div className="p-4 mt-8 text-center text-sm text-gray-400">
                {searchTerm ? 'No users found' : 'No users available'}
              </div>
            )}

            {error && (
              <div className="px-3 pb-2 text-xs text-red-400">{error}</div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-gray-700 p-4 flex-shrink-0 bg-gray-900/95 backdrop-blur">
        <div className="space-y-3">
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="flex w-full cursor-pointer items-center rounded-xl border border-gray-700/70 bg-gray-800/70 px-3 py-3 text-left text-gray-200 shadow-sm transition-all hover:border-gray-600 hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="mr-3 flex h-9 w-9 items-center justify-center rounded-full bg-red-500/15 text-lg text-red-300">🚪</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-5">Logout</span>
              <span className="block text-xs text-gray-400">Securely sign out of your account</span>
            </span>
            <span className="text-gray-300">{isLoggingOut ? '...' : '›'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default LeftSidebar
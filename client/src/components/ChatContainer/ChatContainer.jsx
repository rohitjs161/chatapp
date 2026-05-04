import React, { useState, useRef, useEffect } from 'react'
import EmojiPicker from 'emoji-picker-react'
import useAuthStore from '../../store/auth.store.js'
import useConversationStore from '../../store/conversation.store.js'
import useMessageStore from '../../store/message.store.js'
import { getSocket } from '../../socket/socket.js'
import useOnlineUsers from '../../socket/useOnlineUsers.js'
import useActionLock from '../../hooks/useActionLock.js'
import useNotificationStore from '../../store/notification.store.js'
import { showMessageDesktopNotification } from '../../utils/desktopNotification.js'
import { logger } from '../../utils/logger.js'

const MESSAGE_CHAR_LIMIT = 1000
const REQUEST_PENDING_TEXT_LIMIT = 2
const normalizeId = (value) => String(value?._id || value?.id || value || '')
const DAY_IN_MS = 24 * 60 * 60 * 1000

const getStartOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

const getCalendarDayDiffFromToday = (dateValue) => {
  const targetDate = new Date(dateValue)
  if (Number.isNaN(targetDate.getTime())) return null

  const todayStart = getStartOfDay(new Date())
  const targetStart = getStartOfDay(targetDate)
  return Math.floor((todayStart - targetStart) / DAY_IN_MS)
}

const ChatContainer = () => {
  const [message, setMessage] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [activeMenuId, setActiveMenuId] = useState(null)
  const [hoveredMessageId, setHoveredMessageId] = useState(null)
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editText, setEditText] = useState('')
  const [typingUsers, setTypingUsers] = useState([])
  const [typingTimeout, setTypingTimeout] = useState(null)
  const [activeDateBadge, setActiveDateBadge] = useState('')
  const [isRequestActionLoading, setIsRequestActionLoading] = useState(false)
  const [localPendingTextSent, setLocalPendingTextSent] = useState(0)

  const menuRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const emojiPickerRef = useRef(null)
  const deliveredAckedMessageIdsRef = useRef(new Set())
  const typingExpiryTimersRef = useRef(new Map())
  const { isLocked: isMessageActionPending, runLockedAction: runMessageAction } = useActionLock()

  const scrollToBottom = (behavior = 'smooth') => {
    const container = messagesContainerRef.current
    if (!container) return

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    })
  }

  const { user } = useAuthStore()
  const { isUserOnline } = useOnlineUsers()
  const {
    selectedConversation,
    selectConversation,
    openConversation,
    updateLastMessage,
    resetUnreadCount,
    fetchConversations,
    acceptRequest,
    rejectRequest,
    updateConversationRequestState,
  } = useConversationStore()
  const {
    messages, isLoading, isSending,
    fetchMessages, sendText, sendMedia,
    editMsg, deleteMsg,
    addIncomingMessage, updateIncomingEdit, removeIncomingDelete,
    markRead, clearMessages,
    applyDeliveryReceipt, applyReadReceipt
  } = useMessageStore()
  const isMessageNotificationsEnabled = useNotificationStore((state) => state.preferences.messageNotificationsEnabled)

  // Fetch messages when conversation changes
  useEffect(() => {
    setTypingUsers([])
    setLocalPendingTextSent(0)

    typingExpiryTimersRef.current.forEach((timerId) => {
      clearTimeout(timerId)
    })
    typingExpiryTimersRef.current.clear()

    const activeConversationId = normalizeId(selectedConversation?._id)
    if (!activeConversationId) return

    // Guard against stale selection (e.g., after account switch or deleted conversation)
    const hasConversationAccess = useConversationStore.getState().conversations.some(
      (conversation) => normalizeId(conversation?._id) === activeConversationId
    )

    if (!hasConversationAccess) {
      clearMessages()
      selectConversation(null)
      return
    }

    deliveredAckedMessageIdsRef.current.clear()
    clearMessages()
    fetchMessages(activeConversationId).catch((error) => {
      const status = Number(error?.response?.status)

      // Conversation no longer accessible or removed
      if (status === 403 || status === 404) {
        clearMessages()
        selectConversation(null)
        return
      }

      logger.error('Failed to fetch messages:', error)
    })

    const socket = getSocket()
    if (socket) {
      socket.emit('join-conversation', activeConversationId, (response) => {
        if (response?.success === false) {
          if (response?.code === 'CONV_ACCESS_DENIED' || response?.code === 'INVALID_CONV_ID') {
            clearMessages()
            selectConversation(null)
            return
          }

          logger.error('Failed to join conversation:', response?.message || 'Unknown error')
        }
      })
    }

    markRead(activeConversationId)
    resetUnreadCount(activeConversationId)

    return () => {
      if (socket) {
        socket.emit('leave-conversation', activeConversationId, (response) => {
          if (response?.success === false) {
            // Ignore stale leave errors; selection may have been reset locally.
            if (response?.code === 'CONV_ACCESS_DENIED' || response?.code === 'INVALID_CONV_ID') {
              return
            }

            logger.error('Failed to leave conversation:', response?.message || 'Unknown error')
          }
        })
      }
    }
  }, [
    addIncomingMessage,
    clearMessages,
    fetchMessages,
    markRead,
    resetUnreadCount,
    selectConversation,
    selectedConversation?._id,
    updateLastMessage
  ])

  // Socket events
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const typingTimers = typingExpiryTimersRef.current

    socket.on('receive-message', (incomingMessage) => {
      // Validate incoming message has required conversation info
      if (!incomingMessage) return

      const incomingConversationId = normalizeId(incomingMessage.conversation?._id || incomingMessage.conversation)
      const currentConversationId = normalizeId(selectedConversation?._id)

      // Safety check: ensure we have valid conversation IDs before proceeding
      if (!incomingConversationId) return

      showMessageDesktopNotification({
        incomingMessage,
        currentConversationId: selectedConversation?._id,
        currentUserId: user?._id,
        isMessageNotificationsEnabled,
      })

      // Always update last message in conversation list
      updateLastMessage(
        incomingMessage.conversation?._id || incomingMessage.conversation,
        incomingMessage
      )

      // Only add message to the chat if it belongs to the currently open conversation
      // AND we actually have a currently selected conversation
      const isMessageForCurrentChat = currentConversationId && incomingConversationId === currentConversationId
      
      if (isMessageForCurrentChat) {
        addIncomingMessage(incomingMessage)

        if (incomingMessage.sender?._id !== user?._id) {
          socket.emit('mark-delivered', {
            conversationId: incomingConversationId,
            messageIds: [incomingMessage._id],
          })
        }

        markRead(selectedConversation._id)
        resetUnreadCount(selectedConversation._id)
      } else {
        // Message is for a different conversation - don't add to store, just update conversation list
        if (incomingMessage.sender?._id !== user?._id) {
          const hasConversation = useConversationStore
            .getState()
            .conversations
            .some((conversation) => normalizeId(conversation._id) === incomingConversationId)

          if (!hasConversation) {
            fetchConversations()
          }
        }
      }
    })

    socket.on('message-edited', (updatedMessage) => {
      updateIncomingEdit(updatedMessage)
    })

    socket.on('message-deleted', ({ messageId }) => {
      removeIncomingDelete(messageId)
    })

    socket.on('messages-delivered', ({ conversationId, userId: deliveryUserId, messageIds }) => {
      applyDeliveryReceipt(conversationId, deliveryUserId, messageIds)
    })

    socket.on('messages-read', ({ conversationId, userId: readerUserId, messageIds }) => {
      applyReadReceipt(conversationId, readerUserId, messageIds)
    })

    socket.on('user-typing', ({ userId, fullName, conversationId }) => {
      const incomingConversationId = normalizeId(conversationId)
      const activeConversationId = normalizeId(selectedConversation?._id)
      if (incomingConversationId && incomingConversationId !== activeConversationId) return

      setTypingUsers(prev => {
        if (prev.find(u => u.userId === userId)) return prev
        return [...prev, { userId, fullName }]
      })

      const existingTimer = typingExpiryTimersRef.current.get(String(userId))
      if (existingTimer) clearTimeout(existingTimer)

      const nextTimer = setTimeout(() => {
        setTypingUsers(prev => prev.filter(u => String(u.userId) !== String(userId)))
        typingExpiryTimersRef.current.delete(String(userId))
      }, 2200)

      typingExpiryTimersRef.current.set(String(userId), nextTimer)
    })

    socket.on('user-stop-typing', ({ userId, conversationId }) => {
      const incomingConversationId = normalizeId(conversationId)
      const activeConversationId = normalizeId(selectedConversation?._id)
      if (incomingConversationId && incomingConversationId !== activeConversationId) return

      setTypingUsers(prev => prev.filter(u => String(u.userId) !== String(userId)))

      const existingTimer = typingExpiryTimersRef.current.get(String(userId))
      if (existingTimer) {
        clearTimeout(existingTimer)
        typingTimers.delete(String(userId))
      }
    })

    return () => {
      socket.off('receive-message')
      socket.off('message-edited')
      socket.off('message-deleted')
      socket.off('messages-delivered')
      socket.off('messages-read')
      socket.off('user-typing')
      socket.off('user-stop-typing')

      typingTimers.forEach((timerId) => {
        clearTimeout(timerId)
      })
      typingTimers.clear()
    }
  }, [
    applyDeliveryReceipt,
    applyReadReceipt,
    fetchConversations,
    markRead,
    removeIncomingDelete,
    resetUnreadCount,
    selectedConversation?._id,
    updateIncomingEdit,
    updateLastMessage,
    addIncomingMessage,
    user?._id,
    isMessageNotificationsEnabled
  ])

  useEffect(() => {
    if (!selectedConversation?._id || !user?._id || messages.length === 0) return

    const socket = getSocket()
    if (!socket) return

    const pendingMessageIds = messages
      .filter((messageItem) => {
        if (!messageItem?._id) return false
        if (messageItem.sender?._id === user._id) return false

        const deliveredToIds = Array.isArray(messageItem.deliveredTo)
          ? messageItem.deliveredTo.map((id) => String(id?._id || id))
          : []

        if (deliveredToIds.includes(String(user._id))) return false
        if (deliveredAckedMessageIdsRef.current.has(String(messageItem._id))) return false

        return true
      })
      .map((messageItem) => String(messageItem._id))

    if (pendingMessageIds.length === 0) return

    pendingMessageIds.forEach((messageId) => deliveredAckedMessageIdsRef.current.add(messageId))

    socket.emit('mark-delivered', {
      conversationId: selectedConversation._id,
      messageIds: pendingMessageIds,
    }, (response) => {
      if (response?.success === false) {
        pendingMessageIds.forEach((messageId) => deliveredAckedMessageIdsRef.current.delete(messageId))
      }
    })
  }, [messages, selectedConversation?._id, user?._id])

  // Close menu on outside click
  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setActiveMenuId(null)
      }
    }
    if (activeMenuId) document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [activeMenuId])

  // Close emoji picker on outside click
  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        setShowEmojiPicker(false)
      }
    }
    if (showEmojiPicker) document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [showEmojiPicker])

  // Keep chat pinned to latest messages when messages update.
  useEffect(() => {
    if (!selectedConversation?._id || isLoading) return

    requestAnimationFrame(() => {
      scrollToBottom('smooth')
    })
  }, [messages, isLoading, selectedConversation?._id])

  // Jump to bottom immediately when a conversation is opened.
  useEffect(() => {
    if (!selectedConversation?._id) return

    requestAnimationFrame(() => {
      scrollToBottom('auto')
    })
  }, [selectedConversation?._id])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container || !selectedConversation?._id || isLoading) {
      setActiveDateBadge('')
      return
    }

    const updateActiveBadge = () => {
      const anchors = container.querySelectorAll('[data-date-separator="true"]')
      if (!anchors.length) {
        setActiveDateBadge('')
        return
      }

      const currentScrollTop = container.scrollTop
      if (currentScrollTop <= 2) {
        setActiveDateBadge('')
        return
      }

      const threshold = currentScrollTop + 12
      let activeLabel = anchors[0].getAttribute('data-date-label') || ''
      let activeAnchor = anchors[0]

      anchors.forEach((anchor) => {
        if (anchor.offsetTop <= threshold) {
          activeLabel = anchor.getAttribute('data-date-label') || activeLabel
          activeAnchor = anchor
        }
      })

      // WhatsApp-like behavior: hide floating chip near section start,
      // show it only after scrolling enough past the inline day chip.
      const STICKY_ACTIVATION_OFFSET = 44
      const distancePastAnchor = currentScrollTop - activeAnchor.offsetTop
      const shouldShowSticky = distancePastAnchor > STICKY_ACTIVATION_OFFSET

      setActiveDateBadge(shouldShowSticky ? activeLabel : '')
    }

    let rafId = null
    const handleScroll = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        updateActiveBadge()
      })
    }

    updateActiveBadge()
    container.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [messages, selectedConversation?._id, isLoading])

  const emitTyping = () => {
    const socket = getSocket()
    if (socket && selectedConversation?._id) {
      socket.emit('typing', { conversationId: selectedConversation._id })
    }
  }

  const stopTypingEmit = () => {
    const socket = getSocket()
    if (socket && selectedConversation?._id) {
      socket.emit('stop-typing', { conversationId: selectedConversation._id })
    }
    if (typingTimeout) {
      clearTimeout(typingTimeout)
      setTypingTimeout(null)
    }
  }

  const scheduleStopTyping = (delayMs = 1500) => {
    if (typingTimeout) clearTimeout(typingTimeout)
    const timeout = setTimeout(stopTypingEmit, delayMs)
    setTypingTimeout(timeout)
  }

  const handleSendMessage = async (e) => {
    e.preventDefault()
    const trimmedMessage = message.trim()
    if (!trimmedMessage || !selectedConversation?._id || isSending || !canSendText) return

    setMessage('')
    stopTypingEmit()
    
    // Immediately update local pending text count for pending requests
    if (isPendingRequest && isRequestSender) {
      setLocalPendingTextSent(prev => prev + 1)
    }

    try {
      const sentMessage = await sendText(selectedConversation._id, trimmedMessage)
      updateLastMessage(selectedConversation._id, sentMessage)

      requestAnimationFrame(() => {
        scrollToBottom('smooth')
      })
    } catch (error) {
      logger.error('Failed to send message:', error)
      // Revert local count on error
      if (isPendingRequest && isRequestSender) {
        setLocalPendingTextSent(prev => Math.max(0, prev - 1))
      }
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage(e)
    }
  }

  const handleMediaClick = () => {
    if (!canSendMedia) return

    if (selectedConversation && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const handleFileSelect = async (e) => {
    const file = e.target.files[0]
    if (!file || !selectedConversation?._id || !canSendMedia) {
      e.target.value = ''
      return
    }

    emitTyping()
    scheduleStopTyping(2500)

    try {
      const sentMessage = await sendMedia(selectedConversation._id, '', file)
      updateLastMessage(selectedConversation._id, sentMessage)

      if (isPendingRequest && isRequestSender) {
        updateConversationRequestState(selectedConversation._id, {
          pendingMessageCount: Math.min(REQUEST_PENDING_MEDIA_LIMIT, pendingMediaMessagesSent + 1),
        })
      }

      requestAnimationFrame(() => {
        scrollToBottom('smooth')
      })
    } catch (error) {
      logger.error('Failed to send media:', error)
    } finally {
      stopTypingEmit()
    }

    e.target.value = ''
  }

  const handleDeleteMessage = async (messageId) => {
    if (isMessageActionPending) return

    try {
      await runMessageAction(async () => {
        await deleteMsg(messageId)
        setActiveMenuId(null)
      })
    } catch (error) {
      logger.error('Failed to delete message:', error)
    }
  }

  const getFileNameFromUrl = (url) => {
    try {
      const parsedUrl = new URL(url)
      const fileName = parsedUrl.pathname.split('/').filter(Boolean).pop()
      return fileName || 'chat-media'
    } catch {
      return 'chat-media'
    }
  }

  const handleDownloadMedia = async (mediaUrl) => {
    if (isMessageActionPending) return

    try {
      await runMessageAction(async () => {
        const response = await fetch(mediaUrl, { mode: 'cors' })
        if (!response.ok) {
          throw new Error('Failed to download media')
        }

        const blob = await response.blob()
        const blobUrl = window.URL.createObjectURL(blob)
        const downloadLink = document.createElement('a')
        downloadLink.href = blobUrl
        downloadLink.download = getFileNameFromUrl(mediaUrl)
        document.body.appendChild(downloadLink)
        downloadLink.click()
        downloadLink.remove()
        window.URL.revokeObjectURL(blobUrl)
        setActiveMenuId(null)
      })
    } catch (error) {
      logger.error('Failed to download media:', error)
    }
  }

  const handleStartEdit = (msg) => {
    if (isMessageActionPending) return

    setEditingMessageId(msg._id)
    setEditText((msg.content || '').slice(0, MESSAGE_CHAR_LIMIT))
    setActiveMenuId(null)
  }

  const handleSaveEdit = async (messageId) => {
    if (!editText.trim()) return

    if (isMessageActionPending) return

    try {
      await runMessageAction(async () => {
        await editMsg(messageId, editText.trim())
        setEditingMessageId(null)
        setEditText('')
      })
    } catch (error) {
      logger.error('Failed to edit message:', error)
    }
  }

  const handleCancelEdit = () => {
    setEditingMessageId(null)
    setEditText('')
  }

  const handleEmojiToggle = () => {
    if (!canSendText) return
    setShowEmojiPicker(prev => !prev)
  }

  const handleEmojiSelect = (emojiData) => {
    setMessage(prev => `${prev}${emojiData.emoji}`.slice(0, MESSAGE_CHAR_LIMIT))
    emitTyping()
    scheduleStopTyping(1500)
    setShowEmojiPicker(false)
  }

  const handleMessageChange = (e) => {
    setMessage(e.target.value.slice(0, MESSAGE_CHAR_LIMIT))
    emitTyping()
    scheduleStopTyping(1500)
  }

  const isEmojiOnlyMessage = (text) => {
    const value = text?.trim()
    if (!value) return false
    const hasEmoji = /\p{Emoji}/u.test(value)
    const hasAlphaNumeric = /[\p{L}\p{N}]/u.test(value)
    return hasEmoji && !hasAlphaNumeric
  }

  const getOtherParticipant = () => {
    return selectedConversation?.participants?.find(p => p._id !== user?._id)
  }

  const getAvatarText = (name) => {
    if (!name) return '?'
    const parts = name.trim().split(' ')
    return parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : name[0].toUpperCase()
  }

  const formatMessageTime = (dateString) => {
    if (!dateString) return ''

    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return ''

    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  }

  const getLocalDateKey = (dateString) => {
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return ''

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const getDateLabel = (dateString) => {
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return ''

    const diffInDays = getCalendarDayDiffFromToday(date)
    if (diffInDays === null) return ''

    if (diffInDays === 0) return 'Today'
    if (diffInDays === 1) return 'Yesterday'

    if (diffInDays > 1 && diffInDays < 7) {
      return date.toLocaleDateString([], { weekday: 'long' })
    }

    return date.toLocaleDateString([], {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const otherUser = getOtherParticipant()
  const otherUserId = normalizeId(otherUser?._id)
  const isOtherUserOnline = isUserOnline(otherUser?._id)
  const selectedConversationStatus = selectedConversation?.status || 'accepted'
  const isConversationAccepted = selectedConversationStatus === 'accepted'
  const isPendingRequest = Boolean(selectedConversation && selectedConversationStatus === 'pending')
  const isRequestExpired = Boolean(selectedConversation && selectedConversationStatus === 'expired')
  const isRequestRejected = Boolean(selectedConversation && selectedConversationStatus === 'rejected')
  const isRequestSender = normalizeId(selectedConversation?.initiator) === normalizeId(user?._id)
  const isPendingReceiver = isPendingRequest && !isRequestSender
  const pendingTextMessagesSent = Number(selectedConversation?.pendingMessageCount || 0) + localPendingTextSent
  const pendingTextMessagesLeft = Math.max(0, REQUEST_PENDING_TEXT_LIMIT - pendingTextMessagesSent)
  const canSendText = Boolean(
    selectedConversation && (
      isConversationAccepted ||
      (isPendingRequest && isRequestSender && pendingTextMessagesLeft > 0)
    )
  )
  const canSendMedia = Boolean(selectedConversation && isConversationAccepted)

  const inputPlaceholder = !selectedConversation
    ? 'Select a user to start chatting'
    : isRequestExpired
      ? 'Request expired'
      : isRequestRejected
        ? 'Request rejected'
        : isPendingReceiver
          ? 'Accept request to reply'
          : isPendingRequest
            ? (isRequestSender && pendingTextMessagesLeft > 0
                ? `You can send ${pendingTextMessagesLeft} text message${pendingTextMessagesLeft === 1 ? '' : 's'} before approval`
                : 'Waiting for request approval')
            : 'Type a message...'

  // Reset local pending text count when conversation is accepted
  useEffect(() => {
    if (isConversationAccepted) {
      setLocalPendingTextSent(0)
    }
  }, [isConversationAccepted])

  const handleAcceptRequest = async () => {
    if (!selectedConversation?._id || isRequestActionLoading) return

    try {
      setIsRequestActionLoading(true)
      await acceptRequest(selectedConversation._id)
    } catch (error) {
      logger.error('Failed to accept request:', error)
    } finally {
      setIsRequestActionLoading(false)
    }
  }

  const handleRejectRequest = async () => {
    if (!selectedConversation?._id || isRequestActionLoading) return

    try {
      setIsRequestActionLoading(true)
      await rejectRequest(selectedConversation._id)
    } catch (error) {
      logger.error('Failed to reject request:', error)
    } finally {
      setIsRequestActionLoading(false)
    }
  }

  const handleResendRequest = async () => {
    if (!otherUserId || !isRequestSender || isRequestActionLoading) return

    try {
      setIsRequestActionLoading(true)
      await openConversation(otherUserId)
    } catch (error) {
      logger.error('Failed to resend request:', error)
    } finally {
      setIsRequestActionLoading(false)
    }
  }

  const hasMessageActions = (msg) => {
    return Boolean(msg?._id)
  }

  const MessageActionMenu = ({ msg, isSender }) => {
    const showEdit = isConversationAccepted && !msg.mediaUrl && isSender
    const showDownload = Boolean(msg.mediaUrl && isConversationAccepted)
    const showDelete = isConversationAccepted && Boolean(msg?._id)
    const actionCount = [showEdit, showDownload, showDelete].filter(Boolean).length

    if (actionCount === 0) return null

    let itemIndex = 0

    const getItemClassName = (isDanger = false) => {
      itemIndex += 1
      const isLast = itemIndex === actionCount
      return `w-full px-4 py-2 text-sm text-left transition-colors ${
        isDanger
          ? 'text-red-600 hover:bg-red-50'
          : 'text-gray-700 hover:bg-gray-100'
      } ${isLast ? '' : 'border-b border-gray-100'}`
    }

    const menuPositionClass = isSender
      ? 'right-0 -top-2'
      : 'left-full top-0 ml-2'

    return (
      <div
        ref={menuRef}
        className={`absolute ${menuPositionClass} bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden`}
        style={{ minWidth: '140px' }}
      >
        {showEdit && (
          <button
            onClick={() => handleStartEdit(msg)}
            disabled={isMessageActionPending}
            className={`${getItemClassName()} ${isMessageActionPending ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            ✏️ Edit
          </button>
        )}
        {showDownload && (
          <button
            onClick={() => handleDownloadMedia(msg.mediaUrl)}
            disabled={isMessageActionPending}
            className={`${getItemClassName()} ${isMessageActionPending ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            ⬇️ Download
          </button>
        )}
        {showDelete && (
          <button
            onClick={() => handleDeleteMessage(msg._id)}
            disabled={isMessageActionPending}
            className={`${getItemClassName(true)} ${isMessageActionPending ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            🗑️ Delete
          </button>
        )}
      </div>
    )
  }

  const currentUser = otherUser
    ? { name: otherUser.fullName, avatar: getAvatarText(otherUser.fullName), profilePicture: otherUser.profilePicture }
    : { name: 'Select a User', avatar: '?' }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-5 flex-shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center mr-3 overflow-hidden">
            {currentUser.profilePicture ? (
              <img src={currentUser.profilePicture} alt={currentUser.name} className="h-full w-full object-cover" loading="eager" decoding="async" fetchPriority="high" referrerPolicy="no-referrer" />
            ) : (
              <span className="text-white font-bold">{currentUser.avatar}</span>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-gray-800">{currentUser.name}</h3>
            {typingUsers.length > 0 ? (
              <p className="text-sm text-blue-500 italic">typing...</p>
            ) : (
              <p className={`text-sm ${selectedConversation ? (isOtherUserOnline ? 'text-green-500' : 'text-gray-500') : 'text-gray-500'}`}>
                {selectedConversation ? (isOtherUserOnline ? 'Online' : 'Offline') : 'Select a user to start chatting'}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2"></div>
      </div>

      {/* Messages */}
      {selectedConversation && (isPendingRequest || isRequestExpired || isRequestRejected) && (
        <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
          {isPendingReceiver && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">Message Request</p>
              <p className="mt-1 text-xs text-amber-800">{otherUser?.fullName || 'User'} wants to chat with you.</p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAcceptRequest}
                  disabled={isRequestActionLoading}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRequestActionLoading ? 'Please wait...' : 'Accept'}
                </button>
                <button
                  type="button"
                  onClick={handleRejectRequest}
                  disabled={isRequestActionLoading}
                  className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {isPendingRequest && isRequestSender && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
              <p className="text-sm font-semibold text-blue-900">Request Sent</p>
              <p className="mt-1 text-xs text-blue-800">
                You can send {pendingTextMessagesLeft} text message{pendingTextMessagesLeft === 1 ? '' : 's'} before approval.
              </p>
            </div>
          )}

          {isRequestExpired && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-sm font-semibold text-rose-900">Request Expired</p>
              <p className="mt-1 text-xs text-rose-800">Please send request again.</p>
              {isRequestSender && (
                <button
                  type="button"
                  onClick={handleResendRequest}
                  disabled={isRequestActionLoading}
                  className="mt-3 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRequestActionLoading ? 'Please wait...' : 'Send Request'}
                </button>
              )}
            </div>
          )}

          {isRequestRejected && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Request Rejected</p>
              <p className="mt-1 text-xs text-slate-700">This chat request was rejected.</p>
              {isRequestSender && (
                <button
                  type="button"
                  onClick={handleResendRequest}
                  disabled={isRequestActionLoading}
                  className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRequestActionLoading ? 'Please wait...' : 'Send Request'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div
        ref={messagesContainerRef}
        className={`flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-blue-300 scrollbar-track-gray-100 px-3 py-4 sm:px-4 sm:py-5 space-y-4 ${selectedConversation ? 'bg-gray-50' : 'bg-slate-50'}`}
      >
        {selectedConversation ? (
          isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
            </div>
          ) : (
            <>
              {activeDateBadge && (
                <div className="sticky top-2 z-40 mb-2 flex justify-center pointer-events-none">
                  <span className="rounded-full border border-slate-200 bg-white/95 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm backdrop-blur select-none">
                    {activeDateBadge}
                  </span>
                </div>
              )}

              {messages.map((msg, index) => {
                const currentDateKey = getLocalDateKey(msg.createdAt)
                const previousDateKey = index > 0 ? getLocalDateKey(messages[index - 1]?.createdAt) : ''
                const showDateSeparator = Boolean(currentDateKey && currentDateKey !== previousDateKey)
                const dateLabel = showDateSeparator ? getDateLabel(msg.createdAt) : ''
                const isEmojiOnly = isEmojiOnlyMessage(msg.content)
                const isSender = msg.sender?._id === user?._id
                const isHovered = hoveredMessageId === msg._id
                const isEditing = editingMessageId === msg._id
                const canShowMenuTrigger = hasMessageActions(msg)
                const readByIds = Array.isArray(msg.readBy)
                  ? msg.readBy.map((reader) => String(reader?._id || reader))
                  : []
                const deliveredToIds = Array.isArray(msg.deliveredTo)
                  ? msg.deliveredTo.map((receiver) => String(receiver?._id || receiver))
                  : []
                const hasSeen = isSender
                  ? (otherUserId ? readByIds.includes(otherUserId) : readByIds.length > 1)
                  : false
                const hasDelivered = isSender
                  ? (!hasSeen && (
                      (otherUserId ? deliveredToIds.includes(otherUserId) : deliveredToIds.length > 1)
                      || isOtherUserOnline
                    ))
                  : false
                const messageStatus = hasSeen ? 'seen' : hasDelivered ? 'delivered' : 'sent'
                const tickSymbol = messageStatus === 'sent' ? '✓' : '✓✓'
                const tickTitle = messageStatus === 'seen'
                  ? 'Seen'
                  : messageStatus === 'delivered'
                    ? 'Delivered'
                    : 'Sent'
                const tickClassName = messageStatus === 'seen'
                  ? (isEmojiOnly ? 'text-emerald-600' : 'text-emerald-300')
                  : (isEmojiOnly ? 'text-slate-500' : 'text-blue-100')
                const tickFontWeight = messageStatus === 'seen' ? 'font-bold' : 'font-semibold'

                return (
                  <React.Fragment key={msg._id || `${msg.createdAt}-${index}`}>
                    {showDateSeparator && dateLabel && (
                      <>
                        <div
                          data-date-separator="true"
                          data-date-label={dateLabel}
                          className="h-1"
                          aria-hidden="true"
                        />
                        <div className="my-2 flex justify-center pointer-events-none">
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm select-none">
                            {dateLabel}
                          </span>
                        </div>
                      </>
                    )}

                    <div className={`flex ${isSender ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className="relative"
                        onMouseEnter={() => setHoveredMessageId(msg._id)}
                        onMouseLeave={() => setHoveredMessageId(null)}
                      >
                        <div
                          className={`${isEmojiOnly ? '' : 'max-w-[85%] sm:max-w-sm lg:max-w-md px-4 py-2 rounded-2xl shadow-sm'} ${
                            isEmojiOnly
                              ? 'bg-transparent border-0 shadow-none p-0'
                              : isSender
                                ? 'bg-blue-500 text-white'
                                : 'bg-white text-gray-800 border border-gray-200'
                          }`}
                        >
                          {msg.mediaUrl ? (
                            <div className="space-y-2">
                              <img
                                src={msg.mediaUrl}
                                alt="media"
                                className="max-w-full h-auto rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => window.open(msg.mediaUrl, '_blank')}
                              />
                            </div>
                          ) : isEditing ? (
                            <div className="space-y-2">
                              <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value.slice(0, MESSAGE_CHAR_LIMIT))}
                                maxLength={MESSAGE_CHAR_LIMIT}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-gray-800 bg-white"
                                rows="3"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleSaveEdit(msg._id)}
                                  disabled={isMessageActionPending}
                                  className="flex-1 px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isMessageActionPending ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  onClick={handleCancelEdit}
                                  disabled={isMessageActionPending}
                                  className="flex-1 px-3 py-1 bg-gray-400 hover:bg-gray-500 text-white rounded text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className={isEmojiOnly ? 'text-4xl leading-tight' : 'text-sm whitespace-pre-wrap break-words'}>
                              {msg.content}
                            </p>
                          )}

                          <div className={`flex items-center justify-between mt-1 ${
                            isEmojiOnly ? 'text-gray-500' : isSender ? 'text-blue-100' : 'text-gray-500'
                          }`}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs">{formatMessageTime(msg.createdAt)}</span>
                              {msg.isEdited && !isEmojiOnly && (
                                <span className={`text-[11px] italic ${isSender ? 'text-blue-100' : 'text-gray-400'}`}>
                                  edited
                                </span>
                              )}
                            </div>
                            {isSender && !isEditing && (
                              <span title={tickTitle} className={`text-xs ml-2 ${tickFontWeight} ${tickClassName}`}>
                                {tickSymbol}
                              </span>
                            )}
                          </div>
                        </div>

                        {isHovered && !isEditing && canShowMenuTrigger && (
                          <button
                            onClick={() => setActiveMenuId(activeMenuId === msg._id ? null : msg._id)}
                            className="absolute -top-3 -right-3 p-2 rounded-full hover:bg-gray-200 transition-colors shadow-md bg-white border border-gray-200 flex items-center justify-center"
                            title="Message options"
                          >
                            <span className="text-lg">⋮</span>
                          </button>
                        )}

                        {activeMenuId === msg._id && canShowMenuTrigger && (
                          <MessageActionMenu msg={msg} isSender={isSender} />
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}
              <div ref={messagesEndRef} />
            </>
          )
        ) : (
          <div className="relative flex h-full min-h-[420px] items-center justify-center overflow-hidden bg-[linear-gradient(180deg,_#fcfdff_0%,_#f5f9ff_52%,_#eef4ff_100%)] px-4 py-6 sm:px-8 sm:py-8">
            <div className="pointer-events-none absolute left-0 top-0 h-48 w-48 rounded-full bg-blue-100/35 blur-3xl"></div>
            <div className="pointer-events-none absolute bottom-0 right-0 h-56 w-56 rounded-full bg-indigo-100/30 blur-3xl"></div>

            <div className="relative flex max-w-xl flex-col items-center text-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-blue-500 text-3xl text-white shadow-lg shadow-blue-500/20">
                💬
              </div>
              <h3 className="text-2xl font-semibold tracking-tight text-slate-800 sm:text-3xl">
                Select a chat to start messaging
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-500 sm:text-base">
                Pick a contact from the sidebar and start a private one-to-one conversation.
              </p>
              <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                Messages are personal and secure
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-3 py-3 sm:px-4 flex-shrink-0">
        <form onSubmit={handleSendMessage} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
          <button
            type="button"
            onClick={handleMediaClick}
            className={`self-start p-2 rounded-lg transition-colors ${canSendMedia ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed'}`}
            disabled={!canSendMedia}
            title="Attach file"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="relative flex-1 min-w-0">
            <textarea
              value={message}
              onChange={handleMessageChange}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              disabled={!canSendText}
              rows={1}
              maxLength={MESSAGE_CHAR_LIMIT}
              className={`w-full resize-none rounded-lg border border-transparent bg-gray-100 px-4 py-3 pr-12 text-sm leading-5 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${!canSendText ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
            {showEmojiPicker && canSendText && (
              <div
                ref={emojiPickerRef}
                className="absolute bottom-12 right-0 z-20 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
              >
                <EmojiPicker
                  onEmojiClick={handleEmojiSelect}
                  width={320}
                  height={380}
                  searchDisabled={false}
                  skinTonesDisabled={false}
                  previewConfig={{ showPreview: false }}
                />
              </div>
            )}
            <button
              type="button"
              onClick={handleEmojiToggle}
              className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 transition-colors ${canSendText ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'}`}
              disabled={!canSendText}
            >
              <span className="text-gray-600">😊</span>
            </button>
          </div>

          <button
            type="submit"
            disabled={!message.trim() || !canSendText || isSending}
            className={`self-end rounded-lg p-3 transition-colors sm:self-auto ${
              message.trim() && canSendText && !isSending
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isSending ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent"></div>
            ) : (
              <span>➤</span>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}

export default ChatContainer

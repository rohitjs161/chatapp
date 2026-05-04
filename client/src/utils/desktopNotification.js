const NOTIFICATION_CHANNEL_NAME = 'chatapp:desktop-notifications'
const recentlyNotifiedMessageIds = new Set()

const notificationChannel =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(NOTIFICATION_CHANNEL_NAME)
    : null

if (notificationChannel) {
  notificationChannel.addEventListener('message', (event) => {
    const messageId = String(event?.data?.messageId || '')
    if (!messageId) return
    recentlyNotifiedMessageIds.add(messageId)
  })
}

const normalizeId = (value) => String(value?._id || value || '')
const URL_IN_TEXT_REGEX = /https?:\/\/[^\s]+/gi
const WWW_LINK_REGEX = /\bwww\.[^\s]+/gi
const LOCAL_ENDPOINT_REGEX = /\b(?:localhost\d*|localhost:\d+|127\.0\.0\.1(?::\d+)?|0\.0\.0\.0(?::\d+)?)\b/i
const IPV4_ENDPOINT_REGEX = /\b\d{1,3}(?:\.\d{1,3}){3}:\d+\b/gi

const sanitizeNotificationText = (value = '', fallback = '') => {
  const text = String(value || '').trim()
  if (!text) return fallback

  const hasLocalEndpoint = LOCAL_ENDPOINT_REGEX.test(text)
  if (hasLocalEndpoint) {
    return fallback
  }

  const withMaskedLinks = text
    .replace(URL_IN_TEXT_REGEX, '')
    .replace(WWW_LINK_REGEX, '')
    .replace(IPV4_ENDPOINT_REGEX, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  return withMaskedLinks || fallback
}

export const requestDesktopNotificationPermission = async () => {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported'
  }

  if (Notification.permission === 'granted') {
    return 'granted'
  }

  if (Notification.permission === 'denied') {
    return 'denied'
  }

  return Notification.requestPermission()
}

const shouldDisplayDesktopNotification = ({
  incomingMessage,
  currentConversationId,
  currentUserId,
  isMessageNotificationsEnabled,
}) => {
  if (!isMessageNotificationsEnabled) return false
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false
  if (Notification.permission !== 'granted') return false

  const messageId = normalizeId(incomingMessage?._id)
  if (!messageId) return false
  if (recentlyNotifiedMessageIds.has(messageId)) return false

  const senderId = normalizeId(incomingMessage?.sender)
  if (senderId && currentUserId && senderId === normalizeId(currentUserId)) return false

  const incomingConversationId = normalizeId(incomingMessage?.conversation)
  const activeConversationId = normalizeId(currentConversationId)

  // Show desktop notifications for background tabs or messages from non-active chats.
  const isBackgroundTab = document.visibilityState !== 'visible'
  const isDifferentConversation = incomingConversationId && incomingConversationId !== activeConversationId

  return isBackgroundTab || isDifferentConversation
}

export const showMessageDesktopNotification = ({
  incomingMessage,
  currentConversationId,
  currentUserId,
  isMessageNotificationsEnabled,
}) => {
  if (
    !shouldDisplayDesktopNotification({
      incomingMessage,
      currentConversationId,
      currentUserId,
      isMessageNotificationsEnabled,
    })
  ) {
    return
  }

  const messageId = normalizeId(incomingMessage?._id)
  recentlyNotifiedMessageIds.add(messageId)

  if (notificationChannel) {
    notificationChannel.postMessage({ messageId })
  }

  const senderName = sanitizeNotificationText(incomingMessage?.sender?.fullName, 'ChatApp')
  const bodyText = sanitizeNotificationText(incomingMessage?.content, 'You received a new message.')
  const iconUrl = `${window.location.origin}/favicon.ico`

  const notification = new Notification(senderName, {
    body: bodyText,
    tag: `chatapp-msg-${messageId}`,
    renotify: false,
    icon: iconUrl,
    badge: iconUrl,
  })

  notification.onclick = () => {
    window.focus()
    notification.close()
  }
}

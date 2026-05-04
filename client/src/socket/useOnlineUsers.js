import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSocket } from './socket.js'

const RETRY_INTERVAL_MS = 1000

const useOnlineUsers = () => {
  const [onlineUsers, setOnlineUsers] = useState([])

  const handleOnlineUsers = useCallback((userIds) => {
    setOnlineUsers(Array.isArray(userIds) ? userIds : [])
  }, [])

  const requestOnlineUsers = useCallback((socket) => {
    socket.emit('request-online-users', null, (response) => {
      const responseUserIds = response?.data?.userIds
      if (Array.isArray(responseUserIds)) {
        setOnlineUsers(responseUserIds)
      }
    })
  }, [])

  useEffect(() => {
    let retryIntervalId = null
    let boundSocket = null

    const handleSocketConnect = () => {
      if (boundSocket) {
        requestOnlineUsers(boundSocket)
      }
    }

    const bindSocketListeners = () => {
      const socket = getSocket()
      if (!socket) return false

      boundSocket = socket
      socket.on('get-online-users', handleOnlineUsers)
      socket.on('connect', handleSocketConnect)

      requestOnlineUsers(socket)
      return true
    }

    if (!bindSocketListeners()) {
      retryIntervalId = setInterval(() => {
        if (bindSocketListeners()) {
          clearInterval(retryIntervalId)
          retryIntervalId = null
        }
      }, RETRY_INTERVAL_MS)
    }

    return () => {
      if (retryIntervalId) {
        clearInterval(retryIntervalId)
      }

      if (boundSocket) {
        boundSocket.off('get-online-users', handleOnlineUsers)
        boundSocket.off('connect', handleSocketConnect)
      }
    }
  }, [handleOnlineUsers, requestOnlineUsers])

  const isUserOnline = useCallback((userId) => {
    if (!userId) return false

    return onlineUsers.some((onlineUserId) => String(onlineUserId) === String(userId))
  }, [onlineUsers])

  return useMemo(() => ({
    onlineUsers,
    isUserOnline,
  }), [onlineUsers, isUserOnline])
}

export default useOnlineUsers

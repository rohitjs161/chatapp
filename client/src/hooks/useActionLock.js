import { useCallback, useRef, useState } from 'react'

const useActionLock = () => {
  const [isLocked, setIsLocked] = useState(false)
  const lockRef = useRef(false)

  const runLockedAction = useCallback(async (action) => {
    if (lockRef.current) return null

    lockRef.current = true
    setIsLocked(true)

    try {
      return await action()
    } finally {
      lockRef.current = false
      setIsLocked(false)
    }
  }, [])

  return { isLocked, runLockedAction }
}

export default useActionLock
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { notificationsApi } from '../services/api'
import { useAuth } from './auth'
import { NotificationsContext } from './notifications'

const BASE_POLL_MS = 30_000
const MAX_POLL_MS = 5 * 60_000

const emptyState = { items: [], unreadCount: 0, loading: false, error: '' }

export function NotificationProvider({ children }) {
  const { session } = useAuth()
  const accountId = session?.user?.id || null
  if (!accountId) {
    const value = { ...emptyState, refresh: async () => false, markRead: async () => null, markAllRead: async () => undefined }
    return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  }
  return <NotificationSession key={accountId}>{children}</NotificationSession>
}

function NotificationSession({ children }) {
  const [state, setState] = useState({ ...emptyState, loading: true })
  const requestRef = useRef(null)
  const failuresRef = useRef(0)
  const activeRef = useRef(true)

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (requestRef.current) return requestRef.current

    if (!silent) setState((current) => ({ ...current, loading: true, error: '' }))
    const request = notificationsApi.list({ limit: 20 })
      .then((data) => {
        if (!activeRef.current) return false
        failuresRef.current = 0
        setState({ items: data.items || [], unreadCount: data.unreadCount || 0, loading: false, error: '' })
        return true
      })
      .catch((error) => {
        if (!activeRef.current) return false
        failuresRef.current += 1
        setState((current) => ({ ...current, loading: false, error: error.message || 'Không thể tải thông báo.' }))
        return false
      })
      .finally(() => {
        if (requestRef.current === request) requestRef.current = null
      })
    requestRef.current = request
    return request
  }, [])

  useEffect(() => {
    activeRef.current = true
    const timer = window.setTimeout(() => refresh(), 0)
    return () => {
      activeRef.current = false
      window.clearTimeout(timer)
    }
  }, [refresh])

  useEffect(() => {
    let timer
    let active = true
    const schedule = () => {
      if (!active) return
      const delay = Math.min(BASE_POLL_MS * (2 ** failuresRef.current), MAX_POLL_MS)
      timer = window.setTimeout(async () => {
        if (document.visibilityState === 'visible') await refresh({ silent: true })
        schedule()
      }, delay)
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      window.clearTimeout(timer)
      refresh({ silent: true }).finally(schedule)
    }
    document.addEventListener('visibilitychange', onVisibility)
    schedule()
    return () => {
      active = false
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  const markRead = useCallback(async (id) => {
    const item = state.items.find((entry) => entry.id === id)
    if (!item || item.isRead) return item
    const updated = await notificationsApi.markRead(id)
    if (!activeRef.current) return updated
    setState((current) => ({
      ...current,
      unreadCount: Math.max(0, current.unreadCount - 1),
      items: current.items.map((entry) => entry.id === id ? { ...entry, isRead: true } : entry)
    }))
    return updated
  }, [state.items])

  const markAllRead = useCallback(async () => {
    await notificationsApi.markAllRead()
    if (!activeRef.current) return
    setState((current) => ({ ...current, unreadCount: 0, items: current.items.map((item) => ({ ...item, isRead: true })) }))
  }, [])

  const value = useMemo(() => ({ ...state, refresh, markRead, markAllRead }), [state, refresh, markRead, markAllRead])
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

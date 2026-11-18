import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../context/notifications'
import { resolveNotificationDestination } from '../utils/notificationLinks'

function relativeTime(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'Vừa xong'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ngày trước`
  return new Date(value).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}

export default function NotificationCenter({ user }) {
  const navigate = useNavigate()
  const { items, unreadCount, loading, error, refresh, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const bellRef = useRef(null)
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    const bell = bellRef.current
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return }
      if (event.key !== 'Tab') return
      const focusable = [...panelRef.current.querySelectorAll('button:not(:disabled), a[href]')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      bell?.focus()
    }
  }, [open])

  async function openCenter() {
    setActionError('')
    setOpen(true)
    if (error) await refresh()
  }

  async function readAndNavigate(item) {
    setActionError('')
    try {
      await markRead(item.id)
      setOpen(false)
      navigate(resolveNotificationDestination(item, user.role))
    } catch (requestError) {
      setActionError(requestError.message || 'Không thể đánh dấu thông báo đã đọc.')
    }
  }

  async function readAll() {
    setActionError('')
    try { await markAllRead() } catch (requestError) { setActionError(requestError.message || 'Không thể đánh dấu tất cả đã đọc.') }
  }

  return <div className="app-notification-wrap">
    <button ref={bellRef} type="button" className="app-action-button" aria-label={`Thông báo${unreadCount ? `, ${unreadCount} chưa đọc` : ''}`} title="Thông báo" aria-haspopup="dialog" aria-expanded={open} onClick={() => open ? setOpen(false) : openCenter()}><span aria-hidden="true">♢</span>{unreadCount > 0 && <b>{unreadCount > 99 ? '99+' : unreadCount}</b>}</button>
    {open && <div className="notification-layer">
      <button className="notification-overlay" type="button" aria-label="Đóng thông báo" onClick={() => setOpen(false)} />
      <section ref={panelRef} className="app-notification-popover" role="dialog" aria-modal="true" aria-labelledby="notification-title">
        <div className="app-popover-heading"><div><strong id="notification-title">Thông báo</strong><small>{unreadCount ? `${unreadCount} chưa đọc` : 'Bạn đã đọc tất cả'}</small></div><div><button type="button" disabled={!unreadCount || loading} onClick={readAll}>Đọc tất cả</button><button ref={closeRef} type="button" className="notification-close" aria-label="Đóng thông báo" onClick={() => setOpen(false)}>×</button></div></div>
        {(error || actionError) && <div className="notification-error" role="alert"><span>{actionError || error}</span><button type="button" onClick={() => { setActionError(''); refresh() }}>Thử lại</button></div>}
        {loading && !items.length ? <div className="notification-skeleton" aria-label="Đang tải thông báo">{[1, 2, 3].map((item) => <i key={item} />)}</div> : items.length ? <div className="notification-list">{items.map((item) => <button type="button" className={`app-notification-item ${item.isRead ? '' : 'unread'}`} key={item.id} onClick={() => readAndNavigate(item)}><span className="notification-dot" aria-hidden="true" /><span className="notification-copy"><strong>{item.title}</strong><span>{item.content}</span><small title={new Date(item.createdAt).toLocaleString('vi-VN')}>{relativeTime(item.createdAt)}</small></span></button>)}</div> : !error && <div className="app-notification-empty"><span aria-hidden="true">◇</span><strong>Chưa có thông báo</strong><p>Các cập nhật quan trọng sẽ xuất hiện tại đây.</p></div>}
        <button type="button" className="notification-refresh" onClick={() => refresh()} disabled={loading}>{loading ? 'Đang làm mới…' : '↻ Làm mới'}</button>
      </section>
    </div>}
  </div>
}

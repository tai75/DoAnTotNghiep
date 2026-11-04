import { useEffect } from 'react'

export default function Toast({ message, type = 'info', onClose }) {
  useEffect(() => {
    if (!message) return undefined
    const timer = window.setTimeout(onClose, 4000)
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [message, onClose])

  if (!message) return null
  return <div className={`ui-toast ui-toast-${type}`} role="status" aria-live="polite"><span>{message}</span><button aria-label="Đóng thông báo" onClick={onClose}>×</button></div>
}

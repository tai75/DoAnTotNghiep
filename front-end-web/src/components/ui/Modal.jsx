import { useEffect, useId, useRef } from 'react'

export default function Modal({ open, title, onClose, children }) {
  const titleId = useId()
  const dialogRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => dialogRef.current?.focus())
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        if (!focusable.length) return event.preventDefault()
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return <div className="ui-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <div className="ui-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex="-1" onMouseDown={(event) => event.stopPropagation()}>
      <div className="ui-modal-heading"><h2 id={titleId}>{title}</h2><button className="ui-icon-button" aria-label="Đóng" onClick={onClose}>×</button></div>
      {children}
    </div>
  </div>
}

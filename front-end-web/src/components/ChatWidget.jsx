import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { aiConsentApi, recommendationApi } from '../services/api'

export default function ChatWidget({ initialOpen = false }) {
  const [open, setOpen] = useState(initialOpen)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [consent, setConsent] = useState({ loading: true, active: false, error: '' })
  const [error, setError] = useState('')
  const [failedMessage, setFailedMessage] = useState('')
  const toggleRef = useRef(null)
  const inputRef = useRef(null)
  const endRef = useRef(null)
  const widgetRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    let active = true
    aiConsentApi.list().then((result) => {
      if (!active) return
      const chat = result.items?.find((item) => item.scope === 'AI_CHAT')
      setConsent({ loading: false, active: Boolean(chat?.active && chat.policyVersion === result.policyVersion && chat.withdrawalStatus !== 'PENDING'), error: '' })
    }).catch(() => active && setConsent({ loading: false, active: false, error: 'Không thể kiểm tra quyền sử dụng AI.' }))
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => { active = false; window.cancelAnimationFrame(frame) }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const updateViewport = () => {
      const viewport = window.visualViewport
      if (!viewport || !widgetRef.current) return
      const keyboardOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      widgetRef.current.style.setProperty('--chat-keyboard-offset', `${keyboardOffset}px`)
      widgetRef.current.style.setProperty('--chat-visible-height', `${viewport.height}px`)
      widgetRef.current.style.setProperty('--chat-mobile-clearance', keyboardOffset > 100 ? '12px' : '78px')
    }
    updateViewport()
    window.visualViewport?.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('scroll', updateViewport)
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewport)
      window.visualViewport?.removeEventListener('scroll', updateViewport)
    }
  }, [open])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [messages, loading])

  function close() {
    setOpen(false)
    setConsent({ loading: true, active: false, error: '' })
    window.requestAnimationFrame(() => toggleRef.current?.focus())
  }

  async function sendText(text, retry = false) {
    if (!text || loading || !consent.active) return
    setError('')
    setFailedMessage('')
    if (!retry) {
      setMessage('')
      setMessages((current) => [...current, { role: 'user', text }])
    }
    setLoading(true)
    try {
      const result = await recommendationApi.chat(text)
      setMessages((current) => [...current, { role: 'assistant', text: result.message }])
    } catch (actionError) {
      setError(actionError.status === 403 ? 'Không thể gửi tin nhắn. Hãy kiểm tra quyền sử dụng AI trong Cài đặt tài khoản.' : 'Không thể nhận phản hồi lúc này. Vui lòng thử lại.')
      setFailedMessage(text)
      if (actionError.status === 403) setConsent((current) => ({ ...current, active: false }))
    } finally { setLoading(false) }
  }

  function send(event) {
    event.preventDefault()
    sendText(message.trim())
  }

  return <div className={`chat-widget ${open ? 'is-open' : ''}`} ref={widgetRef} onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); close() } }}>
    {open && <section id="chat-panel" className="chat-panel" aria-label="Trợ lý AI Job Connect">
      <header className="chat-panel-header"><span className="chat-panel-mark" aria-hidden="true">JC<span>✦</span></span><div><strong>Trợ lý AI Job Connect</strong><small>Hỗ trợ tìm việc và tuyển dụng</small></div><button type="button" className="chat-close" aria-label="Đóng trợ lý AI Job Connect" onClick={close}>×</button></header>
      <div className="chat-messages" aria-live="polite" aria-relevant="additions text">
        {messages.length ? messages.map((item, index) => <p className={`chat-bubble ${item.role}`} key={index}>{item.text}</p>) : <div className="chat-empty"><span aria-hidden="true">✦</span><strong>Xin chào!</strong><p>Tôi có thể hỗ trợ bạn tìm việc hoặc tuyển dụng. Hãy nhập câu hỏi để bắt đầu.</p></div>}
        {loading && <p className="chat-bubble assistant chat-pending" role="status">Đang xử lý câu hỏi…</p>}
        <div ref={endRef} />
      </div>
      {!consent.loading && !consent.active && <div className="chat-consent" role="status"><p>{consent.error || 'Bạn cần đồng ý sử dụng Trợ lý AI trong Cài đặt tài khoản trước khi gửi câu hỏi.'}</p><Link to="/settings" onClick={close}>Mở Cài đặt tài khoản</Link></div>}
      {error && <div className="chat-error" role="alert"><span>{error}</span>{failedMessage && consent.active && <button type="button" onClick={() => sendText(failedMessage, true)}>Thử lại</button>}</div>}
      <form onSubmit={send}><input ref={inputRef} aria-label="Nhập câu hỏi cho trợ lý AI" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={consent.loading ? 'Đang kiểm tra quyền AI…' : 'Bạn muốn hỏi điều gì?'} disabled={loading || consent.loading || !consent.active} maxLength={2000} /><button type="submit" disabled={!message.trim() || loading || !consent.active || consent.loading}>Gửi</button></form>
    </section>}
    <button ref={toggleRef} className="chat-toggle" type="button" onClick={() => open ? close() : setOpen(true)} aria-label={open ? 'Thu gọn trợ lý AI Job Connect' : 'Mở trợ lý AI Job Connect'} aria-expanded={open} aria-controls="chat-panel"><span className="chat-toggle-mark" aria-hidden="true">JC<span>✦</span></span></button>
  </div>
}

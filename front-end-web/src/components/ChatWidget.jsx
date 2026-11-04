import { useState } from 'react'
import { recommendationApi } from '../services/api'

export default function ChatWidget({ initialOpen = false }) {
  const [open, setOpen] = useState(initialOpen)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  async function send(event) {
    event.preventDefault()
    if (!message.trim() || loading) return
    const text = message.trim()
    setMessage('')
    setMessages((current) => [...current, { role: 'user', text }])
    setLoading(true)
    try { const result = await recommendationApi.chat(text); setMessages((current) => [...current, { role: 'assistant', text: result.message }]) } catch (error) { setMessages((current) => [...current, { role: 'assistant', text: error.message }]) } finally { setLoading(false) }
  }
  return <div className="chat-widget">{open && <section className="chat-panel" aria-label="Trợ lý Job Connect"><header><strong>Trợ lý Job Connect</strong><button type="button" aria-label="Đóng trợ lý AI" onClick={() => setOpen(false)}>×</button></header><div className="chat-messages" aria-live="polite">{messages.length ? messages.map((item, index) => <p className={item.role} key={index}>{item.text}</p>) : <p className="assistant">Tôi có thể giúp tìm việc hoặc ứng viên từ dữ liệu thật.</p>}</div><form onSubmit={send}><input aria-label="Nội dung cần trợ lý hỗ trợ" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Bạn cần tìm gì?" /><button disabled={loading}>Gửi</button></form></section>}<button className="chat-toggle" type="button" onClick={() => setOpen((current) => !current)} aria-label={open ? 'Đóng trợ lý AI' : 'Mở trợ lý AI'} aria-expanded={open}>✦</button></div>
}

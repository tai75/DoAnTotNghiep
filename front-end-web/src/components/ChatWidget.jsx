import { useState } from 'react'
import { recommendationApi } from '../services/api'

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
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
  return <div className="chat-widget">{open && <section className="chat-panel"><header><strong>Trợ lý Job Connect</strong><button onClick={() => setOpen(false)}>×</button></header><div className="chat-messages">{messages.length ? messages.map((item, index) => <p className={item.role} key={index}>{item.text}</p>) : <p className="assistant">Tôi có thể giúp tìm việc hoặc ứng viên từ dữ liệu thật.</p>}</div><form onSubmit={send}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Bạn cần tìm gì?" /><button>Gửi</button></form></section>}<button className="chat-toggle" onClick={() => setOpen((current) => !current)} aria-label="Mở trợ lý AI">✦</button></div>
}

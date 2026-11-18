import { useCallback, useEffect, useRef, useState } from 'react'
import AppShell from '../components/AppShell'
import { messagesApi } from '../services/api'
import { useAuth } from '../context/auth'
import './messages.css'

export default function MessagesPage() {
  const { session, logout } = useAuth()
  const [conversations, setConversations] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const messageRequestRef = useRef(0)

  const loadConversations = useCallback(async (showLoading = false) => {
    if (showLoading) setLoadingConversations(true)
    try {
      setConversations(await messagesApi.list())
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      if (showLoading) setLoadingConversations(false)
    }
  }, [])

  async function loadMessages(id) {
    const requestId = ++messageRequestRef.current
    try {
      setSelected(id)
      setLoadingMessages(true)
      const nextMessages = await messagesApi.messages(id)
      if (requestId !== messageRequestRef.current) return
      setMessages(nextMessages)
      await messagesApi.markRead(id)
      if (requestId !== messageRequestRef.current) return
      setConversations((items) => items.map((item) => item.id === id ? { ...item, unreadCount: 0 } : item))
      window.dispatchEvent(new Event('messages-read'))
      setError('')
    } catch (requestError) {
      if (requestId === messageRequestRef.current) setError(requestError.message)
    } finally {
      if (requestId === messageRequestRef.current) setLoadingMessages(false)
    }
  }

  useEffect(() => {
    loadConversations(true)
    const timer = window.setInterval(loadConversations, 5000)
    return () => window.clearInterval(timer)
  }, [loadConversations])

  useEffect(() => {
    if (!selected) return undefined
    let active = true
    const timer = window.setInterval(() => messagesApi.messages(selected).then(async (items) => {
      if (!active) return
      setMessages(items)
      await messagesApi.markRead(selected)
      if (active) {
        setConversations((current) => current.map((item) => item.id === selected ? { ...item, unreadCount: 0 } : item))
        window.dispatchEvent(new Event('messages-read'))
      }
    }).catch((requestError) => {
      if (active) setError(requestError.message)
    }), 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [selected])
  async function send(event) {
    event.preventDefault()
    if (!content.trim() || !selected) return
    try {
      const message = await messagesApi.send(selected, content)
      setMessages((items) => [...items, message])
      setContent('')
      await loadConversations()
    } catch (requestError) { setError(requestError.message) }
  }
  return <AppShell user={session.user} logout={logout}>{selected && <button type="button" className="messages-mobile-back" onClick={() => setSelected(null)}>← Danh sách hội thoại</button>}<main className="messages-page"><header><p className="eyebrow">TIN NHẮN</p><h1>Trao đổi tuyển dụng</h1></header>{error && <p className="board-message error">{error}</p>}<section className="messages-layout"><aside>{loadingConversations ? <p>Đang tải cuộc trò chuyện...</p> : conversations.length ? conversations.map((item) => <button className={selected === item.id ? 'message-thread active' : 'message-thread'} key={item.id} onClick={() => loadMessages(item.id)}><strong>{session.user.role === 'CANDIDATE' ? item.job.title : item.candidate?.fullName}</strong><small>{item.lastMessage?.content || 'Chưa có tin nhắn'}</small>{item.unreadCount > 0 && <b>{item.unreadCount}</b>}</button>) : <p>Chưa có cuộc trò chuyện.</p>}</aside><div className="message-panel">{selected ? loadingMessages ? <p>Đang tải tin nhắn...</p> : <>{messages.length ? messages.map((item) => <article className={item.senderUserId === session.user.id ? 'message own' : 'message'} key={item.id}><span>{item.content}</span><small>{new Date(item.createdAt).toLocaleString('vi-VN')}</small></article>) : <p>Chưa có tin nhắn trong cuộc trò chuyện này.</p>}<form onSubmit={send}><textarea aria-label="Nội dung tin nhắn" value={content} maxLength="2000" onChange={(event) => setContent(event.target.value)} placeholder="Nhập tin nhắn..." /><button className="primary-button">Gửi</button></form></> : <p>Chọn một cuộc trò chuyện để xem tin nhắn.</p>}</div></section></main></AppShell>
}

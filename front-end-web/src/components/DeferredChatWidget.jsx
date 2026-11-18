import { lazy, Suspense, useState } from 'react'
import { useAuth } from '../context/auth'
import './ChatWidget.css'

const ChatWidget = lazy(() => import('./ChatWidget'))

function ChatMark() { return <span className="chat-toggle-mark" aria-hidden="true">JC<span>✦</span></span> }

export default function DeferredChatWidget() {
  const [requested, setRequested] = useState(false)
  const { session } = useAuth()

  if (!['CANDIDATE', 'RECRUITER'].includes(session?.user?.role)) return null
  if (!requested) return <div className="chat-widget"><button className="chat-toggle" type="button" onClick={() => setRequested(true)} aria-label="Mở trợ lý AI Job Connect" aria-expanded="false"><ChatMark /></button></div>

  return <Suspense fallback={<div className="chat-widget"><button className="chat-toggle" type="button" aria-label="Đang tải trợ lý AI Job Connect" disabled><ChatMark /></button></div>}><ChatWidget initialOpen /></Suspense>
}

import { lazy, Suspense, useState } from 'react'

const ChatWidget = lazy(() => import('./ChatWidget'))

export default function DeferredChatWidget() {
  const [requested, setRequested] = useState(false)

  if (!requested) {
    return <div className="chat-widget"><button className="chat-toggle" type="button" onClick={() => setRequested(true)} aria-label="Mở trợ lý AI" aria-expanded="false">✦</button></div>
  }

  return <Suspense fallback={<div className="chat-widget"><button className="chat-toggle" type="button" aria-label="Đang tải trợ lý AI" disabled>✦</button></div>}><ChatWidget initialOpen /></Suspense>
}

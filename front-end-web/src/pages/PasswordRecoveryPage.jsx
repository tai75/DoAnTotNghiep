import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { authApi } from '../services/api'
import useDocumentMeta from '../hooks/useDocumentMeta'
import { captureResetTokenFromLocation, clearResetToken, getResetToken } from '../security/resetTokenMemory.js'

export default function PasswordRecoveryPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const isReset = location.pathname === '/reset-password'
  const token = isReset ? (getResetToken() || captureResetTokenFromLocation()) : null
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)
  const [completed, setCompleted] = useState(false)
  useDocumentMeta(isReset ? 'Đặt lại mật khẩu — Job Connect' : 'Quên mật khẩu — Job Connect', isReset ? 'Tạo mật khẩu mới cho tài khoản Job Connect.' : 'Nhận hướng dẫn khôi phục tài khoản Job Connect.')

  useEffect(() => {
    if (!completed) return undefined
    const timer = window.setTimeout(() => navigate('/login?reset=success', { replace: true }), 1500)
    return () => window.clearTimeout(timer)
  }, [completed, navigate])

  async function submit(event) {
    event.preventDefault()
    setMessage(null)
    if (isReset && !token) {
      setMessage({ type: 'error', text: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã thiếu token.' })
      return
    }
    if (isReset && password !== confirmation) {
      setMessage({ type: 'error', text: 'Mật khẩu xác nhận không khớp.' })
      return
    }
    setLoading(true)
    try {
      if (isReset) {
        await authApi.confirmPasswordReset(token, password)
        clearResetToken()
        setCompleted(true)
        setMessage({ type: 'success', text: 'Đặt lại mật khẩu thành công. Bạn sẽ được chuyển về trang đăng nhập.' })
      } else {
        await authApi.requestPasswordReset(email)
        setCompleted(true)
        setMessage({ type: 'success', text: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  return <main className="auth-shell recovery-shell">
    <section className="auth-panel recovery-panel">
      <div className="auth-content">
        <div className="mobile-brand recovery-brand"><span className="brand-mark">JC</span><span>Job Connect</span></div>
        <div className="auth-heading">
          <p className="eyebrow">BẢO MẬT TÀI KHOẢN</p>
          <h2>{isReset ? 'Đặt lại mật khẩu' : 'Quên mật khẩu?'}</h2>
          <p>{isReset ? 'Tạo mật khẩu mới cho tài khoản của bạn. Vì lý do bảo mật, nếu tải lại trang bạn cần mở lại liên kết trong email.' : 'Nhập email để nhận hướng dẫn khôi phục tài khoản.'}</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {!isReset && <label>Email<input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setMessage(null) }} autoComplete="email" required /></label>}
          {isReset && <>
            <label>Mật khẩu mới<input type="password" value={password} onChange={(event) => { setPassword(event.target.value); setMessage(null) }} minLength="8" maxLength="128" autoComplete="new-password" required disabled={!token || completed} /></label>
            <label>Xác nhận mật khẩu<input type="password" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setMessage(null) }} minLength="8" maxLength="128" autoComplete="new-password" required disabled={!token || completed} /></label>
          </>}
          {!token && isReset && !message && <div className="form-message error" role="alert">Liên kết đặt lại mật khẩu không hợp lệ hoặc đã thiếu token.</div>}
          {message && <div className={`form-message ${message.type}`} role="alert">{message.text}</div>}
          <button className="submit-button" type="submit" disabled={loading || completed || (isReset && !token)}>{loading ? 'Đang xử lý...' : isReset ? 'Đặt lại mật khẩu' : 'Gửi hướng dẫn'}</button>
        </form>
        <div className="recovery-actions"><Link className="text-button" to="/login">Quay lại đăng nhập</Link></div>
      </div>
    </section>
  </main>
}

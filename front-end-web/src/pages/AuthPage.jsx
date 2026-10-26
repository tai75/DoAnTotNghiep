import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const REFERENCE_IMAGE = 'http://localhost:5000/assets/-9ogxV-jue_gO6hLkt8wUrR9p_ZjF5bSU3RFoSMRneSqPNpxW794iOooyOy-udg2rhlmOFUOAfo4ImX_3lDKJrabmkbVvZRtxQcJaFUOr7Ht0MBTdC8o60DJmA23heR5PSPT2MfLrYAXwt3RkQr2EeCjVEsf-kExiKLZsfkaMEHep_SD6k-mXaaVxuGWfLxv.jpg'
const initialForm = { fullName: '', email: '', password: '', phone: '', role: 'CANDIDATE', companyName: '' }

export default function AuthPage() {
  const { login } = useAuth()
  const { pathname } = useLocation()
  const [mode, setMode] = useState(pathname === '/register' ? 'register' : 'login')
  const [form, setForm] = useState(initialForm)
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState(null)
  const isRegister = mode === 'register'

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setMessage(null)
  }

  function switchMode(nextMode) {
    setMode(nextMode)
    setForm(initialForm)
    setMessage(null)
  }

  async function submitForm(event) {
    event.preventDefault()
    setIsLoading(true)
    setMessage(null)
    const payload = isRegister
      ? { ...form, phone: form.phone || undefined, companyName: form.role === 'RECRUITER' ? form.companyName : undefined }
      : { email: form.email, password: form.password }
    try {
      await login(payload, isRegister)
      setMessage({ type: 'success', text: isRegister ? 'Tạo tài khoản thành công.' : 'Đăng nhập thành công.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-visual" style={{ '--reference-image': `url(${REFERENCE_IMAGE})` }}>
        <div className="visual-wash"></div><div className="brand-lockup"><span className="brand-mark">JC</span><span>Job Connect</span></div>
        <div className="visual-copy"><p className="eyebrow">KẾT NỐI ĐÚNG CƠ HỘI</p><h1>Tìm công việc<br />xứng đáng với bạn.</h1><p className="visual-description">Một hồ sơ tốt mở ra nhiều cánh cửa. Bắt đầu hành trình nghề nghiệp của bạn cùng Job Connect.</p><div className="trust-row"><span className="trust-dot"></span><span>Hàng nghìn cơ hội đang chờ bạn</span></div></div>
        <p className="visual-footer">Nền tảng kết nối việc làm hiện đại</p>
      </section>
      <section className="auth-panel">
        <div className="mobile-brand"><span className="brand-mark">JC</span><span>Job Connect</span></div>
        <div className="auth-content"><div className="auth-heading"><p className="eyebrow">{isRegister ? 'BẮT ĐẦU NGAY' : 'CHÀO MỪNG TRỞ LẠI'}</p><h2>{isRegister ? 'Tạo tài khoản' : 'Đăng nhập tài khoản'}</h2><p>{isRegister ? 'Tạo hồ sơ và khám phá cơ hội phù hợp.' : 'Tiếp tục hành trình tìm kiếm cơ hội mới.'}</p></div>
          <div className="mode-switch" role="tablist" aria-label="Chọn hình thức xác thực"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Đăng nhập</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Đăng ký</button></div>
          <form className="auth-form" onSubmit={submitForm}>
            {isRegister && <label>Họ và tên<input name="fullName" value={form.fullName} onChange={updateField} placeholder="Nguyễn Văn A" required /></label>}
            <label>Email<input type="email" name="email" value={form.email} onChange={updateField} placeholder="you@example.com" required /></label>
            {isRegister && <label>Số điện thoại <span className="optional">(không bắt buộc)</span><input name="phone" value={form.phone} onChange={updateField} placeholder="09xx xxx xxx" /></label>}
            <label>Mật khẩu<div className="password-field"><input type={showPassword ? 'text' : 'password'} name="password" value={form.password} onChange={updateField} placeholder="Tối thiểu 8 ký tự" minLength="8" required /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Ẩn' : 'Hiện'}</button></div></label>
            {isRegister && <label className="select-label">Bạn là<select name="role" value={form.role} onChange={updateField}><option value="CANDIDATE">Ứng viên</option><option value="RECRUITER">Nhà tuyển dụng</option></select></label>}
            {isRegister && form.role === 'RECRUITER' && <label>Tên công ty<input name="companyName" value={form.companyName} onChange={updateField} placeholder="Tên công ty của bạn" required /></label>}
            {!isRegister && <div className="form-meta"><label className="remember"><input type="checkbox" /> <span>Ghi nhớ đăng nhập</span></label><button type="button" className="text-button">Quên mật khẩu?</button></div>}
            {message && <div className={`form-message ${message.type}`} role="alert">{message.text}</div>}
            <button className="submit-button" type="submit" disabled={isLoading}>{isLoading ? 'Đang xử lý...' : isRegister ? 'Tạo tài khoản' : 'Đăng nhập'}<span aria-hidden="true">→</span></button>
          </form>
          <p className="legal-copy">Bằng việc tiếp tục, bạn đồng ý với <button type="button" className="text-button">Điều khoản sử dụng</button> và <button type="button" className="text-button">Chính sách bảo mật</button>.</p>
        </div>
      </section>
    </main>
  )
}

import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { useAuth } from '../context/auth'
import useDocumentMeta from '../hooks/useDocumentMeta'
import { authApi } from '../services/api'
import './account-settings.css'

const roleLabels = { CANDIDATE: 'Ứng viên', RECRUITER: 'Nhà tuyển dụng', ADMIN: 'Quản trị viên' }
const statusLabels = { ACTIVE: 'Đang hoạt động', INACTIVE: 'Chưa kích hoạt', BANNED: 'Đã khóa' }

export default function AccountSettingsPage() {
  const { session, logout, clearSession, updateSessionUser } = useAuth()
  const [account, setAccount] = useState(null)
  const [profile, setProfile] = useState({ fullName: '', phone: '' })
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '', confirmation: '' })
  const [state, setState] = useState({ loading: true, saving: '', message: null })
  useDocumentMeta('Cài đặt tài khoản — Job Connect', 'Quản lý thông tin cá nhân và bảo mật tài khoản Job Connect.')

  useEffect(() => {
    let active = true
    authApi.me().then((result) => {
      if (!active) return
      setAccount(result)
      setProfile({ fullName: result.fullName || '', phone: result.phone || '' })
      setState((current) => ({ ...current, loading: false }))
    }).catch((error) => active && setState({ loading: false, saving: '', message: { type: 'error', text: error.message } }))
    return () => { active = false }
  }, [])

  async function saveProfile(event) {
    event.preventDefault()
    const fullName = profile.fullName.trim()
    const phone = profile.phone.trim()
    if (fullName.length < 2) return setState((current) => ({ ...current, message: { type: 'error', text: 'Họ và tên phải có ít nhất 2 ký tự.' } }))
    if (fullName.length > 150 || phone.length > 30) return setState((current) => ({ ...current, message: { type: 'error', text: 'Thông tin nhập vượt quá độ dài cho phép.' } }))
    setState((current) => ({ ...current, saving: 'profile', message: null }))
    try {
      const updated = await authApi.updateMe({ fullName, phone: phone || null })
      setAccount((current) => ({ ...current, ...updated }))
      updateSessionUser(updated)
      setState({ loading: false, saving: '', message: { type: 'success', text: 'Thông tin tài khoản đã được cập nhật.' } })
    } catch (error) { setState({ loading: false, saving: '', message: { type: 'error', text: error.message } }) }
  }

  async function changePassword(event) {
    event.preventDefault()
    if (password.newPassword.length < 8) return setState((current) => ({ ...current, message: { type: 'error', text: 'Mật khẩu mới phải có ít nhất 8 ký tự.' } }))
    if (password.newPassword !== password.confirmation) return setState((current) => ({ ...current, message: { type: 'error', text: 'Xác nhận mật khẩu mới không khớp.' } }))
    if (password.currentPassword === password.newPassword) return setState((current) => ({ ...current, message: { type: 'error', text: 'Mật khẩu mới phải khác mật khẩu hiện tại.' } }))
    setState((current) => ({ ...current, saving: 'password', message: null }))
    try {
      await authApi.changePassword(password.currentPassword, password.newPassword)
      window.sessionStorage.setItem('job-connect-password-changed', '1')
      clearSession()
      window.location.replace('/login?passwordChanged=1')
    } catch (error) { setState({ loading: false, saving: '', message: { type: 'error', text: error.message } }) }
  }

  return <AppShell user={session.user} logout={logout}><main className="account-settings-page">
    <header><p className="eyebrow">TÀI KHOẢN CỦA TÔI</p><h1>Cài đặt tài khoản</h1><p>Cập nhật thông tin cá nhân và bảo vệ phiên đăng nhập của bạn.</p></header>
    {state.message && <div className={`account-message ${state.message.type}`} role={state.message.type === 'error' ? 'alert' : 'status'}>{state.message.text}</div>}
    {state.loading ? <p className="account-loading">Đang tải thông tin tài khoản...</p> : <div className="account-settings-grid">
      <section className="account-card"><h2>Thông tin tài khoản</h2><dl><div><dt>Email</dt><dd>{account.email}</dd></div><div><dt>Vai trò</dt><dd>{roleLabels[account.role]}</dd></div><div><dt>Trạng thái</dt><dd>{statusLabels[account.status] || 'Không xác định'}</dd></div><div><dt>Ngày tạo</dt><dd>{new Date(account.createdAt).toLocaleDateString('vi-VN')}</dd></div></dl><p className="account-hint">Email, vai trò và trạng thái chỉ có thể được thay đổi theo quy trình quản trị.</p></section>
      <section className="account-card"><h2>Thông tin cá nhân</h2><form onSubmit={saveProfile}><label>Họ và tên<input required minLength="2" maxLength="150" autoComplete="name" value={profile.fullName} onChange={(event) => setProfile({ ...profile, fullName: event.target.value })} /></label><label>Số điện thoại <span>(không bắt buộc)</span><input maxLength="30" autoComplete="tel" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="Ví dụ: 0901 234 567" /></label><button className="primary-button" disabled={state.saving === 'profile'}>{state.saving === 'profile' ? 'Đang lưu...' : 'Lưu thông tin'}</button></form></section>
      <section className="account-card account-security"><h2>Đổi mật khẩu</h2><p>Sau khi đổi mật khẩu, tất cả phiên đăng nhập sẽ bị thu hồi và bạn cần đăng nhập lại.</p><form onSubmit={changePassword}><label>Mật khẩu hiện tại<input required type="password" minLength="1" maxLength="128" autoComplete="current-password" value={password.currentPassword} onChange={(event) => setPassword({ ...password, currentPassword: event.target.value })} /></label><label>Mật khẩu mới<input required type="password" minLength="8" maxLength="128" autoComplete="new-password" value={password.newPassword} onChange={(event) => setPassword({ ...password, newPassword: event.target.value })} /></label><label>Xác nhận mật khẩu mới<input required type="password" minLength="8" maxLength="128" autoComplete="new-password" value={password.confirmation} onChange={(event) => setPassword({ ...password, confirmation: event.target.value })} /></label><button className="primary-button" disabled={state.saving === 'password'}>{state.saving === 'password' ? 'Đang đổi mật khẩu...' : 'Đổi mật khẩu'}</button></form></section>
    </div>}
  </main></AppShell>
}

import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { useAuth } from '../context/auth'
import useDocumentMeta from '../hooks/useDocumentMeta'
import { aiConsentApi, authApi } from '../services/api'
import './account-settings.css'

const consentLabels = {
  RESUME_IMPORT: ['Nhập hồ sơ từ CV', 'Nội dung CV đã loại thông tin liên hệ'],
  RESUME_JOB_ANALYSIS: ['Phân tích CV với việc làm', 'Kỹ năng và nội dung nghề nghiệp trong CV'],
  MATCHING_EXPLANATION: ['Giải thích độ phù hợp', 'Điểm và tên kỹ năng khớp hoặc còn thiếu'],
  SEMANTIC_MATCHING: ['So khớp ngữ nghĩa', 'Chức danh, kỹ năng, chuyên ngành và công nghệ'],
  AI_CHAT: ['Trợ lý AI', 'Câu hỏi và dữ liệu tối thiểu từ công cụ được phép'],
  JOB_DESCRIPTION: ['Gợi ý mô tả công việc', 'Thông tin công việc, không gồm câu trả lời sàng lọc'],
  RECRUITER_AI_DISCOVERY: ['Nhà tuyển dụng tìm hồ sơ bằng AI', 'Dữ liệu nghề nghiệp tối thiểu, không có thông tin liên hệ']
}

const roleLabels = { CANDIDATE: 'Ứng viên', RECRUITER: 'Nhà tuyển dụng', ADMIN: 'Quản trị viên' }
const statusLabels = { ACTIVE: 'Đang hoạt động', INACTIVE: 'Chưa kích hoạt', BANNED: 'Đã khóa' }

export default function AccountSettingsPage() {
  const { session, logout, clearSession, updateSessionUser } = useAuth()
  const [account, setAccount] = useState(null)
  const [profile, setProfile] = useState({ fullName: '', phone: '' })
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '', confirmation: '' })
  const [consents, setConsents] = useState(null)
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

  useEffect(() => {
    let active = true
    aiConsentApi.list().then((result) => active && setConsents(result)).catch((error) => active && setState((current) => ({ ...current, message: { type: 'error', text: error.message } })))
    return () => { active = false }
  }, [])

  async function updateConsent(scope, enabled) {
    setState((current) => ({ ...current, saving: `consent:${scope}`, message: null }))
    try {
      if (enabled) await aiConsentApi.grant(scope)
      else await aiConsentApi.withdraw(scope)
      const refreshed = await aiConsentApi.list()
      setConsents(refreshed)
      const updated = refreshed.items.find((item) => item.scope === scope)
      setState((current) => ({ ...current, saving: '', message: { type: 'success', text: enabled
        ? 'Đã lưu lựa chọn sử dụng AI.'
        : updated?.withdrawalStatus === 'PENDING'
          ? 'Yêu cầu rút đồng ý đã được ghi nhận. Hệ thống đã chặn lượt gửi mới và đang chờ các lượt AI chưa xác nhận kết thúc.'
          : 'Đã rút lại đồng ý. Các lần gửi dữ liệu mới đã bị chặn.' } }))
    } catch (error) { setState((current) => ({ ...current, saving: '', message: { type: 'error', text: error.message } })) }
  }

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
      <section className="account-card account-ai-consent" aria-labelledby="ai-consent-heading"><h2 id="ai-consent-heading">Quyền sử dụng dữ liệu cho AI</h2><p>Nhà cung cấp: Google Gemini. Mỗi mục đích cần được đồng ý riêng. Bạn có thể từ chối hoặc rút lại bất kỳ lúc nào mà vẫn dùng các chức năng không cần AI.</p><p className="account-hint">Dữ liệu liên hệ và thông tin định danh được loại bỏ trước khi gửi. Job Connect không gửi CV gốc, ID nội bộ hay câu trả lời sàng lọc cho chức năng tạo mô tả công việc.</p>{consents ? <div className="consent-list">{consents.items.map((item) => <label className="consent-item" key={item.scope}><input type="checkbox" checked={item.active} disabled={state.saving === `consent:${item.scope}` || item.withdrawalStatus === 'PENDING'} onChange={(event) => updateConsent(item.scope, event.target.checked)} /><span><strong>{consentLabels[item.scope]?.[0] || item.scope}</strong><small>{consentLabels[item.scope]?.[1]}</small>{item.withdrawalStatus === 'PENDING' && <em role="status">Đang chờ xác nhận các lượt AI đã bắt đầu. Không có lượt gửi mới nào được phép.</em>}{item.withdrawalStatus === 'COMPLETED' && <em>Đã rút đồng ý.</em>}{item.policyVersion !== consents.policyVersion && <em>Đồng ý đã hết hiệu lực; vui lòng xem lại chính sách.</em>}</span></label>)}</div> : <p>Đang tải lựa chọn AI...</p>}</section>
    </div>}
  </main></AppShell>
}

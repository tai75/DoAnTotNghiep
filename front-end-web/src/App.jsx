import { useEffect, useState } from 'react'
import './App.css'

const API_URL = 'http://localhost:5000/api'
const REFERENCE_IMAGE = 'http://localhost:5000/assets/-9ogxV-jue_gO6hLkt8wUrR9p_ZjF5bSU3RFoSMRneSqPNpxW794iOooyOy-udg2rhlmOFUOAfo4ImX_3lDKJrabmkbVvZRtxQcJaFUOr7Ht0MBTdC8o60DJmA23heR5PSPT2MfLrYAXwt3RkQr2EeCjVEsf-kExiKLZsfkaMEHep_SD6k-mXaaVxuGWfLxv.jpg'

const initialForm = {
  fullName: '',
  email: '',
  password: '',
  phone: '',
  role: 'CANDIDATE',
  companyName: ''
}

const initialJobFilters = { search: '', location: '', employmentType: '', sort: 'newest' }

async function fetchAdminData(path, token, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers }
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || 'Không thể tải dữ liệu quản trị')
  return result.data
}

async function requestDashboardData(token) {
  const [statsData, jobsData, usersData] = await Promise.all([
    fetchAdminData('/admin/stats', token),
    fetchAdminData('/admin/jobs?status=PENDING&limit=8', token),
    fetchAdminData('/admin/users?limit=8', token)
  ])
  return { statsData, jobsData, usersData }
}

async function requestJobs(nextFilters) {
  const query = new URLSearchParams({ limit: '12', ...Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => value)) })
  const response = await fetch(`${API_URL}/jobs?${query.toString()}`)
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || 'Không thể tải danh sách việc làm')
  return result.data
}

function JobBoard({ user, token, onLogout }) {
  const [jobs, setJobs] = useState([])
  const [pagination, setPagination] = useState(null)
  const [filters, setFilters] = useState(initialJobFilters)
  const [selectedJob, setSelectedJob] = useState(null)
  const [coverLetter, setCoverLetter] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isApplying, setIsApplying] = useState(false)
  const [message, setMessage] = useState(null)

  async function loadJobs(nextFilters = filters) {
    setIsLoading(true)
    try {
      const data = await requestJobs(nextFilters)
      setJobs(data.items)
      setPagination(data.pagination)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let isCurrent = true
    requestJobs(initialJobFilters).then((data) => {
      if (!isCurrent) return
      setJobs(data.items)
      setPagination(data.pagination)
    }).catch((error) => {
      if (isCurrent) setMessage({ type: 'error', text: error.message })
    }).finally(() => {
      if (isCurrent) setIsLoading(false)
    })
    return () => { isCurrent = false }
  }, [])

  function updateFilter(event) {
    setFilters((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  function submitSearch(event) {
    event.preventDefault()
    loadJobs()
  }

  async function applyToJob() {
    if (!selectedJob || user.role !== 'CANDIDATE') return
    setIsApplying(true)
    setMessage(null)
    try {
      const response = await fetch(`${API_URL}/applications/jobs/${selectedJob.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ coverLetter: coverLetter || undefined })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Không thể ứng tuyển')
      setMessage({ type: 'success', text: 'Ứng tuyển thành công.' })
      setSelectedJob(null)
      setCoverLetter('')
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <main className="board-shell">
      <header className="board-header">
        <div className="board-brand"><span className="admin-brand-mark">JC</span><span>Job Connect</span></div>
        <nav className="board-nav"><button className="active">Tìm việc</button><button>Hồ sơ của tôi</button><button>Việc đã ứng tuyển</button></nav>
        <div className="board-account"><div className="avatar">{user.fullName?.charAt(0) || 'U'}</div><span>{user.fullName}</span><button className="board-logout" onClick={onLogout}>Đăng xuất</button></div>
      </header>

      <section className="board-hero"><div><p className="eyebrow">CƠ HỘI TIẾP THEO CỦA BẠN</p><h1>Tìm công việc<br /><em>phù hợp hơn.</em></h1><p>Khám phá những vị trí được chọn lọc và bắt đầu bước tiến mới trong sự nghiệp.</p></div><div className="hero-stat"><strong>{pagination?.total || 0}+</strong><span>việc làm đang mở</span></div></section>
      <section className="search-panel"><form onSubmit={submitSearch}><label className="search-field"><span>⌕</span><input name="search" value={filters.search} onChange={updateFilter} placeholder="Chức danh, kỹ năng hoặc từ khóa" /></label><label className="search-field location-field"><span>⌖</span><input name="location" value={filters.location} onChange={updateFilter} placeholder="Địa điểm" /></label><select name="employmentType" value={filters.employmentType} onChange={updateFilter}><option value="">Tất cả loại hình</option><option value="FULL_TIME">Toàn thời gian</option><option value="PART_TIME">Bán thời gian</option><option value="REMOTE">Remote</option></select><button className="search-button" type="submit">Tìm việc</button></form></section>

      <section className="board-content"><div className="board-toolbar"><div><p className="eyebrow">DANH SÁCH MỚI NHẤT</p><h2>Việc làm dành cho bạn</h2></div><select className="sort-select" name="sort" value={filters.sort} onChange={(event) => { updateFilter(event); loadJobs({ ...filters, sort: event.target.value }) }}><option value="newest">Mới nhất</option><option value="salary_high">Lương cao nhất</option><option value="salary_low">Lương thấp nhất</option></select></div>{message && <div className={`board-message ${message.type}`}>{message.text}</div>}{isLoading ? <div className="board-empty">Đang tìm cơ hội phù hợp...</div> : jobs.length ? <div className="job-grid">{jobs.map((job) => <article className="job-card" key={job.id} onClick={() => { setSelectedJob(job); setMessage(null) }}><div className="company-logo">{job.company?.name?.charAt(0) || 'J'}</div><div className="job-card-main"><span className="job-age">MỚI CẬP NHẬT</span><h3>{job.title}</h3><p className="company-name">{job.company?.name || 'Nhà tuyển dụng'}</p><div className="job-tags"><span>{job.location || 'Toàn quốc'}</span><span>{job.employmentType || 'Toàn thời gian'}</span></div></div><div className="job-salary">{formatSalary(job)}<small>Đăng {new Date(job.createdAt).toLocaleDateString('vi-VN')}</small></div></article>)}</div> : <div className="board-empty">Chưa tìm thấy việc làm phù hợp.</div>}</section>

      {selectedJob && <div className="modal-backdrop" onClick={() => setSelectedJob(null)}><aside className="job-detail" onClick={(event) => event.stopPropagation()}><button className="close-detail" onClick={() => setSelectedJob(null)}>×</button><span className="job-age">CHI TIẾT VIỆC LÀM</span><h2>{selectedJob.title}</h2><p className="company-name">{selectedJob.company?.name}</p><div className="detail-facts"><span>⌖ {selectedJob.location || 'Toàn quốc'}</span><span>◷ {selectedJob.employmentType || 'Toàn thời gian'}</span><span>₫ {formatSalary(selectedJob)}</span></div><div className="detail-copy"><h3>Mô tả công việc</h3><p>{selectedJob.description}</p></div>{user.role === 'CANDIDATE' ? <><label className="cover-label">Thư giới thiệu <span>(không bắt buộc)</span><textarea value={coverLetter} onChange={(event) => setCoverLetter(event.target.value)} placeholder="Giới thiệu ngắn về bạn..." maxLength="5000" /></label><button className="submit-button detail-apply" onClick={applyToJob} disabled={isApplying}>{isApplying ? 'Đang gửi...' : 'Ứng tuyển ngay'}<span>→</span></button></> : <div className="detail-note">Đăng nhập bằng tài khoản ứng viên để ứng tuyển vào vị trí này.</div>}</aside></div>}
    </main>
  )
}

function formatSalary(job) {
  if (!job.minSalary && !job.maxSalary) return 'Thỏa thuận'
  const format = (value) => `${Number(value).toLocaleString('vi-VN')} đ`
  if (job.minSalary && job.maxSalary) return `${format(job.minSalary)} - ${format(job.maxSalary)}`
  return format(job.minSalary || job.maxSalary)
}

function AdminDashboard({ user, token, onLogout }) {
  const [stats, setStats] = useState(null)
  const [jobs, setJobs] = useState([])
  const [users, setUsers] = useState([])
  const [activeSection, setActiveSection] = useState('overview')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadDashboard() {
    setIsLoading(true)
    setError('')
    try {
      const { statsData, jobsData, usersData } = await requestDashboardData(token)
      setStats(statsData)
      setJobs(jobsData.items)
      setUsers(usersData.items)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let isCurrent = true
    requestDashboardData(token).then(({ statsData, jobsData, usersData }) => {
      if (!isCurrent) return
      setStats(statsData)
      setJobs(jobsData.items)
      setUsers(usersData.items)
    }).catch((loadError) => {
      if (isCurrent) setError(loadError.message)
    }).finally(() => {
      if (isCurrent) setIsLoading(false)
    })
    return () => { isCurrent = false }
  }, [token])

  async function moderateJob(id, status) {
    try {
      await fetchAdminData(`/admin/jobs/${id}/moderation`, token, { method: 'PATCH', body: JSON.stringify({ status }) })
      setJobs((current) => current.filter((job) => job.id !== id))
      setStats((current) => current ? { ...current, pendingJobs: Math.max(0, current.pendingJobs - 1), jobs: status === 'PUBLISHED' ? current.jobs : current.jobs } : current)
    } catch (actionError) {
      setError(actionError.message)
    }
  }

  async function toggleUserStatus(userItem) {
    const status = userItem.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE'
    try {
      const updated = await fetchAdminData(`/admin/users/${userItem.id}/status`, token, { method: 'PATCH', body: JSON.stringify({ status }) })
      setUsers((current) => current.map((item) => item.id === updated.id ? { ...item, status: updated.status } : item))
    } catch (actionError) {
      setError(actionError.message)
    }
  }

  const statCards = stats ? [
    { label: 'Tổng tài khoản', value: stats.users, note: `${stats.candidates} ứng viên` },
    { label: 'Nhà tuyển dụng', value: stats.recruiters, note: `${stats.companies} công ty` },
    { label: 'Tin tuyển dụng', value: stats.jobs, note: `${stats.pendingJobs} tin chờ duyệt` },
    { label: 'Lượt ứng tuyển', value: stats.applications, note: 'Toàn hệ thống' }
  ] : []

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span className="admin-brand-mark">JC</span><span>Job Connect</span></div>
        <div className="admin-profile"><div className="avatar">{user.fullName?.charAt(0) || 'A'}</div><div><strong>{user.fullName}</strong><small>Quản trị viên</small></div></div>
        <nav className="admin-nav" aria-label="Điều hướng quản trị">
          <button className={activeSection === 'overview' ? 'active' : ''} onClick={() => setActiveSection('overview')}><span>□</span>Tổng quan</button>
          <button className={activeSection === 'jobs' ? 'active' : ''} onClick={() => setActiveSection('jobs')}><span>▤</span>Kiểm duyệt tin</button>
          <button className={activeSection === 'users' ? 'active' : ''} onClick={() => setActiveSection('users')}><span>◌</span>Tài khoản</button>
        </nav>
        <button className="logout-button" onClick={onLogout}>Đăng xuất <span>↗</span></button>
      </aside>

      <section className="admin-main">
        <header className="admin-header"><div><p className="eyebrow">TRUNG TÂM ĐIỀU HÀNH</p><h1>{activeSection === 'overview' ? 'Tổng quan hệ thống' : activeSection === 'jobs' ? 'Kiểm duyệt tin tuyển dụng' : 'Quản lý tài khoản'}</h1></div><button className="refresh-button" onClick={loadDashboard}>↻ <span>Làm mới</span></button></header>
        {error && <div className="admin-alert">{error}</div>}
        {isLoading ? <div className="admin-loading">Đang tải dữ liệu...</div> : <>
          {(activeSection === 'overview' || activeSection === 'jobs') && <div className="stat-grid">{statCards.map((card) => <article className="stat-card" key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></article>)}</div>}
          {activeSection !== 'users' && <section className="admin-section"><div className="section-heading"><div><p className="eyebrow">CẦN XỬ LÝ</p><h2>Tin đang chờ duyệt</h2></div><button className="view-link" onClick={() => setActiveSection('jobs')}>Xem tất cả →</button></div><JobTable jobs={jobs} onModerate={moderateJob} /></section>}
          {activeSection !== 'jobs' && <section className="admin-section"><div className="section-heading"><div><p className="eyebrow">THÀNH VIÊN MỚI</p><h2>Tài khoản gần đây</h2></div><button className="view-link" onClick={() => setActiveSection('users')}>Quản lý →</button></div><UserTable users={users} onToggle={toggleUserStatus} /></section>}
        </>}
      </section>
    </main>
  )
}

function JobTable({ jobs, onModerate }) {
  if (!jobs.length) return <div className="empty-state">Hiện không có tin tuyển dụng chờ duyệt.</div>
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Vị trí tuyển dụng</th><th>Công ty</th><th>Ngày cập nhật</th><th>Thao tác</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.title}</strong><small>{job.location || 'Chưa cập nhật địa điểm'}</small></td><td>{job.company?.name || 'Chưa cập nhật'}</td><td>{new Date(job.updatedAt).toLocaleDateString('vi-VN')}</td><td><div className="table-actions"><button className="approve-button" onClick={() => onModerate(job.id, 'PUBLISHED')}>Duyệt</button><button className="reject-button" onClick={() => onModerate(job.id, 'REJECTED')}>Từ chối</button></div></td></tr>)}</tbody></table></div>
}

function UserTable({ users, onToggle }) {
  if (!users.length) return <div className="empty-state">Chưa có tài khoản nào.</div>
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td><strong>{item.fullName}</strong><small>{item.email}</small></td><td><span className="role-label">{item.role === 'RECRUITER' ? 'Nhà tuyển dụng' : item.role === 'CANDIDATE' ? 'Ứng viên' : 'Admin'}</span></td><td><span className={`status-pill ${item.status.toLowerCase()}`}>{item.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}</span></td><td>{item.role !== 'ADMIN' && <button className="table-link" onClick={() => onToggle(item)}>{item.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'}</button>}</td></tr>)}</tbody></table></div>
}

function App() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState(initialForm)
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState(null)
  const [session, setSession] = useState(null)

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

    const endpoint = isRegister ? '/auth/register' : '/auth/login'
    const payload = isRegister
      ? { ...form, phone: form.phone || undefined, companyName: form.role === 'RECRUITER' ? form.companyName : undefined }
      : { email: form.email, password: form.password }

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Không thể thực hiện yêu cầu')

      localStorage.setItem('job_connect_token', result.data.token)
      setSession({ user: result.data.user, token: result.data.token })
      setMessage({ type: 'success', text: isRegister ? 'Tạo tài khoản thành công.' : 'Đăng nhập thành công.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsLoading(false)
    }
  }

  function logout() {
    localStorage.removeItem('job_connect_token')
    setSession(null)
    setMessage(null)
  }

  if (session?.user.role === 'ADMIN') return <AdminDashboard user={session.user} token={session.token} onLogout={logout} />
  if (session) return <JobBoard user={session.user} token={session.token} onLogout={logout} />

  return (
    <main className="auth-shell">
      <section className="auth-visual" style={{ '--reference-image': `url(${REFERENCE_IMAGE})` }}>
        <div className="visual-wash"></div>
        <div className="brand-lockup">
          <span className="brand-mark">JC</span>
          <span>Job Connect</span>
        </div>
        <div className="visual-copy">
          <p className="eyebrow">KẾT NỐI ĐÚNG CƠ HỘI</p>
          <h1>Tìm công việc<br />xứng đáng với bạn.</h1>
          <p className="visual-description">Một hồ sơ tốt mở ra nhiều cánh cửa. Bắt đầu hành trình nghề nghiệp của bạn cùng Job Connect.</p>
          <div className="trust-row"><span className="trust-dot"></span><span>Hàng nghìn cơ hội đang chờ bạn</span></div>
        </div>
        <p className="visual-footer">Nền tảng kết nối việc làm hiện đại</p>
      </section>

      <section className="auth-panel">
        <div className="mobile-brand"><span className="brand-mark">JC</span><span>Job Connect</span></div>
        <div className="auth-content">
          <div className="auth-heading">
            <p className="eyebrow">{isRegister ? 'BẮT ĐẦU NGAY' : 'CHÀO MỪNG TRỞ LẠI'}</p>
            <h2>{isRegister ? 'Tạo tài khoản' : 'Đăng nhập tài khoản'}</h2>
            <p>{isRegister ? 'Tạo hồ sơ và khám phá cơ hội phù hợp.' : 'Tiếp tục hành trình tìm kiếm cơ hội mới.'}</p>
          </div>

          <div className="mode-switch" role="tablist" aria-label="Chọn hình thức xác thực">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Đăng nhập</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Đăng ký</button>
          </div>

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

export default App

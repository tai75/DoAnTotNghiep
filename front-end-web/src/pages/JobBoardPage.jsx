import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { candidateApi, jobsApi, notificationsApi } from '../services/api'
import { useAuth } from '../context/AuthContext'

const initialFilters = { search: '', location: '', minSalary: '', maxSalary: '', skill: '', employmentType: '', sort: 'newest', page: '1' }
const employmentTypes = [['', 'Tất cả loại hình'], ['FULL_TIME', 'Toàn thời gian'], ['PART_TIME', 'Bán thời gian'], ['INTERNSHIP', 'Thực tập'], ['CONTRACT', 'Hợp đồng'], ['REMOTE', 'Remote'], ['HYBRID', 'Hybrid']]

function formatSalary(job) {
  if (!job.minSalary && !job.maxSalary) return 'Thỏa thuận'
  const format = (value) => `${Number(value).toLocaleString('vi-VN')} đ`
  return job.minSalary && job.maxSalary ? `${format(job.minSalary)} - ${format(job.maxSalary)}` : format(job.minSalary || job.maxSalary)
}

function Header({ user, logout, unread, notifications, notificationsOpen, onNotifications, onReadAll, onRead }) {
  return <header className="board-header">
    <Link className="board-brand" to="/jobs"><span className="admin-brand-mark">JC</span><span>Job Connect</span></Link>
    <nav className="board-nav"><Link className="active" to="/jobs">Tìm việc</Link>{user.role === 'CANDIDATE' && <><Link to="/recommendations">Dành cho bạn</Link><Link to="/saved-jobs">Tin đã lưu</Link><Link to="/applications">Lịch sử ứng tuyển</Link><Link to="/profile">Hồ sơ của tôi</Link></>}</nav>
    <div className="board-account"><div className="notification-wrap"><button className="notification-button" onClick={onNotifications} aria-label="Thông báo">♢{unread > 0 && <b>{unread > 9 ? '9+' : unread}</b>}</button>{notificationsOpen && notifications && <div className="notification-popover"><div className="notification-heading"><strong>Thông báo</strong><button onClick={onReadAll}>Đọc tất cả</button></div>{notifications.items.length ? notifications.items.slice(0, 5).map((item) => <button className={`notification-item ${item.isRead ? '' : 'unread'}`} key={item.id} onClick={() => onRead(item)}><strong>{item.title}</strong><span>{item.content}</span><small>{new Date(item.createdAt).toLocaleString('vi-VN')}</small></button>) : <p className="notification-empty">Chưa có thông báo.</p>}</div>}</div><div className="avatar">{user.fullName?.charAt(0) || 'U'}</div><span>{user.fullName}</span><button className="board-logout" onClick={logout}>Đăng xuất</button></div>
  </header>
}

export default function JobBoardPage() {
  const { session, logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters] = useState(() => ({ ...initialFilters, ...Object.fromEntries(searchParams.entries()) }))
  const [jobs, setJobs] = useState([])
  const [pagination, setPagination] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [resumes, setResumes] = useState([])
  const [resumeId, setResumeId] = useState('')
  const [coverLetter, setCoverLetter] = useState('')
  const [savedIds, setSavedIds] = useState(new Set())
  const [status, setStatus] = useState({ loading: true, error: '', message: '' })
  const [notifications, setNotifications] = useState(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  const queryFilters = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), [filters])
  async function loadJobs(next = filters) {
    setStatus({ loading: true, error: '', message: '' })
    try { const data = await jobsApi.list(next); setJobs(data.items); setPagination(data.pagination) } catch (error) { setStatus({ loading: false, error: error.message, message: '' }); return }
    setStatus({ loading: false, error: '', message: '' })
  }
  useEffect(() => { loadJobs(filters) }, [filters.page])
  useEffect(() => { if (session.user.role === 'CANDIDATE') candidateApi.savedJobs().then((items) => setSavedIds(new Set(items.map((item) => item.jobId)))).catch(() => {}); notificationsApi.list({ limit: 50 }).then((data) => setNotifications(data)).catch(() => {}) }, [])
  function update(name, value) { setFilters((current) => ({ ...current, [name]: value })) }
  function submit(event) { event.preventDefault(); const next = { ...filters, page: '1' }; setFilters(next); setSearchParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))) ; loadJobs(next) }
  async function toggleSaved(event, job) { event.stopPropagation(); if (session.user.role !== 'CANDIDATE') return; try { if (savedIds.has(job.id)) { await candidateApi.unsaveJob(job.id); setSavedIds((current) => new Set([...current].filter((id) => id !== job.id))) } else { await candidateApi.saveJob(job.id); setSavedIds((current) => new Set([...current, job.id])) } } catch (error) { setStatus((current) => ({ ...current, error: error.message })) } }
  async function openJob(job) { setSelectedJob(job); setResumeId(''); try { const profile = await candidateApi.profile(); setResumes(profile.resumes || []); const defaultResume = profile.resumes?.find((item) => item.isDefault); setResumeId(String(defaultResume?.id || '')) } catch (error) { setStatus((current) => ({ ...current, error: error.message })) } }
  async function apply() { if (!selectedJob || !resumeId) { setStatus((current) => ({ ...current, error: 'Vui lòng chọn CV trước khi ứng tuyển.' })); return } try { await jobsApi.apply(selectedJob.id, coverLetter, Number(resumeId)); setSelectedJob(null); setStatus({ loading: false, error: '', message: 'Ứng tuyển thành công.' }) } catch (error) { setStatus((current) => ({ ...current, error: error.message })) } }
  async function toggleNotifications() { setNotificationsOpen((current) => !current); if (!notifications) try { const data = await notificationsApi.list({ limit: 50 }); setNotifications(data) } catch (error) { setStatus((current) => ({ ...current, error: error.message })) } }
  async function readNotification(item) { if (!item.isRead) { await notificationsApi.markRead(item.id); setNotifications((current) => ({ ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, isRead: true } : entry) })) } }
  const unread = notifications?.items.filter((item) => !item.isRead).length || 0

  return <main className="board-shell"><Header user={session.user} logout={logout} unread={unread} notifications={notifications} notificationsOpen={notificationsOpen} onNotifications={toggleNotifications} onReadAll={async () => { await notificationsApi.markAllRead(); setNotifications((current) => current && { ...current, items: current.items.map((item) => ({ ...item, isRead: true })) }) }} onRead={readNotification} />
    <section className="board-hero"><div><p className="eyebrow">CƠ HỘI TIẾP THEO CỦA BẠN</p><h1>Tìm công việc<br /><em>phù hợp hơn.</em></h1><p>Khám phá những vị trí được chọn lọc và bắt đầu bước tiến mới trong sự nghiệp.</p></div><div className="hero-stat"><strong>{pagination?.total || 0}+</strong><span>việc làm đang mở</span></div></section>
    <section className="search-panel"><form onSubmit={submit}><label className="search-field"><span>⌕</span><input value={filters.search} onChange={(event) => update('search', event.target.value)} placeholder="Chức danh, kỹ năng hoặc từ khóa" /></label><label className="search-field"><span>⌖</span><input value={filters.location} onChange={(event) => update('location', event.target.value)} placeholder="Địa điểm" /></label><input className="filter-input" type="number" min="0" value={filters.minSalary} onChange={(event) => update('minSalary', event.target.value)} placeholder="Lương từ" /><input className="filter-input" type="number" min="0" value={filters.maxSalary} onChange={(event) => update('maxSalary', event.target.value)} placeholder="Lương đến" /><input className="filter-input" value={filters.skill} onChange={(event) => update('skill', event.target.value)} placeholder="Kỹ năng (phân cách dấu phẩy)" /><select value={filters.employmentType} onChange={(event) => update('employmentType', event.target.value)}>{employmentTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="search-button" type="submit">Tìm việc</button></form></section>
    <section className="board-content"><div className="board-toolbar"><div><p className="eyebrow">DANH SÁCH MỚI NHẤT</p><h2>Việc làm dành cho bạn</h2></div><select className="sort-select" value={filters.sort} onChange={(event) => { const next = { ...filters, sort: event.target.value, page: '1' }; setFilters(next); setSearchParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))); loadJobs(next) }}><option value="newest">Mới nhất</option><option value="salary_high">Lương cao nhất</option><option value="salary_low">Lương thấp nhất</option></select></div>{status.message && <div className="board-message success">{status.message}</div>}{status.error && <div className="board-message error">{status.error}</div>}{status.loading ? <div className="board-empty">Đang tìm cơ hội phù hợp...</div> : jobs.length ? <div className="job-grid">{jobs.map((job) => <article className="job-card" key={job.id} onClick={() => openJob(job)}><div className="company-logo">{job.company?.name?.charAt(0) || 'J'}</div><div className="job-card-main"><span className="job-age">MỚI CẬP NHẬT</span><h3>{job.title}</h3><p className="company-name">{job.company?.name || 'Nhà tuyển dụng'}</p><div className="job-tags"><span>{job.location || 'Toàn quốc'}</span><span>{job.employmentType || 'Toàn thời gian'}</span></div></div><div className="job-salary">{session.user.role === 'CANDIDATE' && <button className={`save-job ${savedIds.has(job.id) ? 'saved' : ''}`} onClick={(event) => toggleSaved(event, job)}>{savedIds.has(job.id) ? '★' : '☆'}</button>}{formatSalary(job)}<small>Đăng {new Date(job.createdAt).toLocaleDateString('vi-VN')}</small></div></article>)}</div> : <div className="board-empty">Chưa tìm thấy việc làm phù hợp.</div>}{pagination?.totalPages > 1 && <div className="pagination">{Array.from({ length: pagination.totalPages }, (_, index) => index + 1).map((page) => <button className={Number(filters.page || 1) === page ? 'active' : ''} key={page} onClick={() => { update('page', String(page)); setSearchParams({ ...queryFilters, page: String(page) }) }}>{page}</button>)}</div>}</section>
    {selectedJob && <div className="modal-backdrop" onClick={() => setSelectedJob(null)}><aside className="job-detail" onClick={(event) => event.stopPropagation()}><button className="close-detail" onClick={() => setSelectedJob(null)}>×</button><span className="job-age">CHI TIẾT VIỆC LÀM</span><h2>{selectedJob.title}</h2><p className="company-name">{selectedJob.company?.name}</p><div className="detail-company">{selectedJob.company?.description || 'Thông tin công ty đang được cập nhật.'}<br />{selectedJob.company?.address || selectedJob.location || 'Toàn quốc'}</div><div className="detail-facts"><span>⌖ {selectedJob.location || 'Toàn quốc'}</span><span>◷ {selectedJob.employmentType || 'Toàn thời gian'}</span><span>₫ {formatSalary(selectedJob)}</span></div><div className="detail-copy"><h3>Kỹ năng yêu cầu</h3><div className="skill-chips">{selectedJob.skills?.map((item) => <span key={item.skillId}>{item.skill.name}</span>)}</div><h3>Mô tả công việc</h3><p>{selectedJob.description}</p></div>{session.user.role === 'CANDIDATE' && <><label className="cover-label">Chọn CV ứng tuyển<select value={resumeId} onChange={(event) => setResumeId(event.target.value)}><option value="">Chọn CV</option>{resumes.map((resume) => <option value={resume.id} key={resume.id}>{resume.fileName}{resume.isDefault ? ' (mặc định)' : ''}</option>)}</select></label><label className="cover-label">Thư giới thiệu <span>(không bắt buộc)</span><textarea value={coverLetter} onChange={(event) => setCoverLetter(event.target.value)} placeholder="Giới thiệu ngắn về bạn..." maxLength="5000" /></label><button className="submit-button detail-apply" onClick={apply}>Ứng tuyển ngay <span>→</span></button></>}</aside></div>}
  </main>
}

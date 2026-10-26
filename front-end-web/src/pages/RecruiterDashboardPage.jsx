import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { recruiterApi } from '../services/api'
import { useAuth } from '../context/AuthContext'
import '../recruiter.css'

const jobStatuses = { DRAFT: 'Nháp', PENDING: 'Chờ duyệt', PUBLISHED: 'Đang đăng', CLOSED: 'Đã đóng', REJECTED: 'Bị từ chối' }
const applicationStatuses = { APPLIED: 'Mới', REVIEWING: 'Đang xem', SHORTLISTED: 'Đã chọn', INTERVIEWING: 'Phỏng vấn', OFFERED: 'Đề nghị', ACCEPTED: 'Đã nhận', REJECTED: 'Từ chối', WITHDRAWN: 'Đã rút' }
const chartColors = ['#2563eb', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#64748b']

function JobForm({ initialJob, skills, onSave, onCancel }) {
  const [form, setForm] = useState(() => initialJob ? {
    title: initialJob.title, description: initialJob.description, location: initialJob.location || '',
    employmentType: initialJob.employmentType || '', minSalary: initialJob.minSalary || '', maxSalary: initialJob.maxSalary || '',
    deadline: initialJob.deadline ? initialJob.deadline.slice(0, 10) : '', skillIds: initialJob.skills.map(({ skill }) => skill.id)
  } : { title: '', description: '', location: '', employmentType: '', minSalary: '', maxSalary: '', deadline: '', skillIds: [] })
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  function submit(event) {
    event.preventDefault()
    onSave({
      ...form,
      employmentType: form.employmentType || undefined,
      minSalary: form.minSalary === '' ? undefined : Number(form.minSalary),
      maxSalary: form.maxSalary === '' ? undefined : Number(form.maxSalary),
      deadline: form.deadline || undefined
    })
  }
  return <form className="recruiter-form" onSubmit={submit}>
    <div className="form-grid"><label>Chức danh<input required minLength="3" value={form.title} onChange={(event) => change('title', event.target.value)} /></label>
      <label>Địa điểm<input value={form.location} onChange={(event) => change('location', event.target.value)} /></label>
      <label>Hình thức<select value={form.employmentType} onChange={(event) => change('employmentType', event.target.value)}><option value="">Chọn hình thức</option>{Object.entries({ FULL_TIME: 'Toàn thời gian', PART_TIME: 'Bán thời gian', INTERNSHIP: 'Thực tập', CONTRACT: 'Hợp đồng', REMOTE: 'Từ xa', HYBRID: 'Kết hợp' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Hạn nhận hồ sơ<input required type="date" value={form.deadline} onChange={(event) => change('deadline', event.target.value)} /></label>
      <label>Lương tối thiểu<input type="number" min="0" value={form.minSalary} onChange={(event) => change('minSalary', event.target.value)} /></label>
      <label>Lương tối đa<input type="number" min="0" value={form.maxSalary} onChange={(event) => change('maxSalary', event.target.value)} /></label>
    </div>
    <label>Mô tả công việc<textarea required minLength="20" rows="6" value={form.description} onChange={(event) => change('description', event.target.value)} /></label>
    <fieldset><legend>Kỹ năng yêu cầu</legend><div className="skill-picker">{skills.map((skill) => <label key={skill.id}><input type="checkbox" checked={form.skillIds.includes(skill.id)} onChange={(event) => change('skillIds', event.target.checked ? [...form.skillIds, skill.id] : form.skillIds.filter((id) => id !== skill.id))} />{skill.name}</label>)}</div></fieldset>
    <div className="form-actions"><button type="button" className="secondary-button" onClick={onCancel}>Hủy</button><button className="primary-button">Lưu tin</button></div>
  </form>
}

function Dashboard({ stats }) {
  const statusData = Object.entries(stats.jobsByStatus || {}).map(([name, value]) => ({ name: jobStatuses[name] || name, value }))
  const applicationData = Object.entries(stats.applicationsByStatus || {}).map(([name, value]) => ({ name: applicationStatuses[name] || name, value }))
  return <><div className="recruiter-stat-grid"><article><span>Tổng tin tuyển dụng</span><strong>{Object.values(stats.jobsByStatus || {}).reduce((a, b) => a + b, 0)}</strong></article><article><span>Tổng đơn ứng tuyển</span><strong>{stats.applicationsTotal}</strong></article><article><span>Tin đang đăng</span><strong>{stats.jobsByStatus?.PUBLISHED || 0}</strong></article><article><span>Đang chờ duyệt</span><strong>{stats.jobsByStatus?.PENDING || 0}</strong></article></div>
    <div className="recruiter-chart-grid"><section className="recruiter-card"><h2>Đơn ứng tuyển theo thời gian</h2><ResponsiveContainer width="100%" height={280}><BarChart data={stats.timeline}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="Đơn" fill="#2563eb" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></section><section className="recruiter-card"><h2>Tỉ lệ đơn theo trạng thái</h2><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={applicationData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>{applicationData.map((item, index) => <Cell key={item.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="chart-legend">{applicationData.map((item, index) => <span key={item.name}><i style={{ background: chartColors[index % chartColors.length] }} />{item.name}: {item.value}</span>)}</div></section></div>
    <section className="recruiter-card"><h2>Đơn theo từng tin</h2><ResponsiveContainer width="100%" height={260}><BarChart data={stats.applicationsByJob} layout="vertical" margin={{ left: 20, right: 20 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="title" width={150} tick={{ fontSize: 12 }} /><Tooltip /><Bar dataKey="count" name="Đơn" fill="#8b5cf6" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></section><section className="recruiter-card"><h2>Phân bổ tin theo trạng thái</h2><div className="status-summary">{statusData.map((item) => <div key={item.name}><strong>{item.value}</strong><span>{item.name}</span></div>)}</div></section></>
}

function SuggestedCandidates({ result, onClose, onSearch }) {
  const [filters, setFilters] = useState({ requiredSkillIds: '', minExperience: '', location: '' })
  if (!result) return null
  return <div className="candidate-detail"><button className="close-detail" onClick={onClose}>×</button><h2>Gợi ý ứng viên · {result.job.title}</h2><form className="suggestion-filters" onSubmit={(event) => { event.preventDefault(); onSearch(result.job.id, filters) }}><input placeholder="ID kỹ năng bắt buộc, cách nhau dấu phẩy" value={filters.requiredSkillIds} onChange={(event) => setFilters({ ...filters, requiredSkillIds: event.target.value })} /><input type="number" min="0" placeholder="Kinh nghiệm tối thiểu" value={filters.minExperience} onChange={(event) => setFilters({ ...filters, minExperience: event.target.value })} /><input placeholder="Địa điểm" value={filters.location} onChange={(event) => setFilters({ ...filters, location: event.target.value })} /><button className="secondary-button">Áp dụng</button></form>{result.items.length ? result.items.map((item) => <div className="suggestion-row" key={item.candidateId}><strong>{item.fullName}</strong><span>{item.match.score}/100 · {item.yearsExperience ?? '—'} năm kinh nghiệm</span><small>{item.match.explanation}</small>{item.contact && <small>{item.contact.email} · {item.contact.phone || 'Chưa có số điện thoại'}</small>}<div className="candidate-skills">{item.match.matchedSkills.map((skill) => <span key={skill.id || skill.name}>{skill.name}</span>)}</div></div>) : <p>Chưa có ứng viên phù hợp.</p>}</div>
}

export default function RecruiterDashboardPage() {
  const { session, logout } = useAuth()
  const [section, setSection] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const [company, setCompany] = useState(null)
  const [jobs, setJobs] = useState([])
  const [skills, setSkills] = useState([])
  const [applications, setApplications] = useState([])
  const [editingJob, setEditingJob] = useState(null)
  const [applicationStatus, setApplicationStatus] = useState('')
  const [selectedApplication, setSelectedApplication] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [suggestedCandidates, setSuggestedCandidates] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [nextStats, nextCompany, nextJobs, nextSkills] = await Promise.all([recruiterApi.stats(), recruiterApi.company(), recruiterApi.jobs(), recruiterApi.skills()])
      setStats(nextStats); setCompany(nextCompany); setJobs(nextJobs); setSkills(nextSkills); setError('')
    } catch (actionError) { setError(actionError.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (section !== 'applications') return
    recruiterApi.applications({ status: applicationStatus }).then((result) => setApplications(result.items || [])).catch((actionError) => setError(actionError.message))
  }, [section, applicationStatus])
  const companyForm = useMemo(() => company ? { name: company.name || '', description: company.description || '', website: company.website || '', address: company.address || '' } : null, [company])
  async function saveCompany(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = Object.fromEntries([...form.entries()].map(([key, value]) => [key, value || undefined]))
    try { setCompany(await recruiterApi.updateCompany(payload)); setError('') } catch (actionError) { setError(actionError.message) }
  }
  async function saveJob(payload) {
    try { if (editingJob?.id) await recruiterApi.updateJob(editingJob.id, payload); else await recruiterApi.createJob(payload); setEditingJob(null); await load() } catch (actionError) { setError(actionError.message) }
  }
  async function updateApplication(application, status, note = '') {
    try {
      await recruiterApi.updateApplicationStatus(application.id, status, note)
      setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status } : item))
      setSelectedApplication(note ? null : { ...application, status })
    } catch (actionError) { setError(actionError.message) }
  }
  async function showSuggestions(job, params = {}) {
    try { setSuggestedCandidates(await recruiterApi.recommendations(job.id, params)) } catch (actionError) { setError(actionError.message) }
  }
  const nav = [{ id: 'dashboard', label: 'Tổng quan' }, { id: 'jobs', label: 'Quản lý tin' }, { id: 'applications', label: 'Ứng viên' }, { id: 'company', label: 'Hồ sơ công ty' }]
  return <main className="recruiter-shell"><aside className="recruiter-sidebar"><div className="recruiter-brand"><b>JC</b><span>Job Connect</span></div><div className="recruiter-profile"><div className="recruiter-avatar">{session.user.fullName?.charAt(0) || 'R'}</div><div><strong>{session.user.fullName}</strong><small>Nhà tuyển dụng</small></div></div><nav>{nav.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => { setSection(item.id); setEditingJob(null) }}>{item.label}</button>)}</nav><button className="logout-button" onClick={logout}>Đăng xuất ↗</button></aside><section className="recruiter-main"><header className="recruiter-header"><div><p className="eyebrow">TRUNG TÂM TUYỂN DỤNG</p><h1>{nav.find((item) => item.id === section)?.label}</h1></div><button className="secondary-button" onClick={load}>↻ Làm mới</button></header>{error && <div className="recruiter-alert">{error}</div>}{loading ? <div className="admin-loading">Đang tải dữ liệu...</div> : section === 'dashboard' && stats ? <Dashboard stats={stats} /> : section === 'jobs' ? <section className="recruiter-card">{editingJob ? <><h2>{editingJob.id ? 'Chỉnh sửa tin tuyển dụng' : 'Tạo tin tuyển dụng'}</h2><JobForm initialJob={editingJob.id ? editingJob : null} skills={skills} onSave={saveJob} onCancel={() => setEditingJob(null)} /></> : <><div className="section-heading"><h2>Danh sách tin tuyển dụng</h2><button className="primary-button" onClick={() => setEditingJob({})}>+ Tạo tin mới</button></div><div className="job-status-tabs">{Object.entries(jobStatuses).map(([status, label]) => <span key={status}>{label}: {stats?.jobsByStatus?.[status] || 0}</span>)}</div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Vị trí</th><th>Trạng thái</th><th>Đơn</th><th>Thao tác</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.title}</strong><small>{job.location || 'Chưa cập nhật'}</small>{job.status === 'REJECTED' && job.moderationNote && <em className="moderation-note">Lý do: {job.moderationNote}</em>}</td><td><span className={`status-pill ${job.status.toLowerCase()}`}>{jobStatuses[job.status]}</span></td><td>{job._count?.applications || 0}</td><td>  <button className="table-link" onClick={() => setEditingJob(job)}>Sửa</button><button className="table-link" onClick={() => showSuggestions(job)}>Gợi ý ứng viên</button>{job.status !== 'CLOSED' && <button className="table-link danger" onClick={() => recruiterApi.closeJob(job.id).then(load).catch((actionError) => setError(actionError.message))}>Đóng</button>}</td></tr>)}</tbody></table>  </div></>}  <SuggestedCandidates result={suggestedCandidates} onClose={() => setSuggestedCandidates(null)} onSearch={(jobId, params) => showSuggestions({ id: jobId }, params)} /></section> : section === 'applications' ? <section className="recruiter-card"><div className="section-heading"><h2>Quản lý ứng viên</h2><select value={applicationStatus} onChange={(event) => setApplicationStatus(event.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(applicationStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Ứng viên</th><th>Tin tuyển dụng</th><th>Trạng thái</th><th>Ngày nộp</th><th>Thao tác</th></tr></thead><tbody>{applications.map((application) => <tr key={application.id}><td><strong>{application.candidate.user.fullName}</strong><small>{application.candidate.user.email}</small></td><td>{application.job.title}</td><td><span className="status-pill">{applicationStatuses[application.status]}</span></td><td>{new Date(application.appliedAt).toLocaleDateString('vi-VN')}</td><td><button className="table-link" onClick={() => setSelectedApplication(application)}>Xem hồ sơ</button></td></tr>)}</tbody></table></div>{selectedApplication && <div className="candidate-detail"><button className="close-detail" onClick={() => setSelectedApplication(null)}>×</button><h2>{selectedApplication.candidate.user.fullName}</h2><p>{selectedApplication.candidate.user.email} · {selectedApplication.candidate.user.phone || 'Chưa có số điện thoại'}</p><p>{selectedApplication.candidate.headline || 'Chưa cập nhật tiêu đề hồ sơ'}</p><div className="candidate-skills">{selectedApplication.candidate.skills.map(({ skill }) => <span key={skill.id}>{skill.name}</span>)}</div>{selectedApplication.resume && <button className="secondary-button" onClick={() => recruiterApi.downloadResume(selectedApplication.resume.id, selectedApplication.resume.fileName).catch((actionError) => setError(actionError.message))}>Tải CV</button>}<div className="application-actions"><select defaultValue={selectedApplication.status} onChange={(event) => updateApplication(selectedApplication, event.target.value)}>{Object.entries(applicationStatuses).filter(([value]) => value !== 'APPLIED' && value !== 'WITHDRAWN').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><textarea placeholder="Ghi chú cho ứng viên (tùy chọn)" id="application-note" /><button className="primary-button" onClick={() => updateApplication(selectedApplication, document.querySelector('#application-status')?.value || selectedApplication.status, document.querySelector('#application-note')?.value)}>Lưu trạng thái và ghi chú</button></div></div>}</section> : <section className="recruiter-card"><h2>Hồ sơ công ty</h2>{companyForm && <form className="recruiter-form" onSubmit={saveCompany}><div className="company-logo-row">{company?.logoUrl && <img src={`http://localhost:5000${company.logoUrl}`} alt="" />}<label>Logo công ty<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files[0] && recruiterApi.uploadLogo(event.target.files[0]).then(setCompany).catch((actionError) => setError(actionError.message))} /></label></div><div className="form-grid"><label>Tên công ty<input name="name" required defaultValue={companyForm.name} /></label><label>Website<input name="website" type="url" defaultValue={companyForm.website} /></label><label>Địa chỉ<input name="address" defaultValue={companyForm.address} /></label></div><label>Giới thiệu<textarea name="description" rows="6" defaultValue={companyForm.description} /></label><button className="primary-button">Lưu hồ sơ</button></form>}</section>}</section></main>
}

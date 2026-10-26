import { useEffect, useState } from 'react'
import { adminApi } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

function JobTable({ jobs, onModerate }) {
  if (!jobs.length) return <div className="empty-state">Hiện không có tin tuyển dụng chờ duyệt.</div>
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Vị trí tuyển dụng</th><th>Công ty</th><th>Ngày cập nhật</th><th>Thao tác</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.title}</strong><small>{job.location || 'Chưa cập nhật địa điểm'}</small></td><td>{job.company?.name || 'Chưa cập nhật'}</td><td>{new Date(job.updatedAt).toLocaleDateString('vi-VN')}</td><td><div className="table-actions"><button className="approve-button" onClick={() => onModerate(job.id, 'PUBLISHED')}>Duyệt</button><button className="reject-button" onClick={() => onModerate(job.id, 'REJECTED')}>Từ chối</button></div></td></tr>)}</tbody></table></div>
}

function UserTable({ users, onToggle }) {
  if (!users.length) return <div className="empty-state">Chưa có tài khoản nào.</div>
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td><button className="table-link" onClick={() => item.onView(item.id)}><strong>{item.fullName}</strong><small>{item.email}</small></button></td><td><span className="role-label">{item.role === 'RECRUITER' ? 'Nhà tuyển dụng' : item.role === 'CANDIDATE' ? 'Ứng viên' : 'Admin'}</span></td><td><span className={`status-pill ${item.status.toLowerCase()}`}>{item.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}</span></td><td>{item.role !== 'ADMIN' && <button className="table-link" onClick={() => onToggle(item)}>{item.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'}</button>}</td></tr>)}</tbody></table></div>
}

export default function AdminDashboardPage() {
  const { session, logout } = useAuth()
  const [activeSection, setActiveSection] = useState('overview')
  const [stats, setStats] = useState(null)
  const [jobs, setJobs] = useState([])
  const [users, setUsers] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState({ groupBy: 'day' })
  const [selectedUser, setSelectedUser] = useState(null)
  const [auditLogs, setAuditLogs] = useState([])
  const [auditFilter, setAuditFilter] = useState('')

  async function loadDashboard() {
    setIsLoading(true)
    try {
      const data = await adminApi.dashboard()
      setStats(data.stats)
      setJobs(data.jobs.items || data.jobs)
      setUsers((data.users.items || data.users).map((user) => ({ ...user, onView: viewUser })))
      setError(null)
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setIsLoading(false)
    }
    async function viewUser(id) {
      try { setSelectedUser(await adminApi.user(id)) } catch (actionError) { setError(actionError.message) }
    }
    async function loadAuditLogs() {
      try { const data = await adminApi.auditLogs(auditFilter ? { entity: auditFilter } : {}); setAuditLogs(data.items) } catch (actionError) { setError(actionError.message) }
    }
  }

  useEffect(() => { loadDashboard() }, [filters])
  useEffect(() => { if (activeSection === 'audit') loadAuditLogs() }, [activeSection, auditFilter])
  async function moderateJob(id, status) {
    const note = status === 'REJECTED' ? window.prompt('Nhập lý do từ chối tin tuyển dụng:') : ''
    if (status === 'REJECTED' && note === null) return
    try { await adminApi.moderateJob(id, status, note); setJobs((current) => current.filter((job) => job.id !== id)) } catch (actionError) { setError(actionError.message) }
  }
  async function toggleUserStatus(item) { try { const updated = await adminApi.updateUserStatus(item.id, item.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE'); setUsers((current) => current.map((user) => user.id === updated.id ? { ...user, status: updated.status } : user)) } catch (actionError) { setError(actionError.message) } }
  const statCards = stats ? [{ label: 'Tổng tài khoản', value: stats.users, note: `${stats.candidates} ứng viên` }, { label: 'Nhà tuyển dụng', value: stats.recruiters, note: `${stats.companies} công ty` }, { label: 'Tin tuyển dụng', value: stats.jobs, note: `${stats.pendingJobs} tin chờ duyệt` }, { label: 'Lượt ứng tuyển', value: stats.applications, note: 'Toàn hệ thống' }] : []

  const chartData = (stats?.series || []).map((item) => ({ period: item.period, users: Object.values(item.users).reduce((sum, value) => sum + value, 0), jobs: Object.values(item.jobs).reduce((sum, value) => sum + value, 0), applications: Object.values(item.applications).reduce((sum, value) => sum + value, 0) }))
  const statusData = [{ name: 'Jobs', value: stats?.jobs || 0 }, { name: 'Ứng tuyển', value: stats?.applications || 0 }, { name: 'Users', value: stats?.users || 0 }]
  return <main className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><span className="admin-brand-mark">JC</span><span>Job Connect</span></div><div className="admin-profile"><div className="avatar">{session.user.fullName?.charAt(0) || 'A'}</div><div><strong>{session.user.fullName}</strong><small>Quản trị viên</small></div></div><nav className="admin-nav" aria-label="Điều hướng quản trị"><button className={activeSection === 'overview' ? 'active' : ''} onClick={() => setActiveSection('overview')}><span>□</span>Tổng quan</button><button className={activeSection === 'jobs' ? 'active' : ''} onClick={() => setActiveSection('jobs')}><span>▤</span>Kiểm duyệt tin</button><button className={activeSection === 'users' ? 'active' : ''} onClick={() => setActiveSection('users')}><span>◌</span>Tài khoản</button><button className={activeSection === 'audit' ? 'active' : ''} onClick={() => setActiveSection('audit')}><span>◉</span>Audit log</button></nav><button className="logout-button" onClick={logout}>Đăng xuất <span>↗</span></button></aside><section className="admin-main"><header className="admin-header"><div><p className="eyebrow">TRUNG TÂM ĐIỀU HÀNH</p><h1>{activeSection === 'overview' ? 'Tổng quan hệ thống' : activeSection === 'jobs' ? 'Kiểm duyệt tin tuyển dụng' : activeSection === 'audit' ? 'Audit log' : 'Quản lý tài khoản'}</h1></div><button className="refresh-button" onClick={loadDashboard}>↻ <span>Làm mới</span></button></header>{error && <div className="admin-alert">{error}</div>}{activeSection === 'overview' && <section className="admin-section"><div className="section-heading"><h2>Khoảng thời gian thống kê</h2><select value={filters.groupBy} onChange={(event) => setFilters({ groupBy: event.target.value })}><option value="day">Theo ngày</option><option value="month">Theo tháng</option><option value="year">Theo năm</option></select></div><div style={{ width: '100%', height: 280 }}><ResponsiveContainer><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis allowDecimals={false} /><Tooltip /><Line type="monotone" dataKey="users" name="User" stroke="#2563eb" /><Line type="monotone" dataKey="jobs" name="Job" stroke="#16a34a" /><Line type="monotone" dataKey="applications" name="Ứng tuyển" stroke="#f97316" /></LineChart></ResponsiveContainer></div><div style={{ display: 'flex', gap: 24, height: 240 }}><ResponsiveContainer><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="users" fill="#2563eb" /><Bar dataKey="jobs" fill="#16a34a" /><Bar dataKey="applications" fill="#f97316" /></BarChart></ResponsiveContainer><ResponsiveContainer><PieChart><Pie data={statusData} dataKey="value" nameKey="name" outerRadius={80} label>{statusData.map((item, index) => <Cell key={item.name} fill={['#2563eb', '#16a34a', '#f97316'][index]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div></section>}{isLoading ? <div className="admin-loading">Đang tải dữ liệu...</div> : <>{(activeSection === 'overview' || activeSection === 'jobs') && <div className="stat-grid">{statCards.map((card) => <article className="stat-card" key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></article>)}</div>}{activeSection === 'audit' ? <section className="admin-section"><div className="section-heading"><h2>Nhật ký hệ thống</h2><select value={auditFilter} onChange={(event) => setAuditFilter(event.target.value)}><option value="">Tất cả đối tượng</option><option value="User">User</option><option value="Job">Job</option><option value="Application">Application</option></select></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th></tr></thead><tbody>{auditLogs.map((log) => <tr key={log.id}><td>{new Date(log.createdAt).toLocaleString('vi-VN')}</td><td>{log.user?.fullName || 'Hệ thống'}</td><td>{log.action}</td><td>{log.entity} #{log.entityId}</td></tr>)}</tbody></table></div></section> : <>{activeSection !== 'users' && <section className="admin-section"><div className="section-heading"><div><p className="eyebrow">CẦN XỬ LÝ</p><h2>Tin đang chờ duyệt</h2></div><button className="view-link" onClick={() => setActiveSection('jobs')}>Xem tất cả →</button></div><JobTable jobs={jobs} onModerate={moderateJob} /></section>}{activeSection !== 'jobs' && <section className="admin-section"><div className="section-heading"><div><p className="eyebrow">THÀNH VIÊN MỚI</p><h2>Tài khoản gần đây</h2></div><button className="view-link" onClick={() => setActiveSection('users')}>Quản lý →</button></div><UserTable users={users} onToggle={toggleUserStatus} /></section>}</>}</>}{selectedUser && <section className="admin-section"><div className="section-heading"><h2>Chi tiết: {selectedUser.fullName}</h2><button className="view-link" onClick={() => setSelectedUser(null)}>Đóng</button></div><p>{selectedUser.email} · {selectedUser.role} · {selectedUser.status}</p>{selectedUser.candidate && <p>{selectedUser.candidate.headline || 'Chưa có tiêu đề hồ sơ'} · {selectedUser.candidate.location || 'Chưa cập nhật địa điểm'}</p>}</section>}</section></main>
}

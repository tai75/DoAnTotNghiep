import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { candidateApi } from '../services/api'
import { useAuth } from '../context/auth'
import AppShell from '../components/AppShell'
import { EmptyState } from '../components/ui'
import './alerts.css'

const frequencies = { INSTANT: 'Ngay lập tức', DAILY: 'Hàng ngày', WEEKLY: 'Hàng tuần' }

function AlertForm({ value, onSave, onCancel }) {
  const [form, setForm] = useState(value)
  return <form className="alert-form" onSubmit={(event) => { event.preventDefault(); onSave(form) }}><label>Tên thông báo<input required maxLength="150" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Từ khóa<input value={form.keyword || ''} onChange={(event) => setForm({ ...form, keyword: event.target.value })} placeholder="Ví dụ: React, Backend" /></label><label>Địa điểm<input value={form.location || ''} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label><label>Hình thức<select value={form.employmentType || ''} onChange={(event) => setForm({ ...form, employmentType: event.target.value || null })}><option value="">Tất cả</option>{['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID'].map((type) => <option key={type}>{type}</option>)}</select></label><label>Lương tối thiểu<input type="number" min="0" value={form.minSalary || ''} onChange={(event) => setForm({ ...form, minSalary: event.target.value ? Number(event.target.value) : null })} /></label><label>Tần suất<select value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })}>{Object.entries(frequencies).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><div className="alert-form-actions"><button type="button" className="ghost-button" onClick={onCancel}>Hủy</button><button className="primary-button">Lưu</button></div></form>
}

export default function AlertsPage() {
  const { session, logout } = useAuth()
  const [alerts, setAlerts] = useState([])
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { candidateApi.alerts().then(setAlerts).catch((requestError) => setError(requestError.message)) }, [])
  async function save(form) {
    try {
      const payload = { ...form, skillIds: form.skillIds || [] }
      if (editing.id) {
        const updated = await candidateApi.updateAlert(editing.id, payload)
        setAlerts((current) => current.map((alert) => alert.id === updated.id ? updated : alert))
      } else {
        const created = await candidateApi.createAlert(payload)
        setAlerts((current) => [created, ...current])
      }
      setEditing(null)
    } catch (requestError) { setError(requestError.message) }
  }
  async function toggle(alert) { try { const updated = await candidateApi.updateAlert(alert.id, { isActive: !alert.isActive }); setAlerts((current) => current.map((item) => item.id === updated.id ? updated : item)) } catch (requestError) { setError(requestError.message) } }
  async function remove(alert) { if (!window.confirm(`Xóa thông báo "${alert.name}"?`)) return; try { await candidateApi.deleteAlert(alert.id); setAlerts((current) => current.filter((item) => item.id !== alert.id)) } catch (requestError) { setError(requestError.message) } }
  const empty = { name: '', keyword: '', location: '', employmentType: null, minSalary: null, frequency: 'DAILY', skillIds: [], isActive: true }
  return <AppShell user={session.user} logout={logout}><main className="candidate-page alerts-page"><header className="simple-page-header"><div><Link to="/jobs">← Tìm việc</Link><p className="eyebrow">ỨNG VIÊN</p><h1>Thông báo việc làm</h1><p>Nhận thông báo khi có việc mới phù hợp với tiêu chí của bạn.</p></div><button className="primary-button" onClick={() => setEditing(empty)}>Tạo thông báo</button></header>{error && <div className="board-message error">{error}</div>}{editing && <section className="alert-editor"><h2>{editing.id ? 'Sửa thông báo' : 'Tạo thông báo'}</h2><AlertForm value={editing} onSave={save} onCancel={() => setEditing(null)} /></section>}{alerts.length ? <section className="alerts-list">{alerts.map((alert) => <article className={`alert-card ${alert.isActive ? '' : 'inactive'}`} key={alert.id}><div><h2>{alert.name}</h2><p>{alert.keyword || 'Mọi từ khóa'} · {alert.location || 'Mọi địa điểm'} · {alert.employmentType || 'Mọi hình thức'}</p><small>{frequencies[alert.frequency]}{alert.lastSentAt ? ` · Gửi lần cuối ${new Date(alert.lastSentAt).toLocaleDateString('vi-VN')}` : ''}</small></div><div className="alert-actions"><button onClick={() => toggle(alert)}>{alert.isActive ? 'Tắt' : 'Bật'}</button><button onClick={() => setEditing(alert)}>Sửa</button><button className="danger-link" onClick={() => remove(alert)}>Xóa</button></div></article>)}</section> : !editing && <EmptyState title="Chưa có thông báo việc làm" description="Tạo thông báo từ bộ lọc tìm kiếm để không bỏ lỡ cơ hội mới." action={<Link className="primary-button" to="/jobs">Tìm việc làm</Link>} />}</main></AppShell>
}

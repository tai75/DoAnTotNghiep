import { useEffect, useState } from 'react'
import { applicationsApi } from '../services/api'
import { Link } from 'react-router-dom'

const labels = { APPLIED: 'Đã nộp', REVIEWING: 'Đang xem xét', SHORTLISTED: 'Vào vòng trong', INTERVIEWING: 'Phỏng vấn', OFFERED: 'Đã đề nghị', ACCEPTED: 'Đã nhận', REJECTED: 'Từ chối', WITHDRAWN: 'Đã rút' }

export default function CandidateApplicationsPage() {
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [message, setMessage] = useState('')
  useEffect(() => { applicationsApi.list().then(setItems).catch((error) => setMessage(error.message)) }, [])
  async function withdraw(item) { if (!window.confirm('Bạn muốn rút đơn ứng tuyển này?')) return; try { const updated = await applicationsApi.withdraw(item.id); setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...updated } : entry)); setMessage('Đã rút đơn ứng tuyển.') } catch (error) { setMessage(error.message) } }
  const visible = filter ? items.filter((item) => item.status === filter) : items
  return <main className="candidate-page"><header className="simple-page-header"><div><Link to="/jobs">← Tìm việc</Link><p className="eyebrow">ỨNG VIÊN</p><h1>Lịch sử ứng tuyển</h1></div><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></header>{message && <div className="board-message">{message}</div>}<section className="application-list">{visible.length ? visible.map((item) => <article className="application-card" key={item.id}><div><span className={`status-pill ${item.status.toLowerCase()}`}>{labels[item.status] || item.status}</span><h2>{item.job.title}</h2><p>{item.job.company?.name} · {item.job.location || 'Toàn quốc'}</p><small>Nộp ngày {new Date(item.appliedAt).toLocaleDateString('vi-VN')}</small></div><div className="application-actions"><button onClick={() => setSelected(item)}>Xem timeline</button>{!['ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(item.status) && <button className="danger-link" onClick={() => withdraw(item)}>Rút đơn</button>}</div></article>) : <div className="board-empty">Chưa có đơn ứng tuyển phù hợp.</div>}</section>{selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><aside className="timeline-modal" onClick={(event) => event.stopPropagation()}><button className="close-detail" onClick={() => setSelected(null)}>×</button><h2>Lịch sử trạng thái</h2><p>{selected.job.title}</p><div className="timeline">{selected.history?.map((event) => <div className="timeline-item" key={event.id}><i /><div><strong>{labels[event.toStatus] || event.toStatus}</strong><small>{new Date(event.createdAt).toLocaleString('vi-VN')}</small>{event.note && <p>{event.note}</p>}</div></div>)}</div></aside></div>}</main>
}

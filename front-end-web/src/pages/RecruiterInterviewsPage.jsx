import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Modal, Toast } from '../components/ui'
import { useAuth } from '../context/auth'
import { useNotifications } from '../context/notifications'
import { recruiterApi, recruiterInterviewsApi } from '../services/api'
import { InterviewDetail } from './CandidateInterviewsPage'
import { displayInterviewTime as displayTime, interviewStatusLabels as labels } from '../utils/interviewUi'
import './interviews.css'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh'

export default function RecruiterInterviewsPage() {
  const { session, logout } = useAuth()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { refresh: refreshNotifications } = useNotifications()
  const [items, setItems] = useState([])
  const [applications, setApplications] = useState([])
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [interviews, managed] = await Promise.all([recruiterInterviewsApi.list({ limit: 50, status: status || undefined }), recruiterApi.applications({ limit: 50 })])
      setItems(interviews.items || []); setApplications((managed.items || []).filter((item) => !['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'OFFERED'].includes(item.status)))
      if (id) setSelected(await recruiterInterviewsApi.get(id))
      const applicationId = Number(searchParams.get('applicationId'))
      if (applicationId) setEditing((current) => current || { applicationId })
    } catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }, [id, searchParams, status])
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer) }, [load])

  async function save(payload) {
    setSaving(true)
    try {
      const data = editing.id ? await recruiterInterviewsApi.update(editing.id, { ...payload, expectedVersion: editing.version }) : await recruiterInterviewsApi.create({ ...payload, requestKey: crypto.randomUUID() })
      setEditing(null); setSelected(data); setToast({ type: 'success', message: editing.id ? 'Đã cập nhật lịch phỏng vấn.' : 'Đã tạo lịch phỏng vấn.' }); await load()
    } catch (requestError) { setToast({ type: 'error', message: requestError.status === 409 ? 'Dữ liệu đã thay đổi. Vui lòng tải lại.' : requestError.message }); await load() }
    finally { setSaving(false) }
  }

  async function cancel(note) {
    setSaving(true)
    try { const updated = await recruiterInterviewsApi.cancel(selected.id, selected.version, note); setSelected(updated); setCancelOpen(false); setToast({ type: 'success', message: 'Đã hủy lịch phỏng vấn.' }); await Promise.all([load(), refreshNotifications({ silent: true })]) }
    catch (requestError) { setCancelOpen(false); setToast({ type: 'error', message: requestError.message }); await load() }
    finally { setSaving(false) }
  }

  return <AppShell user={session.user} logout={logout}><main className="interviews-page recruiter-interviews">
    <header className="interviews-header"><div><Link to="/recruiter">← Trung tâm tuyển dụng</Link><p className="eyebrow">NHÀ TUYỂN DỤNG</p><h1>Quản lý lịch phỏng vấn</h1><p>Đặt lịch, theo dõi phản hồi và quản lý nhiều vòng cho từng hồ sơ.</p></div><button type="button" className="primary-button" onClick={() => setEditing({})}>+ Đặt lịch</button></header>
    <div className="interview-filters"><label>Trạng thái<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tất cả</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button type="button" onClick={load}>Làm mới</button></div>
    {error && <div className="interview-error" role="alert"><span>{error}</span><button type="button" onClick={load}>Thử lại</button></div>}
    {loading ? <div className="interview-grid"><i className="interview-skeleton" /><i className="interview-skeleton" /></div> : items.length ? <div className="interview-grid">{items.map((item) => <article className="interview-card" key={item.id}><div><span className={`interview-status ${item.status.toLowerCase()}`}>{labels[item.status]}</span><small>Vòng {item.round}</small></div><h3>{item.application.candidate.user.fullName}</h3><p>{item.application.job.title}</p><time>{displayTime(item.scheduledStart, item.timezone)}</time><button type="button" onClick={() => setSelected(item)}>Xem chi tiết</button></article>)}</div> : <div className="interview-empty">Chưa có lịch phỏng vấn. Chọn “Đặt lịch” để bắt đầu.</div>}
  </main>
  <Modal open={Boolean(selected) && !editing && !cancelOpen} title="Chi tiết lịch phỏng vấn" onClose={() => setSelected(null)}>{selected && <InterviewDetail interview={selected} onEdit={() => setEditing(selected)} onCancel={() => setCancelOpen(true)} />}</Modal>
  <Modal open={Boolean(editing)} title={editing?.id ? 'Đổi lịch phỏng vấn' : 'Đặt lịch phỏng vấn'} onClose={() => !saving && setEditing(null)}><InterviewForm applications={applications} initial={editing} saving={saving} onSubmit={save} /></Modal>
  <Modal open={cancelOpen} title="Hủy lịch phỏng vấn?" onClose={() => !saving && setCancelOpen(false)}><form className="interview-form" onSubmit={(event) => { event.preventDefault(); cancel(new FormData(event.currentTarget).get('note')) }}><p>Ứng viên sẽ nhận được thông báo hủy lịch.</p><label>Lý do<textarea name="note" maxLength="5000" /></label><button className="danger-button" disabled={saving}>{saving ? 'Đang xử lý…' : 'Xác nhận hủy'}</button></form></Modal>
  <Toast message={toast?.message} type={toast?.type} onClose={() => setToast(null)} /></AppShell>
}

function localValue(value) {
  if (!value) return ''
  const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function InterviewForm({ applications, initial = {}, saving, onSubmit }) {
  const [mode, setMode] = useState(initial.mode || 'ONLINE')
  return <form className="interview-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ applicationId: Number(form.get('applicationId')), scheduledStart: new Date(form.get('start')).toISOString(), scheduledEnd: new Date(form.get('end')).toISOString(), timezone, mode, meetingUrl: mode === 'ONLINE' ? form.get('meetingUrl') : undefined, location: mode === 'ONSITE' ? form.get('location') : undefined, candidateInstructions: form.get('candidateInstructions') || undefined, recruiterNote: form.get('recruiterNote') || undefined }) }}>
    <label>Hồ sơ ứng tuyển<select name="applicationId" required disabled={Boolean(initial.id)} defaultValue={initial.applicationId || ''}><option value="">Chọn ứng viên</option>{applications.map((item) => <option key={item.id} value={item.id}>{item.candidate.user.fullName} · {item.job.title}</option>)}</select></label>
    <div className="interview-form-grid"><label>Bắt đầu<input name="start" type="datetime-local" required defaultValue={localValue(initial.scheduledStart)} /></label><label>Kết thúc<input name="end" type="datetime-local" required defaultValue={localValue(initial.scheduledEnd)} /></label></div>
    <fieldset><legend>Hình thức</legend><label><input type="radio" checked={mode === 'ONLINE'} onChange={() => setMode('ONLINE')} /> Trực tuyến</label><label><input type="radio" checked={mode === 'ONSITE'} onChange={() => setMode('ONSITE')} /> Tại địa điểm</label></fieldset>
    {mode === 'ONLINE' ? <label>Liên kết họp (HTTPS)<input name="meetingUrl" type="url" required defaultValue={initial.meetingUrl || ''} placeholder="https://meet.example/..." /></label> : <label>Địa điểm<input name="location" required defaultValue={initial.location || ''} /></label>}
    <label>Hướng dẫn cho ứng viên<textarea name="candidateInstructions" maxLength="5000" defaultValue={initial.candidateInstructions || ''} /></label><label>Ghi chú nội bộ<textarea name="recruiterNote" maxLength="5000" defaultValue={initial.recruiterNote || ''} /></label><button className="primary-button" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu lịch phỏng vấn'}</button>
  </form>
}

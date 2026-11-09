import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Modal, Toast } from '../components/ui'
import { useAuth } from '../context/auth'
import { useNotifications } from '../context/notifications'
import { candidateInterviewsApi } from '../services/api'
import { displayInterviewTime as displayTime, finalInterviewStatuses as finalStatuses, interviewStatusLabels as labels } from '../utils/interviewUi'
import './interviews.css'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh'

export default function CandidateInterviewsPage() {
  const { session, logout } = useAuth()
  const { id } = useParams()
  const { refresh: refreshNotifications } = useNotifications()
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [dialog, setDialog] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)
  const [now] = useState(() => Date.now())

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await candidateInterviewsApi.list({ limit: 50, sort: 'asc' })
      setItems(result.items || [])
      if (id) setSelected(await candidateInterviewsApi.get(id))
    } catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }, [id])
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer) }, [load])

  const upcoming = useMemo(() => items.filter((item) => !finalStatuses.has(item.status) && new Date(item.scheduledEnd).getTime() >= now), [items, now])
  const history = useMemo(() => items.filter((item) => finalStatuses.has(item.status) || new Date(item.scheduledEnd).getTime() < now), [items, now])

  async function run(action, payload = {}) {
    if (!selected) return
    setSaving(true)
    try {
      let updated
      if (action === 'confirm') updated = await candidateInterviewsApi.confirm(selected.id, selected.version, payload.note)
      if (action === 'decline') updated = await candidateInterviewsApi.decline(selected.id, selected.version, payload.note)
      if (action === 'reschedule') updated = await candidateInterviewsApi.requestReschedule(selected.id, { expectedVersion: selected.version, proposedStart: new Date(payload.start).toISOString(), proposedEnd: new Date(payload.end).toISOString(), timezone, note: payload.note || undefined })
      setSelected(updated); setDialog(''); setToast({ type: 'success', message: 'Phản hồi lịch phỏng vấn đã được lưu.' })
      await Promise.all([load(), refreshNotifications({ silent: true })])
    } catch (requestError) {
      setDialog(''); setToast({ type: 'error', message: requestError.status === 409 ? 'Lịch đã thay đổi. Dữ liệu mới nhất đang được tải lại.' : requestError.message }); await load()
    } finally { setSaving(false) }
  }

  return <AppShell user={session.user} logout={logout}><main className="interviews-page">
    <header className="interviews-header"><div><p className="eyebrow">ỨNG VIÊN</p><h1>Lịch phỏng vấn</h1><p>Xác nhận tham gia hoặc đề xuất thời gian khác. Xác nhận lịch không đồng nghĩa với chấp nhận offer.</p></div></header>
    {error && <div className="interview-error" role="alert"><span>{error}</span><button type="button" onClick={load}>Thử lại</button></div>}
    {loading ? <div className="interview-grid" aria-label="Đang tải"><i className="interview-skeleton" /><i className="interview-skeleton" /></div> : <>
      <InterviewGroup title={`Sắp tới (${upcoming.length})`} items={upcoming} onOpen={setSelected} />
      <InterviewGroup title={`Lịch sử (${history.length})`} items={history} onOpen={setSelected} />
    </>}
  </main>
  <Modal open={Boolean(selected) && !dialog} title="Chi tiết lịch phỏng vấn" onClose={() => setSelected(null)}>{selected && <InterviewDetail interview={selected} candidate onAction={setDialog} />}</Modal>
  <Modal open={Boolean(dialog)} title={dialog === 'reschedule' ? 'Đề xuất đổi lịch' : dialog === 'decline' ? 'Từ chối lịch phỏng vấn' : 'Xác nhận tham gia'} onClose={() => !saving && setDialog('')}>
    {dialog === 'reschedule' ? <ResponseForm submitting={saving} withSchedule onSubmit={(payload) => run('reschedule', payload)} /> : <ResponseForm submitting={saving} submitLabel={dialog === 'decline' ? 'Xác nhận từ chối' : 'Xác nhận tham gia'} onSubmit={(payload) => run(dialog, payload)} />}
  </Modal>
  <Toast message={toast?.message} type={toast?.type} onClose={() => setToast(null)} /></AppShell>
}

function InterviewGroup({ title, items, onOpen }) {
  return <section className="interview-section"><h2>{title}</h2>{items.length ? <div className="interview-grid">{items.map((item) => <article className="interview-card" key={item.id}><div><span className={`interview-status ${item.status.toLowerCase()}`}>{labels[item.status]}</span><small>Vòng {item.round}</small></div><h3>{item.application.job.title}</h3><p>{item.application.job.company.name}</p><time>{displayTime(item.scheduledStart, item.timezone)}</time><button type="button" onClick={() => onOpen(item)}>Xem chi tiết</button></article>)}</div> : <div className="interview-empty">Chưa có lịch phỏng vấn trong mục này.</div>}</section>
}

function InterviewDetail({ interview, candidate, onAction, onEdit, onCancel }) {
  const canRespond = ['PENDING_RESPONSE', 'CONFIRMED'].includes(interview.status)
  return <div className="interview-detail"><span className={`interview-status ${interview.status.toLowerCase()}`}>{labels[interview.status]}</span><h3>{interview.application.job.title} · Vòng {interview.round}</h3><Link to={`/companies/${interview.application.job.company.id}`}>{interview.application.job.company.name}</Link><dl><div><dt>Bắt đầu</dt><dd>{displayTime(interview.scheduledStart, interview.timezone)}</dd></div><div><dt>Kết thúc</dt><dd>{displayTime(interview.scheduledEnd, interview.timezone)}</dd></div><div><dt>Múi giờ</dt><dd>{interview.timezone}</dd></div><div><dt>Hình thức</dt><dd>{interview.mode === 'ONLINE' ? 'Trực tuyến' : 'Tại địa điểm'}</dd></div></dl>{interview.mode === 'ONLINE' ? <a className="meeting-link" href={interview.meetingUrl} target="_blank" rel="noreferrer noopener">Mở liên kết phỏng vấn</a> : <p><strong>Địa điểm:</strong> {interview.location}</p>}{interview.candidateInstructions && <div className="interview-note"><strong>Hướng dẫn</strong><p>{interview.candidateInstructions}</p></div>}{interview.proposedStart && <div className="interview-note"><strong>Thời gian ứng viên đề xuất</strong><p>{displayTime(interview.proposedStart, interview.timezone)} – {displayTime(interview.proposedEnd, interview.timezone)}</p></div>}{interview.candidateResponseNote && <div className="interview-note"><strong>Phản hồi ứng viên</strong><p>{interview.candidateResponseNote}</p></div>}<div className="interview-actions">{candidate && interview.status === 'PENDING_RESPONSE' && <button type="button" className="primary-button" onClick={() => onAction('confirm')}>Xác nhận tham gia</button>}{candidate && canRespond && <button type="button" className="secondary-button" onClick={() => onAction('reschedule')}>Đề xuất đổi lịch</button>}{candidate && !finalStatuses.has(interview.status) && <button type="button" className="danger-button" onClick={() => onAction('decline')}>Từ chối</button>}{onEdit && ['PENDING_RESPONSE', 'CONFIRMED', 'RESCHEDULE_REQUESTED'].includes(interview.status) && <button type="button" className="primary-button" onClick={onEdit}>Đổi lịch</button>}{onCancel && ['PENDING_RESPONSE', 'CONFIRMED', 'RESCHEDULE_REQUESTED'].includes(interview.status) && <button type="button" className="danger-button" onClick={onCancel}>Hủy lịch</button>}</div></div>
}

function ResponseForm({ withSchedule = false, submitting, submitLabel = 'Gửi đề xuất', onSubmit }) {
  return <form className="interview-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ start: form.get('start'), end: form.get('end'), note: form.get('note') }) }}>{withSchedule && <div className="interview-form-grid"><label>Thời gian bắt đầu<input name="start" type="datetime-local" required /></label><label>Thời gian kết thúc<input name="end" type="datetime-local" required /></label></div>}<label>Ghi chú<textarea name="note" maxLength="5000" placeholder="Thông tin bổ sung (không bắt buộc)" /></label><button className="primary-button" disabled={submitting}>{submitting ? 'Đang xử lý…' : submitLabel}</button></form>
}

export { InterviewDetail, ResponseForm }

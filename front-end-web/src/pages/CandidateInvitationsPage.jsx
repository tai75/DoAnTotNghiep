import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Modal, Toast } from '../components/ui'
import { useAuth } from '../context/auth'
import { useNotifications } from '../context/notifications'
import { candidateApi } from '../services/api'
import './invitations.css'

const statusLabels = { PENDING: 'Đang chờ', ACCEPTED: 'Đã chấp nhận', DECLINED: 'Đã từ chối' }
const filters = [['', 'Tất cả'], ['PENDING', 'Đang chờ'], ['ACCEPTED', 'Đã chấp nhận'], ['DECLINED', 'Đã từ chối']]

export default function CandidateInvitationsPage() {
  const { session, logout } = useAuth()
  const { refresh: refreshNotifications } = useNotifications()
  const { id: routeId } = useParams()
  const [data, setData] = useState({ items: [], page: 1, totalPages: 0, total: 0, pendingCount: 0 })
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [confirmStatus, setConfirmStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await candidateApi.invitations({ page, limit: 8, status: status || undefined })) }
    catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }, [page, status])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    if (!routeId) return
    const timer = window.setTimeout(() => {
      setDetailLoading(true)
      candidateApi.invitation(routeId).then(setSelected).catch((requestError) => setError(requestError.message)).finally(() => setDetailLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [routeId])

  async function respond() {
    if (!selected || !confirmStatus) return
    const requestedStatus = confirmStatus
    setSubmitting(true)
    try {
      const updated = await candidateApi.respondToInvitation(selected.id, requestedStatus)
      setSelected(updated); setConfirmStatus('')
      setToast({ type: 'success', message: requestedStatus === 'ACCEPTED' ? 'Bạn đã chấp nhận lời mời.' : 'Bạn đã từ chối lời mời.' })
      await Promise.all([load(), refreshNotifications({ silent: true })])
    } catch (requestError) {
      setConfirmStatus(''); setToast({ type: 'error', message: requestError.message }); await load()
    } finally { setSubmitting(false) }
  }

  return <AppShell user={session.user} logout={logout}><main className="invitations-page">
    <header className="invitations-header"><div><p className="invitations-eyebrow">CƠ HỘI DÀNH CHO BẠN</p><h1>Lời mời tuyển dụng</h1><p>Xem và phản hồi lời mời trực tiếp từ nhà tuyển dụng.</p></div><span className="pending-summary">{data.pendingCount} đang chờ</span></header>
    <div className="invitation-tabs" role="tablist" aria-label="Lọc lời mời">{filters.map(([value, label]) => <button type="button" role="tab" aria-selected={status === value} className={status === value ? 'active' : ''} key={value || 'all'} onClick={() => { setStatus(value); setPage(1) }}>{label}{value === 'PENDING' && data.pendingCount > 0 ? ` (${data.pendingCount})` : ''}</button>)}</div>
    {error && <div className="invitation-error" role="alert"><span>{error}</span><button type="button" onClick={load}>Thử lại</button></div>}
    {loading ? <div className="invitation-list" aria-label="Đang tải lời mời">{[1, 2, 3].map((item) => <div className="invitation-skeleton" key={item} />)}</div> : data.items.length ? <div className="invitation-list">{data.items.map((invitation) => <article className="invitation-card" key={invitation.id}><CompanyLogo company={invitation.job.company} /><div className="invitation-copy"><div><span className={`invitation-status ${invitation.status.toLowerCase()}`}>{statusLabels[invitation.status]}</span>{invitation.unavailableReason && <span className="invitation-unavailable">{invitation.unavailableReason}</span>}</div><h2>{invitation.job.title}</h2><Link to={`/companies/${invitation.job.company.id}`}>{invitation.job.company.name}</Link><p>{invitation.message || 'Nhà tuyển dụng nhận thấy hồ sơ của bạn phù hợp với vị trí này.'}</p><small>Gửi ngày {new Date(invitation.createdAt).toLocaleDateString('vi-VN')}</small></div><button type="button" className="invitation-detail-button" onClick={() => setSelected(invitation)}>Xem chi tiết</button></article>)}</div> : !error && <div className="invitation-empty"><span aria-hidden="true">✉</span><h2>Chưa có lời mời phù hợp</h2><p>Các lời mời từ nhà tuyển dụng sẽ xuất hiện tại đây.</p><Link to="/jobs">Khám phá việc làm</Link></div>}
    {data.totalPages > 1 && <nav className="invitation-pagination" aria-label="Phân trang lời mời"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Trang trước</button><span>Trang {page} / {data.totalPages}</span><button type="button" disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Trang sau</button></nav>}
  </main>
  <Modal open={(Boolean(selected) || detailLoading) && !confirmStatus} title="Chi tiết lời mời" onClose={() => setSelected(null)}>{detailLoading && !selected ? <div>Đang tải…</div> : selected && <InvitationDetail invitation={selected} onRespond={setConfirmStatus} />}</Modal>
  <Modal open={Boolean(confirmStatus)} title={confirmStatus === 'ACCEPTED' ? 'Chấp nhận lời mời?' : 'Từ chối lời mời?'} onClose={() => !submitting && setConfirmStatus('')}><p>{confirmStatus === 'ACCEPTED' ? 'Nhà tuyển dụng sẽ được thông báo rằng bạn quan tâm. Hành động này không tự động tạo đơn ứng tuyển.' : 'Bạn sẽ không thể đổi lại phản hồi sau khi xác nhận.'}</p><div className="invitation-confirm-actions"><button type="button" className="invitation-secondary" disabled={submitting} onClick={() => setConfirmStatus('')}>Quay lại</button><button type="button" className={confirmStatus === 'DECLINED' ? 'invitation-danger' : 'invitation-primary'} disabled={submitting} onClick={respond}>{submitting ? 'Đang xử lý…' : 'Xác nhận'}</button></div></Modal>
  <Toast message={toast?.message} type={toast?.type} onClose={() => setToast(null)} /></AppShell>
}

function CompanyLogo({ company }) {
  return company.logoUrl ? <img className="invitation-logo" src={company.logoUrl} alt={`Logo ${company.name}`} /> : <span className="invitation-logo fallback" aria-hidden="true">{company.name.charAt(0).toUpperCase()}</span>
}

function InvitationDetail({ invitation, onRespond }) {
  return <div className="invitation-detail"><CompanyLogo company={invitation.job.company} /><div><span className={`invitation-status ${invitation.status.toLowerCase()}`}>{statusLabels[invitation.status]}</span><h3>{invitation.job.title}</h3><p className="invitation-company">{invitation.job.company.name}</p></div><dl><div><dt>Địa điểm</dt><dd>{invitation.job.location || 'Chưa cập nhật'}</dd></div><div><dt>Ngày gửi</dt><dd>{new Date(invitation.createdAt).toLocaleString('vi-VN')}</dd></div></dl><div className="invitation-message"><strong>Lời nhắn</strong><p>{invitation.message || 'Nhà tuyển dụng nhận thấy hồ sơ của bạn phù hợp với vị trí này.'}</p></div>{invitation.unavailableReason && <p className="invitation-warning" role="status">{invitation.unavailableReason}</p>}<div className="invitation-detail-actions"><Link to={`/jobs/${invitation.job.id}`}>Xem việc làm</Link>{invitation.status === 'PENDING' && <><button type="button" className="invitation-secondary" onClick={() => onRespond('DECLINED')}>Từ chối</button><button type="button" className="invitation-primary" disabled={!invitation.isActionable} onClick={() => onRespond('ACCEPTED')}>Chấp nhận</button></>}</div></div>
}

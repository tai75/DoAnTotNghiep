import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { EmptyState, Modal, Skeleton, Toast } from '../components/ui'
import { useAuth } from '../context/auth'
import { adminApi } from '../services/api'
import AdminCharts from '../components/AdminCharts'
import { buildAdminChartData, hasValidAdminKpis } from '../utils/adminChartData'

const sections = [['overview', 'Tổng quan'], ['verification', 'Xác minh doanh nghiệp'], ['jobs', 'Tin tuyển dụng'], ['companies', 'Doanh nghiệp'], ['reports', 'Báo cáo vi phạm'], ['users', 'Tài khoản'], ['reviews', 'Đánh giá'], ['audit', 'Nhật ký kiểm toán']]
const labels = { ACTIVE: 'Đang hoạt động', INACTIVE: 'Chưa kích hoạt', BANNED: 'Đã khóa', SUSPENDED: 'Đã đình chỉ', DRAFT: 'Bản nháp', PENDING: 'Chờ xử lý', PUBLISHED: 'Đã đăng', CLOSED: 'Đã đóng', REJECTED: 'Đã từ chối', REVIEWING: 'Đang xem xét', RESOLVED: 'Đã giải quyết', APPROVED: 'Đã duyệt', CANDIDATE: 'Ứng viên', RECRUITER: 'Nhà tuyển dụng', ADMIN: 'Quản trị viên', JOB: 'Tin tuyển dụng', COMPANY: 'Doanh nghiệp', SPAM: 'Nội dung rác', MISLEADING: 'Thông tin sai lệch', DISCRIMINATION: 'Phân biệt đối xử', FRAUD: 'Dấu hiệu lừa đảo', OTHER: 'Lý do khác' }
const actionLabels = { CREATE: 'Tạo mới', UPDATE: 'Cập nhật', DELETE: 'Xóa', USER_STATUS_UPDATED: 'Đổi trạng thái tài khoản', JOB_MODERATION_UPDATED: 'Kiểm duyệt tin tuyển dụng', COMPANY_STATUS_UPDATED: 'Đổi trạng thái doanh nghiệp', REPORT_STATUS_UPDATED: 'Xử lý báo cáo', COMPANY_REVIEW_MODERATION_UPDATED: 'Kiểm duyệt đánh giá', COMPANY_VERIFICATION_SUBMITTED: 'Gửi yêu cầu xác minh doanh nghiệp', COMPANY_VERIFICATION_APPROVED: 'Duyệt xác minh doanh nghiệp', COMPANY_VERIFICATION_REJECTED: 'Từ chối xác minh doanh nghiệp' }
const entityLabels = { User: 'Tài khoản', Job: 'Tin tuyển dụng', Company: 'Doanh nghiệp', Report: 'Báo cáo', CompanyReview: 'Đánh giá', CompanyVerificationRequest: 'Yêu cầu xác minh doanh nghiệp' }
const fmt = (value) => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa cập nhật'
const emptyFilters = () => ({ search: '', status: '', role: '', targetType: '', entity: '', page: 1, limit: 20 })

function Badge({ status }) { return <span className={`status-pill ${String(status).toLowerCase()}`}>{labels[status] || status}</span> }
function Table({ headings, children }) { return <div className="data-table-wrap"><table className="data-table"><thead><tr>{headings.map((item) => <th key={item}>{item}</th>)}</tr></thead><tbody>{children}</tbody></table></div> }
function Pager({ value, onPage }) { return value?.totalPages > 1 && <nav className="admin-pagination" aria-label="Phân trang"><button disabled={value.page <= 1} onClick={() => onPage(value.page - 1)}>Trang trước</button><span>Trang {value.page}/{value.totalPages} · {value.total} kết quả</span><button disabled={value.page >= value.totalPages} onClick={() => onPage(value.page + 1)}>Trang sau</button></nav> }

export default function AdminDashboardPage() {
  const { session, logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('section')
  const [section, setSection] = useState(sections.some(([key]) => key === requested) ? requested : 'overview')
  const [data, setData] = useState({ items: [], pagination: null })
  const [stats, setStats] = useState(null)
  const [filters, setFilters] = useState(emptyFilters)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [action, setAction] = useState(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''))
      if (section === 'overview') {
        const result = await adminApi.dashboard({ groupBy: 'day' })
        if (!hasValidAdminKpis(result.stats)) throw new Error('Dữ liệu thống kê chưa hợp lệ. Vui lòng thử lại.')
        setStats(result.stats)
        setData(result.jobs)
      }
      else if (section === 'verification') setData(await adminApi.verificationRequests({ status: filters.status || 'PENDING', page: filters.page, limit: filters.limit }))
      else if (section === 'jobs') setData(await adminApi.jobs(query))
      else if (section === 'companies') setData(await adminApi.companies(query))
      else if (section === 'reports') setData(await adminApi.reports(query))
      else if (section === 'users') setData(await adminApi.users(query))
      else if (section === 'reviews') setData({ items: await adminApi.reviews(filters.status || 'PENDING'), pagination: null })
      else setData(await adminApi.auditLogs(query))
    } catch (requestError) { setError(requestError.message) } finally { setLoading(false) }
  }, [section, filters])
  useEffect(() => { load() }, [load])

  function changeSection(next) { setSection(next); setSearchParams({ section: next }); setFilters(emptyFilters()); setDetail(null) }
  async function openDetail(item) {
    try { setDetail(section === 'companies' ? await adminApi.company(item.id) : section === 'reports' ? await adminApi.report(item.id) : section === 'users' ? await adminApi.user(item.id) : item) }
    catch (requestError) { setError(requestError.message) }
  }
  function prepare(kind, item, targetStatus) { setAction({ kind, item, targetStatus }); setNote('') }
  async function confirmAction(event) {
    event.preventDefault(); setSaving(true)
    try {
      if (action.kind === 'job') await adminApi.moderateJob(action.item.id, action.targetStatus, note, action.item.updatedAt)
      if (action.kind === 'company') await adminApi.updateCompanyStatus(action.item.id, action.targetStatus, note, action.item.updatedAt)
      if (action.kind === 'report') await adminApi.updateReportStatus(action.item.id, action.targetStatus, note, action.item.updatedAt)
      if (action.kind === 'user') await adminApi.updateUserStatus(action.item.id, action.targetStatus)
      if (action.kind === 'review') await adminApi.moderateReview(action.item.id, action.targetStatus, note)
      if (action.kind === 'verification') await adminApi.decideVerification(action.item.id, action.targetStatus, action.targetStatus === 'REJECTED' ? note : undefined, action.targetStatus === 'APPROVED' ? note : undefined)
      setAction(null); setDetail(null); setToast({ type: 'success', message: 'Thao tác đã được ghi nhận.' }); await load()
    } catch (requestError) { setError(requestError.message); if (requestError.status === 409) await load() } finally { setSaving(false) }
  }

  const statusOptions = section === 'jobs' ? [['', 'Tất cả trạng thái'], ['PENDING', 'Chờ duyệt'], ['PUBLISHED', 'Đã đăng'], ['REJECTED', 'Đã từ chối'], ['CLOSED', 'Đã đóng'], ['DRAFT', 'Bản nháp']] : section === 'companies' ? [['', 'Tất cả trạng thái'], ['ACTIVE', 'Đang hoạt động'], ['SUSPENDED', 'Đã đình chỉ']] : section === 'reports' ? [['', 'Tất cả trạng thái'], ['PENDING', 'Chờ xử lý'], ['REVIEWING', 'Đang xem xét'], ['RESOLVED', 'Đã giải quyết'], ['REJECTED', 'Đã từ chối']] : section === 'users' ? [['', 'Tất cả trạng thái'], ['ACTIVE', 'Đang hoạt động'], ['BANNED', 'Đã khóa']] : null
  const title = sections.find(([key]) => key === section)?.[1]
  const statCards = stats ? [['Tổng tài khoản', stats.users], ['Ứng viên', stats.candidates], ['Nhà tuyển dụng', stats.recruiters], ['Doanh nghiệp', stats.companies], ['Tin tuyển dụng', stats.jobs], ['Lượt ứng tuyển', stats.applications], ['Tin chờ duyệt', stats.pendingJobs]] : []
  const chartData = useMemo(() => stats ? buildAdminChartData(stats) : null, [stats])

  return <AppShell user={session.user} logout={logout}><main className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><span className="admin-brand-mark">JC</span><span>Job Connect</span></div><div className="admin-profile"><div className="avatar">{session.user.fullName?.charAt(0) || 'A'}</div><div><strong>{session.user.fullName}</strong><small>Quản trị viên</small></div></div><nav className="admin-nav" aria-label="Điều hướng quản trị">{sections.map(([key, label]) => <button key={key} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => changeSection(key)}>{label}</button>)}</nav><button className="logout-button" onClick={logout}>Đăng xuất</button></aside>
    <section className="admin-main"><header className="admin-header"><div><p className="eyebrow">TRUNG TÂM ĐIỀU HÀNH</p><h1>{title}</h1></div><button className="refresh-button" aria-label="Làm mới" onClick={load}>↻ <span>Làm mới</span></button></header>{error && <div className="admin-alert" role="alert">{error} <button className="table-link" onClick={load}>Thử lại</button></div>}
      {section === 'overview' && !loading && !error && <><div className="stat-grid">{statCards.map(([label, value]) => <article className="stat-card" key={label}><span>{label}</span><strong>{value}</strong><small>Dữ liệu hệ thống hiện tại</small></article>)}</div>{chartData && <AdminCharts data={chartData} />}</>}
      {section !== 'overview' && section !== 'reviews' && <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); setFilters({ ...filters, page: 1 }) }}>{section !== 'audit' && <label>Tìm kiếm<input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Nhập từ khóa" /></label>}{statusOptions && <label>Trạng thái<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>{statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}{section === 'users' && <label>Vai trò<select value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}><option value="">Tất cả vai trò</option><option value="CANDIDATE">Ứng viên</option><option value="RECRUITER">Nhà tuyển dụng</option><option value="ADMIN">Quản trị viên</option></select></label>}{section === 'reports' && <label>Đối tượng<select value={filters.targetType} onChange={(event) => setFilters({ ...filters, targetType: event.target.value })}><option value="">Tất cả đối tượng</option><option value="JOB">Tin tuyển dụng</option><option value="COMPANY">Doanh nghiệp</option></select></label>}{section === 'audit' && <label>Đối tượng<select value={filters.entity} onChange={(event) => setFilters({ ...filters, entity: event.target.value })}><option value="">Tất cả đối tượng</option><option value="User">Tài khoản</option><option value="Job">Tin tuyển dụng</option><option value="Company">Doanh nghiệp</option><option value="Report">Báo cáo</option></select></label>}<button className="primary-button">Áp dụng</button><button type="button" className="ghost-button" onClick={() => setFilters(emptyFilters())}>Đặt lại</button></form>}
      {loading ? <div className="admin-skeletons"><Skeleton height={80} /><Skeleton height={80} /><Skeleton height={80} /></div> : section === 'overview' && error ? null : section === 'overview' ? <section className="admin-section" aria-labelledby="pending-jobs-title"><div className="section-heading"><h2 id="pending-jobs-title">Tin tuyển dụng chờ duyệt</h2></div><AdminTable section={section} items={data.items || []} onDetail={openDetail} onAction={prepare} /><Pager value={data.pagination} onPage={(page) => setFilters({ ...filters, page })} /></section> : <><AdminTable section={section} items={data.items || []} onDetail={openDetail} onAction={prepare} /><Pager value={data.pagination} onPage={(page) => setFilters({ ...filters, page })} /></>}
    </section><DetailModal section={section} detail={detail} onClose={() => setDetail(null)} onAction={prepare} /><ActionModal action={action} note={note} setNote={setNote} saving={saving} onClose={() => setAction(null)} onSubmit={confirmAction} /><Toast message={toast?.message} type={toast?.type} onClose={() => setToast(null)} /></main></AppShell>
}

function AdminTable({ section, items, onDetail, onAction }) {
  if (!items.length) return section === 'overview' ? <EmptyState title="Không có tin chờ duyệt" description="Hiện không có tin tuyển dụng nào đang chờ duyệt." /> : <EmptyState title="Chưa có dữ liệu" description="Không có kết quả phù hợp với bộ lọc hiện tại." />
  if (section === 'verification') return <Table headings={['Doanh nghiệp', 'Người gửi', 'Hồ sơ', 'Ngày gửi', 'Thao tác']}>{items.map((item) => <tr key={item.id}><td><strong>{item.companyName}</strong><small>{item.company.status === 'SUSPENDED' ? 'Đang đình chỉ' : 'Đang hoạt động'}</small></td><td>{item.submittedBy.fullName}<small>{item.submittedBy.email}</small></td><td><span>{item.address || 'Chưa có địa chỉ'}</span><small>{item.website || item.industry || 'Chưa cập nhật thêm'}</small></td><td>{fmt(item.submittedAt)}</td><td><div className="table-actions"><button className="approve-button" onClick={() => onAction('verification', item, 'APPROVED')}>Duyệt</button><button className="reject-button" onClick={() => onAction('verification', item, 'REJECTED')}>Từ chối</button></div></td></tr>)}</Table>
  if (section === 'jobs' || section === 'overview') return <Table headings={['Tin tuyển dụng', 'Doanh nghiệp', 'Trạng thái', 'Cập nhật', 'Thao tác']}>{items.map((item) => <tr key={item.id}><td><button className="table-link" onClick={() => onDetail(item)}>{item.title}</button><small>{item.location || 'Chưa cập nhật địa điểm'}</small></td><td>{item.company?.name}</td><td><Badge status={item.status} /></td><td>{fmt(item.updatedAt)}</td><td><div className="table-actions">{item.status === 'PENDING' && <><button className="approve-button" onClick={() => onAction('job', item, 'PUBLISHED')}>Duyệt</button><button className="reject-button" onClick={() => onAction('job', item, 'REJECTED')}>Từ chối</button></>}</div></td></tr>)}</Table>
  if (section === 'companies') return <Table headings={['Doanh nghiệp', 'Trạng thái', 'Quy mô dữ liệu', 'Cập nhật', 'Thao tác']}>{items.map((item) => <tr key={item.id}><td><button className="table-link" onClick={() => onDetail(item)}>{item.name}</button><small>{item.industry || 'Chưa cập nhật ngành'}</small></td><td><Badge status={item.status} /></td><td>{item._count?.recruiters || 0} nhà tuyển dụng · {item._count?.jobs || 0} tin</td><td>{fmt(item.updatedAt)}</td><td><button className={item.status === 'ACTIVE' ? 'reject-button' : 'approve-button'} onClick={() => onAction('company', item, item.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')}>{item.status === 'ACTIVE' ? 'Đình chỉ' : 'Khôi phục'}</button></td></tr>)}</Table>
  if (section === 'reports') return <Table headings={['Báo cáo', 'Đối tượng', 'Người gửi', 'Trạng thái', 'Thao tác']}>{items.map((item) => <tr key={item.id}><td><button className="table-link" onClick={() => onDetail(item)}>Báo cáo #{item.id}</button><small>{labels[item.reason]}</small></td><td>{item.job?.title || item.company?.name}</td><td>{item.reporter?.fullName}</td><td><Badge status={item.status} /></td><td><button className="table-link" onClick={() => onDetail(item)}>Xem và xử lý</button></td></tr>)}</Table>
  if (section === 'users') return <Table headings={['Tài khoản', 'Vai trò', 'Trạng thái', 'Ngày tạo', 'Thao tác']}>{items.map((item) => <tr key={item.id}><td><button className="table-link" onClick={() => onDetail(item)}>{item.fullName}</button><small>{item.email}</small></td><td>{labels[item.role]}</td><td><Badge status={item.status} /></td><td>{fmt(item.createdAt)}</td><td>{item.role !== 'ADMIN' && <button className="table-link" onClick={() => onAction('user', item, item.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE')}>{item.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'}</button>}</td></tr>)}</Table>
  if (section === 'reviews') return <Table headings={['Doanh nghiệp', 'Đánh giá', 'Tác giả', 'Thao tác']}>{items.map((item) => <tr key={item.id}><td>{item.company?.name}</td><td><strong>{'★'.repeat(item.rating)} {item.title}</strong><small>{item.pros}</small></td><td>{item.author?.fullName || 'Ẩn danh'}</td><td><div className="table-actions"><button className="approve-button" onClick={() => onAction('review', item, 'APPROVED')}>Duyệt</button><button className="reject-button" onClick={() => onAction('review', item, 'REJECTED')}>Từ chối</button></div></td></tr>)}</Table>
  return <Table headings={['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng']}>{items.map((item) => <tr key={item.id}><td>{fmt(item.createdAt)}</td><td>{item.user?.fullName || 'Hệ thống'}</td><td>{actionLabels[item.action] || 'Hoạt động hệ thống'}</td><td>{entityLabels[item.entity] || 'Đối tượng hệ thống'} #{item.entityId}</td></tr>)}</Table>
}

function DetailModal({ section, detail, onClose, onAction }) {
  if (!detail) return null
  const target = detail.job || detail.company
  return <Modal open title={section === 'reports' ? `Báo cáo #${detail.id}` : detail.name || detail.fullName || detail.title} onClose={onClose}><div className="admin-detail">{section === 'reports' && <><p><strong>Đối tượng:</strong> {target?.title || target?.name}</p><p><strong>Lý do:</strong> {labels[detail.reason]}</p><p><strong>Mô tả:</strong> {detail.description}</p><p><strong>Người gửi:</strong> {detail.reporter?.fullName} · {detail.reporter?.email}</p><p><strong>Trạng thái:</strong> {labels[detail.status]}</p>{['PENDING', 'REVIEWING'].includes(detail.status) && <div className="admin-modal-actions">{detail.status === 'PENDING' && <button className="ghost-button" onClick={() => onAction('report', detail, 'REVIEWING')}>Bắt đầu xem xét</button>}<button className="primary-button" onClick={() => onAction('report', detail, 'RESOLVED')}>Đã giải quyết</button><button className="reject-button" onClick={() => onAction('report', detail, 'REJECTED')}>Từ chối</button></div>}</>}{section === 'companies' && <><p><strong>Trạng thái:</strong> {labels[detail.status]}</p><p>{detail.description || 'Chưa có giới thiệu doanh nghiệp.'}</p><p><strong>Địa chỉ:</strong> {detail.address || 'Chưa cập nhật'}</p><p><strong>Nhà tuyển dụng:</strong> {detail.recruiters?.length || 0} · <strong>Tin tuyển dụng:</strong> {detail.jobs?.length || 0}</p><button className={detail.status === 'ACTIVE' ? 'reject-button' : 'approve-button'} onClick={() => onAction('company', detail, detail.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')}>{detail.status === 'ACTIVE' ? 'Đình chỉ doanh nghiệp' : 'Khôi phục doanh nghiệp'}</button></>}{section === 'users' && <><p><strong>Email:</strong> {detail.email}</p><p><strong>Vai trò:</strong> {labels[detail.role]}</p><p><strong>Trạng thái:</strong> {labels[detail.status]}</p></>}{section === 'jobs' && <><p><strong>Doanh nghiệp:</strong> {detail.company?.name}</p><p><strong>Trạng thái:</strong> {labels[detail.status]}</p><p className="admin-preline">{detail.description}</p></>}</div></Modal>
}

function ActionModal({ action, note, setNote, saving, onClose, onSubmit }) {
  if (!action) return null
  const needsNote = ['REJECTED', 'SUSPENDED', 'RESOLVED'].includes(action.targetStatus)
  const title = action.kind === 'verification' ? (action.targetStatus === 'APPROVED' ? 'Duyệt xác minh doanh nghiệp' : 'Từ chối xác minh doanh nghiệp') : action.kind === 'company' ? (action.targetStatus === 'SUSPENDED' ? 'Đình chỉ doanh nghiệp' : 'Khôi phục doanh nghiệp') : action.kind === 'job' ? (action.targetStatus === 'PUBLISHED' ? 'Duyệt tin tuyển dụng' : 'Từ chối tin tuyển dụng') : action.kind === 'report' ? 'Cập nhật báo cáo' : action.kind === 'user' ? 'Đổi trạng thái tài khoản' : 'Kiểm duyệt đánh giá'
  return <Modal open title={title} onClose={onClose}><form className="admin-action-form" onSubmit={onSubmit}><p>{action.kind === 'company' && action.targetStatus === 'SUSPENDED' ? 'Doanh nghiệp và các tin đang đăng sẽ bị ẩn khỏi trang công khai. Dữ liệu ứng tuyển hiện có vẫn được giữ nguyên.' : 'Vui lòng xác nhận thao tác quản trị này.'}</p><label>Ghi chú {needsNote ? '(bắt buộc)' : '(tùy chọn)'}<textarea rows="4" required={needsNote} maxLength="2000" value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="admin-modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Hủy</button><button className="primary-button" disabled={saving}>{saving ? 'Đang lưu...' : 'Xác nhận'}</button></div></form></Modal>
}

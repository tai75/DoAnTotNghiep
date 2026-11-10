import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import PublicFooter from '../components/PublicFooter'
import ReportModal from '../components/ReportModal'
import { EmptyState, Skeleton } from '../components/ui'
import { useAuth } from '../context/auth'
import useDocumentMeta from '../hooks/useDocumentMeta'
import { companiesApi } from '../services/api'
import '../board.css'
import '../public.css'

const ASSET_URL = (import.meta.env.VITE_ASSET_URL || '').replace(/\/$/, '')
const employmentLabels = { FULL_TIME: 'Toàn thời gian', PART_TIME: 'Bán thời gian', INTERNSHIP: 'Thực tập', CONTRACT: 'Hợp đồng', REMOTE: 'Từ xa', HYBRID: 'Kết hợp' }

function formatSalary(job) {
  if (!job.minSalary && !job.maxSalary) return 'Thỏa thuận'
  const format = (value) => `${Number(value).toLocaleString('vi-VN')} đ`
  return job.minSalary && job.maxSalary ? `${format(job.minSalary)} – ${format(job.maxSalary)}` : format(job.minSalary || job.maxSalary)
}

export default function CompanyPage() {
  const { session, logout } = useAuth()
  const { id } = useParams()
  const [company, setCompany] = useState(null)
  const [state, setState] = useState({ loading: true, error: '' })
  const [following, setFollowing] = useState(false)
  const [review, setReview] = useState({ rating: 5, title: '', pros: '', cons: '', isAnonymous: false })
  const [reviewMessage, setReviewMessage] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportMessage, setReportMessage] = useState('')
  useDocumentMeta(company ? `${company.name} — Job Connect` : 'Thông tin doanh nghiệp — Job Connect', company ? `Hồ sơ doanh nghiệp ${company.name} và các việc làm đang tuyển.` : 'Khám phá hồ sơ doanh nghiệp và việc làm đang tuyển trên Job Connect.')

  const load = useCallback(() => {
    setState({ loading: true, error: '' })
    return companiesApi.get(id).then((result) => { setCompany(result); setState({ loading: false, error: '' }) }).catch((error) => setState({ loading: false, error: error.message }))
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (session?.user?.role === 'CANDIDATE') companiesApi.following(id).then((result) => setFollowing(result.following)).catch(() => {}) }, [id, session])

  async function toggleFollow() {
    try {
      if (following) await companiesApi.unfollow(id)
      else await companiesApi.follow(id)
      setFollowing(!following)
    } catch (error) { setState((current) => ({ ...current, error: error.message })) }
  }

  async function submitReview(event) {
    event.preventDefault()
    try {
      await companiesApi.review(id, { ...review, rating: Number(review.rating) })
      setReviewMessage('Đánh giá đã được gửi và đang chờ kiểm duyệt.')
      setReview({ rating: 5, title: '', pros: '', cons: '', isAnonymous: false })
    } catch (error) { setReviewMessage(error.message) }
  }

  return <AppShell user={session?.user} logout={logout}><main className="company-public-page">
    <Link className="company-directory-back" to="/companies">← Danh sách doanh nghiệp</Link>
    {state.error ? <div className="board-message error" role="alert">{state.error} <button className="ghost-button" onClick={load}>Thử lại</button></div> : state.loading ? <div className="company-loading"><Skeleton height={160} /><Skeleton height={320} /></div> : company && <>
      <header className="company-public-header">{company.logoUrl ? <img src={`${ASSET_URL}${company.logoUrl}`} alt={`Logo ${company.name}`} /> : <div className="company-public-logo" aria-hidden="true">{company.name?.charAt(0) || 'C'}</div>}<div><p className="eyebrow">NHÀ TUYỂN DỤNG</p><h1>{company.name}</h1><p>{company.address || 'Địa chỉ đang cập nhật'}{company.website && <> · <a href={company.website} target="_blank" rel="noreferrer">Trang web doanh nghiệp</a></>}</p>{session?.user?.role === 'CANDIDATE' && <button className="primary-button" onClick={toggleFollow}>{following ? 'Đang theo dõi' : 'Theo dõi doanh nghiệp'}</button>} {['CANDIDATE', 'RECRUITER'].includes(session?.user?.role) && <button type="button" className="ghost-button" onClick={() => setReportOpen(true)}>Báo cáo</button>}{reportMessage && <small role="status">{reportMessage}</small>}</div></header>
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} targetType="COMPANY" targetId={company.id} targetName={company.name} onSuccess={setReportMessage} />
      <section className="company-public-content"><article><h2>Giới thiệu doanh nghiệp</h2><p>{company.description || 'Thông tin doanh nghiệp đang được cập nhật.'}</p><p>{company.industry || 'Ngành chưa cập nhật'} · {company.employeeCount ? `${company.employeeCount.toLocaleString('vi-VN')} nhân sự` : 'Quy mô chưa cập nhật'}</p><h2>Đánh giá {company.averageRating ? `★ ${Number(company.averageRating).toFixed(1)}/5` : ''}</h2>{company.reviews?.length ? company.reviews.map((item) => <div className="company-review" key={item.id}><strong>{'★'.repeat(item.rating)} {item.title}</strong><small>{item.author ? item.author.fullName : 'Ẩn danh'} · {new Date(item.createdAt).toLocaleDateString('vi-VN')}</small><p>Ưu điểm: {item.pros}</p><p>Hạn chế: {item.cons}</p></div>) : <p>Chưa có đánh giá đã duyệt.</p>}{session?.user?.role === 'CANDIDATE' && <form className="company-review-form" onSubmit={submitReview}><h3>Viết đánh giá</h3><label>Số sao<select value={review.rating} onChange={(event) => setReview({ ...review, rating: event.target.value })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} sao</option>)}</select></label><label>Tiêu đề<input required value={review.title} onChange={(event) => setReview({ ...review, title: event.target.value })} /></label><label>Ưu điểm<textarea required value={review.pros} onChange={(event) => setReview({ ...review, pros: event.target.value })} /></label><label>Hạn chế<textarea required value={review.cons} onChange={(event) => setReview({ ...review, cons: event.target.value })} /></label><label><input type="checkbox" checked={review.isAnonymous} onChange={(event) => setReview({ ...review, isAnonymous: event.target.checked })} /> Đăng ẩn danh</label><button className="primary-button">Gửi đánh giá</button>{reviewMessage && <small role="status">{reviewMessage}</small>}</form>}</article><section><div className="public-list-heading"><div><p className="eyebrow">CƠ HỘI TẠI {company.name?.toUpperCase()}</p><h2>{company.jobs?.length || 0} việc làm đang tuyển</h2></div></div>{company.jobs?.length ? <div className="company-job-list">{company.jobs.map((job) => <Link className="company-job-card" to={`/jobs/${job.id}`} key={job.id}><strong>{job.title}</strong><span>{job.location || 'Toàn quốc'} · {employmentLabels[job.employmentType] || 'Linh hoạt'}</span><b>{formatSalary(job)}</b><small>{job.applicantCount || 0} ứng viên{job.deadline ? ` · Hạn ${new Date(job.deadline).toLocaleDateString('vi-VN')}` : ''}</small></Link>)}</div> : <EmptyState title="Chưa có việc làm đang tuyển" description="Doanh nghiệp hiện chưa có vị trí công khai còn nhận hồ sơ." />}</section></section>
    </>}
  </main><PublicFooter /></AppShell>
}

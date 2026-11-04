import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { companiesApi } from '../services/api'
import { useAuth } from '../context/auth'
import AppShell from '../components/AppShell'
import { EmptyState, Skeleton } from '../components/ui'
import '../board.css'

const ASSET_URL = (import.meta.env.VITE_ASSET_URL || '').replace(/\/$/, '')

function formatSalary(job) {
  if (!job.minSalary && !job.maxSalary) return 'Thỏa thuận'
  const format = (value) => `${Number(value).toLocaleString('vi-VN')} đ`
  return job.minSalary && job.maxSalary ? `${format(job.minSalary)} - ${format(job.maxSalary)}` : format(job.minSalary || job.maxSalary)
}

export default function CompanyPage() {
  const { session, logout } = useAuth()
  const { id } = useParams()
  const [company, setCompany] = useState(null)
  const [error, setError] = useState('')
  const [following, setFollowing] = useState(false)
  const [review, setReview] = useState({ rating: 5, title: '', pros: '', cons: '', isAnonymous: false })
  const [reviewMessage, setReviewMessage] = useState('')
  useEffect(() => { companiesApi.get(id).then(setCompany).catch((actionError) => setError(actionError.message)); if (session?.user?.role === 'CANDIDATE') companiesApi.following(id).then((result) => setFollowing(result.following)).catch(() => {}) }, [id, session])
  async function toggleFollow() {
    try { if (following) await companiesApi.unfollow(id); else await companiesApi.follow(id); setFollowing(!following) } catch (actionError) { setError(actionError.message) }
  }
  async function submitReview(event) {
    event.preventDefault()
    try { await companiesApi.review(id, { ...review, rating: Number(review.rating) }); setReviewMessage('Review đã được gửi và đang chờ kiểm duyệt.'); setReview({ rating: 5, title: '', pros: '', cons: '', isAnonymous: false }) } catch (actionError) { setReviewMessage(actionError.message) }
  }
  return <AppShell user={session?.user} logout={logout}><main className="company-public-page">{error ? <div className="board-message error">{error}</div> : !company ? <div className="company-loading"><Skeleton height={120} /><Skeleton height={24} /></div> : <><header className="company-public-header">{company.logoUrl ? <img src={`${ASSET_URL}${company.logoUrl}`} alt="" /> : <div className="company-public-logo">{company.name?.charAt(0) || 'C'}</div>}<div><p className="eyebrow">NHÀ TUYỂN DỤNG</p><h1>{company.name}</h1>  <p>{company.address || 'Địa chỉ đang cập nhật'}{company.website && <> · <a href={company.website} target="_blank" rel="noreferrer">Website</a></>}</p>{session?.user?.role === 'CANDIDATE' && <button className="primary-button" onClick={toggleFollow}>{following ? 'Đang theo dõi' : 'Theo dõi'}</button>}</div></header><section className="company-public-content"><article><h2>Giới thiệu công ty</h2><p>{company.description || 'Thông tin công ty đang được cập nhật.'}</p><p>{company.industry || 'Ngành chưa cập nhật'} · {company.employeeCount ? `${company.employeeCount} nhân sự` : 'Quy mô chưa cập nhật'}</p><h2>Đánh giá {company.averageRating ? `★ ${Number(company.averageRating).toFixed(1)}/5` : ''}</h2>{company.reviews?.length ? company.reviews.map((item) => <div className="company-review" key={item.id}><strong>{'★'.repeat(item.rating)} {item.title}</strong><small>{item.author ? item.author.fullName : 'Ẩn danh'} · {new Date(item.createdAt).toLocaleDateString('vi-VN')}</small><p>Ưu điểm: {item.pros}</p><p>Hạn chế: {item.cons}</p></div>) : <p>Chưa có đánh giá đã duyệt.</p>}{session?.user?.role === 'CANDIDATE' && <form className="company-review-form" onSubmit={submitReview}><h3>Viết đánh giá</h3><select value={review.rating} onChange={(event) => setReview({ ...review, rating: event.target.value })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} sao</option>)}</select><input required placeholder="Tiêu đề" value={review.title} onChange={(event) => setReview({ ...review, title: event.target.value })} /><textarea required placeholder="Ưu điểm" value={review.pros} onChange={(event) => setReview({ ...review, pros: event.target.value })} /><textarea required placeholder="Hạn chế" value={review.cons} onChange={(event) => setReview({ ...review, cons: event.target.value })} /><label><input type="checkbox" checked={review.isAnonymous} onChange={(event) => setReview({ ...review, isAnonymous: event.target.checked })} /> Đăng ẩn danh</label><button className="primary-button">Gửi đánh giá</button>{reviewMessage && <small>{reviewMessage}</small>}</form>}</article><section><div className="public-list-heading"><div><p className="eyebrow">CƠ HỘI TẠI {company.name?.toUpperCase()}</p><h2>{company.jobs?.length || 0} việc làm đang tuyển</h2></div></div>{company.jobs?.length ? <div className="company-job-list">{company.jobs.map((job) => <Link className="company-job-card" to={`/jobs/${job.id}`} key={job.id}><strong>{job.title}</strong><span>{job.location || 'Toàn quốc'} · {job.employmentType || 'Toàn thời gian'}</span><b>{formatSalary(job)}</b><small>{job.applicantCount || 0} ứng viên</small></Link>)}</div> : <EmptyState title="Chưa có việc làm đang tuyển" />}</section></section></>}</main></AppShell>
}

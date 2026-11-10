import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import PublicFooter from '../components/PublicFooter'
import { EmptyState, Skeleton } from '../components/ui'
import { useAuth } from '../context/auth'
import useDocumentMeta from '../hooks/useDocumentMeta'
import { companiesApi, jobsApi } from '../services/api'
import '../public.css'

const ASSET_URL = (import.meta.env.VITE_ASSET_URL || '').replace(/\/$/, '')
const employmentLabels = { FULL_TIME: 'Toàn thời gian', PART_TIME: 'Bán thời gian', INTERNSHIP: 'Thực tập', CONTRACT: 'Hợp đồng', REMOTE: 'Từ xa', HYBRID: 'Kết hợp' }

function formatSalary(job) {
  if (!job.minSalary && !job.maxSalary) return 'Thỏa thuận'
  const money = (value) => `${Number(value).toLocaleString('vi-VN')} đ`
  return job.minSalary && job.maxSalary ? `${money(job.minSalary)} – ${money(job.maxSalary)}` : money(job.minSalary || job.maxSalary)
}

function Logo({ company }) {
  return company.logoUrl ? <img className="public-logo" src={`${ASSET_URL}${company.logoUrl}`} alt={`Logo ${company.name}`} /> : <span className="public-logo" aria-hidden="true">{company.name?.charAt(0) || 'J'}</span>
}

export default function HomePage() {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState({ keyword: '', location: '' })
  const [jobs, setJobs] = useState([])
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useDocumentMeta('Job Connect — Kết nối việc làm phù hợp', 'Tìm việc làm đang tuyển và khám phá doanh nghiệp uy tín trên Job Connect.')

  useEffect(() => {
    let active = true
    Promise.all([jobsApi.list({ limit: 6, sort: 'newest' }), companiesApi.list({ limit: 6 })])
      .then(([jobData, companyData]) => { if (active) { setJobs(jobData.items); setCompanies(companyData.items) } })
      .catch((requestError) => active && setError(requestError.message))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  const popularSkills = useMemo(() => {
    const counts = new Map()
    jobs.forEach((job) => job.skills?.forEach(({ skill }) => counts.set(skill.name, (counts.get(skill.name) || 0) + 1)))
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi')).slice(0, 8)
  }, [jobs])

  function submitSearch(event) {
    event.preventDefault()
    const params = new URLSearchParams()
    if (search.keyword.trim()) params.set('search', search.keyword.trim())
    if (search.location.trim()) params.set('location', search.location.trim())
    navigate(`/jobs${params.size ? `?${params}` : ''}`)
  }

  return <AppShell user={session?.user} logout={logout}>
    <main className="home-page">
      <section className="home-hero" aria-labelledby="home-title"><div className="home-hero-content"><p className="eyebrow">CƠ HỘI NGHỀ NGHIỆP DÀNH CHO BẠN</p><h1 id="home-title">Tìm công việc phù hợp. Xây dựng tương lai vững vàng.</h1><p>Khám phá các vị trí đang tuyển từ dữ liệu thật và kết nối trực tiếp với doanh nghiệp.</p><form className="home-search" role="search" onSubmit={submitSearch}><label><span>Từ khóa</span><input value={search.keyword} onChange={(event) => setSearch({ ...search, keyword: event.target.value })} placeholder="Chức danh, kỹ năng..." /></label><label><span>Địa điểm</span><input value={search.location} onChange={(event) => setSearch({ ...search, location: event.target.value })} placeholder="Tỉnh, thành phố..." /></label><button className="primary-button">Tìm việc làm</button></form></div><div className="home-hero-card" aria-hidden="true"><span>JC</span><strong>Cơ hội phù hợp đang chờ bạn</strong><i>Việc làm xác thực · Bộ lọc rõ ràng · Ứng tuyển thuận tiện</i></div></section>

      {error && <div className="public-error" role="alert"><p>{error}</p><button onClick={() => window.location.reload()}>Thử lại</button></div>}

      <section className="home-section" aria-labelledby="latest-jobs"><div className="section-title"><div><p className="eyebrow">MỚI CẬP NHẬT</p><h2 id="latest-jobs">Việc làm mới nhất</h2></div><Link to="/jobs">Xem tất cả việc làm →</Link></div>{loading ? <div className="home-card-grid">{[1, 2, 3].map((item) => <Skeleton key={item} height={180} />)}</div> : jobs.length ? <div className="home-card-grid">{jobs.map((job) => <article className="home-job-card" key={job.id}><div className="card-company"><Logo company={job.company} /><div><Link to={`/jobs/${job.id}`}><h3>{job.title}</h3></Link><Link to={`/companies/${job.company.id}`}>{job.company.name}</Link></div></div><p>{job.location || 'Toàn quốc'} · {employmentLabels[job.employmentType] || 'Linh hoạt'}</p><strong>{formatSalary(job)}</strong><Link className="card-link" to={`/jobs/${job.id}`}>Xem chi tiết <span aria-hidden="true">→</span></Link></article>)}</div> : <EmptyState title="Chưa có việc làm đang tuyển" description="Các cơ hội mới sẽ xuất hiện tại đây khi được doanh nghiệp đăng và duyệt." />}</section>

      <section className="home-section home-soft-section" aria-labelledby="popular-skills"><div className="section-title"><div><p className="eyebrow">NHU CẦU TUYỂN DỤNG</p><h2 id="popular-skills">Kỹ năng tuyển dụng nổi bật</h2></div></div>{popularSkills.length ? <div className="skill-category-grid">{popularSkills.map(([skill, count]) => <Link to={`/jobs?skill=${encodeURIComponent(skill)}`} key={skill}><strong>{skill}</strong><span>{count} việc làm trong danh sách mới nhất</span></Link>)}</div> : !loading && <EmptyState title="Chưa có dữ liệu kỹ năng" description="Dữ liệu sẽ được tổng hợp từ các việc làm đang tuyển." />}</section>

      <section className="home-section" aria-labelledby="featured-companies"><div className="section-title"><div><p className="eyebrow">DOANH NGHIỆP ĐANG TUYỂN</p><h2 id="featured-companies">Doanh nghiệp nổi bật</h2></div><Link to="/companies">Khám phá doanh nghiệp →</Link></div>{loading ? <div className="company-preview-grid">{[1, 2, 3].map((item) => <Skeleton key={item} height={160} />)}</div> : companies.length ? <div className="company-preview-grid">{companies.map((company) => <Link className="company-preview-card" to={`/companies/${company.id}`} key={company.id}><Logo company={company} /><strong>{company.name}</strong><span>{company.industry || 'Đa lĩnh vực'}</span><small>{company.activeJobCount} việc làm đang tuyển</small></Link>)}</div> : <EmptyState title="Chưa có doanh nghiệp đang tuyển" />}</section>

      <section className="home-section how-section" aria-labelledby="how-title"><div className="section-title"><div><p className="eyebrow">BẮT ĐẦU DỄ DÀNG</p><h2 id="how-title">Tìm việc qua ba bước</h2></div></div><div className="how-grid"><article><span>01</span><h3>Tìm kiếm</h3><p>Dùng từ khóa và bộ lọc để thu hẹp các cơ hội phù hợp.</p></article><article><span>02</span><h3>Khám phá</h3><p>Xem kỹ thông tin công việc, kỹ năng và hồ sơ doanh nghiệp.</p></article><article><span>03</span><h3>Ứng tuyển</h3><p>Đăng nhập, chọn CV và gửi hồ sơ trực tiếp trên Job Connect.</p></article></div></section>

      <section className="home-cta"><div><p className="eyebrow">BẠN ĐÃ SẴN SÀNG?</p><h2>Một nơi cho cả ứng viên và nhà tuyển dụng</h2><p>Tạo tài khoản để lưu việc làm, quản lý hồ sơ hoặc bắt đầu tuyển người phù hợp.</p></div><div><Link className="primary-button" to="/register">Tạo hồ sơ ứng viên</Link><Link className="secondary-button" to="/register?role=RECRUITER">Đăng tuyển dụng</Link></div></section>
    </main>
    <PublicFooter />
  </AppShell>
}

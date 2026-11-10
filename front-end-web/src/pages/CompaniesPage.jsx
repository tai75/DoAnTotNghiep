import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import PublicFooter from '../components/PublicFooter'
import { EmptyState, Skeleton } from '../components/ui'
import { useAuth } from '../context/auth'
import useDocumentMeta from '../hooks/useDocumentMeta'
import { companiesApi } from '../services/api'
import '../public.css'

const ASSET_URL = (import.meta.env.VITE_ASSET_URL || '').replace(/\/$/, '')

export default function CompaniesPage() {
  const { session, logout } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [draft, setDraft] = useState(() => ({ search: searchParams.get('search') || '', industry: searchParams.get('industry') || '' }))
  const [data, setData] = useState({ items: [], industries: [], pagination: null })
  const [state, setState] = useState({ loading: true, error: '' })
  useDocumentMeta('Danh sách doanh nghiệp — Job Connect', 'Khám phá doanh nghiệp đang tuyển dụng và các vị trí công khai trên Job Connect.')
  const query = searchParams.toString()
  const load = useCallback(() => {
    setState({ loading: true, error: '' })
    return companiesApi.list(Object.fromEntries(new URLSearchParams(query))).then((result) => { setData(result); setState({ loading: false, error: '' }) }).catch((error) => setState({ loading: false, error: error.message }))
  }, [query])
  useEffect(() => { load() }, [load])
  useEffect(() => { const params = new URLSearchParams(query); setDraft({ search: params.get('search') || '', industry: params.get('industry') || '' }) }, [query])

  function apply(event) {
    event.preventDefault()
    setSearchParams(Object.fromEntries(Object.entries({ ...draft, page: '' }).filter(([, value]) => value)))
  }

  return <AppShell user={session?.user} logout={logout}><main className="companies-page"><header className="directory-hero"><p className="eyebrow">NƠI LÀM VIỆC TIẾP THEO</p><h1>Khám phá doanh nghiệp đang tuyển dụng</h1><p>Tìm hiểu hồ sơ doanh nghiệp và xem các vị trí công khai còn nhận hồ sơ.</p><form onSubmit={apply} role="search"><label><span>Tìm doanh nghiệp</span><input value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder="Tên, ngành hoặc địa điểm..." /></label><label><span>Ngành</span><select value={draft.industry} onChange={(event) => setDraft({ ...draft, industry: event.target.value })}><option value="">Tất cả ngành</option>{data.industries.map((industry) => <option key={industry}>{industry}</option>)}</select></label><button className="primary-button">Tìm kiếm</button><button type="button" className="ghost-button" onClick={() => setSearchParams({})}>Đặt lại</button></form></header>
  {state.error && <div className="public-error" role="alert"><p>{state.error}</p><button onClick={load}>Thử lại</button></div>}
  <section className="directory-content" aria-labelledby="company-list-title"><div className="section-title"><div><p className="eyebrow">DANH SÁCH DOANH NGHIỆP</p><h2 id="company-list-title">{data.pagination?.total || 0} doanh nghiệp đang tuyển</h2></div></div>{state.loading ? <div className="directory-grid">{[1, 2, 3, 4, 5, 6].map((item) => <Skeleton key={item} height={220} />)}</div> : data.items.length ? <div className="directory-grid">{data.items.map((company) => <article className="directory-card" key={company.id}>{company.logoUrl ? <img className="public-logo large" src={`${ASSET_URL}${company.logoUrl}`} alt={`Logo ${company.name}`} /> : <span className="public-logo large" aria-hidden="true">{company.name.charAt(0)}</span>}<div><h3><Link to={`/companies/${company.id}`}>{company.name}</Link></h3><p>{company.industry || 'Đa lĩnh vực'}{company.address ? ` · ${company.address}` : ''}</p></div><p>{company.description || 'Doanh nghiệp chưa cập nhật phần giới thiệu.'}</p><div className="directory-card-footer"><strong>{company.activeJobCount} việc làm đang tuyển</strong><Link to={`/companies/${company.id}`}>Xem doanh nghiệp →</Link></div></article>)}</div> : <EmptyState title="Không tìm thấy doanh nghiệp" description="Hãy thử từ khóa khác hoặc đặt lại bộ lọc." />}{data.pagination?.totalPages > 1 && <nav className="pagination" aria-label="Phân trang doanh nghiệp">{Array.from({ length: data.pagination.totalPages }, (_, index) => index + 1).map((page) => <button aria-current={data.pagination.page === page ? 'page' : undefined} className={data.pagination.page === page ? 'active' : ''} key={page} onClick={() => setSearchParams((current) => { const next = new URLSearchParams(current); next.set('page', page); return next })}>{page}</button>)}</nav>}</section></main><PublicFooter /></AppShell>
}

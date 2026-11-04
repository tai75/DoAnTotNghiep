import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { applicationsApi, candidateApi, jobsApi, notificationsApi } from '../services/api'
import { useAuth } from '../context/auth'
import AppShell from '../components/AppShell'
import { Badge, EmptyState, Modal, Skeleton } from '../components/ui'
import '../board.css'
import './alerts.css'

const ASSET_URL = (import.meta.env.VITE_ASSET_URL || '').replace(/\/$/, '')
const employmentTypes = [['', 'Hình thức'], ['FULL_TIME', 'Toàn thời gian'], ['PART_TIME', 'Bán thời gian'], ['INTERNSHIP', 'Thực tập'], ['CONTRACT', 'Hợp đồng'], ['REMOTE', 'Remote'], ['HYBRID', 'Hybrid']]
const postedOptions = [['', 'Thời gian đăng'], ['1', '24 giờ qua'], ['7', '7 ngày qua'], ['30', '30 ngày qua']]
const initialFilters = { search: '', location: '', minSalary: '', maxSalary: '', skill: '', employmentType: '', postedWithin: '', maxApplicants: '', sort: 'newest', page: '1' }

function formatSalary(job) {
  if (!job.minSalary && !job.maxSalary) return 'Thỏa thuận'
  const format = (value) => `${Number(value).toLocaleString('vi-VN')} đ`
  return job.minSalary && job.maxSalary ? `${format(job.minSalary)} - ${format(job.maxSalary)}` : format(job.minSalary || job.maxSalary)
}

function relativeDate(value) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000))
  return days === 0 ? 'Hôm nay' : `Đăng ${days} ngày trước`
}

function logoUrl(company) {
  return company?.logoUrl ? `${ASSET_URL}${company.logoUrl}` : ''
}

function LoginAction({ returnTo, children }) {
  return <Link className="primary-button" to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>{children}</Link>
}

function SearchAlertModal({ filters, onClose, onCreated }) {
  const [name, setName] = useState(filters.search || filters.location ? `Việc làm ${filters.search || filters.location}` : 'Tìm kiếm việc làm')
  const [frequency, setFrequency] = useState('DAILY')
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    try {
      const selectedNames = (filters.skill || '').split(',').map((item) => item.trim().toLocaleLowerCase()).filter(Boolean)
      const availableSkills = selectedNames.length ? await candidateApi.skills() : []
      await candidateApi.createAlert({
        name,
        keyword: filters.search || null,
        location: filters.location || null,
        employmentType: filters.employmentType || null,
        minSalary: filters.minSalary ? Number(filters.minSalary) : null,
        skillIds: availableSkills.filter((skill) => selectedNames.includes(skill.name.toLocaleLowerCase())).map((skill) => skill.id),
        frequency,
        isActive: true
      })
      onCreated()
    } catch (requestError) { setError(requestError.message) }
  }
  return <Modal open title="Tạo thông báo cho tìm kiếm này" onClose={onClose}><form className="alert-form" onSubmit={submit}>{error && <p className="board-message error">{error}</p>}<label>Tên thông báo<input required value={name} onChange={(event) => setName(event.target.value)} maxLength="150" /></label><label>Tần suất<select value={frequency} onChange={(event) => setFrequency(event.target.value)}><option value="INSTANT">Ngay lập tức</option><option value="DAILY">Hàng ngày</option><option value="WEEKLY">Hàng tuần</option></select></label><p className="alert-filter-summary">Bộ lọc: {filters.search || 'mọi từ khóa'} · {filters.location || 'mọi địa điểm'} · {filters.employmentType || 'mọi hình thức'}{filters.minSalary ? ` · từ ${filters.minSalary}` : ''}{filters.skill ? ` · kỹ năng ${filters.skill}` : ''}</p><div className="alert-form-actions"><button type="button" className="ghost-button" onClick={onClose}>Hủy</button><button className="primary-button">Tạo thông báo</button></div></form></Modal>
}

function MatchPanel({ job, session, returnTo }) {
  const [match, setMatch] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(null)
  const [added, setAdded] = useState(new Set())
  const [analysis, setAnalysis] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)

  useEffect(() => {
    if (session?.user?.role !== 'CANDIDATE') return
    setMatch(null)
    setError('')
    jobsApi.match(job.id).then(setMatch).catch((requestError) => setError(requestError.message))
  }, [job.id, session])

  async function addSkill(skill) {
    if (!skill.id) return
    setAdding(skill.id)
    try {
      const profile = await candidateApi.profile()
      const skillIds = (profile.skills || []).map((item) => item.skillId)
      await candidateApi.updateSkills([...new Set([...skillIds, skill.id])])
      setMatch(await jobsApi.match(job.id))
      setAdded((current) => new Set([...current, skill.id]))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setAdding(null)
    }
  }

  async function analyzeResume() {
    setAnalysisLoading(true)
    setError('')
    try {
      setAnalysis(await candidateApi.analyzeResumeForJob(job.id))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setAnalysisLoading(false)
    }
  }

  if (!session) return <section className="match-panel match-panel-login"><h2>Bạn phù hợp thế nào?</h2><p>Đăng nhập để xem mức độ phù hợp của hồ sơ với công việc này.</p><LoginAction returnTo={returnTo}>Đăng nhập để xem</LoginAction></section>
  if (session.user.role !== 'CANDIDATE') return null
  if (error) return <section className="match-panel"><h2>Bạn phù hợp thế nào?</h2><p className="board-message error">{error}</p></section>
  if (!match) return <section className="match-panel"><h2>Bạn phù hợp thế nào?</h2><Skeleton height={24} /><Skeleton height={16} /></section>

  const components = [
    ['Kỹ năng', match.skillScore],
    ['Kinh nghiệm', match.experienceScore],
    ['Vị trí', match.positionScore],
    ['Địa điểm', match.locationScore],
    ['Mức lương', match.salaryScore],
    ['Hình thức', match.employmentScore]
  ]
  return <section className="match-panel"><div className="match-panel-heading"><h2>Bạn phù hợp thế nào?</h2><div className="match-score-circle"><strong>{Math.round(match.score)}</strong><span>%</span></div></div><p className="match-explanation">{match.explanation}</p><div className="match-components">{components.map(([label, value]) => <div className="match-component" key={label}><div><span>{label}</span><strong>{Math.round(value)}%</strong></div><progress value={value} max="100" /></div>)}</div><div className="match-skills"><div><h3>Kỹ năng khớp</h3><div className="skill-chips match-skill-chips">{match.matchedSkills.length ? match.matchedSkills.map((skill) => <span className="match-skill matched" key={skill.id || skill.name}>{skill.name}</span>) : <small>Chưa có kỹ năng khớp.</small>}</div></div><div><h3>Kỹ năng còn thiếu</h3><div className="skill-chips match-skill-chips">{match.missingSkills.length ? match.missingSkills.map((skill) => <span className="match-skill missing" key={skill.id || skill.name}>{skill.name}<button type="button" onClick={() => addSkill(skill)} disabled={adding === skill.id || added.has(skill.id)}>{added.has(skill.id) ? 'Đã thêm' : adding === skill.id ? 'Đang thêm...' : 'Thêm vào hồ sơ'}</button></span>) : <small>Không thiếu kỹ năng bắt buộc.</small>}</div></div></div><button type="button" className="secondary-button" onClick={analyzeResume} disabled={analysisLoading}>{analysisLoading ? 'Đang phân tích CV...' : 'Phân tích CV của tôi cho việc này'}</button>{analysis && <div className="resume-analysis"><p className="profile-hint">{analysis.disclaimer}</p><h3>Gợi ý từ CV · {Math.round(analysis.fitScore)}%</h3><p><strong>Từ khóa còn thiếu:</strong> {analysis.missingKeywords.length ? analysis.missingKeywords.join(', ') : 'Không có'}</p><div><strong>Điểm mạnh</strong><ul>{analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div><div><strong>Gợi ý sửa cụ thể</strong><ul>{analysis.suggestions.map((item) => <li key={item}>{item}</li>)}</ul></div></div>}</section>
}

function JobCard({ job, active, saved, applied, onOpen, onSave }) {
  return <article className={`public-job-card ${active ? 'active' : ''}`} onClick={() => onOpen(job.id)} tabIndex="0" onKeyDown={(event) => event.key === 'Enter' && onOpen(job.id)}>
    {logoUrl(job.company) ? <img className="public-company-logo" src={logoUrl(job.company)} alt="" /> : <div className="public-company-logo">{job.company?.name?.charAt(0) || 'J'}</div>}
    <div className="public-job-card-body"><div className="public-job-card-top"><span className="job-age">{relativeDate(job.createdAt)}</span>{saved && <Badge tone="primary">Đã lưu</Badge>}{applied && <Badge tone="success">Đã ứng tuyển</Badge>}</div><h2>{job.title}</h2><Link className="public-company-link" to={`/companies/${job.company?.id}`} onClick={(event) => event.stopPropagation()}>{job.company?.name || 'Nhà tuyển dụng'}</Link><p>{job.location || 'Toàn quốc'} · {job.employmentType || 'Toàn thời gian'}</p><strong>{formatSalary(job)}</strong><small>{job.applicantCount ?? 0} ứng viên</small></div>
    <button className={`public-save-button ${saved ? 'saved' : ''}`} aria-label={saved ? 'Bỏ lưu' : 'Lưu việc làm'} onClick={(event) => { event.stopPropagation(); onSave(job) }}>☆</button>
  </article>
}

function ApplyWizard({ job, resumes, setResumes, onSubmit, onClose }) {
  const [step, setStep] = useState(1)
  const [resumeId, setResumeId] = useState(String(resumes.find((resume) => resume.isDefault)?.id || ''))
  const [coverLetter, setCoverLetter] = useState('')
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [loadingQuestions, setLoadingQuestions] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    jobsApi.screeningQuestions(job.id).then(setQuestions).catch((requestError) => setError(requestError.message)).finally(() => setLoadingQuestions(false))
  }, [job.id])

  async function uploadResume(event) {
    const file = event.target.files[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      await candidateApi.uploadResume(file, false)
      const profile = await candidateApi.profile()
      setResumes(profile.resumes || [])
      const uploaded = profile.resumes?.find((resume) => resume.fileName === file.name)
      if (uploaded) setResumeId(String(uploaded.id))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setUploading(false)
    }
  }

  function next() {
    if (step === 1 && !resumeId) return setError('Vui lòng chọn CV để ứng tuyển.')
    if (step === 3 && questions.some((question) => question.isRequired && !String(answers[question.id] || '').trim())) return setError('Vui lòng trả lời đủ các câu hỏi bắt buộc.')
    setError('')
    setStep((current) => current + 1)
  }

  function answerControl(question) {
    const value = answers[question.id] || ''
    const onChange = (event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
    if (question.type === 'YES_NO') return <select value={value} onChange={onChange}><option value="">Chọn câu trả lời</option><option value="true">Có</option><option value="false">Không</option></select>
    if (question.type === 'SINGLE_CHOICE') return <select value={value} onChange={onChange}><option value="">Chọn câu trả lời</option>{(question.options || []).map((option) => <option value={option} key={option}>{option}</option>)}</select>
    return <input type={question.type === 'NUMBER' ? 'number' : 'text'} value={value} onChange={onChange} />
  }

  return <Modal open title="Ứng tuyển nhanh" onClose={onClose}><div className="apply-wizard"><div className="apply-steps"><strong className={step === 1 ? 'active' : ''}>1. CV</strong><strong className={step === 2 ? 'active' : ''}>2. Thư giới thiệu</strong>{questions.length > 0 && <strong className={step === 3 ? 'active' : ''}>3. Câu hỏi</strong>}<strong className={step === (questions.length > 0 ? 4 : 3) ? 'active' : ''}>Xem lại</strong></div>{error && <p className="board-message error">{error}</p>}{step === 1 && <div className="apply-step"><h3>Chọn CV</h3><select value={resumeId} onChange={(event) => setResumeId(event.target.value)}><option value="">Chọn CV</option>{resumes.map((resume) => <option value={resume.id} key={resume.id}>{resume.fileName}{resume.isDefault ? ' (mặc định)' : ''}</option>)}</select><label className="upload-box">Tải CV mới<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={uploadResume} disabled={uploading} /></label>{uploading && <small>Đang tải CV...</small>}</div>}{step === 2 && <div className="apply-step"><h3>Thư giới thiệu <small>(tùy chọn)</small></h3><textarea value={coverLetter} onChange={(event) => setCoverLetter(event.target.value)} maxLength="5000" placeholder="Giới thiệu ngắn về bạn..." /></div>}{step === 3 && <div className="apply-step"><h3>Câu hỏi sàng lọc</h3>{loadingQuestions ? <Skeleton height={80} /> : questions.map((question) => <label key={question.id}>{question.question}{question.isRequired && ' *'}{answerControl(question)}</label>)}</div>}{step === (questions.length > 0 ? 4 : 3) && <div className="apply-step"><h3>Xem lại hồ sơ</h3><p><strong>CV:</strong> {resumes.find((resume) => String(resume.id) === resumeId)?.fileName}</p><p><strong>Thư giới thiệu:</strong> {coverLetter || 'Không có'}</p>{questions.length > 0 && <p><strong>Câu hỏi:</strong> {Object.keys(answers).length}/{questions.length} câu đã trả lời</p>}</div>}<div className="apply-wizard-actions">{step > 1 && <button type="button" className="ghost-button" onClick={() => setStep((current) => current - 1)}>Quay lại</button>}{step < (questions.length > 0 ? 4 : 3) ? <button type="button" className="primary-button" onClick={next}>Tiếp tục</button> : <button type="button" className="primary-button" onClick={() => onSubmit({ resumeId: Number(resumeId), coverLetter, answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId: Number(questionId), answer })) })}>Gửi hồ sơ</button>}</div></div></Modal>
}

function JobDetail({ job, session, saved, onSave, onApply, returnTo, resumes, setResumes }) {
  const [applyOpen, setApplyOpen] = useState(false)
  if (!job) return <div className="public-detail-loading"><Skeleton height={28} width="70%" /><Skeleton height={18} /><Skeleton height={180} /></div>
  function startApply() {
    if (!session) return onApply(job)
    setApplyOpen(true)
  }
  return <article className="public-job-detail"><div className="public-detail-heading">{logoUrl(job.company) ? <img className="public-company-logo large" src={logoUrl(job.company)} alt="" /> : <div className="public-company-logo large">{job.company?.name?.charAt(0) || 'J'}</div>}<div><span className="job-age">{relativeDate(job.createdAt)}</span><h1>{job.title}</h1><Link className="public-company-link" to={`/companies/${job.company?.id}`}>{job.company?.name}</Link></div></div><div className="public-detail-actions"><button className={`public-save-button ${saved ? 'saved' : ''}`} onClick={() => onSave(job)}>{saved ? '★ Đã lưu' : '☆ Lưu'}</button>{session ? <button className="primary-button" onClick={startApply}>Ứng tuyển</button> : <LoginAction returnTo={returnTo}>Đăng nhập để ứng tuyển</LoginAction>}</div><div className="public-detail-facts"><span>⌖ {job.location || 'Toàn quốc'}</span><span>◷ {job.employmentType || 'Toàn thời gian'}</span><span>₫ {formatSalary(job)}</span><span>👥 {job.applicantCount ?? 0} ứng viên</span></div><MatchPanel job={job} session={session} returnTo={returnTo} /><div className="public-detail-copy"><h2>Mô tả công việc</h2><p>{job.description}</p><h2>Kỹ năng yêu cầu</h2><div className="skill-chips">{job.skills?.map((item) => <span key={item.skillId}>{item.skill.name}</span>)}</div>{job.requiredYearsExperience !== null && job.requiredYearsExperience !== undefined && <><h2>Kinh nghiệm</h2><p>Tối thiểu {job.requiredYearsExperience} năm kinh nghiệm.</p></>}{session && applyOpen && <ApplyWizard job={job} resumes={resumes} setResumes={setResumes} onSubmit={(payload) => onApply(job, payload).then(() => setApplyOpen(false))} onClose={() => setApplyOpen(false)} />}</div></article>
}

export default function JobBoardPage() {
  const { session, logout } = useAuth()
  const location = useLocation()
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters] = useState(() => ({ ...initialFilters, ...Object.fromEntries(searchParams.entries()) }))
  const [jobs, setJobs] = useState([])
  const [pagination, setPagination] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [savedIds, setSavedIds] = useState(new Set())
  const [appliedIds, setAppliedIds] = useState(new Set())
  const [status, setStatus] = useState({ loading: true, error: '' })
  const [notifications, setNotifications] = useState(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [resumes, setResumes] = useState([])
  const [alertOpen, setAlertOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const jobsRequestRef = useRef(0)
  const jobDetailRequestRef = useRef(0)

  const returnTo = `${location.pathname}${location.search}`
  const queryFilters = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), [filters])
  const appliedQuery = searchParams.toString()
  const loadJobs = useCallback(async () => {
    const requestId = ++jobsRequestRef.current
    setStatus({ loading: true, error: '' })
    try {
      const data = await jobsApi.list(Object.fromEntries(new URLSearchParams(appliedQuery)))
      if (requestId !== jobsRequestRef.current) return
      setJobs(data.items)
      setPagination(data.pagination)
    } catch (error) {
      if (requestId === jobsRequestRef.current) setStatus({ loading: false, error: error.message })
      return
    }
    if (requestId !== jobsRequestRef.current) return
    setStatus({ loading: false, error: '' })
  }, [appliedQuery])
  useEffect(() => { loadJobs() }, [loadJobs])
  useEffect(() => {
    if (!session) return
    if (session.user.role === 'CANDIDATE') {
      candidateApi.savedJobs().then((items) => setSavedIds(new Set(items.map((item) => item.jobId)))).catch(() => {})
      notificationsApi.list({ limit: 50 }).then(setNotifications).catch(() => {})
      Promise.all([candidateApi.profile(), applicationsApi.list()]).then(([profile, applications]) => {
        setResumes(profile.resumes || [])
        setAppliedIds(new Set(applications.map((item) => item.jobId)))
      }).catch(() => {})
    }
  }, [session])
  useEffect(() => {
    const requestId = ++jobDetailRequestRef.current
    if (!id) { setSelectedJob(null); return }
    jobsApi.get(id).then((job) => {
      if (requestId === jobDetailRequestRef.current) setSelectedJob(job)
    }).catch((error) => {
      if (requestId === jobDetailRequestRef.current) setStatus({ loading: false, error: error.message })
    })
  }, [id])
  function applyFilters(event) { event.preventDefault(); const next = { ...filters, page: '1' }; setFilters(next); setSearchParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))); setFiltersOpen(false) }
  function clearFilters() { setFilters(initialFilters); setSearchParams({}); setFiltersOpen(false) }
  function updateFilter(name, value) { setFilters((current) => ({ ...current, [name]: value })) }
  async function saveJob(job) {
    if (!session) return
    if (session.user.role !== 'CANDIDATE') return
    try { if (savedIds.has(job.id)) { await candidateApi.unsaveJob(job.id); setSavedIds((current) => new Set([...current].filter((value) => value !== job.id))) } else { await candidateApi.saveJob(job.id); setSavedIds((current) => new Set([...current, job.id])) } } catch (error) { setStatus((current) => ({ ...current, error: error.message })) }
  }
  function handleSave(job) { if (!session) { navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`); return } saveJob(job) }
  function openJob(jobId) { navigate(`/jobs/${jobId}${searchParams.toString() ? `?${searchParams}` : ''}`) }
  async function handleApply(job, payload = {}) {
    if (!session) { navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`); return }
    if (!payload.resumeId) { setStatus((current) => ({ ...current, error: 'Vui lòng chọn CV trước khi ứng tuyển.' })); return Promise.reject(new Error('Vui lòng chọn CV trước khi ứng tuyển.')) }
    try { await jobsApi.apply(job.id, payload.coverLetter, Number(payload.resumeId), payload.answers); setAppliedIds((current) => new Set([...current, job.id])); setStatus({ loading: false, error: '' }) } catch (error) { setStatus((current) => ({ ...current, error: error.message })); throw error }
  }
  const unread = notifications?.items?.filter((item) => !item.isRead).length || 0

  return <AppShell user={session?.user} logout={logout} unread={unread} notifications={notifications} notificationsOpen={notificationsOpen} onNotifications={() => setNotificationsOpen((value) => !value)} onReadAll={async () => { await notificationsApi.markAllRead(); setNotifications((current) => current && { ...current, items: current.items.map((item) => ({ ...item, isRead: true })) }) }} onRead={async (item) => { if (!item.isRead) { await notificationsApi.markRead(item.id); setNotifications((current) => ({ ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, isRead: true } : entry) })) } }}>
    <button type="button" className="public-filter-toggle" aria-label="Mở bộ lọc việc làm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}>☷ Bộ lọc</button>
    {filtersOpen && <><button type="button" className="public-filter-overlay" aria-label="Đóng bộ lọc việc làm" onClick={() => setFiltersOpen(false)} /><button type="button" className="public-filter-close" aria-label="Đóng bộ lọc việc làm" onClick={() => setFiltersOpen(false)}>×</button></>}
    {id && <button type="button" className="public-detail-back" onClick={() => navigate(`/jobs${searchParams.toString() ? `?${searchParams}` : ''}`)}>← Danh sách việc làm</button>}
    <main className="public-jobs-page"><section className="public-jobs-hero"><p className="eyebrow">CƠ HỘI TIẾP THEO CỦA BẠN</p><h1>Tìm công việc phù hợp hơn.</h1><p>Khám phá hàng nghìn cơ hội việc làm đang tuyển dụng.</p></section><form className="public-filter-bar" onSubmit={applyFilters}><label>⌕<input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Chức danh, kỹ năng..." /></label><label>⌖<input value={filters.location} onChange={(event) => updateFilter('location', event.target.value)} placeholder="Địa điểm" /></label><select value={filters.postedWithin} onChange={(event) => updateFilter('postedWithin', event.target.value)}>{postedOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select value={filters.employmentType} onChange={(event) => updateFilter('employmentType', event.target.value)}>{employmentTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><input type="number" min="0" value={filters.minSalary} onChange={(event) => updateFilter('minSalary', event.target.value)} placeholder="Lương từ" /><input type="number" min="0" value={filters.maxApplicants} onChange={(event) => updateFilter('maxApplicants', event.target.value)} placeholder="Ít hơn số ứng viên" /><button className="primary-button">Lọc</button>{session?.user?.role === 'CANDIDATE' && <button type="button" className="ghost-button" onClick={() => setAlertOpen(true)}>Tạo thông báo cho tìm kiếm này</button>}{Object.values(queryFilters).length > 1 && <button type="button" className="ghost-button" onClick={clearFilters}>Xóa lọc</button>}</form>{status.error && <div className="board-message error">{status.error}</div>}<section className="public-jobs-layout"><div className={`public-job-list ${id ? 'has-detail' : ''}`}><div className="public-list-heading"><div><p className="eyebrow">VIỆC LÀM ĐANG TUYỂN</p><h2>{pagination?.total || 0} việc làm</h2></div><select value={filters.sort} onChange={(event) => { const next = { ...filters, sort: event.target.value, page: '1' }; setFilters(next); setSearchParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))) }}><option value="newest">Mới nhất</option><option value="salary_high">Lương cao nhất</option><option value="salary_low">Lương thấp nhất</option></select></div>{status.loading ? [1, 2, 3].map((item) => <Skeleton key={item} height={130} />) : jobs.length ? jobs.map((job) => <JobCard key={job.id} job={job} active={String(job.id) === id} saved={savedIds.has(job.id)} applied={appliedIds.has(job.id)} onOpen={openJob} onSave={handleSave} />) : <EmptyState title="Chưa tìm thấy việc làm" description="Thử thay đổi từ khóa hoặc bộ lọc." />}{pagination?.totalPages > 1 && <div className="pagination">{Array.from({ length: pagination.totalPages }, (_, index) => index + 1).map((page) => <button className={Number(filters.page || 1) === page ? 'active' : ''} key={page} onClick={() => { const next = { ...filters, page: String(page) }; setFilters(next); setSearchParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value))) }}>{page}</button>)}</div>}</div><div className="public-job-detail-column">{selectedJob ? <JobDetail job={selectedJob} session={session} saved={savedIds.has(selectedJob.id)} onSave={handleSave} onApply={handleApply} returnTo={returnTo} resumes={resumes} setResumes={setResumes} /> : <EmptyState title="Chọn một việc làm" description="Chi tiết việc làm sẽ hiển thị tại đây." />}</div></section></main>
    {alertOpen && <SearchAlertModal filters={filters} onClose={() => setAlertOpen(false)} onCreated={() => setAlertOpen(false)} />}
  </AppShell>
}

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { applicationsApi, candidateApi } from '../services/api'
import { useAuth } from '../context/auth'
import AppShell from '../components/AppShell'
import { EmptyState, Tabs } from '../components/ui'
import { terminalApplicationStatuses } from '../utils/applicationStatus'
import './my-jobs.css'

const statusLabels = new Proxy({ APPLIED: 'Đã nộp', REVIEWING: 'Đang xem xét', SHORTLISTED: 'Vào vòng trong', INTERVIEWING: 'Phỏng vấn', OFFERED: 'Đã đề nghị', ACCEPTED: 'Đã nhận', REJECTED: 'Từ chối', WITHDRAWN: 'Đã rút' }, { get: (labels, status) => labels[status] || 'Trạng thái khác' })
const closedStatuses = terminalApplicationStatuses
const employmentLabels = { FULL_TIME: 'Toàn thời gian', PART_TIME: 'Bán thời gian', INTERNSHIP: 'Thực tập', CONTRACT: 'Hợp đồng', REMOTE: 'Từ xa', HYBRID: 'Kết hợp' }

function JobSummary({ job }) {
  return <div className="my-job-summary"><div className="company-logo">{job.company?.name?.charAt(0) || 'J'}</div><div><h2>{job.title}</h2><p>{job.company?.name} · {job.location || 'Toàn quốc'}</p><small>{employmentLabels[job.employmentType] || 'Hình thức linh hoạt'}</small></div></div>
}

function EmptyJobs({ tab }) {
  return <EmptyState title={tab === 'saved' ? 'Bạn chưa lưu việc làm nào' : 'Bạn chưa có đơn ứng tuyển'} description={tab === 'saved' ? 'Lưu những việc phù hợp để xem lại và ứng tuyển sau.' : 'Khám phá việc làm đang tuyển và gửi hồ sơ nhanh chóng.'} action={<Link className="primary-button" to="/jobs">Tìm việc làm</Link>} />
}

export default function MyJobsPage() {
  const { session, logout } = useAuth()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') === 'applied' ? 'applied' : 'saved')
  const [saved, setSaved] = useState([])
  const [applications, setApplications] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    Promise.all([candidateApi.savedJobs(), applicationsApi.list()])
      .then(([savedItems, applicationItems]) => { setSaved(savedItems); setApplications(applicationItems) })
      .catch((requestError) => setError(requestError.message))
  }, [])

  async function removeSaved(jobId) {
    try { await candidateApi.unsaveJob(jobId); setSaved((current) => current.filter((item) => item.jobId !== jobId)) } catch (requestError) { setError(requestError.message) }
  }

  async function withdraw(application) {
    if (!window.confirm('Bạn muốn rút đơn ứng tuyển này?')) return
    try {
      const updated = await applicationsApi.withdraw(application.id, application.status)
      setApplications((current) => current.map((item) => item.id === application.id ? { ...item, ...updated, history: [...(item.history || []), ...(updated.history || []), ...(updated.history?.length ? [] : [{ id: `withdrawn-${updated.id}`, toStatus: 'WITHDRAWN', createdAt: new Date().toISOString() }])] } : item))
      setMessage('Đã rút đơn ứng tuyển.')
    } catch (requestError) {
      if (requestError.status === 409) {
        setApplications(await applicationsApi.list())
        setError('Trạng thái đơn ứng tuyển đã thay đổi. Dữ liệu mới nhất đã được tải lại.')
      } else setError(requestError.message)
    }
  }

  return <AppShell user={session.user} logout={logout}><main className="candidate-page my-jobs-page"><header className="simple-page-header"><div><Link to="/jobs">← Tìm việc</Link><p className="eyebrow">ỨNG VIÊN</p><h1>Việc của tôi</h1><p>Quản lý các tin đã lưu và hồ sơ đã gửi.</p></div></header>{error && <div className="board-message error">{error}</div>}{message && <div className="board-message">{message}</div>}<Tabs value={tab} onChange={setTab} label="Việc của tôi" items={[{ value: 'saved', label: `Đã lưu (${saved.length})` }, { value: 'applied', label: `Đã ứng tuyển (${applications.length})` }]} />{tab === 'saved' ? <section className="my-jobs-list">{saved.length ? saved.map(({ job }) => <article className="my-job-card saved-job-card" key={job.id}><JobSummary job={job} /><div className="my-job-actions"><Link className="primary-button" to={`/jobs/${job.id}`}>Ứng tuyển</Link><button className="danger-link" onClick={() => removeSaved(job.id)}>Bỏ lưu</button></div></article>) : <EmptyJobs tab="saved" />}</section> : <section className="my-jobs-list">{applications.length ? applications.map((application) => <article className="my-job-card application-job-card" key={application.id}><div className="application-card-heading"><JobSummary job={application.job} /><span className={`status-pill ${application.status.toLowerCase()}`}>{statusLabels[application.status] || application.status}</span></div><small>Nộp ngày {new Date(application.appliedAt).toLocaleDateString('vi-VN')}</small><div className="application-timeline">{(application.history || []).map((event) => <div className="timeline-item" key={event.id}><i /><div><strong>{statusLabels[event.toStatus] || event.toStatus}</strong><small>{new Date(event.createdAt).toLocaleString('vi-VN')}</small>{event.note && <p>{event.note}</p>}</div></div>)}</div>{!closedStatuses.includes(application.status) && <button className="danger-link" onClick={() => withdraw(application)}>Rút hồ sơ</button>}</article>) : <EmptyJobs tab="applied" />}</section>}</main></AppShell>
}

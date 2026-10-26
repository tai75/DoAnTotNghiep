import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { candidateApi } from '../services/api'

export default function SavedJobsPage() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  useEffect(() => { candidateApi.savedJobs().then(setItems).catch((actionError) => setError(actionError.message)) }, [])
  async function remove(jobId) { try { await candidateApi.unsaveJob(jobId); setItems((current) => current.filter((item) => item.jobId !== jobId)) } catch (actionError) { setError(actionError.message) } }
  return <main className="candidate-page"><header className="simple-page-header"><div><Link to="/jobs">← Tìm việc</Link><p className="eyebrow">ỨNG VIÊN</p><h1>Tin đã lưu</h1></div></header>{error && <div className="board-message error">{error}</div>}<section className="saved-grid">{items.length ? items.map(({ job }) => <article className="saved-card" key={job.id}><div className="company-logo">{job.company?.name?.charAt(0) || 'J'}</div><div><h2>{job.title}</h2><p>{job.company?.name} · {job.location || 'Toàn quốc'}</p><span>{job.employmentType || 'Toàn thời gian'}</span></div><button onClick={() => remove(job.id)}>Bỏ lưu</button></article>) : <div className="board-empty">Bạn chưa lưu tin tuyển dụng nào.</div>}</section></main>
}

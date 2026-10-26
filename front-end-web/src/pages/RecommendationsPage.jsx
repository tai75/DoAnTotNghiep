import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { recommendationApi } from '../services/api'
import '../board.css'

function formatSalary(job) {
  if (!job.minSalary && !job.maxSalary) return 'Thỏa thuận'
  const format = (value) => `${Number(value).toLocaleString('vi-VN')} đ`
  return job.minSalary && job.maxSalary ? `${format(job.minSalary)} - ${format(job.maxSalary)}` : format(job.minSalary || job.maxSalary)
}

export default function RecommendationsPage() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  useEffect(() => { recommendationApi.jobs().then(setItems).catch((actionError) => setError(actionError.message)) }, [])
  return <main className="recommendation-shell"><header className="recommendation-header"><Link to="/jobs">← Tìm việc</Link><h1>Việc làm dành cho bạn</h1><p>Gợi ý dựa trên hồ sơ, kỹ năng và mong muốn của bạn.</p></header>{error && <p className="recommendation-error">{error}</p>}<section className="recommendation-grid">{items.map((item) => <article className="recommendation-card" key={item.id}><div className="recommendation-score">{item.match.score}<small>/100</small></div><h2>{item.title}</h2><p>{item.company?.name} · {item.location || 'Địa điểm linh hoạt'}</p><strong>{formatSalary(item)}</strong><p className="recommendation-reason">{item.match.explanation}</p><div className="recommendation-skills">{item.match.matchedSkills.map((skill) => <span className="matched" key={`${item.id}-${skill.id || skill.name}`}>✓ {skill.name}</span>)}{item.match.missingSkills.map((skill) => <span className="missing" key={`${item.id}-missing-${skill.id || skill.name}`}>Cần bổ sung: {skill.name}</span>)}</div><Link className="primary-button" to={`/jobs?search=${encodeURIComponent(item.title)}`}>Xem việc làm</Link></article>)}</section></main>
}

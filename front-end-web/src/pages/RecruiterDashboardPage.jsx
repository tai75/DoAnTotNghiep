import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { recruiterApi } from '../services/api'
import { useAuth } from '../context/auth'
import AppShell from '../components/AppShell'
import {
  applicationStatusLabels,
  canRecruiterTransition,
  isTerminalApplicationStatus,
  recruiterStatusOptions
} from '../utils/applicationStatus'
import '../recruiter.css'

const jobStatuses = { DRAFT: 'Nháp', PENDING: 'Chờ duyệt', PUBLISHED: 'Đang đăng', CLOSED: 'Đã đóng', REJECTED: 'Bị từ chối' }
const applicationStatuses = applicationStatusLabels
const employmentLabels = { FULL_TIME: 'Toàn thời gian', PART_TIME: 'Bán thời gian', INTERNSHIP: 'Thực tập', CONTRACT: 'Hợp đồng', REMOTE: 'Từ xa', HYBRID: 'Kết hợp' }
const chartColors = ['#2563eb', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#64748b']
const ASSET_URL = (import.meta.env.VITE_ASSET_URL || '').replace(/\/$/, '')

const suggestedQuestions = [
  { type: 'NUMBER', question: 'Bạn có bao nhiêu năm kinh nghiệm liên quan?', idealAnswer: '' },
  { type: 'TEXT', question: 'Bạn đã hoàn thành bậc học nào?', idealAnswer: '' },
  { type: 'YES_NO', question: 'Bạn có thể bắt đầu làm việc trong thời gian sớm nhất không?', idealAnswer: 'true' },
  { type: 'TEXT', question: 'Bạn có sử dụng được ngoại ngữ cần thiết cho công việc không?', idealAnswer: '' }
]

function PipelineColumn({ status, applications, onOpen, onToggle }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return <div ref={setNodeRef} className={`pipeline-column ${isOver ? 'is-over' : ''}`}><h3>{applicationStatuses[status]} <span>{applications.length}</span></h3>{applications.map((application) => <PipelineCard key={application.id} application={application} onOpen={onOpen} onToggle={onToggle} />)}</div>
}

function PipelineCard({ application, onOpen, onToggle }) {
  const terminal = isTerminalApplicationStatus(application.status)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: String(application.id), disabled: terminal })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  const knockoutFailed = application.answers?.some(({ answer, question }) => question.isKnockout && question.idealAnswer && answer.toLowerCase() !== question.idealAnswer.toLowerCase())
  return <article ref={setNodeRef} style={style} className={`pipeline-card ${isDragging ? 'dragging' : ''}`} {...attributes} {...listeners} onClick={() => onOpen(application)}><div className="pipeline-card-head"><input type="checkbox" disabled={terminal} onClick={(event) => event.stopPropagation()} onChange={() => onToggle(application.id)} /><span className="pipeline-avatar">{application.candidate.user.fullName.charAt(0)}</span><strong>{application.candidate.user.fullName}</strong></div><div className="pipeline-card-meta"><span>Độ phù hợp: {Number(application.matchScore?.score || 0).toFixed(0)}/100</span><time>{new Date(application.appliedAt).toLocaleDateString('vi-VN')}</time></div>{knockoutFailed && <small className="knockout-warning">Không đạt câu hỏi loại ngay</small>}</article>
}

function ApplicationDrawer({ application, onClose, onNoteAdded, onNoteDeleted, onDownload, onStatusChange, onMessage }) {
  const [note, setNote] = useState('')
  if (!application) return null
  const knockoutAnswers = application.answers?.filter(({ question }) => question.isKnockout) || []
  return <aside className="pipeline-drawer"><button className="close-detail" onClick={onClose}>×</button><div className="pipeline-drawer-profile"><span className="pipeline-avatar large">{application.candidate.user.fullName.charAt(0)}</span><h2>{application.candidate.user.fullName}</h2><p>{application.candidate.headline || 'Chưa cập nhật tiêu đề hồ sơ'}</p><p>{application.candidate.user.phone || ''}</p></div><button className="secondary-button" onClick={onDownload}>Tải CV</button><button className="secondary-button" onClick={onMessage}>Nhắn tin ứng viên</button><h3>Hồ sơ</h3><p>{application.candidate.bio || 'Chưa có giới thiệu.'}</p><p>Kinh nghiệm: {application.candidate.yearsExperience ?? '—'} năm</p><div className="candidate-skills">{application.candidate.skills?.map(({ skill }) => <span key={skill.id}>{skill.name}</span>)}</div><h3>Câu trả lời sàng lọc</h3>{application.answers?.length ? application.answers.map(({ question, answer }) => <div className={question.isKnockout ? 'screening-answer knockout-answer' : 'screening-answer'} key={question.id}><strong>{question.question}</strong><span>{answer}</span></div>) : <p>Không có câu trả lời.</p>}{knockoutAnswers.some(({ answer, question }) => question.idealAnswer && answer.toLowerCase() !== question.idealAnswer.toLowerCase()) && <p className="knockout-warning">Ứng viên không đạt ít nhất một câu hỏi loại ngay.</p>}<h3>Lịch sử trạng thái</h3><div className="pipeline-timeline">{application.history?.map((entry) => <div key={entry.id}><b>{applicationStatuses[entry.toStatus] || 'Trạng thái khác'}</b><time>{new Date(entry.createdAt).toLocaleString('vi-VN')}</time>{entry.note && <span>{entry.note}</span>}</div>)}</div><h3>Ghi chú nội bộ</h3>{application.notes?.map((item) => <div className="internal-note" key={item.id}><p>{item.content}</p><small>{item.author.fullName} · {new Date(item.createdAt).toLocaleString('vi-VN')}</small><button onClick={() => onNoteDeleted(item.id)}>Xóa</button></div>)}<form onSubmit={(event) => { event.preventDefault(); if (note.trim()) onNoteAdded(note.trim()).then(() => setNote('')) }}><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Thêm ghi chú nội bộ..." /><button className="primary-button">Thêm ghi chú</button></form><label>Đổi trạng thái<select value={application.status} disabled={isTerminalApplicationStatus(application.status)} onChange={(event) => onStatusChange(application, event.target.value)}>{recruiterStatusOptions(application.status).map((status) => <option value={status} key={status}>{applicationStatuses[status] || 'Trạng thái khác'}</option>)}</select></label></aside>
}

function JobPipeline({ job, onError }) {
  const navigate = useNavigate()
  const [applications, setApplications] = useState([])
  const [selected, setSelected] = useState(null)
  const [minScore, setMinScore] = useState('')
  const [sort, setSort] = useState('score')
  const [selectedIds, setSelectedIds] = useState([])
  const statuses = Object.keys(applicationStatuses)
  const load = useCallback(async () => {
    try {
      const result = await recruiterApi.applications({ jobId: job.id, minScore: minScore || undefined, sort })
      setApplications(result.items || [])
    } catch (error) { onError(error.message) }
  }, [job.id, minScore, onError, sort])
  useEffect(() => { load() }, [load])
  async function changeStatus(application, status) {
    if (!canRecruiterTransition(application.status, status) || application.status === status) return
    const previous = applications
    setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status } : item))
    try {
      const updated = await recruiterApi.updateApplicationStatus(application.id, status, undefined, application.status)
      setApplications((current) => current.map((item) => item.id === application.id ? { ...item, ...updated } : item))
      setSelected((current) => current?.id === application.id ? { ...current, status, history: [...(current.history || []), { id: Date.now(), toStatus: status, createdAt: new Date().toISOString() }] } : current)
    } catch (error) {
      if (error.status === 409) {
        setSelected(null)
        await load()
        onError('Trạng thái đơn ứng tuyển đã thay đổi. Dữ liệu mới nhất đã được tải lại.')
      } else {
        setApplications(previous)
        onError(error.message)
      }
    }
  }
  async function addNote(content) {
    const created = await recruiterApi.addApplicationNote(selected.id, content)
    setSelected((current) => ({ ...current, notes: [...(current.notes || []), created] }))
    setApplications((current) => current.map((item) => item.id === selected.id ? { ...item, notes: [...(item.notes || []), created] } : item))
  }
  async function deleteNote(noteId) {
    await recruiterApi.deleteApplicationNote(selected.id, noteId)
    setSelected((current) => ({ ...current, notes: current.notes.filter((item) => item.id !== noteId) }))
  }
  async function bulkReject() {
    if (!selectedIds.length) return
    const message = window.prompt('Lời nhắn từ chối (tùy chọn):', 'Cảm ơn bạn đã quan tâm. Hiện tại chúng tôi chưa thể tiếp tục hồ sơ.') || undefined
    try {
      const selectedApplications = applications.filter((application) => selectedIds.includes(application.id))
      const result = await recruiterApi.bulkRejectApplications(selectedApplications, message)
      const changedIds = result.applicationIds || []
      setApplications((current) => current.map((item) => changedIds.includes(item.id) ? { ...item, status: 'REJECTED' } : item))
      setSelectedIds([])
    } catch (error) {
      if (error.status === 409) {
        await load()
        setSelectedIds([])
        onError('Một hoặc nhiều đơn đã thay đổi. Dữ liệu mới nhất đã được tải lại.')
      } else onError(error.message)
    }
  }
  const grouped = statuses.reduce((result, status) => { result[status] = applications.filter((application) => application.status === status); return result }, {})
  return <div className="pipeline-wrap"><div className="pipeline-toolbar"><label>Điểm match tối thiểu<input type="number" min="0" max="100" value={minScore} onChange={(event) => setMinScore(event.target.value)} /></label><label>Sắp xếp<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="score">Điểm cao nhất</option><option value="newest">Mới nhất</option></select></label><button className="danger-button" disabled={!selectedIds.length} onClick={bulkReject}>Từ chối đã chọn ({selectedIds.length})</button></div><DndContext onDragEnd={({ active, over }) => { if (!over || !statuses.includes(over.id)) return; const application = applications.find((item) => String(item.id) === String(active.id)); if (application && canRecruiterTransition(application.status, over.id) && application.status !== over.id) changeStatus(application, over.id) }}><div className="pipeline-board">{statuses.map((status) => <PipelineColumn key={status} status={status} applications={grouped[status]} onOpen={(application) => setSelected(application)} onToggle={(id) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} />)}</div></DndContext>{selected && <ApplicationDrawer application={selected} onClose={() => setSelected(null)} onNoteAdded={addNote} onNoteDeleted={deleteNote} onDownload={() => selected.resume && recruiterApi.downloadResume(selected.resume.id, selected.resume.fileName).catch((error) => onError(error.message))}   onStatusChange={changeStatus} onMessage={async () => { try { await recruiterApi.createConversation(selected.id); navigate('/messages') } catch (error) { onError(error.message) } }} />}</div>
}

function JobForm({ initialJob, skills, onSave, onAutoSave, onSubmitForReview, onCancel, onSuggest }) {
  const [step, setStep] = useState(1)
  const [formValues, setForm] = useState(() => ({
    title: initialJob?.title || '', description: initialJob?.description || '', location: initialJob?.location || '',
    employmentType: initialJob?.employmentType || '', minSalary: initialJob?.minSalary || '', maxSalary: initialJob?.maxSalary || '',
    requiredYearsExperience: initialJob?.requiredYearsExperience ?? '', deadline: initialJob?.deadline?.slice(0, 10) || '',
    skillIds: initialJob?.skills?.map(({ skill }) => skill.id) || [], requiredSkillIds: initialJob?.skills?.filter(({ isRequired }) => isRequired).map(({ skill }) => skill.id) || [], preferredSkillIds: initialJob?.skills?.filter(({ isRequired }) => !isRequired).map(({ skill }) => skill.id) || [], screeningQuestions: initialJob?.screeningQuestions || []
  }))
  const form = new Proxy(formValues, { get: (values, key) => key === 'employmentType' && step === 3 ? (employmentLabels[values[key]] || '') : values[key] })
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const selectedSkills = skills.filter((skill) => form.skillIds.includes(skill.id))
  const payload = useCallback((status = 'DRAFT') => {
    return { ...formValues, skillIds: [...new Set([...formValues.requiredSkillIds, ...formValues.preferredSkillIds])], requiredSkills: formValues.requiredSkillIds, status, employmentType: formValues.employmentType || undefined, minSalary: formValues.minSalary === '' ? undefined : Number(formValues.minSalary), maxSalary: formValues.maxSalary === '' ? undefined : Number(formValues.maxSalary), requiredYearsExperience: formValues.requiredYearsExperience === '' ? undefined : Number(formValues.requiredYearsExperience), deadline: formValues.deadline || undefined }
  }, [formValues])
  function next() {
    if (step === 1 && (!form.title || form.description.length < 20)) return
    setStep((current) => Math.min(3, current + 1))
  }
  function addQuestion(question = { type: 'TEXT', question: '', options: [], isRequired: false, isKnockout: false, idealAnswer: '' }) { change('screeningQuestions', [...form.screeningQuestions, question]) }
  function updateQuestion(index, key, value) { change('screeningQuestions', form.screeningQuestions.map((question, itemIndex) => itemIndex === index ? { ...question, [key]: value } : question)) }
  useEffect(() => {
    if (!form.title || form.description.length < 20) return undefined
    const timer = setTimeout(() => onAutoSave(payload('DRAFT')), 1200)
    return () => clearTimeout(timer)
  }, [form.description.length, form.title, onAutoSave, payload])
  return <div className="recruiter-form job-wizard"><div className="wizard-steps"><strong className={step === 1 ? 'active' : ''}>1. Cơ bản</strong><strong className={step === 2 ? 'active' : ''}>2. Kỹ năng & quyền lợi</strong><strong className={step === 3 ? 'active' : ''}>3. Câu hỏi & xem trước</strong></div>{step === 1 && <div className="wizard-panel"><div className="form-grid"><label>Chức danh<input required minLength="3" value={form.title} onChange={(event) => change('title', event.target.value)} /></label><label>Địa điểm<input value={form.location} onChange={(event) => change('location', event.target.value)} /></label><label>Hình thức<select value={form.employmentType} onChange={(event) => change('employmentType', event.target.value)}><option value="">Chọn hình thức</option>{Object.entries({ FULL_TIME: 'Toàn thời gian', PART_TIME: 'Bán thời gian', INTERNSHIP: 'Thực tập', CONTRACT: 'Hợp đồng', REMOTE: 'Từ xa', HYBRID: 'Kết hợp' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Hạn nhận hồ sơ<input required type="date" value={form.deadline} onChange={(event) => change('deadline', event.target.value)} /></label></div><label>Mô tả công việc<textarea required minLength="20" rows="8" value={form.description} onChange={(event) => change('description', event.target.value)} /></label><button type="button" className="secondary-button" onClick={() => onSuggest(form).then((description) => change('description', description))}>Gợi ý mô tả bằng AI</button></div>}{step === 2 && <div className="wizard-panel"><div className="form-grid"><label>Lương tối thiểu<input type="number" min="0" value={form.minSalary} onChange={(event) => change('minSalary', event.target.value)} /></label><label>Lương tối đa<input type="number" min="0" value={form.maxSalary} onChange={(event) => change('maxSalary', event.target.value)} /></label><label>Kinh nghiệm yêu cầu<input type="number" min="0" max="999.9" step="0.1" value={form.requiredYearsExperience} onChange={(event) => change('requiredYearsExperience', event.target.value)} /></label></div><fieldset><legend>Kỹ năng</legend><div className="skill-picker">{skills.map((skill) => <div key={skill.id}><span>{skill.name}</span><label><input type="checkbox" checked={form.requiredSkillIds.includes(skill.id)} onChange={(event) => change('requiredSkillIds', event.target.checked ? [...form.requiredSkillIds, skill.id] : form.requiredSkillIds.filter((id) => id !== skill.id))} /> Bắt buộc</label><label><input type="checkbox" checked={form.preferredSkillIds.includes(skill.id)} onChange={(event) => change('preferredSkillIds', event.target.checked ? [...form.preferredSkillIds, skill.id] : form.preferredSkillIds.filter((id) => id !== skill.id))} /> Ưu tiên</label></div>)}</div></fieldset></div>}{step === 3 && <div className="wizard-panel"><h3>Câu hỏi sàng lọc</h3><div className="suggested-question-list">{suggestedQuestions.map((question) => <button type="button" key={question.question} onClick={() => addQuestion({ ...question, options: [], isRequired: true, isKnockout: false })}>+ {question.question}</button>)}</div>{form.screeningQuestions.map((question, index) => <div className="question-editor" key={question.id || index}><input placeholder="Câu hỏi" value={question.question} onChange={(event) => updateQuestion(index, 'question', event.target.value)} /><select value={question.type} onChange={(event) => updateQuestion(index, 'type', event.target.value)}>{[['YES_NO', 'Có / Không'], ['NUMBER', 'Số'], ['TEXT', 'Văn bản'], ['SINGLE_CHOICE', 'Chọn một']].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{question.type === 'SINGLE_CHOICE' && <input placeholder="Các lựa chọn, cách nhau dấu phẩy" value={(question.options || []).join(', ')} onChange={(event) => updateQuestion(index, 'options', event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} />}<label><input type="checkbox" checked={question.isRequired} onChange={(event) => updateQuestion(index, 'isRequired', event.target.checked)} /> Bắt buộc</label><label><input type="checkbox" checked={question.isKnockout} onChange={() => updateQuestion(index, 'isKnockout', !question.isKnockout)} /> Loại ngay</label>{question.isKnockout && <input placeholder="Đáp án mong muốn" value={question.idealAnswer || ''} onChange={(event) => updateQuestion(index, 'idealAnswer', event.target.value)} />}<button type="button" className="danger-link" onClick={() => change('screeningQuestions', form.screeningQuestions.filter((_, itemIndex) => itemIndex !== index))}>Xóa</button></div>)}<button type="button" className="secondary-button" onClick={() => addQuestion()}>+ Thêm câu hỏi</button><div className="job-preview"><h3>Xem trước ứng viên</h3><h2>{form.title || 'Chức danh tuyển dụng'}</h2><p>{form.location || 'Địa điểm'} · {form.employmentType || 'Hình thức'}</p><p>{form.description || 'Mô tả công việc sẽ hiển thị tại đây.'}</p>{selectedSkills.length > 0 && <div className="candidate-skills">{selectedSkills.map((skill) => <span key={skill.id}>{skill.name}</span>)}</div>}{form.screeningQuestions.length > 0 && <><h4>Câu hỏi sàng lọc</h4>{form.screeningQuestions.map((question) => <p key={question.id || question.question}>{question.question}</p>)}</>}</div></div>}<div className="form-actions"><button type="button" className="secondary-button" onClick={onCancel}>Hủy</button>{step > 1 && <button type="button" className="secondary-button" onClick={() => setStep((current) => current - 1)}>Quay lại</button>}{step < 3 ? <button type="button" className="primary-button" onClick={next}>Tiếp tục</button> : <><button type="button" className="secondary-button" onClick={() => onSave(payload('DRAFT'))}>Lưu nháp</button><button type="button" className="primary-button" onClick={() => onSubmitForReview(payload('PENDING'))}>Gửi duyệt</button></>}</div></div>
}

function Dashboard({ stats }) {
  const statusData = Object.entries(stats.jobsByStatus || {}).map(([name, value]) => ({ name: jobStatuses[name] || name, value }))
  const applicationData = Object.entries(stats.applicationsByStatus || {}).map(([name, value]) => ({ name: applicationStatuses[name] || name, value }))
  return <><div className="recruiter-stat-grid"><article><span>Tổng tin tuyển dụng</span><strong>{Object.values(stats.jobsByStatus || {}).reduce((a, b) => a + b, 0)}</strong></article><article><span>Tổng đơn ứng tuyển</span><strong>{stats.applicationsTotal}</strong></article><article><span>Tin đang đăng</span><strong>{stats.jobsByStatus?.PUBLISHED || 0}</strong></article><article><span>Đang chờ duyệt</span><strong>{stats.jobsByStatus?.PENDING || 0}</strong></article></div>
    <div className="recruiter-chart-grid"><section className="recruiter-card"><h2>Đơn ứng tuyển theo thời gian</h2><ResponsiveContainer width="100%" height={280}><BarChart data={stats.timeline}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="Đơn" fill="#2563eb" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></section><section className="recruiter-card"><h2>Tỉ lệ đơn theo trạng thái</h2><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={applicationData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>{applicationData.map((item, index) => <Cell key={item.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="chart-legend">{applicationData.map((item, index) => <span key={item.name}><i style={{ background: chartColors[index % chartColors.length] }} />{item.name}: {item.value}</span>)}</div></section></div>
    <section className="recruiter-card"><h2>Đơn theo từng tin</h2><ResponsiveContainer width="100%" height={260}><BarChart data={stats.applicationsByJob} layout="vertical" margin={{ left: 20, right: 20 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="title" width={150} tick={{ fontSize: 12 }} /><Tooltip /><Bar dataKey="count" name="Đơn" fill="#8b5cf6" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></section><section className="recruiter-card"><h2>Phân bổ tin theo trạng thái</h2><div className="status-summary">{statusData.map((item) => <div key={item.name}><strong>{item.value}</strong><span>{item.name}</span></div>)}</div></section></>
}

function SuggestedCandidates({ result, onClose, onSearch }) {
  const [filters, setFilters] = useState({ requiredSkillIds: '', minExperience: '', location: '' })
  if (!result) return null
  return <div className="candidate-detail"><button className="close-detail" onClick={onClose}>×</button><h2>Gợi ý ứng viên · {result.job.title}</h2><form className="suggestion-filters" onSubmit={(event) => { event.preventDefault(); onSearch(result.job.id, filters) }}><input placeholder="ID kỹ năng bắt buộc, cách nhau dấu phẩy" value={filters.requiredSkillIds} onChange={(event) => setFilters({ ...filters, requiredSkillIds: event.target.value })} /><input type="number" min="0" placeholder="Kinh nghiệm tối thiểu" value={filters.minExperience} onChange={(event) => setFilters({ ...filters, minExperience: event.target.value })} /><input placeholder="Địa điểm" value={filters.location} onChange={(event) => setFilters({ ...filters, location: event.target.value })} /><button className="secondary-button">Áp dụng</button></form>{result.items.length ? result.items.map((item) => <div className="suggestion-row" key={item.candidateId}><strong>{item.fullName}</strong><span>{item.match.score}/100 · {item.yearsExperience ?? '—'} năm kinh nghiệm</span><small>{item.match.explanation}</small>{item.contact && <small>{item.contact.email} · {item.contact.phone || 'Chưa có số điện thoại'}</small>}<div className="candidate-skills">{item.match.matchedSkills.map((skill) => <span key={skill.id || skill.name}>{skill.name}</span>)}</div></div>) : <p>Chưa có ứng viên phù hợp.</p>}</div>
}

export default function RecruiterDashboardPage() {
  const { session, logout } = useAuth()
  const [searchParams] = useSearchParams()
  const requestedSection = searchParams.get('section')
  const [section, setSection] = useState(() => ['dashboard', 'jobs', 'applications', 'company'].includes(requestedSection) ? requestedSection : 'dashboard')
  const [stats, setStats] = useState(null)
  const [company, setCompany] = useState(null)
  const [jobs, setJobs] = useState([])
  const [skills, setSkills] = useState([])
  const [applications, setApplications] = useState([])
  const [editingJob, setEditingJob] = useState(null)
  const [applicationStatus, setApplicationStatus] = useState('')
  const [selectedApplication, setSelectedApplication] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [suggestedCandidates, setSuggestedCandidates] = useState(null)
  const [pipelineJob, setPipelineJob] = useState(null)

  useEffect(() => {
    const statusSelect = document.querySelector('#application-status')
    if (!statusSelect || !selectedApplication) return
    const terminal = isTerminalApplicationStatus(selectedApplication.status)
    statusSelect.disabled = terminal
    const saveButton = statusSelect.parentElement?.querySelector('button')
    if (saveButton) saveButton.disabled = terminal
  }, [selectedApplication])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const nextCompany = await recruiterApi.company()
      const [nextJobs, nextSkills] = await Promise.all([recruiterApi.jobs(), recruiterApi.skills()])
      const nextStats = nextCompany.verificationStatus === 'VERIFIED' ? await recruiterApi.stats() : { jobsByStatus: {}, applicationsTotal: 0, applicationsByStatus: {}, applicationsByJob: [], timeline: [] }
      setStats(nextStats); setCompany(nextCompany); setJobs(nextJobs); setSkills(nextSkills); setError('')
    } catch (actionError) { setError(actionError.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  const loadApplications = useCallback(async () => {
    try {
      const result = await recruiterApi.applications({ status: applicationStatus })
      setApplications(result.items || [])
    } catch (actionError) {
      setError(actionError.message)
    }
  }, [applicationStatus])
  useEffect(() => {
    if (section !== 'applications') return
    recruiterApi.applications({ status: applicationStatus }).then((result) => setApplications(result.items || [])).catch((actionError) => setError(actionError.message))
  }, [section, applicationStatus])
  useEffect(() => {
    const applicationId = Number(searchParams.get('applicationId'))
    if (section === 'applications' && applicationId && applications.length) {
      setSelectedApplication(applications.find((application) => application.id === applicationId) || null)
    }
  }, [applications, searchParams, section])
  useEffect(() => {
    const jobId = Number(searchParams.get('jobId'))
    if (section === 'jobs' && jobId && jobs.length) setEditingJob(jobs.find((job) => job.id === jobId) || null)
  }, [jobs, searchParams, section])
  const companyForm = useMemo(() => company ? { name: company.name || '', description: company.description || '', website: company.website || '', address: company.address || '', employeeCount: company.employeeCount || '', industry: company.industry || '' } : null, [company])
  async function saveCompany(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = Object.fromEntries([...form.entries()].map(([key, value]) => [key, value || undefined]))
    try { setCompany(await recruiterApi.updateCompany(payload)); setError('') } catch (actionError) { setError(actionError.message) }
  }
  async function saveJob(payload) {
    try { if (editingJob?.id) await recruiterApi.updateJob(editingJob.id, payload); else await recruiterApi.createJob(payload); setEditingJob(null); await load() } catch (actionError) { setError(actionError.message) }
  }
  const autoSaveJob = useCallback(async (payload) => {
    try {
      if (editingJob?.id) await recruiterApi.updateJob(editingJob.id, payload)
      else {
        const created = await recruiterApi.createJob(payload)
        if (created?.id) setEditingJob(created)
      }
    } catch (actionError) { setError(actionError.message) }
  }, [editingJob])
  async function submitJob(payload) {
    try {
      if (editingJob?.id) {
        await recruiterApi.updateJob(editingJob.id, { ...payload, status: 'DRAFT' })
        await recruiterApi.submitJob(editingJob.id)
      } else {
        const created = await recruiterApi.createJob({ ...payload, status: 'DRAFT' })
        if (created?.id) await recruiterApi.submitJob(created.id)
      }
      setEditingJob(null)
      await load()
    } catch (actionError) { setError(actionError.message) }
  }
  async function suggestDescription(payload) {
    const result = await recruiterApi.suggestDescription(payload)
    return result.description || result.data?.description || ''
  }
  async function updateApplication(application, status, note = '') {
    if (!canRecruiterTransition(application.status, status) || application.status === status) return
    try {
      const updated = await recruiterApi.updateApplicationStatus(application.id, status, note, application.status)
      setApplications((current) => current.map((item) => item.id === application.id ? { ...item, ...updated } : item))
      setSelectedApplication(note ? null : { ...application, ...updated })
    } catch (actionError) {
      if (actionError.status === 409) {
        await loadApplications()
        setSelectedApplication(null)
        setError('Trạng thái đơn ứng tuyển đã thay đổi. Dữ liệu mới nhất đã được tải lại.')
      } else setError(actionError.message)
    }
  }
  async function showSuggestions(job, params = {}) {
    try { setSuggestedCandidates(await recruiterApi.recommendations(job.id, params)) } catch (actionError) { setError(actionError.message) }
  }
  const nav = [{ id: 'dashboard', label: 'Tổng quan' }, { id: 'jobs', label: 'Quản lý tin' }, { id: 'applications', label: 'Ứng viên' }, { id: 'company', label: 'Hồ sơ công ty' }]
  return <AppShell user={session.user} logout={logout}><main className="recruiter-shell"><aside className="recruiter-sidebar"><div className="recruiter-brand"><b>JC</b><span>Job Connect</span></div><div className="recruiter-profile"><div className="recruiter-avatar">{session.user.fullName?.charAt(0) || 'R'}</div><div><strong>{session.user.fullName}</strong><small>Nhà tuyển dụng</small></div></div><nav>{nav.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => { setSection(item.id); setEditingJob(null) }}>{item.label}</button>)}</nav><button className="logout-button" onClick={logout}>Đăng xuất ↗</button></aside><section className="recruiter-main"><header className="recruiter-header"><div><p className="eyebrow">TRUNG TÂM TUYỂN DỤNG</p><h1>{nav.find((item) => item.id === section)?.label}</h1></div><button className="secondary-button" onClick={load}>↻ Làm mới</button></header>{error && <div className="recruiter-alert">{error}</div>}{loading ? <div className="admin-loading">Đang tải dữ liệu...</div> : section === 'dashboard' && stats ? <Dashboard stats={stats} /> : section === 'jobs' ? <section className="recruiter-card">{editingJob ? <><h2>{editingJob.id ? 'Chỉnh sửa tin tuyển dụng' : 'Tạo tin tuyển dụng'}</h2>    <JobForm initialJob={editingJob.id ? editingJob : null} skills={skills} onSave={saveJob} onAutoSave={autoSaveJob} onSubmitForReview={submitJob} onSuggest={suggestDescription} onCancel={() => setEditingJob(null)} /></> : <><div className="section-heading"><h2>Danh sách tin tuyển dụng</h2><button className="primary-button" onClick={() => setEditingJob({})}>+ Tạo tin mới</button></div><div className="job-status-tabs">{Object.entries(jobStatuses).map(([status, label]) => <span key={status}>{label}: {stats?.jobsByStatus?.[status] || 0}</span>)}</div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Vị trí</th><th>Trạng thái</th><th>Đơn</th><th>Thao tác</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.title}</strong><small>{job.location || 'Chưa cập nhật'}</small>{job.status === 'REJECTED' && job.moderationNote && <em className="moderation-note">Lý do: {job.moderationNote}</em>}</td><td><span className={`status-pill ${job.status.toLowerCase()}`}>{jobStatuses[job.status]}</span></td><td>{job._count?.applications || 0}</td><td>  <button className="table-link" onClick={() => setEditingJob(job)}>Sửa</button>  <button className="table-link" onClick={() => setPipelineJob(job)}>Quy trình tuyển dụng</button><button className="table-link" onClick={() => showSuggestions(job)}>Gợi ý ứng viên</button>{job.status !== 'CLOSED' && <button className="table-link danger" onClick={() => recruiterApi.closeJob(job.id).then(load).catch((actionError) => setError(actionError.message))}>Đóng</button>}</td></tr>)}</tbody></table>    </div></>}  <SuggestedCandidates result={suggestedCandidates} onClose={() => setSuggestedCandidates(null)} onSearch={(jobId, params) => showSuggestions({ id: jobId }, params)} />{pipelineJob && <div className="pipeline-panel"><div className="section-heading"><h2>Quy trình tuyển dụng · {pipelineJob.title}</h2><button className="secondary-button" onClick={() => setPipelineJob(null)}>Đóng</button></div><JobPipeline job={pipelineJob} onError={setError} /></div>}</section> : section === 'applications' ? <section className="recruiter-card"><div className="section-heading"><h2>Quản lý ứng viên</h2><select value={applicationStatus} onChange={(event) => setApplicationStatus(event.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(applicationStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Ứng viên</th><th>Tin tuyển dụng</th><th>Trạng thái</th><th>Ngày nộp</th><th>Thao tác</th></tr></thead><tbody>{applications.map((application) => <tr key={application.id}><td><strong>{application.candidate.user.fullName}</strong><small>{application.candidate.user.email}</small></td><td>{application.job.title}</td><td><span className="status-pill">{applicationStatuses[application.status]}</span></td><td>{new Date(application.appliedAt).toLocaleDateString('vi-VN')}</td><td><button className="table-link" onClick={() => setSelectedApplication(application)}>Xem hồ sơ</button></td></tr>)}</tbody></table></div>{selectedApplication && <div className="candidate-detail"><button className="close-detail" onClick={() => setSelectedApplication(null)}>×</button><h2>{selectedApplication.candidate.user.fullName}</h2><p>{selectedApplication.candidate.user.email} · {selectedApplication.candidate.user.phone || 'Chưa có số điện thoại'}</p><p>{selectedApplication.candidate.headline || 'Chưa cập nhật tiêu đề hồ sơ'}</p><div className="candidate-skills">{selectedApplication.candidate.skills.map(({ skill }) => <span key={skill.id}>{skill.name}</span>)}</div>{selectedApplication.resume && <button className="secondary-button" onClick={() => recruiterApi.downloadResume(selectedApplication.resume.id, selectedApplication.resume.fileName).catch((actionError) => setError(actionError.message))}>Tải CV</button>}<div className="application-actions"><select id="application-status" defaultValue={selectedApplication.status}>{Object.entries(applicationStatuses).filter(([value]) => value !== 'APPLIED' && value !== 'WITHDRAWN').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><textarea placeholder="Ghi chú cho ứng viên (tùy chọn)" id="application-note" /><button className="primary-button" onClick={() => updateApplication(selectedApplication, document.querySelector('#application-status')?.value || selectedApplication.status, document.querySelector('#application-note')?.value)}>Lưu trạng thái và ghi chú</button></div></div>}</section> : <section className="recruiter-card"><h2>Hồ sơ công ty</h2>{companyForm && <form className="recruiter-form" onSubmit={saveCompany}><div className="company-logo-row">{company?.logoUrl && <img src={`${ASSET_URL}${company.logoUrl}`} alt="" />}<label>Biểu trưng công ty<input type="file"   accept="image/png,image/jpeg" onChange={(event) => event.target.files[0] && recruiterApi.uploadLogo(event.target.files[0]).then(setCompany).catch((actionError) => setError(actionError.message))} /></label></div><div className="form-grid"><label>Tên công ty<input name="name" required defaultValue={companyForm.name} /></label>  <label>Trang web<input name="website" type="url" defaultValue={companyForm.website} /></label><label>Quy mô nhân sự<input name="employeeCount" type="number" min="0" defaultValue={companyForm.employeeCount} /></label><label>Ngành<input name="industry" defaultValue={companyForm.industry} /></label><label>Địa chỉ<input name="address" defaultValue={companyForm.address} /></label></div><label>Giới thiệu<textarea name="description" rows="6" defaultValue={companyForm.description} /></label><button className="primary-button">Lưu hồ sơ</button></form>}</section>}</section></main></AppShell>}

import { useEffect, useMemo, useState } from 'react'
import { candidateApi } from '../services/api'
import './profile.css'

const tabs = [
  ['general', 'Thông tin chung'],
  ['education', 'Học vấn'],
  ['experience', 'Kinh nghiệm'],
  ['skills', 'Kỹ năng'],
  ['projects', 'Dự án'],
  ['resumes', 'CV'],
  ['desired', 'Mong muốn công việc']
]

const emptyEducation = { school: '', major: '', degree: '', fromDate: '', toDate: '' }
const emptyExperience = { company: '', title: '', description: '', fromDate: '', toDate: '', isCurrent: false }
const emptyProject = { name: '', description: '', link: '', technologies: [] }

function completion(profile) {
  const checks = [
    profile?.headline, profile?.bio, profile?.location, profile?.education,
    profile?.desiredPosition, profile?.desiredLocation, profile?.skills?.length,
    profile?.educations?.length, profile?.experiences?.length, profile?.projects?.length,
    profile?.resumes?.length
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function validateForm(data, required = []) {
  const errors = {}
  required.forEach((field) => {
    if (!String(data[field] || '').trim()) errors[field] = 'Trường này là bắt buộc'
  })
  Object.entries(data).forEach(([field, value]) => {
    if (typeof value === 'string' && value.length > 10000) errors[field] = 'Không được vượt quá 10000 ký tự'
  })
  if (data.link && !/^https?:\/\/.+/.test(data.link)) errors.link = 'URL không hợp lệ'
  return errors
}

export default function CandidateProfilePage() {
  const [profile, setProfile] = useState(null)
  const [skills, setSkills] = useState([])
  const [tab, setTab] = useState('general')
  const [message, setMessage] = useState(null)
  const [form, setForm] = useState({})
  const [resourceForm, setResourceForm] = useState(emptyEducation)
  const [errors, setErrors] = useState({})

  async function load() {
    const [nextProfile, nextSkills] = await Promise.all([candidateApi.profile(), candidateApi.skills()])
    setProfile(nextProfile)
    setSkills(nextSkills)
    setForm(nextProfile)
  }

  useEffect(() => { load().catch((error) => setMessage({ type: 'error', text: error.message })) }, [])

  const percentage = useMemo(() => completion(profile), [profile])
  if (!profile) return <main className="profile-shell"><p>Đang tải hồ sơ...</p></main>

  async function saveProfile(payload) {
    const nextErrors = validateForm(payload)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    try {
      const updated = await candidateApi.updateProfile(payload)
      setProfile(updated)
      setForm(updated)
      setMessage({ type: 'success', text: 'Đã lưu hồ sơ.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function saveResource(resource, required) {
    const nextErrors = validateForm(resourceForm, required)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    try {
      await candidateApi.create(resource, resourceForm)
      await load()
      setResourceForm(resource === 'educations' ? emptyEducation : resource === 'experiences' ? emptyExperience : emptyProject)
      setMessage({ type: 'success', text: 'Đã thêm thông tin.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function removeResource(resource, id) {
    try { await candidateApi.remove(resource, id); await load() } catch (error) { setMessage({ type: 'error', text: error.message }) }
  }

  return <main className="profile-shell">
    <header className="profile-header">
      <div><p className="eyebrow">HỒ SƠ CỦA TÔI</p><h1>{profile.user?.fullName || 'Ứng viên'}</h1><p>Cập nhật hồ sơ để nhà tuyển dụng hiểu bạn hơn.</p></div>
      <div className="completion-card"><strong>{percentage}%</strong><span>Hoàn thiện hồ sơ</span><progress value={percentage} max="100" /></div>
    </header>
    {message && <div className={`profile-message ${message.type}`}>{message.text}</div>}
    <nav className="profile-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <section className="profile-panel">
      {tab === 'general' && <form className="profile-form" onSubmit={(event) => { event.preventDefault(); saveProfile({ headline: form.headline || null, bio: form.bio || null, location: form.location || null, education: form.education || null }) }}>
        <Field label="Tiêu đề nghề nghiệp" name="headline" value={form.headline || ''} onChange={setForm} maxLength={180} error={errors.headline} />
        <Field label="Địa điểm" name="location" value={form.location || ''} onChange={setForm} maxLength={150} error={errors.location} />
        <Field label="Giới thiệu" name="bio" value={form.bio || ''} onChange={setForm} maxLength={10000} textarea error={errors.bio} />
        <Field label="Học vấn tổng quan" name="education" value={form.education || ''} onChange={setForm} maxLength={255} error={errors.education} />
        <button className="profile-submit">Lưu thay đổi</button>
      </form>}
      {tab === 'desired' && <form className="profile-form" onSubmit={(event) => { event.preventDefault(); saveProfile({ desiredPosition: form.desiredPosition || null, desiredLocation: form.desiredLocation || null, desiredSalary: form.desiredSalary ? Number(form.desiredSalary) : null, desiredEmploymentType: form.desiredEmploymentType || null }) }}>
        <Field label="Vị trí mong muốn" name="desiredPosition" value={form.desiredPosition || ''} onChange={setForm} maxLength={180} />
        <Field label="Địa điểm mong muốn" name="desiredLocation" value={form.desiredLocation || ''} onChange={setForm} maxLength={150} />
        <Field label="Mức lương mong muốn" name="desiredSalary" type="number" value={form.desiredSalary || ''} onChange={setForm} />
        <label>Loại hình<select value={form.desiredEmploymentType || ''} onChange={(event) => setForm({ ...form, desiredEmploymentType: event.target.value })}><option value="">Chưa chọn</option>{['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="switch-row">Cho phép tìm kiếm hồ sơ <input type="checkbox" checked={Boolean(form.isSearchable)} onChange={(event) => { const value = event.target.checked; setForm({ ...form, isSearchable: value }); saveProfile({ isSearchable: value }) }} /></label>
        <button className="profile-submit">Lưu thay đổi</button>
      </form>}
      {['education', 'experience', 'projects'].includes(tab) && <ResourceSection tab={tab} profile={profile} form={resourceForm} setForm={setResourceForm} save={saveResource} remove={removeResource} errors={errors} />}
      {tab === 'skills' && <div><h2>Kỹ năng</h2><div className="skill-list">{skills.map((skill) => <label key={skill.id}><input type="checkbox" checked={profile.skills?.some((item) => item.skillId === skill.id)} onChange={async (event) => { const ids = profile.skills?.map((item) => item.skillId) || []; const next = event.target.checked ? [...ids, skill.id] : ids.filter((id) => id !== skill.id); try { const updated = await candidateApi.updateSkills(next); setProfile(updated) } catch (error) { setMessage({ type: 'error', text: error.message }) } }} /> {skill.name}</label>)}</div></div>}
      {tab === 'resumes' && <ResumeSection profile={profile} load={load} setMessage={setMessage} />}
    </section>
  </main>
}

function Field({ label, name, value, onChange, textarea, error, ...props }) {
  const Tag = textarea ? 'textarea' : 'input'
  return <label>{label}<Tag name={name} value={value} onChange={(event) => onChange((current) => ({ ...current, [name]: event.target.value }))} {...props} />{error && <small className="field-error">{error}</small>}</label>
}

function ResourceSection({ tab, profile, form, setForm, save, remove, errors }) {
  const resource = tab === 'projects' ? 'projects' : `${tab}s`
  const items = profile[resource] || []
  const labels = { education: ['Trường học', 'school'], experience: ['Công ty', 'company'], projects: ['Tên dự án', 'name'] }
  const [label, field] = labels[tab]
  return <div><h2>{tabs.find(([id]) => id === tab)[1]}</h2>{items.map((item) => <article className="resource-item" key={item.id}><strong>{item[field]}</strong><p>{item.major || item.title || item.description}</p><button onClick={() => remove(resource, item.id)}>Xóa</button></article>)}<div className="resource-form"><Field label={label} name={field} value={form[field] || ''} onChange={setForm} error={errors[field]} maxLength={255} />{tab === 'experience' && <Field label="Chức danh" name="title" value={form.title || ''} onChange={setForm} maxLength={180} />}{tab === 'education' && <Field label="Chuyên ngành" name="major" value={form.major || ''} onChange={setForm} maxLength={180} />}{tab === 'projects' && <Field label="Mô tả" name="description" value={form.description || ''} onChange={setForm} textarea maxLength={10000} />}<button className="profile-submit" onClick={() => save(resource, [field])}>Thêm mới</button></div></div>
}

function ResumeSection({ profile, load, setMessage }) {
  async function upload(event) { const file = event.target.files[0]; if (!file) return; if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type) || file.size > 5 * 1024 * 1024) return setMessage({ type: 'error', text: 'CV phải là PDF hoặc DOCX và tối đa 5MB.' }); try { await candidateApi.uploadResume(file, !profile.resumes?.length); await load() } catch (error) { setMessage({ type: 'error', text: error.message }) } }
  async function rename(resume) {
    const fileName = window.prompt('Tên CV mới', resume.fileName)
    if (!fileName) return
    try { await candidateApi.renameResume(resume.id, fileName); await load() } catch (error) { setMessage({ type: 'error', text: error.message }) }
  }
  async function remove(resume) {
    if (!window.confirm(`Xóa ${resume.fileName}?`)) return
    try { await candidateApi.remove('resumes', resume.id); await load() } catch (error) { setMessage({ type: 'error', text: error.message }) }
  }
  return <div><h2>CV của bạn</h2><label className="upload-box">Chọn CV (PDF/DOCX, tối đa 5MB)<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={upload} /></label>{profile.resumes?.map((resume) => <article className="resource-item" key={resume.id}><strong>{resume.fileName}</strong><span>{Math.round(resume.size / 1024)} KB {resume.isDefault && '· Mặc định'}</span><button onClick={async () => { try { await candidateApi.downloadResume(resume.id, resume.fileName) } catch (error) { setMessage({ type: 'error', text: error.message }) } }}>Tải xuống</button><button onClick={() => rename(resume)}>Đổi tên</button><button onClick={async () => { try { await candidateApi.setDefaultResume(resume.id); await load() } catch (error) { setMessage({ type: 'error', text: error.message }) } }}>Đặt mặc định</button><button onClick={() => remove(resume)}>Xóa</button></article>)}</div>
}

import { useEffect, useState } from 'react'
import { candidateApi } from '../services/api'
import { useAuth } from '../context/auth'
import AppShell from '../components/AppShell'
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
  const { session, logout } = useAuth()
  const [profile, setProfile] = useState(null)
  const [completeness, setCompleteness] = useState(null)
  const [skills, setSkills] = useState([])
  const [tab, setTab] = useState('general')
  const [message, setMessage] = useState(null)
  const [form, setForm] = useState({})
  const [resourceForm, setResourceForm] = useState(emptyEducation)
  const [editingResource, setEditingResource] = useState(null)
  const [savingResource, setSavingResource] = useState(false)
  const [errors, setErrors] = useState({})

  async function load() {
    const [nextProfile, nextSkills, nextCompleteness] = await Promise.all([candidateApi.profile(), candidateApi.skills(), candidateApi.completeness()])
    setProfile(nextProfile)
    setSkills(nextSkills)
    setForm(nextProfile)
    setCompleteness(nextCompleteness)
  }

  useEffect(() => { load().catch((error) => setMessage({ type: 'error', text: error.message })) }, [])

  if (!profile) return <AppShell user={session.user} logout={logout}><main className="profile-shell">{message?.type === 'error' ? <p className="profile-message error">{message.text}</p> : <p>Đang tải hồ sơ...</p>}</main></AppShell>

  function goToChecklist(item) {
    setTab(item.tab)
    window.setTimeout(() => document.querySelector(`[data-profile-field="${item.field}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
  }

  async function saveProfile(payload) {
    const nextErrors = validateForm(payload)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    try {
      const updated = await candidateApi.updateProfile(payload)
      setProfile(updated)
      setForm(updated)
      setCompleteness(await candidateApi.completeness())
      setMessage({ type: 'success', text: 'Đã lưu hồ sơ.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  async function saveResource(resource, required) {
    const nextErrors = validateForm(resourceForm, required)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setSavingResource(true)
    try {
      const payload = Object.fromEntries(Object.entries(resourceForm)
        .filter(([key]) => !['id', 'candidateId', 'createdAt', 'updatedAt'].includes(key))
        .map(([key, value]) => [key, ['fromDate', 'toDate'].includes(key) && value === '' ? null : value]))
      if (editingResource?.resource === resource) await candidateApi.update(resource, editingResource.id, payload)
      else await candidateApi.create(resource, payload)
      await load()
      setResourceForm(resource === 'educations' ? emptyEducation : resource === 'experiences' ? emptyExperience : emptyProject)
      setEditingResource(null)
      setMessage({ type: 'success', text: editingResource ? 'Đã cập nhật thông tin.' : 'Đã thêm thông tin.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally { setSavingResource(false) }
  }

  function editResource(resource, item) {
    setEditingResource({ resource, id: item.id })
    setResourceForm({ ...item, fromDate: item.fromDate ? String(item.fromDate).slice(0, 10) : '', toDate: item.toDate ? String(item.toDate).slice(0, 10) : '' })
    setErrors({})
  }

  function cancelResourceEdit(resource) {
    setEditingResource(null)
    setResourceForm(resource === 'educations' ? emptyEducation : resource === 'experiences' ? emptyExperience : emptyProject)
    setErrors({})
  }

  async function removeResource(resource, id) {
    try { await candidateApi.remove(resource, id); await load() } catch (error) { setMessage({ type: 'error', text: error.message }) }
  }

  return <AppShell user={session.user} logout={logout}><main className="profile-shell">
    <header className="profile-header">
      <div><p className="eyebrow">HỒ SƠ CỦA TÔI</p><h1>{profile.user?.fullName || 'Ứng viên'}</h1><p>Cập nhật hồ sơ để nhà tuyển dụng hiểu bạn hơn.</p></div>
      <div className="completion-card"><strong>{completeness?.percentage || 0}%</strong><span>Độ mạnh hồ sơ</span><progress value={completeness?.percentage || 0} max="100" /><small>{completeness?.completed || 0}/{completeness?.total || 0} mục đã hoàn thành</small></div>
    </header>
    {message && <div className={`profile-message ${message.type}`}>{message.text}</div>}
    {completeness?.missing?.length > 0 && <section className="profile-completeness-card"><div><p className="eyebrow">CHECKLIST HỒ SƠ</p><h2>Việc cần làm để hồ sơ nổi bật hơn</h2></div><ul>{completeness.missing.map((item) => <li key={item.id}><span>{item.label}</span><button type="button" onClick={() => goToChecklist(item)}>Cập nhật →</button></li>)}</ul></section>}
    <nav className="profile-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <section className="profile-panel">
      {tab === 'general' && <form className="profile-form" onSubmit={(event) => { event.preventDefault(); saveProfile({ headline: form.headline || null, bio: form.bio || null, location: form.location || null, education: form.education || null }) }}>
        <div data-profile-field="headline"><Field label="Tiêu đề nghề nghiệp" name="headline" value={form.headline || ''} onChange={setForm} maxLength={180} error={errors.headline} /></div>
        <Field label="Địa điểm" name="location" value={form.location || ''} onChange={setForm} maxLength={150} error={errors.location} />
        <div data-profile-field="bio"><Field label="Giới thiệu" name="bio" value={form.bio || ''} onChange={setForm} maxLength={10000} textarea error={errors.bio} /></div>
        <Field label="Học vấn tổng quan" name="education" value={form.education || ''} onChange={setForm} maxLength={255} error={errors.education} />
        <button className="profile-submit">Lưu thay đổi</button>
      </form>}
      {tab === 'desired' && <form className="profile-form" onSubmit={(event) => { event.preventDefault(); saveProfile({ desiredPosition: form.desiredPosition || null, desiredLocation: form.desiredLocation || null, desiredSalary: form.desiredSalary ? Number(form.desiredSalary) : null, desiredEmploymentType: form.desiredEmploymentType || null }) }}>
        <div data-profile-field="desiredPosition"><Field label="Vị trí mong muốn" name="desiredPosition" value={form.desiredPosition || ''} onChange={setForm} maxLength={180} /></div>
        <div data-profile-field="desiredLocation"><Field label="Địa điểm mong muốn" name="desiredLocation" value={form.desiredLocation || ''} onChange={setForm} maxLength={150} /></div>
        <div data-profile-field="desiredSalary"><Field label="Mức lương mong muốn" name="desiredSalary" type="number" value={form.desiredSalary || ''} onChange={setForm} /></div>
        <label>Loại hình<select value={form.desiredEmploymentType || ''} onChange={(event) => setForm({ ...form, desiredEmploymentType: event.target.value })}><option value="">Chưa chọn</option>{['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'REMOTE', 'HYBRID'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <section className="job-search-card"><div><h2>Đang tìm việc</h2><p>Bật để nhà tuyển dụng tìm thấy hồ sơ của bạn và hồ sơ được dùng để gợi ý việc làm phù hợp.</p></div><label className="switch-row"><span>{form.isSearchable ? 'Đang bật' : 'Đang tắt'}</span><input type="checkbox" checked={Boolean(form.isSearchable)} onChange={(event) => { const value = event.target.checked; setForm({ ...form, isSearchable: value }); saveProfile({ isSearchable: value }) }} /></label></section>
        <button className="profile-submit">Lưu thay đổi</button>
      </form>}
      {['education', 'experience', 'projects'].includes(tab) && <div data-profile-field={tab}><ResourceSection tab={tab} profile={profile} form={resourceForm} setForm={setResourceForm} save={saveResource} remove={removeResource} edit={editResource} editing={editingResource} cancelEdit={cancelResourceEdit} saving={savingResource} errors={errors} /></div>}
      {tab === 'skills' && <div data-profile-field="skills"><h2>Kỹ năng</h2><p className="profile-hint">Chọn ít nhất 5 kỹ năng để nhà tuyển dụng hiểu rõ thế mạnh của bạn.</p><div className="skill-list">{skills.map((skill) => <label key={skill.id}><input type="checkbox" checked={profile.skills?.some((item) => item.skillId === skill.id)} onChange={async (event) => { const ids = profile.skills?.map((item) => item.skillId) || []; const next = event.target.checked ? [...ids, skill.id] : ids.filter((id) => id !== skill.id); try { const updated = await candidateApi.updateSkills(next); setProfile(updated); const nextCompleteness = await candidateApi.completeness(); setCompleteness(nextCompleteness) } catch (error) { setMessage({ type: 'error', text: error.message }) } }} /> {skill.name}</label>)}</div></div>}
      {tab === 'resumes' && <div data-profile-field="resumes"><ResumeSection profile={profile} load={load} setMessage={setMessage} /></div>}
    </section>
  </main></AppShell>
}

function Field({ label, name, value, onChange, textarea, error, ...props }) {
  const Tag = textarea ? 'textarea' : 'input'
  return <label>{label}<Tag name={name} value={value} onChange={(event) => onChange((current) => ({ ...current, [name]: event.target.value }))} {...props} />{error && <small className="field-error">{error}</small>}</label>
}

function ResourceSection({ tab, profile, form, setForm, save, remove, edit, editing, cancelEdit, saving, errors }) {
  const resource = tab === 'projects' ? 'projects' : `${tab}s`
  const items = profile[resource] || []
  const labels = { education: ['Trường học', 'school'], experience: ['Công ty', 'company'], projects: ['Tên dự án', 'name'] }
  const [label, field] = labels[tab]
  const isEditing = editing?.resource === resource
  return <div><h2>{tabs.find(([id]) => id === tab)[1]}</h2>{items.map((item) => <article className="resource-item" key={item.id}><strong>{item[field]}</strong><p>{item.major || item.title || item.description}</p><div className="resource-actions"><button type="button" onClick={() => edit(resource, item)}>Sửa</button><button type="button" onClick={() => remove(resource, item.id)}>Xóa</button></div></article>)}<div className="resource-form"><h3>{isEditing ? 'Chỉnh sửa thông tin' : 'Thêm thông tin mới'}</h3><Field label={label} name={field} value={form[field] || ''} onChange={setForm} error={errors[field]} maxLength={255} />{tab === 'experience' && <><Field label="Chức danh" name="title" value={form.title || ''} onChange={setForm} error={errors.title} maxLength={180} /><Field label="Mô tả công việc" name="description" value={form.description || ''} onChange={setForm} textarea maxLength={10000} /></>}{tab === 'education' && <><Field label="Chuyên ngành" name="major" value={form.major || ''} onChange={setForm} maxLength={180} /><Field label="Bằng cấp" name="degree" value={form.degree || ''} onChange={setForm} maxLength={100} /></>}{tab === 'projects' && <><Field label="Mô tả" name="description" value={form.description || ''} onChange={setForm} textarea maxLength={10000} /><Field label="Liên kết dự án" name="link" type="url" value={form.link || ''} onChange={setForm} error={errors.link} maxLength={500} /></>}<div className="resource-form-actions">{isEditing && <button type="button" className="secondary-button" onClick={() => cancelEdit(resource)}>Hủy chỉnh sửa</button>}<button type="button" className="profile-submit" disabled={saving} onClick={() => save(resource, tab === 'experience' ? [field, 'title'] : [field])}>{saving ? 'Đang lưu...' : isEditing ? 'Lưu thay đổi' : 'Thêm mới'}</button></div></div></div>
}

function ResumeSection({ profile, load, setMessage }) {
  const [importing, setImporting] = useState(null)
  const [draft, setDraft] = useState(null)
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
  async function importResume(resume) {
    try {
      setImporting(resume.id)
      const result = await candidateApi.importResume(resume.id)
      setDraft({
        ...result,
        resumeId: resume.id,
        skillsText: result.skills.join(', '),
        educationText: JSON.stringify(result.education, null, 2),
        experienceText: JSON.stringify(result.experience, null, 2),
        projectsText: JSON.stringify(result.projects, null, 2)
      })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setImporting(null)
    }
  }
  async function confirmImport() {
    try {
      const payload = {
        headline: draft.headline || null,
        skills: draft.skillsText.split(',').map((skill) => skill.trim()).filter(Boolean),
        education: JSON.parse(draft.educationText || '[]'),
        experience: JSON.parse(draft.experienceText || '[]'),
        projects: JSON.parse(draft.projectsText || '[]')
      }
      await candidateApi.confirmResumeImport(draft.resumeId, payload)
      setDraft(null)
      await load()
      setMessage({ type: 'success', text: 'Đã nhập hồ sơ từ CV.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof SyntaxError ? 'Dữ liệu học vấn, kinh nghiệm hoặc dự án phải là JSON hợp lệ.' : error.message })
    }
  }
  return <div><h2>CV của bạn</h2><label className="upload-box">Chọn CV (PDF/DOCX, tối đa 5MB)<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={upload} /></label>{profile.resumes?.map((resume) => <article className="resource-item" key={resume.id}><strong>{resume.fileName}</strong><span>{Math.round(resume.size / 1024)} KB {resume.isDefault && '· Mặc định'}</span><button onClick={async () => { try { await candidateApi.downloadResume(resume.id, resume.fileName) } catch (error) { setMessage({ type: 'error', text: error.message }) } }}>Tải xuống</button><button onClick={() => importResume(resume)} disabled={importing === resume.id}>{importing === resume.id ? 'Đang phân tích...' : 'Nhập hồ sơ từ CV'}</button><button onClick={() => rename(resume)}>Đổi tên</button><button onClick={async () => { try { await candidateApi.setDefaultResume(resume.id); await load() } catch (error) { setMessage({ type: 'error', text: error.message }) } }}>Đặt mặc định</button><button onClick={() => remove(resume)}>Xóa</button></article>)}{draft && <section className="resume-import-review"><div className="section-heading"><div><p className="eyebrow">XEM LẠI TRƯỚC KHI LƯU</p><h3>Thông tin trích xuất từ CV</h3></div><button type="button" onClick={() => setDraft(null)}>Hủy</button></div><p className="profile-hint">AI chỉ đề xuất dữ liệu. Bạn có thể chỉnh sửa trước khi xác nhận; nội dung chỉ được lưu sau khi bấm nút bên dưới.</p><Field label="Tiêu đề nghề nghiệp" value={draft.headline || ''} onChange={(value) => setDraft({ ...draft, headline: value })} /><Field label="Kỹ năng (phân cách bằng dấu phẩy)" value={draft.skillsText} onChange={(value) => setDraft({ ...draft, skillsText: value })} /><label>Học vấn (JSON)<textarea rows="6" value={draft.educationText} onChange={(event) => setDraft({ ...draft, educationText: event.target.value })} /></label><label>Kinh nghiệm (JSON)<textarea rows="8" value={draft.experienceText} onChange={(event) => setDraft({ ...draft, experienceText: event.target.value })} /></label><label>Dự án (JSON)<textarea rows="8" value={draft.projectsText} onChange={(event) => setDraft({ ...draft, projectsText: event.target.value })} /></label>{draft.suggestedSkills?.length > 0 && <p className="profile-hint">Kỹ năng mới sẽ được đề xuất và tạo trong danh mục khi bạn xác nhận: {draft.suggestedSkills.join(', ')}</p>}<button type="button" className="profile-submit" onClick={confirmImport}>Xác nhận và lưu vào hồ sơ</button></section>}</div>
  return <div><h2>CV của bạn</h2><label className="upload-box">Chọn CV (PDF/DOCX, tối đa 5MB)<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={upload} /></label>{profile.resumes?.map((resume) => <article className="resource-item" key={resume.id}><strong>{resume.fileName}</strong><span>{Math.round(resume.size / 1024)} KB {resume.isDefault && '· Mặc định'}</span><button onClick={async () => { try { await candidateApi.downloadResume(resume.id, resume.fileName) } catch (error) { setMessage({ type: 'error', text: error.message }) } }}>Tải xuống</button><button onClick={() => importResume(resume)} disabled={importing === resume.id}>{importing === resume.id ? 'Đang phân tích...' : 'Nhập hồ sơ từ CV'}</button><button onClick={() => rename(resume)}>Đổi tên</button><button onClick={async () => { try { await candidateApi.setDefaultResume(resume.id); await load() } catch (error) { setMessage({ type: 'error', text: error.message }) } }}>Đặt mặc định</button><button onClick={() => remove(resume)}>Xóa</button></article>)}{draft && <section className="resume-import-review"><div className="section-heading"><div><p className="eyebrow">XEM LẠI TRƯỚC KHI LƯU</p><h3>Thông tin trích xuất từ CV</h3></div><button type="button" onClick={() => setDraft(null)}>Hủy</button></div><p className="profile-hint">AI chỉ đề xuất dữ liệu. Bạn có thể chỉnh sửa trước khi xác nhận; nội dung chỉ được lưu sau khi bấm nút bên dưới.</p><label>Tiêu đề nghề nghiệp<input value={draft.headline || ''} onChange={(event) => setDraft({ ...draft, headline: event.target.value })} /></label><label>Kỹ năng (phân cách bằng dấu phẩy)<input value={draft.skillsText} onChange={(event) => setDraft({ ...draft, skillsText: event.target.value })} /></label><label>Học vấn (JSON)<textarea rows="6" value={draft.educationText} onChange={(event) => setDraft({ ...draft, educationText: event.target.value })} /></label><label>Kinh nghiệm (JSON)<textarea rows="8" value={draft.experienceText} onChange={(event) => setDraft({ ...draft, experienceText: event.target.value })} /></label><label>Dự án (JSON)<textarea rows="8" value={draft.projectsText} onChange={(event) => setDraft({ ...draft, projectsText: event.target.value })} /></label>{draft.suggestedSkills?.length > 0 && <p className="profile-hint">Kỹ năng mới sẽ được đề xuất và tạo trong danh mục khi bạn xác nhận: {draft.suggestedSkills.join(', ')}</p>}<button type="button" className="profile-submit" onClick={confirmImport}>Xác nhận và lưu vào hồ sơ</button></section>}</div>
}

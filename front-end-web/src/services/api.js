const API_URL = 'http://localhost:5000/api'

let unauthorizedHandler = null
let accessToken = null

export function setAccessToken(token) {
  accessToken = token
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)

  let response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' })
  let finalResult = await response.json().catch(() => ({}))

  if (response.status === 401 && path !== '/auth/refresh') {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    if (refreshed.ok) {
      const refreshResult = await refreshed.json()
      accessToken = refreshResult.data.token
      headers.set('Authorization', `Bearer ${accessToken}`)
      response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' })
      finalResult = await response.json().catch(() => ({}))
    } else {
      unauthorizedHandler?.()
    }
  }
  if (!response.ok) throw new Error(finalResult.message || 'Không thể thực hiện yêu cầu')
  return finalResult.data
}

export const authApi = {
  login: (payload) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  register: (payload) => apiRequest('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => apiRequest('/auth/me'),
  refresh: () => apiRequest('/auth/refresh', { method: 'POST' }),
  logout: () => apiRequest('/auth/logout', { method: 'POST' })
}

export const jobsApi = {
  list: (filters) => {
    const query = new URLSearchParams({
      limit: '12',
      ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value))
    })
    return apiRequest(`/jobs?${query.toString()}`, { headers: {} })
  },
  apply: (jobId, coverLetter, resumeId) => apiRequest(`/applications/jobs/${jobId}`, {
    method: 'POST',
    body: JSON.stringify({ coverLetter: coverLetter || undefined, resumeId })
  })
}

export const applicationsApi = {
  list: () => apiRequest('/applications/me'),
  withdraw: (id) => apiRequest(`/applications/${id}/withdraw`, { method: 'PATCH' })
}

export const notificationsApi = {
  list: (params = {}) => {
    const query = new URLSearchParams(Object.fromEntries(Object.entries({ limit: 20, ...params }).filter(([, value]) => value !== undefined)))
    return apiRequest(`/notifications?${query}`)
  },
  markRead: (id) => apiRequest(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () => apiRequest('/notifications/read-all', { method: 'PATCH' })
}

export const candidateApi = {
  profile: () => apiRequest('/candidates/me'),
  updateProfile: (payload) => apiRequest('/candidates/me', { method: 'PATCH', body: JSON.stringify(payload) }),
  skills: () => apiRequest('/candidates/skills'),
  updateSkills: (skillIds) => apiRequest('/candidates/me/skills', { method: 'PUT', body: JSON.stringify({ skillIds }) }),
  list: (resource) => apiRequest(`/candidates/me/${resource}`),
  create: (resource, payload) => apiRequest(`/candidates/me/${resource}`, { method: 'POST', body: JSON.stringify(payload) }),
  update: (resource, id, payload) => apiRequest(`/candidates/me/${resource}/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  remove: (resource, id) => apiRequest(`/candidates/me/${resource}/${id}`, { method: 'DELETE' }),
  uploadResume: (file, isDefault) => {
    const body = new FormData()
    body.append('file', file)
    body.append('isDefault', String(isDefault))
    return apiRequest('/candidates/me/resumes', { method: 'POST', body })
  },
  renameResume: (id, fileName) => apiRequest(`/candidates/me/resumes/${id}`, { method: 'PATCH', body: JSON.stringify({ fileName }) }),
  setDefaultResume: (id) => apiRequest(`/candidates/me/resumes/${id}/default`, { method: 'PATCH' }),
  savedJobs: () => apiRequest('/candidates/me/saved-jobs'),
  saveJob: (id) => apiRequest(`/candidates/me/saved-jobs/${id}`, { method: 'POST' }),
  unsaveJob: (id) => apiRequest(`/candidates/me/saved-jobs/${id}`, { method: 'DELETE' }),
  downloadResume: async (id, fileName) => {
    const response = await fetch(`${API_URL}/candidates/resumes/${id}/download`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
    })
    if (!response.ok) throw new Error('Không thể tải CV')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }
}

export const adminApi = {
  dashboard: async (params = {}) => {
    const query = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value)))
    const [stats, jobs, users] = await Promise.all([
      apiRequest(`/admin/stats?${query}`),
      apiRequest('/admin/jobs?status=PENDING&limit=8'),
      apiRequest('/admin/users?limit=8')
    ])
    return { stats, jobs, users }
  },
  user: (id) => apiRequest(`/admin/users/${id}`),
  auditLogs: (params = {}) => apiRequest(`/admin/audit-logs?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value)))}`),
  moderateJob: (id, status, note) => apiRequest(`/admin/jobs/${id}/moderation`, { method: 'PATCH', body: JSON.stringify({ status, note: note || undefined }) }),
  updateUserStatus: (id, status) => apiRequest(`/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
}

export const recruiterApi = {
  stats: () => apiRequest('/recruiters/stats'),
  company: () => apiRequest('/companies/me'),
  updateCompany: (payload) => apiRequest('/companies/me', { method: 'PATCH', body: JSON.stringify(payload) }),
  uploadLogo: (file) => {
    const body = new FormData()
    body.append('file', file)
    return apiRequest('/companies/me/logo', { method: 'POST', body })
  },
  jobs: () => apiRequest('/jobs/me'),
  createJob: (payload) => apiRequest('/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  updateJob: (id, payload) => apiRequest(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  closeJob: (id) => apiRequest(`/jobs/${id}`, { method: 'DELETE' }),
  recommendations: (jobId, params = {}) => apiRequest(`/recommendations/jobs/${jobId}/candidates?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')))}`),
  skills: () => apiRequest('/candidates/skills'),
  applications: (params = {}) => {
    const query = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value)))
    return apiRequest(`/applications/managed?${query}`)
  },
  application: (id) => apiRequest(`/applications/${id}`),
  updateApplicationStatus: (id, status, note) => apiRequest(`/applications/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note: note || undefined })
  }),
  downloadResume: async (id, fileName = 'CV-ung-vien') => {
    const response = await fetch(`${API_URL}/candidates/resumes/${id}/download`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
    })
    if (!response.ok) throw new Error('Không thể tải CV')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }
}

export const recommendationApi = {
  jobs: (limit = 20) => apiRequest(`/recommendations/jobs?limit=${limit}`),
  chat: (message) => apiRequest('/ai/chat', { method: 'POST', body: JSON.stringify({ message }) })
}

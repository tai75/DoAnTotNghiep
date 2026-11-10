const API_URL = (import.meta.env.VITE_API_URL?.trim() || '/api').replace(/\/+$/, '')
const MATCHING_V2_ENABLED = import.meta.env.VITE_MATCHING_V2_ENABLED === 'true'

let unauthorizedHandler = null
let accessToken = null
let refreshPromise = null

export class ApiError extends Error {
  constructor(message, { status = 0, isNetworkError = false } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.isNetworkError = isNetworkError
  }
}

export function setAccessToken(token) {
  accessToken = token
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler
}

async function fetchFromApi(path, options = {}, token = accessToken) {
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  try {
    return await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiError('Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối và thử lại.', { isNetworkError: true })
  }
}

async function readJson(response) {
  if (response.status === 204) return {}
  return response.json().catch(() => ({}))
}

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetchFromApi('/auth/refresh', { method: 'POST' }, null)
      const result = await readJson(response)
      if (!response.ok || !result.data?.token) {
        if (response.status === 401 || response.status === 403) {
          accessToken = null
          unauthorizedHandler?.()
        }
        throw new ApiError(result.message || 'Phiên đăng nhập đã hết hạn.', { status: response.status })
      }
      accessToken = result.data.token
      return accessToken
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

async function requestWithRefresh(path, options = {}) {
  const requestToken = accessToken
  let response = await fetchFromApi(path, options, requestToken)

  if (response.status === 401 && requestToken && !path.startsWith('/auth/')) {
    const token = requestToken === accessToken ? await refreshAccessToken() : accessToken
    response = await fetchFromApi(path, options, token)
  }
  return response
}

export async function apiRequest(path, options = {}) {
  const response = await requestWithRefresh(path, options)
  const result = await readJson(response)
  if (!response.ok) throw new ApiError(result.message || 'Không thể thực hiện yêu cầu.', { status: response.status })
  return result.data
}

async function downloadFile(path, fileName) {
  const response = await requestWithRefresh(path)
  if (!response.ok) {
    const result = await readJson(response)
    throw new ApiError(result.message || 'Không thể tải CV.', { status: response.status })
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export const authApi = {
  login: (payload) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  register: (payload) => apiRequest('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => apiRequest('/auth/me'),
  refresh: () => apiRequest('/auth/refresh', { method: 'POST' }),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
  updateMe: (payload) => apiRequest('/auth/me', { method: 'PATCH', body: JSON.stringify(payload) }),
  changePassword: (currentPassword, newPassword) => apiRequest('/auth/me/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) }),
  requestPasswordReset: (email) => apiRequest('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) }),
  confirmPasswordReset: (token, password) => apiRequest('/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token, password }) })
}

export const jobsApi = {
  list: (filters) => {
    const query = new URLSearchParams({
      limit: '12',
      ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value))
    })
    return apiRequest(`/jobs?${query.toString()}`, { headers: {} })
  },
  get: (id) => apiRequest(`/jobs/${id}`),
  match: (id) => apiRequest(`/jobs/${id}/match`),
  matchV2: (id) => MATCHING_V2_ENABLED
    ? apiRequest(`/jobs/${id}/match/v2`)
    : Promise.reject(new ApiError('Matching V2 legacy Ä‘Ã£ bá»‹ táº¯t.', { status: 410 })),
  apply: (jobId, coverLetter, resumeId, answers = []) => apiRequest(`/applications/jobs/${jobId}`, {
    method: 'POST',
    body: JSON.stringify({ coverLetter: coverLetter || undefined, resumeId, answers })
  }),
  screeningQuestions: (id) => apiRequest(`/jobs/${id}/screening-questions`)
}

export const companiesApi = {
  list: (filters = {}) => apiRequest(`/companies?${new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)))}`, { headers: {} }),
  get: (id) => apiRequest(`/companies/${id}`),
  following: (id) => apiRequest(`/companies/${id}/following`),
  follow: (id) => apiRequest(`/companies/${id}/follow`, { method: 'POST' }),
  unfollow: (id) => apiRequest(`/companies/${id}/follow`, { method: 'DELETE' }),
  review: (id, payload) => apiRequest(`/companies/${id}/reviews`, { method: 'POST', body: JSON.stringify(payload) })
}

export const applicationsApi = {
  list: () => apiRequest('/applications/me'),
  withdraw: (id, expectedStatus) => apiRequest(`/applications/${id}/withdraw`, {
    method: 'PATCH',
    body: JSON.stringify({ expectedStatus })
  })
}

const interviewQuery = (params = {}) => new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')))

export const candidateInterviewsApi = {
  list: (params = {}) => apiRequest(`/interviews/candidate?${interviewQuery(params)}`),
  get: (id) => apiRequest(`/interviews/candidate/${id}`),
  confirm: (id, expectedVersion, note) => apiRequest(`/interviews/candidate/${id}/confirm`, { method: 'POST', body: JSON.stringify({ expectedVersion, note: note || undefined }) }),
  decline: (id, expectedVersion, note) => apiRequest(`/interviews/candidate/${id}/decline`, { method: 'POST', body: JSON.stringify({ expectedVersion, note: note || undefined }) }),
  requestReschedule: (id, payload) => apiRequest(`/interviews/candidate/${id}/reschedule`, { method: 'POST', body: JSON.stringify(payload) })
}

export const recruiterInterviewsApi = {
  list: (params = {}) => apiRequest(`/interviews/recruiter?${interviewQuery(params)}`),
  get: (id) => apiRequest(`/interviews/recruiter/${id}`),
  create: (payload) => apiRequest('/interviews/recruiter', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, payload) => apiRequest(`/interviews/recruiter/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  cancel: (id, expectedVersion, note) => apiRequest(`/interviews/recruiter/${id}/cancel`, { method: 'POST', body: JSON.stringify({ expectedVersion, note: note || undefined }) }),
  complete: (id, expectedVersion, note) => apiRequest(`/interviews/recruiter/${id}/complete`, { method: 'POST', body: JSON.stringify({ expectedVersion, note: note || undefined }) })
}

export const notificationsApi = {
  list: (params = {}) => {
    const query = new URLSearchParams(Object.fromEntries(Object.entries({ limit: 20, ...params }).filter(([, value]) => value !== undefined)))
    return apiRequest(`/notifications?${query}`)
  },
  markRead: (id) => apiRequest(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () => apiRequest('/notifications/read-all', { method: 'PATCH' })
}

export const messagesApi = {
  unreadCount: () => apiRequest('/conversations/unread-count'),
  list: () => apiRequest('/conversations'),
  createForApplication: (applicationId) => apiRequest(`/conversations/applications/${applicationId}`, { method: 'POST' }),
  messages: (conversationId) => apiRequest(`/conversations/${conversationId}/messages`),
  send: (conversationId, content) => apiRequest(`/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),
  markRead: (conversationId) => apiRequest(`/conversations/${conversationId}/read`, { method: 'PATCH' })
}

export const candidateApi = {
  profile: () => apiRequest('/candidates/me'),
  completeness: () => apiRequest('/candidates/me/completeness'),
  analyzeResumeForJob: (jobId) => apiRequest(`/candidates/me/job-analysis/${jobId}`, { method: 'POST' }),
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
  importResume: (id) => apiRequest(`/candidates/me/resumes/${id}/import`, { method: 'POST' }),
  confirmResumeImport: (id, payload) => apiRequest(`/candidates/me/resumes/${id}/import/confirm`, { method: 'POST', body: JSON.stringify(payload) }),
  savedJobs: () => apiRequest('/candidates/me/saved-jobs'),
  saveJob: (id) => apiRequest(`/candidates/me/saved-jobs/${id}`, { method: 'POST' }),
  unsaveJob: (id) => apiRequest(`/candidates/me/saved-jobs/${id}`, { method: 'DELETE' }),
  alerts: () => apiRequest('/candidates/me/alerts'),
  invitations: (params = {}) => apiRequest(`/candidates/me/invitations?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')))}`),
  invitation: (id) => apiRequest(`/candidates/me/invitations/${id}`),
  respondToInvitation: (id, status) => apiRequest(`/candidates/me/invitations/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  createAlert: (payload) => apiRequest('/candidates/me/alerts', { method: 'POST', body: JSON.stringify(payload) }),
  updateAlert: (id, payload) => apiRequest(`/candidates/me/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAlert: (id) => apiRequest(`/candidates/me/alerts/${id}`, { method: 'DELETE' }),
  downloadResume: (id, fileName) => downloadFile(`/candidates/resumes/${id}/download`, fileName)
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
  users: (params = {}) => apiRequest(`/admin/users?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')))}`),
  auditLogs: (params = {}) => apiRequest(`/admin/audit-logs?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value)))}`),
  jobs: (params = {}) => apiRequest(`/admin/jobs?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')))}`),
  moderateJob: (id, status, note, expectedUpdatedAt) => apiRequest(`/admin/jobs/${id}/moderation`, { method: 'PATCH', body: JSON.stringify({ status, note: note || undefined, expectedUpdatedAt }) }),
  companies: (params = {}) => apiRequest(`/admin/companies?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')))}`),
  company: (id) => apiRequest(`/admin/companies/${id}`),
  updateCompanyStatus: (id, status, reason, expectedUpdatedAt) => apiRequest(`/admin/companies/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason: reason || undefined, expectedUpdatedAt }) }),
  verificationRequests: (params = {}) => apiRequest(`/admin/verification-requests?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')))}`),
  decideVerification: (id, decision, reason, note) => apiRequest(`/admin/verification-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ decision, reason: reason || undefined, note: note || undefined }) }),
  reports: (params = {}) => apiRequest(`/admin/reports?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')))}`),
  report: (id) => apiRequest(`/admin/reports/${id}`),
  updateReportStatus: (id, status, note, expectedUpdatedAt) => apiRequest(`/admin/reports/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, note: note || undefined, expectedUpdatedAt }) }),
  reviews: (status = 'PENDING') => apiRequest(`/admin/reviews?status=${status}`),
  moderateReview: (id, status, note) => apiRequest(`/admin/reviews/${id}/moderation`, { method: 'PATCH', body: JSON.stringify({ status, note }) }),
  updateUserStatus: (id, status) => apiRequest(`/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
}

export const reportsApi = {
  create: (payload) => apiRequest('/reports', { method: 'POST', body: JSON.stringify(payload) })
}

export const recruiterApi = {
  stats: () => apiRequest('/recruiters/stats'),
  company: () => apiRequest('/companies/me'),
  verificationRequests: () => apiRequest('/companies/me/verification-requests'),
  requestVerification: (requestKey) => apiRequest('/companies/me/verification-requests', { method: 'POST', body: JSON.stringify({ requestKey }) }),
  updateCompany: (payload) => apiRequest('/companies/me', { method: 'PATCH', body: JSON.stringify(payload) }),
  uploadLogo: (file) => {
    const body = new FormData()
    body.append('file', file)
    return apiRequest('/companies/me/logo', { method: 'POST', body })
  },
  jobs: () => apiRequest('/jobs/me'),
  createJob: (payload) => apiRequest('/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  updateJob: (id, payload) => apiRequest(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  submitJob: (id) => apiRequest(`/jobs/${id}/submit`, { method: 'POST' }),
  suggestDescription: (payload) => apiRequest('/jobs/ai-description', { method: 'POST', body: JSON.stringify(payload) }),
  closeJob: (id) => apiRequest(`/jobs/${id}`, { method: 'DELETE' }),
  recommendations: (jobId, params = {}) => apiRequest(`/recommendations/jobs/${jobId}/candidates?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')))}`),
  skills: () => apiRequest('/candidates/skills'),
  applications: (params = {}) => {
    const query = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value)))
    return apiRequest(`/applications/managed?${query}`)
  },
  addApplicationNote: (id, content) => apiRequest(`/applications/${id}/notes`, { method: 'POST', body: JSON.stringify({ content }) }),
  deleteApplicationNote: (id, noteId) => apiRequest(`/applications/${id}/notes/${noteId}`, { method: 'DELETE' }),
  bulkRejectApplications: (applications, message) => apiRequest('/applications/managed/bulk-reject', {
    method: 'POST',
    body: JSON.stringify({
      applicationIds: applications.map((application) => application.id),
      expectedStatuses: Object.fromEntries(applications.map((application) => [application.id, application.status])),
      message
    })
  }),
  talent: (params = {}) => apiRequest(`/recruiters/talent?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')))}`),
  savedTalentSearches: () => apiRequest('/recruiters/talent/searches'),
  saveTalentSearch: (name, filters) => apiRequest('/recruiters/talent/searches', { method: 'POST', body: JSON.stringify({ name, filters }) }),
  deleteTalentSearch: (id) => apiRequest(`/recruiters/talent/searches/${id}`, { method: 'DELETE' }),
  inviteCandidate: (candidateId, jobId, message) => apiRequest('/recruiters/talent/invite', { method: 'POST', body: JSON.stringify({ candidateId, jobId, message }) }),
  funnel: (jobId) => apiRequest(`/recruiters/funnel/${jobId}`),
  application: (id) => apiRequest(`/applications/${id}`),
  createConversation: (applicationId) => apiRequest(`/conversations/applications/${applicationId}`, { method: 'POST' }),
  updateApplicationStatus: (id, status, note, expectedStatus) => apiRequest(`/applications/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note: note || undefined, expectedStatus })
  }),
  downloadResume: (id, fileName = 'CV-ung-vien') => downloadFile(`/candidates/resumes/${id}/download`, fileName)
}

export const recommendationApi = {
  jobs: (limit = 20) => apiRequest(`/recommendations/jobs?limit=${limit}`),
  chat: (message) => apiRequest('/ai/chat', { method: 'POST', body: JSON.stringify({ message }) })
}

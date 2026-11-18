const jobStatuses = ['DRAFT', 'PENDING', 'PUBLISHED', 'CLOSED', 'REJECTED']
const applicationStatuses = ['APPLIED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN']
const userRoles = ['CANDIDATE', 'RECRUITER', 'ADMIN']
const userStatuses = ['ACTIVE', 'INACTIVE', 'BANNED']
const userKeys = userRoles.flatMap((role) => userStatuses.map((status) => `${role}_${status}`))
const countFields = ['users', 'candidates', 'recruiters', 'companies', 'jobs', 'applications', 'pendingJobs']

const isCount = (value) => Number.isSafeInteger(value) && value >= 0
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isDateKey = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const validBucket = (bucket, allowed) => isPlainObject(bucket) && Object.entries(bucket).every(([key, value]) => allowed.includes(key) && isCount(value))

export function hasValidAdminKpis(stats) {
  return isPlainObject(stats) && countFields.every((key) => isCount(stats[key]))
}

export function buildAdminChartData(stats) {
  if (!isPlainObject(stats) || stats.groupBy !== 'day' || !Array.isArray(stats.series)) return { status: 'invalid' }
  if (typeof stats.from !== 'string' || typeof stats.to !== 'string') return { status: 'invalid' }
  const from = new Date(stats.from)
  const to = new Date(stats.to)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return { status: 'invalid' }
  const firstDay = from.toISOString().slice(0, 10)
  const lastDay = to.toISOString().slice(0, 10)
  const firstTime = Date.parse(`${firstDay}T00:00:00.000Z`)
  const lastTime = Date.parse(`${lastDay}T00:00:00.000Z`)
  const dayCount = Math.round((lastTime - firstTime) / 86400000) + 1
  if (dayCount < 1 || dayCount > 400) return { status: 'invalid' }

  const byDay = new Map()
  const valid = { users: true, jobs: true, applications: true }
  for (const entry of stats.series) {
    if (!isPlainObject(entry) || !isDateKey(entry.period) || entry.period < firstDay || entry.period > lastDay || byDay.has(entry.period)) return { status: 'invalid' }
    valid.users &&= validBucket(entry.users, userKeys)
    valid.jobs &&= validBucket(entry.jobs, jobStatuses)
    valid.applications &&= validBucket(entry.applications, applicationStatuses)
    byDay.set(entry.period, entry)
  }

  const donutCounts = Object.fromEntries(jobStatuses.map((status) => [status, 0]))
  const rows = []
  for (let index = 0; index < dayCount; index += 1) {
    const date = new Date(firstTime + index * 86400000).toISOString().slice(0, 10)
    const reported = byDay.get(date)
    const entry = { users: valid.users ? reported?.users || {} : {}, jobs: valid.jobs ? reported?.jobs || {} : {}, applications: valid.applications ? reported?.applications || {} : {} }
    const sum = (bucket) => Object.values(bucket).reduce((total, count) => total + count, 0)
    const byRole = (role) => Object.entries(entry.users).reduce((total, [key, count]) => total + (key.startsWith(`${role}_`) ? count : 0), 0)
    for (const status of jobStatuses) donutCounts[status] += entry.jobs[status] || 0
    rows.push({ date, jobs: sum(entry.jobs), applications: sum(entry.applications), users: sum(entry.users), candidates: byRole('CANDIDATE'), recruiters: byRole('RECRUITER'), admins: byRole('ADMIN') })
  }

  const totals = {
    jobs: rows.reduce((total, row) => total + row.jobs, 0),
    applications: rows.reduce((total, row) => total + row.applications, 0),
    users: rows.reduce((total, row) => total + row.users, 0)
  }
  if (rows.some((row) => [row.jobs, row.applications, row.users, row.candidates, row.recruiters, row.admins].some((value) => !isCount(value)))) {
    valid.users &&= rows.every((row) => [row.users, row.candidates, row.recruiters, row.admins].every(isCount))
    valid.jobs &&= rows.every((row) => isCount(row.jobs))
    valid.applications &&= rows.every((row) => isCount(row.applications))
  }
  valid.jobs &&= Object.values(donutCounts).every(isCount) && isCount(totals.jobs)
  valid.applications &&= isCount(totals.applications)
  valid.users &&= isCount(totals.users)
  const donut = jobStatuses.map((status) => ({ status, count: donutCounts[status] })).filter((item) => item.count > 0)
  return { status: 'ready', rows, donut, totals, charts: { activity: valid.jobs && valid.applications ? 'ready' : 'invalid', accounts: valid.users ? 'ready' : 'invalid', status: valid.jobs ? 'ready' : 'invalid' }, reason: stats.series.length ? 'reported' : 'empty' }
}

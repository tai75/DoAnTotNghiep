import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAdminChartData, hasValidAdminKpis } from './adminChartData.js'

const sample = () => ({
  users: 50, candidates: 30, recruiters: 15, companies: 12, jobs: 20, applications: 42, pendingJobs: 2,
  from: '2026-10-31T00:00:00.000Z', to: '2026-11-03T23:59:59.999Z', groupBy: 'day',
  series: [
    { period: '2026-10-31', users: { CANDIDATE_ACTIVE: 2, RECRUITER_ACTIVE: 1 }, jobs: { DRAFT: 1, PUBLISHED: 2 }, applications: { APPLIED: 3 } },
    { period: '2026-11-01', users: { CANDIDATE_ACTIVE: 1 }, jobs: { PENDING: 1, REJECTED: 1 }, applications: { APPLIED: 2, WITHDRAWN: 1 } },
    { period: '2026-11-03', users: { RECRUITER_ACTIVE: 2 }, jobs: { PUBLISHED: 3 }, applications: { APPLIED: 1 } }
  ]
})

test('cộng nhiều trạng thái đúng một lần, giữ ngày trống và ranh giới tháng', () => {
  const result = buildAdminChartData(sample())
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.totals, { jobs: 8, applications: 7, users: 6 })
  assert.deepEqual(result.rows.map((row) => row.date), ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'])
  assert.deepEqual(result.rows[2], { date: '2026-11-02', jobs: 0, applications: 0, users: 0, candidates: 0, recruiters: 0, admins: 0 })
  assert.deepEqual(result.donut, [{ status: 'DRAFT', count: 1 }, { status: 'PENDING', count: 1 }, { status: 'PUBLISHED', count: 5 }, { status: 'REJECTED', count: 1 }])
})

test('phân biệt không có sự kiện và API trả toàn số không', () => {
  const empty = buildAdminChartData({ ...sample(), series: [] })
  const zero = buildAdminChartData({ ...sample(), series: [{ period: '2026-11-01', users: {}, jobs: {}, applications: {} }] })
  assert.equal(empty.reason, 'empty')
  assert.equal(zero.reason, 'reported')
  assert.equal(empty.totals.jobs + empty.totals.applications + empty.totals.users, 0)
  assert.equal(zero.donut.length, 0)
})

test('một trạng thái tạo một lát donut với mẫu số đúng trong kỳ', () => {
  const result = buildAdminChartData({ ...sample(), series: [{ period: '2026-11-01', users: {}, jobs: { PUBLISHED: 3 }, applications: {} }] })
  assert.deepEqual(result.donut, [{ status: 'PUBLISHED', count: 3 }])
  assert.equal(result.totals.jobs, 3)
})

test('cô lập nhóm dữ liệu thiếu, sai kiểu, âm và trạng thái lạ theo biểu đồ', () => {
  const base = sample()
  for (const [entry, expected] of [
    [{ ...base.series[0], jobs: undefined }, { activity: 'invalid', accounts: 'ready', status: 'invalid' }],
    [{ ...base.series[0], users: { CANDIDATE_ACTIVE: '2' } }, { activity: 'ready', accounts: 'invalid', status: 'ready' }],
    [{ ...base.series[0], users: { CANDIDATE_ACTIVE: null } }, { activity: 'ready', accounts: 'invalid', status: 'ready' }],
    [{ ...base.series[0], users: { CANDIDATE_ACTIVE: Number.NaN } }, { activity: 'ready', accounts: 'invalid', status: 'ready' }],
    [{ ...base.series[0], users: { CANDIDATE_ACTIVE: Infinity } }, { activity: 'ready', accounts: 'invalid', status: 'ready' }],
    [{ ...base.series[0], applications: { APPLIED: -1 } }, { activity: 'invalid', accounts: 'ready', status: 'ready' }],
    [{ ...base.series[0], jobs: { UNKNOWN: 1 } }, { activity: 'invalid', accounts: 'ready', status: 'invalid' }]
  ]) assert.deepEqual(buildAdminChartData({ ...base, series: [entry] }).charts, expected)
  assert.equal(buildAdminChartData({ ...base, series: [{ ...base.series[0], period: '2026-02-30' }] }).status, 'invalid')
  assert.equal(buildAdminChartData({ ...base, series: [null] }).status, 'invalid')
  assert.equal(buildAdminChartData({ ...base, series: [base.series[0], base.series[0]] }).status, 'invalid')
})

test('từ chối thiếu khoảng thời gian và KPI sai định dạng', () => {
  assert.equal(buildAdminChartData({ ...sample(), from: null }).status, 'invalid')
  assert.equal(buildAdminChartData({ ...sample(), series: undefined }).status, 'invalid')
  assert.equal(hasValidAdminKpis(sample()), true)
  assert.equal(hasValidAdminKpis({ ...sample(), users: null }), false)
  assert.equal(hasValidAdminKpis({ ...sample(), pendingJobs: -1 }), false)
})

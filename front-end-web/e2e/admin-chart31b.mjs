import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const [phase, artifactPath, onlyScenario, onlyWidth] = process.argv.slice(2)
if (!['before', 'after', 'verify'].includes(phase) || !artifactPath) throw new Error('Dùng: node e2e/admin-chart31b.mjs before|after|verify <thư-mục>')
const root = path.resolve(artifactPath)
await fs.mkdir(path.join(root, phase), { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
const base = 'http://127.0.0.1:5188'
const sizes = phase === 'before' ? [{ width: 390, height: 844 }, { width: 1440, height: 900 }]
  : [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]
const cases = phase === 'before' ? ['empty', 'valid'] : phase === 'after' ? ['empty', 'valid', 'zero', 'missing', 'error500', 'loading']
  : ['empty', 'valid', 'zero', 'missing', 'wrongType', 'invalidKpi', 'error403', 'error500', 'refreshError', 'oneStatus', 'loading', 'touch']

const baseStats = {
  users: 50, candidates: 30, recruiters: 15, companies: 12, jobs: 20, applications: 42, pendingJobs: 2,
  from: '2026-10-30T00:00:00.000Z', to: '2026-11-04T23:59:59.999Z', groupBy: 'day',
  series: [
    { period: '2026-10-31', users: { CANDIDATE_ACTIVE: 2, RECRUITER_ACTIVE: 1 }, jobs: { DRAFT: 1, PUBLISHED: 2 }, applications: { APPLIED: 3 } },
    { period: '2026-11-01', users: { CANDIDATE_ACTIVE: 1 }, jobs: { PENDING: 1, REJECTED: 1 }, applications: { APPLIED: 2, WITHDRAWN: 1 } },
    { period: '2026-11-03', users: { RECRUITER_ACTIVE: 2 }, jobs: { PUBLISHED: 3 }, applications: { APPLIED: 1 } }
  ]
}
const blankStats = { users: 0, candidates: 0, recruiters: 0, companies: 0, jobs: 0, applications: 0, pendingJobs: 0, from: baseStats.from, to: baseStats.to, groupBy: 'day', series: [] }
const statsFor = (name) => name === 'empty' ? blankStats
  : name === 'zero' ? { ...blankStats, series: [{ period: '2026-11-01', users: {}, jobs: {}, applications: {} }] }
  : name === 'missing' ? { ...baseStats, series: [{ period: '2026-11-01', users: {}, applications: {} }] }
  : name === 'wrongType' ? { ...baseStats, series: [{ period: '2026-11-01', users: { CANDIDATE_ACTIVE: 'hai' }, jobs: {}, applications: {} }] }
  : name === 'invalidKpi' ? { ...baseStats, users: null }
  : name === 'oneStatus' ? { ...baseStats, series: [{ period: '2026-11-01', users: {}, jobs: { PUBLISHED: 3 }, applications: {} }] }
  : baseStats
const results = []

try {
  for (const viewport of sizes) for (const scenario of cases) {
    if (scenario === 'touch' && viewport.width > 390) continue
    if ((onlyScenario && onlyScenario !== '*' && scenario !== onlyScenario) || (onlyWidth && viewport.width !== Number(onlyWidth))) continue
    const record = { phase, scenario, route: '/admin?section=overview', role: 'ADMIN', viewport, environment: 'Chrome headless + Vite + API mock; không dùng backend/database thật', status: 'PASS' }
    const context = await browser.newContext({ viewport, locale: 'vi-VN', hasTouch: scenario === 'touch' })
    let refreshRequested = false
    await context.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/api/admin/stats' && scenario === 'loading') await new Promise((resolve) => setTimeout(resolve, 2500))
      const status = pathname === '/api/admin/stats' && scenario === 'error403' ? 403 : pathname === '/api/admin/stats' && (scenario === 'error500' || (scenario === 'refreshError' && refreshRequested)) ? 500 : 200
      const data = pathname === '/api/auth/refresh' ? { token: 'mock', user: { id: 1, role: 'ADMIN', fullName: 'Quản trị viên kiểm thử' } }
        : pathname === '/api/admin/stats' ? statsFor(scenario)
          : pathname === '/api/admin/jobs' || pathname === '/api/admin/users' ? { items: [], pagination: { page: 1, total: 0, totalPages: 0 } }
            : pathname === '/api/notifications' ? { items: [], unreadCount: 0 }
              : {}
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { success: true, data } : { success: false, message: status === 403 ? 'Bạn không có quyền truy cập.' : 'Không tải được thống kê.' }) })
    })
    const page = await context.newPage()
    try {
      await page.goto(base + record.route, { waitUntil: scenario === 'loading' ? 'domcontentloaded' : 'networkidle' })
      if (scenario === 'loading') await page.locator('.admin-skeletons').waitFor({ state: 'visible' })
      if (scenario !== 'loading') await page.evaluate(() => document.fonts.ready)
      if (phase !== 'verify') {
        const file = `admin-overview-${scenario}-${viewport.width}x${viewport.height}-${phase.toUpperCase()}.png`
        await page.screenshot({ path: path.join(root, phase, file), fullPage: true })
        record.file = `${phase}/${file}`
      }
      if (phase === 'verify') {
        record.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
        if (record.horizontalOverflow) throw new Error('Tràn ngang trang')
        const charts = page.locator('.recharts-wrapper')
        const cards = page.locator('.stat-card')
        const empty = page.locator('.admin-chart-empty')
        if (['valid', 'touch', 'refreshError'].includes(scenario)) {
          if (await cards.count() !== 7 || await charts.count() !== 3) throw new Error('Thiếu KPI hoặc biểu đồ có dữ liệu')
          if (await page.locator('.recharts-pie-sector').count() !== 4) throw new Error('Donut thiếu trạng thái')
          if (await page.locator('.admin-chart-table').count() !== 3 || await page.locator('.admin-chart-table caption').count() !== 3) throw new Error('Thiếu bảng số liệu có nhãn')
          await page.locator('.admin-chart-table summary').first().click()
          if (!await page.locator('.admin-chart-table').first().locator('tbody tr').filter({ hasText: '2026-11-02' }).count()) throw new Error('Thiếu ngày không có bản ghi')
          await page.locator('.admin-chart-card--status summary').click()
          if (!/5\s+62,5%/.test(await page.locator('.admin-chart-card--status tbody tr').filter({ hasText: 'Đã đăng' }).innerText())) throw new Error('Tỷ lệ donut sai')
          const tableAccess = await page.locator('.admin-chart-table-scroll').first().evaluate((element) => element.tabIndex === 0 && element.getAttribute('role') === 'region')
          if (!tableAccess) throw new Error('Bảng số liệu không thể cuộn bằng bàn phím')
        }
        if (scenario === 'refreshError') {
          refreshRequested = true
          await page.getByRole('button', { name: 'Làm mới' }).click()
          await page.locator('.admin-alert').waitFor({ state: 'visible' })
          if (await cards.count() || await charts.count()) throw new Error('Lần tải lại lỗi vẫn hiện số liệu cũ')
        }
        if (scenario === 'touch') {
          await page.locator('.recharts-bar-rectangle').first().tap({ force: true })
          await page.locator('.recharts-tooltip-wrapper').first().waitFor({ state: 'visible', timeout: 3000 })
        }
        if (['empty', 'zero'].includes(scenario) && (await charts.count() !== 0 || await empty.count() !== 3)) throw new Error('Trạng thái rỗng/toàn số 0 vẽ biểu đồ giả')
        if (scenario === 'missing' && (await page.locator('.admin-chart-invalid-message').count() !== 2 || await charts.count() !== 0 || await empty.count() !== 1)) throw new Error('Thiếu nhóm tin không được cô lập đúng')
        if (scenario === 'wrongType' && (await page.locator('.admin-chart-invalid-message').count() !== 1 || await charts.count() !== 0 || await empty.count() !== 2)) throw new Error('Nhóm tài khoản sai không được cô lập đúng')
        if (scenario === 'invalidKpi' && (await page.locator('.admin-alert').count() !== 1 || await cards.count() !== 0)) throw new Error('KPI sai vẫn được hiển thị')
        if (['error403', 'error500'].includes(scenario) && (await page.locator('.admin-alert').count() !== 1 || await cards.count() !== 0 || await charts.count() !== 0)) throw new Error('Lỗi API còn hiển thị số liệu cũ')
        if (scenario === 'loading' && (await page.locator('.admin-skeletons').count() !== 1 || await cards.count() !== 0 || await charts.count() !== 0)) throw new Error('Loading hiển thị dữ liệu cũ hoặc rỗng')
        if (scenario === 'oneStatus' && (await page.locator('.recharts-pie-sector').count() !== 1 || await empty.count() !== 1)) throw new Error('Donut một trạng thái sai')
        if (/\bNaN\b|\bundefined\b|\bnull\b/.test(await page.locator('.admin-main').innerText())) throw new Error('Giao diện chứa giá trị không hợp lệ')
        if (viewport.width <= 768) {
          const navClearance = await page.evaluate(() => {
            const nav = document.querySelector('.app-mobile-nav')
            const content = document.querySelector('.app-content')
            return !nav || getComputedStyle(nav).display === 'none' || parseFloat(getComputedStyle(content).paddingBottom) >= nav.getBoundingClientRect().height
          })
          if (!navClearance) throw new Error('Thanh điều hướng có thể che nội dung cuối')
        }
      }
    } catch (error) { record.status = 'FAIL'; record.error = error.message }
    results.push(record)
    await context.close()
  }
} finally {
  await browser.close()
  await fs.writeFile(path.join(root, `${phase}-results.json`), JSON.stringify({ phase, results }, null, 2), 'utf8')
  console.log(JSON.stringify({ phase, cases: results.length, passed: results.filter((item) => item.status === 'PASS').length, failed: results.filter((item) => item.status === 'FAIL') }, null, 2))
  if (results.some((item) => item.status === 'FAIL')) process.exitCode = 1
}

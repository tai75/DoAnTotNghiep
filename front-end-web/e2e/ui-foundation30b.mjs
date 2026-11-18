import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const [phase, artifactPath] = process.argv.slice(2)
if (!['before', 'after', 'verify'].includes(phase) || !artifactPath) throw new Error('Usage: node e2e/ui-foundation30b.mjs before|after|verify <artifact-dir>')
const root = path.resolve(artifactPath)
await fs.mkdir(path.join(root, phase), { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
const base = 'http://127.0.0.1:5188'
const widths = phase === 'verify' ? [360, 390, 768, 1024, 1440] : [390, 1440]
const cases = [
  { name: 'dashboard-recruiter-empty', route: '/recruiter?section=dashboard', role: 'RECRUITER' },
  { name: 'tim-viec-empty', route: '/jobs', role: 'GUEST' },
  { name: 'ho-so-candidate', route: '/profile', role: 'CANDIDATE' },
  { name: 'form-recruiter', route: '/recruiter?section=jobs', role: 'RECRUITER' },
  { name: 'dashboard-admin', route: '/admin', role: 'ADMIN' }
]
if (phase === 'verify') cases.push(
  { name: 'dashboard-recruiter-data', route: '/recruiter?section=dashboard', role: 'RECRUITER', populated: true },
  { name: 'tim-viec-data', route: '/jobs/7', role: 'GUEST', populated: true },
  { name: 'trang-chu', route: '/', role: 'GUEST' },
  { name: 'chat-candidate', route: '/jobs', role: 'CANDIDATE' }
)
const job = { id: 7, title: 'Kỹ sư phần mềm', status: 'PUBLISHED', location: 'Hà Nội', description: 'Công việc phát triển phần mềm.', createdAt: '2026-11-16T00:00:00.000Z', company: { id: 3, name: 'Doanh nghiệp kiểm thử' }, skills: [], _count: { applications: 2 } }
const results = []

async function openCase(item, width) {
  const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : 900 }, locale: 'vi-VN' })
  await context.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const data = pathname === '/api/auth/refresh' ? (item.role === 'GUEST' ? null : { token: 'mock', user: { id: 1, role: item.role, fullName: 'Người dùng kiểm thử' } })
      : pathname === '/api/notifications' ? { items: [], unreadCount: 0 }
      : pathname === '/api/conversations/unread-count' ? { count: 0 }
      : pathname === '/api/ai/consents' ? { policyVersion: 'test', items: [{ scope: 'AI_CHAT', policyVersion: 'test', active: true, withdrawalStatus: 'NONE' }] }
      : pathname === '/api/companies/me' ? { id: 3, name: 'Doanh nghiệp kiểm thử', verificationStatus: 'VERIFIED' }
      : pathname === '/api/jobs/me' ? []
      : pathname === '/api/candidates/skills' || pathname === '/api/candidates/me/saved-jobs' || pathname === '/api/candidates/me/applications' ? []
      : pathname === '/api/candidates/me' ? { user: { fullName: 'Ứng viên kiểm thử' }, skills: [], resumes: [], educations: [], experiences: [], projects: [] }
      : pathname === '/api/candidates/me/completeness' ? { percentage: 0, completed: 0, total: 0, missing: [] }
      : pathname === '/api/recruiters/stats' ? { jobsByStatus: item.populated ? { PUBLISHED: 1 } : {}, applicationsTotal: item.populated ? 3 : 0, applicationsByStatus: item.populated ? { NEW: 2, REVIEWING: 1 } : {}, applicationsByJob: item.populated ? [{ title: job.title, count: 3 }] : [], timeline: item.populated ? [{ date: '2026-11-16', count: 3 }] : [] }
      : pathname === '/api/jobs/7' ? job
      : pathname === '/api/jobs' ? { items: item.populated ? [job] : [], pagination: { total: item.populated ? 1 : 0, totalPages: 1 } }
      : pathname === '/api/companies' ? { items: [], pagination: { total: 0, totalPages: 1 } }
      : pathname === '/api/admin/stats' ? { users: 0, candidates: 0, recruiters: 0, companies: 0, jobs: 0, applications: 0, pendingJobs: 0 }
      : pathname.startsWith('/api/admin/') || pathname === '/api/applications/managed' ? { items: [], pagination: null }
      : {}
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
  })
  return { context, page: await context.newPage() }
}

try {
  for (const width of widths) for (const item of cases) {
    const record = { phase, case: item.name, route: item.route, role: item.role, width, data: item.populated ? 'API mock: có dữ liệu' : 'API mock: rỗng', status: 'PASS' }
    const { context, page } = await openCase(item, width)
    try {
      await page.goto(base + item.route, { waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      record.measure = await page.evaluate(() => {
        const rect = (selector) => { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom } }
        const nav = document.querySelector('.app-mobile-nav')
        const last = document.querySelector('.app-content')?.lastElementChild
        const safeArea = getComputedStyle(nav || document.body).paddingBottom
        return { title: document.title, font: getComputedStyle(document.body).fontFamily, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, nav: rect('.app-mobile-nav'), contentPaddingBottom: document.querySelector('.app-content') ? parseFloat(getComputedStyle(document.querySelector('.app-content')).paddingBottom) : null, appContent: rect('.app-content'), last: last?.tagName, safeArea, detail: rect('.public-job-detail-column'), chartCount: document.querySelectorAll('.recharts-wrapper').length, chartEmptyCount: document.querySelectorAll('.recruiter-chart-empty').length, emptyStateCount: document.querySelectorAll('.ui-empty-state').length, headerLabels: [...document.querySelectorAll('.app-actions a, .app-actions button, .app-menu-toggle, .app-workspace-toggle')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => ({ text: el.textContent.trim().slice(0, 30), aria: el.getAttribute('aria-label'), title: el.getAttribute('title') })) }
      })
      if (phase !== 'verify' && ['dashboard-recruiter-empty', 'tim-viec-empty', 'ho-so-candidate', 'form-recruiter'].includes(item.name)) {
        const file = `${item.name}-${width}.png`
        await page.screenshot({ path: path.join(root, phase, file), fullPage: true })
        record.file = `${phase}/${file}`
      }
      if (phase === 'verify') {
        if (record.measure.horizontalOverflow) throw new Error('Tràn ngang toàn trang')
        if (!record.measure.font.includes('Be Vietnam Pro')) throw new Error('Font chính thay đổi')
        if (record.measure.nav?.height > 0 && record.measure.contentPaddingBottom < record.measure.nav.height + 2) throw new Error('Bottom nav có thể che phần cuối nội dung')
        if (record.measure.headerLabels.some((control) => !control.aria && !control.title && control.text.length < 3)) throw new Error('Icon Header thiếu nhãn')
        if (item.name === 'dashboard-recruiter-empty' && (record.measure.chartCount || record.measure.chartEmptyCount !== 3)) throw new Error('Biểu đồ rỗng chưa được thay')
        if (item.name === 'dashboard-recruiter-data' && record.measure.chartCount !== 3) throw new Error('Biểu đồ có dữ liệu bị mất')
        if (item.name === 'tim-viec-empty' && width >= 1024 && record.measure.detail?.height > 300) throw new Error('Empty state tìm việc còn quá lớn')
        if (item.name === 'tim-viec-empty' && !await page.getByText('Hiện chưa có việc làm', { exact: true }).count()) throw new Error('Thông báo danh sách rỗng không phù hợp')
        if (item.name === 'tim-viec-data' && width >= 1024 && record.measure.chartEmptyCount) throw new Error('Kiểm tra dữ liệu trang việc làm thất bại')
        if (item.name === 'tim-viec-data' && width >= 1024 && await page.locator('.public-jobs-layout').evaluate((el) => getComputedStyle(el).display) !== 'grid') throw new Error('Bố cục hai cột bị mất')
        if (item.name === 'trang-chu' && !await page.locator('.public-footer').count()) throw new Error('Footer không hiện trên trang chủ')
        if (item.name === 'chat-candidate') {
          await page.getByRole('button', { name: 'Mở trợ lý AI Job Connect' }).click()
          await page.locator('.chat-panel').waitFor({ state: 'visible', timeout: 10000 })
        }
        if (width <= 390 && item.role !== 'GUEST') {
          await page.locator('.app-search input').focus()
          record.focusHidesNav = await page.locator('.app-mobile-nav').evaluate((el) => getComputedStyle(el).display === 'none')
          if (!record.focusHidesNav) throw new Error('Bottom nav còn hiện khi focus vào ô nhập')
        }
      }
    } catch (error) { record.status = 'FAIL'; record.error = error.message }
    results.push(record)
    await context.close()
  }
} finally {
  await browser.close()
  await fs.writeFile(path.join(root, `${phase}-manifest.json`), JSON.stringify({ environment: 'Chrome headless + Vite preview + API mock; không dùng backend/database/Gemini/SMTP', phase, results }, null, 2), 'utf8')
  console.log(JSON.stringify({ phase, cases: results.length, passed: results.filter((r) => r.status === 'PASS').length, failed: results.filter((r) => r.status !== 'PASS').map((r) => ({ case: r.case, width: r.width, error: r.error })) }, null, 2))
  if (results.some((r) => r.status !== 'PASS')) process.exitCode = 1
}

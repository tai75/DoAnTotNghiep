import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const [phase, artifactPath] = process.argv.slice(2)
if (!['before', 'after', 'verify'].includes(phase) || !artifactPath) throw new Error('Usage: node e2e/typography30a.mjs before|after|verify <artifact-dir>')
const artifactDir = path.resolve(artifactPath)
const outputDir = path.join(artifactDir, phase)
await fs.mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
const baseURL = 'http://127.0.0.1:5188'
const records = []
const viewports = phase === 'verify' ? [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 900 }, { width: 1024, height: 900 }, { width: 1440, height: 900 }] : [{ width: 1440, height: 900 }, { width: 390, height: 844 }]
const pages = [
  { name: 'trang-chu', route: '/', role: 'GUEST' },
  { name: 'dang-nhap', route: '/login', role: 'GUEST' },
  { name: 'ho-so-candidate', route: '/profile', role: 'CANDIDATE' },
  { name: 'dashboard-recruiter', route: '/recruiter?section=dashboard', role: 'RECRUITER' },
  { name: 'dashboard-admin', route: '/admin', role: 'ADMIN' },
  { name: 'chat-dong', route: '/jobs', role: 'CANDIDATE' },
  { name: 'chat-mo', route: '/jobs', role: 'CANDIDATE', openChat: true }
]
if (phase === 'verify') pages.push(
  { name: 'viec-lam', route: '/jobs', role: 'GUEST' },
  { name: 'doanh-nghiep', route: '/companies', role: 'GUEST' },
  { name: 'bang-recruiter', route: '/recruiter?section=jobs', role: 'RECRUITER' },
  { name: 'bang-admin', route: '/admin?section=jobs', role: 'ADMIN' }
)
const testJob = { id: 1, title: 'Kỹ sư phần mềm', status: 'DRAFT', updatedAt: '2026-11-16T00:00:00.000Z', location: 'Hà Nội', _count: { applications: 0 }, company: { id: 1, name: 'Doanh nghiệp kiểm thử' } }

async function createPage(role, viewport) {
  const context = await browser.newContext({ viewport, locale: 'vi-VN' })
  await context.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const data = pathname === '/api/auth/refresh'
      ? (role === 'GUEST' ? null : { token: 'mock', user: { id: 1, role, fullName: 'Người dùng kiểm thử' } })
      : pathname === '/api/notifications' ? { items: [], unreadCount: 0 }
      : pathname === '/api/conversations/unread-count' ? { count: 0 }
      : pathname === '/api/ai/consents' ? { policyVersion: 'test', items: [{ scope: 'AI_CHAT', policyVersion: 'test', active: true, withdrawalStatus: 'NONE' }] }
      : pathname === '/api/companies/me' ? { id: 1, name: 'Doanh nghiệp kiểm thử', verificationStatus: phase === 'verify' ? 'VERIFIED' : 'PENDING' }
      : pathname === '/api/jobs/me' ? (phase === 'verify' ? [testJob] : [])
      : pathname === '/api/candidates/skills' || pathname === '/api/candidates/me/saved-jobs' || pathname === '/api/candidates/me/applications' ? []
      : pathname === '/api/candidates/me' ? { user: { fullName: 'Ứng viên kiểm thử' }, skills: [], resumes: [], educations: [], experiences: [], projects: [] }
      : pathname === '/api/candidates/me/completeness' ? { percentage: 0, completed: 0, total: 0, missing: [] }
      : pathname === '/api/recruiters/stats' ? { jobsByStatus: phase === 'verify' ? { DRAFT: 1 } : {}, applicationsTotal: 0, applicationsByStatus: {}, applicationsByJob: phase === 'verify' ? [{ title: 'Kỹ sư phần mềm', count: 0 }] : [], timeline: phase === 'verify' ? [{ date: '2026-11-16', count: 0 }] : [] }
      : pathname === '/api/jobs' || pathname === '/api/companies' ? { items: [], pagination: { total: 0, totalPages: 1 } }
      : pathname === '/api/admin/stats' ? { users: 0, candidates: 0, recruiters: 0, companies: 0, jobs: 0, applications: 0, pendingJobs: 0 }
      : pathname === '/api/admin/jobs' ? { items: phase === 'verify' ? [testJob] : [], pagination: null }
      : pathname.startsWith('/api/admin/') || pathname === '/api/applications/managed' ? { items: [], pagination: null }
      : {}
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
  })
  return { context, page: await context.newPage() }
}

try {
  for (const viewport of viewports) for (const item of pages) {
    const { context, page } = await createPage(item.role, viewport)
    const file = `${item.name}-${viewport.width}x${viewport.height}.png`
    const record = { page: item.name, route: item.route, viewport, role: item.role, data: phase === 'verify' ? 'mock API; sample rows for layout checks only; no database data' : 'mock API; empty state; no database data', phase, status: 'PASS' }
    if (phase !== 'verify') record.file = `${phase}/${file}`
    const failedFonts = []
    page.on('requestfailed', (request) => { if (/fonts\.googleapis|fonts\.gstatic/.test(request.url())) failedFonts.push({ url: request.url(), error: request.failure()?.errorText }) })
    page.on('response', (response) => { if (/fonts\.googleapis|fonts\.gstatic/.test(response.url()) && !response.ok()) failedFonts.push({ url: response.url(), status: response.status() }) })
    try {
      await page.goto(baseURL + item.route, { waitUntil: 'networkidle' })
      if (item.openChat) {
        await page.getByRole('button', { name: 'Mở trợ lý AI Job Connect' }).click()
        await page.locator('.chat-panel').waitFor()
      }
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 4000))]))
      record.measured = await page.evaluate(() => {
        const sample = (selector) => { const element = document.querySelector(selector); if (!element) return null; const style = getComputedStyle(element); return { family: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight } }
        const headings = [...document.querySelectorAll('h1, h2, h3')].filter((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 }).map((element) => ({ text: element.textContent.trim().slice(0, 80), clipped: element.scrollWidth > element.clientWidth + 1 && ['hidden', 'clip'].includes(getComputedStyle(element).overflowX) }))
        return {
          lang: document.documentElement.lang,
          fontFaces: [...document.fonts].filter((face) => face.family.includes('Be Vietnam Pro')).map((face) => ({ family: face.family, weight: face.weight, status: face.status })),
          sample: { body: sample('body'), header: sample('.app-header, .auth-heading'), footer: sample('.public-footer'), pageHeading: sample('main h1, .auth-heading h2'), button: sample('main button, .auth-form button'), input: sample('main input, .auth-form input'), table: sample('table'), chart: sample('.recharts-wrapper text'), chat: sample('.chat-panel') },
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          clippedHeadings: headings.filter((heading) => heading.clipped),
          hasVietnamese: /[ăâđêôơưĂÂĐÊÔƠƯ]/.test(document.body.innerText),
          overflowingControls: [...document.querySelectorAll('button, input, select, textarea, nav a, .data-table-wrap')].filter((element) => {
            if (element.closest('.recruiter-sidebar, .admin-sidebar, .app-mobile-drawer')) return false
            const scrollRegion = element.closest('.profile-tabs, .data-table-wrap, .ui-tabs')
            if (scrollRegion && scrollRegion !== element) return false
            const rect = element.getBoundingClientRect()
            if (rect.width <= 0 || rect.height <= 0 || rect.right < 0 || rect.left > innerWidth) return false
            return rect.left < -1 || rect.right > innerWidth + 1
          }).slice(0, 10).map((element) => ({ tag: element.tagName, text: element.textContent.trim().slice(0, 40) })),
          scrollRegions: [...document.querySelectorAll('.profile-tabs, .data-table-wrap, .ui-tabs')].filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.className)
        }
      })
      record.fontErrors = failedFonts
      if (phase === 'verify') {
        const measured = record.measured
        assert.equal(measured.lang, 'vi')
        assert(measured.hasVietnamese, 'Missing Vietnamese text')
        assert(measured.fontFaces.some((face) => face.status === 'loaded'), 'Be Vietnam Pro font face not loaded')
        for (const [name, style] of Object.entries(measured.sample)) if (style) assert(style.family.includes('Be Vietnam Pro'), `${name} uses ${style.family}`)
        assert.equal(failedFonts.length, 0, 'Font loading error')
        assert.equal(measured.horizontalOverflow, false, 'Horizontal document overflow')
        assert.equal(measured.clippedHeadings.length, 0, 'Clipped headings')
        assert.equal(measured.overflowingControls.length, 0, 'Controls outside viewport')
      } else await page.screenshot({ path: path.join(outputDir, file), fullPage: true })
    } catch (error) { record.status = 'BLOCKED'; record.reason = error.message; delete record.file }
    records.push(record)
    await context.close()
  }
} finally {
  await browser.close()
  await fs.writeFile(path.join(artifactDir, `${phase}-manifest.json`), JSON.stringify({ environment: 'Chrome headless + Vite preview + API mock; no database, Gemini or SMTP', phase, records }, null, 2), 'utf8')
  console.log(JSON.stringify({ phase, artifactDir, captures: records.length, passed: records.filter((record) => record.status === 'PASS').length, fontErrors: records.reduce((count, record) => count + (record.fontErrors?.length || 0), 0) }, null, 2))
  if (records.some((record) => record.status !== 'PASS')) process.exitCode = 1
}

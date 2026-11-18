import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const root = path.resolve(process.argv[2] || '../artifacts/ADMIN-CHART31B-completion')
await fs.mkdir(root, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
const base = 'http://127.0.0.1:5188/admin?section=overview'
const viewports = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]
const stats = {
  users: 50, candidates: 30, recruiters: 15, companies: 12, jobs: 20, applications: 42, pendingJobs: 0,
  from: '2026-10-30T00:00:00.000Z', to: '2026-11-04T23:59:59.999Z', groupBy: 'day',
  series: [
    { period: '2026-10-31', users: { CANDIDATE_ACTIVE: 2, RECRUITER_ACTIVE: 1 }, jobs: { DRAFT: 1, PUBLISHED: 2 }, applications: { APPLIED: 3 } },
    { period: '2026-11-01', users: { CANDIDATE_ACTIVE: 1 }, jobs: { PENDING: 1, REJECTED: 1 }, applications: { APPLIED: 2, WITHDRAWN: 1 } },
    { period: '2026-11-03', users: { RECRUITER_ACTIVE: 2 }, jobs: { PUBLISHED: 3 }, applications: { APPLIED: 1 } }
  ]
}
const blank = { ...stats, series: [] }
const missing = { ...stats, series: [{ period: '2026-11-01', users: { CANDIDATE_ACTIVE: 1 }, applications: { APPLIED: 2 } }] }
const cases = [
  ...viewports.map((viewport) => ({ name: 'navigation-scroll', viewport })),
  ...[390, 1440].flatMap((width) => ['loading-valid', 'loading-zero', 'loading-invalid', 'loading-error', 'retry-valid'].map((name) => ({ name, viewport: viewports.find((item) => item.width === width) })))
]
const results = []

try {
  for (const testCase of cases) {
    const { name, viewport } = testCase
    const record = { name, viewport, route: '/admin?section=overview', role: 'ADMIN', environment: 'Chrome headless + Vite localhost + API mock', status: 'PASS' }
    const context = await browser.newContext({ viewport, locale: 'vi-VN' })
    let retry = false
    await context.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/api/admin/stats' && name.startsWith('loading-')) await new Promise((resolve) => setTimeout(resolve, 1500))
      const status = pathname === '/api/admin/stats' && (name === 'loading-error' || name === 'retry-valid' && !retry) ? 500 : 200
      const data = pathname === '/api/auth/refresh' ? { token: 'mock', user: { id: 1, role: 'ADMIN', fullName: 'Quản trị viên kiểm thử' } }
        : pathname === '/api/admin/stats' ? name === 'loading-zero' ? blank : name === 'loading-invalid' ? missing : stats
          : pathname === '/api/admin/jobs' || pathname === '/api/admin/users' ? { items: [], pagination: { page: 1, total: 0, totalPages: 0 } }
            : pathname === '/api/notifications' ? { items: [], unreadCount: 0 } : {}
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { success: true, data } : { success: false, message: 'Không tải được thống kê.' }) })
    })
    const page = await context.newPage()
    try {
      await page.goto(base, { waitUntil: name.startsWith('loading-') ? 'domcontentloaded' : 'networkidle' })
      if (name.startsWith('loading-')) {
        await page.locator('.admin-skeletons').waitFor({ state: 'visible' })
        if (await page.locator('.recharts-wrapper').count()) throw new Error('Biểu đồ hiển thị trong lúc tải')
      }
      if (name === 'retry-valid') {
        await page.locator('.admin-alert').waitFor({ state: 'visible' })
        retry = true
        await page.getByRole('button', { name: 'Thử lại' }).click()
      }
      if (name === 'loading-error') {
        await page.locator('.admin-alert').waitFor({ state: 'visible' })
        if (await page.locator('.stat-card').count()) throw new Error('Lỗi API vẫn hiện KPI')
      } else {
        await page.locator('.stat-card').first().waitFor({ state: 'visible' })
        if (await page.locator('.stat-card').count() !== 7) throw new Error('Thiếu KPI')
        const chartCount = await page.locator('.recharts-wrapper').count()
        const expected = name === 'loading-zero' ? 0 : name === 'loading-invalid' ? 1 : 3
        if (chartCount !== expected) throw new Error(`Số biểu đồ sai: ${chartCount}/${expected}`)
        if (name === 'loading-invalid' && await page.locator('.admin-chart-invalid-message').count() !== 2) throw new Error('Không cô lập biểu đồ lỗi')
      }
      if (name === 'navigation-scroll') {
        if (await page.getByText('Không có kết quả phù hợp với bộ lọc hiện tại.').count()) throw new Error('Empty-state gây hiểu nhầm còn hiện')
        if (await page.getByRole('heading', { name: 'Tin tuyển dụng chờ duyệt' }).count() !== 1 || await page.getByText('Không có tin chờ duyệt').count() !== 1) throw new Error('Thiếu ngữ cảnh danh sách chờ duyệt')
        const initial = await page.evaluate(() => {
          const visible = (element) => element && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0
          const nav = document.querySelector('.app-mobile-nav')
          const sidebar = document.querySelector('.admin-sidebar')
          return { nav: visible(nav), sidebar: visible(sidebar) && sidebar.getBoundingClientRect().right > 0, mainToggle: visible(document.querySelector('.app-menu-toggle')), workspaceToggle: visible(document.querySelector('.app-workspace-toggle')), overflow: document.documentElement.scrollWidth > innerWidth + 1 }
        })
        if (initial.overflow || initial.nav !== (viewport.width <= 760) || initial.sidebar !== (viewport.width > 760) || initial.mainToggle !== (viewport.width <= 760) || initial.workspaceToggle !== (viewport.width <= 760)) throw new Error(`Breakpoint điều hướng sai: ${JSON.stringify(initial)}`)
        if (viewport.width <= 760) {
          await page.getByRole('button', { name: 'Mở menu quản trị' }).click()
          await page.waitForFunction(() => document.querySelector('.admin-sidebar')?.getBoundingClientRect().left >= -1)
          const opened = await page.locator('.admin-sidebar').evaluate((element) => element.getBoundingClientRect().left >= -1)
          if (!opened) throw new Error('Sidebar mobile không mở')
          await page.locator('.app-workspace-close').click()
        }
        if (viewport.width === 768) await page.screenshot({ path: path.join(root, 'tablet-navigation-768-viewport.png') })
        const table = page.locator('.admin-chart-table').first()
        await table.locator('summary').click()
        if (!await table.evaluate((element) => element.open)) throw new Error('Bảng không mở bằng chuột')
        if ([390, 1440].includes(viewport.width)) await page.screenshot({ path: path.join(root, `table-open-${viewport.width}-viewport.png`) })
        await table.locator('summary').focus()
        await page.keyboard.press('Space')
        if (await table.evaluate((element) => element.open)) throw new Error('Bảng không đóng bằng bàn phím')
        await page.keyboard.press('Enter')
        if (!await table.evaluate((element) => element.open)) throw new Error('Bảng không mở bằng bàn phím')
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.waitForTimeout(100)
        const bottom = await page.evaluate(() => {
          const nav = document.querySelector('.app-mobile-nav')
          const sidebar = document.querySelector('.admin-sidebar')
          const pending = document.querySelector('.admin-main .admin-section')
          const navVisible = nav && getComputedStyle(nav).display !== 'none'
          const navRect = nav?.getBoundingClientRect()
          const pendingRect = pending?.getBoundingClientRect()
          return { scrollY, maxScroll: document.documentElement.scrollHeight - innerHeight, navVisible, navTop: navRect?.top, navBottom: navRect?.bottom, pendingBottom: pendingRect?.bottom, sidebarRight: sidebar?.getBoundingClientRect().right, overflow: document.documentElement.scrollWidth > innerWidth + 1 }
        })
        record.geometry = bottom
        if (bottom.overflow || Math.abs(bottom.scrollY - bottom.maxScroll) > 2) throw new Error('Không thể cuộn đến cuối hoặc tràn ngang')
        if (bottom.navVisible && (Math.abs(bottom.navBottom - viewport.height) > 2 || bottom.pendingBottom > bottom.navTop - 2)) throw new Error('Bottom navigation che nội dung hoặc không cố định ở đáy viewport')
        if ([390, 768].includes(viewport.width)) await page.screenshot({ path: path.join(root, `scroll-bottom-${viewport.width}-viewport.png`) })
      }
    } catch (error) { record.status = 'FAIL'; record.error = error.message }
    results.push(record)
    await context.close()
  }
} finally {
  await browser.close()
  await fs.writeFile(path.join(root, 'completion-results.json'), JSON.stringify({ results }, null, 2), 'utf8')
  console.log(JSON.stringify({ cases: results.length, passed: results.filter((item) => item.status === 'PASS').length, failed: results.filter((item) => item.status === 'FAIL') }, null, 2))
  if (results.some((item) => item.status === 'FAIL')) process.exitCode = 1
}

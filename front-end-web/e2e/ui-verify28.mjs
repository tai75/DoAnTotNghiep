import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const baseURL = 'http://127.0.0.1:5188'
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
const findings = []

async function pageFor(role, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: 'vi-VN' })
  await context.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const data = pathname === '/api/auth/refresh'
      ? { token: 'mock', user: { id: 1, role, fullName: 'Người dùng kiểm thử' } }
      : pathname === '/api/notifications' ? { items: [], unreadCount: 0 }
      : pathname === '/api/conversations/unread-count' ? { count: 0 }
      : pathname === '/api/companies/me' ? { id: 1, name: 'Doanh nghiệp thử nghiệm', verificationStatus: 'PENDING' }
      : pathname === '/api/jobs/me' || pathname === '/api/candidates/skills' ? []
      : pathname === '/api/jobs' ? { items: [{ id: 1, title: 'Kỹ sư phần mềm', company: { id: 1, name: 'Doanh nghiệp thử nghiệm' }, companyId: 1, location: 'Hà Nội', employmentType: 'FULL_TIME', createdAt: '2026-11-01T00:00:00.000Z', skills: [], applicantCount: 0 }], pagination: { total: 1, totalPages: 1 } }
      : pathname === '/api/admin/stats' ? { users: 0, candidates: 0, recruiters: 0, companies: 0, jobs: 0, applications: 0, pendingJobs: 0 }
      : pathname.startsWith('/api/admin/') || pathname === '/api/applications/managed' ? { items: [], pagination: null }
      : {}
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
  })
  return { context, page: await context.newPage() }
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { context, page } = await pageFor('ADMIN', viewport)
    await page.goto(`${baseURL}/admin`, { waitUntil: 'networkidle' })
    const links = await page.locator('.app-nav a, .app-mobile-nav a').evaluateAll((anchors) => anchors.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })))
    assert(links.some((a) => a.text.includes('Việc làm') && a.href === '/admin'))
    assert(links.some((a) => a.text.includes('Việc của tôi') && a.href === '/admin'))
    assert(await page.getByRole('link', { name: 'Tin nhắn' }).count() > 0)
    await page.locator('.app-action-button[href="/messages"]').click()
    await page.waitForURL(`${baseURL}/admin`)
    findings.push({ id: 'admin-navigation', viewport: viewport.width, result: 'CONFIRMED', detail: 'Link tin nhắn hiển thị nhưng route đưa Admin về /admin; hai nhãn cùng trỏ /admin.' })
    await context.close()
  }

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { context, page } = await pageFor('RECRUITER', viewport)
    await page.goto(`${baseURL}/recruiter?section=applications`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Ứng viên', exact: true }).waitFor()
    if (viewport.width < 760) await page.getByRole('button', { name: 'Mở menu quản trị' }).click()
    await page.locator('.recruiter-sidebar').getByRole('button', { name: 'Hồ sơ công ty' }).click()
    await page.getByRole('heading', { name: 'Hồ sơ công ty', exact: true }).first().waitFor()
    assert.equal(new URL(page.url()).searchParams.get('section'), 'applications')
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Ứng viên', exact: true }).waitFor()
    findings.push({ id: 'recruiter-section', viewport: viewport.width, result: 'CONFIRMED', detail: 'Sidebar đổi nội dung nhưng URL giữ section=applications; reload quay lại Ứng viên.' })
    await context.close()
  }

  const { context, page } = await pageFor('CANDIDATE')
  await page.goto(`${baseURL}/jobs`, { waitUntil: 'networkidle' })
  const card = page.locator('.public-job-card').first()
  await card.waitFor()
  await card.focus()
  await page.keyboard.press('Space')
  assert.equal(new URL(page.url()).pathname, '/jobs')
  await page.keyboard.press('Enter')
  await page.waitForURL(`${baseURL}/jobs/1`)
  findings.push({ id: 'job-card-keyboard', result: 'CONFIRMED', detail: 'Thẻ việc làm mở bằng Enter nhưng Space không kích hoạt.' })
  await context.close()

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { context: chatContext, page: chatPage } = await pageFor('ADMIN', viewport)
    await chatPage.goto(`${baseURL}/khong-co-trang`, { waitUntil: 'networkidle' })
    await chatPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await chatPage.getByRole('button', { name: 'Mở trợ lý AI' }).click()
    await chatPage.locator('.chat-panel').waitFor()
    const overlap = await chatPage.evaluate(() => {
      const panel = document.querySelector('.chat-panel').getBoundingClientRect()
      return [...document.querySelectorAll('.public-footer a')].filter((link) => {
        const rect = link.getBoundingClientRect()
        return rect.left < panel.right && rect.right > panel.left && rect.top < panel.bottom && rect.bottom > panel.top
      }).map((link) => link.textContent.trim())
    })
    findings.push({ id: 'chat-open-footer', viewport: viewport.width, result: overlap.length ? 'CONFIRMED' : 'NOT_REPRODUCED', detail: `Panel chat mở chồng ${overlap.length} liên kết Footer; ChatWidget cũng hiển thị cho Admin.` })
    await chatContext.close()
  }
} finally {
  await browser.close()
}

console.log(JSON.stringify({ environment: 'frontend preview + mocked API; no backend/database', findings }, null, 2))

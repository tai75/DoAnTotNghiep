import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const baseURL = 'http://127.0.0.1:5188'
const artifactDir = path.resolve('e2e-artifacts', `ui-fix29-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`)
await fs.mkdir(artifactDir, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
const findings = []
const screenshots = []
const job = { id: 1, title: 'Kỹ sư phần mềm', status: 'DRAFT', _count: { applications: 0 }, company: { id: 1, name: 'Doanh nghiệp kiểm thử' }, location: 'Hà Nội', employmentType: 'FULL_TIME', createdAt: '2026-11-01T00:00:00.000Z', skills: [], applicantCount: 0 }
const viewports = [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 768, height: 900 }, { width: 1024, height: 900 }, { width: 1440, height: 900 }]

async function pageFor(role, viewport, { withJob = false, consent = true, failChat = false } = {}) {
  const context = await browser.newContext({ viewport, locale: 'vi-VN' })
  const calls = []
  let chatAttempts = 0
  await context.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    calls.push({ pathname, method: route.request().method() })
    if (pathname === '/api/ai/chat') {
      chatAttempts += 1
      if (failChat && chatAttempts === 1) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Lỗi kiểm thử' }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { message: 'Phản hồi kiểm thử từ API mock.' } }) })
    }
    const data = pathname === '/api/auth/refresh'
      ? (role === 'GUEST' ? null : { token: 'mock', user: { id: 1, role, fullName: 'Người dùng kiểm thử' } })
      : pathname === '/api/notifications' ? { items: [], unreadCount: 0 }
      : pathname === '/api/conversations/unread-count' ? { count: 0 }
      : pathname === '/api/ai/consents' ? { policyVersion: 'test', items: [{ scope: 'AI_CHAT', policyVersion: 'test', active: consent, withdrawalStatus: consent ? 'NONE' : 'COMPLETED' }] }
      : pathname === '/api/companies/me' ? { id: 1, name: 'Doanh nghiệp kiểm thử', verificationStatus: 'PENDING' }
      : pathname === '/api/jobs/me' ? (withJob ? [job] : [])
      : pathname === '/api/candidates/skills' || pathname === '/api/candidates/me/saved-jobs' || pathname === '/api/candidates/me/applications' ? []
      : pathname === '/api/candidates/me' ? { user: { fullName: 'Ứng viên kiểm thử' }, skills: [], resumes: [], educations: [], experiences: [], projects: [] }
      : pathname === '/api/candidates/me/completeness' ? { percentage: 0, completed: 0, total: 0, missing: [] }
      : pathname === '/api/recruiters/stats' ? { jobsByStatus: {}, applicationsTotal: 0, applicationsByStatus: {}, applicationsByJob: [], timeline: [] }
      : pathname === '/api/jobs' ? { items: withJob ? [job] : [], pagination: { total: withJob ? 1 : 0, totalPages: 1 } }
      : pathname === '/api/jobs/1' ? job
      : pathname === '/api/admin/stats' ? { users: 0, candidates: 0, recruiters: 0, companies: 0, jobs: 0, applications: 0, pendingJobs: 0 }
      : pathname === '/api/companies' ? { items: [], pagination: { total: 0, totalPages: 1 } }
      : pathname.startsWith('/api/admin/') || pathname === '/api/applications/managed' ? { items: [], pagination: null }
      : {}
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
  })
  return { context, page: await context.newPage(), calls }
}

function check(label, condition, detail = '') { assert(condition, `${label}: ${detail}`); findings.push({ label, status: 'PASS', detail }) }
async function capture(name, route, role, viewport, options = {}) {
  const { context, page } = await pageFor(role, viewport, options)
  const file = `${name}-${viewport.width}x${viewport.height}.png`
  const record = { page: name, route, viewport, role, data: 'mock API; empty state, no database data', status: 'PASS', file }
  try {
    await page.goto(baseURL + route, { waitUntil: 'networkidle' })
    await page.screenshot({ path: path.join(artifactDir, file), fullPage: true })
  } catch (error) { record.status = 'BLOCKED'; record.reason = error.message; delete record.file }
  screenshots.push(record)
  await context.close()
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { context, page } = await pageFor('ADMIN', viewport)
    await page.goto(`${baseURL}/admin`, { waitUntil: 'networkidle' })
    const links = await page.locator('.app-shell a').evaluateAll((anchors) => anchors.map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })))
    check(`Admin navigation ${viewport.width}`, !links.some((link) => link.href === '/messages') && links.some((link) => link.href === '/admin' && link.text.includes('Tổng quan')) && !links.some((link) => link.href === '/admin' && /Việc của tôi|Việc làm/.test(link.text)))
    if (viewport.width === 390) {
      await page.getByRole('button', { name: 'Mở menu điều hướng' }).click()
      check('Admin mobile drawer', await page.locator('.app-mobile-drawer a[href="/messages"]').count() === 0)
    }
    check(`Admin chat hidden ${viewport.width}`, await page.locator('.chat-widget').count() === 0)
    await context.close()
  }
  for (const role of ['CANDIDATE', 'RECRUITER']) {
    const { context, page } = await pageFor(role, { width: 1440, height: 900 })
    await page.goto(baseURL + (role === 'CANDIDATE' ? '/jobs' : '/recruiter'), { waitUntil: 'networkidle' })
    check(`${role} navigation`, await page.locator('.app-action-button[href="/messages"]').count() === 1)
    check(`${role} chat visible`, await page.locator('.chat-widget').count() === 1)
    await context.close()
  }
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { context, page } = await pageFor('RECRUITER', viewport, { withJob: true })
    await page.goto(`${baseURL}/recruiter?section=applications`, { waitUntil: 'networkidle' })
    check(`Recruiter deep link ${viewport.width}`, await page.locator('.recruiter-sidebar button.active').textContent() === 'Ứng viên')
    if (viewport.width === 390) await page.getByRole('button', { name: 'Mở menu quản trị' }).click()
    await page.locator('.recruiter-sidebar').getByRole('button', { name: 'Hồ sơ công ty' }).click()
    check(`Recruiter URL ${viewport.width}`, new URL(page.url()).searchParams.get('section') === 'company')
    await page.goBack({ waitUntil: 'networkidle' })
    check(`Recruiter Back ${viewport.width}`, new URL(page.url()).searchParams.get('section') === 'applications' && (await page.locator('.recruiter-sidebar button.active').textContent()) === 'Ứng viên')
    await page.goForward({ waitUntil: 'networkidle' })
    check(`Recruiter Forward ${viewport.width}`, new URL(page.url()).searchParams.get('section') === 'company')
    await page.reload({ waitUntil: 'networkidle' })
    check(`Recruiter reload ${viewport.width}`, (await page.locator('.recruiter-sidebar button.active').textContent()) === 'Hồ sơ công ty')
    await page.goto(`${baseURL}/recruiter?section=unknown`, { waitUntil: 'networkidle' })
    check(`Recruiter invalid ${viewport.width}`, new URL(page.url()).searchParams.get('section') === 'dashboard' && (await page.locator('.recruiter-sidebar button.active').textContent()) === 'Tổng quan')
    await page.goto(`${baseURL}/recruiter?section=jobs`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '+ Tạo tin mới' }).click()
    await page.getByRole('textbox', { name: 'Chức danh' }).fill('Bản nháp chưa lưu')
    if (viewport.width === 390) await page.getByRole('button', { name: 'Mở menu quản trị' }).click()
    await page.locator('.recruiter-sidebar').getByRole('button', { name: 'Hồ sơ công ty' }).click()
    await page.goBack({ waitUntil: 'networkidle' })
    check(`Recruiter draft Back ${viewport.width}`, await page.getByRole('textbox', { name: 'Chức danh' }).inputValue() === 'Bản nháp chưa lưu')
    let warnedBeforeUnload = false
    page.on('dialog', async (dialog) => { if (dialog.type() === 'beforeunload') warnedBeforeUnload = true; await dialog.accept() })
    await page.goto(`${baseURL}/recruiter?section=jobs&jobId=1`, { waitUntil: 'networkidle' })
    check(`Recruiter reload warning ${viewport.width}`, warnedBeforeUnload)
    await page.locator('.job-wizard').getByRole('button', { name: 'Hủy' }).click()
    await page.waitForTimeout(100)
    const editorAfterCancel = { url: page.url(), count: await page.locator('.job-wizard').count() }
    check(`Recruiter editor cancel ${viewport.width}`, !new URL(editorAfterCancel.url).searchParams.has('jobId') && editorAfterCancel.count === 0, JSON.stringify(editorAfterCancel))
    await context.close()
  }
  {
    const { context, page, calls } = await pageFor('CANDIDATE', { width: 1440, height: 900 }, { withJob: true })
    await page.goto(`${baseURL}/jobs?search=ky`, { waitUntil: 'networkidle' })
    const card = page.locator('.public-job-card').first()
    check('Job card semantic', await card.getAttribute('tabindex') === null && await card.locator('a.public-job-card-open').count() === 1 && await card.locator('a button, button a').count() === 0)
    await card.locator('.public-save-button').focus()
    await Promise.all([page.waitForResponse((response) => response.url().includes('/api/candidates/me/saved-jobs/1')), page.keyboard.press('Space')])
    check('Job card save keyboard', new URL(page.url()).pathname === '/jobs' && calls.filter((call) => call.pathname === '/api/candidates/me/saved-jobs/1').length === 1)
    await card.locator('.public-job-card-open').focus()
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/jobs\/1\?search=ky/)
    check('Job card open keyboard', new URL(page.url()).pathname === '/jobs/1')
    await context.close()
  }
  for (const viewport of viewports) {
    const { context, page, calls } = await pageFor('CANDIDATE', viewport, { failChat: true })
    await page.goto(`${baseURL}/jobs`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Mở trợ lý AI Job Connect' }).click()
    await page.getByRole('textbox', { name: 'Nhập câu hỏi cho trợ lý AI' }).fill('Tìm việc cho tôi')
    await page.getByRole('button', { name: 'Gửi', exact: true }).click()
    await page.getByRole('button', { name: 'Thử lại' }).click()
    await page.getByText('Phản hồi kiểm thử từ API mock.').waitFor()
    check(`Chat send retry ${viewport.width}`, calls.filter((call) => call.pathname === '/api/ai/chat').length === 2)
    const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, panel: document.querySelector('.chat-panel').getBoundingClientRect().toJSON(), close: document.querySelector('.chat-close').getBoundingClientRect().toJSON() }))
    check(`Chat responsive ${viewport.width}`, !layout.overflow && layout.panel.left >= 0 && layout.panel.right <= viewport.width && layout.close.top >= layout.panel.top)
    await page.getByRole('button', { name: 'Đóng trợ lý AI Job Connect' }).click()
    check(`Chat close ${viewport.width}`, await page.locator('.chat-panel').count() === 0)
    await context.close()
  }
  {
    const { context, page, calls } = await pageFor('CANDIDATE', { width: 390, height: 844 }, { consent: false })
    await page.goto(`${baseURL}/jobs`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Mở trợ lý AI Job Connect' }).click()
    await page.getByText('Bạn cần đồng ý sử dụng Trợ lý AI', { exact: false }).waitFor()
    check('Chat consent', await page.getByRole('button', { name: 'Gửi', exact: true }).isDisabled() && !calls.some((call) => call.pathname === '/api/ai/chat'))
    await page.getByRole('button', { name: 'Đóng trợ lý AI Job Connect' }).click()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    check('Footer after chat close', await page.locator('.public-footer a').count() > 0)
    await context.close()
  }
  const pages = [
    ['trang-chu', '/', 'GUEST'], ['dang-nhap', '/login', 'GUEST'], ['dang-ky', '/register', 'GUEST'],
    ['viec-lam', '/jobs', 'GUEST'], ['doanh-nghiep', '/companies', 'GUEST'], ['ho-so-ung-vien', '/profile', 'CANDIDATE'],
    ['dashboard-recruiter', '/recruiter?section=dashboard', 'RECRUITER'], ['dashboard-admin', '/admin', 'ADMIN'],
    ['chat-dong', '/jobs', 'CANDIDATE']
  ]
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const [name, route, role] of pages) await capture(name, route, role, viewport)
    const { context, page } = await pageFor('CANDIDATE', viewport)
    const file = `chat-mo-${viewport.width}x${viewport.height}.png`
    const record = { page: 'chat-mo', route: '/jobs', viewport, role: 'CANDIDATE', data: 'mock API; empty state, no database data', status: 'PASS', file }
    try {
      await page.goto(`${baseURL}/jobs`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Mở trợ lý AI Job Connect' }).click()
      await page.getByRole('textbox', { name: 'Nhập câu hỏi cho trợ lý AI' }).waitFor()
      await page.screenshot({ path: path.join(artifactDir, file), fullPage: true })
    } catch (error) { record.status = 'BLOCKED'; record.reason = error.message; delete record.file }
    screenshots.push(record)
    await context.close()
  }
} catch (error) {
  findings.push({ label: 'run', status: 'FAIL', detail: error.stack })
  process.exitCode = 1
} finally {
  await browser.close()
  await fs.writeFile(path.join(artifactDir, 'manifest.json'), JSON.stringify({ environment: 'Vite preview + Playwright API mock; no backend/database/Gemini/SMTP', screenshots, findings }, null, 2), 'utf8')
  console.log(JSON.stringify({ artifactDir, findings, screenshots: screenshots.length }, null, 2))
}

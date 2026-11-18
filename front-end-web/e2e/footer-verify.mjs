import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'

const baseURL = process.env.FOOTER_VERIFY_URL || 'http://127.0.0.1:5188'
const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 }
]
const roles = [null, 'CANDIDATE', 'RECRUITER', 'ADMIN']
const expected = {
  guest: ['/','/jobs','/companies','/register','/login'],
  CANDIDATE: ['/','/jobs','/companies','/profile','/my-jobs?tab=saved','/my-jobs?tab=applied'],
  RECRUITER: ['/','/jobs','/companies','/recruiter?section=jobs','/recruiter?section=applications','/recruiter/talent','/recruiter?section=company'],
  ADMIN: ['/','/jobs','/companies','/admin?section=overview','/admin?section=verification','/admin?section=jobs','/admin?section=reports']
}

const artifactDir = path.join(os.tmpdir(), 'job-connect-footer-verify28')
await fs.mkdir(artifactDir, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: chromePath })
const results = []

try {
  for (const role of roles) {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport, locale: 'vi-VN' })
      await context.route('**/api/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/api/auth/refresh') {
          const status = role ? 200 : 401
          return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(role
            ? { success: true, data: { token: 'footer-mock', user: { id: 1, role, fullName: 'Người dùng kiểm thử' } } }
            : { success: false, message: 'Chưa đăng nhập' }) })
        }
        const data = pathname === '/api/notifications' ? { items: [], unreadCount: 0 } : pathname === '/api/conversations/unread-count' ? { count: 0 } : pathname === '/api/companies' ? { items: [], industries: [], pagination: { total: 0, totalPages: 0 } } : {}
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
      })
      const page = await context.newPage()
      await page.goto(`${baseURL}/companies`, { waitUntil: 'networkidle' })
      const footer = page.locator('footer.public-footer')
      await footer.waitFor()
      const hrefs = await footer.locator('a').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')))
      assert.deepEqual(hrefs, expected[role || 'guest'], `${role || 'guest'} ${viewport.width}: liên kết Footer`)

      const metrics = await page.evaluate(() => {
        const footer = document.querySelector('footer.public-footer')
        const grid = footer.querySelector('.public-footer-inner')
        const links = [...footer.querySelectorAll('a')]
        const chat = document.querySelector('.chat-toggle')?.getBoundingClientRect()
        const mobileNav = document.querySelector('.app-mobile-nav')?.getBoundingClientRect()
        const intersects = (a, b) => Boolean(b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)
        window.scrollTo(0, document.documentElement.scrollHeight)
        return {
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          gridColumns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          footerOverlap: links.filter((link) => {
            const rect = link.getBoundingClientRect()
            return intersects(rect, chat) || intersects(rect, mobileNav)
          }).map((link) => link.textContent.trim()),
          footerLandmarks: document.querySelectorAll('footer').length,
          fontFamily: getComputedStyle(footer).fontFamily
        }
      })
      assert.equal(metrics.horizontalOverflow, false, `${role || 'guest'} ${viewport.width}: tràn ngang`)
      assert.deepEqual(metrics.footerOverlap, [], `${role || 'guest'} ${viewport.width}: chồng lên chat hoặc điều hướng mobile`)
      assert.equal(metrics.footerLandmarks, 1, 'chỉ một footer landmark')
      assert.match(metrics.fontFamily, /Be Vietnam Pro/)
      assert.equal(metrics.gridColumns, viewport.width <= 620 ? 1 : viewport.width <= 900 ? 2 : 3)

      await footer.locator('a').first().focus()
      await page.keyboard.press('Tab')
      const focus = await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim(), outline: getComputedStyle(document.activeElement).outlineStyle }))
      assert.equal(focus.text, 'Tìm việc làm', 'thứ tự Tab trong Footer')
      assert.notEqual(focus.outline, 'none', 'focus indicator')
      if (!role && [390, 1440].includes(viewport.width)) await page.screenshot({ path: path.join(artifactDir, `guest-${viewport.width}.png`), fullPage: true })

      results.push({ role: role || 'guest', viewport: `${viewport.width}x${viewport.height}`, links: hrefs.length, ...metrics })
      await context.close()
    }
  }
} finally {
  await browser.close()
}

console.log(JSON.stringify({ status: 'passed', cases: results.length, artifacts: artifactDir, results }, null, 2))

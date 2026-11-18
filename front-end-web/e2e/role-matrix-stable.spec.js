import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { authStatePath, disposableEnvironment } from './support/disposable-env'

const roles = {
  candidate: { path: '/profile', heading: 'Ứng viên kiểm thử', sidebar: '.app-mobile-drawer', drawerName: 'Mở menu điều hướng' },
  recruiter: { path: '/recruiter', heading: 'Tổng quan', sidebar: '.recruiter-sidebar', drawerName: 'Mở menu quản trị' },
  admin: { path: '/admin', heading: 'Tổng quan hệ thống', sidebar: '.admin-sidebar', drawerName: 'Mở menu quản trị' },
}
const viewports = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'desktop-1440', width: 1440, height: 900 },
]

function pathOnly(rawUrl) {
  const url = new URL(rawUrl)
  return `${url.pathname}${url.search}`
}

for (const [role, definition] of Object.entries(roles)) {
  test(`${role}: stable authenticated viewport matrix`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Matrix is executed once; viewport changes happen inside one authenticated context.')
    const context = await browser.newContext({
      storageState: authStatePath(role),
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      locale: 'vi-VN',
    })
    const page = await context.newPage()
    const directory = path.join(disposableEnvironment().artifactsRoot, 'role-matrix', role)
    await fs.mkdir(directory, { recursive: true })
    const results = []

    for (const viewport of viewports) {
      await test.step(viewport.name, async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        const apiFailures = []
        const pageErrors = []
        const onResponse = (response) => {
          if (response.url().includes('/api/') && response.status() >= 400) {
            apiFailures.push({ method: response.request().method(), url: pathOnly(response.url()), status: response.status() })
          }
        }
        const onPageError = (error) => pageErrors.push(error.message)
        page.on('response', onResponse)
        page.on('pageerror', onPageError)

        await page.goto(definition.path)
        await page.waitForLoadState('networkidle')
        const headingVisible = await page.getByRole('heading', { name: definition.heading }).first().isVisible().catch(() => false)
        const dimensions = await page.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth }))
        let drawer = { tested: false }
        if (viewport.width < 768 && headingVisible) {
          const button = page.getByRole('button', { name: definition.drawerName })
          const buttonVisible = await button.isVisible().catch(() => false)
          if (buttonVisible) {
            await button.click()
            const opened = role === 'candidate'
              ? await page.locator(definition.sidebar).isVisible().catch(() => false)
              : await page.locator('body').evaluate((element) => element.classList.contains('workspace-menu-open'))
            await page.keyboard.press('Escape')
            const closed = role === 'candidate'
              ? !(await page.locator(definition.sidebar).isVisible().catch(() => false))
              : await page.locator('body').evaluate((element) => !element.classList.contains('workspace-menu-open'))
            drawer = { tested: true, buttonVisible, opened, closed }
          } else drawer = { tested: true, buttonVisible: false, opened: false, closed: false }
        }

        await page.screenshot({ path: path.join(directory, `${viewport.name}.png`), fullPage: true })
        const result = {
          viewport,
          currentPath: new URL(page.url()).pathname,
          headingVisible,
          overflow: dimensions.scrollWidth > dimensions.innerWidth,
          dimensions,
          drawer,
          apiFailures,
          pageErrors,
        }
        results.push(result)
        page.off('response', onResponse)
        page.off('pageerror', onPageError)
      })
    }

    // Refresh tokens rotate during session restoration. Persist the current
    // cookie so the next serial test does not replay the revoked setup cookie.
    await context.storageState({ path: authStatePath(role) })
    await context.close()
    await fs.writeFile(path.join(directory, 'matrix-results.json'), JSON.stringify(results, null, 2), 'utf8')

    for (const result of results) {
      expect(result.currentPath, `${role} ${result.viewport.name} was redirected`).toBe(definition.path)
      expect(result.headingVisible, `${role} ${result.viewport.name} heading`).toBe(true)
      expect(result.overflow, `${role} ${result.viewport.name} horizontal overflow`).toBe(false)
      expect(result.pageErrors, `${role} ${result.viewport.name} JS errors`).toEqual([])
      if (result.drawer.tested) expect(result.drawer, `${role} ${result.viewport.name} drawer`).toMatchObject({ buttonVisible: true, opened: true, closed: true })
      expect(result.apiFailures, `${role} ${result.viewport.name} API failures`).toEqual([])
    }
  })
}

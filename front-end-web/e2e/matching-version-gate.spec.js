import { expect, test } from '@playwright/test'

test('candidate job UI uses V1 and never requests legacy V2', async ({ page }) => {
  const matchingRequests = []
  const ok = (route, data) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data }),
  })

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.includes('/match')) matchingRequests.push(url.pathname)

    if (url.pathname === '/api/auth/refresh') {
      return ok(route, {
        token: 'synthetic-access-token',
        user: { id: 1, fullName: 'Synthetic Candidate', role: 'CANDIDATE' },
      })
    }
    if (url.pathname === '/api/jobs/1/match') {
      return ok(route, {
        score: 80,
        skillScore: 100,
        experienceScore: 60,
        positionScore: 80,
        locationScore: 50,
        salaryScore: 50,
        employmentScore: 50,
        matchedSkills: [{ id: 1, name: 'Node.js' }],
        missingSkills: [],
        explanation: 'Rule-based V1 explanation.',
      })
    }
    if (url.pathname === '/api/jobs/1') {
      return ok(route, {
        id: 1,
        title: 'Synthetic Backend Engineer',
        description: 'Build safe APIs.',
        status: 'PUBLISHED',
        company: { id: 1, name: 'Synthetic Company', logoUrl: null },
        skills: [{ skillId: 1, isRequired: true, skill: { id: 1, name: 'Node.js' } }],
        applicantCount: 0,
      })
    }
    if (url.pathname === '/api/jobs') return ok(route, { items: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } })
    if (url.pathname === '/api/candidates/me/saved-jobs') return ok(route, [])
    if (url.pathname === '/api/candidates/me') return ok(route, { resumes: [], skills: [] })
    if (url.pathname === '/api/applications/me') return ok(route, [])
    if (url.pathname === '/api/notifications') return ok(route, { items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } })
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Unexpected mocked request' }) })
  })

  await page.goto('/jobs/1')

  await expect(page.getByRole('heading', { name: 'Synthetic Backend Engineer' })).toBeVisible()
  await expect(page.getByText('Rule-based V1 explanation.')).toBeVisible()
  expect(matchingRequests.length).toBeGreaterThan(0)
  expect(matchingRequests.every((path) => path === '/api/jobs/1/match')).toBe(true)
  expect(matchingRequests.some((path) => path.includes('/match/v2'))).toBe(false)
})

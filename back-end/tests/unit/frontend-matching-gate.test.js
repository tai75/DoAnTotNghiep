import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

delete process.env.VITE_MATCHING_V2_ENABLED

const { jobsApi } = await import('../../../front-end-web/src/services/api.js')

describe('frontend matching version gating', () => {
  it('rejects V2 locally when the build-time flag is disabled', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')

    await expect(jobsApi.matchV2(1)).rejects.toMatchObject({ status: 410 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses only the unversioned V1 API in the current job UI', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), '../front-end-web/src/pages/JobBoardPage.jsx'),
      'utf8'
    )

    expect(source).toContain('jobsApi.match(job.id)')
    expect(source).not.toContain('jobsApi.matchV2(')
  })
})

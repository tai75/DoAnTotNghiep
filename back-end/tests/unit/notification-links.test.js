import { describe, expect, it } from 'vitest'
import { resolveNotificationDestination } from '../../../front-end-web/src/utils/notificationLinks.js'

describe('notification deep-link allowlist', () => {
  it('maps candidate application and job notifications to existing routes', () => {
    expect(resolveNotificationDestination({ type: 'APPLICATION_STATUS_CHANGED', link: 'https://evil.test/admin' }, 'CANDIDATE')).toBe('/my-jobs?tab=applied')
    expect(resolveNotificationDestination({ type: 'JOB_ALERT', link: 'https://evil.test/jobs/42' }, 'CANDIDATE')).toBe('/jobs/42')
    expect(resolveNotificationDestination({ type: 'TALENT_INVITATION', link: '/invitations/7' }, 'CANDIDATE')).toBe('/invitations/7')
    expect(resolveNotificationDestination({ type: 'TALENT_INVITATION', link: 'https://evil.test/admin' }, 'CANDIDATE')).toBe('/invitations')
  })

  it('maps recruiter legacy and current links without allowing an external redirect', () => {
    expect(resolveNotificationDestination({ type: 'NEW_APPLICATION', link: '/recruiter/applications/12' }, 'RECRUITER')).toBe('/recruiter?section=applications&applicationId=12')
    expect(resolveNotificationDestination({ type: 'NEW_APPLICATION', link: '/recruiter?section=applications&applicationId=13' }, 'RECRUITER')).toBe('/recruiter?section=applications&applicationId=13')
    expect(resolveNotificationDestination({ type: 'JOB_MODERATION', link: '/recruiter/jobs/9' }, 'RECRUITER')).toBe('/recruiter?section=jobs&jobId=9')
    expect(resolveNotificationDestination({ type: 'TALENT_INVITATION_RESPONSE', link: '/recruiter/talent?jobId=8&candidateId=2' }, 'RECRUITER')).toBe('/recruiter/talent?jobId=8')
    expect(resolveNotificationDestination({ type: 'SYSTEM', link: 'https://evil.test/phish' }, 'RECRUITER')).toBe('/recruiter')
  })

  it('keeps role-incompatible destinations inside the role home', () => {
    expect(resolveNotificationDestination({ type: 'NEW_APPLICATION', link: '/recruiter/applications/12' }, 'ADMIN')).toBe('/admin')
    expect(resolveNotificationDestination({ type: 'JOB_MODERATION', link: '/recruiter/jobs/9' }, 'CANDIDATE')).toBe('/jobs')
  })
})

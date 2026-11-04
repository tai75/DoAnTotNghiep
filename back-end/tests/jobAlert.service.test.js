import { describe, expect, it } from 'vitest'

const { matchesAlert, dueSince, isDue } = await import('../src/services/jobAlert.service.js')

describe('job alert matching', () => {
  const job = {
    title: 'Senior React Engineer',
    description: 'Build frontend products',
    location: 'Da Nang',
    employmentType: 'FULL_TIME',
    minSalary: 1800,
    maxSalary: 3000,
    skills: [{ skillId: 7 }]
  }

  it('matches keyword, location, employment, salary and skill filters', () => {
    expect(matchesAlert({
      keyword: 'react',
      location: 'da nang',
      employmentType: 'FULL_TIME',
      minSalary: 2000,
      skillIds: [7],
      frequency: 'DAILY'
    }, job)).toBe(true)
  })

  it('rejects a job when a requested filter does not match', () => {
    expect(matchesAlert({ keyword: 'python', skillIds: [], frequency: 'DAILY' }, job)).toBe(false)
    expect(matchesAlert({ keyword: 'react', location: 'Ha Noi', skillIds: [], frequency: 'DAILY' }, job)).toBe(false)
    expect(matchesAlert({ keyword: 'react', minSalary: 4000, skillIds: [], frequency: 'DAILY' }, job)).toBe(false)
  })

  it('uses the frequency interval when an alert has not sent yet', () => {
    const now = new Date('2026-11-02T00:00:00.000Z')
    expect(dueSince({ frequency: 'DAILY', lastSentAt: null }, now).toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(dueSince({ frequency: 'WEEKLY', lastSentAt: null }, now).toISOString()).toBe('2026-10-26T00:00:00.000Z')
  })

  it('does not send a periodic alert before its interval elapses', () => {
    const now = new Date('2026-11-02T00:00:00.000Z')
    expect(isDue({ frequency: 'DAILY', lastSentAt: '2026-11-01T12:00:00.000Z' }, now)).toBe(false)
    expect(isDue({ frequency: 'INSTANT', lastSentAt: '2026-11-01T23:59:30.000Z' }, now)).toBe(false)
  })
})

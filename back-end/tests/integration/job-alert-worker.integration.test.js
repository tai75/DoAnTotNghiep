import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/job_connect_test'
process.env.JWT_SECRET = 'alert-worker-test-secret'
process.env.NODE_ENV = 'test'
process.env.FRONTEND_URL = 'http://localhost:5173'
process.env.API_PUBLIC_URL = 'http://localhost:5000'

const mocks = vi.hoisted(() => ({
  prisma: {
    jobAlert: { findMany: vi.fn(), update: vi.fn() },
    job: { findMany: vi.fn() },
    notification: { create: vi.fn() }
  },
  sendEmail: vi.fn()
}))

globalThis.__JOB_CONNECT_TEST_PRISMA__ = mocks.prisma
globalThis.__JOB_CONNECT_TEST_SEND_EMAIL__ = mocks.sendEmail

const workerModule = await import('../../src/jobs/alertWorker.js')
const { runAlertWorker } = workerModule.default || workerModule

describe('job alert worker integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.jobAlert.update.mockResolvedValue({})
    mocks.prisma.notification.create.mockResolvedValue({})
    mocks.sendEmail.mockResolvedValue(undefined)
  })

  it('persists a notification, sends one mocked email, and advances lastSentAt for matching jobs', async () => {
    const now = new Date('2026-11-03T03:00:00.000Z')
    mocks.prisma.jobAlert.findMany.mockResolvedValue([{
      id: 1, name: 'Backend', keyword: 'node', location: 'Da Nang', employmentType: 'FULL_TIME',
      minSalary: 1000, skillIds: [7], frequency: 'DAILY', isActive: true, lastSentAt: null,
      candidate: { userId: 9, user: { id: 9, email: 'candidate@example.test' } }
    }])
    mocks.prisma.job.findMany.mockResolvedValue([
      { id: 20, title: 'Node Backend Engineer', description: 'APIs', location: 'Da Nang', employmentType: 'FULL_TIME', maxSalary: 2000, company: { name: 'Acme' }, skills: [{ skillId: 7 }] },
      { id: 21, title: 'Designer', description: 'Figma', location: 'Da Nang', employmentType: 'FULL_TIME', maxSalary: 2000, company: { name: 'Other' }, skills: [{ skillId: 7 }] }
    ])

    await expect(runAlertWorker(now)).resolves.toBe(1)
    expect(mocks.prisma.notification.create).toHaveBeenCalledOnce()
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'candidate@example.test' }))
    expect(mocks.prisma.jobAlert.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { lastSentAt: now } })
  })
})

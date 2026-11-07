import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const requireModule = createRequire(import.meta.url)

const originalAlertWorkerEnabled = process.env.ALERT_WORKER_ENABLED
let lastScheduler

process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/job_connect_test'
process.env.JWT_SECRET = 'alert-worker-startup-test-secret'
process.env.NODE_ENV = 'test'
process.env.FRONTEND_URL = 'http://localhost:5173'
process.env.API_PUBLIC_URL = 'http://localhost:5000'

async function loadWorker(value) {
  if (value === undefined) delete process.env.ALERT_WORKER_ENABLED
  else process.env.ALERT_WORKER_ENABLED = value

  const task = { stop: vi.fn() }
  const scheduler = { schedule: vi.fn(() => task) }
  lastScheduler = scheduler
  delete requireModule.cache[requireModule.resolve('../../src/config/env.js')]
  delete requireModule.cache[requireModule.resolve('../../src/jobs/alertWorker.js')]
  const workerModule = requireModule('../../src/jobs/alertWorker.js')
  return { ...workerModule, scheduler, task }
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  if (originalAlertWorkerEnabled === undefined) delete process.env.ALERT_WORKER_ENABLED
  else process.env.ALERT_WORKER_ENABLED = originalAlertWorkerEnabled
})

describe('alert worker fail-closed startup', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['false', 'false'],
  ])('%s flag keeps the worker disabled without scheduling cron', async (_label, value) => {
    const { startAlertWorker, scheduler } = await loadWorker(value)

    expect(startAlertWorker(scheduler)).toBeNull()
    expect(scheduler.schedule).not.toHaveBeenCalled()
    expect(console.info).toHaveBeenCalledWith('Job alert worker disabled (ALERT_WORKER_ENABLED is not true)')
  })

  it('true explicitly enables one cron schedule', async () => {
    const { startAlertWorker, scheduler, task } = await loadWorker('true')

    expect(startAlertWorker(scheduler)).toBe(task)
    expect(scheduler.schedule).toHaveBeenCalledOnce()
  })

  it('rejects an invalid value before the worker can start', async () => {
    await expect(loadWorker('yes')).rejects.toThrow('ALERT_WORKER_ENABLED must be true or false')
    expect(lastScheduler.schedule).not.toHaveBeenCalled()
  })

  it('does not schedule a duplicate worker in the same process', async () => {
    const { startAlertWorker, scheduler, task } = await loadWorker('true')

    expect(startAlertWorker(scheduler)).toBe(task)
    expect(startAlertWorker(scheduler)).toBe(task)
    expect(scheduler.schedule).toHaveBeenCalledOnce()
    expect(console.info).toHaveBeenCalledWith('Job alert worker already scheduled; duplicate startup skipped')
  })
})

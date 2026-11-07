import { describe, expect, it, vi } from 'vitest'
import applicationState from '../../src/services/applicationState.service.js'

const { applyApplicationTransition, transitionDecision } = applicationState

describe('application state machine', () => {
  it.each([
    ['APPLIED', 'REVIEWING'],
    ['REVIEWING', 'SHORTLISTED'],
    ['SHORTLISTED', 'INTERVIEWING'],
    ['INTERVIEWING', 'OFFERED'],
    ['OFFERED', 'ACCEPTED'],
    ['OFFERED', 'REVIEWING'],
    ['APPLIED', 'REJECTED'],
  ])('allows recruiter transition %s -> %s', (from, to) => {
    expect(transitionDecision(from, to, 'RECRUITER')).toEqual({ allowed: true, noOp: false })
  })

  it.each(['ACCEPTED', 'REJECTED', 'WITHDRAWN'])('blocks recruiter transitions from terminal %s', (status) => {
    expect(transitionDecision(status, 'REVIEWING', 'RECRUITER')).toMatchObject({ allowed: false, reason: 'TERMINAL_STATUS' })
  })

  it('lets a candidate withdraw only from a non-terminal status', () => {
    expect(transitionDecision('OFFERED', 'WITHDRAWN', 'CANDIDATE')).toEqual({ allowed: true, noOp: false })
    expect(transitionDecision('REVIEWING', 'REJECTED', 'CANDIDATE')).toMatchObject({ allowed: false })
    expect(transitionDecision('ACCEPTED', 'WITHDRAWN', 'CANDIDATE')).toMatchObject({ allowed: false, reason: 'TERMINAL_STATUS' })
  })

  it('treats a repeated target status as an idempotent no-op', async () => {
    const transaction = { application: { updateMany: vi.fn() } }
    const application = { id: 1, status: 'REVIEWING' }

    await expect(applyApplicationTransition(transaction, { application, targetStatus: 'REVIEWING', actor: 'RECRUITER' }))
      .resolves.toEqual({ changed: false, application })
    expect(transaction.application.updateMany).not.toHaveBeenCalled()
  })

  it('uses a conditional update and returns 409 when another request wins', async () => {
    const transaction = { application: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } }

    await expect(applyApplicationTransition(transaction, {
      application: { id: 1, status: 'APPLIED' },
      targetStatus: 'REVIEWING',
      actor: 'RECRUITER'
    })).rejects.toMatchObject({ statusCode: 409 })
  })
})

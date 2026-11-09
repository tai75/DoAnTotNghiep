import { describe, expect, it, vi } from 'vitest'
import interviewService from '../../src/services/interview.service.js'

const { assertModeDetails, parseSchedule, claimInterview } = interviewService

describe('interview workflow rules', () => {
  it('normalizes offset timestamps to UTC and validates IANA timezones', () => {
    const result = parseSchedule({ scheduledStart: '2030-01-02T09:00:00+07:00', scheduledEnd: '2030-01-02T10:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh' })
    expect(result.start.toISOString()).toBe('2030-01-02T02:00:00.000Z')
    expect(() => parseSchedule({ scheduledStart: '2030-01-02T09:00:00+07:00', scheduledEnd: '2030-01-02T08:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh' })).toThrow(/kết thúc/)
    expect(() => parseSchedule({ scheduledStart: '2030-01-02T09:00:00+07:00', scheduledEnd: '2030-01-02T10:00:00+07:00', timezone: 'Not/A_Zone' })).toThrow(/Múi giờ/)
  })

  it('keeps elapsed time correct across an IANA daylight-saving transition', () => {
    const result = parseSchedule({
      scheduledStart: '2030-03-10T01:30:00-05:00',
      scheduledEnd: '2030-03-10T03:30:00-04:00',
      timezone: 'America/New_York'
    })
    expect(result.end.getTime() - result.start.getTime()).toBe(60 * 60 * 1000)
  })

  it('requires HTTPS online links and a physical location onsite', () => {
    expect(() => assertModeDetails({ mode: 'ONLINE', meetingUrl: 'http://meet.example.test/room' })).toThrow(/HTTPS/)
    expect(() => assertModeDetails({ mode: 'ONSITE', location: ' ' })).toThrow(/địa điểm/)
    expect(() => assertModeDetails({ mode: 'ONLINE', meetingUrl: 'https://meet.example.test/room' })).not.toThrow()
  })

  it('uses status plus version CAS and refuses stale writes', async () => {
    const transaction = { interview: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findUnique: vi.fn() } }
    await expect(claimInterview(transaction, { id: 4, version: 2, status: 'PENDING_RESPONSE' }, { expectedVersion: 2, update: { status: 'CONFIRMED' } }, ['PENDING_RESPONSE'])).rejects.toMatchObject({ statusCode: 409 })
    expect(transaction.interview.updateMany).toHaveBeenCalledWith({ where: { id: 4, version: 2, status: 'PENDING_RESPONSE' }, data: { status: 'CONFIRMED', version: { increment: 1 } } })
  })

  it('blocks actions outside the explicit state machine before writing', async () => {
    const transaction = { interview: { updateMany: vi.fn(), findUnique: vi.fn() } }
    await expect(claimInterview(transaction, { id: 4, version: 2, status: 'CANCELLED' }, { expectedVersion: 2, update: { status: 'CONFIRMED' } }, ['PENDING_RESPONSE'])).rejects.toMatchObject({ statusCode: 409 })
    expect(transaction.interview.updateMany).not.toHaveBeenCalled()
  })
})

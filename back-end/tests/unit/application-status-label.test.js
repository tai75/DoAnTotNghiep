import { describe, expect, it } from 'vitest'
import statusLabelService from '../../src/services/applicationStatusLabel.service.js'

const { applicationStatusLabel, applicationStatusNotificationContent } = statusLabelService

describe('application status text sent to candidates', () => {
  it.each([
    ['APPLIED', 'Đã nộp'],
    ['REVIEWING', 'Đang xem xét'],
    ['SHORTLISTED', 'Vào vòng trong'],
    ['INTERVIEWING', 'Phỏng vấn'],
    ['OFFERED', 'Đã đề nghị'],
    ['ACCEPTED', 'Đã nhận'],
    ['REJECTED', 'Từ chối'],
    ['WITHDRAWN', 'Đã rút']
  ])('labels %s as %s', (status, label) => {
    expect(applicationStatusLabel(status)).toBe(label)
  })

  it('rejects an unknown enum instead of exposing its code', () => {
    expect(() => applicationStatusLabel('UNKNOWN')).toThrow(RangeError)
  })

  it('builds a Vietnamese notification without the enum code', () => {
    const content = applicationStatusNotificationContent('Kỹ sư kiểm thử', 'REVIEWING')
    expect(content).toBe('Đơn ứng tuyển vị trí Kỹ sư kiểm thử đã chuyển sang trạng thái Đang xem xét.')
    expect(content).not.toContain('REVIEWING')
  })
})

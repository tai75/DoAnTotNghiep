export const applicationStatusLabels = Object.freeze({
  APPLIED: 'Mới',
  REVIEWING: 'Đang xem',
  SHORTLISTED: 'Đã chọn',
  INTERVIEWING: 'Phỏng vấn',
  OFFERED: 'Đề nghị',
  ACCEPTED: 'Đã nhận',
  REJECTED: 'Từ chối',
  WITHDRAWN: 'Đã rút'
})

export const terminalApplicationStatuses = Object.freeze(['ACCEPTED', 'REJECTED', 'WITHDRAWN'])
export const recruiterTargetStatuses = Object.freeze(['REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'ACCEPTED', 'REJECTED'])

export function isTerminalApplicationStatus(status) {
  return terminalApplicationStatuses.includes(status)
}

export function canRecruiterTransition(currentStatus, targetStatus) {
  if (currentStatus === targetStatus) return true
  return !isTerminalApplicationStatus(currentStatus) && recruiterTargetStatuses.includes(targetStatus)
}

export function recruiterStatusOptions(currentStatus) {
  if (isTerminalApplicationStatus(currentStatus)) return [currentStatus]
  return [currentStatus, ...recruiterTargetStatuses.filter((status) => status !== currentStatus)]
}

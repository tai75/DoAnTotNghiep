export const interviewStatusLabels = Object.freeze({ PENDING_RESPONSE: 'Chờ phản hồi', CONFIRMED: 'Đã xác nhận', RESCHEDULE_REQUESTED: 'Đã đề xuất đổi lịch', DECLINED: 'Đã từ chối', CANCELLED: 'Đã hủy', COMPLETED: 'Đã hoàn thành' })
export const finalInterviewStatuses = new Set(['DECLINED', 'CANCELLED', 'COMPLETED'])

export function displayInterviewTime(value, zone) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'full', timeStyle: 'short', timeZone: zone }).format(new Date(value))
}

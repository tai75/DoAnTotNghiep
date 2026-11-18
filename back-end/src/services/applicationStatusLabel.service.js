const labels = Object.freeze({
  APPLIED: 'Đã nộp',
  REVIEWING: 'Đang xem xét',
  SHORTLISTED: 'Vào vòng trong',
  INTERVIEWING: 'Phỏng vấn',
  OFFERED: 'Đã đề nghị',
  ACCEPTED: 'Đã nhận',
  REJECTED: 'Từ chối',
  WITHDRAWN: 'Đã rút'
});

function applicationStatusLabel(status) {
  if (!Object.hasOwn(labels, status)) throw new RangeError(`Unknown application status: ${status}`);
  return labels[status];
}

function applicationStatusNotificationContent(jobTitle, status) {
  return `Đơn ứng tuyển vị trí ${jobTitle} đã chuyển sang trạng thái ${applicationStatusLabel(status)}.`;
}

module.exports = { applicationStatusLabel, applicationStatusNotificationContent };

const ApiError = require('../utils/apiError');
const { applyApplicationTransition } = require('./applicationState.service');

const FINAL_STATUSES = new Set(['DECLINED', 'CANCELLED', 'COMPLETED']);
const TERMINAL_APPLICATION_STATUSES = new Set(['ACCEPTED', 'REJECTED', 'WITHDRAWN']);

function assertTimezone(timezone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch {
    throw new ApiError(400, 'Múi giờ không hợp lệ.');
  }
}

function parseSchedule({ scheduledStart, scheduledEnd, timezone }, { allowPast = false } = {}) {
  assertTimezone(timezone);
  const start = new Date(scheduledStart);
  const end = new Date(scheduledEnd);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new ApiError(400, 'Thời gian phỏng vấn không hợp lệ.');
  if (end <= start) throw new ApiError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu.');
  if (!allowPast && start <= new Date()) throw new ApiError(400, 'Lịch phỏng vấn phải ở trong tương lai.');
  return { start, end };
}

function assertModeDetails({ mode, location, meetingUrl }) {
  if (mode === 'ONLINE') {
    if (!meetingUrl) throw new ApiError(400, 'Vui lòng cung cấp liên kết phỏng vấn trực tuyến.');
    let parsed;
    try { parsed = new URL(meetingUrl); } catch { throw new ApiError(400, 'Liên kết phỏng vấn không hợp lệ.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new ApiError(400, 'Liên kết phỏng vấn phải sử dụng HTTPS an toàn.');
  }
  if (mode === 'ONSITE' && !location?.trim()) throw new ApiError(400, 'Vui lòng cung cấp địa điểm phỏng vấn.');
}

function interviewLink(role, id) {
  return role === 'CANDIDATE' ? `/interviews/${id}` : `/recruiter/interviews/${id}`;
}

async function notify(transaction, { userId, type, title, content, role, interviewId }) {
  return transaction.notification.create({ data: { userId, type, title, content, link: interviewLink(role, interviewId) } });
}

async function moveApplicationToInterviewing(transaction, application) {
  if (application.status === 'INTERVIEWING') return;
  if (TERMINAL_APPLICATION_STATUSES.has(application.status) || application.status === 'OFFERED') {
    throw new ApiError(409, 'Không thể đặt lịch cho hồ sơ ở trạng thái hiện tại.');
  }
  const transition = await applyApplicationTransition(transaction, { application, targetStatus: 'INTERVIEWING', actor: 'RECRUITER' });
  if (transition.changed) {
    await transaction.applicationStatusHistory.create({
      data: { applicationId: application.id, fromStatus: application.status, toStatus: 'INTERVIEWING', note: 'Đã lên lịch phỏng vấn.' }
    });
  }
}

async function claimInterview(transaction, interview, data, allowedStatuses) {
  if (!allowedStatuses.includes(interview.status)) throw new ApiError(409, 'Không thể thực hiện thao tác ở trạng thái lịch hiện tại.');
  const claimed = await transaction.interview.updateMany({
    where: { id: interview.id, version: data.expectedVersion, status: interview.status },
    data: { ...data.update, version: { increment: 1 } }
  });
  if (claimed.count !== 1) throw new ApiError(409, 'Lịch phỏng vấn đã thay đổi. Vui lòng tải lại dữ liệu.');
  return transaction.interview.findUnique({ where: { id: interview.id } });
}

async function cancelActiveInterviewsForTerminalApplication(transaction, application, reason) {
  if (!TERMINAL_APPLICATION_STATUSES.has(application.status)) return 0;
  const active = await transaction.interview.findMany({
    where: { applicationId: application.id, status: { in: ['PENDING_RESPONSE', 'CONFIRMED', 'RESCHEDULE_REQUESTED'] } },
    include: { application: { include: { candidate: { select: { userId: true } }, job: true } } }
  });
  let cancelled = 0;
  for (const interview of active) {
    const result = await transaction.interview.updateMany({ where: { id: interview.id, version: interview.version, status: interview.status }, data: { status: 'CANCELLED', version: { increment: 1 } } });
    if (!result.count) continue;
    cancelled += 1;
    await notify(transaction, {
      userId: interview.application.candidate.userId,
      type: 'INTERVIEW_CANCELLED', title: 'Lịch phỏng vấn đã hủy',
      content: reason || `Lịch phỏng vấn vị trí ${interview.application.job.title} đã được hủy do trạng thái hồ sơ thay đổi.`,
      role: 'CANDIDATE', interviewId: interview.id
    });
  }
  return cancelled;
}

module.exports = {
  FINAL_STATUSES,
  TERMINAL_APPLICATION_STATUSES,
  assertModeDetails,
  parseSchedule,
  interviewLink,
  notify,
  moveApplicationToInterviewing,
  claimInterview,
  cancelActiveInterviewsForTerminalApplication
};

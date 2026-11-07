const ApiError = require('../utils/apiError');

const APPLICATION_STATUSES = Object.freeze([
  'APPLIED',
  'REVIEWING',
  'SHORTLISTED',
  'INTERVIEWING',
  'OFFERED',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN'
]);

const TERMINAL_STATUSES = new Set(['ACCEPTED', 'REJECTED', 'WITHDRAWN']);
const RECRUITER_TARGET_STATUSES = new Set([
  'REVIEWING',
  'SHORTLISTED',
  'INTERVIEWING',
  'OFFERED',
  'ACCEPTED',
  'REJECTED'
]);

function transitionDecision(currentStatus, targetStatus, actor) {
  if (!APPLICATION_STATUSES.includes(currentStatus) || !APPLICATION_STATUSES.includes(targetStatus)) {
    return { allowed: false, reason: 'UNKNOWN_STATUS' };
  }
  if (currentStatus === targetStatus) return { allowed: true, noOp: true };
  if (TERMINAL_STATUSES.has(currentStatus)) return { allowed: false, reason: 'TERMINAL_STATUS' };
  if (actor === 'CANDIDATE') {
    return targetStatus === 'WITHDRAWN'
      ? { allowed: true, noOp: false }
      : { allowed: false, reason: 'CANDIDATE_TARGET' };
  }
  if (actor === 'RECRUITER') {
    return RECRUITER_TARGET_STATUSES.has(targetStatus)
      ? { allowed: true, noOp: false }
      : { allowed: false, reason: 'RECRUITER_TARGET' };
  }
  return { allowed: false, reason: 'UNKNOWN_ACTOR' };
}

function assertExpectedStatus(application, expectedStatus) {
  if (expectedStatus && application.status !== expectedStatus) {
    throw new ApiError(409, 'Trạng thái đơn ứng tuyển đã thay đổi. Vui lòng tải lại dữ liệu.');
  }
}

async function applyApplicationTransition(transaction, { application, targetStatus, actor }) {
  const decision = transitionDecision(application.status, targetStatus, actor);
  if (!decision.allowed) {
    throw new ApiError(409, 'Không thể chuyển đơn ứng tuyển từ trạng thái hiện tại.');
  }
  if (decision.noOp) return { changed: false, application };

  const claimed = await transaction.application.updateMany({
    where: { id: application.id, status: application.status },
    data: { status: targetStatus }
  });
  if (claimed.count !== 1) {
    throw new ApiError(409, 'Trạng thái đơn ứng tuyển đã thay đổi. Vui lòng tải lại dữ liệu.');
  }
  return { changed: true, application: { ...application, status: targetStatus } };
}

module.exports = {
  APPLICATION_STATUSES,
  TERMINAL_STATUSES,
  RECRUITER_TARGET_STATUSES,
  transitionDecision,
  assertExpectedStatus,
  applyApplicationTransition
};

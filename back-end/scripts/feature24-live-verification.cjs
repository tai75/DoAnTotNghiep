const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const EXPECTED_DATABASE = 'job_connect_core_ui_isolated';
const EXPECTED_PORT = 3407;
const EXPECTED_RUN_ID = '5bbb2340828a8480';
const API = process.env.FEATURE24_API_URL || 'http://127.0.0.1:5103/api';
const databaseUrl = process.env.FEATURE24_DATABASE_URL;
const password = process.env.FEATURE24_PASSWORD;
const candidateEmail = process.env.FEATURE24_CANDIDATE_EMAIL;
const recruiterEmail = process.env.FEATURE24_RECRUITER_EMAIL;

if (!databaseUrl || !password || !candidateEmail || !recruiterEmail) {
  throw new Error('FEATURE24 environment is incomplete');
}

const parsedUrl = new URL(databaseUrl);
assert.equal(parsedUrl.hostname, '127.0.0.1');
assert.equal(Number(parsedUrl.port), EXPECTED_PORT);
assert.equal(parsedUrl.pathname.slice(1), EXPECTED_DATABASE);

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const evidence = { environment: {}, recruiter: {}, candidate: {}, rbac: {}, validation: {}, database: {} };

async function api(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* status is still evidence */ }
  return { status: response.status, body: payload };
}

async function login(email) {
  const response = await api('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(response.status, 200, `Login failed for ${email}`);
  return response.body.data.token;
}

function schedule(applicationId, overrides = {}) {
  return {
    applicationId,
    requestKey: crypto.randomUUID(),
    scheduledStart: '2031-05-01T09:00:00+07:00',
    scheduledEnd: '2031-05-01T10:00:00+07:00',
    timezone: 'Asia/Ho_Chi_Minh',
    mode: 'ONLINE',
    meetingUrl: 'https://meet.example.test/feature24',
    candidateInstructions: 'Chuẩn bị môi trường lập trình và giấy tờ cần thiết.',
    recruiterNote: 'Ghi chú nội bộ FEATURE24.',
    ...overrides,
  };
}

async function main() {
  const [identity] = await prisma.$queryRawUnsafe(
    'SELECT DATABASE() db, @@port port, @@datadir datadir, CURRENT_USER() user, @@version version',
  );
  const migrations = await prisma.$queryRawUnsafe(
    'SELECT migration_name name, checksum, finished_at finished, rolled_back_at rolled FROM _prisma_migrations ORDER BY migration_name',
  );
  assert.equal(identity.db, EXPECTED_DATABASE);
  assert.equal(Number(identity.port), EXPECTED_PORT);
  assert.match(identity.datadir, new RegExp(`core-ui-${EXPECTED_RUN_ID}`, 'i'));
  assert.equal(migrations.length, 23);
  assert.ok(migrations.every((row) => row.finished && !row.rolled));
  evidence.environment = { ...identity, migrations: migrations.length };

  const fixtureCandidateUser = await prisma.user.findUnique({ where: { email: candidateEmail }, include: { candidate: true } });
  const fixtureRecruiterUser = await prisma.user.findUnique({ where: { email: recruiterEmail }, include: { recruiter: true } });
  assert.ok(fixtureCandidateUser?.candidate);
  assert.ok(fixtureRecruiterUser?.recruiter);
  const fixtureApplication = await prisma.application.findFirst({
    where: { candidateId: fixtureCandidateUser.candidate.id, job: { companyId: fixtureRecruiterUser.recruiter.companyId } },
    include: { job: { include: { company: true } } },
  });
  assert.ok(fixtureApplication);
  assert.equal(fixtureApplication.job.company.verificationStatus, 'VERIFIED');

  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const featureJob = await prisma.job.create({ data: {
    companyId: fixtureRecruiterUser.recruiter.companyId, title: `Công việc FEATURE24 ${stamp}`,
    description: 'Fixture append-only dành riêng cho workflow phỏng vấn FEATURE24.', status: 'PUBLISHED',
  } });
  const baseApplication = await prisma.application.create({ data: {
    candidateId: fixtureCandidateUser.candidate.id, jobId: featureJob.id,
    history: { create: { toStatus: 'APPLIED', note: 'FEATURE24 fixture riêng' } },
  }, include: { job: { include: { company: true } } } });
  const foreignCandidateUser = await prisma.user.create({ data: {
    email: `feature24-candidate-b-${stamp}@example.invalid`, passwordHash: fixtureCandidateUser.passwordHash,
    fullName: 'Ứng viên B FEATURE24', role: 'CANDIDATE', candidate: { create: { isSearchable: false } },
  }, include: { candidate: true } });
  const foreignCompany = await prisma.company.create({ data: {
    name: `Doanh nghiệp B FEATURE24 ${stamp}`, verificationStatus: 'VERIFIED',
    verificationSource: 'ADMIN_REVIEW', verifiedAt: new Date(), verificationVersion: 1,
  } });
  const foreignRecruiterUser = await prisma.user.create({ data: {
    email: `feature24-recruiter-b-${stamp}@example.invalid`, passwordHash: fixtureRecruiterUser.passwordHash,
    fullName: 'Nhà tuyển dụng B FEATURE24', role: 'RECRUITER',
    recruiter: { create: { companyId: foreignCompany.id, jobTitle: 'Kiểm thử phân quyền' } },
  } });
  const foreignJob = await prisma.job.create({ data: {
    companyId: foreignCompany.id, title: `Công việc B FEATURE24 ${stamp}`,
    description: 'Fixture append-only để kiểm thử phân quyền phỏng vấn.', status: 'PUBLISHED',
  } });
  const foreignApplication = await prisma.application.create({ data: {
    candidateId: foreignCandidateUser.candidate.id, jobId: foreignJob.id,
    history: { create: { toStatus: 'APPLIED', note: 'FEATURE24 fixture' } },
  } });
  const unverifiedCompany = await prisma.company.create({ data: { name: `Doanh nghiệp chưa xác minh FEATURE24 ${stamp}` } });
  const unverifiedRecruiterUser = await prisma.user.create({ data: {
    email: `feature24-unverified-${stamp}@example.invalid`, passwordHash: fixtureRecruiterUser.passwordHash,
    fullName: 'Nhà tuyển dụng chưa xác minh FEATURE24', role: 'RECRUITER',
    recruiter: { create: { companyId: unverifiedCompany.id } },
  } });
  const terminalJob = await prisma.job.create({ data: {
    companyId: fixtureRecruiterUser.recruiter.companyId, title: `Công việc kết thúc FEATURE24 ${stamp}`,
    description: 'Fixture trạng thái không hợp lệ.', status: 'PUBLISHED',
  } });
  const terminalApplication = await prisma.application.create({ data: {
    candidateId: foreignCandidateUser.candidate.id, jobId: terminalJob.id, status: 'REJECTED',
    history: { create: { toStatus: 'REJECTED', note: 'FEATURE24 terminal fixture' } },
  } });

  const [recruiterToken, candidateToken, foreignRecruiterToken, foreignCandidateToken, unverifiedToken] = await Promise.all([
    login(recruiterEmail), login(candidateEmail), login(foreignRecruiterUser.email),
    login(foreignCandidateUser.email), login(unverifiedRecruiterUser.email),
  ]);

  const unauthenticated = await api('/interviews/candidate');
  assert.equal(unauthenticated.status, 401);
  const managed = await api('/applications/managed?limit=50', { token: recruiterToken });
  assert.equal(managed.status, 200);
  assert.ok(managed.body.data.items.some((item) => item.id === baseApplication.id));

  const createPayload = schedule(baseApplication.id);
  const createdResponse = await api('/interviews/recruiter', { token: recruiterToken, method: 'POST', body: createPayload });
  assert.equal(createdResponse.status, 201);
  let interview = createdResponse.body.data;
  assert.equal(interview.status, 'PENDING_RESPONSE');
  assert.equal(interview.round, 1);
  const replay = await api('/interviews/recruiter', { token: recruiterToken, method: 'POST', body: createPayload });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.id, interview.id);
  assert.equal(replay.body.meta.idempotentReplay, true);

  const candidateDetail = await api(`/interviews/candidate/${interview.id}`, { token: candidateToken });
  assert.equal(candidateDetail.status, 200);
  assert.equal(candidateDetail.body.data.recruiterNote, undefined);
  assert.equal(candidateDetail.body.data.requestKey, undefined);
  assert.equal(candidateDetail.body.data.meetingUrl, createPayload.meetingUrl);
  assert.equal(candidateDetail.body.data.timezone, 'Asia/Ho_Chi_Minh');
  const notifications = await api('/notifications?limit=50', { token: candidateToken });
  assert.equal(notifications.status, 200);
  const scheduledNotice = notifications.body.data.items.find((item) => item.type === 'INTERVIEW_SCHEDULED' && item.link === `/interviews/${interview.id}`);
  assert.ok(scheduledNotice);

  const foreignCreated = await api('/interviews/recruiter', {
    token: foreignRecruiterToken, method: 'POST', body: schedule(foreignApplication.id, {
      scheduledStart: '2031-06-01T09:00:00+07:00', scheduledEnd: '2031-06-01T10:00:00+07:00',
    }),
  });
  assert.equal(foreignCreated.status, 201);
  const foreignInterview = foreignCreated.body.data;
  const candidateCannotReadB = await api(`/interviews/candidate/${foreignInterview.id}`, { token: candidateToken });
  const recruiterCannotReadB = await api(`/interviews/recruiter/${foreignInterview.id}`, { token: recruiterToken });
  const recruiterCannotPatchB = await api(`/interviews/recruiter/${foreignInterview.id}`, {
    token: recruiterToken, method: 'PATCH', body: { ...schedule(foreignApplication.id), expectedVersion: foreignInterview.version },
  });
  const foreignRecruiterCannotReadA = await api(`/interviews/recruiter/${interview.id}`, { token: foreignRecruiterToken });
  const foreignCandidateCannotReadA = await api(`/interviews/candidate/${interview.id}`, { token: foreignCandidateToken });
  const unverifiedCannotRead = await api(`/interviews/recruiter/${interview.id}`, { token: unverifiedToken });
  const wrongRole = await api(`/interviews/recruiter/${interview.id}`, { token: candidateToken });
  assert.equal(candidateCannotReadB.status, 404);
  assert.equal(recruiterCannotReadB.status, 404);
  assert.equal(recruiterCannotPatchB.status, 404);
  assert.equal(foreignRecruiterCannotReadA.status, 404);
  assert.equal(foreignCandidateCannotReadA.status, 404);
  assert.equal(unverifiedCannotRead.status, 403);
  assert.equal(unverifiedCannotRead.body.details.code, 'COMPANY_VERIFICATION_REQUIRED');
  assert.equal(wrongRole.status, 403);

  const invalidTime = await api('/interviews/recruiter', { token: recruiterToken, method: 'POST', body: schedule(baseApplication.id, {
    scheduledStart: '2031-07-01T10:00:00+07:00', scheduledEnd: '2031-07-01T09:00:00+07:00',
  }) });
  const invalidLink = await api('/interviews/recruiter', { token: recruiterToken, method: 'POST', body: schedule(baseApplication.id, { meetingUrl: 'http://unsafe.example.test' }) });
  const terminalState = await api('/interviews/recruiter', { token: recruiterToken, method: 'POST', body: schedule(terminalApplication.id) });
  const prematureComplete = await api(`/interviews/recruiter/${interview.id}/complete`, { token: recruiterToken, method: 'POST', body: { expectedVersion: interview.version } });
  assert.equal(invalidTime.status, 400);
  assert.equal(invalidLink.status, 400);
  assert.equal(terminalState.status, 409);
  assert.equal(prematureComplete.status, 409);

  const confirmed = await api(`/interviews/candidate/${interview.id}/confirm`, {
    token: candidateToken, method: 'POST', body: { expectedVersion: interview.version, note: 'Tôi xác nhận tham gia.' },
  });
  assert.equal(confirmed.status, 200);
  interview = confirmed.body.data;
  assert.equal(interview.status, 'CONFIRMED');
  const staleConfirm = await api(`/interviews/candidate/${interview.id}/confirm`, {
    token: candidateToken, method: 'POST', body: { expectedVersion: interview.version - 1 },
  });
  assert.equal(staleConfirm.status, 409);

  const updated = await api(`/interviews/recruiter/${interview.id}`, { token: recruiterToken, method: 'PATCH', body: {
    ...schedule(baseApplication.id, {
      scheduledStart: '2031-05-02T14:00:00+07:00', scheduledEnd: '2031-05-02T15:00:00+07:00',
      mode: 'ONSITE', location: '123 Nguyễn Huệ, Quận 1', meetingUrl: undefined,
    }),
    expectedVersion: interview.version,
  } });
  assert.equal(updated.status, 200);
  interview = updated.body.data;
  assert.equal(interview.status, 'PENDING_RESPONSE');
  assert.equal(interview.mode, 'ONSITE');
  assert.equal(interview.location, '123 Nguyễn Huệ, Quận 1');

  const rescheduled = await api(`/interviews/candidate/${interview.id}/reschedule`, { token: candidateToken, method: 'POST', body: {
    expectedVersion: interview.version, proposedStart: '2031-05-03T09:00:00+07:00',
    proposedEnd: '2031-05-03T10:00:00+07:00', timezone: 'Asia/Ho_Chi_Minh', note: 'Xin đổi sang sáng hôm sau.',
  } });
  assert.equal(rescheduled.status, 200);
  interview = rescheduled.body.data;
  assert.equal(interview.status, 'RESCHEDULE_REQUESTED');

  const acceptedReschedule = await api(`/interviews/recruiter/${interview.id}`, { token: recruiterToken, method: 'PATCH', body: {
    ...schedule(baseApplication.id, {
      scheduledStart: '2031-05-03T09:00:00+07:00', scheduledEnd: '2031-05-03T10:00:00+07:00',
    }),
    expectedVersion: interview.version,
  } });
  assert.equal(acceptedReschedule.status, 200);
  interview = acceptedReschedule.body.data;
  assert.equal(interview.status, 'PENDING_RESPONSE');
  assert.equal(interview.proposedStart, null);

  const declined = await api(`/interviews/candidate/${interview.id}/decline`, {
    token: candidateToken, method: 'POST', body: { expectedVersion: interview.version, note: 'Không thể tham dự.' },
  });
  assert.equal(declined.status, 200);
  interview = declined.body.data;
  assert.equal(interview.status, 'DECLINED');

  const secondRoundResponse = await api('/interviews/recruiter', { token: recruiterToken, method: 'POST', body: schedule(baseApplication.id, {
    scheduledStart: '2031-08-01T09:00:00+07:00', scheduledEnd: '2031-08-01T10:00:00+07:00',
  }) });
  assert.equal(secondRoundResponse.status, 201);
  const secondRound = secondRoundResponse.body.data;
  assert.equal(secondRound.round, 2);
  const cancelled = await api(`/interviews/recruiter/${secondRound.id}/cancel`, {
    token: recruiterToken, method: 'POST', body: { expectedVersion: secondRound.version, note: 'Hủy fixture vòng hai FEATURE24.' },
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.status, 'CANCELLED');

  const recruiterReload = await api('/interviews/recruiter?limit=50', { token: recruiterToken });
  const candidateReload = await api('/interviews/candidate?limit=50', { token: candidateToken });
  assert.equal(recruiterReload.status, 200);
  assert.equal(candidateReload.status, 200);
  const recruiterStatuses = Object.fromEntries(recruiterReload.body.data.items.filter((item) => [interview.id, secondRound.id].includes(item.id)).map((item) => [item.id, item.status]));
  const candidateStatuses = Object.fromEntries(candidateReload.body.data.items.filter((item) => [interview.id, secondRound.id].includes(item.id)).map((item) => [item.id, item.status]));
  assert.deepEqual(candidateStatuses, recruiterStatuses);
  assert.equal(recruiterStatuses[interview.id], 'DECLINED');
  assert.equal(recruiterStatuses[secondRound.id], 'CANCELLED');

  const stored = await prisma.interview.findMany({ where: { id: { in: [interview.id, secondRound.id, foreignInterview.id] } }, orderBy: { id: 'asc' } });
  const storedApplication = await prisma.application.findUnique({ where: { id: baseApplication.id }, include: { history: true } });
  const noticeCounts = await prisma.notification.groupBy({ by: ['type'], where: {
    OR: [{ link: `/interviews/${interview.id}` }, { link: `/recruiter/interviews/${interview.id}` }, { link: `/interviews/${secondRound.id}` }],
  }, _count: { _all: true } });
  assert.equal(storedApplication.status, 'INTERVIEWING');
  assert.ok(storedApplication.history.some((item) => item.toStatus === 'INTERVIEWING'));
  assert.equal(stored.find((item) => item.id === interview.id).scheduledStart.toISOString(), '2031-05-03T02:00:00.000Z');

  evidence.recruiter = {
    managedApplicationVisible: true, createdStatus: createdResponse.status, idempotentReplay: replay.status,
    updatedMode: updated.body.data.mode, cancelledRound: secondRound.round, reloadStatuses: recruiterStatuses,
  };
  evidence.candidate = {
    notificationType: scheduledNotice.type, notificationLink: scheduledNotice.link,
    privateFieldsHidden: true, confirmed: confirmed.body.data.status, rescheduled: rescheduled.body.data.status,
    declined: declined.body.data.status, reloadStatuses: candidateStatuses,
  };
  evidence.rbac = {
    unauthenticated: unauthenticated.status, candidateCrossRead: candidateCannotReadB.status,
    recruiterCrossRead: recruiterCannotReadB.status, recruiterCrossPatch: recruiterCannotPatchB.status,
    unverifiedCompany: unverifiedCannotRead.status, wrongRole: wrongRole.status,
  };
  evidence.validation = {
    invalidTime: invalidTime.status, invalidLink: invalidLink.status,
    terminalApplication: terminalState.status, prematureComplete: prematureComplete.status,
    staleVersion: staleConfirm.status,
  };
  evidence.database = {
    applicationId: baseApplication.id, applicationStatus: storedApplication.status,
    interviews: stored.map((item) => ({ id: item.id, applicationId: item.applicationId, round: item.round, status: item.status, version: item.version })),
    storedStartUtc: stored.find((item) => item.id === interview.id).scheduledStart.toISOString(),
    notificationTypes: noticeCounts.map((item) => ({ type: item.type, count: item._count._all })),
  };
  console.log(JSON.stringify(
    { status: 'PASS', evidence },
    (_key, value) => typeof value === 'bigint' ? Number(value) : value,
    2,
  ));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'FAIL', name: error.name, message: error.message, stack: error.stack }, null, 2));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

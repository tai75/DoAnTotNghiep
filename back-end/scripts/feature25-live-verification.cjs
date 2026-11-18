const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const RUN_ID = '5bbb2340828a8480';
const EXPECTED_DATABASE = 'job_connect_core_ui_isolated';
const EXPECTED_PORT = 3407;
const API = 'http://127.0.0.1:5103/api';
const runRoot = path.join(process.env.LOCALAPPDATA || '', 'JobConnectIsolated', `core-ui-${RUN_ID}`);
const credentials = JSON.parse(fs.readFileSync(path.join(runRoot, 'credentials.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(runRoot, 'fixture.json'), 'utf8'));
const databaseUrl = credentials.runnerUrl;
const password = credentials.password;
const parsedUrl = new URL(databaseUrl);

assert.equal(parsedUrl.hostname, '127.0.0.1');
assert.equal(Number(parsedUrl.port), EXPECTED_PORT);
assert.equal(parsedUrl.pathname.slice(1), EXPECTED_DATABASE);

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const evidence = { environment: {}, messages: {}, invitations: {}, rbac: {}, database: {}, browserFixture: {} };

async function api(route, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* status is sufficient evidence */ }
  return { status: response.status, body: payload };
}

async function createTestToken(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  assert.ok(user, `Missing user ${email}`);
  const sessionId = crypto.randomUUID();
  await prisma.authSession.create({ data: { id: sessionId, userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
  return jwt.sign(
    { userId: user.id, role: user.role, tokenVersion: user.tokenVersion, sid: sessionId },
    credentials.jwtSecret,
    { algorithm: 'HS256', expiresIn: '1h', issuer: 'job-connect-api', audience: 'job-connect-web', subject: String(user.id) },
  );
}

async function main() {
  const [identity] = await prisma.$queryRawUnsafe(
    'SELECT DATABASE() db, @@port port, @@datadir datadir, CURRENT_USER() user, @@version version',
  );
  const migrations = await prisma.$queryRawUnsafe(
    'SELECT migration_name name, finished_at finished, rolled_back_at rolled FROM _prisma_migrations ORDER BY migration_name',
  );
  assert.equal(identity.db, EXPECTED_DATABASE);
  assert.equal(Number(identity.port), EXPECTED_PORT);
  assert.match(identity.datadir, new RegExp(`core-ui-${RUN_ID}`, 'i'));
  assert.equal(migrations.length, 23);
  assert.ok(migrations.every((row) => row.finished && !row.rolled));
  evidence.environment = { ...identity, port: Number(identity.port), migrations: migrations.length, runId: RUN_ID };

  const baseRecruiter = await prisma.user.findUnique({
    where: { email: fixture.accounts.recruiter }, include: { recruiter: { include: { company: true } } },
  });
  const baseCandidate = await prisma.user.findUnique({ where: { email: fixture.accounts.candidate } });
  assert.equal(baseRecruiter.recruiter.company.verificationStatus, 'VERIFIED');
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  const candidateA = await prisma.user.create({ data: {
    email: `feature25-candidate-a-${stamp}@example.invalid`, passwordHash: baseCandidate.passwordHash,
    fullName: 'Ứng viên A FEATURE25', role: 'CANDIDATE',
    candidate: { create: { isSearchable: false, headline: 'Ứng viên kiểm thử tin nhắn' } },
  }, include: { candidate: true } });
  const inviteCandidate = await prisma.user.create({ data: {
    email: `feature25-invite-${stamp}@example.invalid`, passwordHash: baseCandidate.passwordHash,
    fullName: 'Ứng viên lời mời FEATURE25', role: 'CANDIDATE',
    candidate: { create: { isSearchable: true, headline: 'Ứng viên kiểm thử lời mời', location: 'Hồ Chí Minh' } },
  }, include: { candidate: true } });
  const browserInviteCandidate = await prisma.user.create({ data: {
    email: `feature25-browser-invite-${stamp}@example.invalid`, passwordHash: baseCandidate.passwordHash,
    fullName: 'Ứng viên Browser FEATURE25', role: 'CANDIDATE',
    candidate: { create: { isSearchable: true, headline: 'Ứng viên browser lời mời', location: 'Hồ Chí Minh' } },
  }, include: { candidate: true } });
  const primaryJob = await prisma.job.create({ data: {
    companyId: baseRecruiter.recruiter.companyId, title: `Việc làm tin nhắn FEATURE25 ${stamp}`,
    description: 'Fixture append-only cho tin nhắn FEATURE25.', status: 'PUBLISHED',
    deadline: new Date('2031-12-31T16:59:59.000Z'),
  } });
  const invitationJob = await prisma.job.create({ data: {
    companyId: baseRecruiter.recruiter.companyId, title: `Việc làm lời mời FEATURE25 ${stamp}`,
    description: 'Fixture append-only cho lời mời FEATURE25.', status: 'PUBLISHED',
    deadline: new Date('2031-12-31T16:59:59.000Z'),
  } });
  const application = await prisma.application.create({ data: {
    candidateId: candidateA.candidate.id, jobId: primaryJob.id,
    history: { create: { toStatus: 'APPLIED', note: 'FEATURE25 append-only fixture' } },
  } });

  const foreignCompany = await prisma.company.create({ data: {
    name: `Doanh nghiệp B FEATURE25 ${stamp}`, verificationStatus: 'VERIFIED',
    verificationSource: 'ADMIN_REVIEW', verifiedAt: new Date(), verificationVersion: 1,
  } });
  const foreignRecruiter = await prisma.user.create({ data: {
    email: `feature25-recruiter-b-${stamp}@example.invalid`, passwordHash: baseRecruiter.passwordHash,
    fullName: 'Nhà tuyển dụng B FEATURE25', role: 'RECRUITER',
    recruiter: { create: { companyId: foreignCompany.id } },
  } });
  const foreignCandidate = await prisma.user.create({ data: {
    email: `feature25-candidate-b-${stamp}@example.invalid`, passwordHash: baseCandidate.passwordHash,
    fullName: 'Ứng viên B FEATURE25', role: 'CANDIDATE', candidate: { create: { isSearchable: false } },
  }, include: { candidate: true } });
  const foreignJob = await prisma.job.create({ data: {
    companyId: foreignCompany.id, title: `Việc làm B FEATURE25 ${stamp}`,
    description: 'Fixture phân quyền FEATURE25.', status: 'PUBLISHED',
  } });
  const foreignApplication = await prisma.application.create({ data: {
    candidateId: foreignCandidate.candidate.id, jobId: foreignJob.id,
  } });
  const foreignConversation = await prisma.conversation.create({ data: { applicationId: foreignApplication.id } });

  const unverifiedCompany = await prisma.company.create({ data: { name: `Doanh nghiệp chưa xác minh FEATURE25 ${stamp}` } });
  const unverifiedRecruiter = await prisma.user.create({ data: {
    email: `feature25-unverified-${stamp}@example.invalid`, passwordHash: baseRecruiter.passwordHash,
    fullName: 'Nhà tuyển dụng chưa xác minh FEATURE25', role: 'RECRUITER',
    recruiter: { create: { companyId: unverifiedCompany.id } },
  } });

  const [recruiterToken, candidateToken, inviteCandidateToken, foreignRecruiterToken, unverifiedToken, adminToken] = await Promise.all([
    createTestToken(baseRecruiter.email), createTestToken(candidateA.email), createTestToken(inviteCandidate.email),
    createTestToken(foreignRecruiter.email), createTestToken(unverifiedRecruiter.email), createTestToken(fixture.accounts.admin),
  ]);

  assert.equal((await api('/conversations')).status, 401);
  assert.equal((await api('/conversations', { token: adminToken })).status, 403);
  assert.equal((await api('/conversations', { token: unverifiedToken })).status, 403);
  assert.equal((await api(`/conversations/applications/${application.id}`, { token: candidateToken, method: 'POST' })).status, 403);

  const opened = await api(`/conversations/applications/${application.id}`, { token: recruiterToken, method: 'POST' });
  assert.equal(opened.status, 201);
  const conversationId = opened.body.data.id;
  const firstText = `Tin nhắn recruiter thứ nhất ${stamp}`;
  const secondText = `Tin nhắn recruiter thứ hai ${stamp}`;
  const first = await api(`/conversations/${conversationId}/messages`, { token: recruiterToken, method: 'POST', body: { content: firstText } });
  const second = await api(`/conversations/${conversationId}/messages`, { token: recruiterToken, method: 'POST', body: { content: secondText } });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const unreadTotal = await api('/conversations/unread-count', { token: candidateToken });
  const candidateConversations = await api('/conversations', { token: candidateToken });
  assert.equal(unreadTotal.status, 200);
  assert.equal(unreadTotal.body.data.count, 2);
  assert.equal(candidateConversations.status, 200);
  const candidateConversation = candidateConversations.body.data.find((item) => item.id === conversationId);
  assert.ok(candidateConversation);
  evidence.messages.unreadBeforeRead = {
    total: unreadTotal.body.data.count,
    conversation: candidateConversation.unreadCount,
  };
  assert.equal(candidateConversation.unreadCount, 2, 'Per-conversation unread count must include every unread message');

  const candidateMessages = await api(`/conversations/${conversationId}/messages`, { token: candidateToken });
  assert.equal(candidateMessages.status, 200);
  assert.deepEqual(candidateMessages.body.data.map((item) => item.content), [firstText, secondText]);
  assert.deepEqual(Object.keys(candidateMessages.body.data[0].sender).sort(), ['fullName', 'id', 'role']);
  assert.equal((await api(`/conversations/${conversationId}/read`, { token: candidateToken, method: 'PATCH' })).status, 200);
  assert.equal((await api('/conversations/unread-count', { token: candidateToken })).body.data.count, 0);

  const replyText = `Phản hồi candidate ${stamp}`;
  const reply = await api(`/conversations/${conversationId}/messages`, { token: candidateToken, method: 'POST', body: { content: replyText } });
  assert.equal(reply.status, 201);
  const recruiterReload = await api(`/conversations/${conversationId}/messages`, { token: recruiterToken });
  assert.deepEqual(recruiterReload.body.data.map((item) => item.content), [firstText, secondText, replyText]);
  assert.equal((await api('/conversations/unread-count', { token: recruiterToken })).body.data.count, 1);
  assert.equal((await api(`/conversations/${conversationId}/read`, { token: recruiterToken, method: 'PATCH' })).status, 200);

  const outsiderConversation = await api(`/conversations/${foreignConversation.id}/messages`, { token: candidateToken });
  const outsiderSend = await api(`/conversations/${foreignConversation.id}/messages`, { token: candidateToken, method: 'POST', body: { content: 'Không được ghi' } });
  const recruiterCrossRead = await api(`/conversations/${foreignConversation.id}/messages`, { token: recruiterToken });
  const recruiterCrossSend = await api(`/conversations/${foreignConversation.id}/messages`, { token: recruiterToken, method: 'POST', body: { content: 'Không được ghi' } });
  const adminRead = await api(`/conversations/${conversationId}/messages`, { token: adminToken });
  const invalidMessage = await api(`/conversations/${conversationId}/messages`, { token: candidateToken, method: 'POST', body: { content: '<b> </b>' } });
  assert.equal(outsiderConversation.status, 403);
  assert.equal(outsiderSend.status, 403);
  assert.equal(recruiterCrossRead.status, 403);
  assert.equal(recruiterCrossSend.status, 403);
  assert.equal(adminRead.status, 403);
  assert.equal(invalidMessage.status, 400);
  evidence.rbac.messages = { unauthenticated: 401, admin: 403, candidateCrossRead: 403, candidateCrossSend: 403, recruiterCrossRead: 403, recruiterCrossSend: 403, unverifiedRecruiter: 403 };

  const hiddenCandidate = await api(`/recruiters/talent?jobId=${invitationJob.id}`, { token: recruiterToken });
  assert.equal(hiddenCandidate.status, 200);
  assert.ok(hiddenCandidate.body.data.items.some((item) => item.id === inviteCandidate.candidate.id));
  assert.ok(!hiddenCandidate.body.data.items.some((item) => item.id === candidateA.candidate.id));
  const targetBefore = hiddenCandidate.body.data.items.find((item) => item.id === inviteCandidate.candidate.id);
  assert.equal(targetBefore.contact, null);

  const invitationMessage = `Mời bạn ứng tuyển FEATURE25 ${stamp}`;
  const invitationResponse = await api('/recruiters/talent/invite', {
    token: recruiterToken, method: 'POST', body: { candidateId: inviteCandidate.candidate.id, jobId: invitationJob.id, message: invitationMessage },
  });
  assert.equal(invitationResponse.status, 201);
  const invitationId = invitationResponse.body.data.id;
  const replayInvitation = await api('/recruiters/talent/invite', {
    token: recruiterToken, method: 'POST', body: { candidateId: inviteCandidate.candidate.id, jobId: invitationJob.id, message: invitationMessage },
  });
  assert.equal(replayInvitation.status, 200);
  assert.equal(replayInvitation.body.data.idempotent, true);

  const notificationResponse = await api('/notifications?limit=50', { token: inviteCandidateToken });
  assert.equal(notificationResponse.status, 200);
  assert.ok(notificationResponse.body.data.items.some((item) => item.type === 'TALENT_INVITATION' && item.link === `/invitations/${invitationId}`));
  const invitationDetail = await api(`/candidates/me/invitations/${invitationId}`, { token: inviteCandidateToken });
  assert.equal(invitationDetail.status, 200);
  assert.equal(invitationDetail.body.data.message, invitationMessage);
  assert.equal(invitationDetail.body.data.isActionable, true);
  assert.equal((await api(`/candidates/me/invitations/${invitationId}`, { token: candidateToken })).status, 404);
  assert.equal((await api(`/candidates/me/invitations/${invitationId}`, { token: recruiterToken })).status, 403);

  const accepted = await api(`/candidates/me/invitations/${invitationId}`, {
    token: inviteCandidateToken, method: 'PATCH', body: { status: 'ACCEPTED' },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.status, 'ACCEPTED');
  assert.ok(accepted.body.data.respondedAt);
  const invalidTransition = await api(`/candidates/me/invitations/${invitationId}`, {
    token: inviteCandidateToken, method: 'PATCH', body: { status: 'DECLINED' },
  });
  assert.equal(invalidTransition.status, 409);

  const talentAfter = await api(`/recruiters/talent?jobId=${invitationJob.id}`, { token: recruiterToken });
  const targetAfter = talentAfter.body.data.items.find((item) => item.id === inviteCandidate.candidate.id);
  assert.equal(targetAfter.invitation.status, 'ACCEPTED');
  assert.equal(targetAfter.contact.email, inviteCandidate.email);
  const recruiterNotifications = await api('/notifications?limit=50', { token: recruiterToken });
  assert.ok(recruiterNotifications.body.data.items.some((item) => item.type === 'TALENT_INVITATION_RESPONSE' && item.link.includes(`jobId=${invitationJob.id}`)));
  assert.equal((await api('/recruiters/talent/invite', { token: unverifiedToken, method: 'POST', body: { candidateId: inviteCandidate.candidate.id, jobId: invitationJob.id } })).status, 403);
  assert.equal((await api('/recruiters/talent/invite', { token: foreignRecruiterToken, method: 'POST', body: { candidateId: inviteCandidate.candidate.id, jobId: invitationJob.id } })).status, 404);
  assert.equal((await api('/recruiters/talent/invite', { token: adminToken, method: 'POST', body: { candidateId: inviteCandidate.candidate.id, jobId: invitationJob.id } })).status, 403);
  evidence.invitations = { invitationId, notification: true, candidateStatus: accepted.body.data.status, recruiterStatus: targetAfter.invitation.status, contactBeforeConsent: targetBefore.contact, contactAfterConsent: Boolean(targetAfter.contact), duplicateIdempotent: true, invalidTransition: 409 };

  const persistedConversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  const persistedInvitation = await prisma.talentInvitation.findUnique({ where: { id: invitationId } });
  assert.deepEqual(persistedConversation.messages.map((item) => item.content), [firstText, secondText, replyText]);
  assert.ok(persistedConversation.messages.every((item) => item.readAt));
  assert.equal(persistedInvitation.status, 'ACCEPTED');
  evidence.messages = { ...evidence.messages, conversationId, orderedMessages: persistedConversation.messages.length, persistedAfterReload: true, allRead: true };
  evidence.database = { conversationId, messageIds: persistedConversation.messages.map((item) => item.id), invitationId, invitationStatus: persistedInvitation.status, appendOnlyStamp: stamp };
  evidence.browserFixture = {
    recruiterEmail: baseRecruiter.email,
    candidateEmail: candidateA.email,
    invitationCandidateEmail: inviteCandidate.email,
    browserInvitationCandidateEmail: browserInviteCandidate.email,
    browserInvitationCandidateName: browserInviteCandidate.fullName,
    conversationId,
    invitationJobId: invitationJob.id,
    invitationCandidateId: inviteCandidate.candidate.id,
  };
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ evidence, error: error.message, stack: error.stack }, (_key, value) => typeof value === 'bigint' ? Number(value) : value, 2));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

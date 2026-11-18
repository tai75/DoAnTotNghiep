const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

if (process.env.RUN_ISOLATED_AUTH_SESSION_DB05 !== '1') {
  throw new Error('RUN_ISOLATED_AUTH_SESSION_DB05=1 is required');
}

const databaseUrl = new URL(process.env.DATABASE_URL);
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '3407'
  || databaseUrl.pathname !== '/job_connect_auth_session_db05'
  || databaseUrl.username !== 'db05_runner') {
  throw new Error('DB05 database identity guard rejected DATABASE_URL');
}

process.env.NODE_ENV = 'isolated-db05';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.API_RATE_LIMIT_MAX = '5000';
process.env.ALERT_WORKER_ENABLED = 'false';
process.env.GEMINI_API_KEY = '';

const prisma = new PrismaClient();
const app = require('../../src/app');
const prefix = 'auth-db05-';
const initialPassword = 'Db05-Initial-Password-2026!';
const resetPassword = 'Db05-Reset-Password-2026!';
const summary = { raceIterations: 12, refreshStatus: {}, logoutStatus: {}, transactionErrors: 0 };

function cookiePair(response) {
  return response.headers['set-cookie']?.[0]?.split(';')[0] || null;
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function login(email, password = initialPassword) {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  assert.equal(response.status, 200, `login failed for ${email}: ${response.status}`);
  const cookie = cookiePair(response);
  assert.ok(cookie, 'login did not set a refresh cookie');
  return { access: response.body.data.token, cookie };
}

async function accessStatus(token) {
  return (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
  const ids = users.map(({ id }) => id);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entity: 'User', entityId: { in: ids } }] } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function main() {
  const [identity] = await prisma.$queryRaw`SELECT @@port AS port, DATABASE() AS db, @@datadir AS datadir`;
  assert.equal(Number(identity.port), 3407);
  assert.equal(identity.db, 'job_connect_auth_session_db05');
  assert.match(identity.datadir, /job-connect-auth-session-db05-3407/i);

  await cleanup();
  const passwordHash = await bcrypt.hash(initialPassword, 4);
  const candidate = await prisma.user.create({
    data: { email: `${prefix}candidate@example.test`, passwordHash, fullName: 'DB05 Candidate', role: 'CANDIDATE' }
  });

  // Independent sessions A/B.
  const sessionA = await login(candidate.email);
  const sessionB = await login(candidate.email);
  assert.notEqual(jwt.decode(sessionA.access).sid, jwt.decode(sessionB.access).sid);
  assert.equal(await accessStatus(sessionA.access), 200);
  assert.equal(await accessStatus(sessionB.access), 200);
  assert.equal((await request(app).post('/api/auth/logout').set('Cookie', sessionA.cookie)).status, 200);
  assert.equal(await accessStatus(sessionA.access), 401);
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', sessionA.cookie)).status, 401);
  assert.equal(await accessStatus(sessionB.access), 200);
  const refreshedB = await request(app).post('/api/auth/refresh').set('Cookie', sessionB.cookie);
  assert.equal(refreshedB.status, 200);
  assert.equal(jwt.decode(sessionB.access).sid, jwt.decode(refreshedB.body.data.token).sid);

  // Replaying the old cookie revokes only B's session and its successor.
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', sessionB.cookie)).status, 401);
  assert.equal(await accessStatus(refreshedB.body.data.token), 401);
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', cookiePair(refreshedB))).status, 401);

  // Logout after rotation rejects both access tokens bound to the same sid.
  const sessionC = await login(candidate.email);
  const refreshedC = await request(app).post('/api/auth/refresh').set('Cookie', sessionC.cookie);
  assert.equal(refreshedC.status, 200);
  assert.equal((await request(app).post('/api/auth/logout').set('Cookie', cookiePair(refreshedC))).status, 200);
  assert.equal(await accessStatus(sessionC.access), 401);
  assert.equal(await accessStatus(refreshedC.body.data.token), 401);

  // Real InnoDB refresh/logout races. A successful logout must leave no successor alive.
  for (let index = 0; index < summary.raceIterations; index += 1) {
    const raceSession = await login(candidate.email);
    const sid = jwt.decode(raceSession.access).sid;
    const [refreshResponse, logoutResponse] = await Promise.all([
      request(app).post('/api/auth/refresh').set('Cookie', raceSession.cookie),
      request(app).post('/api/auth/logout').set('Cookie', raceSession.cookie)
    ]);
    summary.refreshStatus[refreshResponse.status] = (summary.refreshStatus[refreshResponse.status] || 0) + 1;
    summary.logoutStatus[logoutResponse.status] = (summary.logoutStatus[logoutResponse.status] || 0) + 1;
    if (refreshResponse.status >= 500 || logoutResponse.status >= 500) summary.transactionErrors += 1;
    assert.equal(logoutResponse.status, 200, `race logout failed at iteration ${index}`);
    const storedSession = await prisma.authSession.findUnique({ where: { id: sid } });
    assert.ok(storedSession.revokedAt, `race session survived at iteration ${index}`);
    assert.equal(await prisma.refreshToken.count({ where: { sessionId: sid, revokedAt: null } }), 0);
    assert.equal(await accessStatus(raceSession.access), 401);
    if (refreshResponse.status === 200) {
      assert.equal(await accessStatus(refreshResponse.body.data.token), 401);
      assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', cookiePair(refreshResponse))).status, 401);
    }
  }

  // Password reset globally revokes all sessions.
  const resetA = await login(candidate.email);
  const resetB = await login(candidate.email);
  const rawReset = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: { userId: candidate.id, tokenHash: hashToken(rawReset), expiresAt: new Date(Date.now() + 60_000) }
  });
  assert.equal((await request(app).post('/api/auth/password-reset/confirm').send({ token: rawReset, password: resetPassword })).status, 200);
  assert.equal(await accessStatus(resetA.access), 401);
  assert.equal(await accessStatus(resetB.access), 401);
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', resetA.cookie)).status, 401);
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', resetB.cookie)).status, 401);

  // Admin suspend globally revokes the victim without revoking the admin.
  const victim = await prisma.user.create({
    data: { email: `${prefix}victim@example.test`, passwordHash, fullName: 'DB05 Victim', role: 'CANDIDATE' }
  });
  const admin = await prisma.user.create({
    data: { email: `${prefix}admin@example.test`, passwordHash, fullName: 'DB05 Admin', role: 'ADMIN' }
  });
  const victimA = await login(victim.email);
  const victimB = await login(victim.email);
  const adminSession = await login(admin.email);
  const suspended = await request(app).patch(`/api/admin/users/${victim.id}/status`)
    .set('Authorization', `Bearer ${adminSession.access}`).send({ status: 'BANNED' });
  assert.equal(suspended.status, 200);
  assert.equal(await accessStatus(victimA.access), 401);
  assert.equal(await accessStatus(victimB.access), 401);
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', victimA.cookie)).status, 401);
  assert.equal(await accessStatus(adminSession.access), 200);

  // Legacy access/refresh tokens and cross-user sid mismatch are rejected.
  const currentCandidate = await prisma.user.findUnique({ where: { id: candidate.id } });
  const legacyAccess = jwt.sign(
    { userId: candidate.id, role: candidate.role, tokenVersion: currentCandidate.tokenVersion },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m', issuer: process.env.JWT_ISSUER || 'job-connect-api', audience: process.env.JWT_AUDIENCE || 'job-connect-web', subject: String(candidate.id) }
  );
  assert.equal(await accessStatus(legacyAccess), 401);
  const rawLegacyRefresh = crypto.randomBytes(48).toString('base64url');
  await prisma.refreshToken.create({
    data: { userId: candidate.id, sessionId: null, tokenHash: hashToken(rawLegacyRefresh), expiresAt: new Date(Date.now() + 60_000) }
  });
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', `job_connect_refresh=${rawLegacyRefresh}`)).status, 401);
  const mismatchAccess = jwt.sign(
    { userId: candidate.id, role: candidate.role, tokenVersion: currentCandidate.tokenVersion, sid: jwt.decode(adminSession.access).sid },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m', issuer: process.env.JWT_ISSUER || 'job-connect-api', audience: process.env.JWT_AUDIENCE || 'job-connect-web', subject: String(candidate.id) }
  );
  assert.equal(await accessStatus(mismatchAccess), 401);

  console.log(JSON.stringify({ status: 'PASS', ...summary }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ status: 'FAIL', name: error.name, message: error.message, ...summary }));
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await cleanup(); } finally { await prisma.$disconnect(); }
  });

const cron = require('node-cron');
const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const config = require('../config/env');
const { matchesAlert, dueSince, isDue } = require('../services/jobAlert.service');
const { sendEmail } = require('../services/mail.service');

const LEASE_MS = 5 * 60 * 1000;
const MAX_RETRIES = 5;
let cronRunActive = false;

function unsubscribeToken(alertId) {
  return crypto.createHmac('sha256', config.jwtSecret).update(String(alertId)).digest('hex');
}

function buildEventKey(alertId, jobIds) {
  return crypto.createHash('sha256').update(`${alertId}:${[...jobIds].sort((a, b) => a - b).join(',')}`).digest('hex');
}

function nextRetryAt(now, retryCount) {
  const delay = Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** Math.max(0, retryCount - 1)));
  return new Date(now.getTime() + delay);
}

function classifyEmailError(error) {
  const code = String(error?.code || 'EMAIL_PROVIDER_ERROR').slice(0, 100);
  const responseCode = Number(error?.responseCode || 0);
  if (['ETIMEDOUT', 'ESOCKET', 'ECONNRESET'].includes(code) || error?.outcomeUnknown) return { kind: 'unknown', code };
  if (['EMAIL_PROVIDER_UNCONFIRMED', 'EMAIL_PROVIDER_REJECTED', 'EMAIL_NOT_CONFIGURED'].includes(code)
    || (responseCode >= 500 && responseCode < 600)) return { kind: 'permanent', code };
  return { kind: 'transient', code };
}

function conditionalWatermark(database, alertId, previous, now) {
  return database.jobAlert.updateMany({
    where: { id: alertId, ...(previous ? { lastSentAt: previous } : { lastSentAt: null }) },
    data: { lastSentAt: now },
  });
}

async function reserveAlertEvent(alert, matches, since, now, database = prisma) {
  const eventKey = buildEventKey(alert.id, matches.map((job) => job.id));
  return database.$transaction(async (transaction) => {
    let event;
    try {
      event = await transaction.jobAlertEvent.create({ data: { alertId: alert.id, eventKey, windowStart: since, windowEnd: now, nextRetryAt: now } });
    } catch (error) {
      if (error.code !== 'P2002') throw error;
      return transaction.jobAlertEvent.findFirst({ where: { OR: [{ eventKey }, { alertId: alert.id, windowStart: since, windowEnd: now }] } });
    }
    await transaction.jobAlertEventJob.createMany({
      data: matches.map((job) => ({ eventId: event.id, alertId: alert.id, jobId: job.id })), skipDuplicates: true,
    });
    const reservations = await transaction.jobAlertEventJob.findMany({ where: { eventId: event.id }, select: { jobId: true } });
    const reservedIds = new Set(reservations.map((item) => item.jobId));
    const reservedJobs = matches.filter((job) => reservedIds.has(job.id));
    if (!reservedJobs.length) {
      await transaction.jobAlertEvent.update({
        where: { id: event.id }, data: { status: 'COMPLETED', inAppStatus: 'SENT', emailStatus: 'SENT', completedAt: now },
      });
      await conditionalWatermark(transaction, alert.id, alert.lastSentAt, now);
      return { ...event, reservedJobs: 0, duplicate: true };
    }
    const link = `${config.frontendUrl}/jobs/${reservedJobs[0].id}`;
    const title = `${reservedJobs.length} việc làm mới phù hợp với "${alert.name}"`;
    const content = reservedJobs.slice(0, 5).map((job) => `${job.title} - ${job.company.name}`).join('; ');
    const notification = await transaction.notification.create({
      data: { userId: alert.candidate.userId, type: 'JOB_ALERT', title, content, link },
    });
    const updated = await transaction.jobAlertEvent.update({
      where: { id: event.id },
      data: { notificationId: notification.id, inAppStatus: 'SENT', emailStatus: 'PENDING', status: 'PENDING', nextRetryAt: now },
    });
    await conditionalWatermark(transaction, alert.id, alert.lastSentAt, now);
    return { ...updated, reservedJobs: reservedJobs.length, duplicate: false };
  });
}

async function recoverExpiredLeases(now = new Date(), database = prisma) {
  const safe = await database.jobAlertEvent.updateMany({
    where: { status: 'PROCESSING', emailStatus: 'PENDING', leaseExpiresAt: { lt: now } },
    data: { status: 'PENDING', leaseOwner: null, leaseExpiresAt: null, lastErrorCode: 'WORKER_LEASE_EXPIRED' },
  });
  const unknown = await database.jobAlertEvent.updateMany({
    where: { status: 'PROCESSING', emailStatus: 'PROCESSING', leaseExpiresAt: { lt: now } },
    data: { status: 'FAILED', emailStatus: 'UNKNOWN', leaseOwner: null, leaseExpiresAt: null, lastErrorCode: 'EMAIL_OUTCOME_UNKNOWN' },
  });
  return { recovered: safe.count, unknown: unknown.count };
}

async function claimNextEvent(workerId, now = new Date(), database = prisma) {
  const due = {
    status: 'PENDING', emailStatus: 'PENDING',
    AND: [{ OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] }, { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] }],
  };
  const candidates = await database.jobAlertEvent.findMany({
    where: due, orderBy: [{ nextRetryAt: 'asc' }, { id: 'asc' }], take: 20, select: { id: true },
  });
  for (const candidate of candidates) {
    const claimed = await database.jobAlertEvent.updateMany({
      where: { id: candidate.id, ...due },
      data: { status: 'PROCESSING', leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (claimed.count === 1) {
      return database.jobAlertEvent.findUnique({
        where: { id: candidate.id },
        include: { alert: { include: { candidate: { include: { user: { select: { email: true } } } } } }, jobs: { include: { job: { include: { company: { select: { name: true } } } } } } },
      });
    }
  }
  return null;
}

async function deliverClaimedEvent(event, workerId, now = new Date(), database = prisma, mailer = sendEmail) {
  const started = await database.jobAlertEvent.updateMany({
    where: { id: event.id, status: 'PROCESSING', emailStatus: 'PENDING', leaseOwner: workerId, leaseExpiresAt: { gt: now } },
    data: { emailStatus: 'PROCESSING' },
  });
  if (started.count !== 1) return { status: 'stale' };
  const jobs = event.jobs.map((item) => item.job);
  const link = `${config.frontendUrl}/jobs/${jobs[0].id}`;
  const unsubscribe = `${config.apiPublicUrl}/api/candidates/alerts/unsubscribe?id=${event.alert.id}&token=${unsubscribeToken(event.alert.id)}`;
  const title = `${jobs.length} việc làm mới phù hợp với "${event.alert.name}"`;
  const content = jobs.slice(0, 5).map((job) => `${job.title} - ${job.company.name}`).join('; ');
  let provider;
  try {
    provider = await mailer({
      to: event.alert.candidate.user.email, subject: title,
      text: `${content}\nXem việc làm: ${link}\nHủy đăng ký: ${unsubscribe}`,
    });
    if (!provider) {
      const error = new Error('Email provider did not confirm delivery acceptance');
      error.code = 'EMAIL_PROVIDER_UNCONFIRMED';
      throw error;
    }
    if (Array.isArray(provider.accepted) && provider.accepted.length === 0) {
      const error = new Error('Email provider rejected every recipient');
      error.code = 'EMAIL_PROVIDER_REJECTED';
      throw error;
    }
  } catch (error) {
    const failure = classifyEmailError(error);
    const retryCount = event.retryCount + 1;
    const retry = failure.kind === 'transient' && retryCount < MAX_RETRIES;
    const committed = await database.jobAlertEvent.updateMany({
      where: { id: event.id, status: 'PROCESSING', emailStatus: 'PROCESSING', leaseOwner: workerId },
      data: retry
        ? { status: 'PENDING', emailStatus: 'PENDING', retryCount, nextRetryAt: nextRetryAt(now, retryCount), leaseOwner: null, leaseExpiresAt: null, lastErrorCode: failure.code }
        : { status: 'FAILED', emailStatus: failure.kind === 'unknown' ? 'UNKNOWN' : 'FAILED', retryCount, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: failure.code },
    });
    return { status: committed.count !== 1 ? 'stale' : retry ? 'retry' : failure.kind };
  }
  try {
    const committed = await database.jobAlertEvent.updateMany({
      where: { id: event.id, status: 'PROCESSING', emailStatus: 'PROCESSING', leaseOwner: workerId },
      data: {
        status: 'COMPLETED', emailStatus: 'SENT', providerMessageId: provider.messageId || null,
        providerResponse: { accepted: provider.accepted?.length || 0, rejected: provider.rejected?.length || 0 },
        completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastErrorCode: null,
      },
    });
    return { status: committed.count === 1 ? 'sent' : 'stale' };
  } catch {
    try {
      await database.jobAlertEvent.updateMany({
        where: { id: event.id, status: 'PROCESSING', emailStatus: 'PROCESSING', leaseOwner: workerId },
        data: {
          status: 'FAILED', emailStatus: 'UNKNOWN', leaseOwner: null, leaseExpiresAt: null,
          lastErrorCode: 'EMAIL_SUCCESS_STATE_UNCONFIRMED',
        },
      });
    } catch {
      // Leave the in-flight lease intact; expiry recovery quarantines it as UNKNOWN.
    }
    return { status: 'unknown' };
  }
}

async function runAlertWorker(now = new Date(), options = {}) {
  const database = options.database || prisma;
  const mailer = options.mailer || sendEmail;
  const workerId = options.workerId || `${process.pid}-${crypto.randomUUID()}`;
  await recoverExpiredLeases(now, database);
  const alerts = await database.jobAlert.findMany({
    where: { isActive: true }, include: { candidate: { include: { user: { select: { id: true, email: true } } } } },
  });
  for (const alert of alerts) {
    if (!isDue(alert, now)) continue;
    const since = dueSince(alert, now);
    const jobs = await database.job.findMany({
      where: { status: 'PUBLISHED', createdAt: { gt: since, lte: now }, OR: [{ deadline: { gte: now } }, { deadline: null }] },
      include: { company: { select: { name: true } }, skills: { select: { skillId: true } } }, orderBy: { createdAt: 'desc' },
    });
    const matches = jobs.filter((job) => matchesAlert(alert, job));
    if (!matches.length) {
      await conditionalWatermark(database, alert.id, alert.lastSentAt, now);
      continue;
    }
    await reserveAlertEvent(alert, matches, since, now, database);
  }
  let sent = 0;
  for (;;) {
    const event = await claimNextEvent(workerId, now, database);
    if (!event) break;
    const result = await deliverClaimedEvent(event, workerId, now, database, mailer);
    if (result.status === 'sent') sent += 1;
  }
  return sent;
}

function startAlertWorker() {
  if (!config.alertWorkerEnabled) {
    console.info('Job alert worker disabled');
    return null;
  }
  const task = cron.schedule(config.alertWorkerCron, async () => {
    if (cronRunActive) return;
    cronRunActive = true;
    try {
      await runAlertWorker();
    } catch (error) {
      console.error('[job-alert-worker]', { name: error.name });
    } finally {
      cronRunActive = false;
    }
  });
  console.info(`Job alert worker started (${config.alertWorkerCron})`);
  return task;
}

module.exports = {
  matchesAlert, dueSince, isDue, runAlertWorker, startAlertWorker, unsubscribeToken,
  buildEventKey, reserveAlertEvent, recoverExpiredLeases, claimNextEvent, deliverClaimedEvent,
  classifyEmailError, nextRetryAt,
};

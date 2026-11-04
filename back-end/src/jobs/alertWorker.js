const cron = require('node-cron');
const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const config = require('../config/env');
const { matchesAlert, dueSince, isDue } = require('../services/jobAlert.service');
const { sendEmail } = require('../services/mail.service');

function unsubscribeToken(alertId) {
  return crypto.createHmac('sha256', config.jwtSecret).update(String(alertId)).digest('hex');
}

async function runAlertWorker(now = new Date()) {
  const alerts = await prisma.jobAlert.findMany({
    where: { isActive: true },
    include: { candidate: { include: { user: { select: { id: true, email: true } } } } }
  });
  let sent = 0;
  for (const alert of alerts) {
    if (!isDue(alert, now)) continue;
    const since = dueSince(alert, now);
    const jobs = await prisma.job.findMany({
      where: {
        status: 'PUBLISHED',
        createdAt: { gt: since, lte: now },
        OR: [{ deadline: { gte: now } }, { deadline: null }]
      },
      include: { company: { select: { name: true } }, skills: { select: { skillId: true } } },
      orderBy: { createdAt: 'desc' }
    });
    const matches = jobs.filter((job) => matchesAlert(alert, job));
    if (!matches.length) {
      await prisma.jobAlert.update({ where: { id: alert.id }, data: { lastSentAt: now } });
      continue;
    }
    const link = `${config.frontendUrl}/jobs/${matches[0].id}`;
    const unsubscribe = `${config.apiPublicUrl}/api/candidates/alerts/unsubscribe?id=${alert.id}&token=${unsubscribeToken(alert.id)}`;
    const title = `${matches.length} việc làm mới phù hợp với "${alert.name}"`;
    const content = matches.slice(0, 5).map((job) => `${job.title} - ${job.company.name}`).join('; ');
    await prisma.notification.create({
      data: { userId: alert.candidate.userId, type: 'JOB_ALERT', title, content, link }
    });
    await sendEmail({
      to: alert.candidate.user.email,
      subject: title,
      text: `${content}\nXem việc làm: ${link}\nHủy đăng ký: ${unsubscribe}`
    });
    await prisma.jobAlert.update({ where: { id: alert.id }, data: { lastSentAt: now } });
    sent += 1;
  }
  return sent;
}

function startAlertWorker() {
  if (!config.alertWorkerEnabled) {
    console.info('Job alert worker disabled');
    return null;
  }
  const task = cron.schedule(config.alertWorkerCron, () => {
    runAlertWorker().catch((error) => console.error('[job-alert-worker]', { name: error.name }));
  });
  console.info(`Job alert worker started (${config.alertWorkerCron})`);
  return task;
}

module.exports = { matchesAlert, dueSince, isDue, runAlertWorker, startAlertWorker, unsubscribeToken };

require('dotenv').config();

const prisma = require('../src/config/prisma');
const config = require('../src/config/env');
const { runAlertWorker } = require('../src/jobs/alertWorker');

async function main() {
  if (process.env.DEPLOY_ENV !== 'staging') throw new Error('This one-off command is restricted to DEPLOY_ENV=staging');
  if (!config.alertWorkerEnabled) throw new Error('Job alert worker is disabled; set ALERT_WORKER_ENABLED=true explicitly');
  const sent = await runAlertWorker(new Date());
  console.log(JSON.stringify({ status: 'completed', processedAlerts: sent }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});

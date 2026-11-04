require('dotenv').config();

const prisma = require('../src/config/prisma');
const { runAlertWorker } = require('../src/jobs/alertWorker');

async function main() {
  if (process.env.DEPLOY_ENV !== 'staging') throw new Error('This one-off command is restricted to DEPLOY_ENV=staging');
  const sent = await runAlertWorker(new Date());
  console.log(JSON.stringify({ status: 'completed', processedAlerts: sent }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});

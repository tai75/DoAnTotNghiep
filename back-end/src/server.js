const app = require('./app');
const config = require('./config/env');
const prisma = require('./config/prisma');
const { startAlertWorker } = require('./jobs/alertWorker');
const storage = require('./storage/localStorage');
const { recoverAiPermits, shutdownAiPermits } = require('./services/aiConsent.service');

let server;
let alertWorker;

async function start() {
  await storage.initialize();
  await recoverAiPermits();
  server = app.listen(config.port, () => {
    console.log(`Job Connect API listening on http://localhost:${config.port}`);
  });
  alertWorker = startAlertWorker();
}

start().catch(async (error) => {
  console.error({ name: error.name, message: error.message, component: 'storage-startup' });
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`${signal} received. Closing server...`);
  if (!server) return process.exit(0);
  server.close(async () => {
    alertWorker?.stop();
    await shutdownAiPermits({ waitMs: config.aiShutdownWaitMs });
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

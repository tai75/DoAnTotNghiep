const app = require('./app');
const config = require('./config/env');
const prisma = require('./config/prisma');

const server = app.listen(config.port, () => {
  console.log(`Job Connect API listening on http://localhost:${config.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received. Closing server...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

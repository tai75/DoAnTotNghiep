const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { assertQaDatabase, qaUrl } = require('./qa01-db.cjs');

const expectedRoot = path.resolve(os.tmpdir(), 'job-connect-qa01-storage');

async function main() {
  if (process.argv[2] !== 'reset') throw new Error('Usage: qa01-storage.cjs reset');
  if (!process.env.STORAGE_ROOT || path.resolve(process.env.STORAGE_ROOT) !== expectedRoot) {
    throw new Error(`QA storage safety stop: STORAGE_ROOT must equal ${expectedRoot}`);
  }
  const url = qaUrl();
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    await assertQaDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
  const temporaryRoot = path.resolve(os.tmpdir());
  if (path.dirname(expectedRoot) !== temporaryRoot || path.basename(expectedRoot) !== 'job-connect-qa01-storage') {
    throw new Error('QA storage safety stop: unexpected temporary target');
  }
  await fs.promises.rm(expectedRoot, { recursive: true, force: true });
  await fs.promises.mkdir(expectedRoot, { recursive: true });
  console.log(JSON.stringify({ status: 'PASS', command: 'qa-storage-reset', root: expectedRoot }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

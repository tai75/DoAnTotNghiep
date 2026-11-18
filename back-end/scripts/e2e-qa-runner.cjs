const path = require('node:path');
const { spawn } = require('node:child_process');
const { createGuardedClient, validateE2eEnvironment } = require('./e2e-guard.cjs');
const { validateExistingStorage } = require('./e2e-storage.cjs');
const { isolatedChildEnvironment } = require('./e2e-launcher.cjs');

const QA_FILES = Object.freeze([
  'tests/qa/application-state.qa.test.js',
  'tests/qa/interview-workflow.qa.test.js',
  'tests/qa/job-alert-outbox.qa.test.js',
  'tests/qa/job-write-atomic.qa.test.js',
  'tests/qa/notifications.qa.test.js',
  'tests/qa/password-recovery.qa.test.js',
  'tests/qa/talent-invitation.qa.test.js',
]);

async function main(environment = process.env, options = {}) {
  const target = validateE2eEnvironment(environment);
  const layout = await validateExistingStorage(environment, options.storageOptions);
  const guarded = await createGuardedClient(environment, { mode: 'canonical', clientFactory: options.clientFactory });
  await guarded.client.$disconnect();
  const childEnv = {
    ...isolatedChildEnvironment(environment, target, layout),
    E2E_DATABASE_URL: target.datasourceUrl,
    NODE_ENV: 'test',
    RUN_E2E_APPLICATION_STATE_TESTS: '1',
    RUN_E2E_INTERVIEW_TESTS: '1',
    RUN_E2E_ALERT_TESTS: '1',
    RUN_E2E_JOB_WRITE_TESTS: '1',
    RUN_E2E_NOTIFICATION_TESTS: '1',
    RUN_E2E_AUTH_TESTS: '1',
    RUN_E2E_INVITATION_TESTS: '1',
  };
  const executable = process.execPath;
  const vitest = path.resolve(__dirname, '../node_modules/vitest/vitest.mjs');
  const child = spawn(executable, [
    vitest, 'run', '--configLoader', 'native', '--maxWorkers=1', '--no-file-parallelism', ...QA_FILES,
  ], {
    cwd: path.resolve(__dirname, '..'), env: childEnv, shell: false, stdio: 'inherit',
  });
  child.on('exit', (code, signal) => process.exitCode = signal ? 1 : code);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  return child;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { QA_FILES, main };

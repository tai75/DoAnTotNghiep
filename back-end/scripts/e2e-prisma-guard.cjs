const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createGuardedClient, validateE2eEnvironment } = require('./e2e-guard.cjs')
const { assertLiveOwnership } = require('./e2e-process-guard.cjs')
const { validateExistingStorage } = require('./e2e-storage.cjs')

const SENSITIVE_DATABASE_ENV = Object.freeze([
  'DATABASE_URL',
  'E2E_DATABASE_URL',
  'E2E_DATABASE_USER',
  'E2E_MIGRATION_DATABASE_URL',
  'E2E_MIGRATION_DATABASE_USER',
  'E2E_PROVISIONING_DATABASE_URL',
  'E2E_PROVISIONING_DATABASE_USER',
  'MYSQL_PWD',
])

function redact(value, target) {
  let output = String(value || '')
  const url = target?.datasourceUrl ? new URL(target.datasourceUrl) : null
  const secrets = [url?.password, target?.datasourceUrl].filter(Boolean).sort((a, b) => b.length - a.length)
  for (const secret of secrets) output = output.split(secret).join('[REDACTED]')
  output = output.replace(/mysql:\/\/[^\s:@/]+:[^\s@/]+@/gi, 'mysql://[REDACTED]@')
  return output
}

function isolatedPrismaEnvironment(environment, target) {
  const validated = validateE2eEnvironment(environment)
  if (!target || target.datasourceUrl !== validated.datasourceUrl) throw new Error('Prisma target was not produced by the validated E2E datasource')
  const child = { ...environment }
  for (const name of SENSITIVE_DATABASE_ENV) delete child[name]
  child.DATABASE_URL = validated.datasourceUrl
  child.NODE_ENV = 'e2e-disposable'
  child.DOTENV_CONFIG_QUIET = 'true'
  return child
}

async function guardedPrismaPreflight(environment = process.env, options = {}) {
  const target = validateE2eEnvironment(environment)
  await (options.assertLiveOwnershipImpl || assertLiveOwnership)(environment, options.processOptions)
  await (options.validateExistingStorageImpl || validateExistingStorage)(environment, {
    repositoryRoot: options.repositoryRoot || path.resolve(__dirname, '../..'),
    ...(options.storageOptions || {}),
  })
  const guarded = await (options.createGuardedClientImpl || createGuardedClient)(environment, {
    mode: 'canonical',
    clientFactory: options.clientFactory,
  })
  try {
    if (guarded.target.datasourceUrl !== target.datasourceUrl) throw new Error('Runtime guard target changed during Prisma preflight')
    return target
  } finally {
    await guarded.client.$disconnect()
  }
}

function prismaArguments(command, options = {}) {
  const schema = path.resolve(options.schema || path.resolve(__dirname, '../prisma/schema.prisma'))
  if (command === 'validate') return ['validate', '--schema', schema]
  if (command === 'diff') {
    return ['migrate', 'diff', '--from-schema-datasource', schema, '--to-schema-datamodel', schema, '--exit-code']
  }
  throw new Error(`Unsupported guarded Prisma command: ${command}`)
}

function runPinnedPrisma(command, environment, target, options = {}) {
  const executable = options.executable || process.execPath
  const cli = options.cli || path.resolve(__dirname, '../node_modules/prisma/build/index.js')
  const args = [cli, ...prismaArguments(command, options)]
  const childEnv = isolatedPrismaEnvironment(environment, target)
  const result = (options.spawnSyncImpl || spawnSync)(executable, args, {
    cwd: options.cwd || path.resolve(__dirname, '..'),
    env: childEnv,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  })
  const stdout = redact(result.stdout, target)
  const stderr = redact(result.stderr, target)
  if (result.error) throw new Error(`Prisma ${command} could not start: ${redact(result.error.message, target)}`)
  if (result.signal || result.status !== 0) {
    const error = new Error(`Prisma ${command} failed (exit=${result.status}, signal=${result.signal || 'none'})`)
    error.exitCode = result.status
    error.stdout = stdout
    error.stderr = stderr
    throw error
  }
  return { command, exitCode: result.status, stdout, stderr }
}

async function runGuardedPrismaChecks(environment = process.env, options = {}) {
  const target = await guardedPrismaPreflight(environment, options)
  const validate = runPinnedPrisma('validate', environment, target, options)
  const diff = runPinnedPrisma('diff', environment, target, options)
  return {
    target: { host: target.host, port: target.port, database: target.database, user: target.user },
    validate: { exitCode: validate.exitCode, stdout: validate.stdout, stderr: validate.stderr },
    diff: { exitCode: diff.exitCode, stdout: diff.stdout, stderr: diff.stderr },
  }
}

async function main() {
  const command = process.argv[2]
  if (command !== 'check') throw new Error('Usage: e2e-prisma-guard.cjs check')
  const result = await runGuardedPrismaChecks()
  console.log(JSON.stringify({ status: 'PASS', ...result }))
}

if (require.main === module) main().catch((error) => {
  console.error(JSON.stringify({ status: 'FAIL', message: redact(error.message) }))
  process.exitCode = 1
})

module.exports = {
  SENSITIVE_DATABASE_ENV,
  guardedPrismaPreflight,
  isolatedPrismaEnvironment,
  prismaArguments,
  redact,
  runGuardedPrismaChecks,
  runPinnedPrisma,
}

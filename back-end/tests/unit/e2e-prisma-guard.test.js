import { describe, expect, it, vi } from 'vitest'
import prismaGuard from '../../scripts/e2e-prisma-guard.cjs'

const { guardedPrismaPreflight, isolatedPrismaEnvironment, runGuardedPrismaChecks, runPinnedPrisma } = prismaGuard

const password = 'synthetic-db-password-never-log'
const datasourceUrl = `mysql://job_connect_e2e_runner:${password}@127.0.0.1:3307/job_connect_e2e_disposable`

function environment(overrides = {}) {
  return {
    PATH: 'synthetic-path',
    DATABASE_URL: 'mysql://root:development@localhost:3306/job_connect',
    E2E_DATABASE_URL: datasourceUrl,
    E2E_DATABASE_USER: 'job_connect_e2e_runner',
    E2E_DATABASE_NAME: 'job_connect_e2e_disposable',
    E2E_DATABASE_HOST: '127.0.0.1',
    E2E_DATABASE_PORT: '3307',
    E2E_DESTRUCTIVE_CONFIRM: 'job_connect_e2e_disposable',
    E2E_RUN_ID: 'run-20261112-b2b1',
    E2E_MYSQL_INSTANCE_ROOT: 'C:/synthetic-owned-root',
    ...overrides,
  }
}

function target() {
  return {
    role: 'runner', database: 'job_connect_e2e_disposable', user: 'job_connect_e2e_runner',
    host: '127.0.0.1', port: 3307, datasourceUrl,
  }
}

function preflightOptions(overrides = {}) {
  const disconnect = vi.fn(async () => {})
  return {
    assertLiveOwnershipImpl: vi.fn(async () => ({ launcherPid: 1, serverPid: 2 })),
    validateExistingStorageImpl: vi.fn(async () => ({ root: 'synthetic' })),
    createGuardedClientImpl: vi.fn(async () => ({ target: target(), client: { $disconnect: disconnect } })),
    ...overrides,
  }
}

describe('guarded disposable Prisma datasource isolation', () => {
  it('accepts only the exact disposable URL and pins it into the child', () => {
    const child = isolatedPrismaEnvironment(environment(), target())
    expect(child.DATABASE_URL).toBe(datasourceUrl)
    expect(child.DATABASE_URL).not.toContain('localhost:3306')
  })

  it('fails when E2E_DATABASE_URL is missing instead of using ambient DATABASE_URL', () => {
    const env = environment()
    delete env.E2E_DATABASE_URL
    expect(() => isolatedPrismaEnvironment(env, target())).toThrow(/E2E_DATABASE_URL/)
  })

  it('removes ambient development credentials and all alternate database URLs', () => {
    const child = isolatedPrismaEnvironment(environment({
      E2E_MIGRATION_DATABASE_URL: 'mysql://development', MYSQL_PWD: 'development',
    }), target())
    expect(child.DATABASE_URL).toBe(datasourceUrl)
    expect(child.E2E_DATABASE_URL).toBeUndefined()
    expect(child.E2E_MIGRATION_DATABASE_URL).toBeUndefined()
    expect(child.MYSQL_PWD).toBeUndefined()
  })

  it.each([
    ['wrong host', { E2E_DATABASE_URL: datasourceUrl.replace('127.0.0.1', 'localhost'), E2E_DATABASE_HOST: 'localhost' }],
    ['wrong port', { E2E_DATABASE_URL: datasourceUrl.replace(':3307/', ':3306/'), E2E_DATABASE_PORT: '3306' }],
    ['wrong database', { E2E_DATABASE_URL: datasourceUrl.replace('job_connect_e2e_disposable', 'job_connect'), E2E_DATABASE_NAME: 'job_connect', E2E_DESTRUCTIVE_CONFIRM: 'job_connect' }],
    ['wrong user', { E2E_DATABASE_URL: datasourceUrl.replace('job_connect_e2e_runner', 'root'), E2E_DATABASE_USER: 'root' }],
  ])('rejects %s', (_name, overrides) => {
    expect(() => isolatedPrismaEnvironment(environment(overrides), target())).toThrow()
  })

  it('stops before Prisma when process ownership is missing', async () => {
    const spawnSyncImpl = vi.fn()
    await expect(runGuardedPrismaChecks(environment(), preflightOptions({
      assertLiveOwnershipImpl: vi.fn(async () => { throw new Error('ownership missing') }),
      spawnSyncImpl,
    }))).rejects.toThrow(/ownership missing/)
    expect(spawnSyncImpl).not.toHaveBeenCalled()
  })

  it('proves a development .env cannot select the child datasource', async () => {
    const observed = []
    const spawnSyncImpl = vi.fn((_exe, args, options) => {
      observed.push({ args, databaseUrl: options.env.DATABASE_URL, e2eUrl: options.env.E2E_DATABASE_URL })
      return { status: 0, signal: null, stdout: 'No difference detected.\n', stderr: '' }
    })
    await runGuardedPrismaChecks(environment({ DOTENV_CONFIG_PATH: 'C:/synthetic/.env-development' }), {
      ...preflightOptions(), spawnSyncImpl,
    })
    expect(observed).toHaveLength(2)
    expect(observed.every((item) => item.databaseUrl === datasourceUrl && item.e2eUrl === undefined)).toBe(true)
    expect(observed.every((item) => !item.args.join(' ').includes('3306') && !item.args.join(' ').includes(password))).toBe(true)
  })

  it('runs ownership, storage, and canonical runtime guards before returning a target', async () => {
    const options = preflightOptions()
    await expect(guardedPrismaPreflight(environment(), options)).resolves.toMatchObject({ port: 3307 })
    expect(options.assertLiveOwnershipImpl).toHaveBeenCalledOnce()
    expect(options.validateExistingStorageImpl).toHaveBeenCalledOnce()
    expect(options.createGuardedClientImpl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: 'canonical' }))
  })

  it('does not expose the password in output or thrown errors', () => {
    const result = runPinnedPrisma('validate', environment(), target(), {
      spawnSyncImpl: () => ({ status: 0, signal: null, stdout: `loaded ${datasourceUrl}`, stderr: password }),
    })
    expect(JSON.stringify(result)).not.toContain(password)
    expect(JSON.stringify(result)).not.toContain(datasourceUrl)
  })

  it('propagates a non-zero Prisma child exit without leaking its secret output', () => {
    let thrown
    try {
      runPinnedPrisma('diff', environment(), target(), {
        spawnSyncImpl: () => ({ status: 2, signal: null, stdout: password, stderr: datasourceUrl }),
      })
    } catch (error) { thrown = error }
    expect(thrown).toBeTruthy()
    expect(thrown.exitCode).toBe(2)
    expect(JSON.stringify(thrown)).not.toContain(password)
  })
})

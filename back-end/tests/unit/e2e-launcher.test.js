import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import launcher from '../../scripts/e2e-launcher.cjs'

const {
  E2E_AUTH_RATE_LIMIT_MODE,
  isolatedChildEnvironment,
  launchServer,
  validateApiRateLimitOverride,
  validateAuthRateLimitOverride,
  withoutDatabaseCredentials,
} = launcher

function validEnvironment(overrides = {}) {
  return {
    E2E_DATABASE_URL: 'mysql://job_connect_e2e_runner:synthetic@127.0.0.1:3307/job_connect_e2e_disposable',
    E2E_DATABASE_NAME: 'job_connect_e2e_disposable',
    E2E_DATABASE_USER: 'job_connect_e2e_runner',
    E2E_DATABASE_HOST: '127.0.0.1',
    E2E_DATABASE_PORT: '3307',
    E2E_DESTRUCTIVE_CONFIRM: 'job_connect_e2e_disposable',
    E2E_RUN_ID: 'run-20261112-test',
    E2E_API_BASE_URL: 'http://127.0.0.1:5102',
    E2E_FRONTEND_BASE_URL: 'http://127.0.0.1:5178',
    E2E_AUTH_RATE_LIMIT_MODE,
    E2E_AUTH_RATE_LIMIT_MAX: '200',
    E2E_API_RATE_LIMIT_MAX: '1000',
    E2E_JWT_SECRET: 'j'.repeat(32),
    E2E_PASSWORD: 'synthetic-password',
    ...overrides,
  }
}

const target = {
  datasourceUrl: 'mysql://job_connect_e2e_runner:synthetic@127.0.0.1:3307/job_connect_e2e_disposable',
  database: 'job_connect_e2e_disposable',
  user: 'job_connect_e2e_runner',
  host: '127.0.0.1',
  port: 3307,
}
const layout = { storageRoot: 'isolated-storage', legacyUploadsRoot: 'isolated-uploads', legacyLogosRoot: 'isolated-logos' }

async function loadRateLimitDefaults(nodeEnv) {
  const names = ['NODE_ENV', 'DATABASE_URL', 'JWT_SECRET', 'FRONTEND_URL', 'API_PUBLIC_URL', 'CORS_ORIGINS', 'STORAGE_ROOT', 'AUTH_RATE_LIMIT_MAX', 'API_RATE_LIMIT_MAX']
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    process.env.NODE_ENV = nodeEnv
    process.env.DATABASE_URL = 'mysql://synthetic:synthetic@127.0.0.1:3306/synthetic'
    process.env.JWT_SECRET = 'j'.repeat(32)
    process.env.FRONTEND_URL = nodeEnv === 'production' ? 'https://example.test' : 'http://127.0.0.1:5173'
    process.env.API_PUBLIC_URL = nodeEnv === 'production' ? 'https://api.example.test' : 'http://127.0.0.1:5000'
    process.env.CORS_ORIGINS = process.env.FRONTEND_URL
    process.env.STORAGE_ROOT = path.resolve('synthetic-storage')
    delete process.env.AUTH_RATE_LIMIT_MAX
    delete process.env.API_RATE_LIMIT_MAX
    vi.resetModules()
    const envModule = await import('../../src/config/env.js')
    const config = envModule.default || envModule
    return { api: config.apiRateLimitMax, auth: config.authRateLimitMax }
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
    vi.resetModules()
  }
}

describe('E2E launcher credential isolation', () => {
  it('removes runner, migrator, provisioning and ambient MySQL credentials', () => {
    const sanitized = withoutDatabaseCredentials({
      PATH: 'kept',
      DATABASE_URL: 'development',
      E2E_DATABASE_URL: 'runner',
      E2E_MIGRATION_DATABASE_URL: 'migrator',
      E2E_MIGRATION_DATABASE_USER: 'migrator-user',
      E2E_MIGRATION_APPROVED: 'approved',
      E2E_PROVISIONING_DATABASE_URL: 'provisioner',
      E2E_PROVISIONING_DATABASE_USER: 'provisioner-user',
      MYSQL_PWD: 'ambient-secret',
      E2E_JWT_SECRET: 'jwt-secret',
      E2E_PASSWORD: 'password',
      AUTH_RATE_LIMIT_MAX: '999',
      API_RATE_LIMIT_MAX: '9999',
      BIND_HOST: '0.0.0.0',
      PORT: '5000',
    });

    expect(sanitized).toEqual({ PATH: 'kept' });
  });

  it('injects only the guarded runner URL and disables external services', () => {
    const child = isolatedChildEnvironment({
      PATH: 'kept',
      DATABASE_URL: 'development',
      E2E_DATABASE_URL: 'runner-secret',
      E2E_MIGRATION_DATABASE_URL: 'migrator-secret',
      E2E_PROVISIONING_DATABASE_URL: 'provisioner-secret',
      MYSQL_PWD: 'ambient-secret',
      E2E_JWT_SECRET: 'j'.repeat(32),
      E2E_PASSWORD: 'synthetic-password',
      E2E_AUTH_RATE_LIMIT_MODE,
      E2E_AUTH_RATE_LIMIT_MAX: '200',
      E2E_API_RATE_LIMIT_MAX: '1000',
      E2E_DESTRUCTIVE_CONFIRM: 'job_connect_e2e_disposable',
      E2E_API_BASE_URL: 'http://127.0.0.1:5102',
      E2E_FRONTEND_BASE_URL: 'http://127.0.0.1:5178',
    }, target, layout);

    expect(child.DATABASE_URL).toBe(target.datasourceUrl);
    expect(child.E2E_DATABASE_URL).toBeUndefined();
    expect(child.E2E_MIGRATION_DATABASE_URL).toBeUndefined();
    expect(child.E2E_PROVISIONING_DATABASE_URL).toBeUndefined();
    expect(child.MYSQL_PWD).toBeUndefined();
    expect(child.E2E_JWT_SECRET).toBeUndefined();
    expect(child.E2E_PASSWORD).toBeUndefined();
    expect(child.GEMINI_API_KEY).toBe('');
    expect(child.SMTP_HOST).toBe('');
    expect(child.AUTH_RATE_LIMIT_MAX).toBe('200');
    expect(child.API_RATE_LIMIT_MAX).toBe('1000');
    expect(child.BIND_HOST).toBe('127.0.0.1');
    expect(child.PORT).toBe('5102');
  });
});

describe('guarded disposable rate-limit isolation', () => {
  it.each(['production', 'development', 'qa01'])('keeps the %s defaults unchanged', async (nodeEnv) => {
    expect(await loadRateLimitDefaults(nodeEnv)).toEqual({ api: 300, auth: 10 })
  })

  it('accepts a finite override only with the exact disposable target and loopback URLs', () => {
    expect(validateAuthRateLimitOverride(validEnvironment(), target, layout)).toMatchObject({ limit: 200 })
    expect(validateApiRateLimitOverride(validEnvironment(), target, layout)).toMatchObject({ limit: 200, apiLimit: 1000 })
  })

  it.each([
    ['missing mode', { E2E_AUTH_RATE_LIMIT_MODE: '' }],
    ['missing confirmation', { E2E_DESTRUCTIVE_CONFIRM: '' }],
    ['invalid value', { E2E_AUTH_RATE_LIMIT_MAX: 'disabled' }],
    ['excessive value', { E2E_AUTH_RATE_LIMIT_MAX: '201' }],
    ['non-loopback API', { E2E_API_BASE_URL: 'http://0.0.0.0:5102' }],
    ['non-loopback frontend', { E2E_FRONTEND_BASE_URL: 'http://localhost:5178' }],
  ])('rejects %s', (_name, overrides) => {
    expect(() => validateApiRateLimitOverride(validEnvironment(overrides), target, layout)).toThrow()
  })

  it.each(['', '0', '-1', 'Infinity', 'unlimited', '1000.5', '1201'])('rejects invalid global API limit %s', (value) => {
    expect(() => validateApiRateLimitOverride(validEnvironment({ E2E_API_RATE_LIMIT_MAX: value }), target, layout)).toThrow(/E2E_API_RATE_LIMIT_MAX/)
  })

  it.each([
    ['wrong database', { database: 'job_connect_qa01_e2e' }],
    ['wrong port', { port: 3306 }],
    ['wrong user', { user: 'root' }],
  ])('rejects %s', (_name, overrides) => {
    expect(() => validateApiRateLimitOverride(validEnvironment(), { ...target, ...overrides }, layout)).toThrow()
  })

  it('rejects a missing verified storage layout', () => {
    expect(() => validateApiRateLimitOverride(validEnvironment(), target, {})).toThrow(/storage/)
  })

  it('does not expose database credentials when override validation fails', () => {
    const credential = 'synthetic-do-not-log'
    const environment = validEnvironment({
      E2E_DATABASE_URL: `mysql://job_connect_e2e_runner:${credential}@127.0.0.1:3307/job_connect_e2e_disposable`,
      E2E_API_RATE_LIMIT_MAX: 'invalid',
    })
    let message = ''
    try { validateApiRateLimitOverride(environment, target, layout) } catch (error) { message = error.message }
    expect(message).not.toContain(credential)
  })

  it('runs the real launcher orchestration path and injects the override only after every guard passes', async () => {
    const order = []
    const disconnect = vi.fn(async () => { order.push('disconnect') })
    const spawned = { pid: 123 }
    const result = await launchServer(validEnvironment(), {
      assertLiveOwnershipImpl: vi.fn(async () => { order.push('ownership') }),
      validateExistingStorageImpl: vi.fn(async () => { order.push('storage'); return layout }),
      createGuardedClientImpl: vi.fn(async () => { order.push('canonical'); return { client: { $disconnect: disconnect } } }),
      spawnImpl: vi.fn((_executable, _args, options) => {
        order.push('spawn')
        expect(options.env.AUTH_RATE_LIMIT_MAX).toBe('200')
        expect(options.env.API_RATE_LIMIT_MAX).toBe('1000')
        expect(options.env.BIND_HOST).toBe('127.0.0.1')
        expect(options.env.DATABASE_URL).toContain('job_connect_e2e_disposable')
        expect(options.env.E2E_DATABASE_URL).toBeUndefined()
        return spawned
      }),
    })
    expect(result).toBe(spawned)
    expect(order).toEqual(['ownership', 'storage', 'canonical', 'disconnect', 'spawn'])
  })

  it('fails closed before spawn when ownership, storage, or canonical validation fails', async () => {
    for (const failingStep of ['ownership', 'storage', 'canonical']) {
      const spawnImpl = vi.fn()
      await expect(launchServer(validEnvironment(), {
        assertLiveOwnershipImpl: async () => { if (failingStep === 'ownership') throw new Error('ownership rejected') },
        validateExistingStorageImpl: async () => { if (failingStep === 'storage') throw new Error('storage rejected'); return layout },
        createGuardedClientImpl: async () => {
          if (failingStep === 'canonical') throw new Error('canonical rejected')
          return { client: { $disconnect: async () => {} } }
        },
        spawnImpl,
      })).rejects.toThrow(/rejected/)
      expect(spawnImpl).not.toHaveBeenCalled()
    }
  })

  it('fails closed before spawn when the global API override is invalid', async () => {
    const spawnImpl = vi.fn()
    await expect(launchServer(validEnvironment({ E2E_API_RATE_LIMIT_MAX: '1201' }), {
      assertLiveOwnershipImpl: async () => {},
      validateExistingStorageImpl: async () => layout,
      createGuardedClientImpl: async () => ({ client: { $disconnect: async () => {} } }),
      spawnImpl,
    })).rejects.toThrow(/E2E_API_RATE_LIMIT_MAX/)
    expect(spawnImpl).not.toHaveBeenCalled()
  })
})

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { launchServer } = require('../../back-end/scripts/e2e-launcher.cjs')
const { playwrightEnvironment } = require('./disposable-playwright-launcher.cjs')
const { artifactRunRoot, auditArtifactTree, prepareArtifactRoot, sanitizeText, secretsFromEnvironment } = require('./support/secure-artifacts.cjs')
const { runWhileCriticalChildrenAlive, spawnOwned, stopOwned, waitForReadiness } = require('./support/managed-process.cjs')

const execFileAsync = promisify(execFile)
const frontendRoot = path.resolve(__dirname, '..')
const authRoles = ['candidate', 'recruiter', 'admin']

function disposableRoot(environment) {
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(environment.E2E_RUN_ID || '')) throw new Error('Invalid E2E_RUN_ID')
  return path.resolve(require('node:os').tmpdir(), 'job-connect-e2e-disposable', environment.E2E_RUN_ID)
}

function probe(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => { response.resume(); resolve(response.statusCode < 500) })
    request.on('error', () => resolve(false))
    request.setTimeout(1000, () => { request.destroy(); resolve(false) })
  })
}

function exactAuthFiles(environment) {
  const root = path.join(disposableRoot(environment), 'auth')
  return authRoles.map((role) => path.join(root, `${role}.json`))
}

async function protectDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    fs.chmodSync(directory, 0o700)
    return
  }
  const currentUser = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
  if (!process.env.USERDOMAIN || !process.env.USERNAME) throw new Error('Cannot determine current Windows identity for artifact ACL')
  await execFileAsync('icacls.exe', [
    directory,
    '/inheritance:r',
    '/grant:r',
    `${currentUser}:(OI)(CI)F`,
    '*S-1-5-18:(OI)(CI)F',
    '*S-1-5-32-544:(OI)(CI)F',
  ], { windowsHide: true })
}

function removeAuthState(environment) {
  for (const file of exactAuthFiles(environment)) fs.rmSync(file, { force: true })
}

async function killTree(pid) {
  if (process.platform === 'win32') await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  else process.kill(pid, 'SIGKILL')
}

async function main(environment = process.env) {
  const secrets = secretsFromEnvironment(environment)
  const root = artifactRunRoot(path.join(disposableRoot(environment), 'artifacts'), environment.E2E_ARTIFACT_RUN_NAME)
  prepareArtifactRoot(root)
  await protectDirectory(root)
  await protectDirectory(path.join(disposableRoot(environment), 'auth'))
  const logFile = path.join(root, 'orchestration.log')
  const suppressedStreams = new Set()
  const write = (stream) => {
    if (suppressedStreams.has(stream)) return
    suppressedStreams.add(stream)
    fs.appendFileSync(logFile, `[${stream}] raw child output suppressed by security policy\n`, { encoding: 'utf8', mode: 0o600 })
  }
  const children = []
  let runError
  const cleanupErrors = []
  removeAuthState(environment)
  try {
    const backend = await launchServer(environment, { spawnImpl: (exe, args, options) => spawnOwned(exe, args, { ...options, write }) })
    children.push(backend)
    await waitForReadiness(backend, () => probe(environment.E2E_API_BASE_URL), 30000, 'backend')

    const viteCli = path.resolve(frontendRoot, 'node_modules/vite/bin/vite.js')
    const frontendEnv = playwrightEnvironment({ ...environment, VITE_API_PROXY_TARGET: environment.E2E_API_BASE_URL })
    delete frontendEnv.E2E_PASSWORD
    const frontend = spawnOwned(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', '5178', '--strictPort'], { cwd: frontendRoot, env: frontendEnv, write })
    children.push(frontend)
    await waitForReadiness(frontend, () => probe(environment.E2E_FRONTEND_BASE_URL), 30000, 'frontend')

    const cli = path.resolve(frontendRoot, 'node_modules/@playwright/test/cli.js')
    const config = path.resolve(frontendRoot, 'playwright.disposable.config.js')
    const browser = spawnOwned(process.execPath, [cli, 'test', `--config=${config}`, '--workers=1', '--retries=0'], {
      cwd: frontendRoot,
      env: playwrightEnvironment(environment),
      write,
    })
    children.push(browser)
    await runWhileCriticalChildrenAlive(browser, [{ child: backend, label: 'backend' }, { child: frontend, label: 'frontend' }])
  } catch (error) {
    runError = error
  } finally {
    removeAuthState(environment)
    for (const child of children.reverse()) {
      await stopOwned(child, { killTree }).catch((error) => { cleanupErrors.push(error); write('cleanup', `${error.message}\n`) })
    }
  }
  try {
    auditArtifactTree(root, secrets)
  } catch (auditError) {
    if (runError) auditError.cause = runError
    throw auditError
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Owned process cleanup failed')
  if (runError) throw runError
}

if (require.main === module) main().catch((error) => { console.error(sanitizeText(error.message, secretsFromEnvironment())); process.exitCode = 1 })

module.exports = { exactAuthFiles, main, protectDirectory, removeAuthState }

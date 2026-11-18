const { spawn } = require('node:child_process')

const owned = new WeakSet()

function spawnOwned(executable, args, options = {}) {
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  owned.add(child)
  const write = options.write || (() => {})
  child.stdout?.on('data', (chunk) => write('stdout', chunk))
  child.stderr?.on('data', (chunk) => write('stderr', chunk))
  return child
}

function exitResult(child) {
  if (child.exitCode !== null || child.signalCode) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

async function requireSuccessfulExit(child, label = 'child process') {
  const result = await exitResult(child)
  if (result.code !== 0 || result.signal) {
    throw new Error(`${label} exited unsuccessfully (code=${result.code}, signal=${result.signal || 'none'})`)
  }
  return result
}

async function waitForReadiness(child, probe, timeoutMs, label = 'child process') {
  const deadline = Date.now() + timeoutMs
  let settled = false
  const exited = exitResult(child).then((result) => { settled = true; return result })
  while (Date.now() < deadline) {
    if (settled || child.exitCode !== null || child.signalCode) {
      const result = await exited
      throw new Error(`${label} exited before readiness (code=${result.code}, signal=${result.signal || 'none'})`)
    }
    if (await probe()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${label} startup timeout`)
}

async function runWhileCriticalChildrenAlive(workChild, criticalChildren) {
  const work = requireSuccessfulExit(workChild, 'Playwright')
  const failures = criticalChildren.map(({ child, label }) => exitResult(child).then((result) => {
    throw new Error(`${label} died during browser execution (code=${result.code}, signal=${result.signal || 'none'})`)
  }))
  try {
    return await Promise.race([work, ...failures])
  } catch (error) {
    if (workChild.exitCode === null && !workChild.signalCode) workChild.kill('SIGTERM')
    throw error
  }
}

async function stopOwned(child, options = {}) {
  if (!child || child.exitCode !== null || child.signalCode) return false
  if (!owned.has(child)) throw new Error('Refusing to stop a process not owned by this runner')
  child.kill('SIGTERM')
  const timeoutMs = options.timeoutMs || 3000
  const exited = await Promise.race([
    exitResult(child).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ])
  if (!exited) {
    const killTree = options.killTree
    if (!killTree) throw new Error(`Owned process ${child.pid} did not stop`)
    await killTree(child.pid)
  }
  return true
}

module.exports = { exitResult, requireSuccessfulExit, runWhileCriticalChildrenAlive, spawnOwned, stopOwned, waitForReadiness }

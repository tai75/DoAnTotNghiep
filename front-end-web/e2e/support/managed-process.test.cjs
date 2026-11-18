const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { requireSuccessfulExit, runWhileCriticalChildrenAlive, spawnOwned, stopOwned, waitForReadiness } = require('./managed-process.cjs')

function synthetic(script, write = () => {}) {
  return spawnOwned(process.execPath, ['-e', script], { cwd: __dirname, env: process.env, write })
}

async function run() {
  const output = []
  await requireSuccessfulExit(synthetic("console.error('SMTP warning'); process.exit(0)", (stream, chunk) => output.push([stream, String(chunk)])), 'warning child')
  assert.match(output.map((entry) => entry[1]).join(''), /SMTP warning/)

  const alreadyExited = synthetic('process.exit(0)')
  await new Promise((resolve) => setTimeout(resolve, 100))
  await requireSuccessfulExit(alreadyExited, 'already exited child')

  await assert.rejects(requireSuccessfulExit(synthetic("console.error('fatal'); process.exit(7)"), 'fatal child'), /code=7/)

  const work = synthetic('setTimeout(() => process.exit(0), 5000)')
  const backend = synthetic('setTimeout(() => process.exit(3), 100)')
  await assert.rejects(runWhileCriticalChildrenAlive(work, [{ child: backend, label: 'backend' }]), /backend died/)
  if (work.exitCode === null) await stopOwned(work, { timeoutMs: 2000 })

  const timeoutChild = synthetic('setTimeout(() => process.exit(0), 5000)')
  await assert.rejects(waitForReadiness(timeoutChild, async () => false, 150, 'startup child'), /startup timeout/)
  await stopOwned(timeoutChild, { timeoutMs: 2000 })

  const owned = synthetic('setTimeout(() => process.exit(0), 5000)')
  await stopOwned(owned, { timeoutMs: 2000 })
  const external = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 5000)'], { stdio: 'ignore', windowsHide: true })
  await assert.rejects(stopOwned(external), /not owned/)
  assert.equal(external.exitCode, null)
  external.kill('SIGTERM')

  console.log('PASS: stderr warning, fatal exit, mid-run death, timeout, and owned cleanup checks')
}

run().catch((error) => { console.error(error); process.exitCode = 1 })

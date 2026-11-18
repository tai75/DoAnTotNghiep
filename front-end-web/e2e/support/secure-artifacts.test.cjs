const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const SecureReporter = require('./secure-reporter.cjs')
const { auditArtifactTree, sanitizeText, sensitiveMatches } = require('./secure-artifacts.cjs')

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'job-connect-artifact-test-'))
const canary = 'CANARY-secret-9f86d081884c'

try {
  const unsafe = `password=${canary}\nAuthorization: Bearer eyJabcdefgh.abcdefgh.abcdefgh\nCookie: job_connect_refresh=raw-token`
  const sanitized = sanitizeText(unsafe, [canary])
  assert.equal(sanitized.includes(canary), false)
  assert.equal(sensitiveMatches(sanitized, [canary]).length, 0)

  const rawRoot = path.join(temporaryRoot, 'raw')
  fs.mkdirSync(rawRoot)
  fs.writeFileSync(path.join(rawRoot, 'result.json'), JSON.stringify({ password: canary }))
  assert.throws(() => auditArtifactTree(rawRoot, [canary]), /Artifact security audit/)

  const archiveRoot = path.join(temporaryRoot, 'archive')
  fs.mkdirSync(archiveRoot)
  fs.writeFileSync(path.join(archiveRoot, 'trace.zip'), 'not a real zip')
  assert.throws(() => auditArtifactTree(archiveRoot, [canary]), /Artifact security audit/)

  const safeRoot = path.join(temporaryRoot, 'safe')
  fs.mkdirSync(safeRoot)
  fs.writeFileSync(path.join(safeRoot, 'result.json'), JSON.stringify({ error: sanitized }))
  assert.deepEqual(auditArtifactTree(safeRoot, [canary]).findings, 0)

  const reporterRoot = path.join(temporaryRoot, 'reporter')
  const outputFile = path.join(reporterRoot, 'results.json')
  const previous = process.env.E2E_PASSWORD
  process.env.E2E_PASSWORD = canary
  const reporter = new SecureReporter({ outputFile })
  reporter.onBegin({}, { allTests: () => [{}] })
  reporter.onStdOut(canary)
  reporter.onStdErr(canary)
  reporter.onTestEnd({ id: '1', titlePath: () => [`login ${canary}`], parent: { project: () => ({ name: 'test' }) } }, {
    status: 'failed', duration: 1, errors: [{ message: `password=${canary}`, stack: `Authorization: Bearer ${canary}` }],
  })
  reporter.onEnd({ status: 'failed' })
  if (previous === undefined) delete process.env.E2E_PASSWORD
  else process.env.E2E_PASSWORD = previous
  const report = fs.readFileSync(outputFile, 'utf8')
  assert.equal(report.includes(canary), false)
  assert.deepEqual(auditArtifactTree(reporterRoot, [canary]).findings, 0)
  console.log('PASS: secure artifact canary, reporter redaction, and prohibited trace checks')
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

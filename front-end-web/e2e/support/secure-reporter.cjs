const fs = require('node:fs')
const path = require('node:path')
const { sanitizeText, secretsFromEnvironment } = require('./secure-artifacts.cjs')

class SecureReporter {
  constructor(options = {}) {
    if (!options.outputFile) throw new Error('Secure reporter yêu cầu outputFile')
    this.outputFile = path.resolve(options.outputFile)
    this.secrets = secretsFromEnvironment()
    this.tests = []
    this.startedAt = new Date().toISOString()
  }

  onBegin(_config, suite) {
    this.total = suite.allTests().length
    process.stdout.write(`Running ${this.total} tests with secure reporter\n`)
  }

  onStdOut() {}
  onStdErr() {}

  onTestEnd(test, result) {
    const title = sanitizeText(test.titlePath().join(' › '), this.secrets)
    const errors = (result.errors || []).map(() => ({ message: '[REDACTED_ERROR_DETAILS]' }))
    this.tests.push({
      id: test.id,
      project: test.parent?.project()?.name || '',
      title,
      status: result.status,
      duration: result.duration,
      errors,
    })
    process.stdout.write(`${result.status.toUpperCase()}: ${title}\n`)
  }

  async onEnd(result) {
    const payload = {
      version: 1,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      status: result.status,
      total: this.total,
      tests: this.tests,
    }
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true, mode: 0o700 })
    fs.writeFileSync(this.outputFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  }

  printsToStdio() { return true }
}

module.exports = SecureReporter

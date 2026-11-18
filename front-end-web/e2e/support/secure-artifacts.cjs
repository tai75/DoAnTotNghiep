const fs = require('node:fs')
const path = require('node:path')

const SECRET_ENV_NAMES = Object.freeze([
  'E2E_PASSWORD', 'E2E_JWT_SECRET', 'JWT_SECRET', 'DATABASE_URL', 'E2E_DATABASE_URL',
  'E2E_MIGRATION_DATABASE_URL', 'E2E_PROVISIONING_DATABASE_URL', 'MYSQL_PWD',
])
const TEXT_EXTENSIONS = new Set(['.json', '.log', '.md', '.txt', '.html', '.xml'])
const PROHIBITED_EXTENSIONS = new Set(['.zip', '.har', '.webm'])

function validateArtifactRunName(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{7,63}$/.test(value)) {
    throw new Error('E2E_ARTIFACT_RUN_NAME không hợp lệ')
  }
  return value
}

function artifactRunRoot(baseRoot, runName) {
  const base = path.resolve(baseRoot)
  const root = path.resolve(base, 'executions', validateArtifactRunName(runName))
  const relative = path.relative(base, root)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Artifact run root nằm ngoài allowlist')
  return root
}

function secretsFromEnvironment(environment = process.env) {
  return SECRET_ENV_NAMES.map((name) => environment[name]).filter((value) => typeof value === 'string' && value.length >= 4)
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function sanitizeText(value, secrets = []) {
  let result = String(value ?? '')
  for (const secret of [...new Set(secrets)].sort((left, right) => right.length - left.length)) {
    result = result.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]')
  }
  return result
    .replace(/(authorization\s*:\s*bearer)\s+[^\s\r\n]+/gi, '$1 [REDACTED]')
    .replace(/((?:set-)?cookie\s*:)\s*[^\r\n]+/gi, '$1 [REDACTED]')
    .replace(/job_connect_refresh=[^;\s]+/gi, 'job_connect_refresh=[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]')
    .replace(/mysql:\/\/[^\s:@/]+:[^\s@/]+@/gi, 'mysql://[REDACTED]@')
    .replace(/(["']?(?:password|refreshToken|accessToken|authorization|cookie|secret|databaseUrl)["']?\s*[:=]\s*["'])[^"'\r\n]*(["'])/gi, '$1[REDACTED]$2')
    .replace(/([?&](?:token|password|secret)=)[^&\s]+/gi, '$1[REDACTED]')
}

function sensitiveMatches(value, secrets = []) {
  const text = String(value ?? '')
  const matches = []
  for (const secret of secrets) if (secret && text.includes(secret)) matches.push('exact-secret')
  const authorization = text.match(/authorization\s*:\s*bearer\s+([^\s\r\n]+)/i)
  if (authorization && !authorization[1].startsWith('[REDACTED')) matches.push('authorization')
  const cookies = [...text.matchAll(/(?:set-)?cookie\s*:\s*([^\r\n]+)/gi)]
  if (cookies.some((match) => !match[1].trim().startsWith('[REDACTED')) || /job_connect_refresh=(?!\[REDACTED)/i.test(text)) matches.push('cookie')
  if (/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(text)) matches.push('jwt')
  if (/mysql:\/\/[^\s:@/]+:[^\s@/]+@/i.test(text)) matches.push('database-url')
  if (/(["']?(?:password|refreshToken|accessToken|secret)["']?\s*[:=]\s*["'])(?!\[REDACTED\])[^"'\r\n]+/i.test(text)) matches.push('sensitive-field')
  return [...new Set(matches)]
}

function prepareArtifactRoot(root) {
  const resolved = path.resolve(root)
  if (fs.existsSync(resolved)) throw new Error(`Artifact execution root đã tồn tại: ${resolved}`)
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 })
  return resolved
}

function walkFiles(root, files = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    const stat = fs.lstatSync(target)
    if (stat.isSymbolicLink()) throw new Error(`Artifact chứa symlink: ${target}`)
    if (entry.isDirectory()) walkFiles(target, files)
    else if (entry.isFile()) files.push(target)
  }
  return files
}

function auditArtifactTree(root, secrets = []) {
  const findings = []
  for (const file of walkFiles(path.resolve(root))) {
    const extension = path.extname(file).toLowerCase()
    if (PROHIBITED_EXTENSIONS.has(extension)) findings.push({ file: path.relative(root, file), reasons: ['prohibited-archive-or-video'] })
    if (TEXT_EXTENSIONS.has(extension)) {
      const reasons = sensitiveMatches(fs.readFileSync(file, 'utf8'), secrets)
      if (reasons.length) findings.push({ file: path.relative(root, file), reasons })
    }
  }
  if (findings.length) {
    const error = new Error(`Artifact security audit thất bại: ${findings.length} file không an toàn`)
    error.findings = findings
    throw error
  }
  return { files: walkFiles(path.resolve(root)).length, findings: 0 }
}

module.exports = {
  SECRET_ENV_NAMES,
  artifactRunRoot,
  auditArtifactTree,
  prepareArtifactRoot,
  sanitizeText,
  secretsFromEnvironment,
  sensitiveMatches,
  validateArtifactRunName,
}

import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/job_connect_test'
process.env.JWT_SECRET = 'storage-unit-test-secret-that-is-long-enough'
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'job-connect-storage-unit-'))
const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'job-connect-storage-legacy-'))
process.env.STORAGE_ROOT = storageRoot
process.env.UPLOADS_DIRECTORY = legacyRoot
process.env.LOGOS_DIRECTORY = legacyRoot

let storage
let maintenance
let validation

beforeAll(async () => {
  storage = (await import('../../src/storage/localStorage.js')).default
  maintenance = (await import('../../src/storage/maintenance.js')).default
  validation = (await import('../../src/storage/fileValidation.js')).default
  await storage.initialize()
})

afterAll(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true })
  fs.rmSync(legacyRoot, { recursive: true, force: true })
})

describe('local storage adapter', () => {
  it('uses opaque unique keys and never accepts traversal or absolute references', async () => {
    const first = storage.createKey('.pdf')
    const second = storage.createKey('.pdf')
    expect(first).not.toBe(second)
    await Promise.all([
      storage.put(storage.namespaces.resumes, first, Buffer.from('first')),
      storage.put(storage.namespaces.resumes, second, Buffer.from('second'))
    ])
    expect(await storage.read(storage.namespaces.resumes, first)).toEqual(Buffer.from('first'))
    await expect(storage.locate(storage.namespaces.resumes, '../secret.pdf')).resolves.toBeNull()
    await expect(storage.locate(storage.namespaces.resumes, 'C:\\secret.pdf')).resolves.toBeNull()
    expect(() => storage.assertManagedKey('../secret.pdf')).toThrow('Invalid storage key')
  })

  it('refuses key collisions and treats legacy files as read-only', async () => {
    const key = storage.createKey('.pdf')
    await storage.put(storage.namespaces.resumes, key, Buffer.from('original'))
    await expect(storage.put(storage.namespaces.resumes, key, Buffer.from('replacement'))).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await storage.read(storage.namespaces.resumes, key)).toEqual(Buffer.from('original'))

    const legacyKey = `${'a'.repeat(32)}.pdf`
    fs.writeFileSync(path.join(legacyRoot, legacyKey), 'legacy')
    await expect(storage.removeManaged(storage.namespaces.resumes, legacyKey)).resolves.toEqual({ removed: false, reason: 'legacy' })
    expect(fs.existsSync(path.join(legacyRoot, legacyKey))).toBe(true)
  })
})

describe('content validation', () => {
  it('rejects extension-like content with invalid magic bytes', () => {
    expect(validation.validPdf(Buffer.from('fake %%EOF'))).toBe(false)
    expect(validation.validLogo(Buffer.from('not png'), 'image/png')).toBe(false)
    expect(validation.validLogo(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg')).toBe(false)
  })
})

describe('backup, restore and reconciliation', () => {
  it('backs up and restores synthetic files with verified checksums', async () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'job-connect-storage-source-'))
    const backupRoot = path.join(os.tmpdir(), `job-connect-storage-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const restoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'job-connect-storage-restore-'))
    try {
      fs.mkdirSync(path.join(source, 'resumes'))
      fs.mkdirSync(path.join(source, 'logos'))
      const resumeKey = `${crypto.randomUUID()}.pdf`
      const logoKey = `${crypto.randomUUID()}.png`
      fs.writeFileSync(path.join(source, 'resumes', resumeKey), 'synthetic cv')
      fs.writeFileSync(path.join(source, 'logos', logoKey), 'synthetic logo')
      const manifest = await maintenance.backup({ sourceRoot: source, destination: backupRoot, databaseSnapshotId: 'qa-snapshot-001' })
      expect(manifest.files).toHaveLength(2)
      await expect(maintenance.verify(backupRoot)).resolves.toMatchObject({ valid: true })
      await expect(maintenance.restore({ backupRoot, targetRoot: restoreRoot, expectedDatabaseSnapshotId: 'wrong-snapshot' })).rejects.toThrow('Database snapshot ID does not match')
      await expect(maintenance.restore({ backupRoot, targetRoot: restoreRoot, expectedDatabaseSnapshotId: 'qa-snapshot-001' })).resolves.toEqual({ restored: 2, databaseSnapshotId: 'qa-snapshot-001' })
      expect(fs.readFileSync(path.join(restoreRoot, 'resumes', resumeKey), 'utf8')).toBe('synthetic cv')
      fs.writeFileSync(path.join(backupRoot, 'resumes', resumeKey), 'corrupt')
      await expect(maintenance.verify(backupRoot)).resolves.toMatchObject({ valid: false, failures: [`resumes/${resumeKey}`] })
    } finally {
      fs.rmSync(source, { recursive: true, force: true })
      fs.rmSync(backupRoot, { recursive: true, force: true })
      fs.rmSync(restoreRoot, { recursive: true, force: true })
    }
  })

  it('reports missing and orphan files without deleting them', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'job-connect-storage-inventory-'))
    try {
      fs.mkdirSync(path.join(root, 'resumes'))
      fs.writeFileSync(path.join(root, 'resumes', 'orphan.pdf'), 'orphan')
      const result = await maintenance.inventory(root, ['resumes/missing.pdf'])
      expect(result.orphaned).toEqual(['resumes/orphan.pdf'])
      expect(result.missing).toEqual(['resumes/missing.pdf'])
      expect(fs.existsSync(path.join(root, 'resumes', 'orphan.pdf'))).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a crafted restore manifest before writing outside the target', async () => {
    const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'job-connect-storage-crafted-'))
    const restoreRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'job-connect-storage-crafted-restore-'))
    try {
      fs.writeFileSync(path.join(backupRoot, 'manifest.json'), JSON.stringify({
        version: 1,
        databaseSnapshotId: 'qa-snapshot-001',
        files: [{ path: 'resumes/../../escape.pdf', size: 0, sha256: '0'.repeat(64) }]
      }))
      await expect(maintenance.verify(backupRoot)).resolves.toMatchObject({ valid: false })
      await expect(maintenance.restore({
        backupRoot, targetRoot: restoreRoot, expectedDatabaseSnapshotId: 'qa-snapshot-001'
      })).rejects.toThrow('Backup verification failed')
      expect(fs.readdirSync(restoreRoot)).toEqual([])
    } finally {
      fs.rmSync(backupRoot, { recursive: true, force: true })
      fs.rmSync(restoreRoot, { recursive: true, force: true })
    }
  })
})

import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import storageGuard from '../../scripts/e2e-storage.cjs'

const {
  validateRunId,
  storageLayout,
  validateStorageRoot,
  assertNoReparsePoints,
  validateMarker,
  readAndValidateMarker,
  acquireRunLock,
} = storageGuard

const runId = 'run-20261112-a1'
const tempRoot = path.resolve('C:/synthetic-temp')
const repositoryRoot = path.resolve('C:/workspace/JobConnect')

describe('disposable E2E storage path guard', () => {
  it.each(['../escape', '..\\escape', '/absolute', 'short', 'run_with_underscore'])('rejects traversal or invalid run id %s', (value) => {
    expect(() => validateRunId(value)).toThrow()
  })

  it('accepts only the exact derived root under OS temp', () => {
    const layout = storageLayout(runId, { tempRoot })
    expect(validateStorageRoot(layout.root, runId, { tempRoot, repositoryRoot }).root).toBe(layout.root)
    expect(() => validateStorageRoot(repositoryRoot, runId, { tempRoot, repositoryRoot })).toThrow()
  })

  it('rejects the QA-01 storage path', () => {
    const qaRoot = path.join(tempRoot, 'job-connect-qa01-storage')
    expect(() => validateStorageRoot(qaRoot, runId, { tempRoot, repositoryRoot })).toThrow()
  })

  it('rejects symlink, junction or reparse point segments', async () => {
    const symbolic = { isSymbolicLink: () => true }
    await expect(assertNoReparsePoints(storageLayout(runId, { tempRoot }).root, { lstat: vi.fn().mockResolvedValue(symbolic) })).rejects.toThrow(/symlink|junction|reparse/)
  })
})

describe('disposable E2E marker and lock guard', () => {
  const layout = storageLayout(runId, { tempRoot })
  const validMarker = { version: 1, runId, database: 'job_connect_e2e_disposable' }

  it('rejects missing marker', async () => {
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' })
    await expect(readAndValidateMarker(layout, runId, { readFile: vi.fn().mockRejectedValue(error) })).rejects.toThrow(/Thiếu/)
  })

  it('rejects marker mismatch', () => {
    expect(() => validateMarker({ ...validMarker, database: 'job_connect_qa01_e2e' }, runId)).toThrow(/không khớp/)
    expect(() => validateMarker({ ...validMarker, runId: 'run-another-01' }, runId)).toThrow(/không khớp/)
  })

  it('rejects a concurrent run lock', async () => {
    const error = Object.assign(new Error('exists'), { code: 'EEXIST' })
    await expect(acquireRunLock(layout, runId, { open: vi.fn().mockRejectedValue(error) })).rejects.toThrow(/đang bị lock/)
  })

  it('uses one database-wide lock for different run IDs', () => {
    const another = storageLayout('run-20261112-b2', { tempRoot })
    expect(another.lockPath).toBe(layout.lockPath)
    expect(another.root).not.toBe(layout.root)
  })
})

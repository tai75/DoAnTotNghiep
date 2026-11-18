import { describe, expect, it } from 'vitest'
import rotation from '../../scripts/e2e-credential-rotation.cjs'

const { querySessions, validateRunnerGrants, validateUsers } = rotation

const hash = '$2b$12$012345678901234567890u123456789012345678901234567890123'
const users = [
  { id: 176, email: 'candidate@jobconnect.local', role: 'CANDIDATE', status: 'ACTIVE', passwordHash: hash, candidateProfiles: 1, recruiterProfiles: 0 },
  { id: 177, email: 'recruiter@jobconnect.local', role: 'RECRUITER', status: 'ACTIVE', passwordHash: hash, candidateProfiles: 0, recruiterProfiles: 1 },
  { id: 178, email: 'admin@jobconnect.local', role: 'ADMIN', status: 'ACTIVE', passwordHash: hash, candidateProfiles: 0, recruiterProfiles: 0 },
]

describe('guarded synthetic credential rotation', () => {
  it('accepts only the exact three fixture identities', () => {
    expect(validateUsers(users)).toBe(true)
    expect(() => validateUsers(users.map((row) => row.id === 177 ? { ...row, role: 'ADMIN' } : row))).toThrow(/identity mismatch/)
  })

  it('requires scoped DML-only runner grants', () => {
    expect(validateRunnerGrants([
      { grant: "GRANT USAGE ON *.* TO `job_connect_e2e_runner`@`127.0.0.1`" },
      { grant: "GRANT SELECT, INSERT, UPDATE, DELETE ON `job_connect_e2e_disposable`.* TO `job_connect_e2e_runner`@`127.0.0.1`" },
    ])).toBe(true)
    expect(() => validateRunnerGrants([{ grant: 'GRANT ALL PRIVILEGES ON *.* TO runner' }])).toThrow()
  })

  it('classifies active, expired, and revoked refresh sessions without exposing tokens', async () => {
    const future = new Date(Date.now() + 60_000)
    const past = new Date(Date.now() - 60_000)
    const client = { $queryRawUnsafe: async () => [
      { id: 1, userId: 176, expiresAt: future, revokedAt: null },
      { id: 2, userId: 176, expiresAt: past, revokedAt: null },
      { id: 3, userId: 177, expiresAt: future, revokedAt: new Date() },
    ] }
    const rows = await querySessions(client)
    expect(rows).toEqual([
      expect.objectContaining({ userId: 176, total: 2, active: 1, expired: 1, revoked: 0 }),
      expect.objectContaining({ userId: 177, total: 1, active: 0, expired: 0, revoked: 1 }),
      expect.objectContaining({ userId: 178, total: 0, active: 0, expired: 0, revoked: 0 }),
    ])
    expect(JSON.stringify(rows)).not.toContain('token')
  })
})

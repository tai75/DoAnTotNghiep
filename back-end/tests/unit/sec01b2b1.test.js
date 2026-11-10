import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/job_connect'
process.env.JWT_SECRET = 'test-secret'

const authModule = await import('../../src/middleware/auth.js')
const { recruiterCompanyAccess } = authModule.default || authModule
const root = path.resolve(import.meta.dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('SEC-01B2B1 company verification and candidate privacy', () => {
  it('enforces ACTIVE/VERIFIED and never lets SUSPENDED bypass verification', () => {
    expect(recruiterCompanyAccess({ status: 'ACTIVE', verificationStatus: 'VERIFIED' }, true)).toEqual({ allowed: true })
    expect(recruiterCompanyAccess({ status: 'ACTIVE', verificationStatus: 'UNVERIFIED' }, true)).toMatchObject({ allowed: false, reason: 'UNVERIFIED' })
    expect(recruiterCompanyAccess({ status: 'SUSPENDED', verificationStatus: 'VERIFIED' }, true)).toEqual({ allowed: false, reason: 'SUSPENDED' })
  })

  it('makes only new candidates private and preserves existing values', () => {
    const migration = read('prisma/migrations/20261110150000_add_company_verification_and_candidate_privacy/migration.sql')
    expect(migration).toContain('ALTER COLUMN `is_searchable` SET DEFAULT false')
    expect(migration).not.toMatch(/UPDATE\s+`?candidates`?/i)
    expect(read('src/routes/auth.routes.js')).toContain('isSearchable: false')
  })

  it('backfills only active legacy companies with recruiter and job history', () => {
    const migration = read('prisma/migrations/20261110150000_add_company_verification_and_candidate_privacy/migration.sql')
    expect(migration).toContain("`verification_source` = 'LEGACY_BACKFILL'")
    expect(migration).toContain("`company`.`status` = 'ACTIVE'")
    expect(migration).toMatch(/EXISTS .*`recruiters`/s)
    expect(migration).toMatch(/EXISTS .*`jobs`/s)
    expect(migration).not.toContain('reviewed_by_user_id` =')
  })

  it('uses CAS for submission and admin decision and publishes only verified companies', () => {
    const companies = read('src/routes/companies.routes.js')
    const admin = read('src/routes/admin.routes.js')
    expect(companies).toContain('verificationVersion: company.verificationVersion')
    expect(companies).toContain("verificationStatus: { in: ['UNVERIFIED', 'REJECTED'] }")
    expect(admin).toContain("status: 'PENDING', companyVersion: current.companyVersion")
    expect(admin).toContain("verificationStatus: 'PENDING', verificationVersion: current.companyVersion")
    expect(admin).toContain("job.company.verificationStatus !== 'VERIFIED'")
  })

  it('protects every recruiter private-data surface with the centralized verification middleware', () => {
    for (const file of ['applications.routes.js', 'candidates.routes.js', 'conversations.routes.js', 'interviews.routes.js', 'recommendations.routes.js', 'recruiters.routes.js']) {
      expect(read(`src/routes/${file}`), file).toContain('requireVerifiedRecruiterCompany')
    }
  })
})

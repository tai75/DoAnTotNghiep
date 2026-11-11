import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/job_connect_test'
process.env.JWT_SECRET = 'unit-test-secret'
process.env.GEMINI_API_KEY = 'mock-gemini-key'
process.env.GEMINI_EMBEDDING_MODEL = 'mock-embedding-model'
process.env.MATCHING_V2_ENABLED = 'true'

const { calculateWeightedV2 } = await import('../../src/services/matching.service.js')
const config = (await import('../../src/config/env.js')).default

describe('matching V2 embedding cache', () => {
  const { runWithAiPermit } = require('../helpers/aiPermitFake')
  const permittedV2 = (candidateValue, jobValue, dependencies = {}) => runWithAiPermit('SEMANTIC_MATCHING',
    () => calculateWeightedV2(candidateValue, jobValue, prisma, dependencies)).then(({ result }) => result)
  const cache = new Map()
  const prisma = {
    embeddingCache: {
      findUnique: vi.fn(async ({ where }) => cache.get(where.contentHash) || null),
      upsert: vi.fn(async ({ where, create }) => {
        cache.set(where.contentHash, create)
        return create
      })
    }
  }
  const candidate = {
    headline: 'Node.js engineer', desiredPosition: 'Backend Engineer', yearsExperience: 3,
    skills: [{ skill: { id: 1, name: 'Node.js' } }], educations: [], experiences: [], projects: []
  }
  const job = {
    title: 'Backend Engineer', description: 'Build Node.js APIs', requiredYearsExperience: 2,
    skills: [{ skill: { id: 1, name: 'Node.js' }, isRequired: true }]
  }

  beforeEach(() => {
    config.matchingV2Enabled = true
    cache.clear()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: { values: [1, 0.5, 0.25] } })
    })))
  })

  it('blocks legacy V2 before any provider or cache call when disabled', async () => {
    await expect(calculateWeightedV2(candidate, job, prisma, { versionEnabled: false })).rejects.toMatchObject({
      code: 'matching_version_disabled',
      statusCode: 410,
      version: 'v2'
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(prisma.embeddingCache.findUnique).not.toHaveBeenCalled()
  })

  it('reuses embeddings for unchanged content and creates a new cache key when job content changes', async () => {
    const first = await permittedV2(candidate, job)
    const second = await permittedV2(candidate, job)
    const changed = await permittedV2(candidate, { ...job, title: 'Senior Platform Engineer', description: 'Build Node.js APIs and event streams' })

    expect(first.algorithmVersion).toBe('weighted-v2')
    expect(first.semanticScore).toBe(100)
    expect(second.score).toBe(first.score)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(cache.size).toBe(3)
    const serializedCache = JSON.parse(JSON.stringify([...cache.values()]))
    expect(serializedCache.every((entry) => entry.vector.every(Number.isFinite))).toBe(true)
    expect(changed.algorithmVersion).toBe('weighted-v2')
  })

  it('returns a finite weighted score when matchedSkills contains objects', async () => {
    const result = await permittedV2(candidate, job)
    const breakdown = [
      result.score, result.skillScore, result.experienceScore, result.positionScore,
      result.locationScore, result.salaryScore, result.employmentScore, result.semanticScore
    ]

    expect(result.matchedSkills).toHaveLength(1)
    expect(breakdown.every(Number.isFinite)).toBe(true)
    expect(result.score).toBe(92.5)
    expect(JSON.parse(JSON.stringify(result)).score).toBe(92.5)
  })

  it('returns a finite weighted score when missingSkills contains objects', async () => {
    const result = await permittedV2({ ...candidate, skills: [] }, job)
    const breakdown = [
      result.score, result.skillScore, result.experienceScore, result.positionScore,
      result.locationScore, result.salaryScore, result.employmentScore, result.semanticScore
    ]

    expect(result.missingSkills).toHaveLength(1)
    expect(breakdown.every((value) => Number.isFinite(value) && value >= 0 && value <= 100)).toBe(true)
    expect(result.score).toBe(60.5)
  })

  it('accepts nullable optional collections without producing non-finite scores', async () => {
    const result = await permittedV2({
      ...candidate, skills: null, educations: null, experiences: undefined, projects: null
    }, { ...job, skills: null, requiredYearsExperience: 0 })

    expect([
      result.score, result.skillScore, result.experienceScore, result.positionScore,
      result.locationScore, result.salaryScore, result.employmentScore, result.semanticScore
    ].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)).toBe(true)
  })

  it('rejects an invalid cached vector instead of converting it to a zero score', async () => {
    await permittedV2(candidate, job)
    for (const cached of cache.values()) cached.vector = [1, null]

    await expect(permittedV2(candidate, job)).rejects.toThrow('mảng số hữu hạn')
  })

  it('aborts legacy V2 provider calls after a finite timeout', async () => {
    const fetchImpl = vi.fn(async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    }))

    await expect(permittedV2(candidate, job, { versionEnabled: true, fetchImpl, timeoutMs: 5 })).rejects.toMatchObject({ code: 'timeout' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

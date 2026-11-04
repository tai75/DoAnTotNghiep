import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/job_connect_test'
process.env.JWT_SECRET = 'unit-test-secret'
process.env.GEMINI_API_KEY = 'mock-gemini-key'
process.env.GEMINI_EMBEDDING_V3_MODEL = 'gemini-embedding-2'
process.env.GEMINI_EMBEDDING_V3_MODEL_VERSION = 'gemini-embedding-2'
process.env.GEMINI_EMBEDDING_V3_DIMENSIONS = '768'
process.env.GEMINI_EMBEDDING_TIMEOUT_MS = '50'
process.env.GEMINI_EMBEDDING_MAX_RETRIES = '0'
process.env.GEMINI_EMBEDDING_RETRY_BASE_MS = '0'
process.env.MATCHING_V2_WEIGHTS = ''
process.env.MATCHING_V3_ENABLED = 'true'

const config = (await import('../../src/config/env.js')).default
const {
  buildEmbeddingCacheIdentity,
  embeddingForV3,
  embeddingV3Config,
  requestEmbedding
} = await import('../../src/services/embedding.service.js')
const { ALGORITHM_V3, calculateWeightedV3 } = await import('../../src/services/matching.service.js')

function unitVector(size = 768, index = 0) {
  return Array.from({ length: size }, (_, position) => position === index ? 1 : 0)
}

function createPrisma(cache = new Map()) {
  return {
    cache,
    embeddingCache: {
      findUnique: vi.fn(async ({ where }) => cache.get(where.contentHash) || null),
      upsert: vi.fn(async ({ where, create, update }) => {
        const value = cache.has(where.contentHash) ? { ...cache.get(where.contentHash), ...update } : create
        cache.set(where.contentHash, value)
        return value
      })
    }
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

describe('Gemini embedding V3 migration', () => {
  beforeEach(() => {
    config.geminiApiKey = 'mock-gemini-key'
    config.matchingV3Enabled = true
    vi.restoreAllMocks()
  })

  it('does not call the provider when V3 is not explicitly enabled', async () => {
    const prisma = createPrisma()
    const fetchImpl = vi.fn()

    const result = await calculateWeightedV3(candidate, job, prisma, { fetchImpl, versionEnabled: false })

    expect(result).toMatchObject({
      degraded: true,
      algorithmVersion: 'weighted-v1',
      requestedAlgorithmVersion: ALGORITHM_V3,
      semanticScore: null,
      fallback: { reason: 'version_disabled', retryable: false }
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(prisma.embeddingCache.findUnique).not.toHaveBeenCalled()
  })

  it('sends the supported model contract and reuses only the V3 cache namespace', async () => {
    const prisma = createPrisma()
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ embedding: { values: unitVector() } }) }))

    const first = await calculateWeightedV3(candidate, job, prisma, { fetchImpl })
    const second = await calculateWeightedV3(candidate, job, prisma, { fetchImpl })

    expect(first.algorithmVersion).toBe(ALGORITHM_V3)
    expect(first.degraded).toBe(false)
    expect(first.semanticScore).toBe(100)
    expect([first.score, first.skillScore, first.experienceScore, first.positionScore, first.locationScore, first.salaryScore, first.employmentScore, first.semanticScore].every(Number.isFinite)).toBe(true)
    expect(second.embedding.candidateCacheHit).toBe(true)
    expect(second.embedding.jobCacheHit).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(prisma.cache.size).toBe(2)

    const request = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(fetchImpl.mock.calls[0][0]).toContain('/v1beta/models/gemini-embedding-2:embedContent')
    expect(fetchImpl.mock.calls[0][1].headers['x-goog-api-key']).toBe('mock-gemini-key')
    expect(request.content.parts[0].text).toBe('task: sentence similarity | query: Node.js engineer\nBackend Engineer\nNode.js')
    expect(request.embedContentConfig).toEqual({ outputDimensionality: 768, autoTruncate: false })
  })

  it('changes cache key for role, input, model version or embedding config', () => {
    const base = embeddingV3Config()
    const candidateKey = buildEmbeddingCacheIdentity('same text', 'candidate-profile', base)
    const jobKey = buildEmbeddingCacheIdentity('same text', 'job-document', base)
    const changedInput = buildEmbeddingCacheIdentity('changed text', 'candidate-profile', base)
    const changedVersion = buildEmbeddingCacheIdentity('same text', 'candidate-profile', { ...base, modelVersion: 'gemini-embedding-2-revision-b' })
    const changedDimension = buildEmbeddingCacheIdentity('same text', 'candidate-profile', { ...base, outputDimensionality: 1536 })
    const changedInstruction = buildEmbeddingCacheIdentity('same text', 'candidate-profile', { ...base, taskInstruction: 'task: classification | query: ' })

    expect(new Set([candidateKey.contentHash, jobKey.contentHash, changedInput.contentHash, changedVersion.contentHash, changedDimension.contentHash, changedInstruction.contentHash]).size).toBe(6)
    expect(candidateKey.inputFingerprint).toBe(crypto.createHash('sha256').update('same text').digest('hex'))
  })

  it('does not reuse a legacy text-embedding-004 cache entry', async () => {
    const cache = new Map()
    const legacyHash = crypto.createHash('sha256').update('text-embedding-004\nsame text').digest('hex')
    cache.set(legacyHash, { contentHash: legacyHash, model: 'text-embedding-004', vector: unitVector() })
    const prisma = createPrisma(cache)
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ embedding: { values: unitVector() } }) }))

    const result = await embeddingForV3('same text', 'candidate-profile', prisma, { fetchImpl })

    expect(result.cacheHit).toBe(false)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(cache.has(legacyHash)).toBe(true)
    expect(cache.size).toBe(2)
  })

  it('retries transient errors and succeeds without changing the embedding contract', async () => {
    const embeddingConfig = { ...embeddingV3Config(), outputDimensionality: 128, maxRetries: 1, retryBaseMs: 0 }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ embedding: { values: unitVector(128) } }) })
    const waitImpl = vi.fn(async () => {})

    const vector = await requestEmbedding('retry me', embeddingConfig, { fetchImpl, waitImpl })

    expect(vector).toHaveLength(128)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(waitImpl).toHaveBeenCalledOnce()
  })

  it('falls back explicitly to finite V1 score after quota errors', async () => {
    const prisma = createPrisma()
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429 }))

    const result = await calculateWeightedV3(candidate, job, prisma, { fetchImpl })

    expect(result.degraded).toBe(true)
    expect(result.algorithmVersion).toBe('weighted-v1')
    expect(result.requestedAlgorithmVersion).toBe(ALGORITHM_V3)
    expect(result.semanticScore).toBeNull()
    expect(result.fallback.reason).toBe('quota_or_rate_limit')
    expect(Number.isFinite(result.score)).toBe(true)
  })

  it('falls back explicitly when the API key is missing without making a request', async () => {
    const prisma = createPrisma()
    const fetchImpl = vi.fn()

    const result = await calculateWeightedV3(candidate, job, prisma, { fetchImpl, apiKey: '' })

    expect(result.degraded).toBe(true)
    expect(result.algorithmVersion).toBe('weighted-v1')
    expect(result.requestedAlgorithmVersion).toBe(ALGORITHM_V3)
    expect(result.semanticScore).toBeNull()
    expect(result.fallback.reason).toBe('configuration')
    expect(Number.isFinite(result.score)).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('falls back to finite V1 when optional profile collections are null and embedding input is empty', async () => {
    const prisma = createPrisma()
    const fetchImpl = vi.fn()
    const emptyCandidate = { skills: null, educations: undefined, experiences: null, projects: [] }
    const emptyJob = { skills: undefined }

    const result = await calculateWeightedV3(emptyCandidate, emptyJob, prisma, { fetchImpl })

    expect(result.degraded).toBe(true)
    expect(result.algorithmVersion).toBe('weighted-v1')
    expect(result.fallback.reason).toBe('invalid_input')
    expect([result.score, result.skillScore, result.experienceScore, result.positionScore, result.locationScore, result.salaryScore, result.employmentScore].every(Number.isFinite)).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('falls back explicitly on timeout instead of assigning semantic score zero', async () => {
    const prisma = createPrisma()
    const embeddingConfig = { ...embeddingV3Config(), timeoutMs: 5, maxRetries: 0 }
    const fetchImpl = vi.fn(async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    }))

    const result = await calculateWeightedV3(candidate, job, prisma, { fetchImpl, embeddingConfig })

    expect(result.degraded).toBe(true)
    expect(result.fallback.reason).toBe('timeout')
    expect(result.semanticScore).toBeNull()
    expect(Number.isFinite(result.score)).toBe(true)
  })

  it('rejects incompatible cached dimensions and preserves the old entry', async () => {
    const prisma = createPrisma()
    const identity = buildEmbeddingCacheIdentity('same text', 'candidate-profile')
    prisma.cache.set(identity.contentHash, { contentHash: identity.contentHash, model: 'gemini-embedding-2', vector: unitVector(128) })

    await expect(embeddingForV3('same text', 'candidate-profile', prisma)).rejects.toThrow('đúng 768 chiều')
    expect(prisma.cache.get(identity.contentHash).vector).toHaveLength(128)
    expect(prisma.embeddingCache.upsert).not.toHaveBeenCalled()
  })

  it('falls back instead of persisting a non-finite provider vector', async () => {
    const prisma = createPrisma()
    const invalidVector = unitVector()
    invalidVector[10] = Number.NaN
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ embedding: { values: invalidVector } }) }))

    const result = await calculateWeightedV3(candidate, job, prisma, { fetchImpl })

    expect(result.degraded).toBe(true)
    expect(result.fallback.reason).toBe('invalid_embedding')
    expect(Number.isFinite(result.score)).toBe(true)
    expect(prisma.embeddingCache.upsert).not.toHaveBeenCalled()
  })
})

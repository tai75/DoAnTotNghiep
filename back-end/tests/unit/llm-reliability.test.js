import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/job_connect_test'
process.env.JWT_SECRET = 'unit-test-secret'
process.env.GEMINI_API_KEY = 'mock-gemini-key'
process.env.GEMINI_MODEL = 'gemini-3.6-flash'
process.env.LLM_TIMEOUT_MS = '50'

const config = (await import('../../src/config/env.js')).default
const {
  callGemini,
  explainMatch,
  extractResumeProfile,
  generateJobDescription,
  withRetry
} = await import('../../src/services/llm.service.js')

const contents = [{ role: 'user', parts: [{ text: 'synthetic test prompt' }] }]
const { runWithAiPermit } = require('../helpers/aiPermitFake')
const permitted = (callback, scope = 'AI_CHAT') => runWithAiPermit(scope, callback).then(({ result }) => result)

describe('Gemini LLM reliability', () => {
  beforeEach(() => {
    config.geminiApiKey = 'mock-gemini-key'
    config.geminiModel = 'gemini-3.6-flash'
    vi.restoreAllMocks()
  })

  it('uses the supported configured model and keeps the API key out of the URL', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [] }) }))

    await permitted(() => callGemini(contents, [], { fetchImpl }))

    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toContain('/models/gemini-3.6-flash:generateContent')
    expect(url).not.toContain('key=')
    expect(options.headers['x-goog-api-key']).toBe('mock-gemini-key')
  })

  it('fails fast without an API key', async () => {
    const fetchImpl = vi.fn()

    await expect(callGemini(contents, [], { fetchImpl, apiKey: '' })).rejects.toMatchObject({ code: 'configuration', retryable: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps V1 explanation optional when Gemini is unavailable', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')

    await expect(explainMatch({ score: 75, matchedSkills: [], missingSkills: [] }, 'v1-user', { apiKey: '' }))
      .resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not retry non-transient provider rejections', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }))

    await expect(permitted(() => withRetry(() => callGemini(contents, [], { fetchImpl }), { maxAttempts: 2, retryBaseMs: 0 })))
      .rejects.toMatchObject({ code: 'provider_rejected', status: 400, retryable: false })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('retries quota errors with a bound and returns a machine-readable failure', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429 }))
    const waitImpl = vi.fn(async () => {})

    await expect(permitted(() => withRetry(() => callGemini(contents, [], { fetchImpl }), { maxAttempts: 2, retryBaseMs: 0, waitImpl })))
      .rejects.toMatchObject({ code: 'quota_or_rate_limit', status: 429, retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(waitImpl).toHaveBeenCalledOnce()
  })

  it('enforces one finite deadline across retries and backoff', async () => {
    const retryable = Object.assign(new Error('temporary'), { retryable: true })
    const operation = vi.fn(async () => { throw retryable })
    let now = 0
    const waitImpl = vi.fn(async (ms) => { now += ms })

    await expect(withRetry(operation, {
      maxAttempts: 4, retryBaseMs: 6, totalTimeoutMs: 10, nowImpl: () => now, waitImpl
    })).rejects.toMatchObject({ code: 'total_timeout', retryable: false })
    expect(operation).toHaveBeenCalledTimes(2)
    expect(waitImpl).toHaveBeenCalledOnce()
  })

  it('aborts timed-out requests and returns a machine-readable timeout', async () => {
    const fetchImpl = vi.fn(async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    }))

    await expect(permitted(() => callGemini(contents, [], { fetchImpl, timeoutMs: 5 })))
      .rejects.toMatchObject({ code: 'timeout', retryable: true })
  })

  it('lets job creation continue manually when Gemini is unavailable', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 })

    await expect(permitted(() => generateJobDescription('manual-fallback-user', { title: 'Synthetic role' }), 'JOB_DESCRIPTION')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed resume extraction output without returning partial profile data', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{not-valid-json' }] } }] })
    })

    await expect(permitted(() => extractResumeProfile('invalid-json-user', 'synthetic resume'), 'RESUME_IMPORT'))
      .rejects.toMatchObject({ statusCode: 502 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

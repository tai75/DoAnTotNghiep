import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/job_connect_test';
process.env.JWT_SECRET = 'unit-test-secret';
process.env.GEMINI_API_KEY = 'mock-gemini-key';

const config = require('../../src/config/env.js');
const { AiConsentError, executeWithConsent } = require('../../src/services/aiConsent.service.js');
const { callGemini, chat, withRetry } = require('../../src/services/llm.service.js');
const { createAiPermitFake } = require('../helpers/aiPermitFake');

const consent = (id, userId, scope) => ({ id, userId, scope });

describe('AI consent recheck for retries and chat turns', () => {
  beforeEach(() => {
    config.geminiApiKey = 'mock-gemini-key';
    vi.restoreAllMocks();
  });

  it('does not dispatch a retry after withdrawal is requested', async () => {
    const fake = createAiPermitFake([consent(1, 101, 'AI_CHAT')]);
    const fetchImpl = vi.fn(async () => {
      fake.consent(101, 'AI_CHAT').withdrawalRequestedAt = new Date();
      return { ok: false, status: 503 };
    });
    await expect(executeWithConsent({ actorUserId: 101, scope: 'AI_CHAT', operation: 'chat' }, () => withRetry(
      () => callGemini([{ role: 'user', parts: [{ text: 'safe synthetic prompt' }] }], [], { fetchImpl, client: fake.client }),
      { maxAttempts: 2, retryBaseMs: 0, waitImpl: async () => {} }
    ), fake.client)).rejects.toBeInstanceOf(AiConsentError);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fake.state.permits).toHaveLength(1);
  });

  it('does not send a multi-candidate tool result after one candidate withdraws', async () => {
    const fake = createAiPermitFake([
      consent(1, 201, 'AI_CHAT'), consent(2, 201, 'RECRUITER_AI_DISCOVERY'),
      consent(3, 301, 'RECRUITER_AI_DISCOVERY'), consent(4, 302, 'RECRUITER_AI_DISCOVERY')
    ]);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'searchCandidates', args: {} } }] } }] })
    }));
    const tool = {
      name: 'searchCandidates', description: 'synthetic', parameters: { type: 'object', properties: {} },
      execute: vi.fn(async () => {
        fake.consent(301, 'RECRUITER_AI_DISCOVERY').withdrawalRequestedAt = new Date();
        return [
          { userId: 301, id: 88, headline: 'Backend Engineer' },
          { userId: 302, id: 89, headline: 'Platform Engineer' }
        ];
      }),
      consentRequirements: (result) => [
        { userId: 201, scope: 'RECRUITER_AI_DISCOVERY' },
        ...result.map((candidate) => ({ userId: candidate.userId, scope: 'RECRUITER_AI_DISCOVERY' }))
      ],
      toAiResult: (result) => result.map(({ userId, ...candidate }) => candidate)
    };
    await expect(executeWithConsent({ actorUserId: 201, scope: 'AI_CHAT', operation: 'chat' }, () => chat({
      userId: 201, role: 'RECRUITER', message: 'find candidates', tools: [tool],
      dependencies: { fetchImpl, client: fake.client, maxAttempts: 1 }
    }), fake.client)).rejects.toBeInstanceOf(AiConsentError);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(fake.state.permits).toHaveLength(1);
  });
});

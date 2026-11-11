import { describe, expect, it, vi } from 'vitest';
const { AI_POLICY_VERSION, AiConsentError } = require('../../src/services/aiConsent.service');
const { findAiDiscoverableCandidates } = require('../../src/routes/recommendations.routes');

function clientWithConsentRows(candidateRows) {
  const aiConsent = { findMany: vi.fn()
    .mockResolvedValueOnce([{ id: 1, userId: 10, scope: 'RECRUITER_AI_DISCOVERY', policyVersion: AI_POLICY_VERSION }])
    .mockResolvedValueOnce(candidateRows) };
  const candidate = { findMany: vi.fn(async () => [{ id: 7, userId: 20, headline: 'Backend', desiredPosition: 'Engineer', yearsExperience: 3 }]) };
  return { aiConsent, candidate };
}

describe('consent-first recruiter AI discovery', () => {
  it('does not read candidate profiles when recruiter consent is missing', async () => {
    const client = { aiConsent: { findMany: vi.fn(async () => []) }, candidate: { findMany: vi.fn() } };
    await expect(findAiDiscoverableCandidates({ recruiterUserId: 10, companyId: 5 }, client)).rejects.toBeInstanceOf(AiConsentError);
    expect(client.candidate.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['missing consent', []],
    ['wrong scope', []],
    ['old policy', []],
    ['withdrawn consent', []]
  ])('does not read a profile for candidate with %s', async (_label, candidateRows) => {
    const client = clientWithConsentRows(candidateRows);
    await expect(findAiDiscoverableCandidates({ recruiterUserId: 10, companyId: 5 }, client)).resolves.toEqual([]);
    expect(client.candidate.findMany).not.toHaveBeenCalled();
  });

  it('selects only necessary fields after allowed user IDs are known', async () => {
    const client = clientWithConsentRows([{ userId: 20 }]);
    const result = await findAiDiscoverableCandidates({ recruiterUserId: 10, companyId: 5, query: 'Backend' }, client);
    expect(result).toHaveLength(1);
    expect(client.aiConsent.findMany).toHaveBeenCalledTimes(2);
    expect(client.candidate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: { in: [20] } }),
      select: { id: true, userId: true, headline: true, desiredPosition: true, yearsExperience: true },
      take: 10
    }));
  });

  it('never includes an unconsented candidate in the profile query', async () => {
    const client = clientWithConsentRows([{ userId: 20 }, { userId: 30 }]);
    await findAiDiscoverableCandidates({ recruiterUserId: 10, companyId: 5 }, client);
    const ids = client.candidate.findMany.mock.calls[0][0].where.userId.in;
    expect(ids).toEqual([20, 30]);
    expect(ids).not.toContain(40);
  });
});

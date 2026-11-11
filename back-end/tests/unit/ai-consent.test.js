import { describe, expect, it, vi } from 'vitest';
const {
  AI_POLICY_VERSION, AiConsentError, AiLifecyclePersistenceError, AiSemaphore,
  assertSupportedAiTopology, executeWithConsent, grantConsent, listConsents,
  outboundAiRequest, reconcileAmbiguousPermit, recoverAiPermits, withdrawConsent
} = require('../../src/services/aiConsent.service');
const { createAiPermitFake } = require('../helpers/aiPermitFake');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const consent = (userId = 10, scope = 'AI_CHAT', extra = {}) => ({ id: userId, userId, scope, ...extra });

describe('durable AI consent permits', () => {
  it('has no null-context or runtime test bypass for protected outbound', async () => {
    const provider = vi.fn();
    await expect(outboundAiRequest(provider, { testOnlyBypassPermit: true }))
      .rejects.toMatchObject({ code: 'ai_consent_context_required' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('fails closed for declared multi-process and cluster topology', () => {
    expect(() => assertSupportedAiTopology({ AI_OUTBOUND_PROCESS_COUNT: '2' })).toThrow('đúng một backend Node process');
    expect(() => assertSupportedAiTopology({ AI_OUTBOUND_PROCESS_COUNT: '1', WEB_CONCURRENCY: '3' })).toThrow('đúng một backend Node process');
  });

  it('does not infer consent from an old policy and exposes withdrawal state', async () => {
    const fake = createAiPermitFake([consent(7, 'AI_CHAT', { policyVersion: 'old' })]);
    const items = await listConsents(7, fake.client);
    expect(items.find((item) => item.scope === 'AI_CHAT')).toMatchObject({ active: false, expired: true });
  });

  it('does not allow grant to silently reverse a pending withdrawal', async () => {
    const fake = createAiPermitFake([consent(7, 'AI_CHAT', { withdrawalRequestedAt: new Date() })]);
    await expect(grantConsent(7, 'AI_CHAT', fake.client)).rejects.toMatchObject({ code: 'ai_withdrawal_pending' });
  });

  it('commits PENDING then claims ACTIVE before provider and stores only a digest', async () => {
    const fake = createAiPermitFake([consent()]);
    const provider = vi.fn(async () => {
      expect(fake.isInTransaction()).toBe(false);
      expect(fake.state.permits[0].status).toBe('ACTIVE');
      return 'ok';
    });
    const result = await executeWithConsent({ actorUserId: 10, scope: 'AI_CHAT', input: 'candidate@example.com' },
      () => outboundAiRequest(provider, { client: fake.client }), fake.client);
    expect(result).toBe('ok');
    expect(fake.state.permits[0].status).toBe('COMPLETED');
    expect(fake.state.permits[0]).not.toHaveProperty('input');
    expect(fake.state.permits[0].inputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(fake.state.events[0].inputDigest).toBe(fake.state.permits[0].inputDigest);
  });

  it('never calls provider when permit creation commit rolls back', async () => {
    const fake = createAiPermitFake([consent()]);
    fake.failNextCommit();
    const provider = vi.fn();
    await expect(executeWithConsent({ actorUserId: 10, scope: 'AI_CHAT' },
      () => outboundAiRequest(provider, { client: fake.client }), fake.client)).rejects.toThrow('synthetic commit failure');
    expect(provider).not.toHaveBeenCalled();
    expect(fake.state.permits).toHaveLength(0);
  });

  it('cancels a committed permit if withdrawal wins before claim', async () => {
    const fake = createAiPermitFake([consent()]);
    const transaction = fake.client.$transaction;
    let transactionCount = 0;
    fake.client.$transaction = vi.fn(async (...args) => {
      const result = await transaction(...args);
      transactionCount += 1;
      if (transactionCount === 1) fake.consent(10, 'AI_CHAT').withdrawalRequestedAt = new Date();
      return result;
    });
    const provider = vi.fn();
    await expect(executeWithConsent({ actorUserId: 10, scope: 'AI_CHAT' },
      () => outboundAiRequest(provider, { client: fake.client }), fake.client)).rejects.toBeInstanceOf(AiConsentError);
    expect(provider).not.toHaveBeenCalled();
    expect(fake.state.permits[0].status).toBe('CANCELLED');
  });

  it('cancels PENDING permits and completes withdrawal when nothing can transmit', async () => {
    const fake = createAiPermitFake([consent()]);
    fake.state.permits.push({ id: 1, requestId: 'pending', status: 'PENDING', version: 1, deadlineAt: new Date(Date.now() + 1000) });
    fake.state.bindings.push({ id: 1, permitId: 1, consentId: 10, dataSubjectUserId: 10, scope: 'AI_CHAT' });
    const result = await withdrawConsent(10, 'AI_CHAT', fake.client, { waitTimeoutMs: 0 });
    expect(result.status).toBe('COMPLETED');
    expect(fake.state.permits[0].status).toBe('CANCELLED');
    expect(fake.consent(10, 'AI_CHAT').withdrawalCompletedAt).toBeInstanceOf(Date);
  });

  it('returns PENDING when ACTIVE transport is aborted but completion is unconfirmed', async () => {
    const fake = createAiPermitFake([consent()]);
    const never = new Promise(() => {});
    const outbound = executeWithConsent({ actorUserId: 10, scope: 'AI_CHAT' },
      () => outboundAiRequest(() => never, { client: fake.client }), fake.client);
    await vi.waitFor(() => expect(fake.state.permits[0]?.status).toBe('ACTIVE'));
    const result = await withdrawConsent(10, 'AI_CHAT', fake.client, { waitTimeoutMs: 0 });
    expect(result.status).toBe('PENDING');
    await expect(outbound).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.state.permits[0].status).toBe('TIMED_OUT_UNCONFIRMED');
    expect(fake.consent(10, 'AI_CHAT').withdrawalCompletedAt).toBeNull();
  });

  it('bounds a provider that ignores abort and marks ambiguity conservatively', async () => {
    const fake = createAiPermitFake([consent()]);
    const now = Date.now();
    await expect(executeWithConsent({ actorUserId: 10, scope: 'AI_CHAT' }, () => outboundAiRequest(
      () => new Promise(() => {}), { client: fake.client, deadlineAt: now + 5 }
    ), fake.client)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.state.permits[0].status).toBe('TIMED_OUT_UNCONFIRMED');
  });

  it('preserves provider error and reports lifecycle persistence failure without retry', async () => {
    const fake = createAiPermitFake([consent()]);
    const providerError = Object.assign(new Error('provider rejected candidate@example.com'), { code: 'provider_rejected' });
    fake.client.aiUsageEvent.update = vi.fn(async () => { throw new Error('synthetic usage update failure'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let caught;
    try {
      await executeWithConsent({ actorUserId: 10, scope: 'AI_CHAT', input: 'raw CV candidate@example.com' },
        () => outboundAiRequest(async () => { throw providerError; }, { client: fake.client }), fake.client);
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AiLifecyclePersistenceError);
    expect(caught).toMatchObject({ retryable: false, providerError: { code: 'provider_rejected' } });
    expect(fake.state.permits[0].status).toBe('ACTIVE');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ component: 'ai-permit-lifecycle', phase: 'provider_error_settlement' }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('candidate@example.com');
    log.mockRestore();
  });

  it('reports provider success plus DB settlement failure conservatively', async () => {
    const fake = createAiPermitFake([consent()]);
    fake.client.aiUsageEvent.update = vi.fn(async () => { throw new Error('synthetic usage update failure'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(executeWithConsent({ actorUserId: 10, scope: 'AI_CHAT' },
      () => outboundAiRequest(async () => 'provider-result', { client: fake.client }), fake.client))
      .rejects.toMatchObject({ code: 'ai_lifecycle_persistence_failed', retryable: false, providerError: null });
    expect(fake.state.permits[0].status).toBe('ACTIVE');
    log.mockRestore();
  });

  it('rolls back ambiguous state when transactional audit insert fails', async () => {
    const fake = createAiPermitFake([consent()]);
    fake.client.auditLog.create = vi.fn(async () => { throw new Error('synthetic audit failure'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(executeWithConsent({ actorUserId: 10, scope: 'AI_CHAT' }, () => outboundAiRequest(
      () => new Promise(() => {}), { client: fake.client, deadlineAt: Date.now() + 5 }
    ), fake.client)).rejects.toMatchObject({ code: 'ai_lifecycle_persistence_failed' });
    expect(fake.state.permits[0].status).toBe('ACTIVE');
    expect(fake.state.audits).toHaveLength(0);
    log.mockRestore();
  });

  it('binds every data subject and creates a fresh permit for every call', async () => {
    const fake = createAiPermitFake([
      consent(10, 'AI_CHAT'), consent(10, 'RECRUITER_AI_DISCOVERY', { id: 11 }),
      consent(20, 'RECRUITER_AI_DISCOVERY', { id: 20 }), consent(30, 'RECRUITER_AI_DISCOVERY', { id: 30 })
    ]);
    const options = { client: fake.client, consentRequirements: [
      { userId: 10, scope: 'RECRUITER_AI_DISCOVERY' },
      { userId: 20, scope: 'RECRUITER_AI_DISCOVERY' },
      { userId: 30, scope: 'RECRUITER_AI_DISCOVERY' }
    ] };
    await executeWithConsent({ actorUserId: 10, scope: 'AI_CHAT' }, async () => {
      await outboundAiRequest(async () => 'one', options);
      await outboundAiRequest(async () => 'two', options);
    }, fake.client);
    expect(fake.state.permits).toHaveLength(2);
    expect(fake.state.permits[0].requestId).not.toBe(fake.state.permits[1].requestId);
    expect(fake.state.bindings.filter((item) => item.permitId === 1)).toHaveLength(4);
  });

  it('recovers expired PENDING safely and ACTIVE as unsafe orphan with audit', async () => {
    const fake = createAiPermitFake([]);
    const expired = new Date(10);
    fake.state.permits.push(
      { id: 1, status: 'PENDING', version: 1, deadlineAt: expired, leaseExpiresAt: null },
      { id: 2, status: 'ACTIVE', version: 1, deadlineAt: new Date(1000), leaseExpiresAt: expired }
    );
    const result = await recoverAiPermits(fake.client, { nowImpl: () => 100 });
    expect(result).toEqual({ cancelled: 1, orphaned: 1 });
    expect(fake.state.permits.map((item) => item.status)).toEqual(['CANCELLED', 'ORPHANED_UNCONFIRMED']);
    expect(fake.state.audits).toHaveLength(2);
  });

  it('does not orphan or reclaim a locally running request after lease expiry', async () => {
    const fake = createAiPermitFake([consent()]);
    const provider = deferred();
    const running = executeWithConsent({ actorUserId: 10, scope: 'AI_CHAT' },
      () => outboundAiRequest(() => provider.promise, { client: fake.client }), fake.client);
    await vi.waitFor(() => expect(fake.state.permits[0]?.status).toBe('ACTIVE'));
    fake.state.permits[0].leaseExpiresAt = new Date(1);
    const recovery = await recoverAiPermits(fake.client, { nowImpl: () => 100 });
    expect(recovery.orphaned).toBe(0);
    expect(fake.state.permits[0].status).toBe('ACTIVE');
    provider.resolve('done');
    await expect(running).resolves.toBe('done');
    expect(fake.state.permits[0].status).toBe('COMPLETED');
  });

  it('keeps ownership while a single-process request is paused immediately before provider transmission', async () => {
    const fake = createAiPermitFake([consent()]);
    const provider = vi.fn(async () => {
      fake.state.permits[0].leaseExpiresAt = new Date(1);
      const recovery = await recoverAiPermits(fake.client, { nowImpl: () => 100 });
      expect(recovery.orphaned).toBe(0);
      expect(fake.state.permits[0].status).toBe('ACTIVE');
      return 'sent-after-pause';
    });
    await expect(executeWithConsent({ actorUserId: 10, scope: 'AI_CHAT' },
      () => outboundAiRequest(provider, { client: fake.client }), fake.client)).resolves.toBe('sent-after-pause');
    expect(provider).toHaveBeenCalledOnce();
    expect(fake.state.permits[0].status).toBe('COMPLETED');
  });

  it('does not reclaim an orphan and keeps withdrawal pending', async () => {
    const fake = createAiPermitFake([consent()]);
    fake.state.permits.push({
      id: 1, requestId: 'orphan', status: 'ORPHANED_UNCONFIRMED', version: 2,
      deadlineAt: new Date(10), leaseExpiresAt: new Date(10)
    });
    fake.state.bindings.push({ id: 1, permitId: 1, consentId: 10, dataSubjectUserId: 10, scope: 'AI_CHAT' });
    const recovery = await recoverAiPermits(fake.client, { nowImpl: () => 100 });
    expect(recovery).toEqual({ cancelled: 0, orphaned: 0 });
    expect(fake.state.permits[0].status).toBe('ORPHANED_UNCONFIRMED');
    const withdrawal = await withdrawConsent(10, 'AI_CHAT', fake.client, { waitTimeoutMs: 0, nowImpl: () => 100 });
    expect(withdrawal.status).toBe('PENDING');
    expect(fake.consent(10, 'AI_CHAT').withdrawalCompletedAt).toBeNull();
  });

  it('rolls back recovery state if its audit insert fails', async () => {
    const fake = createAiPermitFake([]);
    fake.state.permits.push({ id: 1, requestId: 'orphan', status: 'ACTIVE', version: 1, deadlineAt: new Date(1000), leaseExpiresAt: new Date(10) });
    fake.client.auditLog.create = vi.fn(async () => { throw new Error('synthetic audit failure'); });
    await expect(recoverAiPermits(fake.client, { nowImpl: () => 100 })).rejects.toThrow('synthetic audit failure');
    expect(fake.state.permits[0].status).toBe('ACTIVE');
    expect(fake.state.audits).toHaveLength(0);
  });

  it('requires external termination evidence for manual ambiguous reconciliation', async () => {
    const fake = createAiPermitFake([]);
    fake.state.permits.push({ id: 1, requestId: 'ambiguous', status: 'ORPHANED_UNCONFIRMED', version: 2, errorCode: 'lease_expired' });
    await expect(reconcileAmbiguousPermit(1, { reviewedByUserId: 7, resolution: 'FAILED' }, fake.client))
      .rejects.toMatchObject({ code: 'ai_reconciliation_evidence_required' });
    const result = await reconcileAmbiguousPermit(1, {
      reviewedByUserId: 7, resolution: 'FAILED', providerConfirmedTerminated: true, evidenceReference: 'provider-case-123'
    }, fake.client);
    expect(result.status).toBe('FAILED');
    expect(fake.state.audits.at(-1)).toMatchObject({ action: 'AI_PERMIT_MANUAL_RECONCILIATION' });
  });

  it('keeps concurrent withdrawal idempotent', async () => {
    const fake = createAiPermitFake([consent()]);
    const results = await Promise.all([
      withdrawConsent(10, 'AI_CHAT', fake.client, { waitTimeoutMs: 0 }),
      withdrawConsent(10, 'AI_CHAT', fake.client, { waitTimeoutMs: 0 })
    ]);
    expect(results.every((item) => item.status === 'COMPLETED')).toBe(true);
  });

  it('bounds queue length and releases capacity', async () => {
    vi.useFakeTimers();
    try {
      const semaphore = new AiSemaphore({ maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 50 });
      const release = await semaphore.acquire();
      const queued = semaphore.acquire();
      await expect(semaphore.acquire()).rejects.toMatchObject({ code: 'ai_queue_overflow' });
      const rejected = expect(queued).rejects.toMatchObject({ code: 'ai_queue_timeout' });
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      release();
      expect(semaphore.snapshot()).toMatchObject({ active: 0, queued: 0 });
    } finally { vi.useRealTimers(); }
  });
});

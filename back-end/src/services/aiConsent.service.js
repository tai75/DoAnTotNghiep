const crypto = require('crypto');
const os = require('os');
const cluster = require('cluster');
const { AsyncLocalStorage } = require('async_hooks');
const config = require('../config/env');
const prisma = require('../config/prisma');

const AI_POLICY_VERSION = '2026-11-10';
const AI_PROVIDER = 'google-gemini-developer-api';
const AI_SCOPES = Object.freeze([
  'RESUME_IMPORT', 'RESUME_JOB_ANALYSIS', 'MATCHING_EXPLANATION', 'SEMANTIC_MATCHING',
  'AI_CHAT', 'JOB_DESCRIPTION', 'RECRUITER_AI_DISCOVERY'
]);
const SAFE_TERMINAL_STATUSES = Object.freeze(['COMPLETED', 'CANCELLED', 'FAILED']);
const UNSAFE_STATUSES = Object.freeze(['ACTIVE', 'TIMED_OUT_UNCONFIRMED', 'ORPHANED_UNCONFIRMED']);
const aiContext = new AsyncLocalStorage();
const activeRequests = new Map();
const defaultLeaseOwner = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;

class AiConsentError extends Error {
  constructor(message = 'Bạn cần đồng ý chính sách AI cho chức năng này trước khi tiếp tục', code = 'ai_consent_required', statusCode = 403) {
    super(message);
    this.name = 'AiConsentError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

class AiCapacityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AiCapacityError';
    this.code = code;
    this.statusCode = 503;
    this.retryable = true;
  }
}

class AiLifecyclePersistenceError extends Error {
  constructor(message, { lifecycleError, providerError = null, permitId = null } = {}) {
    super(message, { cause: lifecycleError });
    this.name = 'AiLifecyclePersistenceError';
    this.code = 'ai_lifecycle_persistence_failed';
    this.statusCode = 503;
    this.retryable = false;
    this.permitId = permitId;
    this.providerError = providerError ? {
      name: providerError.name, code: providerError.code || null, message: providerError.message
    } : null;
  }
}

class AiSemaphore {
  constructor({ maxConcurrent, maxQueue, queueTimeoutMs, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error('AI_MAX_CONCURRENT phải là số nguyên dương');
    if (!Number.isInteger(maxQueue) || maxQueue < 0) throw new Error('AI_MAX_QUEUE phải là số nguyên không âm');
    if (!Number.isFinite(queueTimeoutMs) || queueTimeoutMs <= 0) throw new Error('AI_QUEUE_TIMEOUT_MS phải lớn hơn 0');
    this.maxConcurrent = maxConcurrent;
    this.maxQueue = maxQueue;
    this.queueTimeoutMs = queueTimeoutMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.active = 0;
    this.queue = [];
  }

  acquire(timeoutMs = this.queueTimeoutMs) {
    const boundedTimeoutMs = Math.min(this.queueTimeoutMs, timeoutMs);
    if (!Number.isFinite(boundedTimeoutMs) || boundedTimeoutMs <= 0) {
      return Promise.reject(new AiCapacityError('Hết thời gian chờ dịch vụ AI', 'ai_queue_timeout'));
    }
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(this.releaseHandle());
    }
    if (this.queue.length >= this.maxQueue) return Promise.reject(new AiCapacityError('Dịch vụ AI đang quá tải', 'ai_queue_overflow'));
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      entry.timer = this.setTimer(() => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new AiCapacityError('Hết thời gian chờ dịch vụ AI', 'ai_queue_timeout'));
      }, boundedTimeoutMs);
      this.queue.push(entry);
    });
  }

  releaseHandle() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        this.clearTimer(next.timer);
        next.resolve(this.releaseHandle());
      } else this.active = Math.max(0, this.active - 1);
    };
  }

  snapshot() {
    return { active: this.active, queued: this.queue.length, maxConcurrent: this.maxConcurrent, maxQueue: this.maxQueue };
  }
}

const outboundSemaphore = new AiSemaphore({
  maxConcurrent: config.aiMaxConcurrent,
  maxQueue: config.aiMaxQueue,
  queueTimeoutMs: config.aiQueueTimeoutMs
});

function assertScope(scope) {
  if (!AI_SCOPES.includes(scope)) throw new AiConsentError('Phạm vi đồng ý AI không hợp lệ', 'invalid_ai_consent_scope');
}

function assertSupportedAiTopology(environment = process.env) {
  const configuredCount = Number(environment.AI_OUTBOUND_PROCESS_COUNT || config.aiOutboundProcessCount || 1);
  const webConcurrency = Number(environment.WEB_CONCURRENCY || 1);
  const pm2Instance = environment.NODE_APP_INSTANCE === undefined ? 0 : Number(environment.NODE_APP_INSTANCE);
  if (configuredCount !== 1 || webConcurrency > 1 || cluster.isWorker || environment.NODE_UNIQUE_ID !== undefined || pm2Instance > 0) {
    throw new AiCapacityError('AI outbound yêu cầu đúng một backend Node process', 'ai_multi_process_unsupported');
  }
}

function logLifecyclePersistenceFailure({ permitId, phase, lifecycleError, providerError }) {
  console.error({
    component: 'ai-permit-lifecycle', permitId: permitId || null, phase,
    lifecycleError: { name: lifecycleError?.name, code: lifecycleError?.code || null },
    providerError: providerError ? { name: providerError.name, code: providerError.code || null } : null
  });
}

function normalizeRequirements(requirements) {
  const unique = new Map();
  for (const requirement of requirements || []) {
    if (!Number.isInteger(requirement?.userId)) throw new AiConsentError();
    assertScope(requirement.scope);
    unique.set(`${requirement.userId}:${requirement.scope}`, { userId: requirement.userId, scope: requirement.scope });
  }
  return [...unique.values()].sort((left, right) => left.userId - right.userId || left.scope.localeCompare(right.scope));
}

function baseRequirements({ actorUserId, dataSubjectUserId = actorUserId, scope }) {
  return normalizeRequirements([
    { userId: actorUserId, scope },
    ...(dataSubjectUserId !== actorUserId ? [{ userId: dataSubjectUserId, scope }] : [])
  ]);
}

async function activeConsents(requirements, client = prisma, { lock = false } = {}) {
  const normalized = normalizeRequirements(requirements);
  if (!normalized.length) throw new AiConsentError();
  if (!lock) {
    const records = await client.aiConsent.findMany({ where: {
      policyVersion: AI_POLICY_VERSION, withdrawnAt: null, withdrawalRequestedAt: null,
      OR: normalized.map(({ userId, scope }) => ({ userId, scope }))
    } });
    if (records.length !== normalized.length) throw new AiConsentError();
    return records;
  }
  const conditions = normalized.map(() => '(user_id = ? AND scope = ?)').join(' OR ');
  const parameters = normalized.flatMap(({ userId, scope }) => [userId, scope]);
  const rows = await client.$queryRawUnsafe(
    `SELECT id, user_id userId, scope, version FROM ai_consents WHERE policy_version = ? AND withdrawn_at IS NULL AND withdrawal_requested_at IS NULL AND (${conditions}) FOR UPDATE`,
    AI_POLICY_VERSION, ...parameters
  );
  if (rows.length !== normalized.length) throw new AiConsentError();
  return rows;
}

function consentView(record, expired = false) {
  const withdrawalStatus = record?.withdrawalCompletedAt || record?.withdrawnAt
    ? 'COMPLETED'
    : record?.withdrawalRequestedAt ? 'PENDING' : 'NONE';
  return {
    scope: record?.scope,
    policyVersion: record?.policyVersion || AI_POLICY_VERSION,
    grantedAt: record && !record.withdrawnAt ? record.grantedAt : null,
    withdrawnAt: record?.withdrawnAt || null,
    withdrawalRequestedAt: record?.withdrawalRequestedAt || null,
    withdrawalCompletedAt: record?.withdrawalCompletedAt || null,
    withdrawalStatus,
    active: Boolean(record && !record.withdrawnAt && !record.withdrawalRequestedAt),
    version: record?.version || 0,
    expired
  };
}

async function listConsents(userId, client = prisma) {
  const records = await client.aiConsent.findMany({ where: { userId }, orderBy: { scope: 'asc' } });
  const currentByScope = new Map(records.filter((record) => record.policyVersion === AI_POLICY_VERSION).map((record) => [record.scope, record]));
  return AI_SCOPES.map((scope) => {
    const current = currentByScope.get(scope);
    if (current) return consentView(current);
    const old = records.find((record) => record.scope === scope);
    return { ...consentView(old, Boolean(old)), scope, policyVersion: old?.policyVersion || AI_POLICY_VERSION, active: false };
  });
}

async function grantConsent(userId, scope, client = prisma) {
  assertScope(scope);
  return client.$transaction(async (tx) => {
    const existing = await tx.aiConsent.findUnique({ where: { userId_scope_policyVersion: { userId, scope, policyVersion: AI_POLICY_VERSION } } });
    if (!existing) return tx.aiConsent.create({ data: { userId, scope, policyVersion: AI_POLICY_VERSION } });
    if (existing.withdrawalRequestedAt && !existing.withdrawalCompletedAt) {
      throw new AiConsentError('Yêu cầu rút đồng ý đang được xử lý, không thể tự động khôi phục', 'ai_withdrawal_pending', 409);
    }
    if (!existing.withdrawnAt) return existing;
    const updated = await tx.aiConsent.updateMany({
      where: { id: existing.id, version: existing.version, withdrawnAt: { not: null }, withdrawalCompletedAt: { not: null } },
      data: { grantedAt: new Date(), withdrawnAt: null, withdrawalRequestedAt: null, withdrawalCompletedAt: null, version: { increment: 1 } }
    });
    if (updated.count !== 1) throw new AiConsentError('Trạng thái đồng ý vừa thay đổi, vui lòng thử lại', 'ai_consent_conflict', 409);
    return tx.aiConsent.findUnique({ where: { id: existing.id } });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function finalizeWithdrawal(consentId, client, now) {
  return client.$transaction(async (tx) => {
    const blockers = await tx.aiTransmissionPermit.count({ where: {
      bindings: { some: { consentId } }, status: { in: UNSAFE_STATUSES }
    } });
    if (blockers) return null;
    await tx.aiTransmissionPermit.updateMany({
      where: { bindings: { some: { consentId } }, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelRequestedAt: now, completedAt: now, version: { increment: 1 } }
    });
    const updated = await tx.aiConsent.updateMany({
      where: { id: consentId, withdrawalRequestedAt: { not: null }, withdrawalCompletedAt: null },
      data: { withdrawnAt: now, withdrawalCompletedAt: now, version: { increment: 1 } }
    });
    return updated.count === 1 ? tx.aiConsent.findUnique({ where: { id: consentId } }) : tx.aiConsent.findUnique({ where: { id: consentId } });
  }, { maxWait: config.aiDbMaxWaitMs, timeout: config.aiDispatchTransactionTimeoutMs });
}

async function withdrawConsent(userId, scope, client = prisma, dependencies = {}) {
  assertScope(scope);
  const nowImpl = dependencies.nowImpl || Date.now;
  const waitImpl = dependencies.waitImpl || wait;
  const waitTimeoutMs = dependencies.waitTimeoutMs ?? config.aiWithdrawalWaitMs;
  const pollMs = dependencies.pollMs ?? config.aiWithdrawalPollMs;
  await recoverAiPermits(client, { nowImpl });
  const requestedAt = new Date(nowImpl());
  const requested = await client.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe(
      'SELECT id, withdrawal_requested_at withdrawalRequestedAt, withdrawal_completed_at withdrawalCompletedAt, withdrawn_at withdrawnAt FROM ai_consents WHERE user_id = ? AND scope = ? AND policy_version = ? FOR UPDATE',
      userId, scope, AI_POLICY_VERSION
    );
    const existing = rows[0];
    if (!existing) return { missing: true };
    if (existing.withdrawalCompletedAt || existing.withdrawnAt) return { completed: true, consentId: Number(existing.id) };
    if (!existing.withdrawalRequestedAt) {
      await tx.aiConsent.update({ where: { id: Number(existing.id) }, data: { withdrawalRequestedAt: requestedAt, version: { increment: 1 } } });
    }
    await tx.aiTransmissionPermit.updateMany({
      where: { bindings: { some: { consentId: Number(existing.id) } }, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelRequestedAt: requestedAt, completedAt: requestedAt, version: { increment: 1 } }
    });
    const running = await tx.aiTransmissionPermit.findMany({
      where: { bindings: { some: { consentId: Number(existing.id) } }, status: { in: UNSAFE_STATUSES } },
      select: { requestId: true }
    });
    return { completed: false, consentId: Number(existing.id), running };
  }, { maxWait: config.aiDbMaxWaitMs, timeout: config.aiDispatchTransactionTimeoutMs });

  if (requested.missing || requested.completed) return { status: 'COMPLETED', consent: null, blockers: [] };
  for (const permit of requested.running) activeRequests.get(permit.requestId)?.controller.abort(new Error('consent_withdrawal_requested'));

  const deadline = nowImpl() + waitTimeoutMs;
  const immediate = await finalizeWithdrawal(requested.consentId, client, new Date(nowImpl()));
  if (immediate) return { status: 'COMPLETED', consent: immediate, blockers: [] };
  while (nowImpl() < deadline) {
    const completed = await finalizeWithdrawal(requested.consentId, client, new Date(nowImpl()));
    if (completed) return { status: 'COMPLETED', consent: completed, blockers: [] };
    await waitImpl(Math.min(pollMs, Math.max(0, deadline - nowImpl())));
  }
  const blockers = await client.aiTransmissionPermit.findMany({
    where: { bindings: { some: { consentId: requested.consentId } }, status: { in: UNSAFE_STATUSES } },
    select: { requestId: true, status: true, deadlineAt: true }
  });
  return { status: 'PENDING', consentId: requested.consentId, blockers };
}

async function executeWithConsent(options, callback, client = prisma) {
  const requirements = baseRequirements(options);
  const consents = await activeConsents(requirements, client);
  const subjectId = options.dataSubjectUserId ?? options.actorUserId;
  const consent = consents.find((item) => item.userId === subjectId && item.scope === options.scope) || consents[0];
  return aiContext.run({ ...options, requirements, client }, () => callback({ consent, consents }));
}

async function createPendingPermit(context, requirements, options, client, nowImpl) {
  const requestId = crypto.randomUUID();
  const now = nowImpl();
  const deadlineAt = new Date(options.deadlineAt || now + config.aiPermitDeadlineMs);
  if (deadlineAt.getTime() <= now) throw new AiCapacityError('Permit AI đã hết hạn trước khi tạo', 'ai_permit_expired');
  return client.$transaction(async (tx) => {
    const consents = await activeConsents(requirements, tx, { lock: true });
    const permit = await tx.aiTransmissionPermit.create({ data: {
      requestId,
      actorUserId: context.actorUserId,
      scope: context.scope,
      status: 'PENDING',
      provider: AI_PROVIDER,
      model: options.model || context.model || config.geminiModel,
      operation: options.operation || context.operation || context.scope.toLowerCase(),
      inputDigest: crypto.createHash('sha256').update(String(options.input ?? context.input ?? '')).digest('hex'),
      deadlineAt,
      bindings: { create: consents.map((consent) => ({
        consentId: Number(consent.id), dataSubjectUserId: Number(consent.userId), scope: consent.scope,
        policyVersion: AI_POLICY_VERSION, consentVersion: consent.version
      })) }
    } });
    const subjectId = options.dataSubjectUserId ?? context.dataSubjectUserId ?? context.actorUserId;
    const subjectConsent = consents.find((item) => Number(item.userId) === subjectId && item.scope === context.scope) || consents[0];
    const event = await tx.aiUsageEvent.create({ data: {
      actorUserId: context.actorUserId, dataSubjectUserId: subjectId, consentId: Number(subjectConsent.id), permitId: permit.id,
      scope: context.scope, policyVersion: AI_POLICY_VERSION, provider: AI_PROVIDER,
      model: options.model || context.model || config.geminiModel,
      operation: options.operation || context.operation || context.scope.toLowerCase(),
      inputDigest: crypto.createHash('sha256').update(String(options.input ?? context.input ?? '')).digest('hex')
    } });
    return { ...permit, eventId: event.id };
  }, { maxWait: config.aiDbMaxWaitMs, timeout: config.aiDispatchTransactionTimeoutMs });
}

async function claimPermit(permit, requirements, client, nowImpl, dependencies = {}) {
  const now = nowImpl();
  const leaseToken = crypto.randomUUID();
  const leaseOwner = dependencies.leaseOwner || defaultLeaseOwner;
  const leaseExpiresAt = new Date(Math.min(permit.deadlineAt.getTime(), now + config.aiPermitLeaseMs));
  return client.$transaction(async (tx) => {
    await activeConsents(requirements, tx, { lock: true });
    const updated = await tx.aiTransmissionPermit.updateMany({
      where: { id: permit.id, status: 'PENDING', version: permit.version, deadlineAt: { gt: new Date(now) } },
      data: { status: 'ACTIVE', activatedAt: new Date(now), leaseOwner, leaseToken, leaseExpiresAt, version: { increment: 1 } }
    });
    if (updated.count !== 1) throw new AiConsentError('Permit AI không còn hiệu lực', 'ai_permit_not_claimable', 409);
    return { ...permit, status: 'ACTIVE', leaseOwner, leaseToken, leaseExpiresAt, version: permit.version + 1 };
  }, { maxWait: config.aiDbMaxWaitMs, timeout: config.aiDispatchTransactionTimeoutMs });
}

async function settlePermit(client, permit, status, errorCode, nowImpl) {
  const now = new Date(nowImpl());
  return client.$transaction(async (tx) => {
    const updated = await tx.aiTransmissionPermit.updateMany({
      where: { id: permit.id, status: 'ACTIVE', leaseToken: permit.leaseToken, version: permit.version },
      data: { status, completedAt: now, errorCode: errorCode || null, leaseExpiresAt: now, version: { increment: 1 } }
    });
    if (updated.count !== 1) throw new AiConsentError('Permit AI đã mất quyền sở hữu; kết quả không được tái sử dụng', 'ai_permit_lease_lost', 409);
    await tx.aiUsageEvent.update({
      where: { id: permit.eventId },
      data: { outcome: status === 'COMPLETED' ? 'SUCCEEDED' : 'FAILED', errorCode: errorCode || null, completedAt: now }
    });
    if (status === 'TIMED_OUT_UNCONFIRMED' || status === 'ORPHANED_UNCONFIRMED') {
      await tx.auditLog.create({ data: {
        action: `AI_PERMIT_${status}`, entity: 'AiTransmissionPermit', entityId: permit.id,
        metadata: { requestId: permit.requestId, errorCode: errorCode || null, safeForWithdrawal: false }
      } });
    }
  }, { maxWait: config.aiDbMaxWaitMs, timeout: config.aiDispatchTransactionTimeoutMs });
}

async function cancelPendingPermit(client, permit, error, nowImpl) {
  const now = new Date(nowImpl());
  return client.$transaction(async (tx) => {
    const updated = await tx.aiTransmissionPermit.updateMany({
      where: { id: permit.id, status: 'PENDING', version: permit.version },
      data: { status: 'CANCELLED', completedAt: now, errorCode: String(error?.code || error?.name || 'permit_error').slice(0, 80), version: { increment: 1 } }
    });
    if (updated.count !== 1) throw new AiConsentError('Không thể hủy permit PENDING bằng CAS', 'ai_permit_cancel_conflict', 409);
    await tx.aiUsageEvent.update({
      where: { id: permit.eventId },
      data: { outcome: 'FAILED', errorCode: String(error?.code || error?.name || 'permit_error').slice(0, 80), completedAt: now }
    });
  }, { maxWait: config.aiDbMaxWaitMs, timeout: config.aiDispatchTransactionTimeoutMs });
}

async function outboundAiRequest(startRequest, options = {}) {
  assertSupportedAiTopology(options.environment || process.env);
  const context = aiContext.getStore();
  const semaphore = options.semaphore || outboundSemaphore;
  const nowImpl = options.nowImpl || Date.now;
  const queueBudgetMs = options.deadlineAt ? options.deadlineAt - nowImpl() : undefined;
  const release = await semaphore.acquire(queueBudgetMs);
  if (!context) {
    release();
    throw new AiConsentError('Outbound AI phải được thực hiện trong consent context', 'ai_consent_context_required');
  }
  const client = options.client || context.client || prisma;
  let permit;
  let controller;
  let timer;
  let providerStarted = false;
  let settlementAttempted = false;
  try {
    const requirements = normalizeRequirements([...(context.requirements || []), ...(options.consentRequirements || [])]);
    permit = await createPendingPermit(context, requirements, options, client, nowImpl);
    permit = await claimPermit(permit, requirements, client, nowImpl, options);
    const current = await client.aiTransmissionPermit.findUnique({ where: { id: permit.id }, select: { status: true, leaseToken: true, leaseExpiresAt: true } });
    if (!current || current.status !== 'ACTIVE' || current.leaseToken !== permit.leaseToken || current.leaseExpiresAt.getTime() <= nowImpl()) {
      throw new AiConsentError('Permit AI đã hết lease trước outbound', 'ai_permit_lease_lost', 409);
    }
    controller = new AbortController();
    const remainingMs = Math.max(1, Math.min(permit.deadlineAt.getTime(), permit.leaseExpiresAt.getTime()) - nowImpl());
    timer = setTimeout(() => controller.abort(new Error('ai_provider_timeout')), remainingMs);
    activeRequests.set(permit.requestId, { controller, permitId: permit.id });
    let result;
    try {
      const providerPromise = Promise.resolve(startRequest({ signal: controller.signal, permit: { id: permit.id, requestId: permit.requestId } }));
      providerStarted = true;
      const abortPromise = new Promise((_, reject) => {
        const rejectForAbort = () => {
          const error = controller.signal.reason instanceof Error ? controller.signal.reason : new Error('AI request aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (controller.signal.aborted) rejectForAbort();
        else controller.signal.addEventListener('abort', rejectForAbort, { once: true });
      });
      result = await Promise.race([providerPromise, abortPromise]);
    } catch (error) {
      const ambiguous = controller.signal.aborted || error?.name === 'AbortError';
      settlementAttempted = true;
      try {
        await settlePermit(client, permit, ambiguous ? 'TIMED_OUT_UNCONFIRMED' : 'FAILED', String(error?.code || error?.name || 'ai_error').slice(0, 80), nowImpl);
      } catch (lifecycleError) {
        logLifecyclePersistenceFailure({ permitId: permit.id, phase: 'provider_error_settlement', lifecycleError, providerError: error });
        throw new AiLifecyclePersistenceError('Provider lỗi và không thể lưu trạng thái permit', { lifecycleError, providerError: error, permitId: permit.id });
      }
      throw error;
    }
    settlementAttempted = true;
    try {
      await settlePermit(client, permit, 'COMPLETED', null, nowImpl);
    } catch (lifecycleError) {
      logLifecyclePersistenceFailure({ permitId: permit.id, phase: 'provider_success_settlement', lifecycleError, providerError: null });
      throw new AiLifecyclePersistenceError('Provider đã trả kết quả nhưng không thể lưu trạng thái permit', { lifecycleError, permitId: permit.id });
    }
    return result;
  } catch (error) {
    if (permit?.id && permit.status === 'PENDING' && !providerStarted) {
      try {
        await cancelPendingPermit(client, permit, error, nowImpl);
      } catch (lifecycleError) {
        logLifecyclePersistenceFailure({ permitId: permit.id, phase: 'pending_cancel', lifecycleError, providerError: null });
        throw new AiLifecyclePersistenceError('Không thể lưu trạng thái hủy permit chưa outbound', { lifecycleError, permitId: permit.id });
      }
    } else if (permit?.id && permit.status === 'ACTIVE' && !settlementAttempted) {
      try {
        await settlePermit(client, permit, 'FAILED', String(error?.code || error?.name || 'permit_error').slice(0, 80), nowImpl);
      } catch (lifecycleError) {
        logLifecyclePersistenceFailure({ permitId: permit.id, phase: 'pre_provider_active_failure', lifecycleError, providerError: null });
        throw new AiLifecyclePersistenceError('Không thể lưu lỗi permit ACTIVE trước outbound', { lifecycleError, permitId: permit.id });
      }
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (permit?.requestId) activeRequests.delete(permit.requestId);
    release();
  }
}

async function recoverAiPermits(client = prisma, dependencies = {}) {
  const now = new Date((dependencies.nowImpl || Date.now)());
  const pending = await client.aiTransmissionPermit.findMany({ where: { status: 'PENDING', deadlineAt: { lte: now } }, select: { id: true } });
  const active = await client.aiTransmissionPermit.findMany({ where: { status: 'ACTIVE', leaseExpiresAt: { lte: now } }, select: { id: true, requestId: true } });
  let cancelled = 0;
  let orphaned = 0;
  for (const permit of pending) {
    cancelled += await client.$transaction(async (tx) => {
      const updated = await tx.aiTransmissionPermit.updateMany({ where: { id: permit.id, status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: now, errorCode: 'permit_expired_before_claim', version: { increment: 1 } } });
      if (updated.count) await tx.auditLog.create({ data: { action: 'AI_PERMIT_RECOVERED_CANCELLED', entity: 'AiTransmissionPermit', entityId: permit.id, metadata: { reason: 'pending_deadline_expired' } } });
      return updated.count;
    }, { maxWait: config.aiDbMaxWaitMs, timeout: config.aiDispatchTransactionTimeoutMs });
  }
  for (const permit of active) {
    if (activeRequests.has(permit.requestId)) continue;
    orphaned += await client.$transaction(async (tx) => {
      const updated = await tx.aiTransmissionPermit.updateMany({ where: { id: permit.id, status: 'ACTIVE', leaseExpiresAt: { lte: now } }, data: { status: 'ORPHANED_UNCONFIRMED', errorCode: 'lease_expired_without_confirmation', version: { increment: 1 } } });
      if (updated.count) await tx.auditLog.create({ data: { action: 'AI_PERMIT_ORPHANED', entity: 'AiTransmissionPermit', entityId: permit.id, metadata: { reason: 'active_lease_expired', safeForWithdrawal: false } } });
      return updated.count;
    }, { maxWait: config.aiDbMaxWaitMs, timeout: config.aiDispatchTransactionTimeoutMs });
  }
  return { cancelled, orphaned };
}

async function reconcileAmbiguousPermit(permitId, options, client = prisma) {
  if (!Number.isInteger(options?.reviewedByUserId) || options.providerConfirmedTerminated !== true || !['COMPLETED', 'FAILED'].includes(options.resolution)) {
    throw new AiConsentError('Reconciliation cần xác nhận kết thúc từ provider và người duyệt hợp lệ', 'ai_reconciliation_evidence_required', 400);
  }
  return client.$transaction(async (tx) => {
    const permit = await tx.aiTransmissionPermit.findUnique({ where: { id: permitId } });
    if (!permit || !['TIMED_OUT_UNCONFIRMED', 'ORPHANED_UNCONFIRMED'].includes(permit.status)) {
      throw new AiConsentError('Permit không ở trạng thái ambiguous', 'ai_reconciliation_invalid_state', 409);
    }
    const updated = await tx.aiTransmissionPermit.updateMany({
      where: { id: permit.id, status: permit.status, version: permit.version },
      data: { status: options.resolution, completedAt: new Date(), errorCode: options.errorCode || permit.errorCode, version: { increment: 1 } }
    });
    if (updated.count !== 1) throw new AiConsentError('Permit vừa thay đổi trong lúc reconciliation', 'ai_reconciliation_conflict', 409);
    await tx.auditLog.create({ data: {
      userId: options.reviewedByUserId, action: 'AI_PERMIT_MANUAL_RECONCILIATION', entity: 'AiTransmissionPermit', entityId: permit.id,
      metadata: { fromStatus: permit.status, toStatus: options.resolution, providerConfirmedTerminated: true, evidenceReference: String(options.evidenceReference || '').slice(0, 200) }
    } });
    return { permitId: permit.id, status: options.resolution };
  }, { maxWait: config.aiDbMaxWaitMs, timeout: config.aiDispatchTransactionTimeoutMs });
}

async function shutdownAiPermits(dependencies = {}) {
  for (const request of activeRequests.values()) request.controller.abort(new Error('process_shutdown'));
  if (dependencies.waitMs > 0) await (dependencies.waitImpl || wait)(dependencies.waitMs);
  return activeRequests.size;
}

function currentAiContext() {
  return aiContext.getStore() || null;
}

module.exports = {
  AI_POLICY_VERSION, AI_PROVIDER, AI_SCOPES, SAFE_TERMINAL_STATUSES, UNSAFE_STATUSES,
  AiCapacityError, AiConsentError, AiLifecyclePersistenceError, AiSemaphore, activeConsents, assertSupportedAiTopology, currentAiContext,
  executeWithConsent, grantConsent, listConsents, outboundAiRequest, outboundSemaphore,
  reconcileAmbiguousPermit, recoverAiPermits, shutdownAiPermits, withdrawConsent
};

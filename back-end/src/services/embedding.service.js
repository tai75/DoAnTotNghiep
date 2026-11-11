const crypto = require('crypto');
const config = require('../config/env');
const { outboundAiRequest } = require('./aiConsent.service');

const CACHE_KEY_VERSION = 'gemini-embedding-cache-v3';
const PROVIDER = 'google-gemini-developer-api';
const API_VERSION = 'v1beta';
const TASK_INSTRUCTION = 'task: sentence similarity | query: ';
const CONTENT_ROLES = new Set(['candidate-profile', 'job-document']);

class EmbeddingError extends Error {
  constructor(message, { code = 'embedding_error', status = null, retryable = false } = {}) {
    super(message);
    this.name = 'EmbeddingError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function embeddingV3Config() {
  const outputDimensionality = Number(config.geminiEmbeddingV3Dimensions);
  const timeoutMs = Number(config.geminiEmbeddingTimeoutMs);
  const maxRetries = Number(config.geminiEmbeddingMaxRetries);
  const retryBaseMs = Number(config.geminiEmbeddingRetryBaseMs);
  if (!config.geminiEmbeddingV3Model || !config.geminiEmbeddingV3ModelVersion) throw new EmbeddingError('Thiếu model hoặc model version cho embedding V3', { code: 'configuration' });
  if (!Number.isInteger(outputDimensionality) || outputDimensionality < 128 || outputDimensionality > 3072) {
    throw new EmbeddingError('GEMINI_EMBEDDING_V3_DIMENSIONS phải là số nguyên trong [128, 3072]', { code: 'configuration' });
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new EmbeddingError('GEMINI_EMBEDDING_TIMEOUT_MS phải lớn hơn 0', { code: 'configuration' });
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) throw new EmbeddingError('GEMINI_EMBEDDING_MAX_RETRIES phải là số nguyên trong [0, 5]', { code: 'configuration' });
  if (!Number.isFinite(retryBaseMs) || retryBaseMs < 0) throw new EmbeddingError('GEMINI_EMBEDDING_RETRY_BASE_MS phải không âm', { code: 'configuration' });
  return Object.freeze({
    cacheKeyVersion: CACHE_KEY_VERSION,
    provider: PROVIDER,
    apiVersion: API_VERSION,
    model: config.geminiEmbeddingV3Model,
    modelVersion: config.geminiEmbeddingV3ModelVersion,
    taskInstruction: TASK_INSTRUCTION,
    outputDimensionality,
    autoTruncate: false,
    timeoutMs,
    maxRetries,
    retryBaseMs
  });
}

function buildEmbeddingCacheIdentity(text, contentRole, embeddingConfig = embeddingV3Config()) {
  if (typeof text !== 'string' || !text.trim()) throw new EmbeddingError('Embedding input không được rỗng', { code: 'invalid_input' });
  if (!CONTENT_ROLES.has(contentRole)) throw new EmbeddingError(`Embedding content role không hợp lệ: ${contentRole}`, { code: 'invalid_input' });
  const inputFingerprint = sha256(text);
  const identity = {
    cacheKeyVersion: embeddingConfig.cacheKeyVersion,
    provider: embeddingConfig.provider,
    apiVersion: embeddingConfig.apiVersion,
    model: embeddingConfig.model,
    modelVersion: embeddingConfig.modelVersion,
    taskInstruction: embeddingConfig.taskInstruction,
    outputDimensionality: embeddingConfig.outputDimensionality,
    autoTruncate: embeddingConfig.autoTruncate,
    contentRole,
    inputFingerprint
  };
  return { contentHash: sha256(JSON.stringify(identity)), inputFingerprint, identity };
}

function validateEmbeddingVector(vector, embeddingConfig = embeddingV3Config()) {
  if (!Array.isArray(vector) || vector.length !== embeddingConfig.outputDimensionality) {
    throw new EmbeddingError(`Embedding phải có đúng ${embeddingConfig.outputDimensionality} chiều`, { code: 'invalid_embedding' });
  }
  if (vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new EmbeddingError('Embedding phải chỉ chứa số hữu hạn', { code: 'invalid_embedding' });
  }
  if (vector.every((value) => value === 0)) throw new EmbeddingError('Embedding không được là zero vector', { code: 'invalid_embedding' });
  return vector;
}

function errorForStatus(status) {
  if (status === 408) return new EmbeddingError('Gemini embedding request timeout', { code: 'timeout', status, retryable: true });
  if (status === 429) return new EmbeddingError('Gemini embedding hết quota hoặc bị rate limit', { code: 'quota_or_rate_limit', status, retryable: true });
  if (status >= 500) return new EmbeddingError(`Gemini embedding tạm thời không khả dụng (${status})`, { code: 'provider_unavailable', status, retryable: true });
  return new EmbeddingError(`Gemini embedding từ chối request (${status})`, { code: 'provider_rejected', status, retryable: false });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestEmbedding(text, embeddingConfig, dependencies = {}) {
  const apiKey = dependencies.apiKey ?? config.geminiApiKey;
  if (!apiKey) throw new EmbeddingError('GEMINI_API_KEY chưa được cấu hình cho matching V3', { code: 'configuration' });
  const fetchImpl = dependencies.fetchImpl || global.fetch;
  const waitImpl = dependencies.waitImpl || wait;
  const nowImpl = dependencies.nowImpl || Date.now;
  const randomImpl = dependencies.randomImpl || Math.random;
  const totalTimeoutMs = dependencies.totalTimeoutMs ?? config.aiRetryTotalTimeoutMs;
  if (typeof fetchImpl !== 'function') throw new EmbeddingError('Fetch API không khả dụng', { code: 'configuration' });
  if (!Number.isFinite(totalTimeoutMs) || totalTimeoutMs <= 0) throw new EmbeddingError('Tổng timeout embedding phải lớn hơn 0', { code: 'configuration' });
  const deadlineAt = nowImpl() + totalTimeoutMs;
  let lastError;
  for (let attempt = 0; attempt <= embeddingConfig.maxRetries; attempt += 1) {
    const remainingMs = deadlineAt - nowImpl();
    if (remainingMs <= 0) throw new EmbeddingError('Gemini embedding retry chain timeout', { code: 'total_timeout' });
    try {
      const attemptDeadline = Math.min(deadlineAt, nowImpl() + embeddingConfig.timeoutMs);
      const payload = await outboundAiRequest(async ({ signal }) => {
        const requestTimeoutMs = attemptDeadline - nowImpl();
        if (requestTimeoutMs <= 0) throw new EmbeddingError('Gemini embedding retry chain timeout', { code: 'total_timeout' });
        const response = await fetchImpl(`https://generativelanguage.googleapis.com/${embeddingConfig.apiVersion}/models/${embeddingConfig.model}:embedContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            model: `models/${embeddingConfig.model}`,
            content: { parts: [{ text: `${embeddingConfig.taskInstruction}${text}` }] },
            embedContentConfig: { outputDimensionality: embeddingConfig.outputDimensionality, autoTruncate: embeddingConfig.autoTruncate }
          }),
          signal
        });
        if (!response.ok) throw errorForStatus(response.status);
        return response.json();
      }, {
        model: embeddingConfig.model, operation: 'semantic-matching-v3', input: text,
        client: dependencies.client, semaphore: dependencies.semaphore,
        deadlineAt: attemptDeadline, nowImpl
      });
      return validateEmbeddingVector(payload?.embedding?.values, embeddingConfig);
    } catch (error) {
      if (error?.name === 'AbortError') lastError = new EmbeddingError('Gemini embedding request timeout', { code: 'timeout', retryable: true });
      else if (error?.statusCode) throw error;
      else if (error instanceof EmbeddingError) lastError = error;
      else lastError = new EmbeddingError('Không thể kết nối Gemini embedding', { code: 'network', retryable: true });
      if (!lastError.retryable || attempt === embeddingConfig.maxRetries) throw lastError;
      const jitter = Math.floor(randomImpl() * Math.max(1, embeddingConfig.retryBaseMs));
      const delay = embeddingConfig.retryBaseMs * (2 ** attempt) + jitter;
      if (delay >= deadlineAt - nowImpl()) throw new EmbeddingError('Gemini embedding retry chain timeout', { code: 'total_timeout' });
      await waitImpl(delay);
    }
  }
  throw lastError;
}

async function embeddingForV3(text, contentRole, prismaClient, dependencies = {}) {
  if (!prismaClient?.embeddingCache) throw new EmbeddingError('Prisma embedding cache không khả dụng', { code: 'configuration' });
  const embeddingConfig = dependencies.embeddingConfig || embeddingV3Config();
  const baseIdentity = buildEmbeddingCacheIdentity(text, contentRole, embeddingConfig);
  const contentHash = dependencies.consent
    ? sha256(`${baseIdentity.contentHash}:${dependencies.consent.id}:${dependencies.consent.version}:${dependencies.dataSubjectUserId || ''}`)
    : baseIdentity.contentHash;
  const { inputFingerprint, identity } = baseIdentity;
  const cached = await prismaClient.embeddingCache.findUnique({ where: { contentHash } });
  if (cached) {
    if (cached.model !== embeddingConfig.model) throw new EmbeddingError('Embedding cache không khớp model V3', { code: 'invalid_cache' });
    return { vector: validateEmbeddingVector(cached.vector, embeddingConfig), cacheHit: true, contentHash, inputFingerprint, identity };
  }
  const vector = await requestEmbedding(text, embeddingConfig, dependencies);
  await prismaClient.embeddingCache.upsert({
    where: { contentHash },
    create: { contentHash, vector, model: embeddingConfig.model, ...(dependencies.consent ? { ownerUserId: dependencies.actorUserId, dataSubjectUserId: dependencies.dataSubjectUserId, aiConsentId: dependencies.consent.id, consentScope: 'SEMANTIC_MATCHING' } : {}) },
    update: { vector, model: embeddingConfig.model, ...(dependencies.consent ? { ownerUserId: dependencies.actorUserId, dataSubjectUserId: dependencies.dataSubjectUserId, aiConsentId: dependencies.consent.id, consentScope: 'SEMANTIC_MATCHING' } : {}) }
  });
  return { vector, cacheHit: false, contentHash, inputFingerprint, identity };
}

module.exports = {
  API_VERSION,
  CACHE_KEY_VERSION,
  EmbeddingError,
  TASK_INSTRUCTION,
  buildEmbeddingCacheIdentity,
  embeddingForV3,
  embeddingV3Config,
  requestEmbedding,
  validateEmbeddingVector
};

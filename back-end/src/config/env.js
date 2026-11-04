require('dotenv').config();

const path = require('path');

const required = ['DATABASE_URL', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const nodeEnv = process.env.NODE_ENV || 'development';
if (nodeEnv === 'production' && process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

const refreshCookieSameSite = (process.env.REFRESH_COOKIE_SAME_SITE || 'strict').toLowerCase();
if (!['strict', 'lax', 'none'].includes(refreshCookieSameSite)) {
  throw new Error('REFRESH_COOKIE_SAME_SITE must be strict, lax, or none');
}

function publicUrl(name, fallback) {
  const parsed = new URL(process.env[name] || fallback);
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS in production`);
  return parsed.origin;
}

function parseCorsOrigins(value) {
  return value.split(',').map((origin) => origin.trim()).filter(Boolean).map((origin) => {
    if (origin === '*') throw new Error('CORS_ORIGINS cannot contain wildcard when credentials are enabled');
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('CORS_ORIGINS must use http or https');
    if (nodeEnv === 'production' && parsed.protocol !== 'https:') throw new Error('CORS_ORIGINS must use HTTPS in production');
    return parsed.origin;
  });
}

function featureFlag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

module.exports = {
  nodeEnv,
  port: Number(process.env.PORT || 5000),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtIssuer: process.env.JWT_ISSUER || 'job-connect-api',
  jwtAudience: process.env.JWT_AUDIENCE || 'job-connect-web',
  refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  refreshCookieName: process.env.REFRESH_COOKIE_NAME || 'job_connect_refresh',
  refreshCookieSameSite,
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM || process.env.SMTP_USER
  },
  frontendUrl: publicUrl('FRONTEND_URL', 'http://localhost:5173'),
  apiPublicUrl: publicUrl('API_PUBLIC_URL', 'http://localhost:5000'),
  uploadsDirectory: path.resolve(process.env.UPLOADS_DIRECTORY || path.join(__dirname, '../../uploads')),
  logosDirectory: path.resolve(process.env.LOGOS_DIRECTORY || path.join(__dirname, '../../public/logos')),
  alertWorkerEnabled: process.env.ALERT_WORKER_ENABLED !== 'false',
  alertWorkerCron: process.env.ALERT_WORKER_CRON || '* * * * *',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS || 'http://localhost:5173'),
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
  geminiEmbeddingV3Model: process.env.GEMINI_EMBEDDING_V3_MODEL || 'gemini-embedding-2',
  geminiEmbeddingV3ModelVersion: process.env.GEMINI_EMBEDDING_V3_MODEL_VERSION || process.env.GEMINI_EMBEDDING_V3_MODEL || 'gemini-embedding-2',
  geminiEmbeddingV3Dimensions: Number(process.env.GEMINI_EMBEDDING_V3_DIMENSIONS || 768),
  geminiEmbeddingTimeoutMs: Number(process.env.GEMINI_EMBEDDING_TIMEOUT_MS || 8000),
  geminiEmbeddingMaxRetries: Number(process.env.GEMINI_EMBEDDING_MAX_RETRIES || 2),
  geminiEmbeddingRetryBaseMs: Number(process.env.GEMINI_EMBEDDING_RETRY_BASE_MS || 250),
  matchingV2Enabled: featureFlag('MATCHING_V2_ENABLED'),
  matchingV3Enabled: featureFlag('MATCHING_V3_ENABLED'),
  matchingV2Weights: process.env.MATCHING_V2_WEIGHTS,
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 8000),
  trustProxy: process.env.TRUST_PROXY === 'true' ? 1 : false
};

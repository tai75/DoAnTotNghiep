const { z } = require('zod');
const config = require('../config/env');
const { jobDescriptionInput, redactGeminiContents, redactText } = require('./aiRedaction.service');
const { outboundAiRequest } = require('./aiConsent.service');

const requestCounts = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_USER = 20;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_BASE_MS = 100;

class GeminiError extends Error {
  constructor(message, { code = 'gemini_error', status = null, retryable = false } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}
const resumeDate = z.string().max(30).nullable().default(null).refine((value) => !value || !Number.isNaN(Date.parse(value)), 'Ngày không hợp lệ');
const resumeImportSchema = z.object({
  headline: z.string().max(180).nullable().default(null),
  skills: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  education: z.array(z.object({
    school: z.string().trim().min(1).max(255),
    major: z.string().max(180).nullable().default(null),
    degree: z.string().max(120).nullable().default(null),
    fromDate: resumeDate,
    toDate: resumeDate
  })).max(20).default([]),
  experience: z.array(z.object({
    company: z.string().trim().min(1).max(180),
    title: z.string().trim().min(1).max(180),
    description: z.string().max(10000).nullable().default(null),
    fromDate: resumeDate,
    toDate: resumeDate,
    isCurrent: z.boolean().default(false)
  })).max(30).default([]),
  projects: z.array(z.object({
    name: z.string().trim().min(1).max(180),
    description: z.string().max(10000).nullable().default(null),
    link: z.string().max(500).nullable().default(null),
    technologies: z.array(z.string().max(100)).max(50).default([])
  })).max(30).default([])
});
const resumeJobAnalysisSchema = z.object({
  fitScore: z.number().min(0).max(100),
  missingKeywords: z.array(z.string().trim().min(1).max(100)).max(30),
  strengths: z.array(z.string().trim().min(1).max(500)).length(3),
  suggestions: z.array(z.string().trim().min(1).max(1000)).length(3)
});

function canUse(userId) {
  const now = Date.now();
  const current = requestCounts.get(userId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    requestCounts.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_REQUESTS_PER_USER) return false;
  current.count += 1;
  return true;
}

function geminiErrorForStatus(status) {
  if (status === 408) return new GeminiError('Gemini request timeout', { code: 'timeout', status, retryable: true });
  if (status === 429) return new GeminiError('Gemini quota or rate limit exceeded', { code: 'quota_or_rate_limit', status, retryable: true });
  if (status >= 500) return new GeminiError(`Gemini temporarily unavailable (${status})`, { code: 'provider_unavailable', status, retryable: true });
  return new GeminiError(`Gemini rejected request (${status})`, { code: 'provider_rejected', status, retryable: false });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(contents, tools = [], dependencies = {}) {
  const apiKey = dependencies.apiKey ?? config.geminiApiKey;
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY chưa được cấu hình', { code: 'configuration' });
  const fetchImpl = dependencies.fetchImpl || global.fetch;
  const nowImpl = dependencies.nowImpl || Date.now;
  const timeoutMs = dependencies.timeoutMs ?? config.llmTimeoutMs;
  if (typeof fetchImpl !== 'function') throw new GeminiError('Fetch API không khả dụng', { code: 'configuration' });
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new GeminiError('LLM timeout phải lớn hơn 0', { code: 'configuration' });
  const safeContents = redactGeminiContents(contents, { knownValues: dependencies.knownValues || [] });
  try {
    return await outboundAiRequest(async ({ signal }) => {
      const requestTimeoutMs = dependencies.deadlineAt
        ? Math.min(timeoutMs, dependencies.deadlineAt - nowImpl())
        : timeoutMs;
      if (requestTimeoutMs <= 0) throw new GeminiError('Gemini retry chain timeout', { code: 'total_timeout', retryable: false });
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: safeContents, ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}) }),
        signal
      });
      if (!response.ok) throw geminiErrorForStatus(response.status);
      return await response.json();
    }, {
      consentRequirements: dependencies.consentRequirements, dataSubjectUserId: dependencies.dataSubjectUserId,
      model: config.geminiModel, input: JSON.stringify(safeContents), client: dependencies.client,
      semaphore: dependencies.semaphore,
      deadlineAt: Math.min(dependencies.deadlineAt || Number.POSITIVE_INFINITY, nowImpl() + timeoutMs), nowImpl
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new GeminiError('Gemini request timeout', { code: 'timeout', retryable: true });
    if (error?.statusCode) throw error;
    if (error instanceof GeminiError) throw error;
    throw new GeminiError('Không thể kết nối Gemini', { code: 'network', retryable: true });
  }
}

async function withRetry(operation, dependencies = {}) {
  const maxAttempts = dependencies.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryBaseMs = dependencies.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const waitImpl = dependencies.waitImpl || wait;
  const nowImpl = dependencies.nowImpl || Date.now;
  const totalTimeoutMs = dependencies.totalTimeoutMs ?? config.aiRetryTotalTimeoutMs;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 6) throw new GeminiError('Số lần gọi Gemini không hợp lệ', { code: 'configuration' });
  if (!Number.isFinite(totalTimeoutMs) || totalTimeoutMs <= 0) throw new GeminiError('Tổng timeout AI phải lớn hơn 0', { code: 'configuration' });
  const deadlineAt = nowImpl() + totalTimeoutMs;
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const remainingMs = deadlineAt - nowImpl();
    if (remainingMs <= 0) throw new GeminiError('Gemini retry chain timeout', { code: 'total_timeout', retryable: false });
    try {
      return await operation({ attempt, deadlineAt, remainingMs });
    } catch (error) {
      lastError = error;
      if (!error?.retryable || attempt === maxAttempts - 1) throw error;
      const delay = retryBaseMs * (2 ** attempt);
      if (delay >= deadlineAt - nowImpl()) throw new GeminiError('Gemini retry chain timeout', { code: 'total_timeout', retryable: false });
      await waitImpl(delay);
    }
  }
  throw lastError;
}

function callGeminiWithRetry(contents, tools = [], dependencies = {}) {
  return withRetry(({ deadlineAt, remainingMs }) => callGemini(contents, tools, {
    ...dependencies,
    deadlineAt,
    timeoutMs: Math.min(dependencies.timeoutMs ?? config.llmTimeoutMs, remainingMs)
  }), dependencies);
}

async function explainMatch(result, userId, dependencies = {}) {
  const apiKey = dependencies.apiKey ?? config.geminiApiKey;
  if (!apiKey || !canUse(`explain:${userId}`)) return null;
  try {
    const response = await callGeminiWithRetry([{ role: 'user', parts: [{ text: `Viết một câu tiếng Việt ngắn giải thích vì sao ứng viên phù hợp công việc. Điểm: ${result.score}/100. Kỹ năng khớp: ${result.matchedSkills.map((item) => item.name).join(', ') || 'không có'}. Kỹ năng thiếu: ${result.missingSkills.map((item) => item.name).join(', ') || 'không có'}. Chỉ trả về câu giải thích, không bịa dữ liệu.` }] }], [], dependencies);
    return response?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text?.trim() || null;
  } catch (error) {
    return null;
  }
}

function parseJsonResponse(response) {
  const text = response?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text?.trim();
  if (!text) throw new Error('AI không trả về dữ liệu hồ sơ');
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
}

async function extractResumeProfile(userId, text, dependencies = {}) {
  if (!config.geminiApiKey) {
    const error = new Error('AI chưa được cấu hình. Vui lòng nhập hồ sơ thủ công.');
    error.statusCode = 503;
    throw error;
  }
  if (!canUse(`resume-import:${userId}`)) {
    const error = new Error('Bạn đã vượt quá giới hạn nhập hồ sơ bằng AI trong giờ này.');
    error.statusCode = 429;
    throw error;
  }
  try {
    const response = await callGeminiWithRetry([{ role: 'user', parts: [{ text: `Trích xuất hồ sơ ứng viên từ CV dưới đây. Chỉ trả về JSON hợp lệ, không markdown, đúng schema:
{"headline":string|null,"skills":string[],"education":[{"school":string,"major":string|null,"degree":string|null,"fromDate":string|null,"toDate":string|null}],"experience":[{"company":string,"title":string,"description":string|null,"fromDate":string|null,"toDate":string|null,"isCurrent":boolean}],"projects":[{"name":string,"description":string|null,"link":string|null,"technologies":string[]}]}
Không suy đoán thông tin không có trong CV; dùng null hoặc mảng rỗng. CV:
${redactText(text)}` }] }], [], dependencies);
    return resumeImportSchema.parse(parseJsonResponse(response));
  } catch (error) {
    if (error.statusCode) throw error;
    const invalid = new Error(error instanceof z.ZodError || error instanceof SyntaxError
      ? 'AI trả về dữ liệu hồ sơ không đúng định dạng. Vui lòng thử lại hoặc nhập thủ công.'
      : 'Không thể phân tích CV lúc này. Vui lòng thử lại sau.');
    invalid.statusCode = error instanceof GeminiError && error.retryable ? 503 : 502;
    throw invalid;
  }
}

async function generateJobDescription(userId, details, dependencies = {}) {
  if (!config.geminiApiKey) {
    const error = new Error('AI chưa được cấu hình. Vui lòng nhập mô tả thủ công.');
    error.statusCode = 503;
    throw error;
  }

  if (!canUse(`job-description:${userId}`)) {
    const error = new Error('Bạn đã vượt quá giới hạn gợi ý AI trong giờ này.');
    error.statusCode = 429;
    throw error;
  }

  try {
    const response = await callGeminiWithRetry([{ role: 'user', parts: [{ text: `Viết mô tả tuyển dụng bằng tiếng Việt, rõ ràng và không bịa thông tin. Dữ liệu: ${JSON.stringify(jobDescriptionInput(details))}. Chỉ trả về mô tả công việc.` }] }], [], dependencies);
    return response?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text?.trim() || null;
  } catch (error) {
    return null;
  }
}

async function analyzeResumeForJob(userId, resumeText, job, match, dependencies = {}) {
  if (!config.geminiApiKey) {
    const error = new Error('AI chưa được cấu hình. Vui lòng thử lại sau.');
    error.statusCode = 503;
    throw error;
  }
  if (!canUse(`resume-job-analysis:${userId}`)) {
    const error = new Error('Bạn đã vượt quá giới hạn phân tích CV trong giờ này.');
    error.statusCode = 429;
    throw error;
  }
  const prompt = `Phân tích CV cho công việc. Chỉ trả JSON hợp lệ, không markdown, đúng schema:
{"fitScore":number,"missingKeywords":string[],"strengths":[string,string,string],"suggestions":[string,string,string]}
fitScore phải bằng hoặc thấp hơn điểm matching được cung cấp. missingKeywords chỉ chọn từ danh sách kỹ năng còn thiếu.
Điểm matching: ${match.score}. Kỹ năng khớp: ${match.matchedSkills.map((item) => item.name).join(', ') || 'không có'}. Kỹ năng còn thiếu: ${match.missingSkills.map((item) => item.name).join(', ') || 'không có'}.
Mô tả công việc:
${job.description}
CV:
${redactText(resumeText)}`;
  try {
    const response = await callGeminiWithRetry([{ role: 'user', parts: [{ text: prompt }] }], [], dependencies);
    const result = resumeJobAnalysisSchema.parse(parseJsonResponse(response));
    const allowedMissing = new Set(match.missingSkills.map((item) => item.name.toLowerCase()));
    return {
      ...result,
      fitScore: Math.min(result.fitScore, match.score),
      missingKeywords: result.missingKeywords.filter((item) => allowedMissing.has(item.toLowerCase()))
    };
  } catch (error) {
    if (error.statusCode) throw error;
    const invalid = new Error('AI trả về kết quả phân tích không đúng định dạng. Vui lòng thử lại.');
    invalid.statusCode = error instanceof GeminiError && error.retryable ? 503 : 502;
    throw invalid;
  }
}

async function chat({ userId, role, message, tools, dependencies = {} }) {
  if (!config.geminiApiKey) throw new Error('Dịch vụ AI chưa được cấu hình');
  if (!canUse(`chat:${userId}`)) {
    const error = new Error('Bạn đã vượt quá giới hạn yêu cầu AI trong giờ này');
    error.statusCode = 429;
    throw error;
  }
  const declarations = tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  const contents = [{ role: 'user', parts: [{ text: `Bạn là trợ lý tuyển dụng. Vai trò người dùng: ${role}. Chỉ dùng dữ liệu từ các tool được cung cấp; không được bịa tin tuyển dụng hoặc ứng viên. Nếu cần dữ liệu, bắt buộc gọi tool. Câu hỏi: ${message}` }] }];
  const consentRequirements = [];
  for (let turn = 0; turn < 3; turn += 1) {
    const response = await callGeminiWithRetry(contents, declarations, { ...dependencies, consentRequirements });
    const parts = response?.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((part) => part.functionCall);
    if (!calls.length) return parts.find((part) => part.text)?.text || 'Không tìm thấy thông tin phù hợp.';
    contents.push({ role: 'model', parts });
    for (const call of calls) {
      const tool = tools.find((item) => item.name === call.functionCall.name);
      if (!tool) throw new Error('AI yêu cầu tool không được phép');
      const result = await tool.execute(call.functionCall.args || {});
      if (tool.consentRequirements) consentRequirements.push(...tool.consentRequirements(result));
      const aiResult = tool.toAiResult ? tool.toAiResult(result) : result;
      contents.push({ role: 'function', parts: [{ functionResponse: { name: tool.name, response: { result: aiResult } } }] });
    }
  }
  return 'Không thể hoàn tất truy vấn AI.';
}

module.exports = {
  GeminiError,
  MAX_REQUESTS_PER_USER,
  analyzeResumeForJob,
  callGemini,
  chat,
  explainMatch,
  extractResumeProfile,
  generateJobDescription,
  resumeImportSchema,
  resumeJobAnalysisSchema,
  withRetry
};

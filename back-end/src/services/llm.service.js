const config = require('../config/env');

const requestCounts = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_USER = 20;

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

async function callGemini(contents, tools = []) {
  if (!config.geminiApiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}) }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Gemini request failed: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(operation) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await operation(); } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function explainMatch(result, userId) {
  if (!config.geminiApiKey || !canUse(`explain:${userId}`)) return null;
  try {
    const response = await withRetry(() => callGemini([{ role: 'user', parts: [{ text: `Viết một câu tiếng Việt ngắn giải thích vì sao ứng viên phù hợp công việc. Điểm: ${result.score}/100. Kỹ năng khớp: ${result.matchedSkills.map((item) => item.name).join(', ') || 'không có'}. Kỹ năng thiếu: ${result.missingSkills.map((item) => item.name).join(', ') || 'không có'}. Chỉ trả về câu giải thích, không bịa dữ liệu.` }] }]));
    return response?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text?.trim() || null;
  } catch (error) {
    return null;
  }
}

async function chat({ userId, role, message, tools }) {
  if (!config.geminiApiKey) throw new Error('Dịch vụ AI chưa được cấu hình');
  if (!canUse(`chat:${userId}`)) {
    const error = new Error('Bạn đã vượt quá giới hạn yêu cầu AI trong giờ này');
    error.statusCode = 429;
    throw error;
  }
  const declarations = tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  const contents = [{ role: 'user', parts: [{ text: `Bạn là trợ lý tuyển dụng. Vai trò người dùng: ${role}. Chỉ dùng dữ liệu từ các tool được cung cấp; không được bịa tin tuyển dụng hoặc ứng viên. Nếu cần dữ liệu, bắt buộc gọi tool. Câu hỏi: ${message}` }] }];
  for (let turn = 0; turn < 3; turn += 1) {
    const response = await withRetry(() => callGemini(contents, declarations));
    const parts = response?.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((part) => part.functionCall);
    if (!calls.length) return parts.find((part) => part.text)?.text || 'Không tìm thấy thông tin phù hợp.';
    contents.push({ role: 'model', parts });
    for (const call of calls) {
      const tool = tools.find((item) => item.name === call.functionCall.name);
      if (!tool) throw new Error('AI yêu cầu tool không được phép');
      const result = await tool.execute(call.functionCall.args || {});
      contents.push({ role: 'function', parts: [{ functionResponse: { name: tool.name, response: { result } } }] });
    }
  }
  return 'Không thể hoàn tất truy vấn AI.';
}

module.exports = { explainMatch, chat, MAX_REQUESTS_PER_USER };

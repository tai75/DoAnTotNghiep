const path = require('path');

function safeDownloadName(value, fallback = 'download') {
  const cleaned = path.basename(String(value || '')).replace(/[\u0000-\u001f\u007f"\\]/g, '').trim().slice(0, 180);
  return cleaned || fallback;
}

function contentDisposition(type, fileName) {
  const safe = safeDownloadName(fileName);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function setPrivateFileHeaders(res, mimeType, fileName) {
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', contentDisposition('attachment', fileName));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
}

module.exports = { safeDownloadName, contentDisposition, setPrivateFileHeaders };

const path = require('path');
const router = require('express').Router();
const storage = require('../storage/localStorage');
const { contentDisposition } = require('../storage/httpHeaders');

const logoMimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

router.get('/logos/:key', async (req, res, next) => {
  try {
    const entry = await storage.locate(storage.namespaces.logos, req.params.key);
    if (!entry) return res.status(404).json({ success: false, message: 'Không tìm thấy logo' });
    const mimeType = logoMimeTypes[path.extname(entry.key).toLowerCase()];
    if (!mimeType) return res.status(404).json({ success: false, message: 'Không tìm thấy logo' });
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', contentDisposition('inline', entry.key));
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return res.sendFile(entry.path);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

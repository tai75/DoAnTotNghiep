const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const config = require('./config/env');
const prisma = require('./config/prisma');
const ApiError = require('./utils/apiError');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth.routes');
const companiesRoutes = require('./routes/companies.routes');
const jobsRoutes = require('./routes/jobs.routes');
const applicationsRoutes = require('./routes/applications.routes');
const candidatesRoutes = require('./routes/candidates.routes');
const adminRoutes = require('./routes/admin.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const recruitersRoutes = require('./routes/recruiters.routes');
const recommendationsRoutes = require('./routes/recommendations.routes');
const conversationsRoutes = require('./routes/conversations.routes');
const storageRoutes = require('./routes/storage.routes');
const interviewsRoutes = require('./routes/interviews.routes');

const app = express();

app.set('trust proxy', config.trustProxy);
app.use(helmet());
app.use((req, res, next) => {
  const suppliedRequestId = req.get('x-request-id');
  req.id = suppliedRequestId && /^[A-Za-z0-9._-]{1,100}$/.test(suppliedRequestId) ? suppliedRequestId : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new ApiError(403, 'Origin không được phép'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  maxAge: 600
}));
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' }
}));
app.use(express.json({ limit: '2mb' }));
morgan.token('safe-path', (req) => req.path);
app.use(morgan(':method :safe-path :status :response-time ms'));
app.use('/assets', storageRoutes);
app.use('/assets', express.static(path.join(__dirname, '../public'), { index: false, fallthrough: true }));

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Job Connect API is running', timestamp: new Date().toISOString() });
});

app.get('/api/health/live', (req, res) => {
  res.json({ success: true, status: 'live', timestamp: new Date().toISOString() });
});

app.get('/api/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, status: 'ready', database: 'reachable', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error({ requestId: req.id, name: error.name, probe: 'readiness' });
    res.status(503).json({ success: false, status: 'not-ready', database: 'unreachable', timestamp: new Date().toISOString() });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/candidates', candidatesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/recruiters', recruitersRoutes);
app.use('/api/recommendations', recommendationsRoutes);
app.use('/api/ai', recommendationsRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/interviews', interviewsRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

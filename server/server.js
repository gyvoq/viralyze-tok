
'use strict';

require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');

const { globalLimiter, activationLimiter, adminLimiter, adminFailLimiter, extractLimiter } = require('./middleware/rateLimiter');
const {
  sanitizeActivationBody,
  sanitizeSessionBody,
  sanitizeCreateLicense,
  sanitizeKeyParam,
} = require('./middleware/sanitize');
const { requireAdmin, requireSession } = require('./middleware/auth');

const { activateLicense, verifySession, logout } = require('./controllers/licenseController');
const { listLicenses, createLicense, revokeLicense, deleteLicense, resetDevice } = require('./controllers/adminController');
const licenseStore = require('./models/licenseStore');
const { extractMotion, extractQuota } = require('./controllers/extractController');
const { viralCover } = require('./controllers/coverController');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.disable('x-powered-by');

const coverLimiter = rateLimit({ store: new (require('./middleware/mongoRateStore'))('coverLimiter'), windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas requisições.' } });
app.get('/api/viral-cover', coverLimiter, viralCover);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Frontend e API rodam no MESMO domínio na Vercel: requisições da própria origem
// (ou sem Origin) passam; outras origens só se estiverem em ALLOWED_ORIGINS.
app.use(cors((req, callback) => {
  const origin = req.header('Origin');
  const host   = req.header('x-forwarded-host') || req.header('host');
  const base   = {
    methods        : ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders : ['Content-Type', 'X-Admin-Secret'],
    exposedHeaders : ['RateLimit-Limit', 'RateLimit-Remaining'],
    credentials    : false,
  };
  if (!origin || origin === `https://${host}` || origin === `http://${host}` || allowedOrigins.includes(origin)) {
    return callback(null, { ...base, origin: true });
  }
  callback(new Error(`Origem não autorizada: ${origin}`));
}));

app.use(express.json({ limit: '10kb' }));

app.use(globalLimiter);

app.post(
  '/api/activate',
  activationLimiter,
  sanitizeActivationBody,
  activateLicense
);

app.post(
  '/api/verify-session',
  sanitizeSessionBody,
  verifySession
);

app.post('/api/logout', logout);

app.post(
  '/api/extract-motion',
  sanitizeSessionBody,
  requireSession,
  extractLimiter,
  extractMotion
);

app.post(
  '/api/extract-quota',
  sanitizeSessionBody,
  requireSession,
  extractQuota
);

app.use('/api/admin', adminFailLimiter, adminLimiter, requireAdmin);

app.get('/api/admin/licenses', listLicenses);

app.post(
  '/api/admin/licenses',
  sanitizeCreateLicense,
  createLicense
);

app.delete(
  '/api/admin/licenses/:key',
  sanitizeKeyParam,
  revokeLicense
);

app.delete(
  '/api/admin/licenses/:key/hard',
  sanitizeKeyParam,
  deleteLicense
);

app.patch(
  '/api/admin/licenses/:key/reset-device',
  sanitizeKeyParam,
  resetDevice
);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', env: process.env.NODE_ENV });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use((err, _req, res, _next) => {
  const isProd = process.env.NODE_ENV === 'production';
  console.error('[Erro]', err.message);
  res.status(500).json({
    error: isProd ? 'Erro interno do servidor.' : err.message,
  });
});

async function start() {
  if (!(process.env.MONGO_URI || '').trim()) {
    console.error('❌  MONGO_URI não configurada. Defina a variável de ambiente e reinicie.');
    process.exit(1);
  }
  try {
    await licenseStore.init();
  } catch (err) {
    console.error('❌  Falha ao conectar no MongoDB:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log('');
    console.log('  ⚡ Viralyze Tok Backend');
    console.log(`  ✅ Rodando em http://localhost:${PORT}`);
    console.log(`  🌍 Ambiente: ${process.env.NODE_ENV}`);
    console.log(`  🔒 Origens permitidas: ${allowedOrigins.join(', ') || 'nenhuma'}`);
    console.log(`  🛡️  Rate limit ativação: ${process.env.MAX_ACTIVATION_ATTEMPTS || 5} tentativas/15min`);
    console.log(`  🔔 Alerta por webhook: ${/^https:\/\//i.test(process.env.ALERT_WEBHOOK_URL || '') ? 'ligado' : 'desligado (defina ALERT_WEBHOOK_URL)'}`);
    console.log('');

    const placeholder = /troque|mude|changeme|change-me/i;
    if (placeholder.test(process.env.ADMIN_SECRET || '')) {
      console.warn('  ⚠️  ADMIN_SECRET ainda é o padrão — o painel admin fica BLOQUEADO (503) até você trocar.');
    } else if ((process.env.ADMIN_SECRET || '').length < 20) {
      console.warn('  ⚠️  ADMIN_SECRET curto (<20 caracteres) — use um segredo longo e aleatório.');
    }
  });
}

if (require.main === module) start();

module.exports = app;

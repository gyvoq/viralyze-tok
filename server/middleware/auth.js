'use strict';
const { safeEqual } = require('../utils/crypto');
const audit = require('../utils/audit');
const licenseStore = require('../models/licenseStore');
const { isExpired } = require('../utils/dateHelper');

// Segredos de exemplo que nunca devem ir para produção.
const PLACEHOLDER = /troque|mude|changeme|change-me/i;

// Protege /api/admin. O atraso artificial (setTimeout) foi removido: ele não freava
// tentativas paralelas. O freio agora é o adminFailLimiter (middleware/rateLimiter.js),
// que conta as respostas 401 por IP e roda ANTES deste middleware.
function requireAdmin(req, res, next) {
  const secret   = process.env.ADMIN_SECRET;
  const received = req.headers['x-admin-secret'];

  if (!secret || PLACEHOLDER.test(secret)) {
    return res.status(503).json({ error: 'Serviço não configurado.' });
  }
  if (typeof received !== 'string' || !received || !safeEqual(secret, received)) {
    audit.log('admin_auth_fail', {
      ip: req.ip, path: req.originalUrl, method: req.method, userAgent: req.headers['user-agent'],
    });
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  next();
}

// Exige um token de sessão válido (licença ativa, não revogada, não expirada). Preenche req.license.
async function requireSession(req, res, next) {
  try {
    const token = req.sanitized && req.sanitized.token;
    const record = await licenseStore.findByToken(token);
    if (!record || !safeEqual(record.sessionToken || '', token)) return res.status(401).json({ error: 'Sessão inválida.' });
    if (record.revokedAt) return res.status(403).json({ error: 'Licença revogada.' });
    if (isExpired(record.expiresAt)) return res.status(403).json({ error: 'Licença expirada.' });
    req.license = { key: record.key };
    next();
  } catch (err) { next(err); }
}

module.exports = { requireAdmin, requireSession };

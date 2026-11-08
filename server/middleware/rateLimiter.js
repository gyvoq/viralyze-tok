'use strict';
const rateLimit = require('express-rate-limit');
const audit = require('../utils/audit');
const MongoStore = require('./mongoRateStore');

const MAX_ATTEMPTS = parseInt(process.env.MAX_ACTIVATION_ATTEMPTS || '5', 10);
const ADMIN_MAX_FAILS = parseInt(process.env.ADMIN_MAX_FAILS || '10', 10);

const globalLimiter = rateLimit({
  store: new MongoStore('globalLimiter'),
  windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' },
});

const activationLimiter = rateLimit({
  store: new MongoStore('activationLimiter'),
  windowMs: 15 * 60 * 1000,
  max: MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `activate:${req.ip}`,
  handler: (req, res, _next, options) => {
    audit.log('activation_rate_limited', { ip: req.ip, path: req.originalUrl, userAgent: req.headers['user-agent'] });
    res.status(options.statusCode).json({ error: 'Muitas tentativas de ativação. Aguarde 15 minutos.' });
  },
});

const adminLimiter = rateLimit({
  store: new MongoStore('adminLimiter'),
  windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Limite admin atingido.' },
});

const adminFailLimiter = rateLimit({
  store: new MongoStore('adminFailLimiter'),
  windowMs: 15 * 60 * 1000,
  max: ADMIN_MAX_FAILS,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  keyGenerator: (req) => `admin-fail:${req.ip}`,
  handler: (req, res, _next, options) => {
    audit.log('admin_rate_limited', { ip: req.ip, path: req.originalUrl, userAgent: req.headers['user-agent'] });
    res.status(options.statusCode).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
  },
});

const EXTRACT_MAX        = parseInt(process.env.EXTRACT_MAX || '5', 10);
const EXTRACT_WINDOW_MIN = parseInt(process.env.EXTRACT_WINDOW_MIN || '10', 10);
const extractLimiter = rateLimit({
  store: new MongoStore('extractLimiter'),
  windowMs: EXTRACT_WINDOW_MIN * 60 * 1000,
  max: EXTRACT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `extract:${req.license.key}`,
  handler: (req, res) => {
    const retryAfterSec = Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000));
    res.status(429).json({ error: 'Limite de extrações atingido. Aguarde para tentar novamente.', retryAfterSec });
  },
});

module.exports = { globalLimiter, activationLimiter, adminLimiter, adminFailLimiter, extractLimiter, EXTRACT_MAX, EXTRACT_WINDOW_MIN };

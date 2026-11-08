'use strict';

const { extractLimiter, EXTRACT_MAX } = require('../middleware/rateLimiter');

function secondsUntil(date) {
  if (!date) return 0;
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t - Date.now()) / 1000));
}

function extractMotion(req, res) {
  const limit     = req.rateLimit ? req.rateLimit.limit : undefined;
  const remaining = req.rateLimit ? req.rateLimit.remaining : undefined;
  const resetSec  = req.rateLimit ? secondsUntil(req.rateLimit.resetTime) : 0;
  return res.status(200).json({ ok: true, limit, remaining, resetSec });
}

async function extractQuota(req, res) {
  try {
    const info = await extractLimiter.getKey('extract:' + req.license.key);
    const hits = info && typeof info.totalHits === 'number' ? info.totalHits : 0;
    return res.status(200).json({
      limit: EXTRACT_MAX,
      remaining: Math.max(0, EXTRACT_MAX - hits),
      resetSec: hits > 0 ? secondsUntil(info.resetTime) : 0,
    });
  } catch (err) {
    console.error('[Extract] quota:', err.message);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

module.exports = { extractMotion, extractQuota };

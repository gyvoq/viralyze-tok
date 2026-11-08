'use strict';
const licenseStore = require('../models/licenseStore');
const { safeEqual } = require('../utils/crypto');
const { isExpired, fmtDate } = require('../utils/dateHelper');
const audit = require('../utils/audit');

async function activateLicense(req, res) {
  const { key, deviceId, deviceSecret } = req.sanitized;
  const ctx = { ip: req.ip, key, deviceId, userAgent: req.headers['user-agent'] };

  try {
    const result = await licenseStore.activate(key, deviceId, deviceSecret);
    audit.log('activate_ok', { ...ctx, reason: result.alreadyActivated ? 'reauth' : 'first_activation' });

    const body = {
      success: true,
      token: result.token,
      expiresAt: result.expiresAt,
      alreadyActivated: result.alreadyActivated,
      message: result.alreadyActivated
        ? `Bem-vindo de volta! Válida até ${fmtDate(result.expiresAt)}.`
        : `Licença ativada! Válida até ${fmtDate(result.expiresAt)}.`,
    };
    // Só presente quando o servidor acabou de emitir um segredo (1ª ativação/migração).
    if (result.deviceSecret) body.deviceSecret = result.deviceSecret;
    return res.status(200).json(body);
  } catch (err) {
    if (!(err instanceof licenseStore.LicenseError)) {
      console.error('[Activate] erro inesperado:', err.message);
      return res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' });
    }

    audit.log('activate_fail', { ...ctx, reason: err.code });

    if (err.code === 'DEVICE_MISMATCH') {
      return res.status(403).json({ error: 'Esta chave já está em uso em outro dispositivo.' });
    }
    if (err.code === 'REVOKED') {
      return res.status(403).json({ error: 'Chave revogada.' });
    }
    return res.status(401).json({ error: 'Código inválido ou expirado. Verifique e tente novamente.' });
  }
}

async function verifySession(req, res) {
  try {
    const { token } = req.sanitized;
    const record = await licenseStore.findByToken(token);
    if (!record || !safeEqual(record.sessionToken || '', token)) return res.status(401).json({ valid: false });
    if (record.revokedAt) {
      await licenseStore.revokeToken(token);
      return res.status(403).json({ valid: false, reason: 'revoked' });
    }
    if (isExpired(record.expiresAt)) {
      await licenseStore.revokeToken(token);
      return res.status(403).json({ valid: false, reason: 'expired' });
    }
    return res.status(200).json({ valid: true, expiresAt: record.expiresAt });
  } catch (err) {
    console.error('[Verify] erro inesperado:', err.message);
    return res.status(500).json({ valid: false, error: 'Erro interno.' });
  }
}

async function logout(req, res) {
  try {
    const raw = req.body?.token;
    if (raw && typeof raw === 'string') await licenseStore.revokeToken(raw.replace(/[^a-f0-9]/g, '').slice(0, 128));
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Logout] erro inesperado:', err.message);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

module.exports = { activateLicense, verifySession, logout };

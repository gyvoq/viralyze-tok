/**
 * controllers/adminController.js — Nex AI
 * Rotas protegidas pelo header X-Admin-Secret.
 *
 * Toda entrada vem de req.sanitized (middleware/sanitize.js). Nenhum controller lê
 * req.body / req.params diretamente: a validação fica em um único lugar.
 */

'use strict';

const licenseStore = require('../models/licenseStore');
const audit = require('../utils/audit');

const ctx = (req, extra = {}) => ({ ip: req.ip, userAgent: req.headers['user-agent'], ...extra });

// POST /api/admin/licenses
// Sanitizado: { validityMonths, customStart: Date|null, customEnd: Date|null, maxDevices, description }
async function createLicense(req, res) {
  try {
    const { validityMonths, customStart, customEnd, maxDevices, description } = req.sanitized;
    const license = await licenseStore.create(validityMonths, customStart, customEnd, maxDevices, description);
    audit.log('admin_create', ctx(req, { key: license.key, detail: `${validityMonths} mês(es), ${maxDevices} disp.` }));
    return res.status(201).json({ key: license.key, expiresAt: license.expiresAt });
  } catch (err) {
    console.error('[Admin] createLicense:', err.message);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

// GET /api/admin/licenses
async function listLicenses(req, res) {
  try {
    const licenses = await licenseStore.listAll();
    return res.json(licenses);
  } catch (err) {
    console.error('[Admin] listLicenses:', err.message);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

// DELETE /api/admin/licenses/:key  → revoke
async function revokeLicense(req, res) {
  try {
    const { key } = req.sanitized;
    const ok = await licenseStore.revoke(key);
    if (!ok) return res.status(404).json({ error: 'Licença não encontrada.' });
    audit.log('admin_revoke', ctx(req, { key }));
    return res.json({ success: true });
  } catch (err) {
    console.error('[Admin] revokeLicense:', err.message);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

// DELETE /api/admin/licenses/:key/hard → delete permanente
async function deleteLicense(req, res) {
  try {
    const { key } = req.sanitized;
    const ok = await licenseStore.remove(key);
    if (!ok) return res.status(404).json({ error: 'Licença não encontrada.' });
    audit.log('admin_delete', ctx(req, { key }));
    return res.json({ success: true });
  } catch (err) {
    console.error('[Admin] deleteLicense:', err.message);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

// PATCH /api/admin/licenses/:key/reset-device → libera a chave para outro dispositivo
async function resetDevice(req, res) {
  try {
    const { key } = req.sanitized;
    const ok = await licenseStore.resetDevice(key);
    if (!ok) return res.status(404).json({ error: 'Licença não encontrada.' });
    audit.log('admin_reset_device', ctx(req, { key }));
    return res.json({ success: true });
  } catch (err) {
    console.error('[Admin] resetDevice:', err.message);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

module.exports = { createLicense, listLicenses, revokeLicense, deleteLicense, resetDevice };

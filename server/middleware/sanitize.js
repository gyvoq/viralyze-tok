'use strict';

function sanitizeKey(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5);
}

function sanitizeToken(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^a-f0-9]/g, '').slice(0, 128);
}

function sanitizeInt(raw, min, max) {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}

// Descrição/anotação da chave (só para o admin se achar). Texto puro, até 100 chars.
function sanitizeDescription(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

// deviceId: fingerprint SHA-256 (64 hex) gerado no navegador. É só um sinal de APOIO,
// não prova de identidade (quem prova é o deviceSecret). O formato UUID legado deixou
// de ser aceito.
function sanitizeDeviceId(raw) {
  if (typeof raw !== 'string') return '';
  const v = raw.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(v) ? v : '';
}

// deviceSecret: 64 hex emitidos pelo servidor. Ausente/inválido → '' (o store decide).
function sanitizeDeviceSecret(raw) {
  if (typeof raw !== 'string') return '';
  const v = raw.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(v) ? v : '';
}

// 'YYYY-MM-DD' estrito → Date (UTC) ou null
function parseIsoDate(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(raw + 'T00:00:00.000Z');
  if (isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== raw) return null; // rejeita 2026-02-31
  return d;
}

function sanitizeActivationBody(req, res, next) {
  const key = sanitizeKey(req.body?.key);
  if (key.length !== 5) return res.status(400).json({ error: 'Formato de chave inválido. Esperado: 5 caracteres.' });
  const deviceId = sanitizeDeviceId(req.body?.deviceId);
  if (!deviceId) return res.status(400).json({ error: 'Identificador de dispositivo ausente ou inválido.' });
  const deviceSecret = sanitizeDeviceSecret(req.body?.deviceSecret);
  req.sanitized = { key, deviceId, deviceSecret };
  next();
}

function sanitizeSessionBody(req, res, next) {
  const token = sanitizeToken(req.body?.token);
  if (!token || token.length !== 128) return res.status(401).json({ valid: false, error: 'Token inválido.' });
  req.sanitized = { token };
  next();
}

// Única fonte de validação para criação de licença. O controller só lê req.sanitized.
//   • sem datas  → validityMonths (1..MAX_LICENSE_MONTHS)
//   • com datas  → customStart/customEnd (YYYY-MM-DD); os meses são calculados aqui
//                  a partir do intervalo (o valor enviado pelo cliente é ignorado)
function sanitizeCreateLicense(req, res, next) {
  const max = parseInt(process.env.MAX_LICENSE_MONTHS || '6', 10);
  const hasMax = req.body?.maxDevices != null && req.body.maxDevices !== '';
  const maxDevices = hasMax ? sanitizeInt(req.body.maxDevices, 1, 10) : 1;
  if (maxDevices === null) return res.status(400).json({ error: 'maxDevices deve ser entre 1 e 10.' });
  const description = sanitizeDescription(req.body?.description);
  const hasStart = req.body?.customStart != null && req.body.customStart !== '';
  const hasEnd   = req.body?.customEnd   != null && req.body.customEnd   !== '';

  if (hasStart || hasEnd) {
    const start = parseIsoDate(req.body.customStart);
    const end   = parseIsoDate(req.body.customEnd);
    if (!start || !end) return res.status(400).json({ error: 'Datas inválidas. Use o formato AAAA-MM-DD.' });
    if (end <= start)   return res.status(400).json({ error: 'Data de fim deve ser após a data de início.' });

    const now = Date.now();
    if (start.getTime() < Date.UTC(2020, 0, 1) || start.getTime() > now + 366 * 86400000) {
      return res.status(400).json({ error: 'Data de início fora do intervalo permitido.' });
    }
    const months = Math.max(1, Math.round((end - start) / (86400000 * 30)));
    if (months > max) return res.status(400).json({ error: `O período não pode passar de ${max} meses.` });

    req.sanitized = { validityMonths: months, customStart: start, customEnd: end, maxDevices, description };
    return next();
  }

  const months = sanitizeInt(req.body?.validityMonths, 1, max);
  if (months === null) return res.status(400).json({ error: `validityMonths deve ser entre 1 e ${max}.` });
  req.sanitized = { validityMonths: months, customStart: null, customEnd: null, maxDevices, description };
  next();
}

function sanitizeKeyParam(req, res, next) {
  const key = sanitizeKey(req.params?.key);
  if (key.length !== 5) return res.status(400).json({ error: 'Chave inválida.' });
  req.sanitized = { key };
  next();
}

module.exports = {
  sanitizeKey, sanitizeToken, sanitizeDeviceId, sanitizeDeviceSecret, parseIsoDate,
  sanitizeActivationBody, sanitizeSessionBody, sanitizeCreateLicense, sanitizeKeyParam,
};

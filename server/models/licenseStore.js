/**
 * models/licenseStore.js — Nex AI
 * Banco de dados usando MongoDB Atlas.
 * Chaves persistem para sempre mesmo o servidor reiniciando.
 *
 * Trava de dispositivo
 * ────────────────────
 *  • Na 1ª ativação o SERVIDOR gera um "segredo de dispositivo" (256 bits), guarda só
 *    o hash e entrega o segredo ao navegador uma única vez.
 *  • Nas reautenticações o navegador precisa enviar chave + segredo. O fingerprint
 *    (deviceId) é só um sinal de apoio: se o segredo confere, o fingerprint é
 *    atualizado (ex.: o navegador atualizou e mudou o User-Agent).
 *  • Licenças antigas (sem segredo) são migradas: o 1º dispositivo que reautenticar
 *    com o fingerprint certo recebe o segredo.
 *
 * Atomicidade
 * ───────────
 *  Todas as transições de estado usam findOneAndUpdate com o estado esperado no
 *  filtro, então duas requisições simultâneas nunca "ganham" as duas.
 */

'use strict';

const { generateLicenseKey, generateSessionToken, generateDeviceSecret, sha256, safeEqual } = require('../utils/crypto');
const { addMonths, isExpired } = require('../utils/dateHelper');
const { connect } = require('./db');

const COL_NAME = 'licenses';

class LicenseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // NOT_FOUND | REVOKED | EXPIRED | DEVICE_MISMATCH | BAD_DEVICE
  }
}

let colPromise = null;

function getCol() {
  if (colPromise) return colPromise;
  colPromise = (async () => {
    const db  = await connect();
    const col = db.collection(COL_NAME);
    await col.createIndex({ key: 1 }, { unique: true });
    await col.createIndex({ sessionToken: 1 });
    return col;
  })().catch((err) => {
    colPromise = null;
    throw err;
  });
  return colPromise;
}

// ── CRUD ──────────────────────────────────────────────────────────

/**
 * Cria uma nova licença.
 * @param {number} validityMonths
 * @param {Date|null} customStart - data de início personalizada (opcional)
 * @param {Date|null} customEnd   - data de fim personalizada (opcional)
 * @param {number} maxDevices     - nº de dispositivos permitidos (1..10)
 * @param {string} description    - anotação do admin (opcional)
 */
async function create(validityMonths, customStart = null, customEnd = null, maxDevices = 1, description = '') {
  const c = await getCol();
  const hasCustomDates = !!(customStart && customEnd);

  // 5 caracteres + índice único: em caso (raro) de colisão, sorteia outra chave.
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = generateLicenseKey();
    const record = {
      key,
      validityMonths,
      activated        : hasCustomDates,
      activatedAt      : hasCustomDates ? new Date(customStart) : null,
      expiresAt        : hasCustomDates ? new Date(customEnd)   : null,
      sessionToken     : null,
      deviceId         : null, // fingerprint do último dispositivo (apoio)
      deviceSecretHash : null, // hash do segredo do dispositivo (prova)
      createdAt        : new Date(),
      revokedAt        : null,
      maxDevices,                    // 1 = fluxo antigo; >1 = lista `devices`
      devices          : [],         // [{ deviceId, secretHash, sessionToken, addedAt }]
      description,
    };
    try {
      await c.insertOne(record);
      console.log(`[DB] Licença criada: ${key.slice(0, 2)}***`);
      return { key, validityMonths, createdAt: record.createdAt, expiresAt: record.expiresAt };
    } catch (err) {
      if (err && err.code === 11000) continue; // chave duplicada → tenta outra
      throw err;
    }
  }
  throw new Error('Não foi possível gerar uma chave única.');
}

async function findByKey(key) {
  const c = await getCol();
  return await c.findOne({ key });
}

function assertUsable(record) {
  if (!record || record.plan === 'free') throw new LicenseError('NOT_FOUND', 'Chave não encontrada.');
  if (record.revokedAt)                  throw new LicenseError('REVOKED', 'Chave revogada.');
}

/**
 * Ativa ou reautentica uma chave.
 * @returns {{ token, expiresAt, alreadyActivated, deviceSecret }}
 *   deviceSecret só vem preenchido quando o servidor acabou de emitir um (o navegador
 *   deve guardá-lo); nas reautenticações normais vem null.
 */
async function activate(key, deviceId, deviceSecret = '') {
  if (!deviceId) throw new LicenseError('BAD_DEVICE', 'Identificador de dispositivo ausente.');

  const c   = await getCol();
  const now = new Date();

  let record = await c.findOne({ key });
  assertUsable(record);

  // Chaves multi-dispositivo seguem outro fluxo
  if (record.maxDevices > 1) return activateMulti(c, record, key, deviceId, deviceSecret, now);

  // ── 1ª ativação (atômica) ────────────────────────────────────────
  if (!record.activated) {
    const token     = generateSessionToken();
    const secret    = generateDeviceSecret();
    const expiresAt = addMonths(now, record.validityMonths);

    const updated = await c.findOneAndUpdate(
      { key, activated: false, revokedAt: null },
      { $set: {
          activated        : true,
          activatedAt      : now,
          expiresAt,
          sessionToken     : token,
          deviceId,
          deviceSecretHash : sha256(secret),
      } },
      { returnDocument: 'after' }
    );
    if (updated) return { token, expiresAt, alreadyActivated: false, deviceSecret: secret };

    // Perdeu a corrida: outro pedido ativou primeiro. Segue como reautenticação.
    record = await c.findOne({ key });
    assertUsable(record);
  }

  // ── Reautenticação ───────────────────────────────────────────────
  if (!record.activated)         throw new LicenseError('NOT_FOUND', 'Chave não encontrada.');
  if (isExpired(record.expiresAt)) throw new LicenseError('EXPIRED', 'Chave expirada.');

  const token = generateSessionToken();
  const live  = { key, revokedAt: null, expiresAt: { $gt: now } };

  // (a) Dispositivo já tem segredo: exige o segredo.
  if (record.deviceSecretHash) {
    if (!deviceSecret || !safeEqual(sha256(deviceSecret), record.deviceSecretHash)) {
      throw new LicenseError('DEVICE_MISMATCH', 'Esta chave já está em uso em outro dispositivo.');
    }
    const updated = await c.findOneAndUpdate(
      { ...live, deviceSecretHash: record.deviceSecretHash },
      { $set: { sessionToken: token, deviceId } }, // fingerprint atualizado (apoio)
      { returnDocument: 'after' }
    );
    if (!updated) throw new LicenseError('DEVICE_MISMATCH', 'Esta chave já está em uso em outro dispositivo.');
    return { token, expiresAt: updated.expiresAt, alreadyActivated: true, deviceSecret: null };
  }

  // (b) Sem segredo ainda: licença antiga, licença com datas personalizadas ou
  //     chave liberada pelo admin. O fingerprint só vale se já havia um registrado.
  if (record.deviceId && record.deviceId !== deviceId) {
    throw new LicenseError('DEVICE_MISMATCH', 'Esta chave já está em uso em outro dispositivo.');
  }
  const secret  = generateDeviceSecret();
  const updated = await c.findOneAndUpdate(
    { ...live, deviceSecretHash: null, deviceId: record.deviceId == null ? null : record.deviceId },
    { $set: { sessionToken: token, deviceId, deviceSecretHash: sha256(secret) } },
    { returnDocument: 'after' }
  );
  if (!updated) throw new LicenseError('DEVICE_MISMATCH', 'Esta chave já está em uso em outro dispositivo.');
  return { token, expiresAt: updated.expiresAt, alreadyActivated: true, deviceSecret: secret };
}

// ── Chaves com vários dispositivos ────────────────────────────────
async function activateMulti(c, record, key, deviceId, deviceSecret, now) {
  if (!record.activated) {
    const expiresAt = addMonths(now, record.validityMonths);
    await c.updateOne({ key, activated: false, revokedAt: null },
      { $set: { activated: true, activatedAt: now, expiresAt } });
    record = await c.findOne({ key });
    assertUsable(record);
  }
  if (isExpired(record.expiresAt)) throw new LicenseError('EXPIRED', 'Chave expirada.');

  const token = generateSessionToken();
  const live  = { key, revokedAt: null, expiresAt: { $gt: now } };

  // Dispositivo já registrado → só renova o token dele
  if (deviceSecret) {
    const r = await c.findOneAndUpdate(
      { ...live, 'devices.secretHash': sha256(deviceSecret) },
      { $set: { 'devices.$.sessionToken': token, 'devices.$.deviceId': deviceId } },
      { returnDocument: 'after' }
    );
    if (r) return { token, expiresAt: r.expiresAt, alreadyActivated: true, deviceSecret: null };
  }

  // Dispositivo novo → só entra se ainda houver vaga (atômico)
  const secret = generateDeviceSecret();
  const r = await c.findOneAndUpdate(
    { ...live, $expr: { $lt: [{ $size: { $ifNull: ['$devices', []] } }, '$maxDevices'] } },
    { $push: { devices: { deviceId, secretHash: sha256(secret), sessionToken: token, addedAt: now } } },
    { returnDocument: 'after' }
  );
  if (!r) throw new LicenseError('DEVICE_MISMATCH', 'Limite de dispositivos desta chave atingido.');
  return { token, expiresAt: r.expiresAt, alreadyActivated: false, deviceSecret: secret };
}

async function findByToken(token) {
  if (!token) return null;
  const c   = await getCol();
  const rec = await c.findOne({ $or: [{ sessionToken: token }, { 'devices.sessionToken': token }] });
  if (!rec || rec.plan === 'free') return null;
  return { ...rec, sessionToken: token }; // mantém a checagem do controller funcionando
}

async function revokeToken(token) {
  if (!token) return;
  const c = await getCol();
  await c.updateOne({ sessionToken: token }, { $set: { sessionToken: null } });
  await c.updateOne({ 'devices.sessionToken': token }, { $set: { 'devices.$.sessionToken': null } });
}

// Libera a chave para ser ativada em um novo dispositivo (uso administrativo).
// O próximo dispositivo que reautenticar recebe um segredo novo.
async function resetDevice(key) {
  const c = await getCol();
  const r = await c.updateOne({ key }, { $set: { deviceId: null, deviceSecretHash: null, sessionToken: null, devices: [] } });
  return r.matchedCount > 0;
}

async function revoke(key) {
  const c = await getCol();
  const r = await c.updateOne({ key }, { $set: { revokedAt: new Date(), sessionToken: null } });
  return r.modifiedCount > 0;
}

async function remove(key) {
  const c = await getCol();
  const r = await c.deleteOne({ key });
  return r.deletedCount > 0;
}

async function listAll() {
  const c    = await getCol();
  const list = await c.find({}).sort({ createdAt: -1 }).toArray();
  return list.map(l => ({
    key             : l.key,
    validityMonths  : l.validityMonths,
    activated       : l.activated,
    activatedAt     : l.activatedAt,
    expiresAt       : l.expiresAt,
    expired         : l.expiresAt ? isExpired(new Date(l.expiresAt)) : false,
    revoked         : !!l.revokedAt,
    revokedAt       : l.revokedAt,
    createdAt       : l.createdAt,
    hasActiveSession: !!l.sessionToken || (l.devices || []).some(d => d.sessionToken),
    deviceLocked    : !!(l.deviceSecretHash || l.deviceId || (l.devices || []).length),
    maxDevices      : l.maxDevices || 1,
    devicesUsed     : (l.maxDevices || 1) > 1 ? (l.devices || []).length : (l.deviceSecretHash || l.deviceId ? 1 : 0),
    description     : l.description || '',
  }));
}

module.exports = {
  init: getCol, // conecta e cria índices (chamado no start do servidor)
  create, findByKey, activate, findByToken, revokeToken, revoke, remove, listAll, resetDevice,
  LicenseError,
};

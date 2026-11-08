'use strict';
const crypto = require('crypto');

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 símbolos → sem viés no módulo
  let key = '';
  const bytes = crypto.randomBytes(5);
  for (let i = 0; i < 5; i++) key += chars[bytes[i] % chars.length];
  return key;
}

function generateSessionToken() { return crypto.randomBytes(64).toString('hex'); }

// Segredo por dispositivo: gerado no servidor na 1ª ativação, entregue UMA vez ao
// navegador e guardado no banco apenas como hash (sha256). 256 bits de entropia.
function generateDeviceSecret() { return crypto.randomBytes(32).toString('hex'); }

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

// Comparação em tempo constante. Compara os hashes (sempre 32 bytes), então não há
// vazamento de tamanho nem o problema do padding com "\0" ("abc" == "abc\0").
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hA = crypto.createHash('sha256').update(a).digest();
  const hB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hA, hB);
}

module.exports = { generateLicenseKey, generateSessionToken, generateDeviceSecret, sha256, safeEqual };

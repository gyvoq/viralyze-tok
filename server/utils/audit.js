/**
 * utils/audit.js — Nex AI
 * Log de auditoria de eventos de segurança.
 *
 *  1. Console (JSON, uma linha por evento)  → aparece nos logs do Railway.
 *  2. MongoDB, coleção "audit_logs" (TTL de 90 dias) → consulta posterior.
 *  3. Alerta por webhook (Discord/Slack) quando falhas se repetem.
 *
 * Variáveis de ambiente (todas opcionais):
 *   ALERT_WEBHOOK_URL        URL https do webhook (Discord ou Slack "incoming webhook")
 *   ALERT_THRESHOLD          falhas por IP/evento até alertar            (padrão 5)
 *   ALERT_GLOBAL_THRESHOLD   falhas totais/evento (ataque distribuído)   (padrão 30)
 *   ALERT_WINDOW_MIN         janela de contagem, em minutos              (padrão 10)
 *   AUDIT_DB=off             desliga a gravação no MongoDB
 *
 * Nunca registra a chave inteira, tokens, segredos ou o X-Admin-Secret.
 */

'use strict';

const ALERT_EVENTS = new Set([
  'admin_auth_fail',
  'admin_rate_limited',
  'activate_fail',
  'activation_rate_limited',
]);

const THRESHOLD        = parseInt(process.env.ALERT_THRESHOLD        || '5', 10);
const GLOBAL_THRESHOLD = parseInt(process.env.ALERT_GLOBAL_THRESHOLD || '30', 10);
const WINDOW_MS        = parseInt(process.env.ALERT_WINDOW_MIN       || '10', 10) * 60 * 1000;
const TTL_SECONDS      = 90 * 24 * 60 * 60;

const counters = new Map(); // `${event}|${ip}` → { count, start, alerted }
let ttlIndexReady = false;

function maskKey(key) {
  if (typeof key !== 'string' || !key) return undefined;
  return key.slice(0, 2) + '*'.repeat(Math.max(0, key.length - 2));
}

// Só campos conhecidos, com tamanho limitado (evita log injection e vazamento).
function clean(data = {}) {
  const out = {};
  const str = (v, n) => String(v).replace(/[\r\n\t]/g, ' ').slice(0, n);
  if (data.ip)        out.ip         = str(data.ip, 64);
  if (data.key)       out.keyPartial = maskKey(String(data.key));
  if (data.reason)    out.reason     = str(data.reason, 60);
  if (data.path)      out.path       = str(data.path, 120);
  if (data.method)    out.method     = str(data.method, 10);
  if (data.userAgent) out.userAgent  = str(data.userAgent, 120);
  if (data.deviceId)  out.device     = str(data.deviceId, 8); // só o prefixo
  if (data.detail)    out.detail     = str(data.detail, 200);
  return out;
}

function persist(entry) {
  if (process.env.AUDIT_DB === 'off' || !(process.env.MONGO_URI || '').trim()) return;
  (async () => {
    const { connect } = require('../models/db');
    const col = (await connect()).collection('audit_logs');
    if (!ttlIndexReady) {
      await col.createIndex({ ts: 1 }, { expireAfterSeconds: TTL_SECONDS });
      ttlIndexReady = true;
    }
    await col.insertOne({ ...entry, ts: new Date() });
  })().catch(() => { /* auditoria nunca derruba a requisição */ });
}

function bump(mapKey, now) {
  let c = counters.get(mapKey);
  if (!c || now - c.start > WINDOW_MS) {
    c = { count: 0, start: now, alerted: false };
    counters.set(mapKey, c);
  }
  c.count += 1;
  return c;
}

function sendWebhook(text) {
  const url = (process.env.ALERT_WEBHOOK_URL || '').trim();
  if (!/^https:\/\//i.test(url)) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  // "content" = Discord, "text" = Slack
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text, text }),
    signal: ctrl.signal,
  }).catch(() => {}).finally(() => clearTimeout(t));
}

function maybeAlert(entry) {
  if (!ALERT_EVENTS.has(entry.event)) return;
  const now = Date.now();

  if (counters.size > 5000) { // limpeza simples de entradas vencidas
    for (const [k, v] of counters) if (now - v.start > WINDOW_MS) counters.delete(k);
  }

  const perIp  = bump(`${entry.event}|${entry.ip || '?'}`, now);
  const global = bump(`${entry.event}|*`, now);
  const mins   = Math.round(WINDOW_MS / 60000);

  if (!perIp.alerted && perIp.count >= THRESHOLD) {
    perIp.alerted = true;
    sendWebhook(`⚠️ Nex AI: ${perIp.count}x "${entry.event}" do IP ${entry.ip || '?'} em ${mins} min` +
      (entry.keyPartial ? ` (última chave: ${entry.keyPartial})` : ''));
  }
  if (!global.alerted && global.count >= GLOBAL_THRESHOLD) {
    global.alerted = true;
    sendWebhook(`🚨 Nex AI: ${global.count}x "${entry.event}" no total em ${mins} min (possível ataque distribuído)`);
  }
}

function log(event, data = {}) {
  const entry = { event, ...clean(data) };
  const line = JSON.stringify({ audit: true, ts: new Date().toISOString(), ...entry });
  (/fail|limited|mismatch|revoked/.test(event) ? console.warn : console.log)(line);
  persist(entry);
  maybeAlert(entry);
}

module.exports = { log, maskKey };

/**
 * controllers/coverController.js — Nex AI
 * Proxy de capas dos "Vídeos Virais".
 * O navegador não consegue buscar o oEmbed do TikTok (CORS + links curtos vt.tiktok.com),
 * então o servidor resolve o link, pega o thumbnail e devolve os bytes da imagem.
 * Há cache em memória (as URLs de thumbnail do TikTok expiram).
 *
 * Proteção contra SSRF
 * ────────────────────
 *  • Nenhuma requisição segue redirect automaticamente (redirect: 'manual').
 *    Cada salto é revalidado contra a allowlist do tipo de recurso (página, oEmbed
 *    ou CDN de imagem) ANTES de ser requisitado — um 302 para http://169.254.x.x,
 *    localhost ou qualquer outro host é bloqueado.
 *  • Só image/jpeg, image/png e image/webp; o tipo é conferido pelos bytes
 *    (assinatura do arquivo), não só pelo header Content-Type. SVG não passa.
 *  • Tamanho limitado durante o download (não depois).
 */

'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TTL_OK_MS     = 6 * 60 * 60 * 1000; // 6h
const TTL_FAIL_MS   = 60 * 1000;          // falha: tenta de novo em 1 min
const MAX_ENTRIES   = 100;
const MAX_IMG_BYTES = 3 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS    = 8000;

const cache = new Map();    // url -> { buf, type, exp } | { fail: true, exp }
const inflight = new Map(); // url -> Promise

// ── Allowlists ────────────────────────────────────────────────────

// Páginas do TikTok (evita SSRF)
function isTikTokUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /(^|\.)tiktok\.com$/i.test(x.hostname);
  } catch { return false; }
}

// Endpoints de oEmbed: TikTok ou noembed.com
function isOembedUrl(u) {
  try {
    const x = new URL(u);
    return isTikTokUrl(u) || (x.protocol === 'https:' && x.hostname.toLowerCase() === 'noembed.com');
  } catch { return false; }
}

// Hosts de CDN permitidos para a imagem
function isAllowedImg(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /(^|\.)(tiktokcdn[a-z-]*\.com|tiktokcdn\.com|tiktokv\.com|byteimg\.com|ibytedtos\.com|muscdn\.com)$/i.test(x.hostname);
  } catch { return false; }
}

// ── Fetch guardado ────────────────────────────────────────────────

async function readLimited(res, maxBytes) {
  const declared = parseInt(res.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) { try { await res.body.cancel(); } catch {} return null; }
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { try { await reader.cancel(); } catch {} return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * GET com redirects manuais. Cada URL (inicial e de cada salto) precisa passar em `allow`.
 * O timeout cobre a requisição inteira, inclusive a leitura do corpo.
 * @param {string} url
 * @param {{ allow:(u:string)=>boolean, headers?:object, as?:'none'|'json'|'buffer', maxBytes?:number }} o
 * @returns {Promise<{ ok:boolean, status:number, url:string, type:string, data:any }|null>} null se bloqueado/erro
 */
async function guardedGet(url, o) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!o.allow(current)) return null;                 // bloqueia ANTES de requisitar
      const res = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', ...(o.headers || {}) },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        try { await res.body?.cancel(); } catch {}
        if (!loc) return null;
        try { current = new URL(loc, current).toString(); } catch { return null; }
        continue;                                          // revalida no próximo ciclo
      }

      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      let data = null;
      if (res.ok && o.as === 'buffer') {
        data = await readLimited(res, o.maxBytes || MAX_IMG_BYTES);
      } else if (res.ok && o.as === 'json') {
        const buf = await readLimited(res, o.maxBytes || MAX_JSON_BYTES);
        try { data = buf ? JSON.parse(buf.toString('utf8')) : null; } catch { data = null; }
      } else {
        try { await res.body?.cancel(); } catch {}
      }
      return { ok: res.ok, status: res.status, url: current, type, data };
    }
    return null; // redirects demais
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Identifica o formato pelos primeiros bytes (não confia no Content-Type do servidor).
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// ── Lógica ────────────────────────────────────────────────────────

// Segue o redirect do link curto até a URL canônica do vídeo
async function resolveUrl(url) {
  const r = await guardedGet(url, { allow: isTikTokUrl, as: 'none' });
  if (r && isTikTokUrl(r.url)) return r.url.split('?')[0];
  return url;
}

async function getThumbnailUrl(url) {
  const resolved = await resolveUrl(url);
  const candidates = [
    'https://www.tiktok.com/oembed?url=' + encodeURIComponent(resolved),
    'https://www.tiktok.com/oembed?url=' + encodeURIComponent(url),
    'https://noembed.com/embed?url=' + encodeURIComponent(resolved),
  ];
  for (const c of candidates) {
    const r = await guardedGet(c, { allow: isOembedUrl, as: 'json' });
    const d = r && r.ok ? r.data : null;
    if (d && typeof d.thumbnail_url === 'string' && isAllowedImg(d.thumbnail_url)) return d.thumbnail_url;
  }
  return '';
}

async function loadCover(url) {
  const thumb = await getThumbnailUrl(url);
  if (!thumb) return null;
  const r = await guardedGet(thumb, {
    allow: isAllowedImg,
    as: 'buffer',
    maxBytes: MAX_IMG_BYTES,
    headers: { Referer: 'https://www.tiktok.com/' },
  });
  if (!r || !r.ok || !r.data || !r.data.length) return null;
  // Allowlist estrita: o header E a assinatura dos bytes precisam ser jpeg/png/webp.
  // (image/svg+xml, image/gif, html etc. são recusados.)
  if (!/^image\/(jpeg|png|webp)$/.test(r.type)) return null;
  const type = sniffImageType(r.data);
  if (!type) return null;
  return { buf: r.data, type };
}

async function viralCover(req, res) {
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!url || url.length > 200 || !isTikTokUrl(url)) {
    return res.status(400).json({ error: 'URL inválida.' });
  }

  const hit = cache.get(url);
  if (hit && hit.exp > Date.now()) {
    if (hit.fail) return res.status(404).json({ error: 'Capa indisponível.' });
    return send(res, hit);
  }

  let job = inflight.get(url);
  if (!job) {
    job = loadCover(url).catch(() => null).finally(() => inflight.delete(url));
    inflight.set(url, job);
  }
  const out = await job;

  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  if (!out) {
    cache.set(url, { fail: true, exp: Date.now() + TTL_FAIL_MS });
    return res.status(404).json({ error: 'Capa indisponível.' });
  }
  const entry = { ...out, exp: Date.now() + TTL_OK_MS };
  cache.set(url, entry);
  return send(res, entry);
}

function send(res, e) {
  res.set('Content-Type', e.type);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'public, max-age=3600');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.status(200).send(e.buf);
}

module.exports = { viralCover, _internals: { isTikTokUrl, isOembedUrl, isAllowedImg, guardedGet, sniffImageType } };

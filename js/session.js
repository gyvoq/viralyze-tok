'use strict';

const Session = (() => {

  const API_BASE    = '';
  const TOKEN_KEY   = 'nex_session_token';
  const EXPIRY_KEY  = 'nex_session_expiry';
  const TERMS_KEY   = 'nex_terms_accepted';
  const TERMS_VERSION = '1.0';
  const DEVICE_SINCE_KEY = 'nex_device_since';
  const DEVICE_SECRET_KEY = 'nex_device_secret';

  async function getDeviceId() {
    try {
      const gl = document.createElement('canvas').getContext('webgl') || document.createElement('canvas').getContext('experimental-webgl');
      const debugInfo = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';

      const canvas = document.createElement('canvas');
      canvas.width = 220; canvas.height = 30;
      const ctx = canvas.getContext('2d');
      let canvasData = '';
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('nexai-device-fp', 2, 2);
        canvasData = canvas.toDataURL();
      }

      const signals = [
        navigator.userAgent || '',
        navigator.language || '',
        String(navigator.hardwareConcurrency || ''),
        String(screen.width) + 'x' + String(screen.height) + 'x' + String(screen.colorDepth),
        Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        gpu || '',
        canvasData,
      ].join('|');

      const enc = new TextEncoder().encode(signals);
      const hash = await crypto.subtle.digest('SHA-256', enc);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {

      return _hashFallback(navigator.userAgent + screen.width + screen.height + (navigator.language || ''));
    }
  }

  function _hashFallback(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
    return 'f' + Math.abs(h).toString(16).padStart(63, '0');
  }

  function getDeviceInfo() {
    const ua = navigator.userAgent || '';

    let browser = 'Navegador';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
    else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
    else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
    else if (/Chrome\/|CriOS/.test(ua)) browser = 'Chrome';
    else if (/Safari\//.test(ua)) browser = 'Safari';

    let os = 'Sistema desconhecido';
    if (/Windows/.test(ua)) os = 'Windows';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
    else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';

    const isMobile = /Mobi|Android|iPhone|iPad|iPod/.test(ua);

    return {
      browser,
      os,
      kind: isMobile ? 'Celular / tablet' : 'Computador',
      screen: `${screen.width}×${screen.height}`,
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone || '—'),
    };
  }

  function shortDeviceId(id) {
    return (id || '').slice(0, 12).toUpperCase().match(/.{1,4}/g)?.join('-') || '—';
  }

  function rememberDeviceSince() {
    try { localStorage.setItem(DEVICE_SINCE_KEY, new Date().toISOString()); } catch {  }
  }

  function getDeviceSince() {
    try { return localStorage.getItem(DEVICE_SINCE_KEY); } catch { return null; }
  }

  async function renderDeviceCard() {
    const card = document.getElementById('device-card');
    if (!card) return;

    const info = getDeviceInfo();
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    set('device-name', `${info.browser} no ${info.os}`);
    set('device-kind', info.kind);
    set('device-screen', info.screen);

    const since = getDeviceSince();
    const sinceRow = document.getElementById('device-since-row');
    if (sinceRow) sinceRow.hidden = !since;
    if (since) set('device-since', fmtDate(since));

    const fullId = await getDeviceId();
    set('device-id', shortDeviceId(fullId));

    const copyBtn = document.getElementById('device-copy-btn');
    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = '1';
      copyBtn.addEventListener('click', async () => {
        const label = copyBtn.querySelector('span');
        try {
          await navigator.clipboard.writeText(fullId);
          if (label) label.textContent = 'Copiado!';
        } catch {
          if (label) label.textContent = 'Não foi possível copiar';
        }
        setTimeout(() => { if (label) label.textContent = 'Copiar ID'; }, 1800);
      });
    }
  }

  function getDeviceSecret() {
    try {
      const v = localStorage.getItem(DEVICE_SECRET_KEY);
      return v && /^[0-9a-f]{64}$/.test(v) ? v : '';
    } catch { return ''; }
  }

  function saveDeviceSecret(secret) {
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) return;
    try { localStorage.setItem(DEVICE_SECRET_KEY, secret); } catch {  }
  }

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  }

  function emitLicense(expiresAt) {
    if (!expiresAt) return;
    try { window.dispatchEvent(new CustomEvent('nex:license', { detail: { expiresAt } })); } catch {  }
  }

  function saveSession(token, expiresAt) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(EXPIRY_KEY, expiresAt);
    } catch (e) {
      console.warn('[Session] Erro ao salvar sessão:', e);
    }
    emitLicense(expiresAt);
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(EXPIRY_KEY);
    } catch {  }
  }

  async function getExtractQuota() {
    const token = getToken();
    if (!token) return null;
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    try {
      const res = await fetch(`${API_BASE}/api/extract-quota`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ token }),
        signal : ctrl.signal,
      });
      if (!res.ok) return null;
      const d = await res.json().catch(() => null);
      if (!d || typeof d.limit !== 'number' || typeof d.remaining !== 'number') return null;
      return { limit: d.limit, remaining: d.remaining, resetSec: typeof d.resetSec === 'number' ? d.resetSec : 0 };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  const READY_CLASS = 'nex-ready';

  function releaseGate() {
    document.documentElement.classList.add(READY_CLASS);
    renderDeviceCard();
  }

  function lockGate() {
    document.documentElement.classList.remove(READY_CLASS);
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return '—'; }
  }

  async function verifyWithServer(token) {

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`${API_BASE}/api/verify-session`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ token }),
        signal : ctrl.signal,
      });
      return await res.json();
    } catch {

      return { valid: false, reason: 'offline' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function activate(code) {
    const deviceId = await getDeviceId();
    const res = await fetch(`${API_BASE}/api/activate`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ key: code, deviceId, deviceSecret: getDeviceSecret() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
    if (data.deviceSecret) saveDeviceSecret(data.deviceSecret);
    return data;
  }

  async function logout() {
    const token = getToken();
    try {
      await fetch(`${API_BASE}/api/logout`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ token }),
      });
    } catch {  }
    clearSession();
    showActivationOverlay();
  }

  async function requestExtract() {
    const token = getToken();
    if (!token) return { ok: false, message: 'Sessão expirada. Ative sua licença novamente.' };
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`${API_BASE}/api/extract-motion`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ token }),
        signal : ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, remaining: data.remaining, limit: data.limit, resetSec: data.resetSec };
      if (res.status === 429) return { ok: false, rateLimited: true, retryAfterSec: data.retryAfterSec || 60, message: data.error };
      if (res.status === 401 || res.status === 403) {
        clearSession();
        showActivationOverlay();
        return { ok: false, message: data.error || 'Sessão inválida.' };
      }
      return { ok: false, message: data.error || 'Erro ao processar. Tente novamente.' };
    } catch {
      return { ok: false, message: 'Sem conexão com o servidor. Tente novamente.' };
    } finally {
      clearTimeout(timer);
    }
  }

  function hasAcceptedTerms() {
    try { return localStorage.getItem(TERMS_KEY) === TERMS_VERSION; } catch { return false; }
  }

  function acceptTerms() {
    try { localStorage.setItem(TERMS_KEY, TERMS_VERSION); } catch {  }
  }

  function getBrandName() {
    const el = document.querySelector('.logo:not(.act-logo) .logo-text');
    return (el && el.textContent.trim()) || 'Nex AI';
  }

  function buildBrandLogo() {
    const logo = document.createElement('div');
    logo.className = 'logo act-logo';

    const headerIcon = document.querySelector('.logo:not(.act-logo) .logo-icon');
    const iconWrap = document.createElement('div');
    iconWrap.className = 'logo-icon';
    iconWrap.setAttribute('aria-hidden', 'true');
    iconWrap.innerHTML = headerIcon ? headerIcon.innerHTML : `
        <svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:white;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>`;

    const logoText = document.createElement('span');
    logoText.className = 'logo-text';
    logoText.textContent = getBrandName();

    logo.append(iconWrap, logoText);
    return logo;
  }

  function buildTermsCheck() {
    const returnPage = (location.pathname.split('/').pop() || 'index.html');

    const row = document.createElement('label');
    row.className = 'terms-check-row';
    row.setAttribute('for', 'terms-checkbox');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'terms-checkbox';
    checkbox.className = 'terms-checkbox';

    const text = document.createElement('span');

    const termsLink = document.createElement('a');
    termsLink.className = 'terms-link';
    termsLink.href = `landing/terms.html?return=${encodeURIComponent(returnPage)}`;
    termsLink.target = '_blank';
    termsLink.rel = 'noopener noreferrer';
    termsLink.textContent = 'Termos de Uso';

    const privacyLink = document.createElement('a');
    privacyLink.className = 'terms-link';
    privacyLink.href = `landing/privacy.html?return=${encodeURIComponent(returnPage)}`;
    privacyLink.target = '_blank';
    privacyLink.rel = 'noopener noreferrer';
    privacyLink.textContent = 'Política de Privacidade';

    [termsLink, privacyLink].forEach(a => a.addEventListener('click', e => e.stopPropagation()));

    text.append('Li e concordo com os ', termsLink, ' e a ', privacyLink);
    row.append(checkbox, text);
    return { row, checkbox };
  }

  function showTermsOverlay(onAccept) {
    let ov = document.getElementById('terms-overlay');
    if (ov) { ov.style.display = ''; return; }

    ov = document.createElement('div');
    ov.id = 'terms-overlay';

    const card = document.createElement('div');
    card.className = 'act-card terms-card';

    const logo = buildBrandLogo();

    const title = document.createElement('div');
    title.className = 'act-title';
    title.textContent = 'Antes de continuar';

    const sub = document.createElement('div');
    sub.className = 'act-sub';
    sub.textContent = 'Para continuar usando a plataforma, confirme que você concorda com os nossos termos.';

    const { row: checkRow, checkbox } = buildTermsCheck();

    const btn = document.createElement('button');
    btn.className = 'act-btn';
    btn.id = 'terms-continue-btn';
    btn.type = 'button';
    btn.textContent = 'Concordar e continuar';
    btn.disabled = true;

    checkbox.addEventListener('change', () => {
      btn.disabled = !checkbox.checked;
    });

    btn.addEventListener('click', () => {
      if (!checkbox.checked) return;
      acceptTerms();

      showLoadingOverlay();
      ov.classList.add('hiding');
      setTimeout(() => {
        ov.remove();
      }, 500);
      const minDelay = new Promise(resolve => setTimeout(resolve, 500));
      Promise.all([Promise.resolve(onAccept()), minDelay]).then(() => {
        hideLoadingOverlay();
      });
    });

    card.append(logo, title, sub, checkRow, btn);
    ov.appendChild(card);
    document.body.prepend(ov);
  }

  function showLoadingOverlay() {
    let ov = document.getElementById('loading-overlay');
    if (ov) { ov.style.display = ''; return ov; }

    ov = document.createElement('div');
    ov.id = 'loading-overlay';

    const card = document.createElement('div');
    card.className = 'loading-card';

    const logo = buildBrandLogo();

    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-live', 'polite');
    spinner.setAttribute('aria-label', 'Carregando');

    const text = document.createElement('div');
    text.className = 'loading-text';
    text.textContent = 'Preparando o seu acesso...';

    card.append(logo, spinner, text);
    ov.appendChild(card);
    document.body.prepend(ov);
    return ov;
  }

  function hideLoadingOverlay() {
    const ov = document.getElementById('loading-overlay');
    if (!ov) return;
    ov.classList.add('hiding');
    setTimeout(() => ov.remove(), 450);
  }

  function showActivationOverlay() {

    lockGate();
    let ov = document.getElementById('activation-overlay');
    if (!ov) {
      ov = buildOverlay();
      document.body.prepend(ov);
    }
    ov.style.display = '';
    const d0 = document.getElementById('d0');
    if (d0) d0.focus();
  }

  function buildOverlay() {
    const ov = document.createElement('div');
    ov.id = 'activation-overlay';

    const card = document.createElement('div');
    card.className = 'act-card';

    const logo = buildBrandLogo();

    const title = document.createElement('div');
    title.className = 'act-title';
    title.id = 'act-title';
    title.textContent = 'Ativar Licença';

    const sub = document.createElement('div');
    sub.className = 'act-sub';
    sub.id = 'act-sub';
    sub.textContent = 'Insira seu código de ativação de 5 dígitos para acessar o painel.';

    const digits = [];
    const inputsWrap = document.createElement('div');
    inputsWrap.className = 'act-inputs';
    inputsWrap.id = 'act-inputs';
    inputsWrap.setAttribute('role', 'group');
    inputsWrap.setAttribute('aria-label', 'Código de ativação');
    for (let i = 0; i < 5; i++) {
      const inp = document.createElement('input');
      inp.className = 'act-digit';
      inp.id = `d${i}`;
      inp.maxLength = 1;
      inp.autocomplete = i === 0 ? 'one-time-code' : 'off';
      inp.spellcheck = false;
      inp.inputMode = 'text';
      inp.setAttribute('aria-label', `Dígito ${i + 1} de 5`);
      inputsWrap.appendChild(inp);
      digits.push(inp);
    }

    const field = document.createElement('div');
    field.className = 'act-field';
    field.id = 'act-field';
    field.appendChild(inputsWrap);

    const msgEl = document.createElement('div');
    msgEl.className = 'act-msg';
    msgEl.id = 'act-msg';
    msgEl.setAttribute('role', 'status');
    msgEl.setAttribute('aria-live', 'polite');

    const btn = document.createElement('button');
    btn.className = 'act-btn';
    btn.id = 'act-submit-btn';
    btn.type = 'button';
    btn.disabled = true;
    btn.textContent = 'Continuar';
    btn.addEventListener('click', () => window.submitActivation());

    const actions = document.createElement('div');
    actions.className = 'act-actions';
    actions.id = 'act-actions';
    actions.append(btn);

    const { row: termsRow, checkbox: termsCheckbox } = buildTermsCheck();

    card.append(logo, title, sub, field, termsRow, msgEl, actions);
    ov.appendChild(card);

    _bindDigitEvents(digits, termsCheckbox);

    return ov;
  }

  function _bindDigitEvents(digits, termsCheckbox) {

    let attempts = 0;
    const MAX_CLIENT_ATTEMPTS = 5;
    let blockedUntil = 0;

    termsCheckbox.addEventListener('change', () => { clearMsg(); paintTrack(); });

    digits.forEach((inp, i) => {
      inp.addEventListener('input', function () {

        const v = Sanitize.sanitizeCode(this.value);
        this.value = v ? v[v.length - 1] : '';
        this.classList.toggle('filled', !!this.value);
        if (this.value && i < 4) digits[i + 1].focus();
        clearMsg();
        paintTrack();
      });

      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !this.value && i > 0) {
          digits[i - 1].focus();
          digits[i - 1].value = '';
          digits[i - 1].classList.remove('filled');
        }
        if (e.key === 'Enter') window.submitActivation();
      });

      inp.addEventListener('paste', function (e) {
        e.preventDefault();
        const raw = (e.clipboardData || window.clipboardData).getData('text');

        const clean = Sanitize.sanitizeCode(raw).slice(0, 5);
        clean.split('').forEach((ch, j) => {
          if (digits[j]) {
            digits[j].value = ch;
            digits[j].classList.add('filled');
          }
        });
        digits[Math.min(clean.length, 4)].focus();
        clearMsg();
        paintTrack();
      });
    });

    window.submitActivation = async function () {
      const now = Date.now();

      if (now < blockedUntil) {
        const secsLeft = Math.ceil((blockedUntil - now) / 1000);
        showError(`Aguarde ${secsLeft}s antes de tentar novamente.`);
        return;
      }

      const code = digits.map(d => Sanitize.sanitizeCode(d.value)).join('');

      if (code.length < 5) {
        showError('Preencha todos os 5 dígitos.');
        digits.forEach(d => { if (!d.value) d.classList.add('error'); });
        return;
      }

      if (!termsCheckbox.checked) {
        showError('Aceite os Termos de Uso e a Política de Privacidade para continuar.');
        return;
      }

      const btnEl = document.getElementById('act-submit-btn');
      if (btnEl) { btnEl.disabled = true; btnEl.classList.add('busy'); btnEl.textContent = 'Verificando...'; }
      digits.forEach(d => d.blur());
      setMsg('Conferindo a licença…', false);

      try {
        const result = await activate(code);
        saveSession(result.token, result.expiresAt);
        acceptTerms();
        rememberDeviceSince();
        if (btnEl) btnEl.classList.remove('busy');

        accept();
        attempts = 0;

        setTimeout(() => {

          releaseGate();
          const ov = document.getElementById('activation-overlay');
          if (ov) ov.remove();
        }, 2000);

      } catch (err) {
        attempts++;
        if (btnEl) btnEl.classList.remove('busy');

        const isDeviceLock = /outro dispositivo/i.test(err.message || '');
        const isRevoked = /revogad/i.test(err.message || '');
        let text;

        if (isRevoked) {
          attempts--;
          text = 'Chave revogada. Você pediu reembolso, lembra? Some daqui.';

          digits.forEach(d => d.disabled = true);
          if (btnEl) btnEl.disabled = true;
          setTimeout(() => {
            digits.forEach(d => d.disabled = false);
            if (btnEl) btnEl.disabled = false;
            clearMsg();
          }, 15000);
        } else if (isDeviceLock) {
          attempts--;
          text = err.message;
        } else if (attempts >= MAX_CLIENT_ATTEMPTS) {
          blockedUntil = Date.now() + 60_000;
          text = 'Muitas tentativas. Aguarde 60 segundos.';
          attempts = 0;
        } else {
          text = 'Código inválido. Verifique e tente novamente.';
        }

        deny(text);
      }
    };

    function setMsg(text, isErr) {
      const el = document.getElementById('act-msg');
      if (!el) return;
      el.className = 'act-msg' + (isErr ? ' err' : '');
      el.textContent = '';
      if (text) {
        const s = document.createElement('span');
        s.textContent = text;
        el.appendChild(s);
      }
    }

    function clearMsg() {
      setMsg('', false);
    }

    function showError(msg) {
      setMsg(msg, true);
    }

    function paintTrack() {
      const n = digits.filter(d => d.value).length;
      const btnEl = document.getElementById('act-submit-btn');
      if (btnEl) btnEl.disabled = n < 5 || !termsCheckbox.checked;
    }

    function accept() {
      setMsg('', false);
      const card = document.querySelector('.act-card');
      if (card) card.classList.add('done');
      const t = document.getElementById('act-title');
      const s = document.getElementById('act-sub');
      if (t) t.textContent = 'Licença ativada';
      if (s) s.textContent = 'Tudo pronto. Seu acesso foi liberado.';
    }

    function deny(text) {
      const card = document.querySelector('.act-card');
      const btnEl = document.getElementById('act-submit-btn');

      if (btnEl) btnEl.textContent = 'Continuar';
      if (card) card.classList.add('denied');
      setMsg(text, true);

      digits.forEach(d => { d.value = ''; d.classList.remove('filled'); });
      if (card) card.classList.remove('denied');
      if (btnEl) btnEl.disabled = true;
      digits[0].focus();
    }
  }

  async function init() {

    const watchdog = setTimeout(() => {
      const gated = !document.documentElement.classList.contains(READY_CLASS);
      const hasOverlay = document.getElementById('activation-overlay') ||
                         document.getElementById('terms-overlay');
      if (gated && !hasOverlay) showActivationOverlay();
    }, 15_000);

    try {

      await proceedAfterTerms();
    } finally {
      clearTimeout(watchdog);
    }
  }

  async function proceedAfterTerms() {
    try {
      const token = getToken();

      if (!token) {

        showActivationOverlay();
        return;
      }

      const result = await verifyWithServer(token);

      if (!result.valid) {
        clearSession();
        showActivationOverlay();
        return;
      }

      const expiryEl = document.getElementById('expiry-display');
      if (expiryEl) expiryEl.textContent = fmtDate(result.expiresAt);
      try { sessionStorage.setItem(EXPIRY_KEY, result.expiresAt); } catch {  }
      emitLicense(result.expiresAt);

      if (!hasAcceptedTerms()) {
        showTermsOverlay(async () => releaseGate());
        return;
      }

      releaseGate();

    } catch (err) {

      console.error('[Session] Erro ao verificar a sessão:', err);
      showActivationOverlay();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    init();
  });

  return { API_BASE, getToken, saveSession, clearSession, logout, requestExtract, getExtractQuota, hasAcceptedTerms, getDeviceId, getDeviceInfo };
})();

window.NexSession = Session;

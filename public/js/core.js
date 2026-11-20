// Umumiy yordamchilar: xavfsiz HTML shabloni, API, holat, router, bildirishnoma.
export const raw = (s) => ({ __raw: String(s) });
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const toStr = (v) => (v == null || v === false ? '' : Array.isArray(v) ? v.map(toStr).join('') : v.__raw !== undefined ? v.__raw : esc(v));
export function html(strings, ...vals) { let o = ''; strings.forEach((s, i) => { o += s; if (i < vals.length) o += toStr(vals[i]); }); return raw(o); }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const state = { user: null, csrf: null, config: null, usage: null };

export class ApiError extends Error {
  constructor(status, data) { super(data?.message || 'Xatolik'); this.status = status; this.code = data?.error; this.data = data || {}; }
}
async function request(method, path, body, rawBody, contentType) {
  const h = {};
  if (state.csrf && method !== 'GET') h['x-csrf-token'] = state.csrf;
  let payload;
  if (rawBody) { payload = rawBody; if (contentType) h['content-type'] = contentType; }
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, { method, headers: h, body: payload, credentials: 'same-origin' }); }
  catch { throw new ApiError(0, { error: 'network', message: "Serverga ulanib bo'lmadi. Internetni tekshirib, qayta urinib ko'ring." }); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const api = {
  get: (p) => request('GET', p), post: (p, b) => request('POST', p, b ?? {}), put: (p, b) => request('PUT', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b ?? {}), del: (p) => request('DELETE', p),
  raw: (p, blob, type) => request('POST', p, undefined, blob, type),
};
export async function refreshMe() {
  const r = await api.get('/api/me');
  state.user = r.user; state.csrf = r.csrf; state.usage = r.usage || null;
  return r;
}
export async function loadConfig() { state.config = await api.get('/api/config'); return state.config; }

export function toast(msg, kind = '') {
  const box = $('#toasts'); const d = document.createElement('div');
  d.className = 'toast ' + kind; d.textContent = msg; box.appendChild(d);
  setTimeout(() => d.remove(), 5200);
}
export function errMsg(e) { return e instanceof ApiError ? e.message : "Kutilmagan xatolik yuz berdi."; }

export function navigate(path) { location.hash = '#' + path; }
export function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export const fmtDate = (s) => { if (!s) return ''; const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('uz-UZ', { year: 'numeric', month: '2-digit', day: '2-digit' }); };
export const fmtMoney = (n) => (n == null ? '' : new Intl.NumberFormat('uz-UZ').format(n) + " so'm");
export const stars = (n) => '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0));
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function confirmDialog(message, okLabel = 'Tasdiqlash') {
  return new Promise((resolve) => {
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<div class="card modal" role="dialog" aria-modal="true" aria-label="Tasdiqlash"><p></p><div class="row"><button class="btn primary" data-ok>${esc(okLabel)}</button><button class="btn" data-no>Bekor qilish</button></div></div>`;
    back.querySelector('p').textContent = message;
    const done = (v) => { back.remove(); resolve(v); };
    back.addEventListener('click', (e) => { if (e.target === back || e.target.matches('[data-no]')) done(false); if (e.target.matches('[data-ok]')) done(true); });
    document.body.appendChild(back); back.querySelector('[data-ok]').focus();
  });
}
export function icon(name) {
  const p = {
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/>', upload: '<path d="M12 16V4m0 0L7 9m5-5l5 5M4 20h16"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    barcode: '<path d="M4 5v14M8 5v14M12 5v14M15 5v14M19 5v14"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    mother: '<circle cx="12" cy="6" r="3"/><path d="M8 21v-6a4 4 0 018 0v6M9 13c-2 0-3-2-2-4"/>', drop: '<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>',
    drop2: '<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/><path d="M9 15a3 3 0 003 3"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>', leaf: '<path d="M5 19c0-9 5-14 14-14 0 9-5 14-14 14zM5 19c3-5 6-8 10-10"/>',
  }[name] || '';
  return raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`);
}
export const logoSvg = raw('<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 42c-1-10-7-15-14-17 1-9 8-15 17-15 7 0 12 4 12 12 0 10-6 18-15 20z" stroke="#EBCB98" stroke-width="2.2" stroke-linejoin="round"/><path d="M24 42c0-8 3-15 9-21" stroke="#69C69B" stroke-width="2.2" stroke-linecap="round"/><path d="M15 27c4 0 7 2 9 6" stroke="#EBCB98" stroke-width="1.6" stroke-linecap="round" opacity=".7"/></svg>');

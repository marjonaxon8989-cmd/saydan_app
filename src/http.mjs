import fs from 'node:fs';
import path from 'node:path';
import { cfg, ROOT } from './config.mjs';
import { getSession } from './auth.mjs';
import { planOf, hasFeature } from './entitlements.mjs';
import { can, getRole } from './roles.mjs';
import { hit } from './ratelimit.mjs';
import { sysEvent } from './audit.mjs';

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) { super(message || code); this.status = status; this.code = code; this.extra = extra; }
}
export const bad = (code, message, extra) => new HttpError(400, code, message, extra);

export function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function setCookie(res, name, value, { maxAge, httpOnly = true, sameSite = 'Lax' } = {}) {
  const secure = cfg().publicUrl.startsWith('https://');
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [].concat(prev || [], parts.join('; ')));
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

export async function readBody(req, maxBytes) {
  const declared = parseInt(req.headers['content-length'] || '0', 10);
  if (declared > maxBytes) throw new HttpError(413, 'too_large', 'Fayl yoki so\'rov juda katta.');
  const chunks = []; let size = 0;
  for await (const ch of req) {
    size += ch.length;
    if (size > maxBytes) throw new HttpError(413, 'too_large', 'Fayl yoki so\'rov juda katta.');
    chunks.push(ch);
  }
  return Buffer.concat(chunks);
}

const routes = [];
export function route(method, pattern, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, pattern, re, keys, opts, handler });
}

export function clientIp(req) {
  // Reverse proxy ortida bo'lsa TRUST_PROXY=1 qo'ying; aks holda x-forwarded-for ishonchsiz.
  if (process.env.TRUST_PROXY === '1') return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  return req.socket.remoteAddress || 'unknown';
}

export async function handleApi(req, res, url) {
  const c = cfg();
  const method = req.method;
  let matched = null, params = {};
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(url.pathname);
    if (m) { matched = r; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); break; }
  }
  if (!matched) return sendJson(res, 404, { error: 'not_found', message: 'Topilmadi.' });
  const ip = clientIp(req);
  try {
    const g = hit(`g:${ip}`, 600, 60000);
    if (!g.ok) throw new HttpError(429, 'rate_limited', 'Juda ko\'p so\'rov. Birozdan keyin urinib ko\'ring.', { retryAfter: g.retryAfter });

    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (unsafe) {
      const origin = req.headers.origin;
      if (origin) { let h; try { h = new URL(origin).host; } catch { h = null; } if (h !== req.headers.host) throw new HttpError(403, 'bad_origin', 'Ruxsat etilmagan manba.'); }
    }
    const cookies = parseCookies(req.headers.cookie);
    const sess = getSession(cookies.saydan_sid);
    const ctx = { req, res, url, params, query: Object.fromEntries(url.searchParams), ip, cookies, user: sess?.user || null, session: sess?.session || null, cfg: c };
    ctx.plan = planOf(ctx.user);
    ctx.role = ctx.user ? getRole(ctx.user) : null;

    const o = matched.opts;
    if (o.auth === 'required' && !ctx.user) throw new HttpError(401, 'unauthorized', 'Davom etish uchun tizimga kiring.');
    // CSRF: sessiya bor so'rovlarda sarlavha tokeni majburiy (double-submit emas, sessiyaga bog'langan)
    if (unsafe && ctx.session && !o.noCsrf) {
      if (req.headers['x-csrf-token'] !== ctx.session.csrf) throw new HttpError(403, 'csrf', 'Xavfsizlik tokeni noto\'g\'ri. Sahifani yangilang.');
    }
    if (o.perm && !can(ctx.user, o.perm)) throw new HttpError(ctx.user ? 403 : 401, ctx.user ? 'forbidden' : 'unauthorized', ctx.user ? 'Bu amal uchun ruxsat yo\'q.' : 'Tizimga kiring.');
    if (o.pro && !hasFeature(ctx.user, o.pro)) throw new HttpError(402, 'pro_required', 'Bu imkoniyat Pro rejada mavjud.', { feature: o.pro });
    if (o.limit) {
      const key = `${o.limit.name}:${ctx.user?.id || ip}`;
      const l = hit(key, o.limit.max, o.limit.windowMs);
      if (!l.ok) throw new HttpError(429, 'rate_limited', 'Juda ko\'p urinish. Birozdan keyin qayta urinib ko\'ring.', { retryAfter: l.retryAfter });
    }
    ctx.json = async () => {
      const buf = await readBody(req, o.maxBody || 256 * 1024);
      if (!buf.length) return {};
      if (!String(req.headers['content-type'] || '').includes('application/json')) throw bad('bad_content_type', 'JSON kutilgan.');
      try { return JSON.parse(buf.toString('utf8')); } catch { throw bad('bad_json', 'JSON noto\'g\'ri.'); }
    };
    ctx.raw = (max) => readBody(req, max);
    const out = await matched.handler(ctx);
    if (out === undefined) return sendJson(res, 204, {});
    if (out && out.__raw) { res.writeHead(out.status || 200, { ...SECURITY_HEADERS, ...out.headers }); return res.end(out.body); }
    return sendJson(res, out?.__status || 200, out?.__body ?? out);
  } catch (e) {
    if (e instanceof HttpError) {
      const headers = e.extra?.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : {};
      return sendJson(res, e.status, { error: e.code, message: e.message, ...e.extra }, headers);
    }
    try { sysEvent('error', 'server', `${req.method} ${url.pathname}: ${e?.message}`); } catch { /* ignore */ }
    console.error('[server error]', req.method, url.pathname, e?.message);
    return sendJson(res, 500, { error: 'server_error', message: 'Ichki xatolik yuz berdi. Keyinroq urinib ko\'ring.' });
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const PUBLIC = path.join(ROOT, 'public');
export function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const full = path.join(PUBLIC, path.normalize(p));
  if (!full.startsWith(PUBLIC + path.sep) && full !== PUBLIC) { res.writeHead(403); return res.end(); }
  let file = full;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(p)) { res.writeHead(404, SECURITY_HEADERS); return res.end('Topilmadi'); }
    file = path.join(PUBLIC, 'index.html'); // SPA
    if (!fs.existsSync(file)) { res.writeHead(404, SECURITY_HEADERS); return res.end('Frontend topilmadi'); }
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300', ...SECURITY_HEADERS });
  fs.createReadStream(file).pipe(res);
}
export function listRoutes() { return routes.map((r) => ({ method: r.method, pattern: r.pattern, opts: r.opts })); }

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

export const OWNER = 'owner@example.test';
export function baseEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saydan-test-'));
  Object.assign(process.env, {
    SAYDAN_QUIET: '1', NODE_ENV: 'test', DATA_DIR: dir, DB_PATH: ':memory:', SUPER_ADMIN_EMAIL: OWNER,
    MAIL_PROVIDER: 'console', DEMO_MODE: '0', PAYMENT_PROVIDER: 'none', BARCODE_PROVIDER: 'openbeautyfacts',
    FREE_MONTHLY_ANALYSIS_LIMIT: '10', PRO_MONTHLY_ANALYSIS_LIMIT: '200', FREE_HISTORY_VISIBLE: '5',
    PAYMENT_SANDBOX_SECRET: 'test-secret-value', UPLOAD_RETENTION_HOURS: '24', ...extra,
  });
  return dir;
}

export async function start(extraEnv = {}) {
  baseEnv(extraEnv);
  const { initDb } = await import('../src/db.mjs');
  const { resetRateLimits } = await import('../src/ratelimit.mjs');
  initDb(':memory:');
  resetRateLimits();
  const { createServer } = await import('../server.mjs');
  const server = createServer();
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, close: () => new Promise((r) => server.close(r)) };
}

export class Client {
  constructor(base) { this.base = base; this.cookies = {}; this.csrf = null; }
  async req(method, p, body, { headers = {}, raw = null, csrf = true } = {}) {
    const h = { ...headers };
    const ck = Object.entries(this.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    if (ck) h.cookie = ck;
    if (this.csrf && csrf && method !== 'GET') h['x-csrf-token'] = this.csrf;
    let payload;
    if (raw) payload = raw; else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.base + p, { method, headers: h, body: payload, signal: AbortSignal.timeout(8000) });
    for (const sc of res.headers.getSetCookie?.() || []) {
      const [pair] = sc.split(';'); const i = pair.indexOf('=');
      const k = pair.slice(0, i), v = decodeURIComponent(pair.slice(i + 1));
      if (/Max-Age=0/i.test(sc)) delete this.cookies[k]; else this.cookies[k] = v;
    }
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    let json = null; if (ct.includes('json')) { try { json = JSON.parse(text); } catch { /* */ } }
    return { status: res.status, json, text, headers: res.headers };
  }
  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b, o) { return this.req('POST', p, b ?? {}, o); }
  put(p, b, o) { return this.req('PUT', p, b ?? {}, o); }
  patch(p, b, o) { return this.req('PATCH', p, b ?? {}, o); }
  del(p, o) { return this.req('DELETE', p, undefined, o); }
  async refreshCsrf() { const r = await this.get('/api/me'); this.csrf = r.json.csrf; return r.json; }
}

export const PW = 'Sinov-parol-12345';
export async function signup(base, email, { nickname = 'Sinovchi', verify = true, login = true, password = PW } = {}) {
  const { outbox } = await import('../src/mail.mjs');
  (await import('../src/ratelimit.mjs')).resetRateLimits();   // testlar bitta IP dan ketma-ket ro'yxatdan o'tadi
  const c = new Client(base);
  const before = outbox.length;
  const r = await c.post('/api/auth/register', { email, password, nickname });
  if (r.status !== 200) throw new Error('register failed ' + JSON.stringify(r.json));
  if (verify) {
    const mail = outbox.slice(before).reverse().find((m) => m.to === email.trim().toLowerCase());
    if (!mail) throw new Error('verification mail not found');
    const token = new URL(mail.link.replace('/#/', '/')).searchParams.get('token');
    const v = await new Client(base).post('/api/auth/verify-email', { token });
    if (v.status !== 200) throw new Error('verify failed');
  }
  if (login) { const l = await c.post('/api/auth/login', { email, password }); if (l.status !== 200) throw new Error('login failed ' + JSON.stringify(l.json)); await c.refreshCsrf(); }
  return c;
}
export async function userIdOf(email) {
  const { db } = await import('../src/db.mjs');
  return db().prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase())?.id;
}
// FAQAT TEST: haqiqiy to'lovsiz Pro berish (production manba)
export async function makePro(email) {
  const { db } = await import('../src/db.mjs');
  const id = await userIdOf(email);
  db().prepare("INSERT INTO subscriptions(user_id, plan, status, source, period_start, period_end, auto_renew) VALUES (?, 'pro', 'active', 'production', ?, ?, 0)")
    .run(id, new Date().toISOString(), new Date(Date.now() + 30 * 86400000).toISOString());
  return id;
}
// FAQAT TEST SINOV MA'LUMOTI (sintetik; ilmiy emas)
export async function addIngredient(o) {
  const { db } = await import('../src/db.mjs');
  const { normInci, inciVariants } = await import('../src/util.mjs');
  const key = normInci(o.inci);
  const r = db().prepare(`INSERT INTO ingredients(key, inci, inci_norm, uz_name, synonyms, cas, cosing_functions, function_uz, description_uz, detailed_explanation, pregnancy_info, dry_info, oily_info, sensitive_info, eu_restrictions, source_urls, status, is_demo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(key, o.inci, key, o.uz ?? null, o.syn ?? null, o.cas ?? null, o.fn ?? 'TEST', o.fnUz ?? 'Sinov vazifa', o.desc ?? 'Sinov tavsifi', o.detail ?? null, o.preg ?? null, o.dry ?? null, o.oily ?? null, o.sens ?? null, o.eu ?? null, o.src ?? null, o.status ?? 'draft');
  const id = Number(r.lastInsertRowid);
  const add = (n, k) => db().prepare('INSERT OR IGNORE INTO ingredient_aliases(ingredient_id, alias_norm, kind) VALUES (?,?,?)').run(id, n, k);
  inciVariants(o.inci).forEach((v) => add(v, 'inci'));
  if (o.uz) inciVariants(o.uz).forEach((v) => add(v, 'uz'));
  for (const s of String(o.syn || '').split(/[,;]+/)) inciVariants(s).forEach((v) => add(v, 'synonym'));
  if (o.cas) add(o.cas, 'cas');
  return id;
}
export async function addAssessment(id, dim, stance, ev = 'high', approved = 1) {
  const { db } = await import('../src/db.mjs');
  db().prepare('INSERT INTO ingredient_assessments(ingredient_id, dimension, stance, evidence_level, note, source_ref, approved) VALUES (?,?,?,?,?,?,?)').run(id, dim, stance, ev, 'sinov', 'https://example.test/src', approved);
}

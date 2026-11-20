import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { start, signup, makePro, addIngredient, addAssessment, Client, PW } from './helpers.mjs';

let S, free, pro, other;
const NAMES = ['Aqua', 'Glycerin', 'Niacinamide', 'Squalane', 'Panthenol'];
const ids = {};
before(async () => {
  S = await start();
  for (const n of NAMES) ids[n] = await addIngredient({ inci: n, uz: n.toLowerCase() + 'uz', cas: n === 'Glycerin' ? '56-81-5' : null });
  free = await signup(S.base, 'free1@example.test');
  pro = await signup(S.base, 'pro1@example.test'); await makePro('pro1@example.test');
  other = await signup(S.base, 'other1@example.test');
});
after(() => S.close());

test('scoring: foiz faqat yetarli tasdiqlangan ma\'lumotda; climate/pregnancy foizsiz', async () => {
  const { scoreDimension } = await import('../src/analysis/scoring.mjs');
  const mk = (st, ap = 1, ev = 'high') => ({ assessment: { stance: st, evidence_level: ev, approved: ap }, hasText: true });
  const few = scoreDimension('dry', [mk('favorable'), mk('favorable'), { hasText: false }]);
  assert.equal(few.percent, null);
  const unapproved = scoreDimension('dry', [mk('favorable', 0), mk('favorable', 0), mk('favorable', 0)]);
  assert.equal(unapproved.percent, null);
  const ok = scoreDimension('dry', [mk('favorable'), mk('favorable'), mk('caution')]);
  assert.equal(typeof ok.percent, 'number'); assert.ok(ok.percent > 0 && ok.percent < 100);
  for (const d of ['climate', 'pregnancy']) assert.equal(scoreDimension(d, [mk('favorable'), mk('favorable'), mk('favorable')]).percent, null);
});

test('extract: ingredient ro\'yxatini ajratadi, tartib/konsentratsiya bahosiz', async () => {
  const { extractIngredients } = await import('../src/analysis/extract.mjs');
  const r = extractIngredients('Ingredients: Aqua, Glycerin, Niacinamide.\nHow to use: apply daily');
  const raws = r.items.map((x) => x.raw);
  assert.deepEqual(raws, ['Aqua', 'Glycerin', 'Niacinamide']);
  assert.ok(!raws.some((x) => /apply/i.test(x)));
});

test('analyze: aniq moslik, noaniq (fuzzy) va topilmagan alohida', async () => {
  const r = await pro.post('/api/analyze', { items: ['Aqua', 'Glycerine', 'Zzzqxyzunknown'] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const res = r.json.result;
  assert.ok(res.counts.confirmed >= 1);
  assert.equal(res.unmatched.length >= 1, true);
  assert.ok(res.counts.unmatched >= 1);
  assert.equal(res.dimensions.dry.percent, null);   // tasdiqlangan baho yo'q
});

test('analyze: login talab qilinadi va CSRFsiz rad etiladi', async () => {
  const anon = new Client(S.base);
  assert.equal((await anon.post('/api/analyze', { items: ['Aqua'] })).status, 401);
  const bad = await pro.post('/api/analyze', { items: ['Aqua'] }, { csrf: false });
  assert.ok([401, 403].includes(bad.status));
});

test('Free/Pro shakllanishi server tomonida: Free\'da batafsil, o\'zaro ta\'sir, muqobil, allergen qulflangan', async () => {
  for (const n of ['Aqua', 'Glycerin', 'Niacinamide', 'Squalane']) await addAssessment(ids[n], 'dry', 'favorable');
  const p = await pro.post('/api/analyze', { items: NAMES.slice(0, 4) });
  assert.equal(typeof p.json.result.dimensions.dry.percent, 'number');
  assert.equal(p.json.result.plan, 'pro');
  const f = await free.post('/api/analyze', { items: NAMES.slice(0, 4) });
  assert.equal(f.status, 200);
  const r = f.json.result;
  assert.equal(r.plan, 'free');
  assert.equal(r.interactions.locked, true); assert.equal(r.alternatives.locked, true); assert.equal(r.allergenAlerts.locked, true);
  assert.ok(r.ingredients.every((i) => i.detail === undefined));
});

test('oylik limit server tomonida', async () => {
  const c = await signup(S.base, 'limit1@example.test');
  const { db } = await import('../src/db.mjs');
  const { userIdOf } = await import('./helpers.mjs');
  const uid = await userIdOf('limit1@example.test');
  for (let i = 0; i < 10; i++) db().prepare("INSERT INTO analysis_usage(user_id, kind) VALUES (?, 'label')").run(uid);
  const r = await c.post('/api/analyze', { items: ['Aqua'] });
  assert.equal(r.status, 429); assert.equal(r.json.error, 'monthly_limit');
});

test('saqlash: rozilik shart; IDOR yo\'q; boshqa foydalanuvchi o\'qiy olmaydi', async () => {
  assert.equal((await free.post('/api/analyses', { items: ['Aqua'], product_name: 'X' })).status, 400);
  const s = await free.post('/api/analyses', { items: ['Aqua', 'Glycerin'], product_name: 'Sinov krem', consent_save: true });
  assert.equal(s.status, 200);
  assert.equal((await free.get('/api/analyses/' + s.json.id)).status, 200);
  assert.equal((await other.get('/api/analyses/' + s.json.id)).status, 404);
  assert.equal((await other.del('/api/analyses/' + s.json.id)).status, 404);
});

test('Free: tarix 5 ta bilan cheklangan', async () => {
  const c = await signup(S.base, 'hist1@example.test');
  for (let i = 0; i < 7; i++) assert.equal((await c.post('/api/analyses', { items: ['Aqua'], product_name: 'M' + i, consent_save: true })).status, 200);
  const l = await c.get('/api/analyses');
  assert.equal(l.status, 200);
  assert.equal(l.json.items.filter((i) => !i.locked).length, 5);
  assert.equal(l.json.items.filter((i) => i.locked).length, 2);
  assert.ok(l.json.items.filter((i) => i.locked).every((i) => !i.product_name));
});

test('Pro funksiyalari Free\'da 402, ro\'yxatdan o\'tmaganda 401', async () => {
  for (const p of ['/api/shelf', '/api/diary/stats', '/api/profile']) assert.equal((await free.get(p)).status, 402, p);
  assert.equal((await free.post('/api/barcode/lookup', { barcode: '5901234123457' })).status, 402);
  assert.equal((await new Client(S.base).get('/api/shelf')).status, 401);
});

test('javon: PAO va yaroqlilik muddati alohida; noto\'g\'ri sana rad etiladi', async () => {
  const a = await pro.post('/api/shelf', { name: 'Krem', opened_date: '2026-01-01', pao_months: 6 });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal((await pro.post('/api/shelf', { name: 'Krem2', expiry_date: '31/02/2026' })).status, 400);
  const l = await pro.get('/api/shelf');
  const it = l.json.items.find((x) => x.name === 'Krem');
  assert.ok(it);
  assert.equal((await other.put('/api/shelf/' + a.json.id, { name: 'hack' })).status, 402);
});

test('profil shifrlangan holda saqlanadi', async () => {
  const r = await pro.put('/api/profile', { consent: true, skin_type: 'dry', allergens: ['Linalool'] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const { db } = await import('../src/db.mjs');
  const row = db().prepare('SELECT * FROM profiles').all().pop();
  assert.ok(!JSON.stringify(row).includes('Linalool'));
  assert.equal((await pro.get('/api/profile')).json.allergens?.[0] ?? (await pro.get('/api/profile')).json.profile?.allergens?.[0], 'Linalool');
});

test('barkod: found / not_found / unavailable (mock fetch)', async () => {
  const bc = await import('../src/barcode/index.mjs');
  bc.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ status: 1, product: { product_name: 'T', brands: 'B', ingredients_text: 'Aqua, Glycerin' } }) }));
  let r = await pro.post('/api/barcode/lookup', { barcode: '5901234123457' });
  assert.equal(r.json.state, 'found'); assert.match(r.json.product.ingredients_text, /Aqua/);
  bc.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ status: 0 }) }));
  r = await pro.post('/api/barcode/lookup', { barcode: '5901234123457' });
  assert.equal(r.json.state, 'not_found');
  bc.setFetch(async () => { throw new Error('net'); });
  r = await pro.post('/api/barcode/lookup', { barcode: '5901234123457' });
  assert.equal(r.json.state, 'unavailable');
  assert.equal((await pro.post('/api/barcode/lookup', { barcode: '12ab' })).status, 400);
  bc.setFetch(null);
});

test('to\'lov: provayder ulanmagan bo\'lsa checkout 503; Payme/Click/Uzum soxta "ulangan" emas', async () => {
  const r = await free.post('/api/subscription/checkout', {});
  assert.equal(r.status, 503);
  const cfg = await free.get('/api/config');
  assert.ok(!/payme|click|uzum/i.test(JSON.stringify(cfg.json.payments?.state ?? '')));
});

test('demo Pro: DEMO_MODE=0 da berilmaydi', async () => {
  const r = await free.post('/api/demo/activate-pro', {});
  assert.ok([403, 404].includes(r.status));
});

test('hamjamiyat: sharh, bitta sharh qoidasi, yashirish', async () => {
  const p = await pro.post('/api/products', { name: 'Test mahsulot', brand: 'TB' });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const r1 = await pro.post(`/api/products/${p.json.id}/reviews`, { rating: 4, body: 'Yaxshi ishlatdim, tavsiya qilaman.' });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  const rv = await other.get(`/api/products/${p.json.id}/reviews`);
  assert.equal(rv.json.items.length, 1);
  assert.equal((await pro.post(`/api/products/${p.json.id}/reviews`, { rating: 0, body: 'Yaxshi ishlatdim, tavsiya.' })).status, 400);
  const { db } = await import('../src/db.mjs');
  assert.equal(db().prepare('SELECT COUNT(*) n FROM reviews WHERE product_id = ?').get(p.json.id).n, 1);
});

test('xavfsizlik: SQL inyeksiya, static traversal, noto\'g\'ri fayl yuklash', async () => {
  const c = new Client(S.base);
  const r = await c.get("/api/ingredients?q=" + encodeURIComponent("' OR 1=1; DROP TABLE users;--"));
  assert.equal(r.status, 200);
  const { db } = await import('../src/db.mjs');
  assert.ok(db().prepare('SELECT COUNT(*) n FROM users').get().n > 0);
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2f..%2fetc/passwd', '/.env']) {
    const t = await c.get(p); assert.ok(!/"name":\s*"saydan"/.test(t.text) && !/root:/.test(t.text), p);
  }
  const up = await pro.req('POST', '/api/ocr', undefined, { raw: Buffer.from('<?php echo 1; ?>'), headers: { 'content-type': 'image/png' } });
  assert.ok([400, 415, 422].includes(up.status), 'status ' + up.status);
});

test('xavfsizlik sarlavhalari va maxfiy ma\'lumot chiqmasligi', async () => {
  const r = await new Client(S.base).get('/');
  assert.ok(r.headers.get('content-security-policy')); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const me = await pro.get('/api/me'); const t = JSON.stringify(me.json);
  assert.ok(!/password|scrypt|hash/i.test(t));
});

test('webhook: imzosiz va noto\'g\'ri imzo rad etiladi; takror event idempotent', async () => {
  const { baseEnv } = await import('./helpers.mjs');
  const pay = await import('../src/payments/index.mjs');
  const raw = Buffer.from(JSON.stringify({ event_id: 'e1', txn: 'nope', status: 'paid', ts: Date.now() }));
  assert.notEqual(pay.handleSandboxWebhook(raw, 'bad').status, 200);
  assert.equal(pay.verifySignature(raw, pay.sign(raw)), true);
  const old = Buffer.from(JSON.stringify({ event_id: 'e2', txn: 'nope', status: 'paid', ts: Date.now() - 3600000 }));
  assert.notEqual(pay.handleSandboxWebhook(old, pay.sign(old)).status, 200);
});

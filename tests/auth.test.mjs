import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, Client, signup, PW } from './helpers.mjs';
import { outbox } from '../src/mail.mjs';
import { db } from '../src/db.mjs';

let ctx;
before(async () => { ctx = await start(); });
after(() => ctx.close());

test('ro\'yxatdan o\'tish, tasdiqlash va kirish', async () => {
  const c = await signup(ctx.base, 'a1@example.test', { nickname: 'Ali' });
  const me = await c.get('/api/me');
  assert.equal(me.json.user.email, 'a1@example.test');
  assert.equal(me.json.user.email_verified, true);
  assert.equal(me.json.user.plan, 'free');
  assert.equal(me.json.user.role, null);
});

test('parol ochiq matnda saqlanmaydi (scrypt)', () => {
  const r = db().prepare("SELECT password_hash FROM users WHERE email = 'a1@example.test'").get();
  assert.match(r.password_hash, /^scrypt\$/);
  assert.ok(!r.password_hash.includes(PW));
});

test('zaif parol va noto\'g\'ri email rad etiladi', async () => {
  const c = new Client(ctx.base);
  assert.equal((await c.post('/api/auth/register', { email: 'x@example.test', password: 'short1', nickname: 'Xx' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { email: 'x@example.test', password: 'onlyletterspassword', nickname: 'Xx' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { email: 'not-an-email', password: PW, nickname: 'Xx' })).status, 400);
});

test('mavjud emailni oshkor qilmaydi (bir xil javob)', async () => {
  const c = new Client(ctx.base);
  const r1 = await c.post('/api/auth/register', { email: 'a1@example.test', password: PW, nickname: 'Boshqa' });
  const r2 = await c.post('/api/auth/register', { email: 'fresh1@example.test', password: PW, nickname: 'Yangi' });
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  assert.deepEqual(r1.json, r2.json);
});

test('noto\'g\'ri parol va noma\'lum email bir xil xato beradi', async () => {
  const c = new Client(ctx.base);
  const r1 = await c.post('/api/auth/login', { email: 'a1@example.test', password: 'wrong-password-1' });
  const r2 = await c.post('/api/auth/login', { email: 'nobody@example.test', password: 'wrong-password-1' });
  assert.equal(r1.status, 401); assert.equal(r2.status, 401);
  assert.equal(r1.json.message, r2.json.message);
});

test('sessiya cookie HttpOnly + SameSite; chiqishdan keyin yaroqsiz', async () => {
  const c = new Client(ctx.base);
  await signup(ctx.base, 'a2@example.test').then(async (cc) => {
    const res = await fetch(ctx.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a2@example.test', password: PW }) });
    const sc = res.headers.getSetCookie().join(';');
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/);
    const sid = cc.cookies.saydan_sid;
    await cc.post('/api/auth/logout');
    const old = new Client(ctx.base); old.cookies.saydan_sid = sid;
    assert.equal((await old.get('/api/me')).json.user, null);
  });
  assert.equal(c.cookies.saydan_sid, undefined);
});

test('CSRF: tokensiz o\'zgartiruvchi so\'rov rad etiladi', async () => {
  const c = await signup(ctx.base, 'a3@example.test');
  assert.equal((await c.patch('/api/me', { nickname: 'Yangi nom' }, { csrf: false })).status, 403);
  assert.equal((await c.patch('/api/me', { nickname: 'Yangi nom' })).status, 200);
});

test('noto\'g\'ri Origin rad etiladi', async () => {
  const c = await signup(ctx.base, 'a4@example.test');
  const r = await c.patch('/api/me', { nickname: 'Hujum' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('parolni tiklash: token bir martalik, eski sessiyalar o\'chadi', async () => {
  const c = await signup(ctx.base, 'a5@example.test');
  const n = outbox.length;
  await new Client(ctx.base).post('/api/auth/forgot', { email: 'a5@example.test' });
  const mail = outbox.slice(n).find((m) => m.to === 'a5@example.test');
  const token = new URL(mail.link.replace('/#/', '/')).searchParams.get('token');
  const fresh = new Client(ctx.base);
  assert.equal((await fresh.post('/api/auth/reset', { token, password: 'zaif' })).status, 400);
  assert.equal((await fresh.post('/api/auth/reset', { token, password: 'Yangi-parol-98765' })).status, 200);
  assert.equal((await fresh.post('/api/auth/reset', { token, password: 'Yana-bir-parol-1111' })).status, 400); // qayta ishlatib bo'lmaydi
  assert.equal((await c.get('/api/me')).json.user, null);               // eski sessiya bekor
  assert.equal((await new Client(ctx.base).post('/api/auth/login', { email: 'a5@example.test', password: 'Yangi-parol-98765' })).status, 200);
});

test('noma\'lum emailga tiklash so\'rovi ham bir xil javob beradi', async () => {
  const r = await new Client(ctx.base).post('/api/auth/forgot', { email: 'ghost@example.test' });
  assert.equal(r.status, 200);
});

test('kirishga urinishlar cheklanadi (rate limit)', async () => {
  const c = new Client(ctx.base);
  let last;
  for (let i = 0; i < 12; i++) last = await c.post('/api/auth/login', { email: 'victim@example.test', password: 'wrong-password-1' });
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
});

test('tasdiqlanmagan hisob egalik isbotlamaydi — keyingi ro\'yxatdan o\'tuvchi uni almashtiradi', async () => {
  await signup(ctx.base, 'squat@example.test', { verify: false, login: false, nickname: 'Squatter', password: 'Squatter-parol-111' });
  const real = await signup(ctx.base, 'squat@example.test', { nickname: 'Haqiqiy', password: 'Haqiqiy-parol-222' });
  assert.equal((await real.get('/api/me')).json.user.nickname, 'Haqiqiy');
  assert.equal((await new Client(ctx.base).post('/api/auth/login', { email: 'squat@example.test', password: 'Squatter-parol-111' })).status, 401);
});

test('email o\'zgartirish: yangi manzil tasdiqlanmaguncha eski email qoladi', async () => {
  const c = await signup(ctx.base, 'a6@example.test');
  const n = outbox.length;
  assert.equal((await c.post('/api/me/email', { email: 'a6-new@example.test', password: 'xato-parol-123' })).status, 400);
  assert.equal((await c.post('/api/me/email', { email: 'a6-new@example.test', password: PW })).status, 200);
  assert.equal((await c.get('/api/me')).json.user.email, 'a6@example.test');
  const mail = outbox.slice(n).find((m) => m.to === 'a6-new@example.test');
  const token = new URL(mail.link.replace('/#/', '/')).searchParams.get('token');
  assert.equal((await c.post('/api/me/email/confirm', { token })).status, 200);
  assert.equal((await c.get('/api/me')).json.user.email, 'a6-new@example.test');
});

test('hisobni o\'chirish ma\'lumotlarni ham o\'chiradi', async () => {
  const c = await signup(ctx.base, 'a7@example.test');
  assert.equal((await c.post('/api/me/delete', { password: 'xato-parol-123' })).status, 400);
  assert.equal((await c.post('/api/me/delete', { password: PW })).status, 200);
  assert.equal(db().prepare("SELECT COUNT(*) n FROM users WHERE email = 'a7@example.test'").get().n, 0);
});

test('maxfiy maydonlar API javoblarida yo\'q', async () => {
  const c = await signup(ctx.base, 'a8@example.test');
  const me = JSON.stringify((await c.get('/api/me')).json);
  assert.ok(!me.includes('password')); assert.ok(!me.includes('scrypt'));
});

test('email: brevo/resend HTTP API so\'rovi to\'g\'ri shakllanadi, xatoda ok=false', async () => {
  const m = await import('../src/mail.mjs');
  const calls = [];
  m.setMailFetch(async (url, o) => { calls.push({ url, o }); return { ok: true, status: 200, text: async () => '' }; });
  Object.assign(process.env, { MAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k', MAIL_FROM: 'noreply@example.test' });
  let r = await m.sendMail({ to: 'a@example.test', subject: 'S', text: 'Salom', link: 'https://x.test/#/verify?token=t' });
  assert.equal(r.ok, true); assert.match(calls[0].url, /brevo/); assert.equal(calls[0].o.headers['api-key'], 'k');
  assert.match(JSON.parse(calls[0].o.body).htmlContent, /verify\?token=t/);
  process.env.MAIL_PROVIDER = 'resend'; process.env.RESEND_API_KEY = 'rk';
  r = await m.sendMail({ to: 'a@example.test', subject: 'S', text: 'Salom' });
  assert.equal(r.ok, true); assert.match(calls[1].url, /resend/);
  m.setMailFetch(async () => ({ ok: false, status: 401, text: async () => 'bad key' }));
  r = await m.sendMail({ to: 'a@example.test', subject: 'S', text: 'x' });
  assert.equal(r.ok, false);
  process.env.MAIL_PROVIDER = 'console'; delete process.env.BREVO_API_KEY; delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM;
  m.setMailFetch(null);
});

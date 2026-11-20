// Majburiy Super Admin xavfsizlik testlari (spetsifikatsiya 4.10 / 24).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start, Client, signup, userIdOf, OWNER, PW } from './helpers.mjs';
import { outbox } from '../src/mail.mjs';
import { db } from '../src/db.mjs';
import { listRoutes } from '../src/http.mjs';
import { getRole, isSuperAdminEmail, maybeBindSuperAdmin } from '../src/roles.mjs';

let ctx;
before(async () => { ctx = await start(); });
after(() => ctx.close());

test('1) ruxsat etilgan email tasdiqlanmagan bo\'lsa Super Admin huquqi BERILMAYDI', async () => {
  const c = await signup(ctx.base, OWNER, { verify: false, nickname: 'Egasi' });
  assert.equal((await c.get('/api/me')).json.user.role, null);
  assert.equal((await c.get('/api/admin/dashboard')).status, 403);
  assert.equal((await c.get('/api/admin/me')).status, 403);
  assert.equal(db().prepare("SELECT COUNT(*) n FROM user_roles WHERE role = 'super_admin'").get().n, 0);
});

test('7/10) tasdiqlangan ruxsat etilgan email — admin; immutable user ID ga bog\'lanadi; audit yoziladi', async () => {
  const n = outbox.length;
  // qayta ro'yxatdan o'tish tasdiqlanmagan hisobni almashtiradi, so'ng tasdiqlaymiz
  const c = await signup(ctx.base, `  ${OWNER.toUpperCase()}  `, { nickname: 'Egasi' });   // trim + lowercase normallashtirish
  const me = await c.get('/api/me');
  assert.equal(me.json.user.role, 'super_admin');
  assert.equal((await c.get('/api/admin/dashboard')).status, 200);
  const row = db().prepare("SELECT user_id FROM user_roles WHERE role = 'super_admin'").get();
  assert.equal(row.user_id, await userIdOf(OWNER));
  const log = db().prepare("SELECT * FROM admin_audit_logs WHERE action = 'super_admin_bound'").all();
  assert.equal(log.length, 1);
  assert.ok(!/token|parol|password|secret/i.test(JSON.stringify(log)));
  assert.ok(outbox.length > n);
});

test('5) nuqta / + variantlari ekvivalent EMAS', async () => {
  assert.equal(isSuperAdminEmail('owner@example.test'), true);
  for (const e of ['o.wner@example.test', 'owner+x@example.test', 'owner@example.test.evil', 'xowner@example.test', 'owner@example.TEST ', '']) {
    if (e.trim().toLowerCase() === OWNER) continue;
    assert.equal(isSuperAdminEmail(e), false, e);
  }
  const c = await signup(ctx.base, 'o.wner@example.test');
  assert.equal((await c.get('/api/me')).json.user.role, null);
  assert.equal((await c.get('/api/admin/dashboard')).status, 403);
  const c2 = await signup(ctx.base, 'owner+tag@example.test');
  assert.equal((await c2.get('/api/me')).json.user.role, null);
});

test('2/6) boshqa email o\'zini Super Admin qila olmaydi; mijoz yuborgan role/isAdmin e\'tiborsiz', async () => {
  const { outbox: ob } = await import('../src/mail.mjs');
  const r = await new Client(ctx.base).post('/api/auth/register', { email: 'sneaky@example.test', password: PW, nickname: 'Sneaky', role: 'super_admin', isAdmin: true, isSuperAdmin: true });
  assert.equal(r.status, 200);
  const c = await signup(ctx.base, 'sneaky2@example.test');
  assert.equal((await c.patch('/api/me', { nickname: 'Yangi', role: 'super_admin', isAdmin: true })).status, 200);
  assert.equal((await c.get('/api/me')).json.user.role, null);
  const id = await userIdOf('sneaky2@example.test');
  // o'zini rolga tayinlash urinishi
  assert.equal((await c.post(`/api/admin/users/${id}/role`, { role: 'super_admin' })).status, 403);
  assert.equal((await c.post(`/api/admin/users/${id}/role`, { role: 'content_editor' })).status, 403);
  assert.equal(db().prepare('SELECT COUNT(*) n FROM user_roles WHERE user_id = ?').get(id).n, 0);
  assert.ok(ob.length > 0);
});

test('3) oddiy foydalanuvchi har bir admin sahifa/API ga kira olmaydi (server rad etadi)', async () => {
  const user = await signup(ctx.base, 'plain@example.test');
  const anon = new Client(ctx.base);
  const admin = listRoutes().filter((r) => r.pattern.startsWith('/api/admin/'));
  assert.ok(admin.length > 30, 'admin marshrutlari topilishi kerak: ' + admin.length);
  for (const r of admin) {
    const p = r.pattern.replace(/:[a-zA-Z]+/g, '1');
    const a = await anon.req(r.method, p, r.method === 'GET' ? undefined : {});
    assert.ok([401, 403].includes(a.status), `anonim ${r.method} ${p} -> ${a.status}`);
    const u = await user.req(r.method, p, r.method === 'GET' ? undefined : {});
    assert.equal(u.status, 403, `oddiy foydalanuvchi ${r.method} ${p} -> ${u.status}`);
  }
});

test('4) mijoz tomondan role/isAdmin o\'zgartirish qo\'shimcha huquq bermaydi (header, query, cookie)', async () => {
  const c = await signup(ctx.base, 'plain2@example.test');
  const tries = [
    c.get('/api/admin/dashboard', { headers: { 'x-role': 'super_admin', 'x-is-admin': 'true' } }),
    c.get('/api/admin/dashboard?role=super_admin&isAdmin=1'),
  ];
  c.cookies.role = 'super_admin'; c.cookies.isAdmin = 'true';
  tries.push(c.get('/api/admin/users'));
  for (const t of await Promise.all(tries)) assert.equal(t.status, 403);
});

test('12) ikkinchi Super Admin yaratib bo\'lmaydi (DB va server darajasida)', async () => {
  const other = await userIdOf('plain@example.test');
  assert.throws(() => db().prepare("INSERT INTO user_roles(user_id, role) VALUES (?, 'super_admin')").run(other), /UNIQUE|constraint/i);
  // UPDATE orqali ko'tarish ham mumkin emas
  db().prepare("INSERT INTO user_roles(user_id, role) VALUES (?, 'marketer')").run(other);
  assert.throws(() => db().prepare("UPDATE user_roles SET role = 'super_admin' WHERE user_id = ?").run(other), /super_admin/i);
  db().prepare('DELETE FROM user_roles WHERE user_id = ?').run(other);
  // mavjud super_admin yozuvini boshqaga ko'chirib bo'lmaydi
  assert.throws(() => db().prepare("UPDATE user_roles SET user_id = ? WHERE role = 'super_admin'").run(other), /super_admin/i);
  // server funksiyasi ham ikkinchisini bog'lamaydi
  const u = db().prepare('SELECT * FROM users WHERE email = ?').get('plain@example.test');
  assert.equal(maybeBindSuperAdmin(u), false);
  assert.equal(db().prepare("SELECT COUNT(*) n FROM user_roles WHERE role = 'super_admin'").get().n, 1);
});

test('super_admin rolini API orqali berib bo\'lmaydi, Super Adminning o\'z rolini o\'zgartirib bo\'lmaydi', async () => {
  const owner = new Client(ctx.base);
  await owner.post('/api/auth/login', { email: OWNER, password: PW }); await owner.refreshCsrf();
  const plain = await userIdOf('plain@example.test'), ownerId = await userIdOf(OWNER);
  assert.equal((await owner.post(`/api/admin/users/${plain}/role`, { role: 'super_admin' })).status, 403);
  assert.equal((await owner.post(`/api/admin/users/${ownerId}/role`, { role: 'marketer' })).status, 403);
  assert.equal((await owner.post(`/api/admin/users/${ownerId}/status`, { status: 'blocked' })).status, 403);
  assert.equal((await owner.post('/api/me/delete', { password: PW })).status, 400);   // super admin o'zini o'chira olmaydi
});

test('11/15) email tasdiqi bekor bo\'lsa yoki email mos kelmasa — oddiy foydalanuvchi', async () => {
  const id = await userIdOf(OWNER);
  const u = () => db().prepare('SELECT * FROM users WHERE id = ?').get(id);
  assert.equal(getRole(u()), 'super_admin');
  db().prepare('UPDATE users SET email_verified = 0 WHERE id = ?').run(id);
  assert.equal(getRole(u()), null);
  db().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(id);
  assert.equal(getRole(u()), 'super_admin');
  db().prepare("UPDATE users SET email = 'moved@example.test' WHERE id = ?").run(id);
  assert.equal(getRole(u()), null);           // email o'zgargan: huquq avtomatik bekor
  db().prepare('UPDATE users SET email = ? WHERE id = ?').run(OWNER, id);
  assert.equal(getRole(u()), 'super_admin');
  // env o'zgarsa, eski bog'lanish kuchini yo'qotadi
  const prev = process.env.SUPER_ADMIN_EMAIL;
  process.env.SUPER_ADMIN_EMAIL = 'someone-else@example.test';
  assert.equal(getRole(u()), null);
  process.env.SUPER_ADMIN_EMAIL = '';
  assert.equal(getRole(u()), null);           // sozlanmagan bo'lsa hech kim admin emas
  process.env.SUPER_ADMIN_EMAIL = prev;
});

test('8/9) profil emailini ruxsat etilgan manzilga o\'zgartirish — tasdiqlanmaguncha va band bo\'lsa — huquq bermaydi', async () => {
  const c = await signup(ctx.base, 'changer@example.test');
  const n = outbox.length;
  const r = await c.post('/api/me/email', { email: OWNER, password: PW });
  assert.equal(r.status, 200);                                         // generic javob (egalik oshkor qilinmaydi)
  const me = (await c.get('/api/me')).json.user;
  assert.equal(me.email, 'changer@example.test');                      // email hali o'zgarmagan
  assert.equal(me.role, null);
  assert.equal((await c.get('/api/admin/dashboard')).status, 403);
  assert.equal(outbox.slice(n).filter((m) => m.to === OWNER).length, 0); // band manzilga token yuborilmaydi
});

test('qoʻshimcha: email o\'zgartirish orqali tasdiqlash — Super Admin bog\'lanishi mavjud bo\'lsa o\'tmaydi', async () => {
  // Egasi hisobi boshqa emailga o'tsa (bog'lanish saqlanadi, lekin huquq bekor), boshqa kishi OWNER emailini egallay olmaydi bog'lanishsiz
  const ownerId = await userIdOf(OWNER);
  db().prepare("UPDATE users SET email = 'owner-old@example.test' WHERE id = ?").run(ownerId);
  const intruder = await signup(ctx.base, 'intruder@example.test');
  const n = outbox.length;
  await intruder.post('/api/me/email', { email: OWNER, password: PW });
  const mail = outbox.slice(n).find((m) => m.to === OWNER);
  const token = new URL(mail.link.replace('/#/', '/')).searchParams.get('token');
  const conf = await intruder.post('/api/me/email/confirm', { token });
  assert.equal(conf.status, 200);                                      // egalik isbotlangan (token manzilga yuborilgan)
  assert.equal((await intruder.get('/api/me')).json.user.role, null);  // lekin bog'lanish boshqa user_id ga tegishli — Super Admin bo'lmaydi
  assert.equal((await intruder.get('/api/admin/dashboard')).status, 403);
  assert.equal(db().prepare("SELECT COUNT(*) n FROM user_roles WHERE role = 'super_admin'").get().n, 1);
  db().prepare('DELETE FROM users WHERE id = ?').run(await userIdOf(OWNER));   // tozalash
  db().prepare("UPDATE users SET email = 'x-intruder@example.test' WHERE email = ?").run(OWNER);
  db().prepare("UPDATE users SET email = ? WHERE id = ?").run('owner-old@example.test', ownerId);
});

test('rollar: content_editor moliyaga, marketer foydalanuvchilarga kira olmaydi; o\'zini ko\'tara olmaydi', async () => {
  // yangi Super Admin kontekstini tayyorlash
  db().prepare("DELETE FROM user_roles WHERE role = 'super_admin'").run();
  db().prepare('DELETE FROM users WHERE email IN (?, ?)').run(OWNER, 'owner-old@example.test');
  const owner = await signup(ctx.base, OWNER, { nickname: 'Egasi' });
  const editor = await signup(ctx.base, 'editor@example.test'), marketer = await signup(ctx.base, 'marketer@example.test');
  const eid = await userIdOf('editor@example.test'), mid = await userIdOf('marketer@example.test');
  assert.equal((await owner.post(`/api/admin/users/${eid}/role`, { role: 'content_editor' })).status, 200);
  assert.equal((await owner.post(`/api/admin/users/${mid}/role`, { role: 'marketer' })).status, 200);
  assert.equal((await editor.get('/api/admin/payments')).status, 403);
  assert.equal((await editor.get('/api/admin/users')).status, 403);
  assert.equal((await editor.get('/api/admin/ingredients')).status, 200);
  assert.equal((await marketer.get('/api/admin/users')).status, 403);
  assert.equal((await marketer.get('/api/admin/payments')).status, 403);
  assert.equal((await marketer.get('/api/admin/funnel')).status, 200);
  assert.equal((await marketer.get('/api/admin/ingredients')).status, 403);
  assert.equal((await editor.post(`/api/admin/users/${eid}/role`, { role: 'marketer' })).status, 403);
  assert.equal((await marketer.post(`/api/admin/users/${mid}/role`, { role: 'content_editor' })).status, 403);
  assert.equal((await owner.get('/api/admin/payments')).status, 200);
  const roles = db().prepare('SELECT role FROM user_roles ORDER BY role').all().map((r) => r.role);
  assert.deepEqual(roles, ['content_editor', 'marketer', 'super_admin']);
  assert.equal((await owner.post(`/api/admin/users/${eid}/role`, { role: null })).status, 200);
  assert.equal((await editor.get('/api/admin/ingredients')).status, 403);
});

test('13) manba kodida, seed yoki frontendda parol/token/email qattiq yozilmagan; env jamoat javobida yo\'q', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (['node_modules', 'data', '.git', 'tests'].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  for (const f of walk(root)) {
    if (!/\.(mjs|js|html|css|json|sql|py|md|example)$/.test(f) && !f.endsWith('.env.example')) continue;
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/marjonaxon8989/i.test(t), `haqiqiy admin email manba faylda: ${f}`);
  }
  const anon = new Client(ctx.base);
  for (const p of ['/api/config', '/api/health', '/', '/js/app.js', '/.env']) {
    const r = await anon.get(p);
    assert.ok(!r.text.includes(OWNER), `${p} javobida admin email bor`);
    assert.ok(!/SUPER_ADMIN_EMAIL/.test(r.text.replace(/<[^>]*>/g, '')) || p === '/', p);
  }
});

test('o\'zgarmas audit: rol tayinlashlari yozilgan va maxfiy ma\'lumotsiz', () => {
  const rows = db().prepare("SELECT action, detail_json FROM admin_audit_logs WHERE action IN ('role_assigned','super_admin_bound')").all();
  assert.ok(rows.length >= 3);
  assert.ok(!/password|token|scrypt/i.test(JSON.stringify(rows)));
});

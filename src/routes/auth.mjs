import { route, HttpError, bad, setCookie } from '../http.mjs';
import * as A from '../auth.mjs';
import { db } from '../db.mjs';
import { clampStr, safeJson } from '../util.mjs';
import { decryptJson } from '../crypto.mjs';
import { usageStatus } from '../entitlements.mjs';
import { purgeUserImages } from '../uploads.mjs';
import { audit } from '../audit.mjs';
import { maybeBindSuperAdmin } from '../roles.mjs';

export function publicUser(ctx) {
  const u = ctx.user;
  if (!u) return null;
  return { id: u.id, email: u.email, nickname: u.nickname, email_verified: u.email_verified === 1, status: u.status, role: ctx.role, plan: ctx.plan, ref_code: u.ref_code, created_at: u.created_at };
}
function startSession(ctx, userId) {
  const s = A.createSession(userId);
  setCookie(ctx.res, 'saydan_sid', s.token, { maxAge: ctx.cfg.sessionTtlHours * 3600 });
  return s;
}

route('POST', '/api/auth/register', { limit: { name: 'reg', max: 8, windowMs: 3600000 } }, async (ctx) => {
  const b = await ctx.json();
  const utm = safeJson(ctx.cookies.sutm, {}) || {};
  const r = await A.register({ email: b.email, password: b.password, nickname: b.nickname, source: utm.utm_source || null, ref: utm.ref || null });
  if (!r.ok) throw bad(r.error, { invalid_email: "Email manzil noto'g'ri.", invalid_nickname: "Nik kamida 2 belgidan iborat bo'lishi kerak.", weak_password: r.message }[r.error] || 'Xato');
  if (r.userId) db().prepare("INSERT INTO events(visitor_id, user_id, type, utm_source, utm_medium, utm_campaign, ref) VALUES (?,?,?,?,?,?,?)")
    .run(ctx.cookies.sv || null, r.userId, 'register', utm.utm_source || null, utm.utm_medium || null, utm.utm_campaign || null, utm.ref || null);
  return { ok: true, message: "Agar manzil yangi bo'lsa, tasdiqlash havolasi yuborildi. Emailingizni tekshiring." };
});

route('POST', '/api/auth/verify-email', { limit: { name: 'verify', max: 20, windowMs: 3600000 } }, async (ctx) => {
  const r = await A.verifyEmail((await ctx.json()).token);
  if (!r.ok) throw bad('invalid_token', "Havola yaroqsiz yoki muddati o'tgan.");
  return { ok: true };
});

route('POST', '/api/auth/login', { limit: { name: 'login', max: 15, windowMs: 15 * 60000 } }, async (ctx) => {
  const b = await ctx.json();
  const key = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const { hit } = await import('../ratelimit.mjs');
  const l = hit(`loginmail:${key}`, 8, 15 * 60000);
  if (!l.ok) throw new HttpError(429, 'rate_limited', "Juda ko'p urinish. Birozdan keyin qayta urinib ko'ring.", { retryAfter: l.retryAfter });
  const r = await A.login(b);
  if (!r.ok) throw new HttpError(401, r.error === 'blocked' ? 'blocked' : 'bad_credentials', r.error === 'blocked' ? 'Hisob bloklangan.' : "Email yoki parol noto'g'ri.");
  const s = startSession(ctx, r.user.id);
  ctx.user = r.user;
  maybeBindSuperAdmin(r.user);   // faqat tasdiqlangan email + env mosligi + bog'lanish yo'q bo'lsa
  return { ok: true, csrf: s.csrf };
});

route('POST', '/api/auth/logout', async (ctx) => {
  A.destroySession(ctx.cookies.saydan_sid);
  setCookie(ctx.res, 'saydan_sid', '', { maxAge: 0 });
  return { ok: true };
});

route('POST', '/api/auth/forgot', { limit: { name: 'forgot', max: 5, windowMs: 3600000 } }, async (ctx) => {
  await A.requestPasswordReset((await ctx.json()).email);
  return { ok: true, message: "Agar bu email ro'yxatdan o'tgan bo'lsa, tiklash havolasi yuborildi." };
});
route('POST', '/api/auth/reset', { limit: { name: 'reset', max: 10, windowMs: 3600000 } }, async (ctx) => {
  const b = await ctx.json();
  const r = await A.resetPassword(b.token, b.password);
  if (!r.ok) throw bad(r.error, r.message || "Havola yaroqsiz yoki muddati o'tgan.");
  return { ok: true };
});

route('GET', '/api/me', async (ctx) => {
  if (!ctx.user) return { user: null, csrf: null };
  return { user: publicUser(ctx), csrf: ctx.session.csrf, usage: usageStatus(ctx.user) };
});
route('PATCH', '/api/me', { auth: 'required' }, async (ctx) => {
  const nick = clampStr((await ctx.json()).nickname, 40);
  if (nick.length < 2) throw bad('invalid_nickname', "Nik kamida 2 belgidan iborat bo'lishi kerak.");
  db().prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nick, ctx.user.id);
  return { ok: true };
});
route('POST', '/api/me/email', { auth: 'required', limit: { name: 'emailchg', max: 5, windowMs: 3600000 } }, async (ctx) => {
  const b = await ctx.json();
  const r = await A.requestEmailChange(ctx.user, b.email, b.password);
  if (!r.ok) throw bad(r.error, r.error === 'bad_credentials' ? "Parol noto'g'ri." : "Email manzil noto'g'ri.");
  return { ok: true, message: "Yangi manzilga tasdiqlash havolasi yuborildi. Tasdiqlanmaguncha email o'zgarmaydi." };
});
route('POST', '/api/me/email/confirm', { auth: 'required' }, async (ctx) => {
  const r = await A.confirmEmailChange(ctx.user, (await ctx.json()).token);
  if (!r.ok) throw bad(r.error, "Havola yaroqsiz yoki muddati o'tgan.");
  return { ok: true };
});
route('POST', '/api/me/delete', { auth: 'required', limit: { name: 'delacct', max: 5, windowMs: 3600000 } }, async (ctx) => {
  const b = await ctx.json();
  purgeUserImages(ctx.user.id);
  const r = await A.deleteAccount(ctx.user, b.password);
  if (!r.ok) throw bad(r.error, r.error === 'bad_credentials' ? "Parol noto'g'ri." : "Bu hisobni o'chirib bo'lmaydi.");
  setCookie(ctx.res, 'saydan_sid', '', { maxAge: 0 });
  return { ok: true };
});
route('GET', '/api/me/export', { auth: 'required' }, async (ctx) => {
  const id = ctx.user.id, d = db();
  const prof = d.prepare('SELECT data_enc FROM profiles WHERE user_id = ?').get(id);
  const body = {
    exported_at: new Date().toISOString(),
    user: { email: ctx.user.email, nickname: ctx.user.nickname, created_at: ctx.user.created_at },
    profile: prof ? decryptJson(prof.data_enc) : null,
    analyses: d.prepare('SELECT id, product_name, brand, barcode, input_text, expiry_date, pao_months, created_at, result_json FROM analyses WHERE user_id = ?').all(id).map((a) => ({ ...a, result: safeJson(a.result_json), result_json: undefined })),
    shelf: d.prepare('SELECT * FROM shelf_items WHERE user_id = ?').all(id),
    routines: d.prepare('SELECT * FROM care_routines WHERE user_id = ?').all(id),
    progress: d.prepare('SELECT task_id, date FROM daily_progress WHERE user_id = ?').all(id),
    reviews: d.prepare('SELECT product_id, rating, body, created_at FROM reviews WHERE user_id = ?').all(id),
  };
  audit(id, 'data_export', id);
  return { __raw: true, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="saydan-malumotlarim.json"', 'Cache-Control': 'no-store' }, body: JSON.stringify(body, null, 2) };
});

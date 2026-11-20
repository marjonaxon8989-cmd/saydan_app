import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db, tx } from './db.mjs';
import { cfg } from './config.mjs';
import { uid, nowIso, sha256, randomToken, normalizeEmail, isPlausibleEmail, clampStr } from './util.mjs';
import { sendMail } from './mail.mjs';
import { maybeBindSuperAdmin } from './roles.mjs';
import { audit } from './audit.mjs';

const scrypt = promisify(crypto.scrypt);
const N = 16384, R = 8, P = 1;

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(pw, Buffer.from(salt, 'base64'), 64, { N: +n, r: +r, p: +p });
  const want = Buffer.from(hash, 'base64');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Parol kamida 10 belgidan iborat bo\'lishi kerak.';
  if (pw.length > 200) return 'Parol juda uzun.';
  if (!/[A-Za-zЀ-ӿ]/.test(pw) || !/\d/.test(pw)) return 'Parolda kamida bitta harf va bitta raqam bo\'lishi kerak.';
  return null;
}

function makeRefCode() { return randomToken(5).replace(/[-_]/g, 'x').slice(0, 7).toLowerCase(); }

async function issueEmailToken(userId, purpose, ttlMin, newEmail = null) {
  const token = randomToken(32);
  db().prepare('INSERT INTO email_tokens(token_hash, user_id, purpose, new_email, expires_at) VALUES (?,?,?,?,?)')
    .run(sha256(token), userId, purpose, newEmail, new Date(Date.now() + ttlMin * 60000).toISOString());
  return token;
}

export async function register({ email, password, nickname, source = null, ref = null }) {
  email = normalizeEmail(email);
  nickname = clampStr(nickname, 40);
  if (!isPlausibleEmail(email)) return { ok: false, error: 'invalid_email' };
  if (nickname.length < 2) return { ok: false, error: 'invalid_nickname' };
  const pp = passwordProblem(password);
  if (pp) return { ok: false, error: 'weak_password', message: pp };

  const existing = db().prepare('SELECT id, email_verified FROM users WHERE email = ?').get(email);
  if (existing && existing.email_verified === 1) {
    // Hisob mavjudligini oshkor qilmaymiz (user enumeration oldini olish).
    return { ok: true, generic: true };
  }
  const hash = await hashPassword(password);
  let userId;
  tx((d) => {
    // Tasdiqlanmagan hisob egalik isbotlamagan — email band bo'lib qolmasligi uchun almashtiriladi.
    if (existing) d.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
    userId = uid();
    let referrer = null;
    if (ref) referrer = d.prepare('SELECT id FROM users WHERE ref_code = ?').get(String(ref).slice(0, 20));
    d.prepare('INSERT INTO users(id, email, password_hash, nickname, reg_source, ref_code, referred_by) VALUES (?,?,?,?,?,?,?)')
      .run(userId, email, hash, nickname, source ? clampStr(source, 60) : (ref ? 'referral' : 'direct'), makeRefCode(), referrer?.id ?? null);
    if (referrer) d.prepare('INSERT OR IGNORE INTO referral_tracking(referrer_id, referred_id) VALUES (?,?)').run(referrer.id, userId);
  });
  const token = await issueEmailToken(userId, 'verify', 60 * 24);
  await sendMail({ to: email, subject: 'SAYDAN: emailni tasdiqlang', text: 'Emailni tasdiqlash uchun havolani oching.', link: `${cfg().publicUrl}/#/verify?token=${token}` });
  return { ok: true, userId };
}

export async function consumeToken(token, purpose) {
  const row = db().prepare('SELECT * FROM email_tokens WHERE token_hash = ?').get(sha256(String(token || '')));
  if (!row || row.purpose !== purpose || row.used_at || row.expires_at < nowIso()) return null;
  const r = db().prepare('UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(nowIso(), row.token_hash);
  return r.changes === 1 ? row : null;
}

export async function verifyEmail(token) {
  const row = await consumeToken(token, 'verify');
  if (!row) return { ok: false, error: 'invalid_token' };
  db().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);
  const user = db().prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  const isAdmin = maybeBindSuperAdmin(user);
  return { ok: true, userId: user.id, superAdminBound: isAdmin };
}

export async function login({ email, password }) {
  email = normalizeEmail(email);
  const user = db().prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Vaqt farqi bilan foydalanuvchi mavjudligini bilib bo'lmasligi uchun doim hash tekshiriladi.
  const ok = await verifyPassword(String(password ?? ''), user?.password_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
  if (!user || !ok) return { ok: false, error: 'bad_credentials' };
  if (user.status === 'blocked') return { ok: false, error: 'blocked' };
  return { ok: true, user };
}

export function createSession(userId) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const exp = new Date(Date.now() + cfg().sessionTtlHours * 3600000).toISOString();
  db().prepare('INSERT INTO sessions(id_hash, user_id, csrf, created_at, expires_at) VALUES (?,?,?,?,?)').run(sha256(token), userId, csrf, nowIso(), exp);
  return { token, csrf, expires: exp };
}
export function getSession(token) {
  if (!token) return null;
  const s = db().prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha256(token));
  if (!s) return null;
  if (s.expires_at < nowIso()) { db().prepare('DELETE FROM sessions WHERE id_hash = ?').run(s.id_hash); return null; }
  const user = db().prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!user || user.status === 'blocked') return null;
  return { session: s, user };
}
export function destroySession(token) {
  if (token) db().prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(token));
}
export function destroyAllSessions(userId) {
  db().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export async function requestPasswordReset(email) {
  email = normalizeEmail(email);
  const user = db().prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (user) {
    const token = await issueEmailToken(user.id, 'reset', 30);
    await sendMail({ to: email, subject: 'SAYDAN: parolni tiklash', text: 'Parolni tiklash uchun havolani oching.', link: `${cfg().publicUrl}/#/reset?token=${token}` });
  }
  return { ok: true }; // har doim bir xil javob
}
export async function resetPassword(token, newPassword) {
  const pp = passwordProblem(newPassword);
  if (pp) return { ok: false, error: 'weak_password', message: pp };
  const row = await consumeToken(token, 'reset');
  if (!row) return { ok: false, error: 'invalid_token' };
  db().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(newPassword), row.user_id);
  destroyAllSessions(row.user_id);
  return { ok: true };
}

// Email almashtirish: yangi manzilga yuborilgan tokenni tasdiqlamaguncha hech narsa o'zgarmaydi.
export async function requestEmailChange(user, newEmail, password) {
  newEmail = normalizeEmail(newEmail);
  if (!isPlausibleEmail(newEmail)) return { ok: false, error: 'invalid_email' };
  if (!(await verifyPassword(String(password ?? ''), user.password_hash))) return { ok: false, error: 'bad_credentials' };
  if (db().prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(newEmail, user.id)) return { ok: true, generic: true };
  const token = await issueEmailToken(user.id, 'change_email', 60, newEmail);
  await sendMail({ to: newEmail, subject: 'SAYDAN: yangi emailni tasdiqlang', text: 'Tasdiqlash havolasi.', link: `${cfg().publicUrl}/#/verify-email-change?token=${token}` });
  return { ok: true };
}
export async function confirmEmailChange(user, token) {
  const row = await consumeToken(token, 'change_email');
  if (!row || row.user_id !== user.id) return { ok: false, error: 'invalid_token' };
  try { db().prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?').run(row.new_email, user.id); }
  catch { return { ok: false, error: 'email_taken' }; }
  const fresh = db().prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  maybeBindSuperAdmin(fresh);  // faqat tasdiqlangan egalikdan keyin va faqat bog'lanish hali yo'q bo'lsa
  audit(user.id, 'email_changed', user.id);
  return { ok: true };
}

export async function deleteAccount(user, password) {
  if (!(await verifyPassword(String(password ?? ''), user.password_hash))) return { ok: false, error: 'bad_credentials' };
  const role = db().prepare('SELECT role FROM user_roles WHERE user_id = ?').get(user.id);
  if (role?.role === 'super_admin') return { ok: false, error: 'super_admin_cannot_self_delete' };
  // yuklangan rasm fayllari alohida tozalanadi (uploads.purgeUserImages)
  db().prepare('DELETE FROM users WHERE id = ?').run(user.id);
  audit(null, 'account_deleted', null, { hadRole: role?.role ?? null });
  return { ok: true };
}

import fs from 'node:fs';
import path from 'node:path';
import { route, HttpError, bad } from '../http.mjs';
import { db } from '../db.mjs';
import { cfg } from '../config.mjs';
import { clampStr } from '../util.mjs';
import { validBarcode } from '../barcode/index.mjs';

function profanityList() {
  const base = ['fuck', 'shit', 'bitch'];   // boshlang'ich ro'yxat; Uzbek/Rus so'zlarni data/profanity.txt ga qo'shing
  try { return base.concat(fs.readFileSync(path.join(cfg().dataDir, 'profanity.txt'), 'utf8').split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean)); } catch { return base; }
}
export function contentProblem(text, userId, table) {
  const t = String(text).toLowerCase();
  if (profanityList().some((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(t))) return "Matnda nomaqbul so'zlar bor. Iltimos, tahrirlang.";
  if ((t.match(/https?:\/\/|www\./g) || []).length > 1) return "Matnda bittadan ortiq havola bo'lishi mumkin emas (spamdan himoya).";
  if (/(.)\1{9,}/.test(t)) return "Matn spamga o'xshaydi.";
  if (db().prepare(`SELECT 1 FROM ${table} WHERE user_id = ? AND lower(body) = ? LIMIT 1`).get(userId, t.trim())) return "Bu matn allaqachon yuborilgan.";
  return null;
}
function mayPost(user) {
  if (!user.email_verified) throw new HttpError(403, 'email_unverified', "Sharh yozish uchun emailingizni tasdiqlang.");
  if (user.status !== 'active') throw new HttpError(403, 'restricted', `Hisobingizga cheklov qo'yilgan${user.status_reason ? ': ' + user.status_reason : ''}.`);
}

route('GET', '/api/products', async (ctx) => {
  const q = clampStr(ctx.query.q, 60).toLowerCase();
  const rows = db().prepare(`SELECT p.id, p.name, p.brand, p.is_demo, (SELECT ROUND(AVG(rating),1) FROM reviews r WHERE r.product_id = p.id AND r.status='visible') AS avg_rating,
    (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.status='visible') AS review_count FROM products p ORDER BY review_count DESC, p.name COLLATE NOCASE LIMIT 200`).all();
  return { items: q ? rows.filter((r) => `${r.name} ${r.brand ?? ''}`.toLowerCase().includes(q)) : rows };
});
route('POST', '/api/products', { auth: 'required', limit: { name: 'newproduct', max: 10, windowMs: 3600000 } }, async (ctx) => {
  mayPost(ctx.user);
  const b = await ctx.json();
  const name = clampStr(b.name, 120), brand = clampStr(b.brand, 80) || null;
  if (name.length < 2) throw bad('invalid_name', "Mahsulot nomi kamida 2 belgi bo'lsin.");
  const barcode = b.barcode ? String(b.barcode).replace(/\s/g, '') : null;
  if (barcode && !validBarcode(barcode)) throw bad('invalid_barcode', "Barcode noto'g'ri.");
  const ex = db().prepare("SELECT id FROM products WHERE lower(name) = lower(?) AND lower(coalesce(brand,'')) = lower(?)").get(name, brand || '');
  if (ex) return { ok: true, id: ex.id, existing: true };
  try { return { ok: true, id: Number(db().prepare('INSERT INTO products(name, brand, barcode, created_by) VALUES (?,?,?,?)').run(name, brand, barcode, ctx.user.id).lastInsertRowid) }; }
  catch { throw bad('duplicate_barcode', 'Bu barcode bilan mahsulot mavjud.'); }
});
route('GET', '/api/products/:id', { }, async (ctx) => {
  const p = db().prepare("SELECT id, name, brand, barcode, is_demo, price_uzs, price_source FROM products WHERE id = ?").get(ctx.params.id);
  if (!p) throw new HttpError(404, 'not_found', 'Mahsulot topilmadi.');
  const s = db().prepare("SELECT ROUND(AVG(rating),1) avg, COUNT(*) n FROM reviews WHERE product_id = ? AND status = 'visible'").get(p.id);
  const mine = ctx.user ? db().prepare('SELECT id, rating, body FROM reviews WHERE product_id = ? AND user_id = ?').get(p.id, ctx.user.id) : null;
  return { ...p, avg_rating: s.avg, review_count: s.n, my_review: mine };
});
const SORTS = { recent: 'r.created_at DESC', helpful: 'helpful DESC, r.created_at DESC', rating_high: 'r.rating DESC, r.created_at DESC', rating_low: 'r.rating ASC, r.created_at DESC' };
route('GET', '/api/products/:id/reviews', async (ctx) => {
  const order = SORTS[ctx.query.sort] || SORTS.recent;
  const rows = db().prepare(`SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, u.nickname, r.user_id,
    (SELECT COUNT(*) FROM review_helpful h WHERE h.review_id = r.id) AS helpful,
    (SELECT COUNT(*) FROM review_comments c WHERE c.review_id = r.id AND c.status = 'visible') AS comments FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.product_id = ? AND r.status = 'visible' ORDER BY ${order} LIMIT 100`).all(ctx.params.id);
  const voted = ctx.user ? new Set(db().prepare('SELECT review_id FROM review_helpful WHERE user_id = ?').all(ctx.user.id).map((x) => x.review_id)) : new Set();
  return { items: rows.map(({ user_id, ...r }) => ({ ...r, mine: ctx.user?.id === user_id, voted: voted.has(r.id) })) };
});
route('POST', '/api/products/:id/reviews', { auth: 'required', limit: { name: 'review', max: 8, windowMs: 3600000 } }, async (ctx) => {
  mayPost(ctx.user);
  const p = db().prepare('SELECT id FROM products WHERE id = ?').get(ctx.params.id);
  if (!p) throw new HttpError(404, 'not_found', 'Mahsulot topilmadi.');
  const b = await ctx.json();
  const rating = parseInt(b.rating, 10), body = clampStr(b.body, 2000);
  if (!(rating >= 1 && rating <= 5)) throw bad('invalid_rating', "Baho 1 dan 5 gacha bo'lsin.");
  if (body.length < 10) throw bad('too_short', "Sharh kamida 10 belgidan iborat bo'lsin.");
  const existing = db().prepare('SELECT id, body FROM reviews WHERE product_id = ? AND user_id = ?').get(p.id, ctx.user.id);
  if (!existing || existing.body.toLowerCase() !== body.toLowerCase()) { const prob = contentProblem(body, ctx.user.id, 'reviews'); if (prob && !(existing && /allaqachon/.test(prob))) throw bad('content_rejected', prob); }
  if (existing) { db().prepare("UPDATE reviews SET rating = ?, body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(rating, body, existing.id); return { ok: true, id: existing.id, updated: true }; }
  return { ok: true, id: Number(db().prepare('INSERT INTO reviews(product_id, user_id, rating, body) VALUES (?,?,?,?)').run(p.id, ctx.user.id, rating, body).lastInsertRowid) };
});
route('DELETE', '/api/reviews/:id', { auth: 'required' }, async (ctx) => {
  const r = db().prepare('SELECT id FROM reviews WHERE id = ? AND user_id = ?').get(ctx.params.id, ctx.user.id);
  if (!r) throw new HttpError(404, 'not_found', 'Sharh topilmadi.');
  db().prepare('DELETE FROM reviews WHERE id = ?').run(r.id);
  return { ok: true };
});
route('POST', '/api/reviews/:id/helpful', { auth: 'required', limit: { name: 'helpful', max: 60, windowMs: 3600000 } }, async (ctx) => {
  const r = db().prepare("SELECT id, user_id FROM reviews WHERE id = ? AND status = 'visible'").get(ctx.params.id);
  if (!r) throw new HttpError(404, 'not_found', 'Sharh topilmadi.');
  if (r.user_id === ctx.user.id) throw bad('own_review', "O'z sharhingizga ovoz bera olmaysiz.");
  if (ctx.user.status !== 'active') throw new HttpError(403, 'restricted', 'Hisobingizga cheklov qo\'yilgan.');
  const had = db().prepare('DELETE FROM review_helpful WHERE review_id = ? AND user_id = ?').run(r.id, ctx.user.id).changes;
  if (!had) db().prepare('INSERT INTO review_helpful(review_id, user_id) VALUES (?,?)').run(r.id, ctx.user.id);
  return { ok: true, voted: !had, helpful: db().prepare('SELECT COUNT(*) n FROM review_helpful WHERE review_id = ?').get(r.id).n };
});
route('GET', '/api/reviews/:id/comments', async (ctx) => ({
  items: db().prepare("SELECT c.id, c.body, c.created_at, u.nickname FROM review_comments c JOIN users u ON u.id = c.user_id WHERE c.review_id = ? AND c.status = 'visible' ORDER BY c.id").all(ctx.params.id),
}));
route('POST', '/api/reviews/:id/comments', { auth: 'required', limit: { name: 'comment', max: 20, windowMs: 3600000 } }, async (ctx) => {
  mayPost(ctx.user);
  if (!db().prepare("SELECT 1 FROM reviews WHERE id = ? AND status = 'visible'").get(ctx.params.id)) throw new HttpError(404, 'not_found', 'Sharh topilmadi.');
  const body = clampStr((await ctx.json()).body, 500);
  if (body.length < 2) throw bad('too_short', 'Izoh juda qisqa.');
  const prob = contentProblem(body, ctx.user.id, 'review_comments');
  if (prob) throw bad('content_rejected', prob);
  return { ok: true, id: Number(db().prepare('INSERT INTO review_comments(review_id, user_id, body) VALUES (?,?,?)').run(ctx.params.id, ctx.user.id, body).lastInsertRowid) };
});
route('POST', '/api/reports', { auth: 'required', limit: { name: 'report', max: 20, windowMs: 3600000 } }, async (ctx) => {
  const b = await ctx.json();
  const type = b.type === 'comment' ? 'comment' : b.type === 'review' ? 'review' : null;
  if (!type) throw bad('invalid_type', "Shikoyat turi noto'g'ri.");
  const exists = db().prepare(type === 'review' ? 'SELECT 1 FROM reviews WHERE id = ?' : 'SELECT 1 FROM review_comments WHERE id = ?').get(b.id);
  if (!exists) throw new HttpError(404, 'not_found', 'Topilmadi.');
  const reason = clampStr(b.reason, 500);
  if (reason.length < 5) throw bad('reason_required', 'Sababni qisqacha yozing.');
  try { db().prepare('INSERT INTO reports(target_type, target_id, reporter_id, reason) VALUES (?,?,?,?)').run(type, b.id, ctx.user.id, reason); }
  catch { throw bad('duplicate', 'Siz bu kontent haqida allaqachon shikoyat qilgansiz.'); }
  return { ok: true };
});

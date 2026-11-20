import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { route, HttpError, bad } from '../http.mjs';
import { db, tx } from '../db.mjs';
import { cfg } from '../config.mjs';
import { clampStr, normInci, inciVariants, safeJson, isoDateOnly } from '../util.mjs';
import { audit } from '../audit.mjs';
import { getRole, assignRole, can } from '../roles.mjs';
import { planOf } from '../entitlements.mjs';
import { importXlsxFile } from '../importer.mjs';
import { ocrStatus } from '../ocr/index.mjs';
import { status as barcodeStatus } from '../barcode/index.mjs';
import { providerStatus } from '../payments/index.mjs';
import { mailStatus } from '../mail.mjs';
import { startedAt } from '../runtime.mjs';

const one = (sql, ...p) => db().prepare(sql).get(...p);
const all = (sql, ...p) => db().prepare(sql).all(...p);
const A = { auth: 'required' };
const needPerm = (perm) => ({ auth: 'required', perm });

route('GET', '/api/admin/me', needPerm('admin.access'), async (ctx) => ({ role: ctx.role, permissions: ['ingredients.write', 'ingredients.approve', 'community.moderate', 'users.read', 'users.moderate', 'roles.manage', 'finance.read', 'marketing.write', 'marketing.read', 'system.read', 'audit.read', 'import.run'].filter((p) => can(ctx.user, p)) }));

// ---------- Dashboard (hammasi bazadan hisoblanadi) ----------
route('GET', '/api/admin/dashboard', needPerm('admin.access'), async (ctx) => {
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString(), d7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const now = new Date().toISOString();
  const out = {
    generated_at: now, source: 'database',
    users: { total: one('SELECT COUNT(*) n FROM users').n, verified: one('SELECT COUNT(*) n FROM users WHERE email_verified = 1').n, new_7d: one('SELECT COUNT(*) n FROM users WHERE created_at >= ?', d7).n, new_30d: one('SELECT COUNT(*) n FROM users WHERE created_at >= ?', d30).n },
    subscriptions: {
      production_active: one("SELECT COUNT(DISTINCT user_id) n FROM subscriptions WHERE source = 'production' AND status IN ('active','canceled') AND period_end > ?", now).n,
      demo_or_sandbox_active: one("SELECT COUNT(DISTINCT user_id) n FROM subscriptions WHERE source != 'production' AND status IN ('active','canceled') AND period_end > ?", now).n,
      note: "Demo/sandbox obunalar haqiqiy obunalardan alohida sanaladi.",
    },
    analyses: { performed_total: one('SELECT COUNT(*) n FROM analysis_usage').n, performed_30d: one('SELECT COUNT(*) n FROM analysis_usage WHERE at >= ?', d30).n, saved_total: one('SELECT COUNT(*) n FROM analyses').n },
    registrations_by_day: all("SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY day ORDER BY day", new Date(Date.now() - 14 * 86400000).toISOString()),
    top_products: all("SELECT COALESCE(product_name, '(nomsiz)') AS name, brand, COUNT(*) AS n FROM analyses GROUP BY lower(COALESCE(product_name,'')), lower(COALESCE(brand,'')) ORDER BY n DESC LIMIT 10"),
    top_products_note: "Faqat foydalanuvchilar saqlagan tahlillar asosida.",
    community: { reviews: one("SELECT COUNT(*) n FROM reviews WHERE status = 'visible'").n, open_reports: one("SELECT COUNT(*) n FROM reports WHERE status = 'open'").n },
    ingredients: { total: one('SELECT COUNT(*) n FROM ingredients WHERE is_demo = 0').n, demo: one('SELECT COUNT(*) n FROM ingredients WHERE is_demo = 1').n,
      by_status: all('SELECT status, COUNT(*) n FROM ingredients GROUP BY status') },
  };
  if (can(ctx.user, 'finance.read')) out.revenue = { real_uzs: one("SELECT COALESCE(SUM(amount_uzs),0) n FROM payments WHERE simulated = 0 AND status = 'paid'").n, simulated_uzs: one("SELECT COALESCE(SUM(amount_uzs),0) n FROM payments WHERE simulated = 1 AND status = 'paid'").n, note: "Simulyatsiya qilingan summa haqiqiy daromadga qo'shilmaydi." };
  return out;
});

// ---------- Foydalanuvchilar ----------
route('GET', '/api/admin/users', needPerm('users.read'), async (ctx) => {
  const q = clampStr(ctx.query.q, 60).toLowerCase(), page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
  const where = q ? 'WHERE lower(email) LIKE ? OR lower(nickname) LIKE ?' : '', p = q ? [`%${q}%`, `%${q}%`] : [];
  const rows = all(`SELECT id, email, nickname, status, status_reason, email_verified, created_at, reg_source FROM users ${where} ORDER BY created_at DESC LIMIT 50 OFFSET ?`, ...p, (page - 1) * 50);
  return { total: one(`SELECT COUNT(*) n FROM users ${where}`, ...p).n, items: rows.map((u) => ({ ...u, email_verified: u.email_verified === 1, role: getRole({ ...one('SELECT * FROM users WHERE id = ?', u.id) }), plan: planOf(u) })) };
});
route('POST', '/api/admin/users/:id/status', needPerm('users.moderate'), async (ctx) => {
  const b = await ctx.json();
  if (!['active', 'restricted', 'blocked'].includes(b.status)) throw bad('invalid_status', "Holat noto'g'ri.");
  const target = one('SELECT * FROM users WHERE id = ?', ctx.params.id);
  if (!target) throw new HttpError(404, 'not_found', 'Topilmadi.');
  if (one('SELECT 1 FROM user_roles WHERE user_id = ? AND role = ?', target.id, 'super_admin')) throw new HttpError(403, 'forbidden', "Super Adminni cheklab bo'lmaydi.");
  db().prepare('UPDATE users SET status = ?, status_reason = ? WHERE id = ?').run(b.status, clampStr(b.reason, 200) || null, target.id);
  if (b.status === 'blocked') db().prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  audit(ctx.user.id, 'user_status_changed', target.id, { status: b.status, reason: b.reason });
  return { ok: true };
});
route('POST', '/api/admin/users/:id/role', needPerm('roles.manage'), async (ctx) => {
  const b = await ctx.json();
  const r = assignRole(ctx.user, ctx.params.id, b.role ?? null);
  if (!r.ok) throw new HttpError(r.error === 'not_found' ? 404 : 403, r.error, { role_not_assignable: "Bu rolni berib bo'lmaydi.", cannot_modify_super_admin: "Super Admin rolini o'zgartirib bo'lmaydi." }[r.error] || 'Ruxsat yo\'q.');
  return { ok: true };
});

// ---------- Ingredientlar ----------
const ING_FIELDS = ['inci', 'uz_name', 'synonyms', 'cas', 'cosing_functions', 'function_uz', 'description_uz', 'pubchem_en', 'detailed_explanation', 'safety_general', 'pregnancy_info', 'oily_info', 'dry_info', 'sensitive_info', 'eu_restrictions', 'eu_allergen', 'sccs', 'cir', 'source_urls', 'pharmacist_comment'];
const STATUSES = ['draft', 'needs_source', 'under_review', 'approved', 'archived', 'insufficient_evidence'];
function rebuildAliases(d, id, ing) {
  d.prepare('DELETE FROM ingredient_aliases WHERE ingredient_id = ?').run(id);
  const add = (n, k) => { if (n) d.prepare('INSERT OR IGNORE INTO ingredient_aliases(ingredient_id, alias_norm, kind) VALUES (?,?,?)').run(id, n, k); };
  inciVariants(ing.inci).forEach((v) => add(v, 'inci'));
  if (ing.uz_name) inciVariants(ing.uz_name).forEach((v) => add(v, 'uz'));
  for (const s of String(ing.synonyms || '').split(/[,;\n|]+/)) inciVariants(s).forEach((v) => add(v, 'synonym'));
  for (const c of String(ing.cas || '').split(/[,;\s]+/)) if (/^\d{2,7}-\d{2}-\d$/.test(c)) add(c, 'cas');
}
const history = (id, actor, type, before, after) => db().prepare('INSERT INTO ingredient_history(ingredient_id, changed_by, change_type, before_json, after_json) VALUES (?,?,?,?,?)').run(id, actor, type, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);

route('GET', '/api/admin/ingredients', needPerm('ingredients.write'), async (ctx) => {
  const q = clampStr(ctx.query.q, 60).toLowerCase(), st = STATUSES.includes(ctx.query.status) ? ctx.query.status : null, page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
  const w = [], p = [];
  if (q) { w.push("(lower(inci) LIKE ? OR lower(coalesce(uz_name,'')) LIKE ?)"); p.push(`%${q}%`, `%${q}%`); }
  if (st) { w.push('status = ?'); p.push(st); }
  const W = w.length ? 'WHERE ' + w.join(' AND ') : '';
  return { total: one(`SELECT COUNT(*) n FROM ingredients ${W}`, ...p).n, items: all(`SELECT id, inci, uz_name, status, pharmacist_approved, is_demo, updated_at FROM ingredients ${W} ORDER BY inci COLLATE NOCASE LIMIT 50 OFFSET ?`, ...p, (page - 1) * 50) };
});
route('GET', '/api/admin/ingredients/:id', needPerm('ingredients.write'), async (ctx) => {
  const r = one('SELECT * FROM ingredients WHERE id = ?', ctx.params.id);
  if (!r) throw new HttpError(404, 'not_found', 'Topilmadi.');
  delete r.raw_json;
  return { ...r, assessments: all('SELECT * FROM ingredient_assessments WHERE ingredient_id = ?', r.id) };
});
function pickIng(b) { const o = {}; for (const f of ING_FIELDS) o[f] = b[f] == null ? null : clampStr(b[f], f === 'inci' ? 160 : 8000) || null; return o; }
route('POST', '/api/admin/ingredients', needPerm('ingredients.write'), async (ctx) => {
  const v = pickIng(await ctx.json());
  if (!v.inci) throw bad('inci_required', 'INCI nomi majburiy.');
  const key = normInci(v.inci);
  if (one('SELECT 1 FROM ingredients WHERE key = ?', key)) throw bad('duplicate', 'Bunday INCI nomi bilan ingredient mavjud.');
  const id = tx((d) => {
    const cols = ['key', 'inci_norm', 'status', ...ING_FIELDS];
    const r = d.prepare(`INSERT INTO ingredients(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(key, key, 'draft', ...ING_FIELDS.map((f) => v[f]));
    const nid = Number(r.lastInsertRowid);
    rebuildAliases(d, nid, v);
    history(nid, ctx.user.id, 'create', null, v);
    return nid;
  });
  audit(ctx.user.id, 'ingredient_created', id, { inci: v.inci });
  return { ok: true, id };
});
route('PUT', '/api/admin/ingredients/:id', needPerm('ingredients.write'), async (ctx) => {
  const cur = one('SELECT * FROM ingredients WHERE id = ?', ctx.params.id);
  if (!cur) throw new HttpError(404, 'not_found', 'Topilmadi.');
  const b = await ctx.json();
  const v = pickIng({ ...cur, ...b });
  if (!v.inci) throw bad('inci_required', 'INCI nomi majburiy.');
  const key = normInci(v.inci);
  if (key !== cur.key && one('SELECT 1 FROM ingredients WHERE key = ? AND id != ?', key, cur.id)) throw bad('duplicate', 'Bunday INCI nomi bilan ingredient mavjud.');
  const before = Object.fromEntries(ING_FIELDS.filter((f) => cur[f] !== v[f]).map((f) => [f, cur[f]]));
  const after = Object.fromEntries(Object.keys(before).map((f) => [f, v[f]]));
  tx((d) => {
    d.prepare(`UPDATE ingredients SET key = ?, inci_norm = ?, ${ING_FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(key, key, ...ING_FIELDS.map((f) => v[f]), cur.id);
    // Tasdiqlangan yozuv tahrirlansa, qayta ko'rib chiqishga qaytadi
    if (cur.status === 'approved' && Object.keys(before).length) d.prepare("UPDATE ingredients SET status = 'under_review', approved_by = NULL, approved_at = NULL WHERE id = ?").run(cur.id);
    rebuildAliases(d, cur.id, v);
    if (Object.keys(before).length) history(cur.id, ctx.user.id, 'edit', before, after);
  });
  audit(ctx.user.id, 'ingredient_edited', cur.id, { fields: Object.keys(before) });
  return { ok: true, changed: Object.keys(before) };
});
route('POST', '/api/admin/ingredients/:id/status', needPerm('ingredients.write'), async (ctx) => {
  const b = await ctx.json();
  if (!STATUSES.includes(b.status)) throw bad('invalid_status', "Holat noto'g'ri.");
  if (b.status === 'approved' && !can(ctx.user, 'ingredients.approve')) throw new HttpError(403, 'forbidden', "Ingredientni faqat vakolatli tekshiruvchi tasdiqlashi mumkin.");
  const cur = one('SELECT * FROM ingredients WHERE id = ?', ctx.params.id);
  if (!cur) throw new HttpError(404, 'not_found', 'Topilmadi.');
  if (cur.is_demo && b.status === 'approved') throw bad('demo_not_approvable', "Demo yozuvni tasdiqlab bo'lmaydi.");
  db().prepare('UPDATE ingredients SET status = ?, approved_by = ?, approved_at = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?')
    .run(b.status, b.status === 'approved' ? ctx.user.id : null, b.status === 'approved' ? new Date().toISOString() : null, cur.id);
  history(cur.id, ctx.user.id, 'status', { status: cur.status }, { status: b.status, note: clampStr(b.note, 300) || null });
  audit(ctx.user.id, 'ingredient_status', cur.id, { from: cur.status, to: b.status });
  return { ok: true };
});
route('GET', '/api/admin/ingredients/:id/history', needPerm('ingredients.write'), async (ctx) => ({
  items: all('SELECT h.id, h.change_type, h.before_json, h.after_json, h.at, u.nickname AS by FROM ingredient_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.ingredient_id = ? ORDER BY h.id DESC LIMIT 200', ctx.params.id)
    .map((h) => ({ ...h, before: safeJson(h.before_json), after: safeJson(h.after_json), before_json: undefined, after_json: undefined })),
}));
route('PUT', '/api/admin/ingredients/:id/assessments', needPerm('ingredients.write'), async (ctx) => {
  const b = await ctx.json();
  if (!['climate', 'pregnancy', 'dry', 'oily', 'sensitive'].includes(b.dimension)) throw bad('invalid_dimension', "Yo'nalish noto'g'ri.");
  if (!['favorable', 'neutral', 'caution'].includes(b.stance)) throw bad('invalid_stance', "Baho turi noto'g'ri.");
  if (!['high', 'moderate', 'low'].includes(b.evidence_level)) throw bad('invalid_evidence', "Dalil darajasi noto'g'ri.");
  const note = clampStr(b.note, 1000) || null, src = clampStr(b.source_ref, 500) || null;
  const wantApproved = b.approved === true;
  if (wantApproved && !can(ctx.user, 'ingredients.approve')) throw new HttpError(403, 'forbidden', 'Bahoni faqat vakolatli tekshiruvchi tasdiqlashi mumkin.');
  if (wantApproved && !/^https?:\/\//.test(src || '')) throw bad('source_required', "Tasdiqlash uchun manba havolasi (URL) majburiy.");
  const ing = one('SELECT id, is_demo FROM ingredients WHERE id = ?', ctx.params.id);
  if (!ing) throw new HttpError(404, 'not_found', 'Topilmadi.');
  if (ing.is_demo && wantApproved) throw bad('demo_not_approvable', "Demo yozuv bahosini tasdiqlab bo'lmaydi.");
  const before = one('SELECT * FROM ingredient_assessments WHERE ingredient_id = ? AND dimension = ?', ing.id, b.dimension);
  db().prepare(`INSERT INTO ingredient_assessments(ingredient_id, dimension, stance, evidence_level, note, source_ref, approved, approved_by) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(ingredient_id, dimension) DO UPDATE SET stance=excluded.stance, evidence_level=excluded.evidence_level, note=excluded.note, source_ref=excluded.source_ref, approved=excluded.approved, approved_by=excluded.approved_by, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .run(ing.id, b.dimension, b.stance, b.evidence_level, note, src, wantApproved ? 1 : 0, wantApproved ? ctx.user.id : null);
  history(ing.id, ctx.user.id, 'assessment', before, { dimension: b.dimension, stance: b.stance, evidence_level: b.evidence_level, approved: wantApproved });
  audit(ctx.user.id, 'assessment_set', ing.id, { dimension: b.dimension, approved: wantApproved });
  return { ok: true };
});
route('DELETE', '/api/admin/ingredients/:id/assessments/:dim', needPerm('ingredients.write'), async (ctx) => { db().prepare('DELETE FROM ingredient_assessments WHERE ingredient_id = ? AND dimension = ?').run(ctx.params.id, ctx.params.dim); audit(ctx.user.id, 'assessment_deleted', ctx.params.id, { dimension: ctx.params.dim }); return { ok: true }; });

// ---------- Import ----------
route('POST', '/api/admin/import', { auth: 'required', perm: 'import.run', maxBody: 25 * 1024 * 1024 }, async (ctx) => {
  const buf = await ctx.raw(25 * 1024 * 1024);
  if (buf.length < 100 || buf.slice(0, 2).toString() !== 'PK') throw bad('not_xlsx', "Bu .xlsx fayl emas.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saydan-up-'));
  const f = path.join(dir, 'upload.xlsx');
  fs.writeFileSync(f, buf);
  try { return { report: importXlsxFile(f, { actor: ctx.user.id, fileName: clampStr(ctx.query.name, 80) || 'upload.xlsx' }) }; }
  catch (e) { throw new HttpError(422, 'import_failed', clampStr(e.message, 300)); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
route('GET', '/api/admin/import/runs', needPerm('import.run'), async () => ({ items: all('SELECT id, at, file_name, ok, report_json FROM import_runs ORDER BY id DESC LIMIT 20').map((r) => ({ ...r, ok: r.ok === 1, report: safeJson(r.report_json), report_json: undefined })) }));

// ---------- Muqobil / to'qnashuv ----------
route('GET', '/api/admin/conflicts', needPerm('ingredients.write'), async () => ({ items: all('SELECT id, ingredient_a, ingredient_b, interaction_type, description, sources, review_status, a_ingredient_id, b_ingredient_id FROM conflicts ORDER BY id') }));
route('POST', '/api/admin/conflicts', needPerm('ingredients.write'), async (ctx) => {
  const b = await ctx.json();
  const a = clampStr(b.ingredient_a, 160), c = clampStr(b.ingredient_b, 160);
  if (!a || !c || normInci(a) === normInci(c)) throw bad('invalid_pair', "Ikki xil ingredient nomi kerak.");
  const type = clampStr(b.interaction_type, 60) || null;
  const idOf = (s) => { const ids = [...new Set(all("SELECT ingredient_id FROM ingredient_aliases WHERE alias_norm = ? AND kind = 'inci'", normInci(s)).map((x) => x.ingredient_id))]; return ids.length === 1 ? ids[0] : null; };
  const key = [normInci(a), normInci(c)].sort().join('|') + '|' + normInci(type || '');
  try { db().prepare("INSERT INTO conflicts(key, ingredient_a, ingredient_b, interaction_type, description, sources, review_status, a_ingredient_id, b_ingredient_id) VALUES (?,?,?,?,?,?, 'Qoralama — tekshiruv kerak', ?, ?)").run(key, a, c, type, clampStr(b.description, 2000) || null, clampStr(b.sources, 1000) || null, idOf(a), idOf(c)); }
  catch { throw bad('duplicate', 'Bu juftlik allaqachon mavjud.'); }
  audit(ctx.user.id, 'conflict_created', key);
  return { ok: true };
});
route('DELETE', '/api/admin/conflicts/:id', needPerm('ingredients.write'), async (ctx) => { db().prepare('DELETE FROM conflicts WHERE id = ?').run(ctx.params.id); audit(ctx.user.id, 'conflict_deleted', ctx.params.id); return { ok: true }; });
route('GET', '/api/admin/alternatives', needPerm('ingredients.write'), async (ctx) => ({ items: all('SELECT id, main_inci, alt_inci, similarity, review_status, main_ingredient_id, alt_ingredient_id FROM alternatives ORDER BY main_inci LIMIT 500') }));

// ---------- Mahsulotlar / manbalar ----------
route('GET', '/api/admin/products', needPerm('ingredients.write'), async () => ({ items: all('SELECT id, name, brand, barcode, price_uzs, price_source, is_demo, created_at FROM products ORDER BY id DESC LIMIT 300') }));
function prodBody(b) {
  const name = clampStr(b.name, 120); if (name.length < 2) throw bad('invalid_name', 'Nom kamida 2 belgi.');
  const barcode = b.barcode ? String(b.barcode).replace(/\s/g, '') : null;
  const price = b.price_uzs == null || b.price_uzs === '' ? null : parseInt(b.price_uzs, 10);
  if (price != null && !(price > 0)) throw bad('invalid_price', "Narx musbat son bo'lsin.");
  const ps = clampStr(b.price_source, 200) || null;
  if (price != null && !ps) throw bad('price_source_required', "Narx uchun manba (qayerdan olingan) majburiy — narx uydirilmaydi.");
  return { name, brand: clampStr(b.brand, 80) || null, barcode, ingredients_text: clampStr(b.ingredients_text, 4000) || null, price_uzs: price, price_source: price != null ? ps : null };
}
route('POST', '/api/admin/products', needPerm('ingredients.write'), async (ctx) => {
  const v = prodBody(await ctx.json());
  try { const id = Number(db().prepare('INSERT INTO products(name, brand, barcode, ingredients_text, price_uzs, price_source, created_by) VALUES (?,?,?,?,?,?,?)').run(v.name, v.brand, v.barcode, v.ingredients_text, v.price_uzs, v.price_source, ctx.user.id).lastInsertRowid); audit(ctx.user.id, 'product_created', id); return { ok: true, id }; }
  catch { throw bad('duplicate', 'Bunday mahsulot yoki barcode mavjud.'); }
});
route('PUT', '/api/admin/products/:id', needPerm('ingredients.write'), async (ctx) => {
  const v = prodBody(await ctx.json());
  try { db().prepare('UPDATE products SET name=?, brand=?, barcode=?, ingredients_text=?, price_uzs=?, price_source=? WHERE id=?').run(v.name, v.brand, v.barcode, v.ingredients_text, v.price_uzs, v.price_source, ctx.params.id); }
  catch { throw bad('duplicate', 'Bunday mahsulot yoki barcode mavjud.'); }
  audit(ctx.user.id, 'product_edited', ctx.params.id);
  return { ok: true };
});
route('DELETE', '/api/admin/products/:id', needPerm('ingredients.write'), async (ctx) => { db().prepare('DELETE FROM products WHERE id = ?').run(ctx.params.id); audit(ctx.user.id, 'product_deleted', ctx.params.id); return { ok: true }; });
route('GET', '/api/admin/sources', needPerm('ingredients.write'), async () => ({ items: all('SELECT * FROM sources ORDER BY id DESC') }));
route('POST', '/api/admin/sources', needPerm('ingredients.write'), async (ctx) => {
  const b = await ctx.json(); const title = clampStr(b.title, 200), url = clampStr(b.url, 500) || null;
  if (!title) throw bad('title_required', 'Sarlavha majburiy.');
  if (url && !/^https?:\/\//.test(url)) throw bad('invalid_url', "URL http(s) bilan boshlansin.");
  const id = Number(db().prepare('INSERT INTO sources(title, url, kind, published) VALUES (?,?,?,?)').run(title, url, clampStr(b.kind, 40) || null, isoDateOnly(b.published)).lastInsertRowid);
  audit(ctx.user.id, 'source_created', id); return { ok: true, id };
});
route('DELETE', '/api/admin/sources/:id', needPerm('ingredients.write'), async (ctx) => { db().prepare('DELETE FROM sources WHERE id = ?').run(ctx.params.id); audit(ctx.user.id, 'source_deleted', ctx.params.id); return { ok: true }; });

// ---------- Moderatsiya ----------
route('GET', '/api/admin/reports', needPerm('community.moderate'), async (ctx) => {
  const rows = all("SELECT * FROM reports WHERE status = 'open' ORDER BY id DESC LIMIT 100");
  return { items: rows.map((r) => {
    const c = r.target_type === 'review' ? one('SELECT r.id, r.body, r.status, r.user_id, u.nickname FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.id = ?', r.target_id) : one('SELECT c.id, c.body, c.status, c.user_id, u.nickname FROM review_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?', r.target_id);
    return { id: r.id, type: r.target_type, target_id: r.target_id, reason: r.reason, created_at: r.created_at, content: c ? { body: c.body, status: c.status, author: c.nickname, author_id: c.user_id } : null };
  }) };
});
route('POST', '/api/admin/reports/:id/action', needPerm('community.moderate'), async (ctx) => {
  const b = await ctx.json();
  const rep = one('SELECT * FROM reports WHERE id = ?', ctx.params.id);
  if (!rep) throw new HttpError(404, 'not_found', 'Topilmadi.');
  if (!['hide', 'dismiss'].includes(b.action)) throw bad('invalid_action', "Amal noto'g'ri.");
  tx((d) => {
    if (b.action === 'hide') d.prepare(`UPDATE ${rep.target_type === 'review' ? 'reviews' : 'review_comments'} SET status = 'hidden' WHERE id = ?`).run(rep.target_id);
    d.prepare('UPDATE reports SET status = ? WHERE id = ?').run(b.action === 'hide' ? 'actioned' : 'dismissed', rep.id);
  });
  audit(ctx.user.id, 'moderation_' + b.action, `${rep.target_type}:${rep.target_id}`, { report: rep.id });
  return { ok: true };
});
route('POST', '/api/admin/reviews/:id/visibility', needPerm('community.moderate'), async (ctx) => {
  const s = (await ctx.json()).status;
  if (!['visible', 'hidden'].includes(s)) throw bad('invalid_status', "Holat noto'g'ri.");
  db().prepare('UPDATE reviews SET status = ? WHERE id = ?').run(s, ctx.params.id);
  audit(ctx.user.id, 'review_visibility', ctx.params.id, { status: s });
  return { ok: true };
});
route('GET', '/api/admin/reviews', needPerm('community.moderate'), async () => ({ items: all('SELECT r.id, r.rating, r.body, r.status, r.created_at, p.name AS product, u.nickname FROM reviews r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 100') }));

// ---------- Moliya (faqat finance.read) ----------
route('GET', '/api/admin/subscriptions', needPerm('finance.read'), async () => ({ items: all('SELECT s.id, s.source, s.status, s.period_start, s.period_end, s.auto_renew, u.nickname FROM subscriptions s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 200') }));
route('GET', '/api/admin/payments', needPerm('finance.read'), async () => ({
  items: all('SELECT id, provider, provider_txn_id, amount_uzs, status, simulated, created_at FROM payments ORDER BY id DESC LIMIT 200'),
  totals: { real_paid_uzs: one("SELECT COALESCE(SUM(amount_uzs),0) n FROM payments WHERE simulated = 0 AND status = 'paid'").n, simulated_paid_uzs: one("SELECT COALESCE(SUM(amount_uzs),0) n FROM payments WHERE simulated = 1 AND status = 'paid'").n },
  note: "Simulyatsiya qilingan (sandbox/demo) to'lovlar haqiqiy hisobotga kirmaydi.", provider: providerStatus(),
}));

// ---------- Marketing ----------
route('GET', '/api/admin/promo-codes', needPerm('marketing.read'), async () => ({ items: all('SELECT * FROM promo_codes ORDER BY id DESC') }));
route('POST', '/api/admin/promo-codes', needPerm('marketing.write'), async (ctx) => {
  const b = await ctx.json(); const code = clampStr(b.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, ''), pct = parseInt(b.percent_off, 10);
  if (code.length < 3) throw bad('invalid_code', "Kod kamida 3 belgi (A-Z, 0-9)."); if (!(pct >= 1 && pct <= 100)) throw bad('invalid_percent', "Foiz 1-100.");
  try { db().prepare('INSERT INTO promo_codes(code, percent_off, valid_until, max_uses, active, created_by) VALUES (?,?,?,?,0,?)').run(code, pct, isoDateOnly(b.valid_until), parseInt(b.max_uses, 10) || null, ctx.user.id); }
  catch { throw bad('duplicate', 'Bu kod mavjud.'); }
  audit(ctx.user.id, 'promo_created', code);
  return { ok: true, note: "Promo-kod faol emas holatda yaratildi; narxlar tasdiqlangandan keyin yoqing." };
});
route('POST', '/api/admin/promo-codes/:id/active', needPerm('marketing.write'), async (ctx) => { db().prepare('UPDATE promo_codes SET active = ? WHERE id = ?').run((await ctx.json()).active ? 1 : 0, ctx.params.id); audit(ctx.user.id, 'promo_toggled', ctx.params.id); return { ok: true }; });
route('GET', '/api/admin/campaigns', needPerm('marketing.read'), async (ctx) => ({ items: all('SELECT * FROM campaigns ORDER BY id DESC').map((c) => ({ ...c, link: `${cfg().publicUrl}/?utm_source=${encodeURIComponent(c.utm_source || '')}&utm_medium=${encodeURIComponent(c.utm_medium || '')}&utm_campaign=${encodeURIComponent(c.utm_campaign || '')}` })) }));
route('POST', '/api/admin/campaigns', needPerm('marketing.write'), async (ctx) => {
  const b = await ctx.json(); const name = clampStr(b.name, 80); if (name.length < 2) throw bad('invalid_name', 'Nom majburiy.');
  const slug = normInci(name).replace(/\s+/g, '-').slice(0, 50) || 'kampaniya';
  try { db().prepare('INSERT INTO campaigns(name, slug, utm_source, utm_medium, utm_campaign, created_by) VALUES (?,?,?,?,?,?)').run(name, slug, clampStr(b.utm_source, 60) || null, clampStr(b.utm_medium, 60) || null, clampStr(b.utm_campaign, 80) || slug, ctx.user.id); }
  catch { throw bad('duplicate', 'Shunday kampaniya mavjud.'); }
  audit(ctx.user.id, 'campaign_created', slug); return { ok: true };
});
route('GET', '/api/admin/funnel', needPerm('marketing.read'), async () => {
  const q = (type, extra = '') => one(`SELECT COUNT(DISTINCT COALESCE(user_id, visitor_id)) n FROM events WHERE type = ? ${extra}`, type).n;
  const funnel = { visitors: one("SELECT COUNT(DISTINCT visitor_id) n FROM events WHERE type = 'visit'").n, registered: q('register'), first_analysis: q('first_analysis'), pro_view: q('pro_view'), purchase_real: q('purchase', 'AND simulated = 0'), purchase_simulated: q('purchase', 'AND simulated = 1') };
  const by = all("SELECT COALESCE(utm_source, ref, '(to''g''ridan-to''g''ri)') AS source, COALESCE(utm_campaign,'') AS campaign, SUM(type='visit') AS visits, SUM(type='register') AS registrations, SUM(type='first_analysis') AS first_analyses, SUM(type='pro_view') AS pro_views, SUM(type='purchase' AND simulated = 0) AS purchases FROM events GROUP BY 1, 2 ORDER BY visits DESC LIMIT 50");
  return { funnel, by_source: by, referrals: { total: one('SELECT COUNT(*) n FROM referral_tracking').n, converted: one('SELECT COUNT(*) n FROM referral_tracking WHERE converted_at IS NOT NULL').n }, note: "Barcha raqamlar events jadvalidan hisoblangan; hodisa bo'lmasa, 0 ko'rsatiladi." };
});
route('GET', '/api/admin/analytics', needPerm('admin.access'), async () => ({
  ocr: { total: one('SELECT COUNT(*) n FROM ocr_runs').n, failed: one('SELECT COUNT(*) n FROM ocr_runs WHERE ok = 0').n, by_error: all('SELECT error_code, COUNT(*) n FROM ocr_runs WHERE ok = 0 GROUP BY error_code'), avg_ms: one('SELECT ROUND(AVG(duration_ms)) n FROM ocr_runs').n, avg_confidence: one('SELECT ROUND(AVG(mean_confidence),1) n FROM ocr_runs WHERE ok = 1').n },
  barcode_not_found: all("SELECT ref AS barcode, COUNT(*) n FROM events WHERE type = 'barcode_not_found' GROUP BY ref ORDER BY n DESC LIMIT 20"),
}));

// ---------- Kundalik savollari ----------
route('GET', '/api/admin/diary-questions', needPerm('ingredients.write'), async () => ({ items: all('SELECT * FROM diary_questions ORDER BY sort, id') }));
route('POST', '/api/admin/diary-questions', needPerm('ingredients.write'), async (ctx) => {
  const b = await ctx.json(); const text = clampStr(b.text, 200); if (text.length < 3) throw bad('invalid_text', 'Savol matni majburiy.');
  if (!['scale', 'yesno', 'text'].includes(b.kind)) throw bad('invalid_kind', "Savol turi noto'g'ri.");
  const id = Number(db().prepare('INSERT INTO diary_questions(text, kind, sort) VALUES (?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM diary_questions))').run(text, b.kind).lastInsertRowid);
  audit(ctx.user.id, 'diary_question_created', id); return { ok: true, id };
});
route('POST', '/api/admin/diary-questions/:id/active', needPerm('ingredients.write'), async (ctx) => { db().prepare('UPDATE diary_questions SET active = ? WHERE id = ?').run((await ctx.json()).active ? 1 : 0, ctx.params.id); audit(ctx.user.id, 'diary_question_toggled', ctx.params.id); return { ok: true }; });

// ---------- Tizim / audit / sozlamalar ----------
route('GET', '/api/admin/system', needPerm('system.read'), async () => {
  let dbOk = false; try { dbOk = one('SELECT 1 AS n').n === 1; } catch { /* */ }
  let storage = { files: 0, bytes: 0 };
  try { for (const f of fs.readdirSync(cfg().uploadDir)) { storage.files++; storage.bytes += fs.statSync(path.join(cfg().uploadDir, f)).size; } } catch { /* papka hali yo'q */ }
  const ocr = await ocrStatus();
  return {
    checked_at: new Date().toISOString(), source: 'live_health_checks',
    database: { ok: dbOk, engine: 'sqlite', size_bytes: (() => { try { return fs.statSync(cfg().dbPath).size; } catch { return null; } })() },
    ocr, barcode: barcodeStatus(), mail: mailStatus(), payments: providerStatus(),
    server: { node: process.version, uptime_s: Math.round((Date.now() - startedAt) / 1000), memory_mb: Math.round(process.memoryUsage().rss / 1048576), load_1m: os.loadavg()[0] },
    storage, retention_hours: cfg().uploadRetentionHours,
    recent_events: all('SELECT at, level, kind, message FROM system_events ORDER BY id DESC LIMIT 30'),
    demo_mode: cfg().demoMode,
  };
});
route('GET', '/api/admin/audit', needPerm('audit.read'), async (ctx) => {
  const a = clampStr(ctx.query.action, 40);
  const rows = a ? all('SELECT * FROM admin_audit_logs WHERE action LIKE ? ORDER BY id DESC LIMIT 200', `%${a}%`) : all('SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT 200');
  return { items: rows.map((r) => ({ ...r, detail: safeJson(r.detail_json), detail_json: undefined })) };
});
const SETTINGS = ['free_monthly_limit', 'pro_monthly_limit', 'price_pro_month_uzs'];
route('GET', '/api/admin/settings', needPerm('roles.manage'), async () => ({ items: Object.fromEntries(SETTINGS.map((k) => [k, one('SELECT value FROM settings WHERE key = ?', k)?.value ?? null])) }));
route('PUT', '/api/admin/settings', needPerm('roles.manage'), async (ctx) => {
  const b = await ctx.json();
  for (const k of SETTINGS) if (k in b) {
    if (b[k] === null || b[k] === '') db().prepare('DELETE FROM settings WHERE key = ?').run(k);
    else { const n = parseInt(b[k], 10); if (!(n >= 0)) throw bad('invalid_value', `${k} manfiy bo'lmagan son bo'lsin.`); db().prepare('INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(n)); }
  }
  audit(ctx.user.id, 'settings_changed', null, b);
  return { ok: true };
});

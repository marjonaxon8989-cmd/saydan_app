import fs from 'node:fs';
import { route, HttpError, bad, setCookie } from '../http.mjs';
import { db } from '../db.mjs';
import { cfg } from '../config.mjs';
import { ocrStatus } from '../ocr/index.mjs';
import { status as barcodeStatus } from '../barcode/index.mjs';
import { providerStatus, priceUzs } from '../payments/index.mjs';
import { mailStatus } from '../mail.mjs';
import { normInci, clampStr, randomToken } from '../util.mjs';
import { parseUrls } from '../analysis/engine.mjs';
import { monthlyLimit } from '../entitlements.mjs';

const n = (sql, ...p) => db().prepare(sql).get(...p).n;

route('GET', '/api/health', async () => ({ ok: n('SELECT 1 AS n') === 1, frontend: fs.existsSync(new URL('../../public/index.html', import.meta.url)) }));

route('GET', '/api/config', async (ctx) => {
  const c = cfg();
  const pay = providerStatus();
  return {
    app: 'SAYDAN', demoMode: c.demoMode,
    ocr: await ocrStatus(), barcode: barcodeStatus(), mail: mailStatus(),
    payments: { state: pay.state },
    plans: {
      free: { monthly_limit: monthlyLimit('free'), history_visible: c.freeHistoryVisible },
      pro: { price_uzs: priceUzs(), pricing_approved: priceUzs() != null },
    },
    counts: {
      ingredients: n('SELECT COUNT(*) n FROM ingredients WHERE is_demo = 0'),
      demo_ingredients: n('SELECT COUNT(*) n FROM ingredients WHERE is_demo = 1'),
      approved_ingredients: n("SELECT COUNT(*) n FROM ingredients WHERE status = 'approved'"),
      functions: n('SELECT COUNT(*) n FROM functions'),
      function_groups: n('SELECT COUNT(*) n FROM function_groups'),
      alternatives: n('SELECT COUNT(*) n FROM alternatives'),
      conflicts: n('SELECT COUNT(*) n FROM conflicts'),
      reviews: n("SELECT COUNT(*) n FROM reviews WHERE status = 'visible'"),
    },
  };
});

const LIST_FIELDS = 'id, inci, uz_name, function_uz, cosing_functions, status, pharmacist_approved, is_demo';
route('GET', '/api/ingredients', { limit: { name: 'ingsearch', max: 120, windowMs: 60000 } }, async (ctx) => {
  const q = clampStr(ctx.query.q, 80), fn = clampStr(ctx.query.fn, 80);
  const page = Math.max(1, parseInt(ctx.query.page, 10) || 1), limit = 24;
  const where = ["status != 'archived'"], params = [];
  if (q) {
    const nq = normInci(q);
    where.push('(id IN (SELECT ingredient_id FROM ingredient_aliases WHERE alias_norm LIKE ?) OR lower(inci) LIKE ? OR lower(coalesce(uz_name, \'\')) LIKE ?)');
    params.push(`%${nq}%`, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
  }
  if (fn) { where.push("lower(coalesce(cosing_functions,'')) LIKE ?"); params.push(`%${fn.toLowerCase()}%`); }
  const W = where.join(' AND ');
  const total = n(`SELECT COUNT(*) n FROM ingredients WHERE ${W}`, ...params);
  const items = db().prepare(`SELECT ${LIST_FIELDS} FROM ingredients WHERE ${W} ORDER BY inci COLLATE NOCASE LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
  return { total, page, pages: Math.ceil(total / limit), items: items.map((i) => ({ ...i, pharmacist_approved: i.pharmacist_approved === 1, is_demo: i.is_demo === 1 })) };
});

route('GET', '/api/ingredients/:id', async (ctx) => {
  const ing = db().prepare("SELECT * FROM ingredients WHERE id = ? AND status != 'archived'").get(ctx.params.id);
  if (!ing) throw new HttpError(404, 'not_found', 'Ingredient topilmadi.');
  const basic = {
    id: ing.id, inci: ing.inci, uz_name: ing.uz_name, synonyms: ing.synonyms, cas: ing.cas, function_uz: ing.function_uz, cosing_functions: ing.cosing_functions,
    description_uz: ing.description_uz, status: ing.status, review_status: ing.review_status, pharmacist_approved: ing.pharmacist_approved === 1, is_demo: ing.is_demo === 1,
    sources: parseUrls(ing.source_urls), updated_at: ing.updated_at,
  };
  if (ctx.plan !== 'pro') return { ...basic, plan: ctx.plan, locked: ['detailed_explanation', 'dimension_details', 'regulatory', 'alternatives', 'interactions'] };
  const ph = db().prepare('SELECT * FROM ingredient_assessments WHERE ingredient_id = ?').all(ing.id);
  const alts = db().prepare('SELECT * FROM alternatives WHERE main_ingredient_id = ? ORDER BY similarity DESC LIMIT 20').all(ing.id);
  const cfs = db().prepare('SELECT * FROM conflicts WHERE a_ingredient_id = ? OR b_ingredient_id = ?').all(ing.id, ing.id);
  const R = (v) => (typeof v === 'string' && /^\s*manba topilmadi/i.test(v) ? null : v);   // to'ldirgich matn ma'lumot emas
  return {
    ...basic, plan: 'pro', locked: [],
    detailed_explanation: ing.detailed_explanation, pubchem_en: ing.pubchem_en, safety_general: ing.safety_general,
    pregnancy_info: R(ing.pregnancy_info), oily_info: R(ing.oily_info), dry_info: R(ing.dry_info), sensitive_info: R(ing.sensitive_info),
    eu_restrictions: ing.eu_restrictions, eu_allergen: ing.eu_allergen, sccs: ing.sccs, cir: ing.cir, pharmacist_comment: ing.pharmacist_comment,
    assessments: ph.map((a) => ({ dimension: a.dimension, stance: a.stance, evidence_level: a.evidence_level, note: a.note, approved: a.approved === 1 })),
    alternatives: alts.map((a) => ({ alt: a.alt_inci, alt_uz: a.alt_uz, similarity: a.similarity, shared_functions: a.shared_functions, differences: a.differences, sources: parseUrls(a.sources), review_status: a.review_status })),
    interactions: cfs.map((c) => ({ a: c.ingredient_a, b: c.ingredient_b, type: c.interaction_type, description: c.description, sources: parseUrls(c.sources), review_status: c.review_status })),
  };
});

route('GET', '/api/functions', async (ctx) => {
  const q = clampStr(ctx.query.q, 60).toLowerCase();
  const rows = db().prepare('SELECT id, name_en, name_uz, definition_uz, ingredient_count, examples, source FROM functions ORDER BY name_en COLLATE NOCASE').all();
  return { items: q ? rows.filter((r) => `${r.name_en} ${r.name_uz ?? ''}`.toLowerCase().includes(q)) : rows };
});
route('GET', '/api/function-groups', async () => ({
  items: db().prepare('SELECT id, name, description, examples, sources, review_status, pharmacist_approved, pharmacist_comment FROM function_groups ORDER BY id').all().map((g) => ({ ...g, pharmacist_approved: g.pharmacist_approved === 1, sources: parseUrls(g.sources) })),
}));

route('GET', '/api/reviews/recent', async () => ({
  items: db().prepare(`SELECT r.id, r.rating, r.body, r.created_at, p.id AS product_id, p.name AS product_name, u.nickname FROM reviews r
    JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.user_id WHERE r.status = 'visible' ORDER BY r.created_at DESC LIMIT 6`).all(),
}));

// Marketing kuzatuvi (UTM/referral). Shaxsiy ma'lumot yozilmaydi.
const TRACK_TYPES = new Set(['visit', 'pro_view']);
route('POST', '/api/track', { limit: { name: 'track', max: 60, windowMs: 60000 } }, async (ctx) => {
  const b = await ctx.json();
  if (!TRACK_TYPES.has(b.type)) throw bad('bad_type', 'Noma\'lum hodisa turi.');
  let vid = ctx.cookies.sv;
  if (!vid) { vid = randomToken(12); setCookie(ctx.res, 'sv', vid, { maxAge: 31536000 }); }
  const utm = { utm_source: clampStr(b.utm_source, 60) || null, utm_medium: clampStr(b.utm_medium, 60) || null, utm_campaign: clampStr(b.utm_campaign, 80) || null, ref: clampStr(b.ref, 20) || null };
  if (utm.utm_source || utm.ref) setCookie(ctx.res, 'sutm', JSON.stringify(utm), { maxAge: 30 * 86400 });
  const stored = (utm.utm_source || utm.ref) ? utm : (() => { try { return JSON.parse(ctx.cookies.sutm || '{}'); } catch { return {}; } })();
  db().prepare('INSERT INTO events(visitor_id, user_id, type, utm_source, utm_medium, utm_campaign, ref) VALUES (?,?,?,?,?,?,?)')
    .run(vid, ctx.user?.id ?? null, b.type, stored.utm_source || null, stored.utm_medium || null, stored.utm_campaign || null, stored.ref || null);
  return { ok: true };
});

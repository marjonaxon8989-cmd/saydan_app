import { route, HttpError, bad } from '../http.mjs';
import { db, tx } from '../db.mjs';
import { cfg } from '../config.mjs';
import { uid, clampStr, isoDateOnly, safeJson } from '../util.mjs';
import { storeImage, imagePathFor, deleteImage } from '../uploads.mjs';
import { recognize, ocrStatus } from '../ocr/index.mjs';
import { extractIngredients, extractDateCandidates, extractPaoCandidates, guessProductName } from '../analysis/extract.mjs';
import { analyzeItems, shapeForPlan } from '../analysis/engine.mjs';
import { usageStatus } from '../entitlements.mjs';
import { validBarcode, lookup as barcodeLookup, status as barcodeStatus } from '../barcode/index.mjs';
import { decryptJson } from '../crypto.mjs';
import { sysEvent } from '../audit.mjs';

const MAX_ITEMS = 150;
function parseItems(b) {
  let list = [];
  if (Array.isArray(b.items)) list = b.items.map((s) => String(s));
  else if (typeof b.text === 'string') list = b.text.split(/[,;\n•·|]+/);
  else throw bad('no_input', "Ingredientlar ro'yxati kiritilmagan.");
  list = list.map((s) => clampStr(s, 90).replace(/^[\.\-–:]+|[\.\-–:]+$/g, '').trim()).filter((s) => s.length >= 2);
  if (!list.length) throw bad('no_input', "Ingredientlar ro'yxati bo'sh.");
  if (list.length > MAX_ITEMS) throw bad('too_many_items', `Bir tahlilda ${MAX_ITEMS} tadan ko'p ingredient bo'lmasin.`);
  return list;
}
function parseAccepted(a) {
  const out = {};
  if (a && typeof a === 'object') for (const [k, v] of Object.entries(a)) if (Number.isInteger(v)) out[String(k).slice(0, 90)] = v;
  return out;
}
function profileAllergens(user, plan) {
  if (plan !== 'pro') return [];
  const p = db().prepare('SELECT data_enc FROM profiles WHERE user_id = ?').get(user.id);
  if (!p) return [];
  try { const d = decryptJson(p.data_enc); return Array.isArray(d.allergens) ? d.allergens.slice(0, 30) : []; } catch { return []; }
}
export function expiryInfo(expiry_date, pao_months) {
  const out = { expiry_date: expiry_date || null, pao_months: pao_months || null };
  if (expiry_date) {
    const days = Math.floor((new Date(expiry_date + 'T00:00:00Z') - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 86400000);
    out.days_left = days; out.status = days < 0 ? 'expired' : days <= 30 ? 'soon' : 'ok';
  } else out.status = 'unknown';
  if (pao_months) out.pao_note = `PAO belgisi: ochilgandan keyin ${pao_months} oy ichida ishlatish tavsiya etiladi. Bu kalendar yaroqlilik sanasi emas.`;
  return out;
}

route('GET', '/api/ocr/status', async () => ocrStatus());

route('POST', '/api/ocr', { auth: 'required', limit: { name: 'ocr', max: 20, windowMs: 3600000 }, maxBody: 8 * 1024 * 1024 }, async (ctx) => {
  const t0 = Date.now();
  const buf = await ctx.raw(cfg().maxUploadBytes + 1024);
  const stored = await storeImage(ctx.user.id, buf);
  if (!stored.ok) {
    const m = { unsupported_type: 'Faqat JPEG, PNG yoki WebP rasm qabul qilinadi.', too_large: "Rasm hajmi juda katta.", corrupt_image: 'Rasm buzilgan yoki o\'qib bo\'lmaydi.' };
    throw new HttpError(stored.error === 'too_large' ? 413 : 415, stored.error, m[stored.error] || 'Rasm qabul qilinmadi.');
  }
  const r = await recognize(stored.path);
  db().prepare('INSERT INTO ocr_runs(user_id, provider, ok, error_code, duration_ms, mean_confidence) VALUES (?,?,?,?,?,?)')
    .run(ctx.user.id, cfg().ocrProvider, r.ok ? 1 : 0, r.ok ? null : r.error, Date.now() - t0, r.ok ? r.meanConfidence : null);
  if (!r.ok) {
    if (r.error === 'provider_unavailable') { sysEvent('error', 'ocr', 'OCR provayder mavjud emas'); throw new HttpError(503, 'ocr_unavailable', "OCR xizmati hozir mavjud emas. Ingredientlarni qo'lda kiritishingiz mumkin.", { imageId: stored.id }); }
    throw new HttpError(422, r.error, r.error === 'no_text' ? "Rasmdan matn topilmadi. Aniqroq suratga oling yoki qo'lda kiriting." : "Matnni o'qib bo'lmadi. Qayta urinib ko'ring yoki qo'lda kiriting.", { imageId: stored.id });
  }
  const { items, hasMarker } = extractIngredients(r.text, r.words);
  return {
    imageId: stored.id, text: r.text, meanConfidence: r.meanConfidence, ingredientMarkerFound: hasMarker,
    items, productGuess: guessProductName(r.text, r.words),
    expiryCandidates: extractDateCandidates(r.text), paoCandidates: extractPaoCandidates(r.text),
    retention: { hours: cfg().uploadRetentionHours, note: "Saqlanmagan tahlillarning rasmi shu muddatdan keyin o'chiriladi." },
  };
});

route('GET', '/api/images/:id', { auth: 'required' }, async (ctx) => {
  const r = imagePathFor(ctx.user.id, ctx.params.id);   // faqat egasiga
  if (!r) throw new HttpError(404, 'not_found', 'Topilmadi.');
  const fs = await import('node:fs');
  if (!fs.existsSync(r.path)) throw new HttpError(404, 'not_found', 'Topilmadi.');
  return { __raw: true, headers: { 'Content-Type': r.row.mime, 'Cache-Control': 'private, no-store' }, body: fs.readFileSync(r.path) };
});

// Bir tahlil sessiyasida (masalan noaniq moslikni tasdiqlab qayta hisoblash) limit ikki marta sanalmasligi uchun qisqa muddatli token.
const sessions = new Map();
const mintSession = (userId) => { const t = uid(); sessions.set(t, { userId, exp: Date.now() + 30 * 60000 }); if (sessions.size > 5000) for (const [k, v] of sessions) if (v.exp < Date.now()) sessions.delete(k); return t; };
const validSession = (t, userId) => { const v = typeof t === 'string' ? sessions.get(t) : null; return !!v && v.userId === userId && v.exp > Date.now(); };

route('POST', '/api/analyze', { auth: 'required', limit: { name: 'analyze', max: 60, windowMs: 3600000 } }, async (ctx) => {
  const b = await ctx.json();
  const items = parseItems(b);
  const reuse = validSession(b.session_token, ctx.user.id);
  const u = usageStatus(ctx.user);
  if (!reuse && u.remaining <= 0) throw new HttpError(429, 'monthly_limit', `Oylik tahlil limiti (${u.limit}) tugadi.`, { usage: u });
  const full = analyzeItems(items, { accepted: parseAccepted(b.accepted), allergens: profileAllergens(ctx.user, ctx.plan) });
  if (!reuse) {
    const first = !db().prepare('SELECT 1 FROM analysis_usage WHERE user_id = ? LIMIT 1').get(ctx.user.id);
    db().prepare("INSERT INTO analysis_usage(user_id, kind) VALUES (?, ?)").run(ctx.user.id, 'label');
    if (first) db().prepare("INSERT INTO events(user_id, type, utm_source) VALUES (?, 'first_analysis', ?)").run(ctx.user.id, ctx.user.reg_source);
  }
  const usage = usageStatus(ctx.user);
  const upsell = ctx.plan !== 'pro' && usage.used >= 3 ? { message: `Sizning ${usage.used}-tahlilingiz. Pro'da kengaytirilgan imkoniyatlar mavjud.`, context: 'result_inline' } : null;
  return { session_token: reuse ? b.session_token : mintSession(ctx.user.id), result: shapeForPlan(full, ctx.plan), expiry: expiryInfo(isoDateOnly(b.expiry_date), parseInt(b.pao_months, 10) || null), usage, upsell };
});

function findOrCreateProduct(d, user, name, brand, barcode, ingredientsText) {
  name = clampStr(name, 120); brand = clampStr(brand, 80) || null;
  if (!name) return null;
  let p = barcode ? d.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode) : null;
  if (!p) p = d.prepare("SELECT id FROM products WHERE lower(name) = lower(?) AND lower(coalesce(brand,'')) = lower(?)").get(name, brand || '');
  if (p) return p.id;
  return Number(d.prepare('INSERT INTO products(name, brand, barcode, ingredients_text, created_by) VALUES (?,?,?,?,?)').run(name, brand, barcode || null, ingredientsText || null, user.id).lastInsertRowid);
}

route('POST', '/api/analyses', { auth: 'required', limit: { name: 'saveanalysis', max: 60, windowMs: 3600000 } }, async (ctx) => {
  const b = await ctx.json();
  if (b.consent_save !== true) throw bad('consent_required', "Saqlash uchun roziligingizni tasdiqlang.");
  const items = parseItems(b);
  const barcode = b.barcode && validBarcode(String(b.barcode)) ? String(b.barcode) : null;
  const full = analyzeItems(items, { accepted: parseAccepted(b.accepted), allergens: profileAllergens(ctx.user, 'pro') });   // server qayta hisoblaydi; mijoz natijasiga ishonilmaydi
  const id = uid();
  const expiry = isoDateOnly(b.expiry_date);
  const pao = Number.isInteger(b.pao_months) && b.pao_months > 0 && b.pao_months <= 60 ? b.pao_months : null;
  tx((d) => {
    const pid = findOrCreateProduct(d, ctx.user, b.product_name, b.brand, barcode, items.join(', '));
    let imageId = null;
    if (b.image_id && imagePathFor(ctx.user.id, String(b.image_id))) {
      imageId = String(b.image_id);
      if (b.keep_image === true) d.prepare('UPDATE uploaded_images SET saved = 1 WHERE id = ?').run(imageId);
    }
    d.prepare('INSERT INTO analyses(id, user_id, product_id, product_name, brand, barcode, input_text, confirmed_json, result_json, expiry_date, pao_months, image_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, ctx.user.id, pid, clampStr(b.product_name, 120) || null, clampStr(b.brand, 80) || null, barcode, items.join(', '), JSON.stringify({ items, accepted: parseAccepted(b.accepted) }), JSON.stringify(full), expiry, pao, b.keep_image === true ? imageId : null);
  });
  if (b.image_id && b.keep_image !== true) { const r = imagePathFor(ctx.user.id, String(b.image_id)); if (r) deleteImage(r.row.id); }   // saqlash tanlanmagan rasm darhol o'chiriladi
  return { ok: true, id };
});

route('GET', '/api/analyses', { auth: 'required' }, async (ctx) => {
  const rows = db().prepare('SELECT id, product_name, brand, barcode, expiry_date, created_at, result_json FROM analyses WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(ctx.user.id);
  const visible = ctx.plan === 'pro' ? Infinity : cfg().freeHistoryVisible;
  const q = ctx.plan === 'pro' ? clampStr(ctx.query.q, 60).toLowerCase() : '';
  let items = rows.map((r, i) => {
    const res = safeJson(r.result_json, {});
    return { id: r.id, product_name: r.product_name, brand: r.brand, created_at: r.created_at, expiry_date: r.expiry_date, counts: res.counts, locked: i >= visible };
  });
  if (q) items = items.filter((i) => `${i.product_name ?? ''} ${i.brand ?? ''}`.toLowerCase().includes(q));
  return { items: items.map((i) => (i.locked ? { id: i.id, locked: true, created_at: i.created_at } : i)), total: rows.length, plan: ctx.plan, free_visible: cfg().freeHistoryVisible };
});

function loadOwn(ctx, id) {
  const r = db().prepare('SELECT * FROM analyses WHERE id = ? AND user_id = ?').get(id, ctx.user.id);
  if (!r) throw new HttpError(404, 'not_found', 'Tahlil topilmadi.');   // boshqa foydalanuvchiniki ham 404 (IDOR)
  return r;
}
route('GET', '/api/analyses/:id', { auth: 'required' }, async (ctx) => {
  const r = loadOwn(ctx, ctx.params.id);
  if (ctx.plan !== 'pro') {
    const newest = db().prepare('SELECT id FROM analyses WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(ctx.user.id, cfg().freeHistoryVisible).map((x) => x.id);
    if (!newest.includes(r.id)) throw new HttpError(402, 'pro_required', "Bu tahlil Free rejada ko'rinmaydi (oxirgi 5 ta). Pro'da to'liq tarix mavjud.", { feature: 'history_full' });
  }
  return {
    id: r.id, product_name: r.product_name, brand: r.brand, barcode: r.barcode, created_at: r.created_at, input_text: r.input_text, image_id: r.image_id,
    expiry: expiryInfo(r.expiry_date, r.pao_months), result: shapeForPlan(safeJson(r.result_json), ctx.plan), product_id: r.product_id,
  };
});
route('DELETE', '/api/analyses/:id', { auth: 'required' }, async (ctx) => {
  const r = loadOwn(ctx, ctx.params.id);
  if (r.image_id) deleteImage(r.image_id);
  db().prepare('DELETE FROM analyses WHERE id = ?').run(r.id);
  return { ok: true };
});

// ---- Barcode (Pro) ----
route('GET', '/api/barcode/status', async () => ({ ...barcodeStatus(), decode: 'client', note: "Kamera orqali o'qish brauzerning BarcodeDetector imkoniyatiga bog'liq; qo'llab-quvvatlanmasa raqamni qo'lda kiriting." }));
route('POST', '/api/barcode/lookup', { auth: 'required', pro: 'barcode', limit: { name: 'barcode', max: 40, windowMs: 3600000 } }, async (ctx) => {
  const code = String((await ctx.json()).barcode ?? '').replace(/\s+/g, '');
  if (!validBarcode(code)) throw bad('invalid_barcode', "Barcode raqami noto'g'ri (kontrol raqami mos kelmadi).");
  const local = db().prepare('SELECT name, brand, ingredients_text FROM products WHERE barcode = ? AND ingredients_text IS NOT NULL').get(code);
  if (local) return { state: 'found', source: 'saydan', product: { barcode: code, name: local.name, brand: local.brand, ingredients_text: local.ingredients_text } };
  const r = await barcodeLookup(code);
  if (r.state === 'not_found') db().prepare("INSERT INTO events(user_id, type, ref) VALUES (?, 'barcode_not_found', ?)").run(ctx.user.id, code);
  if (r.state === 'found' && !r.product.ingredients_text) return { state: 'found_no_ingredients', source: r.provider, product: r.product };
  if (r.state === 'found') return { state: 'found', source: r.provider, product: r.product, attribution: "Ma'lumot: Open Beauty Facts (ODbL). To'liq va aniq bo'lmasligi mumkin." };
  return { state: r.state, fallback: ['label_ocr', 'manual'] };
});

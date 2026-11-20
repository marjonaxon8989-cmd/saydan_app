// Tahlil mexanizmi: baza asosida; sun'iy intellekt YO'Q va ilmiy ma'lumot uydirilmaydi.
import { db } from '../db.mjs';
import { cfg } from '../config.mjs';
import { loadIndex, matchAll } from './matcher.mjs';
import { scoreDimension, DIMENSIONS, METHOD_UZ } from './scoring.mjs';
import { normInci, inciVariants } from '../util.mjs';

export const DISCLAIMER = "Bu ma'lumot, tibbiy maslahat emas. Yakuniy qaror uchun tegishli mutaxassis bilan maslahatlashing.";
export const PREGNANCY_NOTE = "Homiladorlik davriga oid ma'lumotlar umumiy xarakterga ega va ingredientga xos tasdiqlangan ruxsat degani emas. Mahsulotni ishlatishdan oldin vrach yoki farmatsevt bilan maslahatlashing.";
export const ORDER_NOTE = "Tarkibdagi tartib konsentratsiya haqida taxminiy ishoradir, aniq foizni bildirmaydi. Konsentratsiyaga bog'liq xulosalar chiqarilmadi.";
export const CLIMATE_NOTE = "O'zbekiston hududlari, fasllar va namlik bir xil emas. Umumiy iqlim taxminlari ilmiy dalil sifatida ishlatilmaydi; ingredientga xos tasdiqlangan baho bo'lmasa, iqlim bo'yicha xulosa chiqarilmaydi.";

// Importdagi "Manba topilmadi — farmatsevt to'ldiradi" to'ldirgichi haqiqiy ma'lumot hisoblanmaydi.
const PLACEHOLDER = /^\s*manba topilmadi/i;
const has = (s) => typeof s === 'string' && s.trim().length > 0 && !PLACEHOLDER.test(s);
export function parseUrls(s) {
  return [...new Set(String(s ?? '').split(/[\s,;]+/).filter((u) => /^https?:\/\/\S+$/i.test(u)))];
}

function loadIngredients(ids) {
  if (!ids.length) return [];
  const q = `SELECT * FROM ingredients WHERE id IN (${ids.map(() => '?').join(',')})`;
  return db().prepare(q).all(...ids);
}
function loadAssessments(ids) {
  if (!ids.length) return new Map();
  const rows = db().prepare(`SELECT * FROM ingredient_assessments WHERE ingredient_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const m = new Map();
  for (const r of rows) { if (!m.has(r.ingredient_id)) m.set(r.ingredient_id, {}); m.get(r.ingredient_id)[r.dimension] = r; }
  return m;
}

function dimInfo(ing, assess, dim) {
  const textField = { pregnancy: 'pregnancy_info', dry: 'dry_info', oily: 'oily_info', sensitive: 'sensitive_info', climate: null }[dim];
  const text = textField && has(ing[textField]) ? ing[textField] : null;
  const a = assess?.[dim] || null;
  return { text, assessment: a ? { stance: a.stance, evidence_level: a.evidence_level, approved: a.approved, note: a.note, source_ref: a.source_ref } : null };
}

export function analyzeItems(items, opts = {}) {
  const c = cfg();
  const index = opts.index || loadIndex();
  let matches = matchAll(items, index);
  // Foydalanuvchi tasdiqlagan noaniq moslik
  const accepted = opts.accepted || {};
  matches = matches.map((m) => {
    if (m.status === 'uncertain' && accepted[m.raw] && m.candidates?.includes(accepted[m.raw])) {
      return { ...m, status: 'confirmed', matchType: 'user_confirmed', ingredientId: accepted[m.raw] };
    }
    return m;
  });
  // takroriy tasdiqlangan ingredientlarni olib tashlash (accepted dan keyin)
  const seen = new Set();
  matches = matches.filter((m) => { if (m.status !== 'confirmed') return true; if (seen.has(m.ingredientId)) return false; seen.add(m.ingredientId); return true; });

  const confirmed = matches.filter((m) => m.status === 'confirmed');
  const ids = confirmed.map((m) => m.ingredientId);
  const ingRows = new Map(loadIngredients(ids).map((r) => [r.id, r]));
  const assessMap = loadAssessments(ids);

  const cards = confirmed.map((m) => {
    const ing = ingRows.get(m.ingredientId);
    const assess = assessMap.get(ing.id) || {};
    const dims = {};
    for (const d of [...DIMENSIONS, 'sensitive']) dims[d] = dimInfo(ing, assess, d);
    return {
      id: ing.id, raw: m.raw, matchType: m.matchType, lowOcr: !!m.lowOcr, ocrConfidence: m.ocrConfidence,
      inci: ing.inci, uz_name: ing.uz_name, function_uz: ing.function_uz, cosing_functions: ing.cosing_functions,
      description_uz: ing.description_uz,
      evidence: { status: ing.status, pharmacist_approved: ing.pharmacist_approved === 1, is_demo: ing.is_demo === 1, review_status: ing.review_status },
      detail: {
        detailed_explanation: ing.detailed_explanation, safety_general: ing.safety_general, pubchem_en: ing.pubchem_en,
        eu_restrictions: ing.eu_restrictions, eu_allergen: ing.eu_allergen, sccs: ing.sccs, cir: ing.cir,
        sources: parseUrls(ing.source_urls), pharmacist_comment: ing.pharmacist_comment, dims,
      },
      _dims: dims,
    };
  });

  const dimensions = {};
  for (const d of DIMENSIONS) {
    dimensions[d] = scoreDimension(d, cards.map((cd) => ({ ingredient_id: cd.id, hasText: !!cd._dims[d].text, assessment: cd._dims[d].assessment })),
      { minAssessed: c.scoreMinAssessed, minCoverage: c.scoreMinCoverage });
  }
  const sensitiveInfo = cards.filter((cd) => cd._dims.sensitive.text).length;
  cards.forEach((cd) => delete cd._dims);

  // Uncertain / unmatched
  const candIds = [...new Set(matches.filter((m) => m.status === 'uncertain').flatMap((m) => m.candidates || []))];
  const candRows = new Map(loadIngredients(candIds).map((r) => [r.id, r]));
  const uncertain = matches.filter((m) => m.status === 'uncertain').map((m) => ({
    raw: m.raw, reason: m.reason, ocrConfidence: m.ocrConfidence,
    candidates: (m.candidates || []).map((id) => ({ id, inci: candRows.get(id)?.inci, uz_name: candRows.get(id)?.uz_name })),
  }));
  const unmatched = matches.filter((m) => m.status === 'unmatched').map((m) => ({ raw: m.raw, ocrConfidence: m.ocrConfidence }));

  // Interaksiyalar (faqat bazadagi yozuvlar; to'liq ro'yxat EMAS)
  let interactions = [];
  if (ids.length > 1) {
    const ph = ids.map(() => '?').join(',');
    interactions = db().prepare(`SELECT * FROM conflicts WHERE a_ingredient_id IN (${ph}) AND b_ingredient_id IN (${ph})`).all(...ids, ...ids)
      .map((r) => ({ id: r.id, a: r.ingredient_a, b: r.ingredient_b, type: r.interaction_type, description: r.description, sources: parseUrls(r.sources), review_status: r.review_status, pharmacist_approved: r.pharmacist_approved === 1 }));
  }
  let alternatives = [];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    alternatives = db().prepare(`SELECT * FROM alternatives WHERE main_ingredient_id IN (${ph}) ORDER BY main_inci, similarity DESC`).all(...ids)
      .map((r) => ({ id: r.id, main: r.main_inci, main_uz: r.main_uz, alt: r.alt_inci, alt_uz: r.alt_uz, alt_tag: r.alt_tag, similarity: r.similarity, shared_functions: r.shared_functions, differences: r.differences, sources: parseUrls(r.sources), review_status: r.review_status }));
    const per = {}; alternatives = alternatives.filter((a) => (per[a.main] = (per[a.main] || 0) + 1) <= 5);
  }
  // Allergen ogohlantirishlari (profil foydalanuvchi roziligi bilan; neytral xabar)
  const allergenAlerts = [];
  if (opts.allergens?.length && ids.length) {
    const ph = ids.map(() => '?').join(',');
    const aliasRows = db().prepare(`SELECT ingredient_id, alias_norm FROM ingredient_aliases WHERE ingredient_id IN (${ph})`).all(...ids);
    const wanted = opts.allergens.map((a) => ({ raw: a, vars: new Set(inciVariants(a)) }));
    for (const card of cards) {
      const names = new Set(aliasRows.filter((r) => r.ingredient_id === card.id).map((r) => r.alias_norm));
      for (const w of wanted) if ([...w.vars].some((v) => names.has(v))) allergenAlerts.push({ ingredient_id: card.id, inci: card.inci, selected: w.raw });
    }
  }

  const counts = { total: matches.length, confirmed: cards.length, uncertain: uncertain.length, unmatched: unmatched.length };
  const dataStatus = {
    draft: cards.filter((x) => x.evidence.status === 'draft').length,
    approved: cards.filter((x) => x.evidence.status === 'approved').length,
    pharmacist_approved: cards.filter((x) => x.evidence.pharmacist_approved).length,
    demo: cards.filter((x) => x.evidence.is_demo).length,
  };
  const summary = [];
  if (!counts.total) summary.push("Tahlil qilish uchun ingredientlar ro'yxati kiritilmadi.");
  else {
    summary.push(`Kiritilgan ${counts.total} ta bandning ${counts.confirmed} tasi SAYDAN bazasidagi yozuvlar bilan aniq mos keldi, ${counts.uncertain} tasi noaniq, ${counts.unmatched} tasi bazadan topilmadi.`);
    if (counts.unmatched) summary.push("Bazadan topilmagan moddalar haqida xulosa chiqarilmadi: yozuvning yo'qligi ularning xavfsiz yoki xavfli ekanini bildirmaydi.");
    if (dataStatus.draft) summary.push("Mos kelgan yozuvlarning bir qismi qoralama holatida va farmatsevt tekshiruvidan o'tmagan; ularni tasdiqlangan ilmiy xulosa sifatida qabul qilmang.");
    if (dataStatus.demo) summary.push("DEMO: ba'zi yozuvlar demo ma'lumot bo'lib, ilmiy jihatdan tasdiqlanmagan.");
    if (DIMENSIONS.every((d) => dimensions[d].status !== 'scored')) summary.push("Hozircha hech bir yo'nalish bo'yicha foizli ko'rsatkich hisoblash uchun yetarli tasdiqlangan ma'lumot yo'q.");
  }
  return {
    version: 1, counts, ingredients: cards, uncertain, unmatched, dimensions, sensitiveInfo,
    interactions, alternatives, allergenAlerts, summary, dataStatus,
    notes: { disclaimer: DISCLAIMER, pregnancy: PREGNANCY_NOTE, order: ORDER_NOTE, climate: CLIMATE_NOTE, method: METHOD_UZ },
  };
}

// Reja bo'yicha javobni shakllantirish: Pro maydonlari Free foydalanuvchiga HECH QACHON yuborilmaydi.
const PRO_LOCKS = ['detailed_explanations', 'dimension_details', 'interactions', 'budget_alternatives', 'allergen_alerts', 'sources_detail', 'pdf_report'];
export function shapeForPlan(full, plan) {
  const r = JSON.parse(JSON.stringify(full));
  if (plan === 'pro') { r.plan = 'pro'; r.locked = []; return r; }
  r.plan = plan;
  r.locked = PRO_LOCKS;
  r.ingredients.forEach((i) => { delete i.detail; });
  r.interactions = { locked: true, count: undefined };
  r.alternatives = { locked: true };
  r.allergenAlerts = { locked: true };
  return r;
}

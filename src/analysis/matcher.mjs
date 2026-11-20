// Ingredientlarni bazaga moslashtirish. Faqat aniq moslik "tasdiqlangan"; fuzzy moslik hamisha "noaniq"
// va foydalanuvchi tasdiqlamaguncha tahlilga kirmaydi. Topilmagan modda xavfsiz/xavfli degan xulosa EMAS.
import { db } from '../db.mjs';
import { inciVariants, normInci, levenshtein } from '../util.mjs';

export function loadIndex() {
  const rows = db().prepare("SELECT a.alias_norm, a.kind, a.ingredient_id FROM ingredient_aliases a JOIN ingredients i ON i.id = a.ingredient_id WHERE i.status != 'archived'").all();
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.alias_norm)) map.set(r.alias_norm, []);
    map.get(r.alias_norm).push({ id: r.ingredient_id, kind: r.kind });
  }
  return map;
}

function fuzzyCandidates(norm, index) {
  if (norm.length < 5) return [];
  const maxD = norm.length <= 8 ? 1 : norm.length <= 14 ? 2 : 3;
  const best = new Map();
  for (const [alias, hits] of index) {
    if (Math.abs(alias.length - norm.length) > maxD) continue;
    const d = levenshtein(norm, alias, maxD);
    if (d <= maxD) for (const h of hits) if (!best.has(h.id) || best.get(h.id).d > d) best.set(h.id, { id: h.id, d, alias });
  }
  return [...best.values()].sort((a, b) => a.d - b.d).slice(0, 3);
}

export function matchOne(raw, index, ocrConfidence = null) {
  const variants = inciVariants(raw);
  const exactIds = new Map();
  let kindUsed = null;
  for (const v of variants) {
    for (const h of index.get(v) || []) { exactIds.set(h.id, h.kind); kindUsed = kindUsed || h.kind; }
  }
  const lowOcr = ocrConfidence != null && ocrConfidence < 60;
  if (exactIds.size === 1) {
    const [[id, kind]] = [...exactIds];
    return { raw, status: 'confirmed', matchType: kind, ingredientId: id, ocrConfidence, lowOcr };
  }
  if (exactIds.size > 1) {
    return { raw, status: 'uncertain', matchType: 'ambiguous', candidates: [...exactIds.keys()], ocrConfidence, lowOcr, reason: 'ambiguous' };
  }
  const norm = normInci(raw);
  const fz = fuzzyCandidates(norm, index);
  if (fz.length) return { raw, status: 'uncertain', matchType: 'fuzzy', candidates: fz.map((f) => f.id), ocrConfidence, lowOcr, reason: 'fuzzy' };
  return { raw, status: 'unmatched', ocrConfidence, lowOcr };
}

export function matchAll(items, index = loadIndex()) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const raw = typeof it === 'string' ? it : it.raw;
    const conf = typeof it === 'string' ? null : it.ocrConfidence ?? null;
    const m = matchOne(raw, index, conf);
    // Bir xil ingredient ikki marta chiqsa, takrorlanmaydi
    if (m.status === 'confirmed') { if (seen.has(m.ingredientId)) continue; seen.add(m.ingredientId); }
    out.push(m);
  }
  return out;
}

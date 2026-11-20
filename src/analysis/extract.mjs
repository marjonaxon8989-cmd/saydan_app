// OCR matnidan INCI ro'yxatini, taxminiy mahsulot nomini va sana nomzodlarini ajratib olish.
// MUHIM: hech narsa taxmin qilinmaydi — sana va PAO faqat "nomzod" sifatida qaytadi, foydalanuvchi tasdiqlaydi.

const START = /(ingredients?|ingr[eé]dients?|inci|composition|tarkib(?:i)?|состав(?:ь)?|ingredientlar)\s*[:：\-–]?\s*/i;
const STOP = /\b(directions?|how to use|usage|warnings?|caution|made in|manufactured|distributed|batch|lot\s*no|best before|use by|exp(?:iry)?\b|pao|www\.|https?:|barcode|store in|storage|qo['’‘ʻ]llash|ishlatish|применение|меры предосторожности|изготовитель|годен до|срок годности|произведено)/i;

export function extractIngredients(text, words = []) {
  const src = String(text ?? '').replace(/\r/g, '');
  const m = START.exec(src);
  const hasMarker = !!m;
  let body = m ? src.slice(m.index + m[0].length) : src;
  const stop = STOP.exec(body);
  if (stop && stop.index > 15) body = body.slice(0, stop.index);
  body = body.replace(/(\w)-\n(\w)/g, '$1$2').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
  const parts = body.split(/[,;•·|]+/).map((s) => s.trim().replace(/^[\.\-–:]+|[\.\-–:]+$/g, '').trim()).filter(Boolean);
  const confMap = new Map();
  for (const w of words) {
    const k = w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (!k) continue;
    if (!confMap.has(k)) confMap.set(k, []);
    confMap.get(k).push(w.conf);
  }
  const overall = words.length ? words.reduce((s, w) => s + w.conf, 0) / words.length : null;
  const items = [];
  for (const p of parts) {
    if (p.length < 2 || p.length > 90 || /^\d+([.,]\d+)?\s*%?$/.test(p)) continue;
    let confidence = overall;
    if (words.length) {
      const toks = p.toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
      const cs = [];
      for (const t of toks) { const arr = confMap.get(t); if (arr?.length) cs.push(arr.shift()); }
      if (cs.length) confidence = cs.reduce((a, b) => a + b, 0) / cs.length;
    }
    items.push({ raw: p, ocrConfidence: confidence == null ? null : Math.round(confidence) });
  }
  return { items, hasMarker };
}

const EXP_CUE = /(exp(?:iry)?(?:\s*date)?|best before|bb|use by|годен до|срок годности|до|muddati|yaroqlilik)\s*[:.]?\s*/i;
export function extractDateCandidates(text) {
  const out = [];
  const src = String(text ?? '');
  const re = new RegExp(EXP_CUE.source + '(\\d{1,2})?[\\s./\\-]?(\\d{1,2})[\\s./\\-](\\d{2,4})', 'gi');
  for (const m of src.matchAll(re)) {
    const [, , a, b, c] = m;
    let y = parseInt(c, 10);
    if (c.length === 2) y += 2000;
    if (a != null) {
      const d1 = parseInt(a, 10), d2 = parseInt(b, 10);
      const ambiguous = d1 <= 12 && d2 <= 12 && d1 !== d2;
      const day = ambiguous ? null : (d1 > 12 ? d1 : d2 > 12 ? d2 : d1);
      const month = ambiguous ? null : (d1 > 12 ? d2 : d2 > 12 ? d1 : d2);
      out.push({ type: 'expiry_candidate', text: m[0].trim(), iso: !ambiguous && month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null, ambiguous });
    } else {
      const month = parseInt(a ?? b, 10);
      out.push({ type: 'expiry_candidate', text: m[0].trim(), iso: null, month: month >= 1 && month <= 12 ? `${y}-${String(month).padStart(2, '0')}` : null, ambiguous: false });
    }
  }
  return out;
}
// PAO — ochilgandan keyingi oylar (masalan "12M"). Bu kalendar muddati EMAS.
export function extractPaoCandidates(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/(?<![\w/.])(\d{1,2})\s?M(?![\w])/g)) {
    const n = parseInt(m[1], 10);
    if (n >= 3 && n <= 60) out.push({ type: 'pao_candidate', months: n, text: m[0] });
  }
  return out;
}

export function guessProductName(text, words = []) {
  const m = START.exec(String(text ?? ''));
  const head = m ? String(text).slice(0, m.index) : '';
  const line = head.split('\n').map((s) => s.trim()).find((s) => /\p{L}{3,}/u.test(s) && s.length <= 60);
  if (!line) return null;
  const toks = line.toLowerCase().split(/\s+/);
  const cs = words.filter((w) => toks.includes(w.text.toLowerCase())).map((w) => w.conf);
  const c = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0;
  return c >= 70 ? { name: line, uncertain: true } : null;
}

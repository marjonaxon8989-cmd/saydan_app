// Muvofiqlik ko'rsatkichi (foiz) mantig'i — alohida, sinovdan o'tkaziladigan modul.
//
// QOIDALAR (hujjatlashtirilgan):
//  * Foiz FAQAT 'dry' va 'oily' uchun hisoblanadi va faqat TASDIQLANGAN (approved=1) tuzilgan baholar asosida.
//  * 'climate' va 'pregnancy' uchun foiz HECH QACHON hisoblanmaydi: iqlim taxminlari ilmiy dalil emas,
//    homiladorlik ma'lumoti esa tibbiy mavzu — faqat ma'lumot va ehtiyot choralari ko'rsatiladi.
//  * Ingredient tartibi/konsentratsiyasi HECH QACHON hisobga olinmaydi (konsentratsiya noma'lum).
//  * Yetarli qamrov bo'lmasa foiz ko'rsatilmaydi: "Ma'lumot yetarli emas".
//  * Foiz mahsulot sifati, mutlaq xavfsizlik yoki tibbiy tavsiya emas.
export const DIMENSIONS = ['climate', 'pregnancy', 'dry', 'oily'];
const STANCE_VALUE = { favorable: 1, neutral: 0.5, caution: 0 };
const EVIDENCE_WEIGHT = { high: 1, moderate: 0.7, low: 0.4 };
export const SCORABLE = new Set(['dry', 'oily']);

export const METHOD_UZ =
  "Foiz faqat tasdiqlangan baholari bor ingredientlar asosida, dalil darajasi bo'yicha vazn berib hisoblanadi " +
  "(qulay=1, neytral=0,5, ehtiyot=0). Ingredient tartibi yoki konsentratsiyasi hisobga olinmaydi, chunki aniq konsentratsiya noma'lum. " +
  "Bu ko'rsatkich mahsulot sifati yoki mutlaq xavfsizlik o'lchovi emas va tibbiy tavsiya hisoblanmaydi.";

export function scoreDimension(dimension, items, opts = {}) {
  const minAssessed = opts.minAssessed ?? 3;
  const minCoverage = opts.minCoverage ?? 0.6;
  const total = items.length;
  const base = { dimension, total, percent: null, method: METHOD_UZ };

  if (!SCORABLE.has(dimension)) {
    const withInfo = items.filter((i) => i.hasText || i.assessment).length;
    return { ...base, status: withInfo ? 'info_only' : 'insufficient', assessed: withInfo, coverage: total ? withInfo / total : 0, confidence: null,
      reason: dimension === 'climate' ? 'climate_no_percent' : 'pregnancy_no_percent' };
  }
  const assessed = items.filter((i) => i.assessment && i.assessment.approved === 1 && STANCE_VALUE[i.assessment.stance] != null);
  const coverage = total ? assessed.length / total : 0;
  if (assessed.length < minAssessed || coverage < minCoverage) {
    const anyInfo = items.some((i) => i.hasText || i.assessment);
    return { ...base, status: anyInfo ? 'info_only' : 'insufficient', assessed: assessed.length, coverage, confidence: null, reason: 'not_enough_coverage' };
  }
  let num = 0, den = 0, wsum = 0;
  for (const i of assessed) {
    const w = EVIDENCE_WEIGHT[i.assessment.evidence_level] ?? 0.4;
    num += w * STANCE_VALUE[i.assessment.stance];
    den += w; wsum += w;
  }
  const percent = Math.round((num / den) * 100);
  const avgW = wsum / assessed.length;
  const confidence = coverage >= 0.85 && avgW >= 0.8 ? 'high' : coverage >= 0.7 && avgW >= 0.6 ? 'medium' : 'low';
  return { ...base, status: 'scored', percent, assessed: assessed.length, coverage, confidence, reason: null };
}

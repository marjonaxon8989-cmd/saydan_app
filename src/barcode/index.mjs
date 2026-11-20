// Barcode ma'lumot manbai adapteri. Hech qachon uydirma natija qaytarmaydi.
// Open Beauty Facts: ochiq, kalitsiz API (ma'lumotlar ODbL litsenziyasida — foydalanishdan oldin shartlarni tekshiring:
// atribusiya va share-alike talablari). Ma'lumot to'liq/aniq bo'lmasligi mumkin (jamoa tomonidan to'ldiriladi).
import { cfg } from '../config.mjs';
import { sysEvent } from '../audit.mjs';

let fetchImpl = (...a) => fetch(...a);
export function setFetch(fn) { fetchImpl = fn; }   // faqat testlar uchun

export function validBarcode(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

export function status() {
  const p = cfg().barcodeProvider;
  if (p === 'none') return { provider: 'none', state: 'disabled', detail: "Barcode manbai o'chirilgan (BARCODE_PROVIDER=none)." };
  if (p === 'openbeautyfacts') return { provider: p, state: 'configured', detail: "Open Beauty Facts (ochiq ma'lumotlar, ODbL). Ma'lumot to'liq bo'lmasligi mumkin." };
  return { provider: p, state: 'unknown_provider', detail: "Noma'lum provayder." };
}

export async function lookup(code) {
  const c = cfg();
  if (c.barcodeProvider === 'none') return { state: 'disabled' };
  if (c.barcodeProvider !== 'openbeautyfacts') return { state: 'disabled' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetchImpl(`https://world.openbeautyfacts.org/api/v2/product/${code}.json?fields=product_name,brands,ingredients_text,image_front_url,code`, {
      headers: { 'User-Agent': c.barcodeUserAgent }, signal: ctrl.signal,
    });
    clearTimeout(t);
    if (r.status === 404) return { state: 'not_found' };
    if (!r.ok) { sysEvent('warn', 'barcode', `provayder HTTP ${r.status}`); return { state: 'error', status: r.status }; }
    const j = await r.json();
    if (j.status === 0 || !j.product) return { state: 'not_found' };
    const p = j.product;
    return {
      state: 'found', provider: 'openbeautyfacts',
      product: { barcode: code, name: p.product_name || null, brand: p.brands || null, ingredients_text: p.ingredients_text || null, image: p.image_front_url || null },
    };
  } catch (e) {
    sysEvent('warn', 'barcode', `provayderga ulanib bo'lmadi: ${e?.name || 'error'}`);
    return { state: 'unavailable' };
  }
}

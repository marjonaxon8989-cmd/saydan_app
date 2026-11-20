import { html, api, state, errMsg } from '../core.js';
import { STATUS_LABEL, lockedBlock, DIM_LABEL } from './result.js';

export default async function ingredient({ params }) {
  let i;
  try { i = await api.get('/api/ingredients/' + params.id); } catch (e) { return { html: html`<div class="wrap section"><div class="notice err">${errMsg(e)}</div><p><a href="#/ingredients">← Bazaga qaytish</a></p></div>` }; }
  const pro = i.plan === 'pro';
  const F = (l, v) => v ? html`<dt>${l}</dt><dd>${v}</dd>` : '';
  return { html: html`<div class="wrap section"><p><a href="#/ingredients">← Ingredientlar</a></p>
    <div class="page-head"><h1>${i.inci}</h1>${i.uz_name ? html`<p class="serif" style="font-size:1.6rem" class="muted">${i.uz_name}</p>` : ''}
      <div class="chips">${i.is_demo ? html`<span class="tag demo">DEMO — ilmiy tasdiqlanmagan</span>` : ''}<span class="tag ${i.status === 'approved' ? 'mint' : 'warn'}">${STATUS_LABEL[i.status] || i.status}</span><span class="tag">${i.pharmacist_approved ? 'Farmatsevt tasdiqlagan' : "Farmatsevt tekshiruvidan o'tmagan"}</span></div></div>
    <div class="notice warn"><span>ⓘ</span><span>${i.status === 'approved' ? '' : "Bu yozuv qoralama holatida: ma'lumotlar to'liq tekshirilmagan. "}Bu ma'lumot, tibbiy maslahat emas.</span></div>
    <div class="card" style="margin-top:1rem"><dl class="kv">${F('Vazifasi', i.function_uz)}${F('CosIng vazifalari', i.cosing_functions)}${F('Tavsif', i.description_uz)}${F('Sinonimlar', i.synonyms)}${F('CAS raqami', i.cas)}${F('Yozuv holati (asl)', i.review_status)}${F('Yangilangan', i.updated_at?.slice(0, 10))}</dl>
      ${i.sources.length ? html`<p><b>Manbalar</b></p><ul>${i.sources.map((u) => html`<li><a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a></li>`)}</ul>` : html`<p class="muted small">Manba havolasi kiritilmagan.</p>`}</div>
    <h2 style="margin-top:2rem">Batafsil ma'lumot</h2>
    ${pro ? html`<div class="card"><dl class="kv">${F('Batafsil izoh', i.detailed_explanation)}${F('Umumiy xavfsizlik', i.safety_general)}${F(DIM_LABEL.pregnancy, i.pregnancy_info)}${F(DIM_LABEL.dry, i.dry_info)}${F(DIM_LABEL.oily, i.oily_info)}${F(DIM_LABEL.sensitive, i.sensitive_info)}${F('Yevropa Ittifoqi cheklovlari', i.eu_restrictions)}${F('Allergen yorlig\'i', i.eu_allergen)}${F('SCCS', i.sccs)}${F('CIR', i.cir)}${F('PubChem (asl inglizcha)', i.pubchem_en)}${F('Farmatsevt izohi', i.pharmacist_comment)}</dl>
      <p class="small muted">Bo'sh qoldirilgan maydonlar — ma'lumot yo'q; ular xavfsiz yoki xavfli degan xulosa emas.</p></div>
      <h3 style="margin-top:1.5rem">Muqobillar</h3>${i.alternatives.length ? html`<p class="small muted">O'xshashlik faqat umumiy CosIng vazifalariga asoslangan; kimyoviy ekvivalentlik emas.</p><div class="table-wrap"><table class="t"><thead><tr><th>Muqobil</th><th>Vazifa o'xshashligi</th><th>Farqlar</th></tr></thead><tbody>${i.alternatives.map((a) => html`<tr><td>${a.alt}${a.alt_uz ? ' · ' + a.alt_uz : ''}</td><td>${a.similarity ?? '—'}</td><td>${a.differences || '—'}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Muqobil yozuvlar yo'q.</p>`}
      <h3 style="margin-top:1.5rem">Ta'sir yozuvlari</h3>${i.interactions.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>A</th><th>B</th><th>Tur</th><th>Izoh</th></tr></thead><tbody>${i.interactions.map((x) => html`<tr><td>${x.a}</td><td>${x.b}</td><td>${x.type || '—'}</td><td>${x.description || '—'}</td></tr>`)}</tbody></table></div><p class="small muted">Bu to'liq ro'yxat emas.</p>` : html`<p class="muted">Bazada yozuv yo'q (bu ta'sir yo'qligini bildirmaydi).</p>`}`
    : lockedBlock('Batafsil tushuntirish, ehtiyot choralari, muqobillar va ta\'sirlar')}
  </div>` };
}

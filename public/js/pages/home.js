import { html, raw, state, api, icon, stars, fmtDate, $ } from '../core.js';
import { t } from '../i18n.js';

const bottle = raw(`<svg viewBox="0 0 420 460" role="img" aria-label="SAYDAN tomizg'ichli flakon rasmi">
<defs>
<linearGradient id="glass" x1="0" x2="1"><stop offset="0" stop-color="#0b2a1d"/><stop offset=".45" stop-color="#1c5a3f"/><stop offset="1" stop-color="#0a2418"/></linearGradient>
<linearGradient id="gold" x1="0" x2="1"><stop offset="0" stop-color="#9c7a42"/><stop offset=".5" stop-color="#f2d6a6"/><stop offset="1" stop-color="#9c7a42"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#69C69B" stop-opacity=".35"/><stop offset="1" stop-color="#69C69B" stop-opacity="0"/></radialGradient>
</defs>
<circle cx="210" cy="190" r="170" fill="url(#glow)"/>
<circle cx="210" cy="190" r="150" fill="none" stroke="#EBCB98" stroke-opacity=".35" stroke-width="1.5"/>
<g fill="#1f6a47" opacity=".9"><path d="M60 410c10-70 60-110 130-120-10 70-60 115-130 120z"/><path d="M360 400c-10-70-60-100-120-100 5 65 55 105 120 100z" fill="#2b8a5f"/><path d="M110 330c-30-30-50-70-45-110 40 10 70 45 45 110z" fill="#17583a"/><path d="M320 320c30-30 45-65 38-100-38 8-62 40-38 100z" fill="#17583a"/></g>
<rect x="188" y="30" width="44" height="26" rx="13" fill="#f4ebdd" opacity=".92"/>
<rect x="176" y="52" width="68" height="40" rx="8" fill="url(#gold)"/>
<rect x="190" y="90" width="40" height="22" fill="#d9bb84"/>
<path d="M140 150c0-22 18-40 40-40h60c22 0 40 18 40 40v200c0 24-18 42-42 42h-56c-24 0-42-18-42-42z" fill="url(#glass)" stroke="#69C69B" stroke-opacity=".35"/>
<path d="M156 160c0-10 6-18 16-18" stroke="#fff" stroke-opacity=".25" stroke-width="3" fill="none" stroke-linecap="round"/>
<g transform="translate(210 255)" text-anchor="middle"><path d="M0 -42c-6 12-16 18-26 20 2 18 12 26 26 28 14-2 24-10 26-28-10-2-20-8-26-20z" fill="none" stroke="#EBCB98" stroke-width="2"/><text y="48" fill="#EBCB98" font-family="Georgia,serif" font-size="22" letter-spacing="4">SAYDAN</text></g>
<path d="M120 420c60 20 120 20 190-4" stroke="#69C69B" stroke-opacity=".25" fill="none"/>
</svg>`);

export default async function home() {
  const c = state.config;
  let reviews = [];
  try { reviews = (await api.get('/api/reviews/recent')).items; } catch { /* */ }
  const proPrice = c.plans.pro.pricing_approved ? new Intl.NumberFormat('uz-UZ').format(c.plans.pro.price_uzs) + " so'm / oy" : "Narx tez orada e'lon qilinadi";
  const n = c.counts;
  const dbText = n.ingredients > 0
    ? `Bazada hozir ${n.ingredients} ta ingredient, ${n.functions} ta kosmetik vazifa va ${n.alternatives} ta muqobil juftlik mavjud. Yozuvlar qoralama holatida va farmatsevt tekshiruvidan o'tmagan.`
    : n.demo_ingredients > 0 ? `Hozir faqat ${n.demo_ingredients} ta DEMO yozuv mavjud (ilmiy tasdiqlanmagan). Asosiy ingredient bazasi hali import qilinmagan.`
    : "Ingredient bazasi hozircha bo'sh: asosiy ma'lumotlar importi kutilmoqda. Shu paytgacha tahlil natijalari to'liq bo'lmaydi.";
  const cats = [['globe', 'cat.climate'], ['mother', 'cat.pregnancy'], ['drop', 'cat.dry'], ['drop2', 'cat.oily']];
  return {
    html: html`
<section class="hero"><div class="wrap hero-grid">
  <div class="stack">
    <span class="eyebrow">${t('hero.eyebrow')}</span>
    <h1>${t('hero.title1')} <br>${t('hero.title2')} <span class="em">${t('hero.title3')}</span></h1>
    <p class="lead">${t('hero.lead')}</p>
    <div class="row"><a class="btn primary" href="#/analyze">${icon('camera')}<span>${t('hero.cta')} →</span></a><a class="btn" href="#/barcode">${icon('barcode')}<span>${t('hero.barcode')}</span></a></div>
    ${c.counts.approved_ingredients === 0 ? html`<div class="notice warn" role="note"><span>⚠</span><span><b>Ma'lumot holati:</b> ingredient yozuvlari hozircha tasdiqlanmagan qoralama. SAYDAN tibbiy xulosa bermaydi.</span></div>` : ''}
  </div>
  <div class="hero-art">${bottle}
    <div class="hero-badge">${icon('leaf')}<span>${t('hero.badge')}</span></div>
    <div class="script" aria-hidden="true">${t('hero.script')}</div></div>
</div></section>

<section class="wrap" aria-label="Tahlil yo'nalishlari"><div class="cats">
  ${cats.map(([ic, k]) => html`<div class="cat">${icon(ic)}<div><b>${t(k)}</b><span class="muted small">${t('cat.note')}</span></div></div>`)}
</div></section>

<section class="section wrap" id="how"><h2>${t('how.title')}</h2><p class="muted">${t('how.lead')}</p>
  <div class="steps" style="margin-top:2rem">
    ${[1, 2, 3].map((i) => html`<div class="step"><h3>${t(`how.s${i}.t`)}</h3><p class="muted">${t(`how.s${i}.d`)}</p></div>`)}
  </div><p style="margin-top:1.5rem"><a class="btn primary" href="#/analyze">${t('hero.cta')} →</a></p></section>

<section class="section wrap"><div class="grid g2">
  <div class="card"><h2>${t('db.title')}</h2><p class="muted">${t('db.lead')}</p><p>${dbText}</p><a class="btn" href="#/ingredients">${t('db.open')} →</a></div>
  <div class="card"><span class="tag gold">${icon('crown')} Pro</span><h3 style="margin-top:.6rem">Pro imkoniyatlar</h3>
    <ul class="muted"><li>Barkod orqali tarkibni qidirish</li><li>Kengaytirilgan ingredient tushuntirishlari</li><li>Parvarish kundaligi, javon va eslatmalar</li><li>2–3 mahsulotni taqqoslash</li></ul><a class="btn primary" href="#/pro">${t('common.upgrade')} →</a></div>
</div></section>

<section class="section wrap" id="plans"><div class="center"><h2>${t('plans.title')}</h2><p class="muted">${t('plans.lead')}</p></div>
  <div class="plans" style="margin-top:1.5rem">
    <div class="card plan"><h3>Free</h3><div class="price">0 so'm</div><p class="muted small">Oyiga ${c.plans.free.monthly_limit} ta tahlilgacha</p>
      <ul><li>Yorliq rasmini yuklash va kamera</li><li>OCR va matnni qo'lda tuzatish</li><li>Asosiy ingredient ma'lumoti</li><li>4 yo'nalish bo'yicha asosiy baho (dalil yetarli bo'lsa)</li><li>Yaroqlilik muddatini tekshirish</li><li>Oxirgi ${c.plans.free.history_visible} ta tahlil tarixi</li></ul><a class="btn" href="#/analyze">Boshlash</a></div>
    <div class="card plan pro"><span class="tag demo">Pro</span><h3 style="margin-top:.5rem">Pro</h3><div class="price">${proPrice}</div>
      <ul><li>Barkod orqali qidirish</li><li>Batafsil tahlil va hisobotlar</li><li>Shaxsiy teri profili va allergen ogohlantirishi</li><li>Kundalik, tartiblar, eslatmalar, statistika</li><li>Mening javonim va muddat eslatmalari</li><li>Mahsulotlarni taqqoslash va to'liq tarix</li></ul><a class="btn primary" href="#/pro">${t('common.upgrade')}</a></div>
  </div></section>

${reviews.length ? html`<section class="section wrap"><h2>Foydalanuvchilar fikri</h2><div class="grid g3">${reviews.map((r) => html`<div class="card"><div class="star" aria-label="${r.rating} yulduz">${stars(r.rating)}</div><p>${r.body.length > 200 ? r.body.slice(0, 200) + '…' : r.body}</p><p class="muted small">${r.nickname} · <a href="#/community/${r.product_id}">${r.product_name}</a></p></div>`)}</div></section>` : ''}

<section class="section wrap"><h2>${t('faq.title')}</h2>
  <details class="faq"><summary>SAYDAN tibbiy maslahat beradimi?</summary><p class="muted">Yo'q. SAYDAN faqat ingredientlar haqidagi ma'lumotni tushunarli qilib ko'rsatadi. Tashxis qo'ymaydi, davolashni tavsiya qilmaydi. Yakuniy qaror uchun vrach yoki farmatsevt bilan maslahatlashing.</p></details>
  <details class="faq"><summary>Foiz ko'rsatkichi nimani anglatadi?</summary><p class="muted">Foiz faqat yetarli tasdiqlangan ma'lumot bo'lganda va faqat quruq/yog'li teri yo'nalishlari uchun hisoblanadi. U mahsulot sifati yoki mutlaq xavfsizlik o'lchovi emas. Ma'lumot yetarli bo'lmasa, foiz o'rniga "Ma'lumot yetarli emas" ko'rsatiladi.</p></details>
  <details class="faq"><summary>Nega ba'zi ingredientlar topilmaydi?</summary><p class="muted">Ingredient bazamiz hali to'liq emas. Topilmagan modda haqida xulosa chiqarilmaydi: yozuv yo'qligi uning xavfsiz yoki xavfli ekanini bildirmaydi.</p></details>
  <details class="faq"><summary>Yuklagan rasmlarim qancha saqlanadi?</summary><p class="muted">Tahlilni saqlamasangiz, rasm ${c.plans ? '24 soat' : ''} ichida avtomatik o'chiriladi. Tahlilni saqlasangiz ham rasm faqat siz alohida tanlasangizgina saqlanadi.</p></details>
  <details class="faq"><summary>Ingredient ro'yxatidagi tartib nimani bildiradi?</summary><p class="muted">Odatda ingredientlar konsentratsiyasi kamayish tartibida yoziladi, lekin aniq foizni bilib bo'lmaydi. Shuning uchun konsentratsiyaga bog'liq xulosalar chiqarmaymiz.</p></details>
</section>`,
  };
}

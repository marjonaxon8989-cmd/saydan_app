import { html, $, api, state, refreshMe, toast, errMsg, icon, fmtDate } from '../core.js';
import { t } from '../i18n.js';

export default async function pro() {
  api.post('/api/track', { type: 'pro_view' }).catch(() => {});
  const c = state.config, u = state.user;
  let sub = null;
  if (u) { try { sub = await api.get('/api/subscription'); } catch { /* */ } }
  const price = c.plans.pro.pricing_approved ? new Intl.NumberFormat('uz-UZ').format(c.plans.pro.price_uzs) + " so'm / oy" : "Narx hali tasdiqlanmagan";
  const payState = c.payments.state;
  const payMsg = { not_configured: "To'lov tizimi hali ulanmagan: hozircha haqiqiy to'lov qabul qilinmaydi.", sandbox: "SINOV REJIMI: soxta to'lov, haqiqiy pul yechilmaydi.", adapter_not_implemented: "Tanlangan to'lov provayderi uchun integratsiya hali amalga oshirilmagan." }[payState];
  return { html: html`<div class="wrap section"><div class="page-head center"><span class="tag gold">${icon('crown')} Pro</span><h1 style="margin-top:.6rem">SAYDAN Pro</h1><p class="muted">Chuqurroq ma'lumot va shaxsiy parvarish vositalari.</p></div>
    <div class="plans"><div class="card plan"><h3>Free</h3><div class="price">0 so'm</div><ul><li>Yorliq rasmi, kamera, OCR</li><li>Matnni qo'lda tuzatish</li><li>Asosiy ingredient ma'lumoti</li><li>Asosiy 4 yo'nalish bahosi (dalil yetarli bo'lsa)</li><li>Oxirgi ${c.plans.free.history_visible} ta tahlil</li><li class="off">Barkod, kundalik, javon, taqqoslash</li></ul></div>
    <div class="card plan pro"><span class="tag demo">Pro</span><h3 style="margin-top:.5rem">Pro</h3><div class="price">${price}</div>
      <ul><li>Barkod orqali qidirish</li><li>Batafsil ingredient ma'lumoti, muqobillar, ta'sirlar</li><li>Shaxsiy teri profili va allergen ogohlantirishi</li><li>Kundalik, tartiblar, eslatmalar va statistika</li><li>Mening javonim va muddat eslatmalari</li><li>2–3 mahsulotni taqqoslash, to'liq tarix, PDF</li></ul>
      ${u?.plan === 'pro' ? html`<div class="notice">Sizda Pro faol${sub?.subscription ? ` (${sub.subscription.simulated ? 'SINOV/DEMO' : 'haqiqiy'}, ${fmtDate(sub.subscription.period_end)} gacha)` : ''}.</div>`
        : u ? html`<button class="btn primary" id="buy" style="width:100%">${t('common.upgrade')}</button>` : html`<a class="btn primary" href="#/register" style="width:100%">Avval ro'yxatdan o'ting</a>`}
      <div id="pmsg" class="small muted" style="margin-top:.6rem">${payMsg || ''}</div>
      ${c.demoMode && u && u.plan !== 'pro' ? html`<button class="btn" id="demo" style="width:100%;margin-top:.6rem">DEMO Pro'ni sinash (7 kun)</button><p class="hint">Demo rejimi: bu haqiqiy obuna emas va faqat shu muhitda amal qiladi.</p>` : ''}
    </div></div>
    <p class="center small muted" style="margin-top:1.5rem">Narxlar va muddatlar loyiha egasi tomonidan tasdiqlanmaguncha sozlanadigan holatda. Avtomatik yangilanish holati hisobingiz sahifasida ko'rsatiladi.</p></div>`,
    mount: (root) => {
      $('#buy', root)?.addEventListener('click', async () => {
        try {
          const r = await api.post('/api/subscription/checkout');
          if (r.simulated && confirm("SINOV REJIMI: soxta to'lovni tasdiqlaysizmi? (haqiqiy pul yechilmaydi)")) { await api.post('/api/subscription/sandbox/simulate', { txn: r.txn, status: 'paid' }); await refreshMe(); toast('Sinov obunasi faollashtirildi (haqiqiy emas).'); window.__rerender(); }
        } catch (e) { $('#pmsg', root).innerHTML = `<span class="err">${errMsg(e)}</span>`; }
      });
      $('#demo', root)?.addEventListener('click', async () => { try { await api.post('/api/demo/activate-pro'); await refreshMe(); toast('DEMO Pro faollashtirildi.'); window.__rerender(); } catch (e) { toast(errMsg(e), 'err'); } });
    } };
}

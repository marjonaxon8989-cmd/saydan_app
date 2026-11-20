import { html, $, api, state, refreshMe, toast, errMsg, fmtDate, confirmDialog, navigate, esc } from '../core.js';
import { loginGate } from './gate.js';
import { lockedBlock } from './result.js';

const TABS = [['profile', 'Profil'], ['subscription', 'Obuna'], ['history', 'Tahlillar tarixi'], ['skin', 'Teri profili'], ['privacy', 'Maxfiylik'], ['referral', 'Taklif']];
export default async function account({ params, query }) {
  if (!state.user) return loginGate();
  const tab = params.tab || 'profile', u = state.user;
  const tabs = html`<div class="tabs">${TABS.map(([k, l]) => html`<a href="#/account/${k}" ${tab === k ? 'aria-current="page"' : ''}>${l}</a>`)}</div>`;
  let body, mount;
  if (tab === 'profile') {
    body = html`<div class="card stack">${!u.email_verified ? html`<div class="notice warn"><span>⚠</span><span>Emailingiz tasdiqlanmagan. Tasdiqlash havolasi ro'yxatdan o'tishda yuborilgan. Sharh yozish va admin huquqlari uchun tasdiq shart.</span></div>` : ''}
      <p class="muted">Email: <b>${u.email}</b> ${u.email_verified ? html`<span class="tag mint">tasdiqlangan</span>` : ''}</p>
      <form id="nf" class="row"><div class="grow"><label for="nick">Nik</label><input id="nick" type="text" value="${u.nickname}" maxlength="40" minlength="2"></div><button class="btn primary" style="align-self:end">Saqlash</button></form>
      <details><summary class="gold" style="cursor:pointer">Emailni o'zgartirish</summary><form id="ef" class="stack" style="margin-top:.8rem"><div class="field"><label for="ne">Yangi email</label><input id="ne" type="email" required></div><div class="field"><label for="ep">Joriy parol</label><input id="ep" type="password" autocomplete="current-password" required></div><button class="btn">Tasdiqlash havolasini yuborish</button><p class="hint">Yangi manzil tasdiqlanmaguncha email o'zgarmaydi.</p></form></details></div>`;
    mount = (r) => {
      $('#nf', r).onsubmit = async (e) => { e.preventDefault(); try { await api.patch('/api/me', { nickname: $('#nick', r).value }); await refreshMe(); toast('Saqlandi.'); } catch (er) { toast(errMsg(er), 'err'); } };
      $('#ef', r).onsubmit = async (e) => { e.preventDefault(); try { const x = await api.post('/api/me/email', { email: $('#ne', r).value, password: $('#ep', r).value }); toast(x.message); } catch (er) { toast(errMsg(er), 'err'); } };
    };
  } else if (tab === 'subscription') {
    const s = await api.get('/api/subscription');
    body = html`<div class="card stack"><p>Reja: <b>${s.plan === 'pro' ? 'Pro' : 'Free'}</b></p>
      ${s.subscription ? html`<p>Holat: ${s.subscription.status === 'canceled' ? 'avtomatik yangilanish o\'chirilgan' : 'faol'} · ${fmtDate(s.subscription.period_end)} gacha · Avtomatik yangilanish: <b>${s.subscription.auto_renew ? 'yoqilgan' : "o'chirilgan"}</b></p>${s.subscription.simulated ? html`<div class="notice warn"><span>ⓘ</span><span>Bu SINOV/DEMO obunasi — haqiqiy to'lov emas.</span></div>` : ''}${s.subscription.status === 'active' ? html`<button class="btn danger" id="cancel">Avtomatik yangilanishni bekor qilish</button>` : ''}` : html`<p class="muted">Faol obuna yo'q.</p><a class="btn primary" href="#/pro">Pro haqida</a>`}
      <p class="small muted">Oylik tahlillar: ${s.usage.used}/${s.usage.limit}.</p>
      ${s.demo_available ? html`<p class="small muted">Demo rejimi yoqilgan.</p>` : ''}</div>`;
    mount = (r) => $('#cancel', r)?.addEventListener('click', async () => { if (await confirmDialog("Avtomatik yangilanish bekor qilinsinmi? Pro muddat tugaguncha amal qiladi.")) { try { const x = await api.post('/api/subscription/cancel'); toast(x.message); window.__rerender(); } catch (er) { toast(errMsg(er), 'err'); } } });
  } else if (tab === 'history') {
    const h = await api.get('/api/analyses' + (state.user.plan === 'pro' && query.q ? '?q=' + encodeURIComponent(query.q) : ''));
    body = html`${state.user.plan === 'pro' ? html`<div class="field"><label for="hq">Tarixdan qidirish</label><input id="hq" type="search" placeholder="Mahsulot yoki brend"></div>` : ''}
      ${h.items.length ? html`<div class="stack">${h.items.map((i) => i.locked ? html`<div class="card">${lockedBlock('Eski tahlil', `Free rejada faqat oxirgi ${h.free_visible} ta tahlil ko'rinadi (${fmtDate(i.created_at)}).`)}</div>` : html`<a class="card" style="text-decoration:none;color:inherit;display:block" href="#/analysis/${i.id}"><b>${i.product_name || 'Nomsiz mahsulot'}</b> ${i.brand ? '· ' + i.brand : ''}<div class="small muted">${fmtDate(i.created_at)} · aniq mos ${i.counts?.confirmed ?? 0}/${i.counts?.total ?? 0}</div></a>`)}</div>` : html`<div class="empty">Hali saqlangan tahlil yo'q. <a href="#/analyze">Birinchi tahlilni boshlang</a>.</div>`}`;
    mount = (r) => $('#hq', r)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate('/account/history?q=' + encodeURIComponent(e.target.value)); });
  } else if (tab === 'skin') {
    if (state.user.plan !== 'pro') return { html: html`<div class="wrap section"><h1>Hisobim</h1>${tabs}${lockedBlock('Shaxsiy teri profili', "Pro rejada mavjud.")}</div>` };
    const p = (await api.get('/api/profile')).profile || {};
    const S = { skin_type: [['unknown', "Noma'lum"], ['dry', 'Quruq'], ['oily', "Yog'li"], ['combination', 'Aralash'], ['normal', 'Normal']], sensitivity: [['unknown', "Noma'lum"], ['low', 'Past'], ['medium', "O'rta"], ['high', 'Yuqori']] };
    body = html`<form id="pf" class="card stack"><div class="notice"><span>🔒</span><span class="small">Bu sezgir shaxsiy ma'lumot. U shifrlangan holda saqlanadi, faqat sizga ko'rinadi va istalgan vaqt o'chirib tashlanadi. Ommaviy sharhlarda yoki admin statistikasida ko'rsatilmaydi.</span></div>
      <div class="grid g2"><div class="field"><label for="st">Teri turi</label><select id="st">${S.skin_type.map(([v, l]) => html`<option value="${v}" ${p.skin_type === v ? 'selected' : ''}>${l}</option>`)}</select></div>
      <div class="field"><label for="se">Sezgirlik</label><select id="se">${S.sensitivity.map(([v, l]) => html`<option value="${v}" ${p.sensitivity === v ? 'selected' : ''}>${l}</option>`)}</select></div></div>
      <div class="field"><label for="al">Allergenlar (INCI nomi, vergul bilan)</label><input id="al" type="text" value="${(p.allergens || []).join(', ')}" placeholder="masalan: Parfum, Limonene"></div>
      <label class="check"><input type="checkbox" id="pg" ${p.pregnancy_pref ? 'checked' : ''}><span>Homiladorlik davri haqida ma'lumotni o'zim ixtiyoriy ravishda belgilayman.</span></label>
      <label class="check"><input type="checkbox" id="cs" required><span>Bu ma'lumotlarni saqlashga aniq roziligimni beraman.</span></label>
      <div class="row"><button class="btn primary">Saqlash</button><button type="button" class="btn danger" id="dp">Profilni o'chirish</button></div></form>`;
    mount = (r) => {
      $('#pf', r).onsubmit = async (e) => { e.preventDefault(); try { await api.put('/api/profile', { consent: $('#cs', r).checked, skin_type: $('#st', r).value, sensitivity: $('#se', r).value, allergens: $('#al', r).value.split(',').map((s) => s.trim()).filter(Boolean), pregnancy_pref: $('#pg', r).checked ? true : null }); toast('Profil saqlandi.'); } catch (er) { toast(errMsg(er), 'err'); } };
      $('#dp', r).onclick = async () => { if (await confirmDialog("Teri profili butunlay o'chirilsinmi?", "O'chirish")) { await api.del('/api/profile'); toast("O'chirildi."); window.__rerender(); } };
    };
  } else if (tab === 'privacy') {
    body = html`<div class="card stack"><h3>Ma'lumotlarim</h3><p class="muted">Barcha saqlangan ma'lumotlaringizni JSON ko'rinishida yuklab olishingiz mumkin.</p><p><a class="btn" href="/api/me/export" download>Ma'lumotlarimni yuklab olish</a></p>
      <h3>Hisobni o'chirish</h3><p class="muted">Hisob, tahlillar, javon, kundalik, sharhlar va yuklangan rasmlar o'chiriladi. Bu amalni qaytarib bo'lmaydi.</p>
      <form id="df" class="row"><div class="grow"><label for="dp">Parolni tasdiqlang</label><input id="dp" type="password" autocomplete="current-password" required></div><button class="btn danger" style="align-self:end">Hisobni o'chirish</button></form></div>`;
    mount = (r) => $('#df', r).onsubmit = async (e) => { e.preventDefault(); if (!(await confirmDialog("Hisobingiz butunlay o'chirilsinmi?", "Ha, o'chirish"))) return; try { await api.post('/api/me/delete', { password: $('#dp', r).value }); await refreshMe(); toast("Hisob o'chirildi."); navigate('/'); window.__rerender(); } catch (er) { toast(errMsg(er), 'err'); } };
  } else {
    const r = await api.get('/api/referral');
    body = html`<div class="card stack"><p>Do'stlaringizga havolangizni yuboring:</p><input type="text" readonly value="${r.link}" aria-label="Taklif havolasi"><p class="muted">Taklif qilinganlar: <b>${r.invited}</b></p>${!r.reward_enabled ? html`<div class="notice warn"><span>ⓘ</span><span>${r.reward_note}</span></div>` : ''}</div>`;
  }
  return { html: html`<div class="wrap section"><div class="page-head"><h1>Hisobim</h1></div>${tabs}${body}</div>`, mount };
}

import { html, state, icon } from '../core.js';
import { lockedBlock } from './result.js';
export const loginGate = () => ({ html: html`<div class="wrap section"><div class="card form-narrow center"><p>Bu sahifa uchun hisobingizga kiring.</p><div class="row" style="justify-content:center"><a class="btn primary" href="#/login">Kirish</a><a class="btn" href="#/register">Ro'yxatdan o'tish</a></div></div></div>` });
export const proGate = (title, desc) => ({ html: html`<div class="wrap section"><div class="page-head"><h1>${title}</h1><p class="muted">${desc}</p></div>
  ${lockedBlock(title, "Bu imkoniyat Pro rejada mavjud. Oldindan ko'rish — haqiqiy natijalar emas.")}
  <p style="margin-top:1rem"><a class="btn primary" href="#/pro">${'Pro haqida'}</a></p></div>` });
export function guard(feature, title, desc) {
  if (!state.user) return loginGate();
  if (state.user.plan !== 'pro') return proGate(title, desc);
  return null;
}

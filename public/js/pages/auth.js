import { html, $, api, state, refreshMe, navigate, toast, errMsg, esc } from '../core.js';
import { t } from '../i18n.js';

function formPage(title, fields, submitLabel, extra = '') {
  return html`<div class="wrap section"><div class="card form-narrow"><h1 style="font-size:2.2rem">${title}</h1>
    <form id="af" class="stack" novalidate>${fields}<div id="msg" class="err" role="alert"></div><button class="btn primary" style="width:100%" type="submit">${submitLabel}</button></form>${extra}</div></div>`;
}
const emailF = html`<div class="field"><label for="em">${t('auth.email')}</label><input id="em" type="email" autocomplete="email" required></div>`;
const passF = (ac, hint = false) => html`<div class="field"><label for="pw">${t('auth.password')}</label><input id="pw" type="password" autocomplete="${ac}" required minlength="10">${hint ? html`<div class="hint">${t('auth.passHint')}</div>` : ''}</div>`;
function bind(root, handler) {
  const f = $('#af', root), msg = $('#msg', root);
  f.addEventListener('submit', async (e) => { e.preventDefault(); msg.textContent = ''; const btn = f.querySelector('button[type=submit]'); btn.disabled = true; try { await handler(msg); } catch (er) { msg.textContent = errMsg(er); } btn.disabled = false; });
}

export default async function auth({ path, query }) {
  if (path === '/login') return { html: formPage(t('auth.login'), html`${emailF}${passF('current-password')}`, t('auth.login'), html`<p class="small center" style="margin-top:1rem"><a href="#/forgot">${t('auth.forgot')}</a> · ${t('auth.noAccount')} <a href="#/register">${t('nav.register')}</a></p>`),
    mount: (root) => bind(root, async () => { await api.post('/api/auth/login', { email: $('#em', root).value, password: $('#pw', root).value }); await refreshMe(); toast('Xush kelibsiz!'); navigate(state.user?.role ? '/account' : '/analyze'); window.__rerender?.(); }) };
  if (path === '/register') return { html: formPage(t('auth.register'), html`<div class="field"><label for="nk">${t('auth.nickname')}</label><input id="nk" type="text" minlength="2" maxlength="40" autocomplete="nickname" required></div>${emailF}${passF('new-password', true)}
      <label class="check"><input type="checkbox" id="ok" required><span>${t('auth.consent')} (<a href="#/privacy">Maxfiylik</a>, <a href="#/terms">Shartlar</a>)</span></label>`, t('auth.register'), html`<p class="small center" style="margin-top:1rem">${t('auth.haveAccount')} <a href="#/login">${t('nav.login')}</a></p>`),
    mount: (root) => bind(root, async (msg) => { if (!$('#ok', root).checked) { msg.textContent = "Davom etish uchun shartlarga rozilik bering."; return; }
      const r = await api.post('/api/auth/register', { email: $('#em', root).value, password: $('#pw', root).value, nickname: $('#nk', root).value });
      $('#af', root).outerHTML = `<div class="notice">${esc(r.message)}</div><p class="small muted">Tasdiqlash havolasi kelmasa, spam papkasini tekshiring. Tasdiqlangandan keyin <a href="#/login">kirishingiz</a> mumkin.</p>`; }) };
  if (path === '/forgot') return { html: formPage('Parolni tiklash', emailF, 'Havola yuborish'), mount: (root) => bind(root, async () => { const r = await api.post('/api/auth/forgot', { email: $('#em', root).value }); $('#af', root).outerHTML = `<div class="notice">${esc(r.message)}</div>`; }) };
  if (path === '/reset') return { html: formPage('Yangi parol', passF('new-password', true), 'Parolni saqlash'), mount: (root) => bind(root, async () => { await api.post('/api/auth/reset', { token: query.token, password: $('#pw', root).value }); toast("Parol yangilandi. Endi kiring."); navigate('/login'); }) };
  if (path === '/verify') {
    let ok = false, msg = '';
    try { await api.post('/api/auth/verify-email', { token: query.token }); ok = true; } catch (e) { msg = errMsg(e); }
    if (ok) await refreshMe();
    return { html: html`<div class="wrap section"><div class="card form-narrow center"><h1 style="font-size:2rem">${ok ? 'Email tasdiqlandi' : 'Tasdiqlab bo\'lmadi'}</h1><p class="muted">${ok ? 'Hisobingiz tasdiqlandi.' : msg}</p><a class="btn primary" href="#/${state.user ? 'account' : 'login'}">${state.user ? 'Hisobim' : 'Kirish'}</a></div></div>` };
  }
  if (path === '/verify-email-change') {
    let ok = false, msg = '';
    try { if (!state.user) throw new Error('login'); await api.post('/api/me/email/confirm', { token: query.token }); ok = true; await refreshMe(); } catch (e) { msg = e.message === 'login' ? "Avval hisobingizga kiring, so'ng havolani qayta oching." : errMsg(e); }
    return { html: html`<div class="wrap section"><div class="card form-narrow center"><h1 style="font-size:2rem">${ok ? 'Email yangilandi' : "Tasdiqlab bo'lmadi"}</h1><p class="muted">${ok ? 'Yangi email tasdiqlandi.' : msg}</p><a class="btn primary" href="#/account">Hisobim</a></div></div>` };
  }
}

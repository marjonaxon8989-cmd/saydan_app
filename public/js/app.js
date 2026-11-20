import { $, $$, html, state, api, refreshMe, loadConfig, parseHash, navigate, toast, errMsg, logoSvg } from './core.js';
import { t } from './i18n.js';

const ROUTES = [
  ['/', () => import('./pages/home.js')], ['/how', () => import('./pages/home.js')],
  ['/analyze', () => import('./pages/analyze.js')], ['/analysis/:id', () => import('./pages/analysis.js')],
  ['/ingredients', () => import('./pages/library.js')], ['/ingredients/:id', () => import('./pages/ingredient.js')],
  ['/login', () => import('./pages/auth.js')], ['/register', () => import('./pages/auth.js')], ['/forgot', () => import('./pages/auth.js')],
  ['/reset', () => import('./pages/auth.js')], ['/verify', () => import('./pages/auth.js')], ['/verify-email-change', () => import('./pages/auth.js')],
  ['/account', () => import('./pages/account.js')], ['/account/:tab', () => import('./pages/account.js')],
  ['/pro', () => import('./pages/pro.js')], ['/diary', () => import('./pages/diary.js')], ['/diary/:tab', () => import('./pages/diary.js')],
  ['/shelf', () => import('./pages/shelf.js')], ['/compare', () => import('./pages/compare.js')], ['/barcode', () => import('./pages/barcode.js')],
  ['/community', () => import('./pages/community.js')], ['/community/:id', () => import('./pages/community.js')],
  ['/admin', () => import('./pages/admin.js')], ['/admin/:tab', () => import('./pages/admin.js')],
  ['/privacy', () => import('./pages/legal.js')], ['/terms', () => import('./pages/legal.js')],
];
function matchRoute(path) {
  for (const [pattern, loader] of ROUTES) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    const m = re.exec(path);
    if (m) return { loader, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

let cleanup = null;
async function render() {
  const { path, query } = parseHash();
  const main = $('#main');
  if (cleanup) { try { cleanup(); } catch { /* */ } cleanup = null; }
  const m = matchRoute(path);
  renderHeader(path);
  if (!m) { main.innerHTML = html`<div class="wrap section center"><h1>404</h1><p class="muted">Sahifa topilmadi.</p><a class="btn primary" href="#/">Bosh sahifa</a></div>`.__raw; return; }
  main.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
  try {
    const mod = await m.loader();
    const res = await mod.default({ path, query, params: m.params, main });
    if (res?.html) main.innerHTML = res.html.__raw;
    if (res?.mount) { const c = await res.mount(main); if (typeof c === 'function') cleanup = c; }
    if (path === '/how') requestAnimationFrame(() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' }));
    else if (!res?.keepScroll) window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    main.innerHTML = html`<div class="wrap section"><div class="notice err">${errMsg(e)}</div></div>`.__raw;
  }
}

function renderHeader(path) {
  const u = state.user;
  const cur = (p, exact) => ((exact ? path === p : path === p || path.startsWith(p + '/')) ? 'aria-current="page"' : '');
  const showAdmin = u && u.role;
  $('#header').innerHTML = `<div class="wrap nav">
    <a class="brand" href="#/" aria-label="SAYDAN — bosh sahifa">${logoSvg.__raw}<span>SAYDAN</span></a>
    <button class="btn ghost menu-btn" id="menuBtn" aria-expanded="false" aria-controls="navLinks">${t('nav.menu')}</button>
    <nav class="nav-links" id="navLinks" aria-label="Asosiy">
      <a href="#/analyze" ${cur('/analyze')}>${t('nav.check')}</a>
      <a href="#/how" ${cur('/how', true)}>${t('nav.how')}</a>
      <a href="#/ingredients" ${cur('/ingredients')}>${t('nav.ingredients')}</a>
      <a href="#/community" ${cur('/community')}>${t('nav.community')}</a>
      ${u ? `<a href="#/diary" ${cur('/diary')}>${t('nav.diary')}</a><a href="#/shelf" ${cur('/shelf')}>${t('nav.shelf')}</a>` : ''}
      <a href="#/pro" ${cur('/pro')}>${t('nav.pro')}</a>
      ${showAdmin ? `<a href="#/admin" ${cur('/admin')}>${t('nav.admin')}</a>` : ''}
    </nav>
    <div class="nav-actions" id="navActions">
      ${u ? `<a class="btn sm" href="#/account">${esc2(u.nickname)}</a><button class="btn sm ghost" id="logoutBtn">${t('nav.logout')}</button>`
          : `<a class="btn sm" href="#/login">${t('nav.login')}</a><a class="btn sm primary" href="#/register">${t('nav.register')}</a>`}
    </div></div>`;
  const btn = $('#menuBtn'), links = $('#navLinks'), acts = $('#navActions');
  btn?.addEventListener('click', () => { const o = links.classList.toggle('open'); acts.classList.toggle('open', o); btn.setAttribute('aria-expanded', o); document.documentElement.style.setProperty('--menu-h', links.offsetHeight + 'px'); });
  links?.addEventListener('click', () => { links.classList.remove('open'); acts.classList.remove('open'); });
  $('#logoutBtn')?.addEventListener('click', async () => { try { await api.post('/api/auth/logout'); } catch { /* */ } state.user = null; state.csrf = null; await refreshMe(); toast('Tizimdan chiqdingiz.'); navigate('/'); });
}
const esc2 = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderFooter() {
  $('#footer').innerHTML = `<div class="wrap footer-grid">
    <div><a class="brand" href="#/">${logoSvg.__raw}<span>SAYDAN</span></a><p class="muted small" style="margin-top:.6rem">${t('footer.tag')}</p><p class="small muted">${t('disclaimer')}</p></div>
    <div><b class="serif gold">Platforma</b><a href="#/analyze">${t('nav.check')}</a><a href="#/ingredients">${t('nav.ingredients')}</a><a href="#/community">${t('nav.community')}</a><a href="#/pro">${t('nav.pro')}</a></div>
    <div><b class="serif gold">Huquqiy</b><a href="#/privacy">${t('footer.privacy')}</a><a href="#/terms">${t('footer.terms')}</a></div></div>`;
}

async function boot() {
  try { await Promise.all([refreshMe(), loadConfig()]); } catch (e) { console.error(e); }
  renderFooter();
  // UTM / referral kuzatuvi (shaxsiy ma'lumotsiz)
  const q = new URLSearchParams(location.search);
  if (q.has('utm_source') || q.has('ref')) {
    api.post('/api/track', { type: 'visit', utm_source: q.get('utm_source'), utm_medium: q.get('utm_medium'), utm_campaign: q.get('utm_campaign'), ref: q.get('ref') }).catch(() => {});
    history.replaceState(null, '', location.pathname + location.hash);
  } else if (!sessionStorage.getItem('visited')) { sessionStorage.setItem('visited', '1'); api.post('/api/track', { type: 'visit' }).catch(() => {}); }
  window.addEventListener('hashchange', render);
  window.__rerender = render;
  render();
}
boot();
export { render };

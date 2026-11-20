import { html, $, api, state, debounce, errMsg } from '../core.js';
import { t } from '../i18n.js';
import { STATUS_LABEL } from './result.js';

const tag = (i) => html`${i.is_demo ? html`<span class="tag demo">DEMO</span>` : ''}<span class="tag ${i.status === 'approved' ? 'mint' : 'warn'}">${STATUS_LABEL[i.status] || i.status}</span>`;
export default async function library({ query }) {
  const fns = (await api.get('/api/functions')).items;
  const tab = query.tab || 'list';
  const tabs = html`<div class="tabs" role="tablist"><a href="#/ingredients" ${tab === 'list' ? 'aria-current="page"' : ''}>Ingredientlar</a><a href="#/ingredients?tab=functions" ${tab === 'functions' ? 'aria-current="page"' : ''}>Kosmetik vazifalar</a><a href="#/ingredients?tab=groups" ${tab === 'groups' ? 'aria-current="page"' : ''}>Birlashgan vazifa guruhlari</a></div>`;
  if (tab === 'functions') return { html: html`<div class="wrap section"><div class="page-head"><h1>Kosmetik vazifalar</h1></div>${tabs}
    ${fns.length ? html`<div class="grid g2">${fns.map((f) => html`<div class="card"><h3>${f.name_uz || f.name_en}</h3>${f.name_uz ? html`<p class="small muted">${f.name_en}</p>` : ''}<p>${f.definition_uz || html`<span class="muted">Ta'rif kiritilmagan.</span>`}</p>${f.ingredient_count != null ? html`<p class="small muted">Bog'liq ingredientlar: ${f.ingredient_count}</p>` : ''}<a class="small" href="#/ingredients?fn=${encodeURIComponent(f.name_en)}">Shu vazifadagi ingredientlar →</a></div>`)}</div>` : html`<div class="empty">Vazifalar bazasi hali import qilinmagan.</div>`}</div>` };
  if (tab === 'groups') { const g = (await api.get('/api/function-groups')).items;
    return { html: html`<div class="wrap section"><div class="page-head"><h1>Birlashgan vazifa guruhlari</h1><p class="muted">Ta'limiy bo'lim: bir nechta vazifani birlashtirgan guruhlar.</p></div>${tabs}
      ${g.length ? html`<div class="grid g2">${g.map((x) => html`<div class="card"><h3>${x.name}</h3><p>${x.description || ''}</p>${x.examples ? html`<p class="small muted">Misollar: ${x.examples}</p>` : ''}<span class="tag ${x.pharmacist_approved ? 'mint' : 'warn'}">${x.pharmacist_approved ? 'Farmatsevt tasdiqlagan' : "Farmatsevt tekshiruvidan o'tmagan"}</span>${x.sources.map((u) => html` <a class="small" href="${u}" target="_blank" rel="noopener noreferrer">manba</a>`)}</div>`)}</div>` : html`<div class="empty">Guruhlar hali import qilinmagan.</div>`}</div>` }; }
  return { html: html`<div class="wrap section"><div class="page-head"><h1>${t('db.title')}</h1><p class="muted">INCI, o'zbekcha nom yoki sinonim bo'yicha qidiring.</p></div>${tabs}
    <div class="grid g2" style="margin-bottom:1rem"><div class="field"><label for="q">Qidiruv</label><input id="q" type="search" placeholder="Masalan: glycerin, glitserin" value="${query.q || ''}"></div>
      <div class="field"><label for="fn">Vazifa bo'yicha</label><select id="fn"><option value="">Barchasi</option>${fns.map((f) => html`<option value="${f.name_en}" ${query.fn === f.name_en ? 'selected' : ''}>${f.name_uz || f.name_en}</option>`)}</select></div></div>
    <div id="list" aria-live="polite"></div></div>`,
    mount: (root) => {
      const list = $('#list', root); let page = 1;
      async function load() {
        list.innerHTML = '<div class="loading">Yuklanmoqda…</div>';
        try {
          const r = await api.get(`/api/ingredients?q=${encodeURIComponent($('#q', root).value)}&fn=${encodeURIComponent($('#fn', root).value)}&page=${page}`);
          list.innerHTML = (r.items.length ? html`<p class="muted small">${r.total} ta natija</p><div class="grid g2">${r.items.map((i) => html`<a class="card" style="text-decoration:none;color:inherit" href="#/ingredients/${i.id}"><h3>${i.inci}</h3>${i.uz_name ? html`<p class="muted">${i.uz_name}</p>` : ''}<p class="small">${i.function_uz || i.cosing_functions || ''}</p><div class="chips">${tag(i)}</div></a>`)}</div>
            <div class="row" style="justify-content:center;margin-top:1rem">${page > 1 ? html`<button class="btn sm" data-p="${page - 1}">← Oldingi</button>` : ''}<span class="muted small">${r.page}/${r.pages || 1}</span>${page < r.pages ? html`<button class="btn sm" data-p="${page + 1}">Keyingi →</button>` : ''}</div>`
            : html`<div class="empty">${state.config.counts.ingredients + state.config.counts.demo_ingredients === 0 ? "Ingredient bazasi hali to'ldirilmagan (asosiy ma'lumotlar importi kutilmoqda)." : "Hech narsa topilmadi. Boshqa so'z bilan urinib ko'ring."}</div>`).__raw;
        } catch (e) { list.innerHTML = `<div class="notice err">${errMsg(e)}</div>`; }
      }
      $('#q', root).addEventListener('input', debounce(() => { page = 1; load(); }));
      $('#fn', root).addEventListener('change', () => { page = 1; load(); });
      list.addEventListener('click', (e) => { const p = e.target.dataset.p; if (p) { page = parseInt(p, 10); load(); } });
      load();
    } };
}

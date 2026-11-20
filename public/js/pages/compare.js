import { html, $, $$, api, toast, errMsg, fmtDate } from '../core.js';
import { guard } from './gate.js';
import { DIM_LABEL, STATUS_LABEL } from './result.js';

export default async function compare() {
  const g = guard('compare', "Mahsulotlarni taqqoslash", "Saqlangan 2–3 tahlilni yonma-yon ko'ring."); if (g) return g;
  const h = await api.get('/api/analyses');
  const items = h.items.filter((i) => !i.locked);
  return { html: html`<div class="wrap section"><div class="page-head"><h1>Mahsulotlarni taqqoslash</h1><p class="muted">Saqlangan tahlillardan 2 yoki 3 tasini tanlang.</p></div>
    ${items.length < 2 ? html`<div class="empty">Taqqoslash uchun kamida 2 ta saqlangan tahlil kerak. <a href="#/analyze">Tahlil qiling</a>.</div>` : html`<form id="cf" class="card stack"><fieldset style="border:0;padding:0;margin:0"><legend class="muted small">Tahlillar</legend>${items.map((i) => html`<label class="check"><input type="checkbox" value="${i.id}"><span>${i.product_name || 'Nomsiz'} ${i.brand ? '· ' + i.brand : ''} <span class="muted small">(${fmtDate(i.created_at)})</span></span></label>`)}</fieldset><div class="row"><button class="btn primary">Taqqoslash</button></div></form>`}
    <div id="out" style="margin-top:1.5rem" aria-live="polite"></div></div>`,
    mount: (r) => {
      $('#cf', r)?.addEventListener('submit', async (e) => {
        e.preventDefault(); const ids = $$('input:checked', r).map((x) => x.value); const out = $('#out', r);
        try {
          const d = await api.post('/api/compare', { ids });
          out.innerHTML = html`<div class="table-wrap"><table class="t"><thead><tr><th></th>${d.products.map((p) => html`<th>${p.name}</th>`)}</tr></thead><tbody>
            <tr><td>Aniq mos ingredientlar</td>${d.products.map((p) => html`<td>${p.counts.confirmed}/${p.counts.total}</td>`)}</tr>
            <tr><td>Ma'lumot to'liqligi</td>${d.products.map((p) => html`<td>${p.completeness ?? '—'}${p.completeness != null ? '%' : ''}</td>`)}</tr>
            ${['climate', 'pregnancy', 'dry', 'oily'].map((k) => html`<tr><td>${DIM_LABEL[k]}</td>${d.products.map((p) => html`<td>${p.dimensions[k].status === 'scored' ? p.dimensions[k].percent + '% (' + p.dimensions[k].confidence + ')' : p.dimensions[k].status === 'info_only' ? "Faqat ma'lumot" : "Ma'lumot yetarli emas"}</td>`)}</tr>`)}
            <tr><td>Narx</td>${d.products.map((p) => html`<td>${p.price_uzs ? new Intl.NumberFormat('uz-UZ').format(p.price_uzs) + " so'm (manba: " + (p.price_source || '—') + ')' : "tasdiqlangan narx yo'q"}</td>`)}</tr></tbody></table></div>
            <div class="card" style="margin-top:1rem"><h3>Umumiy ingredientlar (${d.shared.length})</h3><div class="chips">${d.shared.length ? d.shared.map((i) => html`<a class="tag" href="#/ingredients/${i.id}">${i.inci}</a>`) : html`<span class="muted">Umumiy aniq ingredient yo'q.</span>`}</div></div>
            <div class="grid g3" style="margin-top:1rem">${d.different.map((x) => html`<div class="card"><h3>Faqat ${x.product}da</h3><div class="chips">${x.only.length ? x.only.map((i) => html`<a class="tag" href="#/ingredients/${i.id}">${i.inci}</a>`) : html`<span class="muted small">—</span>`}</div></div>`)}</div>
            <p class="small muted" style="margin-top:1rem">${d.note}</p>`.__raw;
        } catch (er) { out.innerHTML = `<div class="notice err">${errMsg(er)}</div>`; }
      });
    } };
}

import { html, $, $$, api, toast, errMsg, confirmDialog, fmtDate, debounce } from '../core.js';
import { guard } from './gate.js';

const exp = (e) => e.status === 'unknown' ? html`<span class="tag">Muddat kiritilmagan</span>` : e.status === 'expired' ? html`<span class="tag warn">Muddati o'tgan</span>` : e.status === 'soon' ? html`<span class="tag warn">${e.days_left} kun qoldi</span>` : html`<span class="tag mint">${e.days_left} kun qoldi</span>`;
export default async function shelf({ query }) {
  const g = guard('shelf', 'Mening javonim', "Mahsulotlaringizni, ochilgan va yaroqlilik sanalarini saqlang."); if (g) return g;
  const q = query.q || '';
  const [list, soon] = await Promise.all([api.get('/api/shelf' + (q ? '?q=' + encodeURIComponent(q) : '')), api.get('/api/shelf/expiring')]);
  return { html: html`<div class="wrap section"><div class="page-head"><h1>Mening javonim</h1></div>
    ${soon.items.length ? html`<div class="notice warn" role="alert"><span>⏰</span><span><b>Muddati yaqinlashgan:</b> ${soon.items.map((i) => `${i.name} (${i.expiry.status === 'expired' ? "o'tgan" : i.expiry.days_left + ' kun'})`).join(', ')}</span></div>` : ''}
    <div class="grid g2" style="margin-top:1rem"><form id="sf" class="card stack"><h3>Mahsulot qo'shish</h3>
      <div class="field"><label for="n">Nomi</label><input id="n" type="text" required minlength="2" maxlength="120"></div><div class="field"><label for="b">Brend</label><input id="b" type="text" maxlength="80"></div>
      <div class="field"><label for="ing">Ingredientlar (ixtiyoriy)</label><textarea id="ing" rows="3" maxlength="4000"></textarea></div>
      <div class="grid g2"><div class="field"><label for="pd">Sotib olingan sana</label><input id="pd" type="date"></div><div class="field"><label for="od">Ochilgan sana</label><input id="od" type="date"></div>
      <div class="field"><label for="ed">Yaroqlilik muddati (aniq sana)</label><input id="ed" type="date"><div class="hint">Bilmasangiz bo'sh qoldiring — taxmin qilinmaydi.</div></div>
      <div class="field"><label for="pao">PAO (oy)</label><input id="pao" type="number" min="1" max="60"><div class="hint">PAO kalendar sana emas.</div></div></div>
      <div class="field"><label for="rd">Necha kun oldin eslatish</label><input id="rd" type="number" min="0" max="365" value="30"></div><button class="btn primary">Qo'shish</button></form>
    <div><div class="field"><label for="sq">Javondan qidirish</label><input id="sq" type="search" value="${q}"></div>
      ${list.items.length ? list.items.map((i) => html`<div class="card" style="margin-bottom:.7rem"><div class="row"><b class="grow">${i.name}</b>${exp(i.expiry)}</div><p class="small muted">${i.brand || ''} ${i.opened_date ? '· ochilgan ' + fmtDate(i.opened_date) : ''} ${i.expiry_date ? '· muddat ' + fmtDate(i.expiry_date) : ''}</p>${i.pao_due ? html`<p class="small muted">${i.pao_due_note} (${fmtDate(i.pao_due)})</p>` : ''}<button class="btn sm danger" data-del="${i.id}">O'chirish</button></div>`) : html`<div class="empty">Javon bo'sh.</div>`}</div></div></div>`,
    mount: (r) => {
      $('#sf', r).onsubmit = async (e) => { e.preventDefault(); try { await api.post('/api/shelf', { name: $('#n', r).value, brand: $('#b', r).value, ingredients_text: $('#ing', r).value, purchase_date: $('#pd', r).value, opened_date: $('#od', r).value, expiry_date: $('#ed', r).value, pao_months: $('#pao', r).value, reminder_days: $('#rd', r).value }); toast("Qo'shildi."); window.__rerender(); } catch (er) { toast(errMsg(er), 'err'); } };
      $('#sq', r).addEventListener('input', debounce((e) => { location.hash = '#/shelf?q=' + encodeURIComponent(e.target.value); }, 500));
      r.addEventListener('click', async (e) => { const id = e.target.dataset.del; if (id && await confirmDialog("Mahsulot javondan o'chirilsinmi?", "O'chirish")) { await api.del('/api/shelf/' + id); window.__rerender(); } });
    } };
}

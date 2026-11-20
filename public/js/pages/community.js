import { html, $, $$, api, state, toast, errMsg, stars, fmtDate, debounce, esc } from '../core.js';

export default async function community({ params }) {
  if (params.id) return productPage(params.id);
  const d = await api.get('/api/products');
  return { html: html`<div class="wrap section"><div class="page-head"><h1>Hamjamiyat</h1><p class="muted">Mahsulotlar bo'yicha haqiqiy foydalanuvchi sharhlari. Sharhlar tibbiy maslahat emas.</p></div>
    <div class="grid g2"><div><div class="field"><label for="pq">Mahsulot qidirish</label><input id="pq" type="search"></div><div id="pl"></div></div>
    ${state.user ? html`<form id="np" class="card stack"><h3>Mahsulot qo'shish</h3><div class="field"><label for="pn">Nomi</label><input id="pn" type="text" required minlength="2" maxlength="120"></div><div class="field"><label for="pb">Brend</label><input id="pb" type="text" maxlength="80"></div><button class="btn primary">Qo'shish</button></form>` : html`<div class="card"><p>Mahsulot qo'shish va sharh yozish uchun <a href="#/login">kiring</a>.</p></div>`}</div></div>`,
    mount: (r) => {
      const show = (q = '') => { const items = d.items.filter((p) => `${p.name} ${p.brand || ''}`.toLowerCase().includes(q.toLowerCase())); $('#pl', r).innerHTML = (items.length ? html`<div class="stack">${items.map((p) => html`<a class="card" style="text-decoration:none;color:inherit;display:block" href="#/community/${p.id}"><b>${p.name}</b> ${p.is_demo ? html`<span class="tag demo">DEMO</span>` : ''}<div class="small muted">${p.brand || ''}</div><div class="star">${p.review_count ? stars(p.avg_rating) + ' ' + p.avg_rating : ''} <span class="muted small">${p.review_count ? p.review_count + ' ta sharh' : "hali sharh yo'q"}</span></div></a>`)}</div>` : html`<div class="empty">Mahsulot topilmadi.</div>`).__raw; };
      show(); $('#pq', r).addEventListener('input', debounce((e) => show(e.target.value), 200));
      $('#np', r)?.addEventListener('submit', async (e) => { e.preventDefault(); try { const x = await api.post('/api/products', { name: $('#pn', r).value, brand: $('#pb', r).value }); location.hash = '#/community/' + x.id; } catch (er) { toast(errMsg(er), 'err'); } });
    } };
}

async function productPage(id) {
  const sort = sessionStorage.getItem('rsort') || 'recent';
  let p; try { p = await api.get('/api/products/' + id); } catch (e) { return { html: html`<div class="wrap section"><div class="notice err">${errMsg(e)}</div><a href="#/community">← Orqaga</a></div>` }; }
  const rv = (await api.get(`/api/products/${id}/reviews?sort=${sort}`)).items;
  return { html: html`<div class="wrap section"><p><a href="#/community">← Hamjamiyat</a></p><div class="page-head"><h1>${p.name}</h1><p class="muted">${p.brand || ''} ${p.barcode ? '· ' + p.barcode : ''}</p><div class="star">${p.review_count ? stars(p.avg_rating) + ' ' + p.avg_rating : ''} <span class="muted small">${p.review_count} ta sharh</span></div></div>
    <div class="grid g2"><div><div class="field"><label for="sort">Saralash</label><select id="sort">${[['recent', 'Eng yangi'], ['helpful', 'Eng foydali'], ['rating_high', 'Baho: yuqoridan'], ['rating_low', 'Baho: pastdan']].map(([v, l]) => html`<option value="${v}" ${sort === v ? 'selected' : ''}>${l}</option>`)}</select></div>
      ${rv.length ? rv.map((x) => html`<article class="card" style="margin-bottom:.8rem"><div class="star" aria-label="${x.rating} yulduz">${stars(x.rating)}</div><p>${x.body}</p><p class="small muted">${x.nickname} · ${fmtDate(x.created_at)}${x.updated_at !== x.created_at ? ' (tahrirlangan)' : ''}</p>
        <div class="row"><button class="btn sm ${x.voted ? 'primary' : ''}" data-help="${x.id}" ${!state.user || x.mine ? 'disabled' : ''}>Foydali (${x.helpful})</button><button class="btn sm ghost" data-cm="${x.id}">Izohlar (${x.comments})</button>${state.user && !x.mine ? html`<button class="btn sm ghost" data-rep="${x.id}">Shikoyat</button>` : ''}${x.mine ? html`<button class="btn sm danger" data-delrev="${x.id}">O'chirish</button>` : ''}</div><div data-cmbox="${x.id}"></div></article>`) : html`<div class="empty">Hali sharh yo'q. Birinchi bo'lib yozing.</div>`}</div>
    ${state.user ? html`<form id="rf" class="card stack"><h3>${p.my_review ? 'Sharhingizni tahrirlash' : 'Sharh yozish'}</h3><div class="field"><label for="rt">Baho</label><select id="rt">${[5, 4, 3, 2, 1].map((n) => html`<option value="${n}" ${p.my_review?.rating === n ? 'selected' : ''}>${n} — ${'★'.repeat(n)}</option>`)}</select></div>
      <div class="field"><label for="rb">Sharh (kamida 10 belgi)</label><textarea id="rb" rows="5" maxlength="2000" required>${p.my_review?.body || ''}</textarea></div><div id="rm" class="err" role="alert"></div><button class="btn primary">Yuborish</button><p class="hint">Har bir mahsulotga bitta sharh. Nomaqbul so'zlar va spam rad etiladi.</p></form>` : html`<div class="card"><p>Sharh yozish uchun <a href="#/login">kiring</a> (email tasdiqlangan bo'lishi kerak).</p></div>`}</div></div>`,
    mount: (r) => {
      $('#sort', r).onchange = (e) => { sessionStorage.setItem('rsort', e.target.value); window.__rerender(); };
      $('#rf', r)?.addEventListener('submit', async (e) => { e.preventDefault(); try { await api.post(`/api/products/${id}/reviews`, { rating: $('#rt', r).value, body: $('#rb', r).value }); toast('Sharh saqlandi.'); window.__rerender(); } catch (er) { $('#rm', r).textContent = errMsg(er); } });
      r.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        try {
          if (b.dataset.help) { await api.post(`/api/reviews/${b.dataset.help}/helpful`); window.__rerender(); }
          else if (b.dataset.delrev) { await api.del('/api/reviews/' + b.dataset.delrev); window.__rerender(); }
          else if (b.dataset.rep) { const reason = prompt('Shikoyat sababini yozing:'); if (reason) { await api.post('/api/reports', { type: 'review', id: parseInt(b.dataset.rep, 10), reason }); toast('Shikoyat yuborildi.'); } }
          else if (b.dataset.cm) {
            const box = $(`[data-cmbox="${b.dataset.cm}"]`, r); const cs = (await api.get(`/api/reviews/${b.dataset.cm}/comments`)).items;
            box.innerHTML = html`<div class="stack" style="margin-top:.6rem">${cs.map((c) => html`<div class="small"><b>${c.nickname}</b>: ${c.body} <span class="muted">${fmtDate(c.created_at)}</span></div>`)}${state.user ? html`<form class="row" data-cf="${b.dataset.cm}"><input type="text" minlength="2" maxlength="500" required class="grow" aria-label="Izoh"><button class="btn sm">Yuborish</button></form>` : ''}</div>`.__raw;
            box.querySelector('form')?.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api.post(`/api/reviews/${b.dataset.cm}/comments`, { body: ev.target.querySelector('input').value }); window.__rerender(); } catch (er) { toast(errMsg(er), 'err'); } });
          }
        } catch (er) { toast(errMsg(er), 'err'); }
      });
    } };
}

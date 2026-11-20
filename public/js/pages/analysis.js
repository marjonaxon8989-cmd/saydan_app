import { html, api, state, errMsg, fmtDate, confirmDialog, navigate, toast, $ } from '../core.js';
import { renderResult, lockedBlock } from './result.js';

export default async function analysis({ params }) {
  if (!state.user) return { html: html`<div class="wrap section"><div class="notice">Avval <a href="#/login">kiring</a>.</div></div>` };
  let d;
  try { d = await api.get('/api/analyses/' + params.id); }
  catch (e) { return { html: html`<div class="wrap section"><div class="notice err">${errMsg(e)} ${e.status === 402 ? html`<a href="#/pro">Pro haqida</a>` : ''}</div><p><a href="#/account/history">← Tarix</a></p></div>` }; }
  return { html: html`<div class="wrap section"><p class="no-print"><a href="#/account/history">← Tarix</a></p>
    <div class="page-head"><h1>${d.product_name || 'Saqlangan tahlil'}</h1><p class="muted">${d.brand || ''} ${d.barcode ? '· barkod ' + d.barcode : ''} · ${fmtDate(d.created_at)}</p>
    <div class="row no-print">${d.result.plan === 'pro' ? html`<button class="btn" id="pr">PDF / chop etish</button>` : ''}${d.product_id ? html`<a class="btn" href="#/community/${d.product_id}">Sharhlar</a>` : ''}<button class="btn danger" id="del">O'chirish</button></div></div>
    ${renderResult({ result: d.result, expiry: d.expiry }, { onUncertain: false })}</div>`,
    mount: (root) => {
      $('#pr', root)?.addEventListener('click', () => window.print());
      $('#del', root).addEventListener('click', async () => { if (await confirmDialog("Bu tahlil va unga bog'langan rasm o'chirilsinmi?", "O'chirish")) { try { await api.del('/api/analyses/' + params.id); toast("O'chirildi."); navigate('/account/history'); } catch (e) { toast(errMsg(e), 'err'); } } });
    } };
}

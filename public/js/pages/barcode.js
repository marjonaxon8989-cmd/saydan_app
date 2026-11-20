import { html, $, api, state, toast, errMsg, navigate, esc } from '../core.js';
import { guard } from './gate.js';

let stream = null, timer = null;
const stop = () => { clearInterval(timer); timer = null; stream?.getTracks().forEach((t) => t.stop()); stream = null; };

export default async function barcode() {
  const g = guard('barcode', 'Barkod orqali tahlil', "Barkod bo'yicha mahsulot tarkibini qidiring va SAYDAN bazasi bilan solishtiring."); if (g) return g;
  const st = await api.get('/api/barcode/status');
  const detector = 'BarcodeDetector' in window;
  const stMsg = { configured: html`<span class="tag mint">Ma'lumot manbai ulangan: ${st.provider}</span>`, disabled: html`<span class="tag warn">Barkod ma'lumot manbai o'chirilgan</span>`, unknown_provider: html`<span class="tag warn">Noma'lum provayder</span>` }[st.state];
  return { html: html`<div class="wrap section"><div class="page-head"><h1>Barkod orqali tahlil</h1><div class="row">${stMsg}</div><p class="muted small">${st.detail} ${st.note}</p></div>
    <div class="grid g2"><div class="card stack"><h3>Kamera</h3>${detector ? html`<div class="camera-box" id="cb" hidden><video id="bv" playsinline muted></video></div><button class="btn primary" id="scan">Kamerani yoqish</button><div id="camErr" class="err" role="alert"></div>` : html`<div class="notice warn">Brauzeringiz barkodni kamera orqali o'qishni qo'llamaydi. Raqamni qo'lda kiriting.</div>`}</div>
      <div class="card stack"><h3>Rasmdan o'qish</h3>${detector ? html`<input type="file" id="bf" accept="image/jpeg,image/png,image/webp" aria-label="Barkod rasmi">` : html`<p class="muted small">Brauzer qo'llab-quvvatlamaydi.</p>`}
        <h3>Qo'lda kiritish</h3><form id="mf" class="row"><input id="num" type="text" inputmode="numeric" pattern="[0-9 ]{8,16}" placeholder="Barkod raqami (8, 12, 13 yoki 14 xona)" class="grow" aria-label="Barkod raqami" required><button class="btn primary">Qidirish</button></form></div></div>
    <div id="res" style="margin-top:1.5rem" aria-live="polite"></div></div>`,
    mount: (r) => {
      const res = $('#res', r);
      async function lookup(code) {
        res.innerHTML = '<div class="loading">Qidirilmoqda…</div>';
        try {
          const d = await api.post('/api/barcode/lookup', { barcode: code });
          if (d.state === 'found') {
            res.innerHTML = html`<div class="card stack"><span class="tag mint">Topildi (${d.source})</span><h3>${d.product.name || 'Nomsiz mahsulot'}</h3><p class="muted">${d.product.brand || ''} · ${d.product.barcode}</p>
              <p class="small"><b>Ingredientlar:</b> ${d.product.ingredients_text}</p>${d.attribution ? html`<p class="small muted">${d.attribution}</p>` : ''}
              <div class="row"><button class="btn primary" id="useIt">Matnni tekshirib tahlil qilish</button></div></div>`.__raw;
            $('#useIt', r).onclick = () => { sessionStorage.setItem('saydan_prefill', JSON.stringify({ text: d.product.ingredients_text, name: d.product.name || '', brand: d.product.brand || '', barcode: d.product.barcode, source: d.source })); navigate('/analyze'); };
          } else {
            const msg = { found_no_ingredients: "Mahsulot topildi, lekin manbada ingredientlar ro'yxati yo'q.", not_found: "Bu barkod bo'yicha mahsulot ma'lumot manbasida topilmadi.", unavailable: "Ma'lumot manbasiga ulanib bo'lmadi (tarmoq yoki xizmat mavjud emas).", error: "Ma'lumot manbasi xato qaytardi.", disabled: "Barkod ma'lumot manbai o'chirilgan." }[d.state] || 'Natija topilmadi.';
            res.innerHTML = html`<div class="card stack"><div class="notice ${d.state === 'not_found' || d.state === 'found_no_ingredients' ? 'warn' : 'err'}">${msg}</div>${d.product ? html`<p>${d.product.name} ${d.product.brand ? '· ' + d.product.brand : ''}</p>` : ''}<p class="muted">Quyidagilardan birini tanlang:</p><div class="row"><a class="btn primary" href="#/analyze?new=1">Yorliq rasmini tahlil qilish</a><a class="btn" href="#/analyze?new=1">Ingredientlarni qo'lda kiritish</a></div></div>`.__raw;
          }
        } catch (e) { res.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; }
      }
      $('#mf', r).onsubmit = (e) => { e.preventDefault(); lookup($('#num', r).value.replace(/\s+/g, '')); };
      if (detector) {
        $('#bf', r).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const bmp = await createImageBitmap(f); const found = await new BarcodeDetector().detect(bmp); if (!found.length) { toast("Rasmda barkod topilmadi. Raqamni qo'lda kiriting.", 'err'); return; } $('#num', r).value = found[0].rawValue; lookup(found[0].rawValue); } catch { toast("Rasmni o'qib bo'lmadi.", 'err'); } };
        $('#scan', r).onclick = async () => {
          const err = $('#camErr', r); err.textContent = '';
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
            const v = $('#bv', r); v.srcObject = stream; $('#cb', r).hidden = false; await v.play();
            const bd = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
            timer = setInterval(async () => { try { const f = await bd.detect(v); if (f.length) { const code = f[0].rawValue; stop(); $('#cb', r).hidden = true; $('#num', r).value = code; lookup(code); } } catch { /* keyingi kadr */ } }, 400);
          } catch (e) { err.textContent = { NotAllowedError: 'Kameraga ruxsat berilmadi.', NotFoundError: 'Kamera topilmadi.' }[e.name] || "Kamerani ishga tushirib bo'lmadi. Raqamni qo'lda kiriting."; }
        };
      }
      return stop;
    } };
}

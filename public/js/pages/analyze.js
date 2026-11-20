import { html, raw, $, $$, state, api, ApiError, toast, errMsg, navigate, icon, esc } from '../core.js';
import { t } from '../i18n.js';
import { renderResult } from './result.js';

// Tahlil oqimi holati (xotirada). Sahifadan chiqilsa, rasm ma'lumotlari saqlanmaydi.
const S = { step: 'method', canvas: null, ocr: null, review: null, result: null, accepted: {}, token: null, barcode: null, imageId: null, error: null, busy: false };
let stream = null;
const stopCamera = () => { stream?.getTracks().forEach((tr) => tr.stop()); stream = null; };
const reset = () => { Object.assign(S, { step: 'method', canvas: null, ocr: null, review: null, result: null, accepted: {}, token: null, barcode: null, imageId: null, error: null, busy: false }); };

const STEPS = [['method', 'analyze.step1'], ['capture', 'analyze.step2'], ['review', 'analyze.step3'], ['result', 'analyze.step4']];
const stepper = () => { const idx = STEPS.findIndex(([k]) => k === S.step); return html`<ol class="stepper" aria-label="Bosqichlar">${STEPS.map(([k, key], i) => html`<li class="${i === idx ? 'on' : i < idx ? 'done' : ''}" ${i === idx ? raw('aria-current="step"') : ''}>${i + 1}. ${t(key)}</li>`)}</ol>`; };

export default async function analyze({ query, main }) {
  if (!state.user) {
    return { html: html`<div class="wrap section"><div class="page-head"><h1>${t('analyze.title')}</h1></div><div class="card form-narrow center"><p>${t('auth.loginRequired')}</p><div class="row" style="justify-content:center"><a class="btn primary" href="#/login">${t('nav.login')}</a><a class="btn" href="#/register">${t('nav.register')}</a></div></div></div>` };
  }
  if (query.new) reset();
  const pre = sessionStorage.getItem('saydan_prefill');
  if (pre) { sessionStorage.removeItem('saydan_prefill'); try { const p = JSON.parse(pre); reset(); S.review = { text: p.text || '', name: p.name || '', brand: p.brand || '', expiry: '', pao: '', hints: { barcode: p.barcode || null, source: p.source || null } }; S.barcode = p.barcode || null; S.step = 'review'; } catch { /* */ } }
  return { html: html`<div class="wrap section" id="az"></div>`, mount: (root) => { draw(); return () => { stopCamera(); }; } };
}

function draw() {
  const root = $('#az'); if (!root) return;
  root.innerHTML = `<div class="page-head"><h1>${t('analyze.title')}</h1></div>${stepper().__raw}<div id="azBody"></div>`;
  const body = $('#azBody');
  ({ method: drawMethod, capture: drawCapture, review: drawReview, result: drawResult })[S.step](body);
}

function drawMethod(body) {
  const u = state.usage;
  body.innerHTML = html`
    ${u ? html`<p class="muted small">Bu oy: ${u.used}/${u.limit} tahlil ishlatildi (${u.plan === 'pro' ? 'Pro' : 'Free'}).</p>` : ''}
    <div class="methods">
      <button class="card method" data-m="camera">${icon('camera')}<h3>${t('analyze.camera')}</h3><span class="muted small">${t('analyze.cameraD')}</span></button>
      <label class="card method" for="fileIn">${icon('upload')}<h3>${t('analyze.upload')}</h3><span class="muted small">${t('analyze.uploadD')}</span></label>
      <button class="card method" data-m="manual">${icon('edit')}<h3>${t('analyze.manual')}</h3><span class="muted small">${t('analyze.manualD')}</span></button>
      <a class="card method" href="#/barcode" style="text-decoration:none">${icon('barcode')}<h3>${t('analyze.barcode')} <span class="tag gold">Pro</span></h3><span class="muted small">${t('analyze.barcodeD')}</span></a>
    </div>
    <input id="fileIn" class="sr" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Rasm tanlash">
    <div id="azErr" class="err" role="alert"></div>`.__raw;
  body.addEventListener('click', (e) => { const m = e.target.closest('[data-m]')?.dataset.m; if (m === 'camera') { S.step = 'capture'; S.cam = true; draw(); } if (m === 'manual') { S.review = { text: '', name: '', brand: '', expiry: '', pao: '', hints: {} }; S.step = 'review'; draw(); } });
  $('#fileIn', body).addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; await loadFile(f); });
}

async function loadFile(f) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('Faqat JPEG, PNG yoki WebP rasm qabul qilinadi.', 'err'); return; }
  if (f.size > 20 * 1024 * 1024) { toast('Rasm juda katta (20 MB dan oshmasin).', 'err'); return; }
  try { const bmp = await createImageBitmap(f); S.canvas = toCanvas(bmp); S.step = 'capture'; S.cam = false; draw(); }
  catch { toast("Rasmni o'qib bo'lmadi. Boshqa rasm tanlang.", 'err'); }
}
function toCanvas(src, w = src.width, h = src.height) {
  const max = 2200, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c;
}

const CAM_ERR = { NotAllowedError: "Kameraga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering yoki rasm yuklang.", NotFoundError: "Kamera topilmadi. Rasm yuklashingiz mumkin.", NotReadableError: "Kamera boshqa dastur tomonidan band. Uni yoping yoki rasm yuklang.", OverconstrainedError: "Kamera talab qilingan sozlamani qo'llamaydi.", SecurityError: "Kamera faqat xavfsiz (HTTPS) ulanishda ishlaydi." };

async function drawCapture(body) {
  if (S.cam && !S.canvas) {
    body.innerHTML = html`<div class="stack"><div class="camera-box"><video id="vid" playsinline muted autoplay aria-label="Kamera ko'rinishi"></video></div><div id="camMsg" class="notice err" hidden role="alert"></div>
      <div class="row" style="justify-content:center"><button class="btn primary" id="snap" disabled>${icon('camera')} Suratga olish</button><label class="btn" for="fileIn2">Rasm yuklash</label><button class="btn ghost" id="back">${t('common.back')}</button></div>
      <input id="fileIn2" class="sr" type="file" accept="image/jpeg,image/png,image/webp"><p class="hint center">Yorliqdagi "Ingredients / Tarkibi" qismini tekis va yorug' joyda suratga oling.</p></div>`.__raw;
    $('#back', body).onclick = () => { stopCamera(); reset(); draw(); };
    $('#fileIn2', body).onchange = async (e) => { stopCamera(); if (e.target.files[0]) await loadFile(e.target.files[0]); };
    const msg = $('#camMsg', body);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'SecurityError' });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      const v = $('#vid', body); v.srcObject = stream; await v.play().catch(() => {});
      $('#snap', body).disabled = false;
      $('#snap', body).onclick = () => { S.canvas = toCanvas(v, v.videoWidth, v.videoHeight); stopCamera(); S.cam = false; draw(); };
    } catch (e) { msg.hidden = false; msg.textContent = CAM_ERR[e.name] || "Kamerani ishga tushirib bo'lmadi. Rasm yuklashingiz mumkin."; }
    return;
  }
  // Rasm tahrirlash: burish va qirqish
  const c = S.canvas;
  body.innerHTML = html`<div class="stack"><div class="crop-wrap" id="cw"></div>
    <p class="hint">Kerak bo'lsa rasmni buring yoki ingredientlar yozilgan qismni sichqoncha/barmoq bilan belgilab qirqing.</p>
    <div class="row"><button class="btn sm" id="rl">⟲ Chapga</button><button class="btn sm" id="rr">⟳ O'ngga</button><button class="btn sm" id="crop" disabled>Qirqish</button><button class="btn sm ghost" id="retake">Qayta olish</button><span class="grow"></span><button class="btn primary" id="go">Matnni o'qish →</button></div>
    <div id="busy" hidden><div class="progress" role="progressbar" aria-label="Matn o'qilmoqda"><i></i></div><p class="muted small center">Matn o'qilmoqda… bu bir necha soniya olishi mumkin.</p></div><div id="azErr" class="notice err" role="alert" hidden></div></div>`.__raw;
  const cw = $('#cw', body); cw.appendChild(c);
  const rect = document.createElement('div'); rect.className = 'crop-rect'; rect.hidden = true; cw.appendChild(rect);
  let sel = null, start = null;
  const pos = (e) => { const b = c.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)) }; };
  c.addEventListener('pointerdown', (e) => { start = pos(e); c.setPointerCapture(e.pointerId); });
  c.addEventListener('pointermove', (e) => { if (!start) return; const p = pos(e); sel = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    const b = c.getBoundingClientRect(); const o = c.offsetLeft, ot = c.offsetTop; Object.assign(rect.style, { left: o + sel.x * b.width + 'px', top: ot + sel.y * b.height + 'px', width: sel.w * b.width + 'px', height: sel.h * b.height + 'px' }); rect.hidden = false; });
  c.addEventListener('pointerup', () => { start = null; $('#crop', body).disabled = !(sel && sel.w > 0.05 && sel.h > 0.05); });
  $('#crop', body).onclick = () => { const n = document.createElement('canvas'); n.width = Math.round(sel.w * c.width); n.height = Math.round(sel.h * c.height); n.getContext('2d').drawImage(c, Math.round(sel.x * c.width), Math.round(sel.y * c.height), n.width, n.height, 0, 0, n.width, n.height); S.canvas = n; draw(); };
  const rot = (dir) => { const n = document.createElement('canvas'); n.width = c.height; n.height = c.width; const g = n.getContext('2d'); g.translate(n.width / 2, n.height / 2); g.rotate(dir * Math.PI / 2); g.drawImage(c, -c.width / 2, -c.height / 2); S.canvas = n; draw(); };
  $('#rl', body).onclick = () => rot(-1); $('#rr', body).onclick = () => rot(1);
  $('#retake', body).onclick = () => { S.canvas = null; S.cam = true; draw(); };
  $('#go', body).onclick = async () => {
    const err = $('#azErr', body), busy = $('#busy', body); err.hidden = true; busy.hidden = false; $('#go', body).disabled = true;
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    try {
      const r = await api.raw('/api/ocr', blob, 'image/jpeg');
      S.imageId = r.imageId; S.ocr = r;
      const tx = r.items.map((i) => i.raw).join(', ');
      S.review = { text: r.ingredientMarkerFound || tx ? tx : '', name: r.productGuess?.name || '', nameGuess: !!r.productGuess, brand: '', expiry: '', pao: '', hints: { raw: r.text, conf: r.meanConfidence, marker: r.ingredientMarkerFound, low: r.items.filter((i) => i.ocrConfidence != null && i.ocrConfidence < 60).map((i) => i.raw), exp: r.expiryCandidates, pao: r.paoCandidates, retention: r.retention } };
      S.step = 'review'; draw();
    } catch (e) {
      busy.hidden = true; $('#go', body).disabled = false; err.hidden = false;
      err.textContent = errMsg(e);
      if (e instanceof ApiError && e.data?.imageId) { S.imageId = e.data.imageId; err.insertAdjacentHTML('beforeend', ` <button class="link" id="manualGo">Qo'lda kiritish</button>`); $('#manualGo', body).onclick = () => { S.review = { text: '', name: '', brand: '', expiry: '', pao: '', hints: {} }; S.step = 'review'; draw(); }; }
    }
  };
}

function drawReview(body) {
  const R = S.review, h = R.hints || {};
  body.innerHTML = html`<form id="rf" class="stack" novalidate>
    ${h.retention ? html`<div class="notice"><span>🔒</span><span class="small">Yuklangan rasm ${h.retention.hours} soatdan keyin avtomatik o'chiriladi (tahlilni saqlamasangiz). ${h.conf != null ? `OCR o'rtacha ishonchi: ${h.conf}%.` : ''}</span></div>` : ''}
    ${h.marker === false ? html`<div class="notice warn" role="alert"><span>⚠</span><span>"Ingredients / Tarkibi" sarlavhasi topilmadi. Butun matn bo'laklandi — ro'yxatni diqqat bilan tekshiring yoki qo'lda kiriting.</span></div>` : ''}
    ${h.low?.length ? html`<div class="notice warn" role="alert"><span>⚠</span><span>Quyidagi bandlar noaniq o'qildi, tekshiring: <b>${h.low.join(', ')}</b></span></div>` : ''}
    ${h.barcode ? html`<div class="notice"><span>▮</span><span class="small">Barkod: ${h.barcode}${h.source ? ` (manba: ${h.source})` : ''}</span></div>` : ''}
    <div class="field"><label for="ing">Ingredientlar ro'yxati (vergul bilan ajrating)</label>
      <textarea id="ing" rows="8" placeholder="Aqua, Glycerin, Cetearyl Alcohol, …" aria-describedby="ingH">${R.text}</textarea>
      <div id="ingH" class="hint">OCR xato qilgan so'zlarni tuzating. Hech narsa avtomatik qo'shilmaydi.</div></div>
    ${h.raw ? html`<details><summary class="small gold" style="cursor:pointer">Taniqlangan asl matnni ko'rish</summary><pre class="small muted" style="white-space:pre-wrap">${h.raw}</pre></details>` : ''}
    <div class="grid g2"><div class="field"><label for="pn">Mahsulot nomi (ixtiyoriy)</label><input id="pn" type="text" maxlength="120" value="${R.name}">${R.nameGuess ? html`<div class="hint">Taxminiy aniqlandi — tekshiring.</div>` : ''}</div>
      <div class="field"><label for="br">Brend (ixtiyoriy)</label><input id="br" type="text" maxlength="80" value="${R.brand}"></div></div>
    <div class="grid g2"><div class="field"><label for="ex">Yaroqlilik muddati (aniq sana)</label><input id="ex" type="date" value="${R.expiry}">
      <div class="hint">${(h.exp || []).length ? '' : "Yorliqda ko'rinmasa, bo'sh qoldiring — sana taxmin qilinmaydi."}</div>
      ${(h.exp || []).map((x, i) => x.iso ? html`<div class="hint">Topildi: «${x.text}» → ${x.iso} <button type="button" class="link" data-exp="${x.iso}">Qo'llash</button></div>` : x.month ? html`<div class="hint">Topildi: «${x.text}» — faqat oy/yil (${x.month}); kunni o'zingiz kiriting.</div>` : html`<div class="hint">Topildi: «${x.text}» — kun/oy tartibi noaniq; sanani o'zingiz kiriting.</div>`)}</div>
      <div class="field"><label for="pao">PAO (ochilgandan keyin, oy)</label><input id="pao" type="number" min="1" max="60" value="${R.pao}" placeholder="masalan 12">
      <div class="hint">PAO — ochilgandan keyingi tavsiya etilgan muddat; kalendar yaroqlilik sanasi emas.</div>
      ${(h.pao || []).map((x) => html`<div class="hint">«${x.text}» belgisi topildi — bu PAO bo'lishi mumkin. <button type="button" class="link" data-pao="${x.months}">PAO sifatida qo'llash</button></div>`)}</div></div>
    <div id="azErr" class="notice err" role="alert" hidden></div>
    <div class="row"><button class="btn primary" id="runBtn" type="submit">Tahlil qilish</button><button type="button" class="btn ghost" id="rst">Boshidan</button></div></form>`.__raw;
  $('#rst', body).onclick = () => { reset(); draw(); };
  body.addEventListener('click', (e) => { if (e.target.dataset.exp) $('#ex', body).value = e.target.dataset.exp; if (e.target.dataset.pao) $('#pao', body).value = e.target.dataset.pao; });
  $('#rf', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#azErr', body); err.hidden = true;
    Object.assign(S.review, { text: $('#ing', body).value, name: $('#pn', body).value, brand: $('#br', body).value, expiry: $('#ex', body).value, pao: $('#pao', body).value });
    if (S.review.text.trim().length < 2) { err.hidden = false; err.textContent = "Ingredientlar ro'yxatini kiriting."; return; }
    await runAnalysis(body, err);
  });
}

async function runAnalysis(body, err) {
  const btn = $('#runBtn', body) || null; if (btn) btn.disabled = true;
  try {
    const R = S.review;
    const r = await api.post('/api/analyze', { text: R.text, expiry_date: R.expiry || null, pao_months: R.pao ? parseInt(R.pao, 10) : null, accepted: S.accepted, session_token: S.token });
    S.token = r.session_token; S.result = r; state.usage = r.usage; S.step = 'result'; draw();
  } catch (e) {
    if (btn) btn.disabled = false;
    if (err) { err.hidden = false; err.innerHTML = esc(errMsg(e)) + (e.code === 'monthly_limit' ? ` <a href="#/pro">${t('common.upgrade')}</a>` : ''); } else toast(errMsg(e), 'err');
  }
}

function drawResult(body) {
  const r = S.result, R = S.review;
  body.innerHTML = html`<div class="stack">
    <div class="row no-print"><button class="btn sm" id="edit">← Matnni tahrirlash</button><button class="btn sm ghost" id="again">Yangi tahlil</button></div>
    <div><h2>${R.name || 'Tahlil natijasi'}</h2>${R.brand ? html`<p class="muted">${R.brand}</p>` : ''}</div>
    ${r.upsell && !sessionStorage.getItem('upsell_' + new Date().toDateString()) ? html`<div class="notice" id="upsell"><span>★</span><span>${r.upsell.message} <a href="#/pro">${t('common.upgrade')}</a> · <button class="link" id="later">${t('common.later')}</button></span></div>` : ''}
    <div id="resBox">${renderResult(r)}</div>
    <div class="card no-print" id="savePanel"><h3>Tahlilni saqlash</h3><p class="small muted">Tahlil faqat siz saqlashni tanlasangiz hisobingizga yoziladi.</p>
      <label class="check"><input type="checkbox" id="consent"><span>Bu tahlilni hisobimga saqlashga roziman.</span></label>
      ${S.imageId ? html`<label class="check" style="margin-top:.5rem"><input type="checkbox" id="keepImg"><span>Yorliq rasmini ham saqlash (aks holda rasm o'chiriladi).</span></label>` : ''}
      <div class="row" style="margin-top:1rem"><button class="btn primary" id="saveBtn" disabled>Saqlash</button>${r.result.plan === 'pro' ? html`<button class="btn" id="print">PDF / chop etish</button>` : ''}</div><div id="saveMsg" class="small" role="status"></div></div></div>`.__raw;
  $('#edit', body).onclick = () => { S.step = 'review'; draw(); };
  $('#again', body).onclick = () => { reset(); draw(); };
  $('#later', body)?.addEventListener('click', () => { sessionStorage.setItem('upsell_' + new Date().toDateString(), '1'); $('#upsell').remove(); });
  $('#consent', body).onchange = (e) => { $('#saveBtn', body).disabled = !e.target.checked; };
  $('#print', body)?.addEventListener('click', () => window.print());
  $('#resBox', body).addEventListener('click', async (e) => {
    const a = e.target.closest('[data-accept]')?.dataset.accept; if (!a) return;
    const [idx, id] = a.split(':'); const raw = S.result.result.uncertain[parseInt(idx, 10)].raw; S.accepted[raw] = parseInt(id, 10);
    try { const r2 = await api.post('/api/analyze', { text: S.review.text, expiry_date: S.review.expiry || null, pao_months: S.review.pao ? parseInt(S.review.pao, 10) : null, accepted: S.accepted, session_token: S.token }); S.result = r2; S.token = r2.session_token; drawResult(body); } catch (er) { toast(errMsg(er), 'err'); }
  });
  $('#saveBtn', body).onclick = async () => {
    const msg = $('#saveMsg', body); $('#saveBtn', body).disabled = true;
    try {
      const R = S.review;
      const res = await api.post('/api/analyses', { consent_save: true, text: R.text, accepted: S.accepted, product_name: R.name, brand: R.brand, barcode: S.barcode, expiry_date: R.expiry || null, pao_months: R.pao ? parseInt(R.pao, 10) : null, image_id: S.imageId, keep_image: !!$('#keepImg', body)?.checked });
      msg.innerHTML = `Saqlandi. <a href="#/analysis/${res.id}">Tarixda ko'rish</a>`; toast('Tahlil saqlandi.');
    } catch (e) { $('#saveBtn', body).disabled = false; msg.textContent = errMsg(e); msg.className = 'small err'; }
  };
}

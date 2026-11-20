// Tahlil natijasini ko'rsatish (saqlangan va saqlanmagan uchun umumiy).
import { html, raw, state, fmtDate, icon } from '../core.js';
import { t } from '../i18n.js';

export const STATUS_LABEL = { draft: 'Qoralama', needs_source: "Manba tekshiruvi kerak", under_review: "Ko'rib chiqilmoqda", approved: 'Tasdiqlangan', archived: 'Arxivlangan', insufficient_evidence: 'Dalil yetarli emas' };
export const DIM_LABEL = { climate: "O'zbekiston iqlimi konteksti", pregnancy: 'Homiladorlik davri', dry: 'Quruq teri', oily: "Yog'li teri", sensitive: 'Sezgir teri' };
const CONF = { high: 'yuqori', medium: "o'rta", low: 'past' };
const FIELDS = [['detailed_explanation', 'Batafsil izoh'], ['safety_general', 'Umumiy xavfsizlik ma\'lumoti'], ['eu_restrictions', 'Yevropa Ittifoqi cheklovlari'], ['eu_allergen', 'Allergen yorlig\'i talabi'], ['sccs', 'SCCS xulosasi'], ['cir', 'CIR hisoboti'], ['pubchem_en', 'PubChem (asl inglizcha tavsif)'], ['pharmacist_comment', 'Farmatsevt izohi']];

export const lockedBlock = (title, text = '') => html`<div class="locked" role="note"><div class="ghost" aria-hidden="true"><i style="width:90%"></i><i style="width:70%"></i><i style="width:80%"></i></div>
  <div class="cta">${icon('lock')}<b>${title}</b><span class="small muted">${text || t('common.proLocked')}</span><a class="btn sm primary" href="#/pro">${t('common.upgrade')}</a></div></div>`;

function ring(pct) {
  const r = 34, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return html`<svg class="ring" viewBox="0 0 84 84" role="img" aria-label="${pct} foiz"><circle cx="42" cy="42" r="${r}" fill="none" stroke="#294637" stroke-width="7"/><circle cx="42" cy="42" r="${r}" fill="none" stroke="#69C69B" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 42 42)"/></svg>`;
}
function dimCard(key, d, notes) {
  let body;
  if (d.status === 'scored') {
    body = html`<div class="row">${ring(d.percent)}<div><div class="pct">${d.percent}%</div><span class="status-pill scored">Ishonch darajasi: ${CONF[d.confidence]}</span></div></div>
      <p class="small muted">${d.assessed}/${d.total} ingredient tasdiqlangan baholar asosida (qamrov ${Math.round(d.coverage * 100)}%).</p>`;
  } else if (d.status === 'info_only') {
    const why = d.reason === 'climate_no_percent' ? notes.climate : d.reason === 'pregnancy_no_percent' ? notes.pregnancy
      : `Foiz hisoblash uchun tasdiqlangan baholar yetarli emas (${d.assessed}/${d.total}).`;
    body = html`<span class="status-pill info_only">Faqat ma'lumot</span><p class="small muted">${why}</p>`;
  } else {
    body = html`<span class="status-pill">${t('common.noData')}</span><p class="small muted">${key === 'climate' ? notes.climate : "Bu yo'nalish bo'yicha yetarli dalil topilmadi. Foiz uydirilmaydi."}</p>`;
  }
  return html`<div class="card dim"><h3>${DIM_LABEL[key]}</h3>${body}
    <details><summary class="small gold" style="cursor:pointer">Qanday hisoblangan?</summary><p class="small muted" style="margin-top:.5rem">${d.method} ${notes.order}</p></details></div>`;
}

function ingCard(i, plan) {
  const ev = i.evidence;
  const tags = html`${ev.is_demo ? html`<span class="tag demo">DEMO</span>` : ''}<span class="tag ${ev.status === 'approved' ? 'mint' : 'warn'}">${STATUS_LABEL[ev.status] || ev.status}</span>
    ${ev.pharmacist_approved ? html`<span class="tag mint">Farmatsevt tasdiqlagan</span>` : html`<span class="tag">Farmatsevt tekshiruvidan o'tmagan</span>`}
    ${i.matchType === 'user_confirmed' ? html`<span class="tag">Siz tasdiqladingiz</span>` : ''}${i.lowOcr ? html`<span class="tag warn">OCR ishonchi past — tekshiring</span>` : ''}`;
  const d = i.detail;
  return html`<details class="ing"><summary><strong>${i.inci}</strong>${i.uz_name ? html`<span class="muted">· ${i.uz_name}</span>` : ''}<span class="chips">${tags}</span></summary><div class="body">
    <dl class="kv"><dt>Vazifasi</dt><dd>${i.function_uz || i.cosing_functions || html`<span class="muted">Ma'lumot yo'q</span>`}</dd>
    ${i.cosing_functions && i.function_uz ? html`<dt>CosIng vazifalari</dt><dd>${i.cosing_functions}</dd>` : ''}
    <dt>Tavsif</dt><dd>${i.description_uz || html`<span class="muted">Ma'lumot yo'q</span>`}</dd></dl>
    ${d ? html`<dl class="kv">${FIELDS.filter(([k]) => d[k]).map(([k, l]) => html`<dt>${l}</dt><dd>${d[k]}</dd>`)}
      ${['pregnancy', 'dry', 'oily', 'sensitive'].map((k) => d.dims[k].text || d.dims[k].assessment ? html`<dt>${DIM_LABEL[k]}</dt><dd>${d.dims[k].text || ''}${d.dims[k].assessment ? html`<div class="small muted">Tuzilgan baho: ${d.dims[k].assessment.stance === 'favorable' ? 'qulay' : d.dims[k].assessment.stance === 'caution' ? "e'tibor talab qiladi" : 'neytral'}, dalil: ${d.dims[k].assessment.evidence_level}${d.dims[k].assessment.approved ? '' : " (tasdiqlanmagan — hisobga olinmaydi)"}</div>` : ''}</dd>` : html`<dt>${DIM_LABEL[k]}</dt><dd class="muted">Ma'lumot yo'q (xulosa chiqarilmaydi)</dd>`)}</dl>
      ${d.sources.length ? html`<p class="small"><b>Manbalar:</b></p><ul class="small">${d.sources.map((u) => html`<li><a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a></li>`)}</ul>` : html`<p class="small muted">Manba havolasi kiritilmagan.</p>`}`
    : lockedBlock('Batafsil ma\'lumot, ehtiyot choralari va manbalar')}
  </div></details>`;
}

export function renderResult(data, { onUncertain = true } = {}) {
  const r = data.result, n = r.notes, plan = r.plan;
  const c = r.counts;
  return html`
  <div class="stack">
    <div class="row"><span class="tag mint">Aniq mos: ${c.confirmed}</span><span class="tag warn">Noaniq: ${c.uncertain}</span><span class="tag">Topilmadi: ${c.unmatched}</span><span class="tag">Jami band: ${c.total}</span></div>
    <div class="notice warn" role="note"><span>ⓘ</span><span>${n.disclaimer}</span></div>
    <div class="grid g4">${['climate', 'pregnancy', 'dry', 'oily'].map((k) => dimCard(k, r.dimensions[k], n))}</div>
    ${r.sensitiveInfo ? html`<p class="small muted">Sezgir teri bo'yicha ma'lumot ${r.sensitiveInfo} ta ingredientda mavjud (ingredient kartasida ko'ring).</p>` : ''}
    <div class="card"><h3>Xulosa</h3><ul>${r.summary.map((s) => html`<li>${s}</li>`)}</ul><p class="small muted">${n.order}</p></div>
    ${data.expiry ? html`<div class="card"><h3>Yaroqlilik muddati</h3>${data.expiry.status === 'unknown' ? html`<p class="muted">Yaroqlilik muddati kiritilmagan. Yorliqda ko'rsangiz, qo'lda kiriting — biz sanani taxmin qilmaymiz.</p>`
      : html`<p>${data.expiry.expiry_date} — ${data.expiry.status === 'expired' ? html`<b class="gold">muddati o'tgan</b>` : data.expiry.status === 'soon' ? html`<b class="gold">${data.expiry.days_left} kun qoldi</b>` : html`${data.expiry.days_left} kun qoldi`}</p>`}
      ${data.expiry.pao_note ? html`<p class="small muted">${data.expiry.pao_note}</p>` : ''}</div>` : ''}
    <h2 style="margin-top:1rem">Ingredientlar (${r.ingredients.length})</h2>
    ${r.ingredients.length ? r.ingredients.map((i) => ingCard(i, plan)) : html`<div class="empty">Bazadan aniq mos ingredient topilmadi.</div>`}
    ${r.uncertain.length ? html`<div class="card"><h3>Noaniq moslik</h3><p class="small muted">Bu bandlar bazadagi yozuvlarga aniq mos kelmadi. Siz tasdiqlamaguncha tahlilga kiritilmaydi.</p>
      ${r.uncertain.map((u, idx) => html`<div class="field"><b>«${u.raw}»</b> ${u.ocrConfidence != null && u.ocrConfidence < 60 ? html`<span class="tag warn">OCR ishonchi past</span>` : ''}
        <div class="chips" style="margin-top:.4rem">${u.candidates.map((cd) => onUncertain ? html`<button class="btn sm" data-accept="${idx}:${cd.id}">${cd.inci}${cd.uz_name ? ' · ' + cd.uz_name : ''} — shumi?</button>` : html`<span class="tag">${cd.inci}</span>`)}</div></div>`)}</div>` : ''}
    ${r.unmatched.length ? html`<div class="card"><h3>Bazadan topilmagan bandlar</h3><p class="small muted">Yozuvning yo'qligi bu moddalar xavfsiz yoki xavfli ekanini bildirmaydi — shunchaki ma'lumot yo'q.</p><div class="chips">${r.unmatched.map((u) => html`<span class="tag">${u.raw}</span>`)}</div></div>` : ''}
    <div class="card"><h3>Ingredientlar o'rtasidagi o'zaro ta'sir</h3>${Array.isArray(r.interactions)
      ? (r.interactions.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>A</th><th>B</th><th>Tur</th><th>Izoh</th><th>Holat</th></tr></thead><tbody>${r.interactions.map((x) => html`<tr><td>${x.a}</td><td>${x.b}</td><td>${x.type || '—'}</td><td>${x.description || '—'}</td><td>${x.review_status || '—'}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Bazadagi yozuvlarda bu tarkib uchun o'zaro ta'sir topilmadi.</p>`)
        : lockedBlock("O'zaro ta'sir ma'lumotlari")}
      <p class="small muted">Bazadagi yozuvlar to'liq ro'yxat emas; ta'sir yozuvining yo'qligi ta'sir yo'qligini bildirmaydi.</p></div>
    <div class="card"><h3>Muqobil ingredient ma'lumoti</h3>${Array.isArray(r.alternatives)
      ? (r.alternatives.length ? html`<p class="small muted">«O'xshashlik» faqat umumiy CosIng vazifalariga asoslanadi. U kimyoviy ekvivalentlik, bir xil samaradorlik yoki xavfsizlikni isbotlamaydi va muqobil "xavfsizroq" degani emas.</p><div class="table-wrap"><table class="t"><thead><tr><th>Asosiy</th><th>Muqobil</th><th>Vazifa o'xshashligi</th><th>Farqlar</th></tr></thead><tbody>${r.alternatives.map((a) => html`<tr><td>${a.main}</td><td>${a.alt}${a.alt_uz ? ' · ' + a.alt_uz : ''}</td><td>${a.similarity ?? '—'}</td><td>${a.differences || '—'}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Bu tarkib uchun bazada muqobil yozuvlar yo'q.</p>`)
      : lockedBlock('Muqobillar')}</div>
    ${Array.isArray(r.allergenAlerts) && r.allergenAlerts.length ? html`<div class="notice warn"><span>ⓘ</span><span>Siz profilingizda belgilagan modda(lar) tarkibda mavjud: ${r.allergenAlerts.map((a) => a.inci).join(', ')}.</span></div>` : ''}
    <div class="card"><h3>Metodologiya va ma'lumot holati</h3><p class="small muted">${n.method}</p><p class="small muted">${n.pregnancy}</p><p class="small muted">${n.climate}</p>
      <p class="small muted">Mos kelgan yozuvlar: qoralama ${r.dataStatus.draft}, tasdiqlangan ${r.dataStatus.approved}, farmatsevt tasdiqlagan ${r.dataStatus.pharmacist_approved}${r.dataStatus.demo ? `, DEMO ${r.dataStatus.demo}` : ''}.</p></div>
    <p class="disclaimer">${n.disclaimer}</p>
  </div>`;
}

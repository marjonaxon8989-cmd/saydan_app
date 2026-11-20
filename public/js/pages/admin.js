import { html, raw, $, $$, api, state, toast, errMsg, fmtDate, fmtMoney, confirmDialog, esc } from '../core.js';
import { loginGate } from './gate.js';

const TABS = [
  ['dashboard', 'Bosh panel', 'admin.access'], ['ingredients', 'Ingredientlar', 'ingredients.write'], ['import', 'Import', 'import.run'],
  ['conflicts', "To'qnashuvlar / muqobil", 'ingredients.write'], ['products', 'Mahsulotlar', 'ingredients.write'], ['moderation', 'Moderatsiya', 'community.moderate'],
  ['users', 'Foydalanuvchilar', 'users.read'], ['finance', 'Moliya', 'finance.read'], ['marketing', 'Marketing', 'marketing.read'],
  ['analytics', 'Analitika', 'admin.access'], ['diary', 'Kundalik savollari', 'ingredients.write'], ['system', 'Tizim', 'system.read'], ['audit', 'Audit', 'audit.read'], ['settings', 'Sozlamalar', 'roles.manage'],
];
const STATUS = { draft: 'Qoralama', under_review: "Ko'rib chiqilmoqda", approved: 'Tasdiqlangan', rejected: 'Rad etilgan' };
const ROLES = { super_admin: 'Super Admin', content_editor: 'Kontent muharriri', marketer: 'Marketolog' };
const table = (head, rows) => html`<div style="overflow-x:auto"><table class="t"><thead><tr>${head.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>`;
const note = (t) => html`<p class="muted small">${t}</p>`;
const stat = (l, v, s = '') => html`<div class="card"><div class="muted small">${l}</div><div style="font-size:1.8rem;font-weight:700">${v}</div>${s ? html`<div class="small muted">${s}</div>` : ''}</div>`;
const field = (id, label, val = '', extra = '') => html`<div class="field"><label for="${id}">${label}</label><input id="${id}" type="text" value="${val}" ${raw(extra)}></div>`;

export default async function admin({ params }) {
  if (!state.user) return loginGate();
  let me; try { me = await api.get('/api/admin/me'); } catch { return { html: html`<div class="wrap section"><div class="notice err">Bu bo'limga kirish huquqingiz yo'q.</div></div>` }; }
  const perms = new Set(['admin.access', ...me.permissions]);
  const tabs = TABS.filter((t) => perms.has(t[2]));
  const tab = tabs.find((t) => t[0] === params.tab) ? params.tab : 'dashboard';
  let body = '', after = null;
  try { ({ body, after } = await panels[tab](perms, me)); } catch (e) { body = html`<div class="notice err">${errMsg(e)}</div>`; }
  return { html: html`<div class="wrap section"><div class="page-head"><h1>Admin panel</h1><p class="muted">Rol: <b>${ROLES[me.role] || me.role}</b></p></div>
    <nav class="tabs" aria-label="Admin bo'limlari">${tabs.map((t) => html`<a href="#/admin/${t[0]}" ${t[0] === tab ? raw('aria-current="page" class="active"') : ''}>${t[1]}</a>`)}</nav>
    <div id="ap" style="margin-top:1.2rem">${body}</div></div>`,
    mount: (r) => { after?.(r); } };
}

const act = (r, sel, fn) => r.addEventListener('click', async (e) => { const b = e.target.closest(sel); if (!b) return; try { await fn(b, e); } catch (er) { toast(errMsg(er), 'err'); } });
const submit = (r, sel, fn) => $(sel, r)?.addEventListener('submit', async (e) => { e.preventDefault(); try { await fn(e.target); } catch (er) { toast(errMsg(er), 'err'); } });
const val = (f, n) => f.querySelector(`[name="${n}"]`)?.value ?? '';
const rr = () => window.__rerender();

const panels = {
  async dashboard() {
    const d = await api.get('/api/admin/dashboard');
    return { body: html`<div class="grid g4">${stat('Foydalanuvchilar', d.users.total, `${d.users.verified} tasdiqlangan · 7 kun: +${d.users.new_7d}`)}${stat('Haqiqiy Pro', d.subscriptions.production_active, `Demo/sandbox: ${d.subscriptions.demo_or_sandbox_active}`)}${stat('Tahlillar (30 kun)', d.analyses.performed_30d, `Jami: ${d.analyses.performed_total}`)}${stat('Ochiq shikoyatlar', d.community.open_reports, `${d.community.reviews} ta sharh`)}
      ${d.revenue ? stat('Haqiqiy daromad', fmtMoney(d.revenue.real_uzs), `Simulyatsiya (kirmaydi): ${fmtMoney(d.revenue.simulated_uzs)}`) : ''}${stat('Ingredientlar', d.ingredients.total, `Demo: ${d.ingredients.demo} · ` + d.ingredients.by_status.map((s) => `${STATUS[s.status] || s.status}: ${s.n}`).join(', '))}</div>
      <h3 style="margin-top:1.5rem">Eng ko'p tahlil qilingan mahsulotlar</h3>${d.top_products.length ? table(['Mahsulot', 'Brend', 'Soni'], d.top_products.map((p) => html`<tr><td>${p.name}</td><td>${p.brand || ''}</td><td>${p.n}</td></tr>`)) : html`<div class="empty">Ma'lumot yo'q.</div>`}${note(d.top_products_note)}
      <h3>Ro'yxatdan o'tishlar (14 kun)</h3>${d.registrations_by_day.length ? table(['Kun', 'Soni'], d.registrations_by_day.map((x) => html`<tr><td>${x.day}</td><td>${x.n}</td></tr>`)) : html`<div class="empty">Ma'lumot yo'q.</div>`}${note(d.subscriptions.note)}` };
  },

  async ingredients(perms) {
    const q = sessionStorage.getItem('aiq') || '', st = sessionStorage.getItem('ais') || '';
    const d = await api.get(`/api/admin/ingredients?q=${encodeURIComponent(q)}&status=${st}`);
    return { body: html`<form id="f" class="row"><input name="q" value="${q}" placeholder="INCI yoki o'zbekcha nom" aria-label="Qidirish" class="grow"><select name="s" aria-label="Holat"><option value="">Barcha holatlar</option>${Object.entries(STATUS).map(([k, v]) => html`<option value="${k}" ${st === k ? 'selected' : ''}>${v}</option>`)}</select><button class="btn">Filtr</button><button type="button" class="btn primary" id="new">+ Yangi</button></form>
      ${note(`Jami: ${d.total}. Birinchi 50 ta ko'rsatilmoqda. Hech bir yozuv import paytida avtomatik tasdiqlanmaydi.`)}
      ${table(['INCI', "O'zbekcha", 'Holat', 'Yangilangan', ''], d.items.map((i) => html`<tr><td>${i.inci} ${i.is_demo ? html`<span class="tag demo">DEMO</span>` : ''}</td><td>${i.uz_name || ''}</td><td><span class="tag">${STATUS[i.status] || i.status}</span></td><td>${fmtDate(i.updated_at)}</td><td><button class="btn sm" data-edit="${i.id}">Ochish</button></td></tr>`))}<div id="ed"></div>`,
      after: (r) => {
        submit(r, '#f', (f) => { sessionStorage.setItem('aiq', val(f, 'q')); sessionStorage.setItem('ais', val(f, 's')); rr(); });
        $('#new', r).onclick = () => editor(r, null, perms);
        act(r, '[data-edit]', (b) => editor(r, b.dataset.edit, perms));
      } };
  },

  async import() {
    const d = await api.get('/api/admin/import/runs');
    return { body: html`<div class="card stack"><h3>Excel (.xlsx) import</h3><p class="muted small">Faylda 329 ingredient, 83 funksiya, 7 funksiya guruhi, 200 muqobil juftlik va 5 to'qnashuv kutiladi. Import idempotent; barcha yozuvlar <b>Qoralama</b> holatida qo'shiladi, hech narsa avtomatik tasdiqlanmaydi. Natija hisobotida kutilgan va haqiqiy sonlar solishtiriladi.</p>
      <input type="file" id="xf" accept=".xlsx" aria-label="xlsx fayl"><button class="btn primary" id="go">Import qilish</button><div id="rep" aria-live="polite"></div></div>
      <h3 style="margin-top:1.5rem">Oxirgi importlar</h3>${d.items.length ? table(['Sana', 'Fayl', 'Natija', 'Hisobot'], d.items.map((x) => html`<tr><td>${fmtDate(x.at)}</td><td>${x.file_name}</td><td>${x.ok ? html`<span class="tag mint">To'liq</span>` : html`<span class="tag warn">To'liq emas</span>`}</td><td><pre class="small" style="white-space:pre-wrap;max-width:520px">${JSON.stringify(x.report, null, 1)}</pre></td></tr>`)) : html`<div class="empty">Hali import qilinmagan. Asl <code>ingrident.xlsx</code> fayli yuklanmaguncha baza bo'sh (yoki demo).</div>`}`,
      after: (r) => { $('#go', r).onclick = async () => { const f = $('#xf', r).files[0]; if (!f) return toast('Fayl tanlang.', 'err'); try { $('#rep', r).textContent = 'Import qilinmoqda…'; const x = await api.raw('/api/admin/import?name=' + encodeURIComponent(f.name), f, 'application/octet-stream'); $('#rep', r).innerHTML = `<pre class="small" style="white-space:pre-wrap">${esc(JSON.stringify(x.report, null, 1))}</pre>`; } catch (e) { $('#rep', r).innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; } }; } };
  },

  async conflicts() {
    const [c, a] = await Promise.all([api.get('/api/admin/conflicts'), api.get('/api/admin/alternatives')]);
    return { body: html`<h3>To'qnashuvlar</h3>${c.items.length ? table(['A', 'B', 'Tur', 'Holat', ''], c.items.map((x) => html`<tr><td>${x.ingredient_a}</td><td>${x.ingredient_b}</td><td>${x.interaction_type || ''}</td><td class="small">${x.review_status || ''}</td><td><button class="btn sm danger" data-dc="${x.id}">O'chirish</button></td></tr>`)) : html`<div class="empty">Yo'q.</div>`}
      <form id="cf" class="row" style="margin-top:1rem"><input name="a" placeholder="Ingredient A (INCI)" required><input name="b" placeholder="Ingredient B (INCI)" required><input name="t" placeholder="Tur"><input name="d" placeholder="Izoh" class="grow"><button class="btn primary">Qo'shish</button></form>
      <h3 style="margin-top:1.5rem">Muqobil juftliklar (birinchi 500)</h3>${a.items.length ? table(['Asosiy', 'Muqobil', 'O\'xshashlik', 'Holat'], a.items.map((x) => html`<tr><td>${x.main_inci}</td><td>${x.alt_inci}</td><td>${x.similarity ?? ''}</td><td class="small">${x.review_status || ''}</td></tr>`)) : html`<div class="empty">Yo'q.</div>`}`,
      after: (r) => { act(r, '[data-dc]', async (b) => { if (await confirmDialog("To'qnashuvni o'chirasizmi?")) { await api.del('/api/admin/conflicts/' + b.dataset.dc); rr(); } });
        submit(r, '#cf', async (f) => { await api.post('/api/admin/conflicts', { ingredient_a: val(f, 'a'), ingredient_b: val(f, 'b'), interaction_type: val(f, 't'), description: val(f, 'd') }); rr(); }); } };
  },

  async products() {
    const [p, s] = await Promise.all([api.get('/api/admin/products'), api.get('/api/admin/sources')]);
    return { body: html`<h3>Mahsulotlar</h3>${table(['Nomi', 'Brend', 'Barkod', 'Narx (UZS)', ''], p.items.map((x) => html`<tr><td>${x.name} ${x.is_demo ? html`<span class="tag demo">DEMO</span>` : ''}</td><td>${x.brand || ''}</td><td>${x.barcode || ''}</td><td>${x.price_uzs ?? ''} <span class="small muted">${x.price_source || ''}</span></td><td><button class="btn sm danger" data-dp="${x.id}">O'chirish</button></td></tr>`))}
      <form id="pf" class="row" style="margin-top:1rem"><input name="name" placeholder="Nomi" required><input name="brand" placeholder="Brend"><input name="barcode" placeholder="Barkod"><button class="btn primary">Qo'shish</button></form>${note("Narx faqat manbasi ko'rsatilgan bo'lsa kiritiladi; taxminiy narxlar kiritilmaydi.")}
      <h3 style="margin-top:1.5rem">Ilmiy manbalar</h3>${s.items.length ? table(['Nomi', 'URL', ''], s.items.map((x) => html`<tr><td>${x.title || x.name || ''}</td><td class="small">${x.url || ''}</td><td><button class="btn sm danger" data-ds="${x.id}">O'chirish</button></td></tr>`)) : html`<div class="empty">Manbalar yo'q.</div>`}`,
      after: (r) => { act(r, '[data-dp]', async (b) => { if (await confirmDialog("Mahsulotni o'chirasizmi?")) { await api.del('/api/admin/products/' + b.dataset.dp); rr(); } });
        act(r, '[data-ds]', async (b) => { if (await confirmDialog("Manbani o'chirasizmi?")) { await api.del('/api/admin/sources/' + b.dataset.ds); rr(); } });
        submit(r, '#pf', async (f) => { await api.post('/api/admin/products', { name: val(f, 'name'), brand: val(f, 'brand'), barcode: val(f, 'barcode') }); rr(); }); } };
  },

  async moderation() {
    const [rp, rv] = await Promise.all([api.get('/api/admin/reports'), api.get('/api/admin/reviews')]);
    return { body: html`<h3>Ochiq shikoyatlar</h3>${rp.items.length ? rp.items.map((x) => html`<div class="card" style="margin-bottom:.7rem"><div class="small muted">${x.type} #${x.target_id} · ${fmtDate(x.created_at)}</div><p><b>Sabab:</b> ${x.reason}</p><p>${x.content ? html`“${x.content.body}” — ${x.content.author} <span class="tag">${x.content.status}</span>` : 'Kontent topilmadi'}</p><div class="row"><button class="btn sm danger" data-hide="${x.id}">Yashirish</button><button class="btn sm" data-dis="${x.id}">Rad etish</button></div></div>`) : html`<div class="empty">Ochiq shikoyat yo'q.</div>`}
      <h3 style="margin-top:1.5rem">So'nggi sharhlar</h3>${table(['Mahsulot', 'Muallif', 'Baho', 'Matn', 'Holat', ''], rv.items.map((x) => html`<tr><td>${x.product}</td><td>${x.nickname}</td><td>${x.rating}</td><td>${x.body}</td><td>${x.status}</td><td><button class="btn sm" data-vis="${x.id}" data-to="${x.status === 'visible' ? 'hidden' : 'visible'}">${x.status === 'visible' ? 'Yashirish' : "Ko'rsatish"}</button></td></tr>`))}`,
      after: (r) => { act(r, '[data-hide]', async (b) => { await api.post(`/api/admin/reports/${b.dataset.hide}/action`, { action: 'hide' }); rr(); });
        act(r, '[data-dis]', async (b) => { await api.post(`/api/admin/reports/${b.dataset.dis}/action`, { action: 'dismiss' }); rr(); });
        act(r, '[data-vis]', async (b) => { await api.post(`/api/admin/reviews/${b.dataset.vis}/visibility`, { status: b.dataset.to }); rr(); }); } };
  },

  async users(perms, me) {
    const q = sessionStorage.getItem('auq') || ''; const d = await api.get('/api/admin/users?q=' + encodeURIComponent(q));
    const canRole = perms.has('roles.manage'), canMod = perms.has('users.moderate');
    return { body: html`<form id="f" class="row"><input name="q" value="${q}" placeholder="Email yoki nik" class="grow" aria-label="Qidirish"><button class="btn">Qidirish</button></form>${note(`Jami: ${d.total}`)}
      ${table(['Nik', 'Email', 'Rol', 'Reja', 'Holat', 'Manba', ''], d.items.map((u) => html`<tr><td>${u.nickname}</td><td class="small">${u.email}${u.email_verified ? '' : ' (tasdiqlanmagan)'}</td>
        <td>${u.role === 'super_admin' ? html`<span class="tag gold">Super Admin</span>` : canRole ? html`<select data-role="${u.id}" aria-label="Rol"><option value="">—</option>${['content_editor', 'marketer'].map((k) => html`<option value="${k}" ${u.role === k ? 'selected' : ''}>${ROLES[k]}</option>`)}</select>` : (ROLES[u.role] || '—')}</td>
        <td>${u.plan}</td><td>${u.status}</td><td class="small">${u.reg_source || ''}</td>
        <td>${canMod && u.role !== 'super_admin' ? html`<select data-st="${u.id}" aria-label="Holat">${['active', 'restricted', 'blocked'].map((k) => html`<option value="${k}" ${u.status === k ? 'selected' : ''}>${k}</option>`)}</select>` : ''}</td></tr>`))}
      ${note("Super Admin faqat serverdagi SUPER_ADMIN_EMAIL sozlamasi orqali belgilanadi va bu yerdan berilmaydi.")}`,
      after: (r) => { submit(r, '#f', (f) => { sessionStorage.setItem('auq', val(f, 'q')); rr(); });
        r.addEventListener('change', async (e) => { const t = e.target; try {
          if (t.dataset.role !== undefined) { await api.post(`/api/admin/users/${t.dataset.role}/role`, { role: t.value || null }); toast('Rol yangilandi.'); }
          else if (t.dataset.st) { const reason = t.value === 'active' ? '' : prompt('Sabab (ixtiyoriy):') || ''; await api.post(`/api/admin/users/${t.dataset.st}/status`, { status: t.value, reason }); toast('Holat yangilandi.'); }
        } catch (er) { toast(errMsg(er), 'err'); rr(); } }); } };
  },

  async finance() {
    const [p, s] = await Promise.all([api.get('/api/admin/payments'), api.get('/api/admin/subscriptions')]);
    const pv = p.provider;
    return { body: html`<div class="notice warn"><span>⚠</span><span>To'lov holati: <b>${pv.state || pv.status || 'noma\'lum'}</b>. ${pv.detail || pv.note || ''}</span></div>
      <div class="grid g2" style="margin-top:1rem">${stat('Haqiqiy tushum', fmtMoney(p.totals.real_paid_uzs))}${stat('Simulyatsiya (hisobotga kirmaydi)', fmtMoney(p.totals.simulated_paid_uzs))}</div>${note(p.note)}
      <h3>To'lovlar</h3>${p.items.length ? table(['ID', 'Provayder', 'Summa', 'Holat', 'Sim.', 'Sana'], p.items.map((x) => html`<tr><td class="small">${x.provider_txn_id || x.id}</td><td>${x.provider}</td><td>${fmtMoney(x.amount_uzs)}</td><td>${x.status}</td><td>${x.simulated ? 'ha' : 'yo\'q'}</td><td>${fmtDate(x.created_at)}</td></tr>`)) : html`<div class="empty">To'lovlar yo'q.</div>`}
      <h3 style="margin-top:1.5rem">Obunalar</h3>${s.items.length ? table(['Foydalanuvchi', 'Manba', 'Holat', 'Davr', 'Avto'], s.items.map((x) => html`<tr><td>${x.nickname}</td><td>${x.source}</td><td>${x.status}</td><td>${fmtDate(x.period_start)} — ${fmtDate(x.period_end)}</td><td>${x.auto_renew ? 'ha' : "yo'q"}</td></tr>`)) : html`<div class="empty">Obunalar yo'q.</div>`}` };
  },

  async marketing(perms) {
    const [f, c, pc] = await Promise.all([api.get('/api/admin/funnel'), api.get('/api/admin/campaigns'), api.get('/api/admin/promo-codes')]);
    const w = perms.has('marketing.write'), F = f.funnel;
    return { body: html`<h3>Voronka</h3><div class="grid g4">${stat('Tashrif buyuruvchilar', F.visitors)}${stat("Ro'yxatdan o'tgan", F.registered)}${stat('Birinchi tahlil', F.first_analysis)}${stat("Pro ko'rgan", F.pro_view)}${stat('Haqiqiy xarid', F.purchase_real, `Simulyatsiya: ${F.purchase_simulated}`)}${stat('Referallar', f.referrals.total, `Konversiya: ${f.referrals.converted}`)}</div>${note(f.note)}
      <h3 style="margin-top:1.5rem">Manbalar bo'yicha</h3>${f.by_source.length ? table(['Manba', 'Kampaniya', 'Tashrif', "Ro'yxat", 'Tahlil', 'Pro', 'Xarid'], f.by_source.map((x) => html`<tr><td>${x.source}</td><td>${x.campaign}</td><td>${x.visits}</td><td>${x.registrations}</td><td>${x.first_analyses}</td><td>${x.pro_views}</td><td>${x.purchases}</td></tr>`)) : html`<div class="empty">Hodisalar hali yo'q.</div>`}
      <h3 style="margin-top:1.5rem">Kampaniyalar (UTM)</h3>${c.items.length ? table(['Nom', 'Havola'], c.items.map((x) => html`<tr><td>${x.name}</td><td class="small" style="word-break:break-all">${x.link}</td></tr>`)) : html`<div class="empty">Kampaniya yo'q.</div>`}
      ${w ? html`<form id="cf" class="row" style="margin-top:.8rem"><input name="name" placeholder="Nom" required><input name="s" placeholder="utm_source"><input name="m" placeholder="utm_medium"><input name="c" placeholder="utm_campaign"><button class="btn primary">Yaratish</button></form>` : ''}
      <h3 style="margin-top:1.5rem">Promo-kodlar</h3>${pc.items.length ? table(['Kod', 'Chegirma', 'Amal qilish', 'Ishlatilgan', 'Faol'], pc.items.map((x) => html`<tr><td>${x.code}</td><td>${x.percent_off}%</td><td>${x.valid_until || ''}</td><td>${x.used_count ?? 0}${x.max_uses ? '/' + x.max_uses : ''}</td><td>${w ? html`<input type="checkbox" data-pa="${x.id}" ${x.active ? 'checked' : ''} aria-label="Faol">` : (x.active ? 'ha' : "yo'q")}</td></tr>`)) : html`<div class="empty">Promo-kod yo'q.</div>`}
      ${w ? html`<form id="pcf" class="row" style="margin-top:.8rem"><input name="code" placeholder="KOD" required><input name="p" type="number" min="1" max="100" placeholder="%" required><input name="v" type="date"><input name="mx" type="number" min="1" placeholder="Maks. soni"><button class="btn primary">Yaratish</button></form>${note("Yangi promo-kod faol emas holatda yaratiladi.")}` : ''}`,
      after: (r) => { submit(r, '#cf', async (x) => { await api.post('/api/admin/campaigns', { name: val(x, 'name'), utm_source: val(x, 's'), utm_medium: val(x, 'm'), utm_campaign: val(x, 'c') }); rr(); });
        submit(r, '#pcf', async (x) => { const o = await api.post('/api/admin/promo-codes', { code: val(x, 'code'), percent_off: val(x, 'p'), valid_until: val(x, 'v'), max_uses: val(x, 'mx') }); toast(o.note || 'Yaratildi'); rr(); });
        r.addEventListener('change', async (e) => { const t = e.target; if (t.dataset.pa) try { await api.post(`/api/admin/promo-codes/${t.dataset.pa}/active`, { active: t.checked }); } catch (er) { toast(errMsg(er), 'err'); rr(); } }); } };
  },

  async analytics() {
    const d = await api.get('/api/admin/analytics');
    return { body: html`<h3>OCR sifati</h3><div class="grid g4">${stat('Jami OCR', d.ocr.total)}${stat('Xatolik bilan', d.ocr.failed)}${stat("O'rtacha vaqt (ms)", d.ocr.avg_ms ?? '—')}${stat("O'rtacha ishonch", d.ocr.avg_confidence ?? '—')}</div>
      ${d.ocr.by_error.length ? table(['Xato kodi', 'Soni'], d.ocr.by_error.map((x) => html`<tr><td>${x.error_code}</td><td>${x.n}</td></tr>`)) : ''}<h3 style="margin-top:1.5rem">Barkod bazada topilmadi</h3>${d.barcode_not_found.length ? table(['Barkod', 'Soni'], d.barcode_not_found.map((x) => html`<tr><td>${x.barcode}</td><td>${x.n}</td></tr>`)) : html`<div class="empty">Yo'q.</div>`}` };
  },

  async diary() {
    const d = await api.get('/api/admin/diary-questions');
    return { body: html`${table(['#', 'Savol', 'Faol'], d.items.map((x) => html`<tr><td>${x.sort}</td><td>${x.text || x.question}</td><td><input type="checkbox" data-dq="${x.id}" ${x.active ? 'checked' : ''} aria-label="Faol"></td></tr>`))}
      <form id="qf" class="row" style="margin-top:1rem"><input name="t" class="grow" placeholder="Yangi savol" required><button class="btn primary">Qo'shish</button></form>`,
      after: (r) => { submit(r, '#qf', async (f) => { await api.post('/api/admin/diary-questions', { text: val(f, 't') }); rr(); });
        r.addEventListener('change', async (e) => { const t = e.target; if (t.dataset.dq) try { await api.post(`/api/admin/diary-questions/${t.dataset.dq}/active`, { active: t.checked }); } catch (er) { toast(errMsg(er), 'err'); rr(); } }); } };
  },

  async system() {
    const d = await api.get('/api/admin/system');
    const row = (n, o) => html`<tr><td>${n}</td><td><span class="tag ${o.ok || o.state === 'ready' || o.state === 'configured' ? 'mint' : 'warn'}">${o.state || (o.ok ? 'ok' : 'xato')}</span></td><td class="small">${o.detail || o.note || ''}</td></tr>`;
    return { body: html`<p class="muted small">Tekshiruv vaqti: ${d.checked_at} (jonli tekshiruv)</p>${table(['Komponent', 'Holat', 'Izoh'], [row('Ma\'lumotlar bazasi (' + d.database.engine + ')', d.database), row('OCR', d.ocr), row('Barkod manbai', d.barcode), row('Email', d.mail), row("To'lov", d.payments)])}
      <div class="grid g4" style="margin-top:1rem">${stat('Node', d.server.node)}${stat('Ish vaqti (s)', d.server.uptime_s)}${stat('Xotira (MB)', d.server.memory_mb)}${stat('Yuklangan fayllar', d.storage.files, Math.round(d.storage.bytes / 1024) + ' KB · saqlash: ' + d.retention_hours + ' soat')}</div>
      ${d.demo_mode ? html`<div class="notice warn" style="margin-top:1rem">DEMO_MODE yoqilgan — bu ishlab chiqarish uchun mos emas.</div>` : ''}
      <h3 style="margin-top:1.5rem">So'nggi tizim hodisalari</h3>${d.recent_events.length ? table(['Vaqt', 'Daraja', 'Tur', 'Xabar'], d.recent_events.map((x) => html`<tr><td class="small">${x.at}</td><td>${x.level}</td><td>${x.kind}</td><td class="small">${x.message}</td></tr>`)) : html`<div class="empty">Hodisa yo'q.</div>`}` };
  },

  async audit() {
    const a = sessionStorage.getItem('aua') || ''; const d = await api.get('/api/admin/audit?action=' + encodeURIComponent(a));
    return { body: html`<form id="f" class="row"><input name="a" value="${a}" placeholder="Amal bo'yicha filtr" class="grow" aria-label="Filtr"><button class="btn">Filtr</button></form>
      ${d.items.length ? table(['Vaqt', 'Aktyor', 'Amal', 'Obyekt', 'Tafsilot'], d.items.map((x) => html`<tr><td class="small">${x.at}</td><td>${x.actor_id ?? ''}</td><td>${x.action}</td><td class="small">${x.target ?? ''}</td><td class="small"><code>${x.detail ? JSON.stringify(x.detail) : ''}</code></td></tr>`)) : html`<div class="empty">Yozuv yo'q.</div>`}`,
      after: (r) => submit(r, '#f', (f) => { sessionStorage.setItem('aua', val(f, 'a')); rr(); }) };
  },

  async settings() {
    const d = (await api.get('/api/admin/settings')).items;
    const L = { free_monthly_limit: 'Free: oylik tahlillar', pro_monthly_limit: 'Pro: oylik tahlillar', price_pro_month_uzs: "Pro narxi (so'm/oy)" };
    return { body: html`<form id="sf" class="card stack form-narrow">${Object.keys(L).map((k) => html`<div class="field"><label for="${k}">${L[k]}</label><input id="${k}" name="${k}" type="number" min="0" value="${d[k] ?? ''}" placeholder="standart"></div>`)}<button class="btn primary">Saqlash</button>${note("Bo'sh qoldirilsa standart qiymat ishlatiladi. Narx haqiqiy to'lov provayderi ulanmaguncha faqat ko'rsatish uchun.")}</form>`,
      after: (r) => submit(r, '#sf', async (f) => { const b = {}; for (const k of ['free_monthly_limit', 'pro_monthly_limit', 'price_pro_month_uzs']) b[k] = val(f, k); await api.put('/api/admin/settings', b); toast('Saqlandi.'); }) };
  },
};

const DIMS = [['climate', "O'zbekiston iqlimi"], ['pregnancy', 'Homiladorlik'], ['dry', 'Quruq teri'], ['oily', "Yog'li teri"], ['sensitive', 'Sezgir teri']];
const FIELDS = [['inci', 'INCI nomi'], ['uz_name', "O'zbekcha nomi"], ['synonyms', 'Sinonimlar'], ['cas', 'CAS'], ['cosing_functions', 'CosIng funksiyalari'], ['function_uz', 'Funksiya (uz)'], ['description_uz', 'Tavsif'], ['detailed_explanation', 'Batafsil izoh'], ['safety_general', 'Umumiy xavfsizlik'], ['pregnancy_info', 'Homiladorlik'], ['oily_info', "Yog'li teri"], ['dry_info', 'Quruq teri'], ['sensitive_info', 'Sezgir teri'], ['eu_restrictions', 'EU cheklovlari'], ['eu_allergen', 'EU allergen'], ['sccs', 'SCCS'], ['cir', 'CIR'], ['source_urls', 'Manba havolalari'], ['pharmacist_comment', 'Farmatsevt izohi']];

async function editor(r, id, perms) {
  const box = $('#ed', r); box.innerHTML = '<div class="loading">Yuklanmoqda…</div>';
  const ing = id ? await api.get('/api/admin/ingredients/' + id) : {};
  const hist = id ? (await api.get(`/api/admin/ingredients/${id}/history`)).items : [];
  const canApprove = perms.has('ingredients.approve');
  box.innerHTML = html`<div class="card stack" style="margin-top:1.5rem"><h3>${id ? ing.inci : 'Yangi ingredient'} ${ing.is_demo ? html`<span class="tag demo">DEMO</span>` : ''}</h3>
    <form id="ief" class="grid g2">${FIELDS.map(([k, l]) => ['detailed_explanation', 'description_uz', 'safety_general', 'pregnancy_info', 'oily_info', 'dry_info', 'sensitive_info', 'pharmacist_comment', 'source_urls'].includes(k) ? html`<div class="field" style="grid-column:1/-1"><label for="f_${k}">${l}</label><textarea id="f_${k}" name="${k}" rows="3">${ing[k] || ''}</textarea></div>` : html`<div class="field"><label for="f_${k}">${l}</label><input id="f_${k}" name="${k}" type="text" value="${ing[k] || ''}"></div>`)}<div style="grid-column:1/-1" class="row"><button class="btn primary">Saqlash</button><button type="button" class="btn ghost" id="cl">Yopish</button></div></form>
    ${id ? html`<h4>Holat: <span class="tag">${STATUS[ing.status] || ing.status}</span></h4><div class="row"><select id="nst" aria-label="Yangi holat">${Object.entries(STATUS).filter(([k]) => k !== 'approved' || canApprove).map(([k, v]) => html`<option value="${k}" ${ing.status === k ? 'selected' : ''}>${v}</option>`)}</select><button class="btn" id="stb">Holatni o'zgartirish</button></div>${canApprove ? '' : note("Tasdiqlash faqat vakolatli tekshiruvchi (Super Admin) uchun.")}
      <h4>Baholar (foiz hisobiga faqat tasdiqlangan baholar kiradi)</h4>${DIMS.map(([k, l]) => { const a = (ing.assessments || []).find((x) => x.dimension === k) || {}; return html`<form class="row" data-asf="${k}"><b style="min-width:150px">${l}</b><select name="stance" aria-label="Baho"><option value="favorable" ${a.stance === 'favorable' ? 'selected' : ''}>Qulay</option><option value="neutral" ${a.stance === 'neutral' || !a.stance ? 'selected' : ''}>Neytral</option><option value="caution" ${a.stance === 'caution' ? 'selected' : ''}>Ehtiyot</option></select><select name="ev" aria-label="Dalil"><option value="high" ${a.evidence_level === 'high' ? 'selected' : ''}>Yuqori dalil</option><option value="moderate" ${a.evidence_level === 'moderate' || !a.evidence_level ? 'selected' : ''}>O'rta</option><option value="low" ${a.evidence_level === 'low' ? 'selected' : ''}>Past</option></select><input name="src" type="url" placeholder="Manba URL" value="${a.source_ref || ''}" class="grow" aria-label="Manba"><input name="note" placeholder="Izoh" value="${a.note || ''}" aria-label="Izoh">${canApprove ? html`<label class="small"><input type="checkbox" name="ap" ${a.approved ? 'checked' : ''}> tasdiqlangan</label>` : html`<span class="tag">${a.approved ? 'tasdiqlangan' : 'qoralama'}</span>`}<button class="btn sm">Saqlash</button>${a.dimension ? html`<button type="button" class="btn sm danger" data-delas="${k}">×</button>` : ''}</form>`; })}
      <h4>O'zgarishlar tarixi</h4>${hist.length ? table(['Vaqt', 'Kim', 'Tur', 'Tafsilot'], hist.slice(0, 30).map((h) => html`<tr><td class="small">${h.at}</td><td>${h.by || ''}</td><td>${h.change_type}</td><td class="small"><code>${JSON.stringify(h.after || h.before || '').slice(0, 160)}</code></td></tr>`)) : html`<div class="empty">Tarix yo'q.</div>`}` : ''}</div>`.__raw;
  box.scrollIntoView({ behavior: 'smooth' });
  $('#cl', box).onclick = () => { box.innerHTML = ''; };
  $('#ief', box).onsubmit = async (e) => { e.preventDefault(); const b = {}; for (const [k] of FIELDS) b[k] = val(e.target, k); try { if (id) { const o = await api.put('/api/admin/ingredients/' + id, b); toast(o.changed.length ? "Saqlandi (tasdiqlangan bo'lsa, qayta ko'rib chiqishga qaytdi)." : "O'zgarish yo'q."); } else { await api.post('/api/admin/ingredients', b); toast('Yaratildi (qoralama).'); } rr(); } catch (er) { toast(errMsg(er), 'err'); } };
  if (id) {
    $('#stb', box).onclick = async () => { try { await api.post(`/api/admin/ingredients/${id}/status`, { status: $('#nst', box).value }); toast('Holat yangilandi.'); rr(); } catch (er) { toast(errMsg(er), 'err'); } };
    $$('[data-asf]', box).forEach((f) => f.addEventListener('submit', async (e) => { e.preventDefault(); try { await api.put(`/api/admin/ingredients/${id}/assessments`, { dimension: f.dataset.asf, stance: val(f, 'stance'), evidence_level: val(f, 'ev'), source_ref: val(f, 'src'), note: val(f, 'note'), approved: !!f.querySelector('[name=ap]')?.checked }); toast('Baho saqlandi.'); } catch (er) { toast(errMsg(er), 'err'); } }));
    act(box, '[data-delas]', async (b) => { await api.del(`/api/admin/ingredients/${id}/assessments/${b.dataset.delas}`); editor(r, id, perms); });
  }
}

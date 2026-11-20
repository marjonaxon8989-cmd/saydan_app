import { html, raw, $, $$, api, state, toast, errMsg, confirmDialog, esc } from '../core.js';
import { guard } from './gate.js';

const TABS = [['today', 'Bugun'], ['routines', 'Tartiblar'], ['stats', 'Statistika']];
const today = () => new Date().toISOString().slice(0, 10);

function barChart(days, label) {
  const max = Math.max(1, ...days.map((d) => d.total));
  return html`<div role="img" aria-label="${label}"><div class="bars">${days.map((d) => html`<i style="height:${Math.round((d.done / max) * 100)}%" title="${d.date}: ${d.done}/${d.total}"></i>`)}</div>
    <div class="row small muted" style="justify-content:space-between"><span>${days[0]?.date}</span><span>${days[days.length - 1]?.date}</span></div></div>`;
}
export default async function diary({ params, query }) {
  const g = guard('diary', 'Parvarish kundaligi', "Tartiblar, vazifalar, eslatmalar va real ma'lumotlarga asoslangan statistika."); if (g) return g;
  const tab = params.tab || 'today';
  const tabs = html`<div class="tabs">${TABS.map(([k, l]) => html`<a href="#/diary/${k}" ${tab === k ? 'aria-current="page"' : ''}>${l}</a>`)}</div>`;
  let body, mount;
  if (tab === 'today') {
    const d = await api.get('/api/diary/day');
    body = html`<div class="stack"><p class="muted">${d.date} · bajarildi ${d.done}/${d.total}</p>
      ${!d.routines.length ? html`<div class="empty">Hali tartib yo'q. <a href="#/diary/routines">Birinchi tartibni yarating</a>.</div>` : d.routines.map((r) => html`<div class="card"><h3>${r.name} <span class="tag">${{ am: 'Ertalab', pm: 'Kechqurun', any: 'Istalgan vaqt' }[r.period]}</span></h3>
        ${r.tasks.length ? r.tasks.map((t) => html`<label class="check-task"><input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''}><span>${t.title}</span></label>`) : html`<p class="muted small">Vazifa qo'shilmagan.</p>`}</div>`)}
      ${d.questions.length ? html`<form id="qf" class="card stack"><h3>Kunlik savollar <span class="small muted">(1–2 daqiqa)</span></h3><p class="small muted">Javoblaringiz faqat o'zingiz uchun; tibbiy tashxis uchun ishlatilmaydi.</p>
        ${d.questions.map((q) => html`<div class="field"><label for="q${q.id}">${q.text}</label>${q.kind === 'scale' ? html`<select id="q${q.id}" data-q="${q.id}"><option value="">—</option>${[1, 2, 3, 4, 5].map((n) => html`<option ${d.answers[q.id] == n ? 'selected' : ''}>${n}</option>`)}</select>` : q.kind === 'yesno' ? html`<select id="q${q.id}" data-q="${q.id}"><option value="">—</option><option value="yes" ${d.answers[q.id] === 'yes' ? 'selected' : ''}>Ha</option><option value="no" ${d.answers[q.id] === 'no' ? 'selected' : ''}>Yo'q</option></select>` : html`<input id="q${q.id}" type="text" data-q="${q.id}" maxlength="300" value="${d.answers[q.id] || ''}">`}</div>`)}<button class="btn">Javoblarni saqlash</button></form>` : ''}</div>`;
    mount = (r) => {
      r.addEventListener('change', async (e) => { const id = e.target.dataset.task; if (!id) return; try { await api.post('/api/diary/progress', { task_id: parseInt(id, 10), date: d.date, done: e.target.checked }); } catch (er) { e.target.checked = !e.target.checked; toast(errMsg(er), 'err'); } });
      $('#qf', r)?.addEventListener('submit', async (e) => { e.preventDefault(); const a = {}; $$('[data-q]', r).forEach((el) => { if (el.value) a[el.dataset.q] = el.value; }); try { await api.post('/api/diary/answers', { date: d.date, answers: a }); toast('Saqlandi.'); } catch (er) { toast(errMsg(er), 'err'); } });
    };
  } else if (tab === 'routines') {
    const r = await api.get('/api/diary/routines');
    body = html`<div class="stack"><div class="notice"><span>ⓘ</span><span class="small">${r.reminder_delivery.note}</span></div>
      <form id="rf" class="card row"><div class="grow"><label for="rn">Yangi tartib nomi</label><input id="rn" type="text" required minlength="2" maxlength="60" placeholder="Ertalabki parvarish"></div><div><label for="rp">Vaqt</label><select id="rp"><option value="am">Ertalab</option><option value="pm">Kechqurun</option><option value="any">Istalgan</option></select></div><button class="btn primary" style="align-self:end">Yaratish</button></form>
      ${r.items.map((x) => html`<div class="card stack"><div class="row"><h3 class="grow">${x.name}</h3><button class="btn sm danger" data-delr="${x.id}">O'chirish</button></div>
        <ul style="list-style:none;padding:0">${x.tasks.map((t) => html`<li class="row" style="justify-content:space-between"><span>${t.title}</span><button class="link" data-delt="${t.id}" aria-label="${t.title} vazifasini o'chirish">o'chirish</button></li>`)}</ul>
        <form class="row" data-addt="${x.id}"><input type="text" placeholder="Yangi vazifa (masalan: yuzni yuvish)" minlength="2" maxlength="80" required class="grow" aria-label="Yangi vazifa"><button class="btn sm">Qo'shish</button></form>
        <div><b class="small">Eslatmalar:</b> ${x.reminders.length ? x.reminders.map((m) => html`<span class="tag">${m.time_hhmm} <button class="link" data-delm="${m.id}" aria-label="Eslatmani o'chirish">×</button></span> `) : html`<span class="muted small">yo'q</span>`}
        <form class="row" data-addm="${x.id}" style="margin-top:.4rem"><input type="time" required aria-label="Eslatma vaqti" style="max-width:150px"><button class="btn sm">Eslatma qo'shish</button></form></div></div>`)}</div>`;
    mount = (root) => {
      const act = (fn) => async (e) => { e.preventDefault?.(); try { await fn(e); window.__rerender(); } catch (er) { toast(errMsg(er), 'err'); } };
      $('#rf', root).onsubmit = act(() => api.post('/api/diary/routines', { name: $('#rn', root).value, period: $('#rp', root).value }));
      $$('[data-addt]', root).forEach((f) => (f.onsubmit = act(() => api.post(`/api/diary/routines/${f.dataset.addt}/tasks`, { title: f.querySelector('input').value }))));
      $$('[data-addm]', root).forEach((f) => (f.onsubmit = act(() => api.post('/api/diary/reminders', { routine_id: parseInt(f.dataset.addm, 10), time: f.querySelector('input').value }))));
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-delr],[data-delt],[data-delm]'); if (!b) return;
        const url = b.dataset.delr ? `/api/diary/routines/${b.dataset.delr}` : b.dataset.delt ? `/api/diary/tasks/${b.dataset.delt}` : `/api/diary/reminders/${b.dataset.delm}`;
        if (b.dataset.delr && !(await confirmDialog("Tartib va uning vazifalari o'chirilsinmi?", "O'chirish"))) return;
        try { await api.del(url); window.__rerender(); } catch (er) { toast(errMsg(er), 'err'); }
      });
    };
  } else {
    const range = ['day', 'week', 'month'].includes(query.range) ? query.range : 'week';
    const s = await api.get('/api/diary/stats?range=' + range);
    body = html`<div class="stack"><div class="row">${[['day', 'Kun'], ['week', 'Hafta'], ['month', 'Oy']].map(([k, l]) => html`<button class="btn sm ${range === k ? 'primary' : ''}" data-range="${k}">${l}</button>`)}</div>
      <div class="grid g3"><div class="stat"><b>${s.summary.percent ?? '—'}${s.summary.percent != null ? '%' : ''}</b><span>Umumiy bajarilish</span></div><div class="stat"><b>${s.summary.done}</b><span>Bajarilgan vazifalar</span></div><div class="stat"><b>${s.summary.remaining}</b><span>Bajarilmagan</span></div></div>
      ${s.summary.total ? html`<div class="card"><h3>Kunlar bo'yicha</h3>${barChart(s.days, `Kunlik bajarilgan vazifalar, ${s.start} dan ${s.end} gacha`)}</div>
      ${s.perRoutine.length ? html`<div class="card"><h3>Tartiblar bo'yicha</h3>${s.perRoutine.map((p) => html`<p>${p.name}: ${p.done}/${p.total} ${p.percent != null ? `(${p.percent}%)` : ''}</p>`)}</div>` : ''}` : html`<div class="empty">Statistika uchun avval tartib va vazifalar yarating.</div>`}
      <p class="small muted">${s.note}</p></div>`;
    mount = (r) => r.addEventListener('click', (e) => { const k = e.target.dataset.range; if (k) location.hash = `#/diary/stats?range=${k}`; });
  }
  return { html: html`<div class="wrap section"><div class="page-head"><h1>Parvarish kundaligi</h1><p class="muted">Bu bo'lim tibbiy o'lchov emas — faqat o'zingiz belgilagan vazifalar statistikasi.</p></div>${tabs}${body}</div>`, mount, keepScroll: true };
}

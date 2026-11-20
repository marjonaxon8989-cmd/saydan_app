import { route, HttpError, bad } from '../http.mjs';
import { db, tx } from '../db.mjs';
import { cfg } from '../config.mjs';
import { clampStr, isoDateOnly, safeJson } from '../util.mjs';
import { encryptJson, decryptJson } from '../crypto.mjs';
import { activeSubscription, usageStatus } from '../entitlements.mjs';
import { providerStatus, priceUzs, createSandboxCheckout, handleSandboxWebhook, sign } from '../payments/index.mjs';
import { shapeForPlan } from '../analysis/engine.mjs';
import { expiryInfo } from './analysis.mjs';
import { audit } from '../audit.mjs';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------- Teri profili (Pro; sezgir; shifrlangan) ----------
const SKIN = ['dry', 'oily', 'combination', 'normal', 'unknown'];
const SENS = ['low', 'medium', 'high', 'unknown'];
route('GET', '/api/profile', { auth: 'required', pro: 'skin_profile' }, async (ctx) => {
  const r = db().prepare('SELECT data_enc, consent_at, updated_at FROM profiles WHERE user_id = ?').get(ctx.user.id);
  return r ? { profile: decryptJson(r.data_enc), consent_at: r.consent_at, updated_at: r.updated_at } : { profile: null };
});
route('PUT', '/api/profile', { auth: 'required', pro: 'skin_profile' }, async (ctx) => {
  const b = await ctx.json();
  if (b.consent !== true) throw bad('consent_required', "Teri profilini saqlash uchun aniq roziligingiz kerak.");
  const data = {
    skin_type: SKIN.includes(b.skin_type) ? b.skin_type : 'unknown',
    sensitivity: SENS.includes(b.sensitivity) ? b.sensitivity : 'unknown',
    allergens: Array.isArray(b.allergens) ? b.allergens.map((a) => clampStr(a, 60)).filter(Boolean).slice(0, 30) : [],
    pregnancy_pref: b.pregnancy_pref === true ? true : b.pregnancy_pref === false ? false : null,   // ixtiyoriy, faqat foydalanuvchi o'zi bersa
  };
  const now = new Date().toISOString();
  db().prepare('INSERT INTO profiles(user_id, data_enc, consent_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET data_enc = excluded.data_enc, updated_at = excluded.updated_at')
    .run(ctx.user.id, encryptJson(data), now, now);
  return { ok: true };
});
route('DELETE', '/api/profile', { auth: 'required' }, async (ctx) => { db().prepare('DELETE FROM profiles WHERE user_id = ?').run(ctx.user.id); return { ok: true }; });

// ---------- Kundalik ----------
const own = (table, id, userId) => {
  const sql = { routine: 'SELECT * FROM care_routines WHERE id = ? AND user_id = ?',
    task: 'SELECT t.* FROM routine_tasks t JOIN care_routines r ON r.id = t.routine_id WHERE t.id = ? AND r.user_id = ?',
    reminder: 'SELECT * FROM reminders WHERE id = ? AND user_id = ?', shelf: 'SELECT * FROM shelf_items WHERE id = ? AND user_id = ?' }[table];
  const r = db().prepare(sql).get(id, userId);
  if (!r) throw new HttpError(404, 'not_found', 'Topilmadi.');
  return r;
};
route('GET', '/api/diary/routines', { auth: 'required', pro: 'routines' }, async (ctx) => {
  const rs = db().prepare('SELECT * FROM care_routines WHERE user_id = ? ORDER BY id').all(ctx.user.id);
  return { items: rs.map((r) => ({ ...r, tasks: db().prepare('SELECT id, title, sort FROM routine_tasks WHERE routine_id = ? ORDER BY sort, id').all(r.id), reminders: db().prepare('SELECT id, time_hhmm, enabled FROM reminders WHERE routine_id = ? ORDER BY time_hhmm').all(r.id) })),
    reminder_delivery: { state: 'in_app_only', note: "Eslatmalar hozircha faqat ilova ichida ko'rsatiladi. Email/push yuborish uchun xizmat provayderi va rejalashtiruvchi ulanishi kerak." } };
});
route('POST', '/api/diary/routines', { auth: 'required', pro: 'routines' }, async (ctx) => {
  const b = await ctx.json();
  const name = clampStr(b.name, 60);
  if (name.length < 2) throw bad('invalid_name', "Nom kamida 2 belgi bo'lsin.");
  if (db().prepare('SELECT COUNT(*) n FROM care_routines WHERE user_id = ?').get(ctx.user.id).n >= 20) throw bad('limit', "Ko'pi bilan 20 ta tartib yaratish mumkin.");
  const period = ['am', 'pm', 'any'].includes(b.period) ? b.period : 'any';
  const id = Number(db().prepare('INSERT INTO care_routines(user_id, name, period) VALUES (?,?,?)').run(ctx.user.id, name, period).lastInsertRowid);
  return { ok: true, id };
});
route('DELETE', '/api/diary/routines/:id', { auth: 'required', pro: 'routines' }, async (ctx) => { own('routine', ctx.params.id, ctx.user.id); db().prepare('DELETE FROM care_routines WHERE id = ?').run(ctx.params.id); return { ok: true }; });
route('POST', '/api/diary/routines/:id/tasks', { auth: 'required', pro: 'routines' }, async (ctx) => {
  own('routine', ctx.params.id, ctx.user.id);
  const title = clampStr((await ctx.json()).title, 80);
  if (title.length < 2) throw bad('invalid_title', "Vazifa nomi kamida 2 belgi bo'lsin.");
  if (db().prepare('SELECT COUNT(*) n FROM routine_tasks WHERE routine_id = ?').get(ctx.params.id).n >= 30) throw bad('limit', "Bir tartibda ko'pi bilan 30 ta vazifa.");
  const id = Number(db().prepare('INSERT INTO routine_tasks(routine_id, title, sort) VALUES (?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM routine_tasks WHERE routine_id = ?))').run(ctx.params.id, title, ctx.params.id).lastInsertRowid);
  return { ok: true, id };
});
route('DELETE', '/api/diary/tasks/:id', { auth: 'required', pro: 'routines' }, async (ctx) => { own('task', ctx.params.id, ctx.user.id); db().prepare('DELETE FROM routine_tasks WHERE id = ?').run(ctx.params.id); return { ok: true }; });
route('POST', '/api/diary/reminders', { auth: 'required', pro: 'routines' }, async (ctx) => {
  const b = await ctx.json();
  own('routine', b.routine_id, ctx.user.id);
  const t = String(b.time ?? '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw bad('invalid_time', "Vaqt HH:MM ko'rinishida bo'lsin.");
  try { db().prepare('INSERT INTO reminders(user_id, routine_id, time_hhmm) VALUES (?,?,?)').run(ctx.user.id, b.routine_id, t); } catch { throw bad('duplicate', 'Bu vaqt allaqachon qo\'shilgan.'); }
  return { ok: true };
});
route('DELETE', '/api/diary/reminders/:id', { auth: 'required', pro: 'routines' }, async (ctx) => { own('reminder', ctx.params.id, ctx.user.id); db().prepare('DELETE FROM reminders WHERE id = ?').run(ctx.params.id); return { ok: true }; });

route('GET', '/api/diary/day', { auth: 'required', pro: 'diary' }, async (ctx) => {
  const date = isoDateOnly(ctx.query.date) || today();
  const rs = db().prepare('SELECT id, name, period FROM care_routines WHERE user_id = ? ORDER BY id').all(ctx.user.id);
  const done = new Set(db().prepare('SELECT task_id FROM daily_progress WHERE user_id = ? AND date = ?').all(ctx.user.id, date).map((r) => r.task_id));
  const routines = rs.map((r) => ({ ...r, tasks: db().prepare('SELECT id, title FROM routine_tasks WHERE routine_id = ? ORDER BY sort, id').all(r.id).map((t) => ({ ...t, done: done.has(t.id) })) }));
  const total = routines.reduce((s, r) => s + r.tasks.length, 0), d = routines.reduce((s, r) => s + r.tasks.filter((t) => t.done).length, 0);
  const answers = Object.fromEntries(db().prepare('SELECT question_id, answer FROM diary_answers WHERE user_id = ? AND date = ?').all(ctx.user.id, date).map((a) => [a.question_id, a.answer]));
  return { date, routines, total, done: d, answers, questions: db().prepare('SELECT id, text, kind FROM diary_questions WHERE active = 1 ORDER BY sort, id').all() };
});
route('POST', '/api/diary/progress', { auth: 'required', pro: 'diary' }, async (ctx) => {
  const b = await ctx.json();
  const date = isoDateOnly(b.date) || today();
  if (date > today() || date < addDays(today(), -60)) throw bad('invalid_date', "Sana noto'g'ri: kelajak yoki 60 kundan eski sanani belgilab bo'lmaydi.");
  own('task', b.task_id, ctx.user.id);
  if (b.done === false) db().prepare('DELETE FROM daily_progress WHERE user_id = ? AND task_id = ? AND date = ?').run(ctx.user.id, b.task_id, date);
  else db().prepare('INSERT OR IGNORE INTO daily_progress(user_id, task_id, date) VALUES (?,?,?)').run(ctx.user.id, b.task_id, date);
  return { ok: true };
});
route('POST', '/api/diary/answers', { auth: 'required', pro: 'diary' }, async (ctx) => {
  const b = await ctx.json();
  const date = isoDateOnly(b.date) || today();
  if (date > today()) throw bad('invalid_date', "Kelajak sanasi bo'lmaydi.");
  const qs = new Map(db().prepare('SELECT id, kind FROM diary_questions WHERE active = 1').all().map((q) => [q.id, q.kind]));
  tx((d) => {
    for (const [qid, v] of Object.entries(b.answers || {})) {
      const kind = qs.get(Number(qid)); if (!kind) continue;
      let a = String(v ?? '');
      if (kind === 'scale') { const n = parseInt(a, 10); if (!(n >= 1 && n <= 5)) continue; a = String(n); }
      else if (kind === 'yesno') { if (!['yes', 'no'].includes(a)) continue; }
      else a = clampStr(a, 300);
      d.prepare('INSERT INTO diary_answers(user_id, date, question_id, answer) VALUES (?,?,?,?) ON CONFLICT(user_id, date, question_id) DO UPDATE SET answer = excluded.answer').run(ctx.user.id, date, Number(qid), a);
    }
  });
  return { ok: true };
});
route('GET', '/api/diary/stats', { auth: 'required', pro: 'diary' }, async (ctx) => {
  const range = ['day', 'week', 'month'].includes(ctx.query.range) ? ctx.query.range : 'week';
  const n = { day: 1, week: 7, month: 30 }[range];
  const end = today(), start = addDays(end, -(n - 1));
  const totalTasks = db().prepare('SELECT COUNT(*) n FROM routine_tasks t JOIN care_routines r ON r.id = t.routine_id WHERE r.user_id = ?').get(ctx.user.id).n;
  const rows = db().prepare('SELECT date, COUNT(*) c FROM daily_progress WHERE user_id = ? AND date >= ? AND date <= ? GROUP BY date').all(ctx.user.id, start, end);
  const byDate = new Map(rows.map((r) => [r.date, r.c]));
  const days = [];
  for (let i = 0; i < n; i++) { const d = addDays(start, i); days.push({ date: d, done: Math.min(byDate.get(d) || 0, totalTasks), total: totalTasks }); }
  const done = days.reduce((s, d) => s + d.done, 0), total = totalTasks * n;
  const perRoutine = db().prepare(`SELECT r.id, r.name, (SELECT COUNT(*) FROM routine_tasks WHERE routine_id = r.id) AS tasks,
    (SELECT COUNT(*) FROM daily_progress p JOIN routine_tasks t ON t.id = p.task_id WHERE t.routine_id = r.id AND p.date >= ? AND p.date <= ?) AS done FROM care_routines r WHERE r.user_id = ?`).all(start, end, ctx.user.id)
    .map((r) => ({ ...r, total: r.tasks * n, percent: r.tasks ? Math.round((r.done / (r.tasks * n)) * 100) : null }));
  return { range, start, end, days, summary: { done, total, remaining: Math.max(0, total - done), percent: total ? Math.round((done / total) * 100) : null }, perRoutine,
    note: "Bu ko'rsatkich faqat sizning belgilagan vazifalaringiz asosidagi bajarilish statistikasi; tibbiy o'lchov emas." };
});

// ---------- Mening javonim ----------
function shelfOut(r) {
  const info = expiryInfo(r.expiry_date, r.pao_months);
  let pao_due = null;
  if (r.opened_date && r.pao_months) { const d = new Date(r.opened_date + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + r.pao_months); pao_due = d.toISOString().slice(0, 10); }
  return { ...r, expiry: info, pao_due, pao_due_note: pao_due ? 'PAO belgisiga ko\'ra ochilgandan keyingi tavsiya etilgan muddat (kalendar yaroqlilik sanasi emas).' : null };
}
function shelfBody(b) {
  const name = clampStr(b.name, 120);
  if (name.length < 2) throw bad('invalid_name', "Mahsulot nomi kamida 2 belgi bo'lsin.");
  const dates = {};
  for (const k of ['purchase_date', 'opened_date', 'expiry_date']) {
    if (b[k] == null || b[k] === '') dates[k] = null;
    else { dates[k] = isoDateOnly(b[k]); if (!dates[k]) throw bad('invalid_date', `${k} sanasi YYYY-MM-DD ko'rinishida bo'lsin.`); }   // sana taxmin qilinmaydi
  }
  const pao = b.pao_months == null || b.pao_months === '' ? null : parseInt(b.pao_months, 10);
  if (pao != null && !(pao >= 1 && pao <= 60)) throw bad('invalid_pao', "PAO oylari 1 dan 60 gacha bo'lsin.");
  const rd = parseInt(b.reminder_days, 10);
  return { name, brand: clampStr(b.brand, 80) || null, ingredients_text: clampStr(b.ingredients_text, 4000) || null, ...dates, pao_months: pao, reminder_days: Number.isFinite(rd) && rd >= 0 && rd <= 365 ? rd : 30, notes: clampStr(b.notes, 500) || null };
}
route('GET', '/api/shelf', { auth: 'required', pro: 'shelf' }, async (ctx) => {
  const q = clampStr(ctx.query.q, 60).toLowerCase();
  let rows = db().prepare('SELECT * FROM shelf_items WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(ctx.user.id);
  if (q) rows = rows.filter((r) => `${r.name} ${r.brand ?? ''}`.toLowerCase().includes(q));
  return { items: rows.map(shelfOut) };
});
route('POST', '/api/shelf', { auth: 'required', pro: 'shelf' }, async (ctx) => {
  const v = shelfBody(await ctx.json());
  if (db().prepare('SELECT COUNT(*) n FROM shelf_items WHERE user_id = ?').get(ctx.user.id).n >= 300) throw bad('limit', "Javonda ko'pi bilan 300 ta mahsulot.");
  const id = Number(db().prepare('INSERT INTO shelf_items(user_id, name, brand, ingredients_text, purchase_date, opened_date, expiry_date, pao_months, reminder_days, notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(ctx.user.id, v.name, v.brand, v.ingredients_text, v.purchase_date, v.opened_date, v.expiry_date, v.pao_months, v.reminder_days, v.notes).lastInsertRowid);
  return { ok: true, id };
});
route('PUT', '/api/shelf/:id', { auth: 'required', pro: 'shelf' }, async (ctx) => {
  own('shelf', ctx.params.id, ctx.user.id);
  const v = shelfBody(await ctx.json());
  db().prepare('UPDATE shelf_items SET name=?, brand=?, ingredients_text=?, purchase_date=?, opened_date=?, expiry_date=?, pao_months=?, reminder_days=?, notes=? WHERE id=?')
    .run(v.name, v.brand, v.ingredients_text, v.purchase_date, v.opened_date, v.expiry_date, v.pao_months, v.reminder_days, v.notes, ctx.params.id);
  return { ok: true };
});
route('DELETE', '/api/shelf/:id', { auth: 'required', pro: 'shelf' }, async (ctx) => { own('shelf', ctx.params.id, ctx.user.id); db().prepare('DELETE FROM shelf_items WHERE id = ?').run(ctx.params.id); return { ok: true }; });
route('GET', '/api/shelf/expiring', { auth: 'required', pro: 'shelf' }, async (ctx) => {
  const rows = db().prepare('SELECT * FROM shelf_items WHERE user_id = ? AND expiry_date IS NOT NULL').all(ctx.user.id).map(shelfOut);
  return { items: rows.filter((r) => r.expiry.days_left <= r.reminder_days).sort((a, b) => a.expiry.days_left - b.expiry.days_left) };
});

// ---------- Taqqoslash (2-3 mahsulot) ----------
route('POST', '/api/compare', { auth: 'required', pro: 'compare' }, async (ctx) => {
  const ids = [...new Set((await ctx.json()).ids || [])].map(String);
  if (ids.length < 2 || ids.length > 3) throw bad('invalid_count', '2 yoki 3 ta saqlangan tahlilni tanlang.');
  const rows = ids.map((id) => {
    const r = db().prepare('SELECT a.*, p.price_uzs, p.price_source FROM analyses a LEFT JOIN products p ON p.id = a.product_id WHERE a.id = ? AND a.user_id = ?').get(id, ctx.user.id);
    if (!r) throw new HttpError(404, 'not_found', 'Tahlil topilmadi.');
    return r;
  });
  const products = rows.map((r) => {
    const res = shapeForPlan(safeJson(r.result_json), 'pro');
    const c = res.counts;
    return { id: r.id, name: r.product_name || 'Nomsiz mahsulot', brand: r.brand, counts: c, completeness: c.total ? Math.round((c.confirmed / c.total) * 100) : null,
      ingredients: res.ingredients.map((i) => ({ id: i.id, inci: i.inci, uz_name: i.uz_name, function_uz: i.function_uz, status: i.evidence.status })),
      dimensions: Object.fromEntries(Object.entries(res.dimensions).map(([k, v]) => [k, { status: v.status, percent: v.percent, confidence: v.confidence }])),
      price_uzs: r.price_uzs ?? null, price_source: r.price_source ?? null };
  });
  const sets = products.map((p) => new Set(p.ingredients.map((i) => i.id)));
  const shared = [...sets[0]].filter((id) => sets.every((s) => s.has(id)));
  const nameOf = new Map(products.flatMap((p) => p.ingredients.map((i) => [i.id, i])));
  return {
    products, shared: shared.map((id) => nameOf.get(id)),
    different: products.map((p, i) => ({ product: p.name, only: p.ingredients.filter((ing) => !sets.some((s, j) => j !== i && s.has(ing.id))) })),
    note: "Taqqoslash ingredientlar to'plamini ko'rsatadi. Ko'proq ingredient yoki yuqoriroq foiz mahsulotning yaxshiroq ekanini bildirmaydi; ma'lumot to'liqligi har xil bo'lishi mumkin.",
  };
});

// ---------- Obuna ----------
route('GET', '/api/subscription', { auth: 'required' }, async (ctx) => {
  const sub = activeSubscription(ctx.user.id);
  const c = cfg(), pay = providerStatus();
  return {
    plan: ctx.plan, usage: usageStatus(ctx.user),
    subscription: sub ? { source: sub.source, status: sub.status, period_end: sub.period_end, auto_renew: sub.auto_renew === 1, simulated: sub.source !== 'production' } : null,
    pricing: { price_uzs: priceUzs(), approved: priceUzs() != null, note: priceUzs() == null ? "Narxlar loyiha egasi tomonidan hali tasdiqlanmagan." : null },
    payments: { state: pay.state }, demo_available: c.demoMode,
  };
});
route('POST', '/api/subscription/checkout', { auth: 'required', limit: { name: 'checkout', max: 10, windowMs: 3600000 } }, async (ctx) => {
  const r = createSandboxCheckout(ctx.user);
  if (!r.ok) throw new HttpError(503, 'payments_unavailable', "To'lov tizimi hali ulanmagan. Haqiqiy to'lov qabul qilinmaydi.", { state: providerStatus().state });
  return { ok: true, txn: r.txn, simulated: true, note: "SINOV REJIMI: bu soxta to'lov bo'lib, haqiqiy pul yechilmaydi." };
});
route('POST', '/api/subscription/sandbox/simulate', { auth: 'required' }, async (ctx) => {
  // Faqat sandbox: server o'zi imzolangan webhook hosil qiladi (mijoz "muvaffaqiyat" ekranidan Pro olmaydi).
  const b = await ctx.json();
  const pay = db().prepare("SELECT * FROM payments WHERE provider = 'sandbox' AND provider_txn_id = ? AND user_id = ?").get(String(b.txn), ctx.user.id);
  if (!pay) throw new HttpError(404, 'not_found', 'Topilmadi.');
  const raw = Buffer.from(JSON.stringify({ event_id: 'sim_' + pay.provider_txn_id + '_' + (b.status || 'paid'), txn: pay.provider_txn_id, status: ['paid', 'failed'].includes(b.status) ? b.status : 'paid', ts: Date.now() }));
  const r = handleSandboxWebhook(raw, sign(raw));
  if (r.status !== 200) throw new HttpError(r.status, r.error || 'webhook_failed', 'Simulyatsiya bajarilmadi.');
  return { ok: true, simulated: true };
});
route('POST', '/api/webhooks/sandbox', { noCsrf: true }, async (ctx) => {
  const raw = await ctx.raw(64 * 1024);
  const r = handleSandboxWebhook(raw, ctx.req.headers['x-signature']);
  if (r.status !== 200) throw new HttpError(r.status, r.error || 'webhook_failed', 'Webhook rad etildi.');
  return { ok: true, duplicate: !!r.duplicate };
});
route('POST', '/api/subscription/cancel', { auth: 'required' }, async (ctx) => {
  const sub = activeSubscription(ctx.user.id);
  if (!sub) throw bad('no_subscription', 'Faol obuna yo\'q.');
  db().prepare("UPDATE subscriptions SET auto_renew = 0, status = 'canceled' WHERE id = ?").run(sub.id);
  audit(ctx.user.id, 'subscription_canceled', sub.id);
  return { ok: true, period_end: sub.period_end, message: "Avtomatik yangilanish o'chirildi. Pro muddat tugaguncha amal qiladi." };
});
// Investor demo: FAQAT DEMO_MODE=1 da. Ishlab chiqarish Pro huquqini bermaydi (entitlements demo manbani rejim o'chiq bo'lsa e'tiborsiz qoldiradi).
route('POST', '/api/demo/activate-pro', { auth: 'required' }, async (ctx) => {
  if (!cfg().demoMode || cfg().isProd) throw new HttpError(404, 'not_found', 'Topilmadi.');
  const now = new Date();
  db().prepare("INSERT INTO subscriptions(user_id, plan, status, source, period_start, period_end, auto_renew, provider) VALUES (?, 'pro', 'active', 'demo', ?, ?, 0, 'demo')").run(ctx.user.id, now.toISOString(), new Date(now.getTime() + 7 * 86400000).toISOString());
  return { ok: true, demo: true, note: 'DEMO Pro (7 kun). Bu ishlab chiqarish obunasi emas.' };
});
route('POST', '/api/demo/deactivate-pro', { auth: 'required' }, async (ctx) => {
  if (!cfg().demoMode) throw new HttpError(404, 'not_found', 'Topilmadi.');
  db().prepare("DELETE FROM subscriptions WHERE user_id = ? AND source = 'demo'").run(ctx.user.id);
  return { ok: true };
});

route('GET', '/api/notifications', { auth: 'required' }, async (ctx) => ({ items: db().prepare('SELECT id, kind, body, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(ctx.user.id) }));
route('POST', '/api/notifications/read', { auth: 'required' }, async (ctx) => { db().prepare("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND read_at IS NULL").run(ctx.user.id); return { ok: true }; });

route('GET', '/api/referral', { auth: 'required' }, async (ctx) => {
  const n = db().prepare('SELECT COUNT(*) n FROM referral_tracking WHERE referrer_id = ?').get(ctx.user.id).n;
  return { ref_code: ctx.user.ref_code, link: `${cfg().publicUrl}/?ref=${ctx.user.ref_code}`, invited: n, reward_enabled: cfg().referralRewardEnabled, reward_note: cfg().referralRewardEnabled ? null : "Referral mukofoti hozircha faol emas (loyiha egasi tasdiqlashi kutilmoqda)." };
});

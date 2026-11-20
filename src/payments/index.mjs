// To'lov provayder adapterlari. Payme/Click/Uzum HOZIRCHA AMALGA OSHIRILMAGAN (hisob ma'lumotlari va
// provayder protokoli bo'yicha tasdiq kerak) — ular haqiqiy to'lov qabul qildi deb ko'rsatilmaydi.
// 'sandbox' — faqat sinov uchun SOXTA to'lov (simulated=1), haqiqiy moliyaviy hisobotlarga kirmaydi.
import crypto from 'node:crypto';
import { cfg } from '../config.mjs';
import { db, tx } from '../db.mjs';
import { audit } from '../audit.mjs';
import { uid } from '../util.mjs';

export function providerStatus() {
  const c = cfg();
  const e = process.env;
  const real = {
    payme: !!(e.PAYME_MERCHANT_ID && e.PAYME_KEY),
    click: !!(e.CLICK_SERVICE_ID && e.CLICK_MERCHANT_ID && e.CLICK_SECRET_KEY),
    uzum: !!(e.UZUM_MERCHANT_ID && e.UZUM_SECRET_KEY),
  };
  return {
    active: c.paymentProvider,
    state: c.paymentProvider === 'sandbox' && !c.isProd ? 'sandbox' : c.paymentProvider === 'none' ? 'not_configured' : 'adapter_not_implemented',
    providers: {
      payme: { credentials_present: real.payme, adapter: 'not_implemented' },
      click: { credentials_present: real.click, adapter: 'not_implemented' },
      uzum: { credentials_present: real.uzum, adapter: 'not_implemented' },
      sandbox: { adapter: 'dev_test_only' },
    },
  };
}

export function sign(rawBody) {
  return crypto.createHmac('sha256', cfg().paymentSandboxSecret).update(rawBody).digest('hex');
}
export function verifySignature(rawBody, sig) {
  const secret = cfg().paymentSandboxSecret;
  if (!secret || secret === 'change-me') return false;   // standart/bo'sh sir bilan imzo qabul qilinmaydi
  const want = Buffer.from(sign(rawBody), 'hex');
  let got; try { got = Buffer.from(String(sig || ''), 'hex'); } catch { return false; }
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function priceUzs() {
  const r = db().prepare("SELECT value FROM settings WHERE key = 'price_pro_month_uzs'").get();
  const n = r ? parseInt(r.value, 10) : NaN;
  return Number.isFinite(n) ? n : null;     // narx tasdiqlanmaguncha null
}

export function createSandboxCheckout(user) {
  const c = cfg();
  if (c.paymentProvider !== 'sandbox' || c.isProd) return { ok: false, error: 'payments_unavailable' };
  const txn = 'sbx_' + uid();
  db().prepare("INSERT INTO payments(user_id, provider, provider_txn_id, amount_uzs, status, simulated) VALUES (?, 'sandbox', ?, ?, 'pending', 1)").run(user.id, txn, priceUzs() ?? 0);
  return { ok: true, txn, simulated: true };
}

// Webhook: imzo + vaqt oynasi (replay) + event_id idempotentligi
export function handleSandboxWebhook(rawBody, sig) {
  if (cfg().paymentProvider !== 'sandbox' || cfg().isProd) return { status: 404, error: 'not_found' };
  if (!verifySignature(rawBody, sig)) return { status: 401, error: 'bad_signature' };
  let ev; try { ev = JSON.parse(rawBody.toString('utf8')); } catch { return { status: 400, error: 'bad_json' }; }
  if (!ev.event_id || !ev.txn || !['paid', 'failed', 'refunded'].includes(ev.status)) return { status: 400, error: 'bad_payload' };
  if (!Number.isFinite(ev.ts) || Math.abs(Date.now() - ev.ts) > 5 * 60 * 1000) return { status: 400, error: 'stale_event' };
  return tx((d) => {
    try { d.prepare("INSERT INTO webhook_events(provider, event_id) VALUES ('sandbox', ?)").run(String(ev.event_id)); }
    catch { return { status: 200, duplicate: true }; }          // takroriy hodisa: hech narsa o'zgarmaydi
    const pay = d.prepare("SELECT * FROM payments WHERE provider = 'sandbox' AND provider_txn_id = ?").get(String(ev.txn));
    if (!pay) return { status: 404, error: 'unknown_txn' };
    const transitions = { pending: ['paid', 'failed'], paid: ['refunded'], failed: [], refunded: [] };
    if (!transitions[pay.status].includes(ev.status)) return { status: 409, error: 'invalid_transition' };
    d.prepare('UPDATE payments SET status = ? WHERE id = ?').run(ev.status, pay.id);
    const now = new Date();
    if (ev.status === 'paid') {
      const end = new Date(now.getTime() + 30 * 86400000).toISOString();
      d.prepare("INSERT INTO subscriptions(user_id, plan, status, source, period_start, period_end, auto_renew, provider) VALUES (?, 'pro', 'active', 'sandbox', ?, ?, 0, 'sandbox')").run(pay.user_id, now.toISOString(), end);
      d.prepare('INSERT INTO events(user_id, type, amount_uzs, simulated) VALUES (?, ?, ?, 1)').run(pay.user_id, 'purchase', pay.amount_uzs);
    }
    if (ev.status === 'refunded') d.prepare("UPDATE subscriptions SET status = 'refunded' WHERE user_id = ? AND source = 'sandbox' AND status IN ('active','canceled')").run(pay.user_id);
    audit(null, 'payment_webhook', pay.provider_txn_id, { status: ev.status, simulated: true });
    return { status: 200, ok: true };
  });
}

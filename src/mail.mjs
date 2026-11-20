// Email adapteri. 'console' FAQAT development uchun. Production: 'brevo' yoki 'resend' (HTTP API).
import { cfg } from './config.mjs';
import { sysEvent } from './audit.mjs';

export const outbox = [];
let fetchImpl = (...a) => fetch(...a);
export function setMailFetch(fn) { fetchImpl = fn || ((...a) => fetch(...a)); }   // faqat testlar uchun

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function htmlBody(text, link) {
  const body = esc(text).replace(/\n/g, '<br>');
  const btn = link ? `<p><a href="${esc(link)}" style="background:#EBCB98;color:#0b1f17;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Davom etish</a></p><p style="font-size:12px;color:#666">Tugma ishlamasa, havolani brauzerga nusxalang:<br>${esc(link)}</p>` : '';
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222"><p>${body}</p>${btn}</div>`;
}

export async function sendMail({ to, subject, text, link }) {
  const c = cfg();
  const fullText = link && !String(text).includes(link) ? `${text}\n\n${link}` : text;
  if (c.mailProvider === 'console') {
    if (c.isProd) { sysEvent('error', 'mail', 'MAIL_PROVIDER=console productionda ishlamaydi'); return { ok: false, error: 'mail_unavailable' }; }
    outbox.push({ to, subject, text, link, at: Date.now() });
    if (outbox.length > 200) outbox.shift();
    if (process.env.SAYDAN_QUIET !== '1') console.log(`[mail:DEV-ONLY] -> ${to}: ${subject}${link ? ' ' + link : ''}`);
    return { ok: true, dev: true };
  }
  if (!c.mailFrom) { sysEvent('error', 'mail', 'MAIL_FROM sozlanmagan'); return { ok: false, error: 'mail_not_configured' }; }
  try {
    let res;
    if (c.mailProvider === 'brevo') {
      if (!c.brevoApiKey) { sysEvent('error', 'mail', 'BREVO_API_KEY yo\'q'); return { ok: false, error: 'mail_not_configured' }; }
      res = await fetchImpl('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': c.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { name: c.mailFromName, email: c.mailFrom }, to: [{ email: to }], subject, textContent: fullText, htmlContent: htmlBody(text, link) }), signal: AbortSignal.timeout(10000) });
    } else if (c.mailProvider === 'resend') {
      if (!c.resendApiKey) { sysEvent('error', 'mail', 'RESEND_API_KEY yo\'q'); return { ok: false, error: 'mail_not_configured' }; }
      res = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${c.resendApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: `${c.mailFromName} <${c.mailFrom}>`, to: [to], subject, text: fullText, html: htmlBody(text, link) }), signal: AbortSignal.timeout(10000) });
    } else { sysEvent('error', 'mail', `Noma'lum MAIL_PROVIDER=${c.mailProvider}`); return { ok: false, error: 'mail_provider_not_implemented' }; }
    if (!res.ok) { let d = ''; try { d = (await res.text()).slice(0, 200); } catch { /* */ } sysEvent('error', 'mail', `${c.mailProvider} HTTP ${res.status}: ${d}`); return { ok: false, error: 'mail_send_failed' }; }
    return { ok: true };
  } catch (e) { sysEvent('error', 'mail', `${c.mailProvider}: ${String(e.message).slice(0, 150)}`); return { ok: false, error: 'mail_send_failed' }; }
}
export function mailStatus() {
  const c = cfg();
  if (c.mailProvider === 'console') return c.isProd ? 'unavailable' : 'dev_only';
  if (c.mailProvider === 'brevo') return c.brevoApiKey && c.mailFrom ? 'configured' : 'not_configured';
  if (c.mailProvider === 'resend') return c.resendApiKey && c.mailFrom ? 'configured' : 'not_configured';
  return 'not_implemented';
}

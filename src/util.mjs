import crypto from 'node:crypto';

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function normalizeEmail(e) {
  return String(e ?? '').trim().toLowerCase();
}
export function isPlausibleEmail(e) {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

// INCI nomlarini taqqoslash uchun normallashtirish. Turli moddalarni birlashtirmaydi:
// faqat registr, diakritika, tinish belgilari va ortiqcha bo'shliqlar olib tashlanadi.
export function normInci(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яёЀ-ӿʻʼ'’‘`ʻʼ/\-\s.,()]/g, ' ')
    .replace(/['’‘`ʻʼ]/g, '')
    .replace(/[(),./\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// "Aqua (Water) / Eau" -> variantlar
export function inciVariants(raw) {
  const s = String(raw ?? '').trim();
  const out = new Set();
  const whole = normInci(s);
  if (whole) out.add(whole);
  const noParen = normInci(s.replace(/\(.*?\)/g, ' '));
  if (noParen) out.add(noParen);
  for (const m of s.matchAll(/\((.*?)\)/g)) { const v = normInci(m[1]); if (v) out.add(v); }
  for (const part of s.split(/\s*\/\s*/)) { const v = normInci(part.replace(/\(.*?\)/g, ' ')); if (v) out.add(v); }
  return [...out];
}

export function safeJson(s, fallback = null) {
  try { return JSON.parse(s); } catch { return fallback; }
}
export function clampStr(s, max) {
  return String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
export function isoDateOnly(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
export function levenshtein(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// Free/Pro huquqlari. Frontend emas — shu modul so'nggi qaror.
import { db } from './db.mjs';
import { cfg } from './config.mjs';

export function activeSubscription(userId) {
  const c = cfg();
  const rows = db().prepare(
    "SELECT * FROM subscriptions WHERE user_id = ? AND status IN ('active','canceled') AND period_end > ? ORDER BY period_end DESC"
  ).all(userId, new Date().toISOString());
  // demo/sandbox obunalar faqat tegishli rejim yoqilgan bo'lsa kuchga ega: ishlab chiqarish Pro'ga aylanmaydi.
  return rows.find((s) =>
    s.source === 'production' ||
    (s.source === 'demo' && c.demoMode) ||
    (s.source === 'sandbox' && c.paymentProvider === 'sandbox' && !c.isProd)
  ) || null;
}
export function planOf(user) {
  if (!user) return 'anon';
  return activeSubscription(user.id) ? 'pro' : 'free';
}

export const FEATURES = {
  ocr: ['free', 'pro'],
  basic_analysis: ['free', 'pro'],
  detailed_analysis: ['pro'],
  barcode: ['pro'],
  skin_profile: ['pro'],
  allergen_alerts: ['pro'],
  history_full: ['pro'],
  compare: ['pro'],
  conflicts: ['pro'],
  routines: ['pro'],
  shelf: ['pro'],
  diary: ['pro'],
  budget_alternatives: ['pro'],
  pdf_report: ['pro'],
};
export function hasFeature(user, feature) {
  const plan = planOf(user);
  return (FEATURES[feature] || []).includes(plan);
}

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
export function getSetting(key, fallback) {
  const r = db().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
export function monthlyLimit(plan) {
  const c = cfg();
  const key = plan === 'pro' ? 'pro_monthly_limit' : 'free_monthly_limit';
  const n = parseInt(getSetting(key, ''), 10);
  return Number.isFinite(n) ? n : plan === 'pro' ? c.proMonthlyLimit : c.freeMonthlyLimit;
}
export function usageThisMonth(userId) {
  return db().prepare('SELECT COUNT(*) AS n FROM analysis_usage WHERE user_id = ? AND at >= ?').get(userId, monthStart()).n;
}
export function usageStatus(user) {
  const plan = planOf(user);
  const limit = monthlyLimit(plan);
  const used = usageThisMonth(user.id);
  return { plan, limit, used, remaining: Math.max(0, limit - used) };
}

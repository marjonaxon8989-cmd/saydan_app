import { db } from './db.mjs';

const SENSITIVE = /pass|token|secret|key|cookie|session|card|authorization/i;
function scrub(v, depth = 0) {
  if (depth > 4 || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = SENSITIVE.test(k) ? '[yashirilgan]' : scrub(val, depth + 1);
    return o;
  }
  return typeof v === 'string' ? v.slice(0, 500) : v;
}
export function audit(actorId, action, target = null, detail = null) {
  db().prepare('INSERT INTO admin_audit_logs(actor_id, action, target, detail_json) VALUES (?,?,?,?)')
    .run(actorId ?? null, action, target == null ? null : String(target), detail ? JSON.stringify(scrub(detail)) : null);
}
export function sysEvent(level, kind, message) {
  // Xabarlarda parol/token/shaxsiy ma'lumot bo'lmasligi kerak — chaqiruvchi mas'ul; bu yerda qirqiladi.
  db().prepare('INSERT INTO system_events(level, kind, message) VALUES (?,?,?)').run(level, kind, String(message).slice(0, 300));
}

// Oddiy xotiradagi fixed-window limiter (bitta jarayon uchun). Ko'p serverli joylashtirishda umumiy saqlash (Redis) kerak.
const buckets = new Map();
export function hit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  if (buckets.size > 20000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  return { ok: b.count <= limit, retryAfter: Math.ceil((b.reset - now) / 1000), remaining: Math.max(0, limit - b.count) };
}
export function resetRateLimits() { buckets.clear(); }

// Sezgir maydonlar (teri profili) uchun AES-256-GCM. Kalit: PROFILE_ENCRYPTION_KEY (base64, 32 bayt).
// Development'da kalit data/.profile.key faylida avtomatik yaratiladi; productionda env shart.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.mjs';

function getKey() {
  const c = cfg();
  if (c.profileKey) {
    const k = Buffer.from(c.profileKey, 'base64');
    if (k.length === 32) return k;
    // Boshqa formatdagi (masalan hosting yaratgan tasodifiy) kalit: SHA-256 orqali 32 baytga keltiriladi.
    if (c.profileKey.length < 24) throw new Error('PROFILE_ENCRYPTION_KEY kamida 24 belgi bo\'lishi kerak');
    return crypto.createHash('sha256').update(c.profileKey).digest();
  }
  if (c.isProd) throw new Error('Productionda PROFILE_ENCRYPTION_KEY majburiy');
  const f = path.join(c.dataDir, '.profile.key');
  fs.mkdirSync(c.dataDir, { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(f, 'utf8'), 'base64');
}
export function encryptJson(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decryptJson(s) {
  const [iv, tag, enc] = String(s).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
}

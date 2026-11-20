import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { cfg } from './config.mjs';
import { db } from './db.mjs';
import { uid, nowIso, sha256 } from './util.mjs';

const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  return SIGNATURES.find((s) => s.test(buf)) || null;
}

let sharpMod; // ixtiyoriy: o'rnatilgan bo'lsa EXIF (GPS) ni olib tashlaydi, burib, siqadi
function loadSharp() {
  if (sharpMod !== undefined) return sharpMod;
  sharpMod = null;
  const tryRoots = [process.cwd()];
  try { tryRoots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000 }).trim()); } catch { /* yo'q */ }
  for (const r of tryRoots) {
    try { sharpMod = createRequire(path.join(r, 'x.js'))('sharp'); break; } catch { /* keyingisi */ }
  }
  return sharpMod;
}

export async function storeImage(userId, buf) {
  const c = cfg();
  const kind = sniffImage(buf);
  if (!kind) return { ok: false, error: 'unsupported_type' };
  if (buf.length > c.maxUploadBytes) return { ok: false, error: 'too_large' };
  let out = buf, mime = kind.mime, ext = kind.ext;
  const sharp = loadSharp();
  if (sharp) {
    try {
      out = await sharp(buf, { limitInputPixels: 60_000_000 }).rotate()
        .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 }).toBuffer();
      mime = 'image/jpeg'; ext = 'jpg';
    } catch { return { ok: false, error: 'corrupt_image' }; }
  }
  fs.mkdirSync(c.uploadDir, { recursive: true, mode: 0o700 });
  const id = uid();
  const fileName = `${crypto.randomBytes(16).toString('hex')}.${ext}`; // foydalanuvchi nomi hech qachon ishlatilmaydi
  fs.writeFileSync(path.join(c.uploadDir, fileName), out, { mode: 0o600 });
  const exp = new Date(Date.now() + c.uploadRetentionHours * 3600000).toISOString();
  db().prepare('INSERT INTO uploaded_images(id, user_id, file_name, mime, size, sha256, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, userId, fileName, mime, out.length, sha256(out), nowIso(), exp);
  return { ok: true, id, path: path.join(c.uploadDir, fileName), mime, size: out.length, expires_at: exp };
}

export function imagePathFor(userId, imageId) {
  const r = db().prepare('SELECT * FROM uploaded_images WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(imageId, userId);
  if (!r) return null;
  return { row: r, path: path.join(cfg().uploadDir, r.file_name) };
}

function removeFile(fileName) {
  try { fs.unlinkSync(path.join(cfg().uploadDir, fileName)); } catch { /* allaqachon yo'q */ }
}
export function deleteImage(imageId) {
  const r = db().prepare('SELECT file_name FROM uploaded_images WHERE id = ?').get(imageId);
  if (!r) return;
  removeFile(r.file_name);
  db().prepare('UPDATE uploaded_images SET deleted_at = ? WHERE id = ?').run(nowIso(), imageId);
}
// Saqlash siyosati: foydalanuvchi saqlashni tanlamagan rasmlar muddat tugagach o'chiriladi.
export function purgeExpired() {
  const rows = db().prepare('SELECT id FROM uploaded_images WHERE deleted_at IS NULL AND saved = 0 AND expires_at < ?').all(nowIso());
  rows.forEach((r) => deleteImage(r.id));
  return rows.length;
}
export function purgeUserImages(userId) {
  const rows = db().prepare('SELECT id FROM uploaded_images WHERE user_id = ? AND deleted_at IS NULL').all(userId);
  rows.forEach((r) => deleteImage(r.id));
  return rows.length;
}

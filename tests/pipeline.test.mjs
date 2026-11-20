import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { start, signup, makePro, Client, OWNER, userIdOf } from './helpers.mjs';

let S, tmp, adminC;
before(async () => { S = await start(); tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saydan-fx-')); });
after(() => S.close());

// SINTETIK fikstura: haqiqiy ingrident.xlsx emas; sarlavhalar taxminiy.
function fixture(file, rows) {
  const py = `
import sys, json, openpyxl
rows = json.loads(sys.argv[2])
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Ingredientlar'
ws.append(['No', 'INCI nomi', "O'zbekcha nomi", 'CAS raqami', 'Tavsif'])
for r in rows: ws.append(r)
wb.save(sys.argv[1])`;
  execFileSync('python3', ['-I', '-c', py, file, JSON.stringify(rows)]);
}

test('import: qoralama holat, idempotent, xato hisobot (kutilgan 329 ga mos emas → complete=false)', async () => {
  const { importXlsxFile } = await import('../src/importer.mjs');
  const { db } = await import('../src/db.mjs');
  const f = path.join(tmp, 'a.xlsx');
  fixture(f, [[1, 'Sinov Aqua', 'suv', '7732-18-5', 'T1'], [2, 'Sinov Glycerin', 'glitserin', '56-81-5', 'T2'], [3, 'Sinov Aqua', 'takror', '', 'dup']]);
  const rep = importXlsxFile(f, { actor: null, fileName: 'a.xlsx' });
  assert.equal(rep.complete, false);
  assert.equal(rep.sheets.Ingredientlar.imported_new, 2);
  assert.ok(rep.sheets.Ingredientlar.errors.some((e) => /takroriy/.test(e.reason)));
  const rows = db().prepare("SELECT status, pharmacist_approved FROM ingredients WHERE inci LIKE 'Sinov %'").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.status === 'draft' && !r.pharmacist_approved));
  const again = importXlsxFile(f, { actor: null, fileName: 'a.xlsx' });
  assert.equal(again.sheets.Ingredientlar.imported_new, 0);
  assert.equal(db().prepare("SELECT COUNT(*) n FROM ingredients WHERE inci LIKE 'Sinov %'").get().n, 2);
});

test('import: admin tahrir qilgan yozuv qayta importda ustidan yozilmaydi', async () => {
  const { importXlsxFile } = await import('../src/importer.mjs');
  const { db } = await import('../src/db.mjs');
  const iid = db().prepare("SELECT id FROM ingredients WHERE inci = 'Sinov Aqua'").get().id;
  db().prepare("UPDATE ingredients SET description_uz = 'ADMIN TAHRIRI' WHERE id = ?").run(iid);
  db().prepare("INSERT INTO ingredient_history(ingredient_id, change_type, after_json) VALUES (?, 'edit', '{}')").run(iid);
  const f = path.join(tmp, 'a.xlsx');
  importXlsxFile(f, { actor: null, fileName: 'a.xlsx' });
  assert.equal(db().prepare("SELECT description_uz d FROM ingredients WHERE inci = 'Sinov Aqua'").get().d, 'ADMIN TAHRIRI');
});

test('import: xlsx bo\'lmagan fayl admin API\'da rad etiladi, oddiy foydalanuvchi kira olmaydi', async () => {
  const admin = adminC = await signup(S.base, OWNER);
  const bad = await admin.req('POST', '/api/admin/import', undefined, { raw: Buffer.alloc(200, 65), headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(bad.status, 400);
  const u = await signup(S.base, 'plain2@example.test');
  assert.equal((await u.get('/api/admin/dashboard')).status, 403);
  assert.equal((await u.get('/api/admin/users')).status, 403);
  assert.equal((await new Client(S.base).get('/api/admin/dashboard')).status, 401);
});

test('admin: ingredient qo\'lda yaratish qoralama; tasdiqlash uchun manba URL shart; demo tasdiqlanmaydi', async () => {
  const c = adminC;
  assert.ok(c, 'admin mijoz mavjud');
  const cr = await c.post('/api/admin/ingredients', { inci: 'Test Squalane X' });
  assert.equal(cr.status, 200);
  const as = await c.put(`/api/admin/ingredients/${cr.json.id}/assessments`, { dimension: 'dry', stance: 'favorable', evidence_level: 'high', approved: true });
  assert.equal(as.status, 400); assert.equal(as.json.error, 'source_required');
  const ok = await c.put(`/api/admin/ingredients/${cr.json.id}/assessments`, { dimension: 'dry', stance: 'favorable', evidence_level: 'high', approved: true, source_ref: 'https://example.test/s' });
  assert.equal(ok.status, 200);
  const h = await c.get(`/api/admin/ingredients/${cr.json.id}/history`);
  assert.ok(h.json.items.length >= 2);
});

test('OCR: haqiqiy tesseract bilan yorliq rasmidan ingredientlar o\'qiladi', async (t) => {
  try { execFileSync('tesseract', ['--version'], { stdio: 'ignore' }); } catch { t.skip('tesseract yo\'q'); return; }
  const img = path.join(tmp, 'label.png');
  execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image, ImageDraw, ImageFont
im = Image.new('RGB', (1400, 360), 'white'); d = ImageDraw.Draw(im)
try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 44)
except Exception: f = ImageFont.load_default()
d.text((30, 40), 'INGREDIENTS: Aqua, Glycerin, Niacinamide,', fill='black', font=f)
d.text((30, 120), 'Squalane, Panthenol.', fill='black', font=f)
d.text((30, 220), 'Made in Uzbekistan', fill='black', font=f)
im.save(sys.argv[1])`, img]);
  const c = await signup(S.base, 'ocr1@example.test');
  const r = await c.req('POST', '/api/ocr', undefined, { raw: fs.readFileSync(img), headers: { 'content-type': 'image/png' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const raws = r.json.items.map((x) => x.raw.toLowerCase());
  for (const n of ['aqua', 'glycerin', 'niacinamide']) assert.ok(raws.some((x) => x.includes(n)), n + ' topilmadi: ' + raws.join('|'));
  assert.ok(!raws.some((x) => /uzbekistan/.test(x)));
  // rasmni boshqa foydalanuvchi ko'ra olmaydi
  const o = await signup(S.base, 'ocr2@example.test');
  assert.equal((await o.get('/api/images/' + r.json.imageId)).status, 404);
});

test('OCR: matnsiz rasm — aniq xato holati, soxta natija emas', async (t) => {
  try { execFileSync('tesseract', ['--version'], { stdio: 'ignore' }); } catch { t.skip('tesseract yo\'q'); return; }
  const img = path.join(tmp, 'blank.png');
  execFileSync('python3', ['-I', '-c', "import sys\nfrom PIL import Image\nImage.new('RGB',(400,200),'white').save(sys.argv[1])", img]);
  const c = await signup(S.base, 'ocr3@example.test');
  const r = await c.req('POST', '/api/ocr', undefined, { raw: fs.readFileSync(img), headers: { 'content-type': 'image/png' } });
  assert.ok([422, 503].includes(r.status)); assert.ok(!r.json.items);
});

test('retention: muddati o\'tgan saqlanmagan rasm o\'chiriladi, saqlanganlari qoladi', async () => {
  const { db } = await import('../src/db.mjs');
  const up = await import('../src/uploads.mjs');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const uid = await userIdOf('ocr3@example.test');
  const a = await up.storeImage(uid, png), b = await up.storeImage(uid, png);
  assert.ok(a.ok && b.ok);
  db().prepare("UPDATE uploaded_images SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id IN (?, ?)").run(a.id, b.id);
  db().prepare('UPDATE uploaded_images SET saved = 1 WHERE id = ?').run(b.id);
  up.purgeExpired();
  assert.ok(db().prepare('SELECT deleted_at FROM uploaded_images WHERE id = ?').get(a.id).deleted_at);
  assert.equal(fs.existsSync(a.path), false);
  assert.equal(db().prepare('SELECT deleted_at FROM uploaded_images WHERE id = ?').get(b.id).deleted_at, null);
  assert.equal(fs.existsSync(b.path), true);
});

test('upload: magic-byte tekshiruvi (nomi png, mazmuni emas)', async () => {
  const up = await import('../src/uploads.mjs');
  assert.equal(up.sniffImage(Buffer.from('GIF89a....')), null);
  assert.equal(up.sniffImage(Buffer.from('<svg onload=alert(1)>')), null);
});

test('to\'ldirgich "Manba topilmadi" ma\'lumot hisoblanmaydi', async () => {
  const { addIngredient } = await import('./helpers.mjs');
  const { analyzeItems } = await import('../src/analysis/engine.mjs');
  const { db } = await import('../src/db.mjs');
  const id = await addIngredient({ inci: 'Placeholder Test Ing' });
  db().prepare("UPDATE ingredients SET oily_info = ?, dry_info = ? WHERE id = ?").run("Manba topilmadi — farmatsevt to'ldiradi", 'Haqiqiy matn', id);
  const r = analyzeItems(['Placeholder Test Ing']);
  assert.equal(r.dimensions.oily.status === 'insufficient', true);
  assert.notEqual(r.dimensions.dry.status, 'insufficient');
});

test('haqiqiy ingrident.xlsx (agar mavjud bo\'lsa): 329/83/7/200/5 va hammasi qoralama', async (t) => {
  const f = process.env.REAL_XLSX;
  if (!f || !fs.existsSync(f)) { t.skip('REAL_XLSX berilmagan'); return; }
  const { importXlsxFile } = await import('../src/importer.mjs');
  const { db } = await import('../src/db.mjs');
  const rep = importXlsxFile(f, { actor: null, fileName: 'real.xlsx' });
  assert.equal(rep.complete, true);
  assert.equal(db().prepare("SELECT COUNT(*) n FROM ingredients WHERE status != 'draft' AND is_demo = 0 AND inci NOT LIKE 'Sinov%' AND inci NOT LIKE 'Test%' AND inci NOT LIKE 'Placeholder%'").get().n, 0);
  for (const sh of Object.values(rep.sheets)) assert.deepEqual(sh.errors, []);
});

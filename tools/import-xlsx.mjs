// Ishlatish: npm run import -- <ingrident.xlsx> [--map mapping.json] [--report report.json]
import fs from 'node:fs';
import { loadDotEnv } from '../src/config.mjs';
loadDotEnv();
import { initDb } from '../src/db.mjs';
import { importXlsxFile } from '../src/importer.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
if (!file) { console.error('Ishlatish: npm run import -- <ingrident.xlsx> [--map mapping.json] [--report report.json]'); process.exit(2); }
if (!fs.existsSync(file)) { console.error(`XATO: fayl topilmadi: ${file}\nAsl ingrident.xlsx fayli kerak — uning o'rniga hech narsa yaratilmaydi.`); process.exit(2); }
initDb();
const map = opt('--map') ? JSON.parse(fs.readFileSync(opt('--map'), 'utf8')) : {};
const rep = importXlsxFile(file, { mappingOverride: map, actor: 'cli' });
for (const [name, s] of Object.entries(rep.sheets)) {
  console.log(`\n== ${name}: kutilgan=${s.expected} manba qatorlar=${s.source_rows} yangi=${s.imported_new} yangilangan=${s.updated} xatolar=${s.errors.length}`);
  console.log('   moslashgan ustunlar:', JSON.stringify(s.header_mapping));
  if (s.unmapped_headers?.length) console.log('   moslanmagan sarlavhalar (asl qatorda saqlangan):', s.unmapped_headers.join(' | '));
  s.errors.slice(0, 20).forEach((e) => console.log(`   XATO [${e.sheet} qator ${e.row}]: ${e.reason}`));
}
console.log('\nTekshiruv:', JSON.stringify(rep.validation, null, 2));
console.log('\n' + rep.note);
const out = opt('--report'); if (out) fs.writeFileSync(out, JSON.stringify(rep, null, 2));
process.exit(rep.complete ? 0 : 1);

// Konteyner ishga tushirish: migratsiya, ingredient bazasi bo'sh bo'lsa seed importi, keyin server.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDb, db } from '../src/db.mjs';
import { cfg } from '../src/config.mjs';

const c = cfg();
fs.mkdirSync(c.dataDir, { recursive: true });
initDb();
const n = db().prepare('SELECT COUNT(*) n FROM ingredients WHERE is_demo = 0').get().n;
const seed = fileURLToPath(new URL('../seed/ingrident.xlsx', import.meta.url));
if (n === 0 && fs.existsSync(seed)) {
  const { importXlsxFile } = await import('../src/importer.mjs');
  const rep = importXlsxFile(seed, { actor: null, fileName: 'ingrident.xlsx' });
  console.log(`Boshlang'ich import: ${rep.complete ? "to'liq" : "TO'LIQ EMAS"} (${rep.validation?.ingredients_in_db} ingredient, qoralama)`);
}
const { startServer } = await import('../server.mjs');
startServer();

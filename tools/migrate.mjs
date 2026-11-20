import { loadDotEnv } from '../src/config.mjs';
loadDotEnv();
import { initDb, db } from '../src/db.mjs';
initDb();
console.log('Migratsiyalar qo\'llanildi:', db().prepare('SELECT name, applied_at FROM schema_migrations ORDER BY name').all().map((r) => r.name).join(', '));

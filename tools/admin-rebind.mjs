// Nazoratli amal: mavjud super_admin bog'lanishini o'chiradi (masalan hisob yo'qolganda). --confirm shart.
// Keyin SUPER_ADMIN_EMAIL egasi tasdiqlangan email bilan kirganda bog'lanish qayta yaratiladi.
import { loadDotEnv } from '../src/config.mjs';
loadDotEnv();
import { initDb, db } from '../src/db.mjs';
import { audit } from '../src/audit.mjs';
if (!process.argv.includes('--confirm')) { console.error('Bu amal Super Admin bog\'lanishini o\'chiradi. Davom etish uchun --confirm qo\'shing.'); process.exit(2); }
initDb();
const r = db().prepare("DELETE FROM user_roles WHERE role = 'super_admin'").run();
audit(null, 'super_admin_unbound_cli', null, { removed: r.changes });
console.log(`O'chirildi: ${r.changes}. SUPER_ADMIN_EMAIL egasi tasdiqlangan email bilan kirganda qayta bog'lanadi.`);

// Faqat o'qiydi: kimlar admin huquqiga ega ekanini ko'rsatadi (emaillar maskalanadi).
import { loadDotEnv } from '../src/config.mjs';
loadDotEnv();
import { initDb, db } from '../src/db.mjs';
import { getRole, isSuperAdminEmail } from '../src/roles.mjs';
initDb();
const mask = (e) => e.replace(/^(.{2}).*(@.*)$/, '$1***$2');
const rows = db().prepare('SELECT u.*, r.role AS stored_role FROM user_roles r JOIN users u ON u.id = r.user_id').all();
console.log(`SUPER_ADMIN_EMAIL sozlangan: ${process.env.SUPER_ADMIN_EMAIL ? 'ha' : "YO'Q (hech kim Super Admin emas)"}`);
console.log(`user_roles yozuvlari: ${rows.length}`);
for (const u of rows) console.log(`- ${u.id} ${mask(u.email)} saqlangan_rol=${u.stored_role} samarali_rol=${getRole(u) ?? 'yo\'q'} email_tasdiqlangan=${u.email_verified === 1} env_bilan_mos=${isSuperAdminEmail(u.email)}`);
const sa = db().prepare("SELECT COUNT(*) n FROM user_roles WHERE role = 'super_admin'").get().n;
console.log(`super_admin soni: ${sa} (ko'pi bilan 1 bo'lishi shart)`);
console.log(`Samarali super_admin: ${rows.filter((u) => getRole(u) === 'super_admin').length}`);

// Rollar va yagona Super Admin mantiqi. Hamma qaror serverda, har so'rovda qayta hisoblanadi.
import { db, tx } from './db.mjs';
import { cfg } from './config.mjs';
import { normalizeEmail } from './util.mjs';
import { audit } from './audit.mjs';

export const ASSIGNABLE_ROLES = ['content_editor', 'marketer'];

export function isSuperAdminEmail(email) {
  const allowed = cfg().superAdminEmail;       // allaqachon trim + lowercase
  if (!allowed) return false;                  // sozlanmagan bo'lsa hech kim Super Admin emas
  return normalizeEmail(email) === allowed;    // aniq taqqoslash: nuqta/+ variantlari teng EMAS
}

// Foydalanuvchining samarali roli. Super admin: DB bog'lanishi (o'zgarmas user id) + tasdiqlangan email + hozirgi env.
export function getRole(user) {
  if (!user || user.status !== 'active') return null;
  const row = db().prepare('SELECT role FROM user_roles WHERE user_id = ?').get(user.id);
  if (!row) return null;
  if (row.role === 'super_admin') {
    return user.email_verified === 1 && isSuperAdminEmail(user.email) ? 'super_admin' : null;
  }
  return user.email_verified === 1 ? row.role : null;
}

// Email tasdiqlangandan keyin chaqiriladi. Faqat server ichidan. Ikkinchi super admin yaratilmaydi.
export function maybeBindSuperAdmin(user) {
  if (!user || user.email_verified !== 1 || !isSuperAdminEmail(user.email) || user.status !== 'active') return false;
  return tx((d) => {
    const existing = d.prepare("SELECT user_id FROM user_roles WHERE role = 'super_admin'").get();
    if (existing) return existing.user_id === user.id;
    try {
      d.prepare("INSERT INTO user_roles(user_id, role, granted_by) VALUES (?, 'super_admin', 'system:email_verification')").run(user.id);
    } catch { return false; }                  // unique indeks poyga holatida ham himoya qiladi
    audit(null, 'super_admin_bound', user.id, { via: 'verified_email_match' });
    return true;
  });
}

const PERMS = {
  'admin.access': ['super_admin', 'content_editor', 'marketer'],
  'ingredients.write': ['super_admin', 'content_editor'],
  'ingredients.approve': ['super_admin'],
  'community.moderate': ['super_admin', 'content_editor'],
  'users.read': ['super_admin'],
  'users.moderate': ['super_admin'],
  'roles.manage': ['super_admin'],
  'finance.read': ['super_admin'],
  'marketing.write': ['super_admin', 'marketer'],
  'marketing.read': ['super_admin', 'marketer'],
  'system.read': ['super_admin'],
  'audit.read': ['super_admin'],
  'import.run': ['super_admin', 'content_editor'],
};
export function can(user, perm) {
  const role = getRole(user);
  return !!role && (PERMS[perm] || []).includes(role);
}

export function assignRole(actor, targetUserId, role) {
  if (!can(actor, 'roles.manage')) return { ok: false, error: 'forbidden' };
  if (role !== null && !ASSIGNABLE_ROLES.includes(role)) return { ok: false, error: 'role_not_assignable' };
  const target = db().prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
  if (!target) return { ok: false, error: 'not_found' };
  const cur = db().prepare('SELECT role FROM user_roles WHERE user_id = ?').get(targetUserId);
  if (cur?.role === 'super_admin') return { ok: false, error: 'cannot_modify_super_admin' };
  if (role === null) db().prepare('DELETE FROM user_roles WHERE user_id = ?').run(targetUserId);
  else db().prepare('INSERT INTO user_roles(user_id, role, granted_by) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, granted_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')')
    .run(targetUserId, role, actor.id);
  audit(actor.id, 'role_assigned', targetUserId, { role });
  return { ok: true };
}

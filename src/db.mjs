import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from './config.mjs';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
let current = null;

export function initDb(file = cfg().dbPath) {
  if (current) { try { current.close(); } catch { /* ignore */ } }
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  current = new DatabaseSync(file);
  current.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(current);
  return current;
}
export function db() {
  if (!current) initDb();
  return current;
}
export function migrate(d) {
  d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(d.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    d.exec('BEGIN');
    try {
      d.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
      d.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
      d.exec('COMMIT');
      applied.push(f);
    } catch (e) { d.exec('ROLLBACK'); throw new Error(`Migratsiya ${f} xato: ${e.message}`); }
  }
  return applied;
}
export function tx(fn) {
  const d = db();
  d.exec('BEGIN IMMEDIATE');
  try { const r = fn(d); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; }
}

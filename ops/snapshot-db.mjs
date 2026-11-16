// Writes a consistent copy of a SQLite database (VACUUM INTO) and verifies it.
// Usage: node ops/snapshot-db.mjs <source kota.db> <destination file>
// Uses node:sqlite (Node >= 22.13), so no sqlite3 CLI is required. Safe while the server is running (WAL mode).
import { DatabaseSync } from 'node:sqlite';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: snapshot-db.mjs <source.db> <destination.db>');
  process.exit(1);
}

const db = new DatabaseSync(src, { readOnly: true });
db.exec('PRAGMA busy_timeout = 10000');
db.prepare('VACUUM INTO ?').run(dst);
db.close();

const snap = new DatabaseSync(dst, { readOnly: true });
const integrity = Object.values(snap.prepare('PRAGMA integrity_check').get())[0];
const tables = snap.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
const admins = snap.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
snap.close();

if (integrity !== 'ok') {
  console.error(`snapshot integrity_check failed: ${integrity}`);
  process.exit(2);
}
console.log(`snapshot ok: tables=${tables} admins=${admins}`);

import { parseUsername, openScriptDb } from './common.js';

// Deletes an admin account and (via ON DELETE CASCADE) all of its sessions.
// Refuses to delete the last remaining admin, so the site can never be left without one.
const username = parseUsername(process.argv.slice(2));
const db = openScriptDb();
const row = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
if (!row) {
  console.error(`Admin "${username}" does not exist.`);
  db.close();
  process.exit(1);
}
const { n } = db.prepare('SELECT COUNT(*) AS n FROM admins').get();
if (n <= 1) {
  console.error(`"${username}" is the only admin. Create another admin first (npm run admin:create -- --username NEW), then delete this one.`);
  db.close();
  process.exit(1);
}
db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(row.id);
db.prepare('DELETE FROM admins WHERE id = ?').run(row.id);
console.log(`Admin "${username}" deleted (all of its sessions were ended).`);
db.close();

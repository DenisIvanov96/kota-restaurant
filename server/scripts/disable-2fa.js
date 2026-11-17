import { parseUsername, openScriptDb } from './common.js';

const username = parseUsername(process.argv.slice(2));
const db = openScriptDb();
const admin = db.prepare('SELECT id, username FROM admins WHERE username = ? COLLATE NOCASE').get(username);
if (!admin) { console.error(`Admin "${username}" not found. Nothing changed.`); db.close(); process.exit(1); }
db.prepare('UPDATE admins SET totp_secret = NULL, totp_pending_secret = NULL, updated_at = ? WHERE id = ?').run(Date.now(), admin.id);
const r = db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(admin.id);
console.log(`2FA disabled for "${admin.username}"; ${r.changes} session(s) revoked. The admin can log in with the password and set up 2FA again.`);
db.close();

import { hashPassword } from '../src/auth.js';
import { parseUsername, openScriptDb, getPassword } from './common.js';

const username = parseUsername(process.argv.slice(2));
const db = openScriptDb();
const admin = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
if (!admin) { console.error(`Admin "${username}" not found.`); process.exit(1); }
const hash = await hashPassword(await getPassword());
db.prepare('UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, Date.now(), admin.id);
const r = db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(admin.id);
console.log(`Password reset for "${username}"; ${r.changes} session(s) revoked. 2FA setting unchanged.`);
db.close();

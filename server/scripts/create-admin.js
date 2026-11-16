import { hashPassword } from '../src/auth.js';
import { parseUsername, openScriptDb, getPassword } from './common.js';

const username = parseUsername(process.argv.slice(2));
const db = openScriptDb();
if (db.prepare('SELECT 1 FROM admins WHERE username = ?').get(username)) {
  console.error(`Admin "${username}" already exists. Use admin:reset-password instead.`);
  process.exit(1);
}
const hash = await hashPassword(await getPassword());
const now = Date.now();
db.prepare('INSERT INTO admins(username, password_hash, role, created_at, updated_at) VALUES (?,?,?,?,?)').run(username, hash, 'admin', now, now);
console.log(`Admin "${username}" created.`);
db.close();

import path from 'node:path';
import { openDb } from '../src/db.js';
import { MIN_PASSWORD } from '../src/auth.js';

export function parseUsername(argv) {
  const i = argv.indexOf('--username');
  const name = i >= 0 ? argv[i + 1] : undefined;
  if (!name || !/^[A-Za-z0-9._-]{3,50}$/.test(name)) {
    console.error('Usage: --username NAME  (3-50 chars: letters, digits, . _ -)');
    process.exit(1);
  }
  return name;
}

export function openScriptDb() {
  return openDb(path.resolve(process.env.DATA_DIR || './data'));
}

/** Read a line from the TTY without echo. */
function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('No TTY available: set ADMIN_PASSWORD or run in a terminal.'));
    stdout.write(label);
    let buf = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n');
          return resolve(buf);
        }
        if (c === '\u0003') { stdin.setRawMode(false); stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

export async function getPassword() {
  let pw = process.env.ADMIN_PASSWORD;
  if (pw === undefined || pw === '') {
    pw = await promptHidden('Password: ');
    const again = await promptHidden('Repeat password: ');
    if (pw !== again) { console.error('Passwords do not match.'); process.exit(1); }
  }
  if (pw.length < MIN_PASSWORD) { console.error(`Password must be at least ${MIN_PASSWORD} characters.`); process.exit(1); }
  return pw;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, PASSWORD } from './helpers.js';

const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const run = (script, dataDir, args, password) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(scripts, script), ...args], {
  env: { ...process.env, DATA_DIR: dataDir, ADMIN_PASSWORD: password ?? '' }, encoding: 'utf8', input: '',
});

test('admin:create and admin:reset-password CLI (password from env, weak refused, sessions revoked)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kota-cli-'));
  try {
    assert.notEqual(run('create-admin.js', dataDir, ['--username', 'ab'], PASSWORD).status, 0);
    assert.notEqual(run('create-admin.js', dataDir, ['--username', 'owner'], 'short').status, 0);
    const ok = run('create-admin.js', dataDir, ['--username', 'owner'], PASSWORD);
    assert.equal(ok.status, 0, ok.stderr);
    assert.notEqual(run('create-admin.js', dataDir, ['--username', 'owner'], PASSWORD).status, 0); // duplicate
    assert.notEqual(run('reset-password.js', dataDir, ['--username', 'ghost'], PASSWORD).status, 0);
    assert.notEqual(run('create-admin.js', dataDir, ['--username', 'tty-less'], '').status, 0); // no env, no TTY

    const s = await startApp({ dataDir });
    try {
      const c = s.client();
      assert.equal((await c.login('owner', PASSWORD)).status, 200);
      s.db.prepare('UPDATE admins SET totp_secret = ? WHERE username = ?').run('JBSWY3DPEHPK3PXP', 'owner');
      const rr = run('reset-password.js', dataDir, ['--username', 'owner'], 'another long password');
      assert.equal(rr.status, 0, rr.stderr);
      assert.equal((await c.get('/api/admin/me')).status, 401); // sessions revoked
      assert.equal(s.db.prepare('SELECT totp_secret FROM admins WHERE username = ?').get('owner').totp_secret, 'JBSWY3DPEHPK3PXP'); // 2FA untouched
      assert.equal((await s.client().login('owner', PASSWORD)).status, 401);
    } finally { await s.close(false); }
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('admin:disable-2fa CLI clears TOTP secrets, revokes sessions, fails for unknown user', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kota-cli-'));
  try {
    assert.equal(run('create-admin.js', dataDir, ['--username', 'owner'], PASSWORD).status, 0);
    assert.equal(run('create-admin.js', dataDir, ['--username', 'other'], PASSWORD).status, 0);
    const s = await startApp({ dataDir });
    try {
      const c = s.client();
      const c2 = s.client();
      assert.equal((await c.login('owner', PASSWORD)).status, 200);
      assert.equal((await c2.login('other', PASSWORD)).status, 200);
      s.db.prepare('UPDATE admins SET totp_secret = ?, totp_pending_secret = ?').run('JBSWY3DPEHPK3PXP', 'KRSXG5CTMVRXEZLU');
      const ghost = run('disable-2fa.js', dataDir, ['--username', 'ghost']);
      assert.notEqual(ghost.status, 0);
      assert.match(ghost.stderr, /not found/);
      assert.notEqual(run('disable-2fa.js', dataDir, []).status, 0);
      const r = run('disable-2fa.js', dataDir, ['--username', 'owner']);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /2FA disabled for "owner"/);
      const row = s.db.prepare('SELECT totp_secret, totp_pending_secret FROM admins WHERE username = ?').get('owner');
      assert.equal(row.totp_secret, null);
      assert.equal(row.totp_pending_secret, null);
      assert.equal((await c.get('/api/admin/me')).status, 401); // owner sessions revoked
      assert.equal((await c2.get('/api/admin/me')).status, 200); // other admin untouched
      assert.equal(s.db.prepare('SELECT totp_secret FROM admins WHERE username = ?').get('other').totp_secret, 'JBSWY3DPEHPK3PXP');
    } finally { await s.close(false); }
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

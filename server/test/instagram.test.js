import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loggedIn, startApp } from './helpers.js';

const MIGRATIONS = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations');

test('instagramUrl: accepts empty and instagram.com https URLs; public site mirrors it in bg and en', async () => {
  const s = await loggedIn();
  try {
    assert.equal((await s.api.get('/api/admin/settings')).data.instagramUrl, '');
    for (const ok of ['https://www.instagram.com/kota1.bg', 'https://instagram.com/kota1.bg/', 'https://www.instagram.com/', 'HTTPS://WWW.INSTAGRAM.COM/kota?x=1', '  https://www.instagram.com/kota  ']) {
      const r = await s.api.put('/api/admin/settings', { instagramUrl: ok });
      assert.equal(r.status, 200, ok);
      assert.equal(r.data.instagramUrl, ok.trim(), ok);
    }
    const url = 'https://www.instagram.com/kota1.bg';
    await s.api.put('/api/admin/settings', { instagramUrl: url, addressEn: '1 Test St' });
    assert.equal((await s.api.get('/api/admin/settings')).data.instagramUrl, url);
    for (const lang of ['bg', 'en']) assert.equal((await s.client().get(`/api/public/site?lang=${lang}`)).data.instagramUrl, url);
    // other settings updates keep it; empty clears it
    await s.api.put('/api/admin/settings', { openingHours: 'x' });
    assert.equal((await s.api.get('/api/admin/settings')).data.instagramUrl, url);
    const cleared = await s.api.put('/api/admin/settings', { instagramUrl: '' });
    assert.equal(cleared.data.instagramUrl, '');
    assert.equal((await s.client().get('/api/public/site')).data.instagramUrl, '');
  } finally { await s.close(); }
});

test('instagramUrl: rejects bad schemes, hosts, lookalikes, credentials, length, types', async () => {
  const s = await loggedIn();
  try {
    await s.api.put('/api/admin/settings', { instagramUrl: 'https://www.instagram.com/keep' });
    const bad = [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)//instagram.com', 'data:text/html,x', 'http://www.instagram.com/kota', '//www.instagram.com/kota',
      'www.instagram.com/kota', 'instagram.com', 'https:www.instagram.com', 'ftp://instagram.com/x',
      'https://instagram.com.evil.tld/x', 'https://evilinstagram.com/x', 'https://www.instagram.com.evil.tld', 'https://evil.tld/instagram.com',
      'https://m.instagram.com/x', 'https://notinstagram.com', 'https://instagram.com@evil.tld/x', 'https://user:pw@www.instagram.com/x',
      'https://www.instagram.com:8443/x', 'https://instagram.com\\@evil.tld', 'https://www.instagram.com/a b', 'https://www.instagram.com/​x evil',
      'https://www.instagram.com/' + 'a'.repeat(200), 'https://', 'not a url', '<b>x</b>',
    ];
    for (const v of bad) {
      const r = await s.api.put('/api/admin/settings', { instagramUrl: v });
      assert.equal(r.status, 400, v);
      assert.equal(r.data.error, 'validation', v);
      assert.match(r.data.fields.instagramUrl, /[а-я]/i, v);
    }
    for (const v of [5, null, ['https://www.instagram.com/x'], {}]) {
      const r = await s.api.put('/api/admin/settings', { instagramUrl: v });
      assert.equal(r.status, 400); assert.ok(r.data.fields.instagramUrl);
    }
    // exactly 200 chars is fine
    const max = 'https://www.instagram.com/' + 'a'.repeat(200 - 'https://www.instagram.com/'.length);
    assert.equal(max.length, 200);
    assert.equal((await s.api.put('/api/admin/settings', { instagramUrl: max })).status, 200);
    // a rejected value never changes the stored one, and nothing else in the request is saved either
    await s.api.put('/api/admin/settings', { instagramUrl: 'https://www.instagram.com/keep' });
    const r = await s.api.put('/api/admin/settings', { instagramUrl: 'http://x', openingHours: 'changed' });
    assert.equal(r.status, 400);
    const st = (await s.api.get('/api/admin/settings')).data;
    assert.equal(st.instagramUrl, 'https://www.instagram.com/keep'); assert.notEqual(st.openingHours, 'changed');
    // auth / CSRF still enforced
    assert.equal((await s.client().put('/api/admin/settings', { instagramUrl: '' })).status, 401);
    assert.equal((await s.api.req('PUT', '/api/admin/settings', { csrf: false, json: { instagramUrl: '' } })).status, 403);
  } finally { await s.close(); }
});

function oldDb(prefix, setup) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dataDir, 'uploads'));
  const db = new DatabaseSync(path.join(dataDir, 'kota.db'));
  db.exec(fs.readFileSync(path.join(MIGRATIONS, '001_init.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(MIGRATIONS, '002_i18n.sql'), 'utf8'));
  db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const n of ['001_init.sql', '002_i18n.sql']) db.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, 1)').run(n);
  setup(db);
  db.close();
  return dataDir;
}

test('migration 003: fills empty addresses on an existing DB, never overwrites, idempotent', async () => {
  // both empty -> defaults
  let dataDir = oldDb('kota-m3a-', () => {});
  let s = await loggedIn({ dataDir });
  try {
    const st = (await s.api.get('/api/admin/settings')).data;
    assert.equal(st.address, 'ул. Ралевица 85, София'); assert.equal(st.addressEn, '85 Ralevitsa St, Sofia');
    assert.equal(st.instagramUrl, '');
    assert.equal((await s.client().get('/api/public/site?lang=en')).data.address, '85 Ralevitsa St, Sofia');
    // owner clears the address later: a restart (migrations re-run) must not refill it
    assert.equal((await s.api.put('/api/admin/settings', { address: '', addressEn: '' })).status, 200);
  } finally { await s.close(false); }
  s = await startApp({ dataDir });
  try {
    const row = (k) => s.db.prepare('SELECT value FROM settings WHERE key = ?').get(k).value;
    assert.equal(row('address'), ''); assert.equal(row('address_en'), '');
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 7);
  } finally { await s.close(); }

  // non-empty values preserved (including bg set / en empty)
  dataDir = oldDb('kota-m3b-', (db) => {
    db.prepare("UPDATE settings SET value = 'ул. Моя 5' WHERE key = 'address'").run();
    db.prepare("UPDATE settings SET value = '5 My St' WHERE key = 'address_en'").run();
  });
  s = await loggedIn({ dataDir });
  try {
    const st = (await s.api.get('/api/admin/settings')).data;
    assert.equal(st.address, 'ул. Моя 5'); assert.equal(st.addressEn, '5 My St');
  } finally { await s.close(); }

  dataDir = oldDb('kota-m3c-', (db) => { db.prepare("UPDATE settings SET value = 'ул. Моя 5' WHERE key = 'address'").run(); });
  s = await loggedIn({ dataDir });
  try {
    const st = (await s.api.get('/api/admin/settings')).data;
    assert.equal(st.address, 'ул. Моя 5'); assert.equal(st.addressEn, ''); // BUG-12: no EN default beside an owner BG address
    assert.equal((await s.client().get('/api/public/site?lang=en')).data.address, 'ул. Моя 5');
  } finally { await s.close(); }

  // missing rows entirely (e.g. 002 never inserted address_en)
  dataDir = oldDb('kota-m3d-', (db) => { db.exec("DELETE FROM settings WHERE key IN ('address', 'address_en')"); });
  s = await loggedIn({ dataDir });
  try {
    const st = (await s.api.get('/api/admin/settings')).data;
    assert.equal(st.address, 'ул. Ралевица 85, София'); assert.equal(st.addressEn, '85 Ralevitsa St, Sofia');
  } finally { await s.close(); }
});

test('migration 004 (BUG-12 corrective): clears a wrongly seeded EN default only; idempotent; owner values untouched', async () => {
  const run = async (prefix, addr, addrEn, applied003 = true) => {
    const dataDir = oldDb(prefix, (db) => {
      // state left by the OLD 003 (EN default seeded regardless of the BG address); applied003=false: 003 still pending
      db.prepare("UPDATE settings SET value = ? WHERE key = 'address'").run(addr);
      db.prepare("UPDATE settings SET value = ? WHERE key = 'address_en'").run(addrEn);
      if (applied003) db.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, 1)').run('003_default_address.sql');
    });
    const s = await startApp({ dataDir });
    try {
      const row = (k) => s.db.prepare('SELECT value FROM settings WHERE key = ?').get(k).value;
      const out = [row('address'), row('address_en')];
      assert.equal(s.db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 7);
      return out;
    } finally { await s.close(); }
  };
  const DEF_BG = 'ул. Ралевица 85, София', DEF_EN = '85 Ralevitsa St, Sofia';
  assert.deepEqual(await run('kota-m4a-', 'ул. Витоша 1, София', DEF_EN), ['ул. Витоша 1, София', '']); // wrong state is repaired
  assert.deepEqual(await run('kota-m4b-', DEF_BG, DEF_EN), [DEF_BG, DEF_EN]); // legit default pair kept
  assert.deepEqual(await run('kota-m4c-', 'ул. Витоша 1, София', '1 Vitosha St, Sofia'), ['ул. Витоша 1, София', '1 Vitosha St, Sofia']); // owner EN kept
  assert.deepEqual(await run('kota-m4d-', '', '', false), [DEF_BG, DEF_EN]); // 003 seeds both together
  assert.deepEqual(await run('kota-m4e-', '', '1 Own St', false), [DEF_BG, '1 Own St']); // owner EN kept; BG seeded
});

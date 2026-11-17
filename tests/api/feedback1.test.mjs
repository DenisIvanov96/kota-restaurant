// T-29 owner feedback round 1, server side: migration 003 (default address, instagram_url key), instagramUrl setting
// contract, /reservation route. Port 3206.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, createAdmin, Client, tmpDir, ROOT } from '../lib/harness.mjs';

const PORT = 3206;
const T0 = '2026-06-15T10:00:00Z';
const MIG = path.join(ROOT, 'server', 'migrations');
const DEF_BG = 'ул. Ралевица 85, София';
const DEF_EN = '85 Ralevitsa St, Sofia';
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** DB built from 001 + 002 only (the state of a live pre-feedback deployment), with the given settings; server start then applies 003. */
async function legacyDb(settings) {
  const dir = tmpDir('fb1mig'); dirs.push(dir); fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'kota.db'));
  db.exec(fs.readFileSync(path.join(MIG, '001_init.sql'), 'utf8')); db.exec(fs.readFileSync(path.join(MIG, '002_i18n.sql'), 'utf8'));
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const n of ['001_init.sql', '002_i18n.sql']) db.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run(n, Date.now());
  for (const [k, v] of Object.entries(settings)) db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
  db.close();
  const srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
  const anon = new Client(srv.url);
  const site = async (lang) => (await anon.get(`/api/public/site?lang=${lang}`)).data;
  return { dir, srv, site };
}

describe('migration 003 on existing databases (D-37: default address only where none is stored)', () => {
  const cases = [
    ['M1 nothing stored (never configured): both languages get the default', {}, DEF_BG, DEF_EN, DEF_EN],
    ['M2 whitespace-only address and address_en: treated as empty -> defaults', { address: '   ', address_en: '  ' }, DEF_BG, DEF_EN, DEF_EN],
    ['M3 BG and EN addresses both stored: both kept untouched', { address: 'ул. Витоша 1, София', address_en: '1 Vitosha St, Sofia' }, 'ул. Витоша 1, София', '1 Vitosha St, Sofia', '1 Vitosha St, Sofia'],
    ['M4 only the BG address is stored (EN never set): the EN site must show the SAME address (fallback to the stored BG one), never the default address of a different place', { address: 'ул. Витоша 1, София' }, 'ул. Витоша 1, София', 'ул. Витоша 1, София', 'ул. Витоша 1, София'],
    ['M5 BG address stored with empty-string EN: EN falls back to the stored BG address', { address: 'ул. Витоша 1, София', address_en: '' }, 'ул. Витоша 1, София', 'ул. Витоша 1, София', 'ул. Витоша 1, София'],
  ];
  for (const [name, settings, bg, en] of cases) {
    test(name, async () => {
      const { dir, srv, site } = await legacyDb(settings);
      try {
        const b = await site('bg'); const e = await site('en');
        assert.equal(b.address, bg, `bg address ${JSON.stringify(b.address)}`);
        assert.equal(e.address, en, `en address ${JSON.stringify(e.address)} (stored BG: ${JSON.stringify(settings.address)})`);
        assert.equal(b.instagramUrl, ''); // key created by the migration / default
        const chk = new DatabaseSync(path.join(dir, 'kota.db'));
        assert.ok(chk.prepare("SELECT 1 FROM schema_migrations WHERE name='003_default_address.sql'").get(), '003 recorded as applied');
        chk.close();
      } finally { await srv.stop(); }
      // restart: idempotent, values unchanged, 003 not re-applied
      const s2 = await startServer({ port: PORT, dataDir: dir, now: T0 });
      try { const a = new Client(s2.url); assert.equal((await a.get('/api/public/site?lang=bg')).data.address, bg); assert.equal((await a.get('/api/public/site?lang=en')).data.address, en); } finally { await s2.stop(); }
    });
  }
  test('M6 address_en stored but BG empty: BG gets the default, the stored EN is kept', async () => {
    const { srv, site } = await legacyDb({ address: '', address_en: '5 Custom St, Sofia' });
    try { assert.equal((await site('bg')).address, DEF_BG); assert.equal((await site('en')).address, '5 Custom St, Sofia'); } finally { await srv.stop(); }
  });
});

/** DB in the state of a deployment that already ran the OLD (buggy) 003 from 9fd7c8d: 001+002 + old 003 applied and recorded; server start then applies 004. */
async function oldBuggy003Db(settings) {
  const dir = tmpDir('fb1m4'); dirs.push(dir); fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'kota.db'));
  db.exec(fs.readFileSync(path.join(MIG, '001_init.sql'), 'utf8')); db.exec(fs.readFileSync(path.join(MIG, '002_i18n.sql'), 'utf8'));
  for (const [k, v] of Object.entries(settings)) db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
  // the old 003 exactly as shipped at 9fd7c8d (seeds address_en independently of address)
  db.exec(`INSERT OR IGNORE INTO settings(key, value) VALUES ('address', ''), ('address_en', ''), ('instagram_url', '');
    UPDATE settings SET value = '${DEF_BG}' WHERE key = 'address' AND TRIM(value) = '';
    UPDATE settings SET value = '${DEF_EN}' WHERE key = 'address_en' AND TRIM(value) = '';`);
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const n of ['001_init.sql', '002_i18n.sql', '003_default_address.sql']) db.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run(n, Date.now());
  const pre = db.prepare("SELECT value FROM settings WHERE key='address_en'").get().value;
  db.close();
  const srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
  const anon = new Client(srv.url);
  return { dir, srv, pre, site: async (lang) => (await anon.get(`/api/public/site?lang=${lang}`)).data };
}

describe('migration 004 repairs databases that already ran the old 003 (BUG-12)', () => {
  const cases = [
    ['N1 BG custom + EN = default (damage from old 003): EN cleared -> falls back to BG', { address: 'ул. Витоша 1, София' }, 'ул. Витоша 1, София', 'ул. Витоша 1, София', DEF_EN],
    ['N2 BG custom + owner-entered EN kept', { address: 'ул. Витоша 1, София', address_en: '1 Vitosha St, Sofia' }, 'ул. Витоша 1, София', '1 Vitosha St, Sofia', '1 Vitosha St, Sofia'],
    ['N3 nothing stored (old 003 seeded both defaults): both defaults stay', {}, DEF_BG, DEF_EN, DEF_EN],
    ['N4 BG = default + EN = default: kept', { address: DEF_BG, address_en: DEF_EN }, DEF_BG, DEF_EN, DEF_EN],
    ['N5 BG empty + EN custom (old 003 filled BG default): both kept', { address: '', address_en: '5 Custom St, Sofia' }, DEF_BG, '5 Custom St, Sofia', '5 Custom St, Sofia'],
  ];
  for (const [name, settings, bg, en, pre] of cases) {
    test(name, async () => {
      const { dir, srv, site, pre: before } = await oldBuggy003Db(settings);
      try {
        assert.equal(before, pre, 'precondition: address_en after old 003');
        assert.equal((await site('bg')).address, bg); assert.equal((await site('en')).address, en);
        const chk = new DatabaseSync(path.join(dir, 'kota.db'));
        assert.deepEqual(chk.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name), ['001_init.sql', '002_i18n.sql', '003_default_address.sql', '004_fix_default_address_en.sql', '005_separate_languages.sql', '006_menu_pages.sql']);
        chk.close();
      } finally { await srv.stop(); }
      const s2 = await startServer({ port: PORT, dataDir: dir, now: T0 }); // idempotent restart
      try { const a = new Client(s2.url); assert.equal((await a.get('/api/public/site?lang=bg')).data.address, bg); assert.equal((await a.get('/api/public/site?lang=en')).data.address, en); } finally { await s2.stop(); }
    });
  }
});

describe('fresh database + instagramUrl setting contract', () => {
  const dir = tmpDir('fb1api'); dirs.push(dir); createAdmin(dir);
  let srv; let admin; let anon;
  test('F0 start', async () => { srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); });
  after(async () => { if (srv) await srv.stop(); });

  test('F1 fresh DB: public + admin settings carry the default addresses; instagramUrl is ""; applied migrations are 001..006', async () => {
    assert.equal((await anon.get('/api/public/site')).data.address, DEF_BG);
    assert.equal((await anon.get('/api/public/site?lang=en')).data.address, DEF_EN);
    const s = (await admin.get('/api/admin/settings')).data;
    assert.equal(s.address, DEF_BG); assert.equal(s.addressEn, DEF_EN); assert.equal(s.instagramUrl, '');
    const chk = new DatabaseSync(path.join(dir, 'kota.db'));
    assert.deepEqual(chk.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name), ['001_init.sql', '002_i18n.sql', '003_default_address.sql', '004_fix_default_address_en.sql', '005_separate_languages.sql', '006_menu_pages.sql']);
    chk.close();
  });
  test('F2 the owner can overwrite the default address and clear it; clearing gives "" (client shows the default)', async () => {
    let r = await admin.put('/api/admin/settings', { json: { address: 'ул. Нова 1', addressEn: '' } });
    assert.equal(r.status, 200); assert.equal(r.data.address, 'ул. Нова 1'); assert.equal(r.data.addressEn, '');
    assert.equal((await anon.get('/api/public/site?lang=en')).data.address, 'ул. Нова 1', 'EN falls back to the BG address');
    r = await admin.put('/api/admin/settings', { json: { address: '', addressEn: '' } });
    assert.equal(r.data.address, ''); assert.equal((await anon.get('/api/public/site')).data.address, '');
  });
  test('F3 PUT without instagramUrl leaves it untouched (partial update); with it updates; both languages return the same value', async () => {
    const url = 'https://www.instagram.com/kota1/';
    assert.equal((await admin.put('/api/admin/settings', { json: { instagramUrl: url } })).data.instagramUrl, url);
    assert.equal((await admin.put('/api/admin/settings', { json: { reservationPhone: '+359 2 111' } })).data.instagramUrl, url);
    assert.equal((await anon.get('/api/public/site')).data.instagramUrl, url);
    assert.equal((await anon.get('/api/public/site?lang=en')).data.instagramUrl, url);
  });
  test('F4 accepted: empty, www/non-www, upper-case host, query, exactly 200 chars; rejected (400 fields.instagramUrl, stored value unchanged): lookalikes, schemes, userinfo, port, backslash, whitespace, 201 chars', async () => {
    const keep = 'https://www.instagram.com/keep/';
    for (const v of ['https://instagram.com/x', 'https://WWW.INSTAGRAM.COM/X', 'https://www.instagram.com/x?hl=bg', 'https://www.instagram.com/' + 'a'.repeat(174), '']) {
      const r = await admin.put('/api/admin/settings', { json: { instagramUrl: v } }); assert.equal(r.status, 200, v); assert.equal(r.data.instagramUrl, v);
    }
    assert.equal(v200(), 200);
    await admin.put('/api/admin/settings', { json: { instagramUrl: keep } });
    const bad = ['javascript:alert(1)', 'data:text/html,x', 'http://www.instagram.com/x', '//www.instagram.com/x', 'www.instagram.com/x', 'https://instagram.com.evil.com/', 'https://evil.com/www.instagram.com/', 'https://www.instagram.com@evil.com/', 'https://u:p@www.instagram.com/', 'https://www.instagram.com:8443/', 'https://www.instagram.com\\@evil.com/', 'https://m.instagram.com/x', 'https://www.instagram.com/x y', 'https://www.instagram.com/' + 'a'.repeat(175), 'https://www.instagram.com/' + 'a'.repeat(5000)];
    for (const v of bad) {
      const r = await admin.put('/api/admin/settings', { json: { instagramUrl: v } });
      assert.equal(r.status, 400, `${v.slice(0, 50)} -> ${r.status}`);
      assert.equal(r.data.error, 'validation'); assert.equal(typeof r.data.fields.instagramUrl, 'string');
      assert.equal((await anon.get('/api/public/site')).data.instagramUrl, keep, `stored value changed after rejected ${v.slice(0, 40)}`);
    }
  });
  test('F5 an invalid instagramUrl rejects the WHOLE request: other fields in the same PUT are not saved', async () => {
    const before = (await admin.get('/api/admin/settings')).data;
    const r = await admin.put('/api/admin/settings', { json: { reservationPhone: '+359 9 999', instagramUrl: 'https://evil.example/' } });
    assert.equal(r.status, 400);
    assert.equal((await admin.get('/api/admin/settings')).data.reservationPhone, before.reservationPhone);
  });
  test('F6 types: number / boolean / array / object are rejected or ignored, never stored as non-string, never 5xx', async () => {
    const before = (await admin.get('/api/admin/settings')).data.instagramUrl;
    for (const v of [1, true, ['https://www.instagram.com/x'], { a: 1 }]) {
      const r = await admin.put('/api/admin/settings', { json: { instagramUrl: v } });
      assert.ok(r.status < 500, `${JSON.stringify(v)} -> ${r.status}`);
      assert.equal(typeof (await anon.get('/api/public/site')).data.instagramUrl, 'string');
      if (r.status === 200) assert.equal(r.data.instagramUrl, before);
    }
  });
  test('F7 instagramUrl needs a session, the CSRF header and a same-origin Origin', async () => {
    const body = { json: { instagramUrl: 'https://www.instagram.com/hack/' } };
    assert.equal((await new Client(srv.url).put('/api/admin/settings', body)).status, 401);
    assert.equal((await admin.put('/api/admin/settings', { ...body, csrf: false })).status, 403);
    assert.equal((await admin.put('/api/admin/settings', { ...body, origin: 'https://evil.example' })).status, 403);
    assert.notEqual((await anon.get('/api/public/site')).data.instagramUrl, 'https://www.instagram.com/hack/');
  });
  test('F8 /reservation: HTML 200 with no-cache and the site CSP; HEAD ok; unknown sub-path is the HTML 404; POST is not a page; /api/reservation stays JSON 404', async () => {
    const h = { headers: { accept: 'text/html' } };
    const r = await fetch(srv.url + '/reservation', h);
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/); assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.match(r.headers.get('content-security-policy') || '', /script-src 'self'/);
    const body = await r.text(); assert.ok(body.includes('id="plan-svg"') && body.includes('<h1'));
    assert.equal((await fetch(srv.url + '/reservation', { method: 'HEAD', ...h })).status, 200);
    const nf = await fetch(srv.url + '/reservation/x', h); assert.equal(nf.status, 404); assert.ok((await nf.text()).includes('data-page="notfound"'));
    assert.notEqual((await fetch(srv.url + '/reservation', { method: 'POST' })).status, 200);
    const j = await fetch(srv.url + '/api/reservation', { headers: { accept: 'text/html' } }); assert.equal(j.status, 404); assert.match(j.headers.get('content-type'), /json/);
    assert.equal(JSON.stringify(Object.keys((await anon.get('/api/public/site')).data).sort()), JSON.stringify(['address', 'currencySymbol', 'instagramUrl', 'lang', 'openingHours', 'reservationPhone']));
  });
});
function v200() { return ('https://www.instagram.com/' + 'a'.repeat(174)).length; }

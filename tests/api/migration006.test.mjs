// T-43 (D-47): migration 006 on a database that still has legacy per-file menu_files (001..005 applied). Port 3204.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, createAdmin, Client, tmpDir, makePng, PDF, ROOT } from '../lib/harness.mjs';

const PORT = 3204;
const T0 = '2026-06-15T10:00:00Z';
const MIG = path.join(ROOT, 'server', 'migrations');
const NAMES = ['001_init.sql', '002_i18n.sql', '003_default_address.sql', '004_fix_default_address_en.sql', '005_separate_languages.sql'];
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function legacyDb(tag, setup) {
  const dir = tmpDir(tag); dirs.push(dir); fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'kota.db')); db.exec('PRAGMA foreign_keys = ON');
  for (const n of NAMES) db.exec(fs.readFileSync(path.join(MIG, n), 'utf8'));
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const n of NAMES) db.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run(n, Date.now());
  let seq = 0;
  const now = Date.parse(T0);
  const file = (ext, buf, orig) => {
    const stored = `${(++seq).toString(16).padStart(32, '0')}.${ext}`;
    fs.writeFileSync(path.join(dir, 'uploads', stored), buf);
    const id = Number(db.prepare('INSERT INTO files(stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?)')
      .run(stored, orig, ext === 'pdf' ? 'application/pdf' : 'image/png', buf.length, now).lastInsertRowid);
    return { id, stored };
  };
  const legacy = (f, lang, published, t = now) => Number(db.prepare('INSERT INTO menu_files(file_id, lang, published, created_at) VALUES (?,?,?,?)').run(f.id, lang, published ? 1 : 0, t).lastInsertRowid);
  const out = setup({ db, file, legacy, now });
  db.close();
  return { dir, ...out };
}
const png = (c) => makePng(20, 20, c);
const open = (dir) => new DatabaseSync(path.join(dir, 'kota.db'));
const exists = (dir, stored) => fs.existsSync(path.join(dir, 'uploads', stored));

describe('migration 006 (menu pages) on a legacy database', () => {
  let srv;
  after(async () => { if (srv) await srv.stop(); });

  test('MG1 per language the published legacy file (else the newest) becomes page 1; other legacy files, orphans are deleted; referenced files stay; flags follow the published file', async () => {
    const { dir, f } = legacyDb('mig6a', ({ db, file, legacy, now }) => {
      const f = {};
      f.bgOld = file('png', png([1, 1, 1]), 'bg-old.png'); f.bgPub = file('pdf', Buffer.concat([PDF, Buffer.from('%pub\n')]), 'bg-published.pdf'); f.bgNew = file('png', png([2, 2, 2]), 'bg-newest.png');
      legacy(f.bgOld, 'bg', false, now - 3000); legacy(f.bgPub, 'bg', true, now - 2000); legacy(f.bgNew, 'bg', false, now - 1000);
      f.enA = file('png', png([3, 3, 3]), 'en-a.png'); f.enB = file('png', png([4, 4, 4]), 'en-b.png');
      legacy(f.enA, 'en', false, now - 2000); legacy(f.enB, 'en', false, now - 1000); // none published: newest (by id) is kept, flag stays 0
      f.orphan = file('png', png([5, 5, 5]), 'orphan.png'); // files row referenced by nothing
      f.ev = file('png', png([6, 6, 6]), 'event.png'); f.dm = file('pdf', PDF, 'daily.pdf');
      db.prepare('INSERT INTO events(title, description, image_file_id, enabled, created_at, updated_at) VALUES (?,?,?,1,?,?)').run('Ev', '', f.ev.id, now, now);
      db.prepare('INSERT INTO daily_menus(menu_date, file_id, published, created_at, updated_at) VALUES (?,?,1,?,?)').run('2026-06-15', f.dm.id, now, now);
      db.prepare("UPDATE settings SET value='file' WHERE key='menu_mode'").run();
      return { f };
    });
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
    const anon = new Client(srv.url);
    assert.equal((await anon.get('/api/public/site')).status, 200);
    await srv.stop(); srv = null;
    const chk = open(dir);
    assert.deepEqual(chk.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name), [...NAMES, '006_menu_pages.sql', '007_gallery.sql']);
    const mf = chk.prepare('SELECT m.lang, m.position, m.published, f.original_name FROM menu_files m JOIN files f ON f.id = m.file_id ORDER BY m.lang').all();
    assert.deepEqual(mf.map((r) => [r.lang, r.original_name, r.position, r.published]), [['bg', 'bg-published.pdf', 1, 0], ['en', 'en-b.png', 1, 0]], 'one page per language, legacy published column zeroed');
    const set = Object.fromEntries(chk.prepare("SELECT key, value FROM settings WHERE key LIKE 'menu_pages_published_%'").all().map((r) => [r.key, r.value]));
    assert.deepEqual(set, { menu_pages_published_bg: '1', menu_pages_published_en: '0' });
    const names = chk.prepare('SELECT original_name FROM files ORDER BY original_name').all().map((r) => r.original_name);
    assert.deepEqual(names, ['bg-published.pdf', 'daily.pdf', 'en-b.png', 'event.png'], 'unreferenced files rows removed (old/newest bg, en-a, orphan)');
    chk.close();
    for (const k of ['bgOld', 'bgNew', 'enA', 'orphan']) assert.equal(exists(dir, f[k].stored), false, `${k} deleted from disk`);
    for (const k of ['bgPub', 'enB', 'ev', 'dm']) assert.equal(exists(dir, f[k].stored), true, `${k} kept on disk`);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'uploads')).length, 4);
    // behaviour through the API
    createAdmin(dir);
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
    const a = new Client(srv.url); await a.login(); const an = new Client(srv.url);
    const pub = (await an.get('/api/public/menu?lang=bg')).data; assert.equal(pub.mode, 'file'); assert.equal(pub.file.lang, 'bg'); assert.equal(pub.file.pages.length, 1); assert.equal(pub.file.pages[0].kind, 'pdf');
    assert.equal((await an.get(pub.file.pages[0].fileUrl)).status, 200);
    const en = (await an.get('/api/public/menu?lang=en')).data; assert.equal(en.file.lang, 'bg', 'EN flag is off: EN visitors get BG pages');
    const adm = (await a.get('/api/admin/menu')).data.pages;
    assert.deepEqual([adm.bg.published, adm.bg.items.length, adm.en.published, adm.en.items.length], [true, 1, false, 1]);
    assert.deepEqual([adm.bg.items[0].position, adm.en.items[0].position], [1, 1]);
    assert.equal((await an.get(adm.en.items[0].fileUrl.replace('/api/admin', ''))).status, 404, 'unpublished EN page is not public');
    assert.equal((await an.get('/api/public/events')).data.events[0].imageUrl.startsWith('/media/'), true);
    assert.equal((await an.get('/api/public/daily-menu')).data.menu.kind, 'pdf');
    // new pages append after the migrated page 1
    const up = await a.post('/api/admin/menu/pages', { form: (() => { const fd = new FormData(); fd.append('lang', 'bg'); fd.append('file', new Blob([png([9, 9, 9])], { type: 'image/png' }), 'n.png'); return fd; })() });
    assert.equal(up.status, 201); assert.equal(up.data.position, 2);
    await srv.stop();
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); // idempotent restart: nothing more is deleted
    const chk2 = open(dir);
    assert.equal(chk2.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 7); assert.equal(chk2.prepare('SELECT COUNT(*) n FROM menu_files').get().n, 3);
    assert.equal(chk2.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(chk2.prepare('PRAGMA foreign_key_check').all(), []);
    chk2.close();
    await srv.stop(); srv = null;
  });

  test('MG2 only an EN legacy file, published: EN flag on, BG flag off; BG visitors fall back to EN; mode structured stays structured', async () => {
    const { dir } = legacyDb('mig6b', ({ file, legacy }) => { legacy(file('png', png([7, 7, 7]), 'only-en.png'), 'en', true); return {}; });
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
    const an = new Client(srv.url);
    let m = (await an.get('/api/public/menu?lang=bg')).data; assert.equal(m.mode, 'structured'); assert.equal(m.file, null);
    await srv.stop(); srv = null;
    const chk = open(dir);
    assert.deepEqual(Object.fromEntries(chk.prepare("SELECT key, value FROM settings WHERE key LIKE 'menu_pages_published_%'").all().map((r) => [r.key, r.value])), { menu_pages_published_bg: '0', menu_pages_published_en: '1' });
    chk.prepare("UPDATE settings SET value='file' WHERE key='menu_mode'").run(); chk.close();
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
    m = (await new Client(srv.url).get('/api/public/menu?lang=bg')).data; assert.equal(m.file.lang, 'en'); assert.equal(m.file.pages.length, 1);
    await srv.stop(); srv = null;
  });

  test('MG3 no legacy files: both flags 0, nothing deleted, fresh behaviour (nothing_published); only-unpublished legacy file in the other language keeps flag 0', async () => {
    const { dir } = legacyDb('mig6c', ({ file, legacy, db, now }) => {
      legacy(file('png', png([8, 8, 8]), 'u-bg.png'), 'bg', false);
      const ev = file('png', png([6, 6, 6]), 'event.png');
      db.prepare('INSERT INTO events(title, description, image_file_id, enabled, created_at, updated_at) VALUES (?,?,?,1,?,?)').run('Ev', '', ev.id, now, now);
      return {};
    });
    createAdmin(dir);
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
    const a = new Client(srv.url); await a.login();
    const pg = (await a.get('/api/admin/menu')).data.pages; assert.deepEqual([pg.bg.published, pg.bg.items.length, pg.en.published, pg.en.items.length], [false, 1, false, 0], 'single unpublished legacy file kept as page 1');
    const r = await a.put('/api/admin/menu/mode', { json: { mode: 'file' } }); assert.equal(r.status, 409); assert.equal(r.data.error, 'nothing_published');
    await srv.stop(); srv = null;
    assert.equal(fs.readdirSync(path.join(dir, 'uploads')).length, 2);
  });
});

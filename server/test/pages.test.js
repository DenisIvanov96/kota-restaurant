// T-38: multi-page regular menu (D-46) + migration 006.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loggedIn, PDF, PNG, JPG } from './helpers.js';

const form = (fields, file) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  if (file) f.append('file', new Blob([file.buf], { type: file.type }), file.name);
  return f;
};
const PDFF = { buf: PDF, name: 'p.pdf', type: 'application/pdf' };
const PNGF = { buf: PNG, name: 'p.png', type: 'image/png' };
const JPGF = { buf: JPG, name: 'p.jpg', type: 'image/jpeg' };
const add = (s, lang, file = PNGF) => s.api.req('POST', '/api/admin/menu/pages', { form: form(lang ? { lang } : {}, file) });
const pub = (s, q = '') => s.client().get(`/api/public/menu${q}`);
const adminPages = async (s) => (await s.api.get('/api/admin/menu')).data.pages;
const media = (s, r) => fetch(`${s.base}/media/${r.data.fileUrl.split('/').pop()}`).then((x) => x.status);
const order = (s, lang, ids) => s.api.put('/api/admin/menu/pages/order', { lang, ids });
const setPub = (s, lang, published) => s.api.put('/api/admin/menu/pages/published', { lang, published });

test('add pages: 201 object, appended positions, per-language sets, default lang bg, validation', async () => {
  const s = await loggedIn();
  try {
    const a = await add(s, 'bg', PDFF); const b = await add(s, undefined, JPGF); const c = await add(s, 'en');
    assert.equal(a.status, 201);
    assert.deepEqual(Object.keys(a.data).sort(), ['createdAt', 'fileUrl', 'id', 'kind', 'lang', 'mimeType', 'originalName', 'position', 'sizeBytes']);
    assert.deepEqual([a.data.lang, a.data.position, a.data.kind, a.data.mimeType, a.data.originalName, a.data.sizeBytes], ['bg', 1, 'pdf', 'application/pdf', 'p.pdf', PDF.length]);
    assert.deepEqual([b.data.lang, b.data.position, b.data.kind], ['bg', 2, 'image']);
    assert.deepEqual([c.data.lang, c.data.position], ['en', 1]);
    assert.match(a.data.fileUrl, /^\/api\/admin\/media\/[a-f0-9]{32}\.pdf$/);
    const p = await adminPages(s);
    assert.deepEqual(p.bg.items.map((x) => x.id), [a.data.id, b.data.id]);
    assert.equal(p.en.published, false);
    assert.deepEqual(p.en.items.map(({ lang, createdAt, ...r }) => r), [{ id: c.data.id, fileUrl: c.data.fileUrl, mimeType: 'image/png', kind: 'image', originalName: 'p.png', sizeBytes: PNG.length, position: 1 }]);
    // validation
    const bad = await add(s, 'fr'); assert.equal(bad.status, 400); assert.ok(bad.data.fields.lang);
    const none = await s.api.req('POST', '/api/admin/menu/pages', { form: form({ lang: 'bg' }) }); assert.equal(none.status, 400); assert.ok(none.data.fields.file);
    assert.equal((await add(s, 'bg', { buf: Buffer.from('<html>'), name: 'x.png', type: 'image/png' })).status, 415);
    assert.equal(s.uploads().length, 3);
    // old per-file routes are gone
    assert.equal((await s.api.req('POST', '/api/admin/menu/files', { form: form({}, PDFF) })).status, 404);
    assert.equal((await s.api.patch(`/api/admin/menu/files/${a.data.id}/published`, { published: true })).status, 404);
    assert.equal((await s.api.get('/api/admin/menu')).data.files, undefined);
  } finally { await s.close(); }
});

test('limit: 15 pages per language, 16th -> 409 too_many_pages (nothing stored); other language unaffected; delete frees a slot', async () => {
  const s = await loggedIn();
  try {
    const ids = [];
    for (let i = 0; i < 15; i++) { const r = await add(s, 'bg'); assert.equal(r.status, 201); ids.push(r.data.id); }
    const r = await add(s, 'bg');
    assert.equal(r.status, 409); assert.equal(r.data.error, 'too_many_pages');
    assert.equal(s.uploads().length, 15);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 15);
    assert.equal((await add(s, 'en')).status, 201);
    assert.equal((await s.api.del(`/api/admin/menu/pages/${ids[3]}`)).status, 204);
    assert.equal((await add(s, 'bg')).status, 201);
    assert.deepEqual((await adminPages(s)).bg.items.map((x) => x.position), Array.from({ length: 15 }, (_, i) => i + 1));
  } finally { await s.close(); }
});

test('order: full permutation required; positions renumbered; public order follows; delete renumbers', async () => {
  const s = await loggedIn();
  try {
    const [a, b, c] = [await add(s, 'bg'), await add(s, 'bg'), await add(s, 'bg')];
    const en = await add(s, 'en');
    const r = await order(s, 'bg', [c.data.id, a.data.id, b.data.id]);
    assert.equal(r.status, 200); assert.equal(r.data.lang, 'bg'); assert.deepEqual(r.data.items.map((x) => [x.id, x.position]), [[c.data.id, 1], [a.data.id, 2], [b.data.id, 3]]);
    // invalid permutations
    for (const ids of [[a.data.id, b.data.id], [a.data.id, a.data.id, b.data.id], [a.data.id, b.data.id, c.data.id, en.data.id], [a.data.id, b.data.id, en.data.id], 'x', [1.5, 2, 3], undefined]) {
      const bad = await order(s, 'bg', ids); assert.equal(bad.status, 400, JSON.stringify(ids)); assert.ok(bad.data.fields.ids);
    }
    assert.equal((await order(s, 'xx', [])).status, 400);
    assert.deepEqual((await adminPages(s)).bg.items.map((x) => x.id), [c.data.id, a.data.id, b.data.id]);
    // public order
    await setPub(s, 'bg', true);
    await s.api.put('/api/admin/menu/draft', { categories: [] }); await s.api.post('/api/admin/menu/publish');
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'file' })).status, 200);
    const urls = (await pub(s)).data.file.pages.map((p) => p.fileUrl);
    assert.deepEqual(urls, [c, a, b].map((x) => '/media/' + x.data.fileUrl.split('/').pop()));
    // delete in the middle renumbers
    assert.equal((await s.api.del(`/api/admin/menu/pages/${a.data.id}`)).status, 204);
    assert.deepEqual((await adminPages(s)).bg.items.map((x) => [x.id, x.position]), [[c.data.id, 1], [b.data.id, 2]]);
    assert.equal((await s.api.del(`/api/admin/menu/pages/${a.data.id}`)).status, 404);
    assert.equal((await s.api.del('/api/admin/menu/pages/abc')).status, 404);
    assert.equal(s.uploads().length, 3);
  } finally { await s.close(); }
});

test('publish flag per language; mode rules nothing_published / in_use; public shape; fallback; media visibility', async () => {
  const s = await loggedIn();
  try {
    const bg = [await add(s, 'bg', PDFF), await add(s, 'bg', JPGF)];
    const en = [await add(s, 'en', PNGF)];
    // publishing validation
    assert.equal((await s.api.put('/api/admin/menu/pages/published', { lang: 'bg', published: 'maybe' })).status, 400);
    assert.equal((await s.api.put('/api/admin/menu/pages/published', { lang: 'zz', published: true })).status, 400);
    // nothing published -> file mode refused
    let m = await s.api.put('/api/admin/menu/mode', { mode: 'file' });
    assert.equal(m.status, 409); assert.equal(m.data.error, 'nothing_published');
    const r = await setPub(s, 'bg', true);
    assert.equal(r.status, 200); assert.equal(r.data.published, true); assert.equal(r.data.items.length, 2);
    assert.equal((await pub(s)).data.file, null); // structured mode
    // a published language with zero pages is not "published with >=1 page"
    assert.equal((await setPub(s, 'en', false)).status, 200);
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'file' })).status, 200);
    // media: only pages of a published language, only in file mode
    assert.equal(await media(s, bg[0]), 200); assert.equal(await media(s, bg[1]), 200); assert.equal(await media(s, en[0]), 404);
    // public shape
    let f = (await pub(s, '?lang=bg')).data.file;
    assert.deepEqual(Object.keys(f).sort(), ['lang', 'pages', 'publishedAt']);
    assert.equal(f.lang, 'bg'); assert.deepEqual(f.pages.map((p) => [p.mimeType, p.kind]), [['application/pdf', 'pdf'], ['image/jpeg', 'image']]);
    assert.deepEqual(Object.keys(f.pages[0]).sort(), ['fileUrl', 'kind', 'mimeType']);
    assert.match(f.publishedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
    // fallback: en requested, only bg live -> bg pages
    f = (await pub(s, '?lang=en')).data.file; assert.equal(f.lang, 'bg'); assert.equal(f.pages.length, 2);
    // both live: each own language
    await setPub(s, 'en', true);
    assert.equal((await pub(s, '?lang=en')).data.file.lang, 'en');
    assert.equal((await pub(s, '?lang=bg')).data.file.lang, 'bg');
    assert.equal(await media(s, en[0]), 200);
    // unpublish bg is allowed while en is live; bg then falls back to en and bg pages are hidden
    assert.equal((await setPub(s, 'bg', false)).status, 200);
    f = (await pub(s, '?lang=bg')).data.file; assert.equal(f.lang, 'en');
    assert.equal(await media(s, bg[0]), 404); assert.equal(await media(s, en[0]), 200);
    // in_use: the only live language cannot be unpublished, nor its last page deleted
    let u = await setPub(s, 'en', false); assert.equal(u.status, 409); assert.equal(u.data.error, 'in_use');
    u = await s.api.del(`/api/admin/menu/pages/${en[0].data.id}`); assert.equal(u.status, 409); assert.equal(u.data.error, 'in_use');
    // unpublished language's pages may be deleted freely
    assert.equal((await s.api.del(`/api/admin/menu/pages/${bg[1].data.id}`)).status, 204);
    // deleting a page of the live language when others remain is fine
    const en2 = await add(s, 'en', JPGF);
    assert.equal((await s.api.del(`/api/admin/menu/pages/${en[0].data.id}`)).status, 204);
    assert.equal((await pub(s)).data.file.pages.length, 1);
    // leave file mode, then everything is deletable/unpublishable
    await s.api.put('/api/admin/menu/draft', { categories: [] }); await s.api.post('/api/admin/menu/publish');
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'structured' })).status, 200);
    assert.equal((await setPub(s, 'en', false)).status, 200);
    assert.equal((await s.api.del(`/api/admin/menu/pages/${en2.data.id}`)).status, 204);
    // a published flag with no pages is not public
    await setPub(s, 'en', true);
    const nm = await s.api.put('/api/admin/menu/mode', { mode: 'file' });
    assert.equal(nm.status, 409); assert.equal(nm.data.error, 'nothing_published');
  } finally { await s.close(); }
});

test('publishedAt follows changes to the live page set; dashboard reports pages per language', async () => {
  const s = await loggedIn({ iso: '2026-06-15T10:00:00Z' });
  try {
    await add(s, 'bg'); const p2 = await add(s, 'bg'); await add(s, 'en');
    await setPub(s, 'bg', true);
    await s.api.put('/api/admin/menu/draft', { categories: [] }); await s.api.post('/api/admin/menu/publish');
    await s.api.put('/api/admin/menu/mode', { mode: 'file' });
    assert.equal((await pub(s)).data.file.publishedAt, '2026-06-15T13:00');
    s.clock.t = Date.parse('2026-06-15T12:00:00Z');
    await s.api.del(`/api/admin/menu/pages/${p2.data.id}`);
    assert.equal((await pub(s)).data.file.publishedAt, '2026-06-15T15:00');
    assert.deepEqual((await s.api.get('/api/admin/dashboard')).data.menu.pages, { bg: { published: true, count: 1 }, en: { published: false, count: 1 } });
  } finally { await s.close(); }
});

test('new routes: 401 without session, 403 without CSRF header; no file left behind', async () => {
  const s = await loggedIn();
  try {
    const anon = s.client();
    for (const [m, u] of [['POST', '/api/admin/menu/pages'], ['PUT', '/api/admin/menu/pages/order'], ['PUT', '/api/admin/menu/pages/published'], ['DELETE', '/api/admin/menu/pages/1']]) {
      const mk = () => (m === 'POST' ? { form: form({ lang: 'bg' }, PNGF) } : { json: { lang: 'bg', ids: [], published: true } });
      const r = await anon.req(m, u, mk()); assert.equal(r.status, 401, `${m} ${u}`);
      const r2 = await s.api.req(m, u, { ...mk(), csrf: false }); assert.equal(r2.status, 403, `${m} ${u}`);
      if (m === 'POST') {
        const r3 = await s.api.req(m, u, { ...mk(), headers: { Origin: 'https://evil.example' } }); assert.equal(r3.status, 403);
      }
    }
    assert.equal(s.uploads().length, 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM menu_files').get().n, 0);
  } finally { await s.close(); }
});

// ---------- migration 006 ----------
test('migration 006 on a DB with existing menu_files: one file per language becomes page 1, published flag carried over', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kota-mig6-'));
  fs.mkdirSync(path.join(dataDir, 'uploads'));
  const mig = (n) => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations', n), 'utf8');
  const old = new DatabaseSync(path.join(dataDir, 'kota.db'));
  old.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const n of ['001_init.sql', '002_i18n.sql', '003_default_address.sql', '004_fix_default_address_en.sql', '005_separate_languages.sql']) {
    old.exec(mig(n)); old.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, 1)').run(n);
  }
  const names = {};
  for (const [id, ch] of [[1, 'a'], [2, 'b'], [3, 'c'], [4, 'd'], [5, 'e']]) {
    names[id] = `${ch.repeat(32)}.pdf`;
    old.prepare("INSERT INTO files(id, stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?,?,?, 'application/pdf', 4, 1)").run(id, names[id], `f${id}.pdf`);
    fs.writeFileSync(path.join(dataDir, 'uploads', names[id]), 'x');
  }
  // bg: file 1 (old, unpublished), file 2 (published), file 3 (newer, unpublished); en: file 4 (unpublished), file 5 (unpublished, newest)
  for (const [fid, lang, p] of [[1, 'bg', 0], [2, 'bg', 1], [3, 'bg', 0], [4, 'en', 0], [5, 'en', 0]]) {
    old.prepare('INSERT INTO menu_files(file_id, lang, published, created_at) VALUES (?,?,?,?)').run(fid, lang, p, 10 + fid);
  }
  old.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('menu_mode', 'file')").run();
  old.close();
  const s = await loggedIn({ dataDir });
  try {
    const rows = s.db.prepare('SELECT file_id, lang, position FROM menu_files ORDER BY lang').all();
    assert.deepEqual(rows.map((r) => ({ ...r })), [{ file_id: 2, lang: 'bg', position: 1 }, { file_id: 5, lang: 'en', position: 1 }]);
    const p = await adminPages(s);
    assert.equal(p.bg.published, true); assert.equal(p.en.published, false);
    assert.deepEqual(p.bg.items.map((x) => [x.position, x.originalName]), [[1, 'f2.pdf']]);
    // public file mode unchanged: published bg file is the page set, en falls back to it
    const f = (await pub(s, '?lang=en')).data.file;
    assert.equal(f.lang, 'bg'); assert.deepEqual(f.pages.map((x) => x.fileUrl), ['/media/' + names[2]]);
    assert.equal((await fetch(`${s.base}/media/${names[2]}`)).status, 200);
    assert.equal((await fetch(`${s.base}/media/${names[5]}`)).status, 404);
    // dropped alternatives are removed (rows + disk) by the startup sweep; referenced ones stay
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(s.uploads().sort(), [names[2], names[5]].sort());
    assert.deepEqual(s.db.prepare('SELECT id FROM files ORDER BY id').all().map((r) => r.id), [2, 5]);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE name = '006_menu_pages.sql'").get().n, 1);
  } finally { await s.close(); }
});

test('migration 006 on a DB without menu files: nothing published, flags default to 0', async () => {
  const s = await loggedIn();
  try {
    const p = await adminPages(s);
    assert.deepEqual(p, { bg: { published: false, items: [] }, en: { published: false, items: [] } });
    assert.equal((await s.api.get('/api/admin/dashboard')).data.menu.publishedFile, undefined);
  } finally { await s.close(); }
});

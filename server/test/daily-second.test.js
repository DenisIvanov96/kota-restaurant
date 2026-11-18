// T-60: daily menu second page (D-62) + migration 009.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loggedIn, startApp, PDF, PNG, JPG, WEBP } from './helpers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PDFF = { buf: PDF, name: 'p.pdf', type: 'application/pdf' };
const PNGF = { buf: PNG, name: 'p.png', type: 'image/png' };
const JPGF = { buf: JPG, name: 'p.jpg', type: 'image/jpeg' };
const WEBPF = { buf: WEBP, name: 'p.webp', type: 'image/webp' };
const form = (fields = {}, files = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  for (const [field, x] of Object.entries(files)) f.append(field, new Blob([x.buf], { type: x.type }), x.name);
  return f;
};
const post = (s, fields, files) => s.api.req('POST', '/api/admin/daily-menus', { form: form(fields, files) });
const put = (s, id, fields, files) => s.api.req('PUT', `/api/admin/daily-menus/${id}`, { form: form(fields, files) });
const pub = async (s, lang) => (await s.client().get(`/api/public/daily-menu${lang ? `?lang=${lang}` : ''}`)).data;
const name = (o) => o.fileUrl.split('/').pop();
const media = (s, o) => fetch(s.base + o.fileUrl.replace('/api/admin/media', '/media')).then((r) => r.status);
const row = (s, id) => s.db.prepare('SELECT * FROM daily_menus WHERE id = ?').get(id);
const filesCount = (s) => s.db.prepare('SELECT COUNT(*) n FROM files').get().n;

test('migration 009: columns exist and are NULL for a menu without second pages; admin item has file2/fileEn2 = null', async () => {
  const s = await loggedIn();
  try {
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE name = '009_daily_second_page.sql'").get().n, 1);
    const cols = s.db.prepare("PRAGMA table_info('daily_menus')").all().map((c) => c.name);
    assert.ok(cols.includes('file2_id') && cols.includes('file2_en_id'));
    const a = await post(s, { date: '2026-06-15' }, { file: PDFF });
    assert.equal(a.status, 201);
    assert.equal(a.data.file2, null); assert.equal(a.data.fileEn2, null);
    assert.equal((await s.api.get('/api/admin/daily-menus')).data.menus[0].file2, null);
  } finally { await s.close(); }
});

test('POST with file+file2 (BG) and fileEn+fileEn2 (EN): stored, object shape, public files in order', async () => {
  const s = await loggedIn();
  try {
    const r = await post(s, { date: '2026-06-15', published: true }, { file: PNGF, file2: JPGF, fileEn: PDFF, fileEn2: WEBPF });
    assert.equal(r.status, 201);
    assert.equal(r.data.kind, 'image');
    assert.deepEqual(Object.keys(r.data.file2).sort(), ['fileUrl', 'kind', 'mimeType', 'originalName', 'sizeBytes']);
    assert.equal(r.data.file2.mimeType, 'image/jpeg'); assert.equal(r.data.file2.kind, 'image'); assert.equal(r.data.file2.originalName, 'p.jpg');
    assert.match(r.data.file2.fileUrl, /^\/api\/admin\/media\/[a-f0-9]{32}\.jpg$/);
    assert.equal(r.data.fileEn2.mimeType, 'image/webp');
    assert.equal(s.uploads().length, 4);
    const list = (await s.api.get('/api/admin/daily-menus')).data.menus[0];
    assert.equal(list.file2.fileUrl, r.data.file2.fileUrl); assert.equal(list.fileEn2.fileUrl, r.data.fileEn2.fileUrl);
    // admin media endpoint serves the second pages
    assert.equal((await s.api.get(r.data.file2.fileUrl)).status, 200);

    const bg = await pub(s, 'bg');
    assert.deepEqual(bg.menu.files.map((f) => f.mimeType), ['image/png', 'image/jpeg']);
    assert.deepEqual(bg.menu.files.map((f) => f.kind), ['image', 'image']);
    assert.equal(bg.menu.fileUrl, bg.menu.files[0].fileUrl); assert.equal(bg.menu.mimeType, 'image/png'); assert.equal(bg.menu.kind, 'image');
    assert.equal(bg.menu.files[1].fileUrl, '/media/' + name(r.data.file2));
    const en = await pub(s, 'en');
    assert.deepEqual(en.menu.files.map((f) => f.mimeType), ['application/pdf', 'image/webp']);
    assert.equal(en.menu.kind, 'pdf');
    assert.equal(Object.keys(en.menu.files[0]).sort().join(), 'fileUrl,kind,mimeType');
    // default language = bg
    assert.deepEqual((await pub(s)).menu.files.map((f) => f.mimeType), ['image/png', 'image/jpeg']);
  } finally { await s.close(); }
});

test('POST: file2 without file -> 400 fields.file2 (also fileEn2 without fileEn, file2 with only fileEn); nothing stored', async () => {
  const s = await loggedIn();
  try {
    let r = await post(s, { date: '2026-06-15' }, { file2: PNGF, fileEn: PDFF });
    assert.equal(r.status, 400); assert.equal(r.data.error, 'validation'); assert.ok(r.data.fields.file2);
    r = await post(s, { date: '2026-06-15' }, { file: PDFF, fileEn2: PNGF });
    assert.equal(r.status, 400); assert.ok(r.data.fields.fileEn2);
    r = await post(s, { date: '2026-06-15' }, { file2: PNGF });
    assert.equal(r.status, 400); assert.ok(r.data.fields.file2); assert.ok(r.data.fields.file);
    assert.equal(s.uploads().length, 0); assert.equal(filesCount(s), 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM daily_menus').get().n, 0);
    // an invalid second file type is refused (415) and leaves no stored file of the valid first one
    const bad = await post(s, { date: '2026-06-15' }, { file: PDFF, file2: { buf: Buffer.from('hello'), name: 'x.txt', type: 'text/plain' } });
    assert.equal(bad.status, 415); assert.ok(bad.data.fields.file2);
    assert.equal(s.uploads().length, 0); assert.equal(filesCount(s), 0);
  } finally { await s.close(); }
});

test('PUT BG: add file2, replace file2 (old deleted), replace file keeps file2, removeFile2 deletes it; second without first -> 400', async () => {
  const s = await loggedIn();
  try {
    const a = (await post(s, { date: '2026-06-15', published: true }, { file: PNGF })).data;
    let r = await put(s, a.id, {}, { file2: JPGF });
    assert.equal(r.status, 200); assert.equal(r.data.file2.mimeType, 'image/jpeg'); assert.equal(s.uploads().length, 2);
    const first = name(r.data), sec1 = name(r.data.file2);
    r = await put(s, a.id, {}, { file2: WEBPF });
    assert.equal(r.status, 200); assert.equal(r.data.file2.mimeType, 'image/webp');
    assert.equal(s.uploads().length, 2); assert.ok(!s.uploads().includes(sec1)); assert.equal(name(r.data), first);
    const sec2 = name(r.data.file2);
    // replace the first page: the second stays
    r = await put(s, a.id, { published: true }, { file: PDFF });
    assert.equal(r.status, 200); assert.equal(r.data.mimeType, 'application/pdf'); assert.equal(name(r.data.file2), sec2);
    assert.ok(!s.uploads().includes(first)); assert.equal(s.uploads().length, 2);
    // a PUT without file fields keeps both
    r = await put(s, a.id, { published: true });
    assert.equal(r.status, 200); assert.equal(name(r.data.file2), sec2); assert.equal(s.uploads().length, 2);
    assert.deepEqual((await pub(s)).menu.files.map((f) => f.mimeType), ['application/pdf', 'image/webp']);
    // removeFile2
    r = await put(s, a.id, { removeFile2: 'true' });
    assert.equal(r.status, 200); assert.equal(r.data.file2, null);
    assert.deepEqual(s.uploads(), [name(r.data)]); assert.equal(filesCount(s), 1);
    assert.equal((await pub(s)).menu.files.length, 1);
    assert.equal((await media(s, { fileUrl: '/media/' + sec2 })), 404);
    // removing again is a no-op
    assert.equal((await put(s, a.id, { removeFile2: 'true' })).status, 200);
    // invalid flag value is not "true": ignored
    r = await put(s, a.id, {}, { file2: JPGF });
    assert.equal(r.status, 200);
    // an invalid second file leaves the menu untouched
    const before = s.uploads().slice().sort();
    const bad = await put(s, a.id, {}, { file2: { buf: Buffer.from('nope'), name: 'x.png', type: 'image/png' } });
    assert.equal(bad.status, 415); assert.deepEqual(s.uploads().slice().sort(), before);
    assert.ok(r.data.file2);
  } finally { await s.close(); }
});

test('PUT EN: add / replace / remove fileEn2 and the end-state rule (second without first -> 400)', async () => {
  const s = await loggedIn();
  try {
    // BG-only menu: fileEn2 without any English first page is refused
    const a = (await post(s, { date: '2026-06-15', published: true }, { file: PNGF })).data;
    let r = await put(s, a.id, {}, { fileEn2: JPGF });
    assert.equal(r.status, 400); assert.ok(r.data.fields.fileEn2); assert.equal(s.uploads().length, 1);
    // file2 on a menu with an English page only (no BG first page) -> 400
    const b = (await post(s, { date: '2026-06-16' }, { fileEn: PNGF })).data;
    r = await put(s, b.id, {}, { file2: JPGF });
    assert.equal(r.status, 400); assert.ok(r.data.fields.file2);
    // together with its first page it is fine
    r = await put(s, a.id, {}, { fileEn: PDFF, fileEn2: JPGF });
    assert.equal(r.status, 200); assert.equal(r.data.fileEn2.mimeType, 'image/jpeg'); assert.equal(s.uploads().length, 4);
    const sec1 = name(r.data.fileEn2);
    r = await put(s, a.id, {}, { fileEn2: WEBPF });
    assert.equal(r.status, 200); assert.ok(!s.uploads().includes(sec1)); assert.equal(r.data.fileEn2.mimeType, 'image/webp');
    // removing the English first page while its second remains -> 400, nothing changed
    r = await put(s, a.id, { removeFileEn: 'true' });
    assert.equal(r.status, 400); assert.ok(r.data.fields.fileEn2);
    assert.ok(row(s, a.id).file2_en_id && row(s, a.id).file_en_id);
    // both at once is fine
    r = await put(s, a.id, { removeFileEn: 'true', removeFileEn2: 'true' });
    assert.equal(r.status, 200); assert.equal(r.data.fileEn2, null); assert.equal(r.data.fileEnUrl, null);
    assert.equal(s.uploads().length, 2); // a (BG) + b
    // removeFileEn2 on its own
    await put(s, a.id, {}, { fileEn: PDFF, fileEn2: JPGF });
    r = await put(s, a.id, { removeFileEn2: 'true' });
    assert.equal(r.status, 200); assert.equal(r.data.fileEn2, null); assert.equal(r.data.fileEnUrl !== null, true);
    assert.equal(s.uploads().length, 3);
    assert.equal(filesCount(s), 3);
  } finally { await s.close(); }
});

test('POST replace=true removes the old menu with all its second pages; DELETE removes all four files', async () => {
  const s = await loggedIn();
  try {
    const a = (await post(s, { date: '2026-06-15' }, { file: PNGF, file2: JPGF, fileEn: PDFF, fileEn2: WEBPF })).data;
    assert.equal(s.uploads().length, 4);
    assert.equal((await post(s, { date: '2026-06-15' }, { file: PNGF })).status, 409);
    assert.equal(s.uploads().length, 4);
    const rep = await post(s, { date: '2026-06-15', replace: 'true' }, { file: PDFF, file2: PNGF });
    assert.equal(rep.status, 200); assert.equal(rep.data.id, a.id); assert.equal(rep.data.fileEn2, null); assert.equal(rep.data.fileEnUrl, null);
    assert.equal(s.uploads().length, 2); assert.equal(filesCount(s), 2);
    assert.equal((await s.api.del(`/api/admin/daily-menus/${a.id}`)).status, 204);
    assert.deepEqual(s.uploads(), []); assert.equal(filesCount(s), 0);
  } finally { await s.close(); }
});

test('public files: language chosen per menu, both pages of that language, never mixed', async () => {
  const s = await loggedIn();
  try {
    const get = async (fields, files) => { const r = await post(s, { published: true, replace: true, date: '2026-06-15', ...fields }, files); assert.ok(r.status < 300, JSON.stringify(r.data)); return r.data; };
    const mimes = async (lang) => (await pub(s, lang)).menu.files.map((f) => f.mimeType);
    // BG 2 pages + EN 1 page
    await get({}, { file: PNGF, file2: JPGF, fileEn: PDFF });
    assert.deepEqual(await mimes('bg'), ['image/png', 'image/jpeg']);
    assert.deepEqual(await mimes('en'), ['application/pdf']); // EN has its own single page: BG page 2 is NOT appended
    // BG 1 page + EN 2 pages
    await get({}, { file: PDFF, fileEn: PNGF, fileEn2: JPGF });
    assert.deepEqual(await mimes('bg'), ['application/pdf']);
    assert.deepEqual(await mimes('en'), ['image/png', 'image/jpeg']);
    // BG only (2 pages): EN falls back to both BG pages
    await get({}, { file: PNGF, file2: WEBPF });
    assert.deepEqual(await mimes('en'), ['image/png', 'image/webp']);
    assert.deepEqual(await mimes('bg'), ['image/png', 'image/webp']);
    // EN only (2 pages): BG (default) falls back to both EN pages
    await get({}, { fileEn: JPGF, fileEn2: PNGF });
    assert.deepEqual(await mimes('bg'), ['image/jpeg', 'image/png']);
    assert.deepEqual(await mimes(undefined), ['image/jpeg', 'image/png']);
    // single file: files has one item and fileUrl/mimeType/kind as before
    await get({}, { file: PDFF });
    const m = (await pub(s, 'bg')).menu;
    assert.equal(m.files.length, 1); assert.equal(m.files[0].fileUrl, m.fileUrl); assert.equal(m.kind, 'pdf');
    assert.deepEqual(Object.keys(m).sort(), ['date', 'fileUrl', 'files', 'kind', 'mimeType', 'updatedAt']);
    // not published / other date -> null
    await s.api.patch(`/api/admin/daily-menus/${(await s.api.get('/api/admin/daily-menus')).data.menus[0].id}/published`, { published: false });
    assert.equal((await pub(s, 'en')).menu, null);
  } finally { await s.close(); }
});

test('second-page /media: hidden while unpublished or on another day, visible when published today; admin media always works', async () => {
  const s = await loggedIn({ iso: '2026-06-15T10:00:00Z' });
  try {
    const d = (await post(s, { date: '2026-06-15', published: false }, { file: PNGF, file2: JPGF, fileEn: PDFF, fileEn2: WEBPF })).data;
    const all = [d, d.file2, d.fileEn2, { fileUrl: d.fileEnUrl }];
    for (const f of all) assert.equal(await media(s, f), 404, 'unpublished ' + f.fileUrl);
    for (const f of all) assert.equal((await s.api.get(f.fileUrl)).status, 200);
    assert.equal((await s.api.patch(`/api/admin/daily-menus/${d.id}/published`, { published: true })).status, 200);
    for (const f of all) assert.equal(await media(s, f), 200, 'published ' + f.fileUrl);
    // tomorrow's menu is not public yet
    const t = (await post(s, { date: '2026-06-16', published: true }, { file: PNGF, file2: JPGF })).data;
    assert.equal(await media(s, t), 404); assert.equal(await media(s, t.file2), 404);
    s.clock.t = Date.parse('2026-06-15T21:00:00Z'); // Sofia midnight
    assert.equal(await media(s, t.file2), 200); assert.equal(await media(s, d.file2), 404);
    await s.api.patch(`/api/admin/daily-menus/${t.id}/published`, { published: false });
    assert.equal(await media(s, t.file2), 404); assert.equal(await media(s, t), 404);
  } finally { await s.close(); }
});

test('past-menu cleanup deletes both pages of every language from disk (POST and PUT with a file)', async () => {
  const s = await loggedIn({ iso: '2026-06-15T10:00:00Z' });
  try {
    const old = (await post(s, { date: '2026-06-13', published: true }, { file: PNGF, file2: JPGF, fileEn: PDFF, fileEn2: WEBPF })).data;
    assert.equal(old.fileEn2 !== null, true);
    assert.equal(s.uploads().length, 4);
    // creating a past-dated menu keeps it (exceptId); the next write cleans it
    const t = await post(s, { date: '2026-06-15', published: true }, { file: PNGF, file2: JPGF });
    assert.equal(t.status, 201);
    assert.deepEqual(s.db.prepare('SELECT menu_date FROM daily_menus').all().map((r) => r.menu_date), ['2026-06-15']);
    assert.equal(s.uploads().length, 2); assert.equal(filesCount(s), 2);
    assert.ok(!s.uploads().includes(name(old))); assert.ok(!s.uploads().includes(name(old.file2)));
    assert.ok(!s.uploads().includes(name(old.fileEn2))); assert.ok(!s.uploads().includes(old.fileEnUrl.split('/').pop()));
    // PUT with only a second file also triggers cleanup of a seeded past menu with second pages
    const mk = (n, ext) => {
      fs.writeFileSync(path.join(s.dataDir, 'uploads', `${n.repeat(32)}.${ext}`), 'x');
      return Number(s.db.prepare("INSERT INTO files(stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?, 'o.pdf', 'application/pdf', 1, 1)").run(`${n.repeat(32)}.${ext}`).lastInsertRowid);
    };
    s.db.prepare('INSERT INTO daily_menus(menu_date, file_id, file_en_id, file2_id, file2_en_id, published, created_at, updated_at) VALUES (?,?,?,?,?,1,1,1)')
      .run('2026-06-10', mk('a', 'pdf'), mk('b', 'pdf'), mk('c', 'pdf'), mk('d', 'pdf'));
    assert.equal(s.uploads().length, 6);
    assert.equal((await put(s, t.data.id, {}, { file2: WEBPF })).status, 200);
    assert.deepEqual(s.db.prepare('SELECT menu_date FROM daily_menus').all().map((r) => r.menu_date), ['2026-06-15']);
    assert.equal(s.uploads().length, 2); assert.equal(filesCount(s), 2);
  } finally { await s.close(); }
});

test('orphan sweep after a restart keeps second pages of both languages and still removes unreferenced files', async () => {
  const s = await loggedIn();
  const dataDir = s.dataDir;
  let names;
  try {
    const d = (await post(s, { date: '2026-06-15', published: true }, { file: PNGF, file2: JPGF, fileEn: PDFF, fileEn2: WEBPF })).data;
    names = [name(d), name(d.file2), d.fileEnUrl.split('/').pop(), name(d.fileEn2)].sort();
    fs.writeFileSync(path.join(dataDir, 'uploads', 'e'.repeat(32) + '.png'), 'x');
    s.db.prepare("INSERT INTO files(stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?, 'o.png', 'image/png', 1, 1)").run('e'.repeat(32) + '.png');
  } finally { await s.close(false); }
  const s2 = await startApp({ dataDir });
  try {
    await sleep(300);
    assert.deepEqual(s2.uploads().sort(), names);
    assert.equal(s2.db.prepare('SELECT COUNT(*) n FROM files').get().n, 4);
    const m = s2.db.prepare('SELECT * FROM daily_menus').get();
    assert.ok(m.file2_id && m.file2_en_id);
    assert.equal((await fetch(s2.base + '/media/' + names.find((n) => n.endsWith('.webp')))).status, 200);
  } finally { await s2.close(); }
});

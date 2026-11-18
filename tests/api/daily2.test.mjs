// T-62 (D-62): daily menu second page per language, /media visibility, PUT end-state rules, upload validation, cleanup. Port 3207.
// Clock: KOTA_NOW 2026-06-15T10:00:00Z = Sofia 13:00 on 2026-06-15.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, createAdmin, Client, tmpDir, makePng, PDF, JPG, WEBP, sleep } from '../lib/harness.mjs';

const PORT = 3207;
const T0 = '2026-06-15T10:00:00Z';
const TODAY = '2026-06-15'; const TOMORROW = '2026-06-16';
const MB = 1024 * 1024;
const mp = (fields, files = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  for (const x of files) fd.append(x.field, new Blob([x.buf], { type: x.type }), x.name);
  return fd;
};
const F = (field, buf, name, type) => ({ field, buf, name, type });
const png = (c) => makePng(30, 20, c);
const mkPng = (field, c, name) => F(field, png(c), name || `${field}.png`, 'image/png');
const D = '/api/admin/daily-menus';

describe('daily menu second page (D-62)', () => {
  let dir; let srv; let admin; let anon;
  const up = () => fs.readdirSync(path.join(dir, 'uploads')).sort();
  const tmp = () => fs.readdirSync(path.join(dir, 'tmp'));
  const tmpEmpty = async () => { for (let i = 0; i < 30 && tmp().length; i++) await sleep(100); return tmp(); };
  const dbq = (sql) => { const d = new DatabaseSync(path.join(dir, 'kota.db'), { readOnly: true }); try { return d.prepare(sql).all(); } finally { d.close(); } };
  const mk = (date, published, files, extra = {}) => admin.post(D, { form: mp({ date, published, ...extra }, files) });
  const wipe = async () => { for (const m of (await admin.get(D)).data.menus) await admin.del(`${D}/${m.id}`); };
  const pub = async (lang) => (await anon.get(`/api/public/daily-menu?lang=${lang}`)).data;
  const mediaOf = (o) => (o ? o.fileUrl.replace('/api/admin/media', '/media') : null);

  before(async () => { dir = tmpDir('daily2'); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('DS1 migration 009 applied; POST with 4 files -> 201, admin item has file2/fileEn2 objects (same shape as file), 4 files on disk, 4 rows', async () => {
    assert.ok(dbq('SELECT name FROM schema_migrations').some((r) => r.name === '009_daily_second_page.sql'));
    assert.deepEqual(dbq("SELECT name FROM pragma_table_info('daily_menus')").map((r) => r.name).filter((n) => /file2/.test(n)).sort(), ['file2_en_id', 'file2_id']);
    const r = await mk(TODAY, 'false', [mkPng('file', [1, 0, 0], 'bg1.png'), F('file2', JPG, 'bg2.jpg', 'image/jpeg'), F('fileEn', PDF, 'en1.pdf', 'application/pdf'), F('fileEn2', WEBP, 'en2.webp', 'image/webp')]);
    assert.equal(r.status, 201, r.text());
    const d = r.data;
    assert.equal(d.originalName, 'bg1.png'); assert.equal(d.kind, 'image');
    assert.deepEqual(Object.keys(d.file2).sort(), ['fileUrl', 'kind', 'mimeType', 'originalName', 'sizeBytes']);
    assert.equal(d.file2.originalName, 'bg2.jpg'); assert.equal(d.file2.mimeType, 'image/jpeg'); assert.equal(d.file2.kind, 'image'); assert.equal(d.file2.sizeBytes, JPG.length);
    assert.equal(d.fileEn2.originalName, 'en2.webp'); assert.equal(d.fileEn2.mimeType, 'image/webp');
    assert.equal(d.kindEn, 'pdf');
    assert.match(d.file2.fileUrl, /^\/api\/admin\/media\/[0-9a-f]{32}\.jpg$/);
    assert.equal(up().length, 4); assert.equal(dbq('SELECT COUNT(*) n FROM files')[0].n, 4);
    const list = (await admin.get(D)).data.menus; assert.equal(list.length, 1); assert.equal(list[0].file2.originalName, 'bg2.jpg'); assert.equal(list[0].fileEn2.originalName, 'en2.webp');
    assert.equal((await admin.get(d.file2.fileUrl)).status, 200, 'admin media serves the unpublished second page');
    assert.equal((await admin.get(d.fileEn2.fileUrl)).status, 200);
    await wipe();
    assert.deepEqual(up(), [], 'DELETE removes all 4 files'); assert.equal(dbq('SELECT COUNT(*) n FROM files')[0].n, 0);
  });

  test('DS2 menus without second files: file2/fileEn2 are null (admin) and public files has exactly 1 item equal to the legacy fields', async () => {
    const r = await mk(TODAY, 'true', [mkPng('file', [2, 0, 0])]); assert.equal(r.status, 201);
    assert.equal(r.data.file2, null); assert.equal(r.data.fileEn2, null);
    for (const lang of ['bg', 'en']) {
      const m = (await pub(lang)).menu; assert.equal(m.files.length, 1, lang); assert.equal(m.files[0].fileUrl, m.fileUrl); assert.equal(m.files[0].kind, m.kind); assert.equal(m.files[0].mimeType, m.mimeType);
    }
    await wipe();
  });

  test('DS3 POST validation: file2 without file -> 400 fields.file2; fileEn2 without fileEn -> 400 fields.fileEn2; file2 with only fileEn -> 400 file2; nothing stored', async () => {
    const cases = [
      ['file2 alone', [mkPng('file2', [3, 0, 0])], 'file', 'file2'],
      ['fileEn2 alone', [mkPng('fileEn2', [3, 0, 1])], 'file', 'fileEn2'],
      ['file2 + fileEn (BG first missing)', [mkPng('file2', [3, 0, 2]), mkPng('fileEn', [3, 0, 3])], 'file2'],
      ['fileEn2 + file (EN first missing)', [mkPng('fileEn2', [3, 0, 4]), mkPng('file', [3, 0, 5])], 'fileEn2'],
      ['file + fileEn2 + file2 (EN first missing only)', [mkPng('file', [3, 0, 6]), mkPng('file2', [3, 0, 7]), mkPng('fileEn2', [3, 0, 8])], 'fileEn2'],
    ];
    for (const [label, files, ...keys] of cases) {
      const r = await mk(TOMORROW, 'false', files);
      assert.equal(r.status, 400, `${label}: ${r.status} ${r.text()}`); assert.equal(r.data.error, 'validation', label);
      for (const k of keys) assert.ok(r.data.fields?.[k], `${label}: fields.${k} in ${JSON.stringify(r.data.fields)}`);
    }
    assert.deepEqual(up(), []); assert.equal(dbq('SELECT COUNT(*) n FROM daily_menus')[0].n, 0); assert.deepEqual(await tmpEmpty(), []);
  });

  test('DS4 /media visibility of ALL 4 files: unpublished-today 404, published-tomorrow 404, published-today 200 (anon), admin media always 200; unpublish again -> 404', async () => {
    const files = [mkPng('file', [4, 0, 0]), mkPng('file2', [4, 0, 1]), F('fileEn', JPG, 'e1.jpg', 'image/jpeg'), F('fileEn2', WEBP, 'e2.webp', 'image/webp')];
    let m = (await mk(TODAY, 'false', files)).data;
    const objs = [m, m.file2, { fileUrl: m.fileEnUrl }, m.fileEn2];
    const status = async (u) => (await anon.get(u)).status;
    const allSt = async () => Promise.all(objs.map((o) => status(mediaOf(o))));
    assert.deepEqual(await allSt(), [404, 404, 404, 404], 'unpublished (today)');
    for (const o of objs) assert.equal((await admin.get(o.fileUrl)).status, 200, 'admin media');
    // published but dated tomorrow
    m = (await admin.put(`${D}/${m.id}`, { form: mp({ published: 'true', date: TOMORROW }) })).data; assert.equal(m.published, true); assert.equal(m.date, TOMORROW);
    assert.deepEqual(await allSt(), [404, 404, 404, 404], 'published, other day (tomorrow)');
    assert.equal((await pub('bg')).menu, null);
    // published today
    m = (await admin.put(`${D}/${m.id}`, { form: mp({ date: TODAY }) })).data; assert.equal(m.date, TODAY);
    assert.deepEqual(await allSt(), [200, 200, 200, 200], 'published today');
    for (const o of objs) { const r = await anon.get(mediaOf(o)); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); }
    // unpublish via PATCH
    await admin.patch(`${D}/${m.id}/published`, { json: { published: false } });
    assert.deepEqual(await allSt(), [404, 404, 404, 404], 'unpublished again');
    // republish, then move the clock to the next Sofia day: the menu is no longer "today"
    await admin.patch(`${D}/${m.id}/published`, { json: { published: true } });
    assert.deepEqual(await allSt(), [200, 200, 200, 200]);
    const objsUrl = objs.map(mediaOf);
    await srv.stop(); srv = await startServer({ port: PORT, dataDir: dir, now: '2026-06-15T21:00:00Z' }); // Sofia 00:00 on 06-16
    admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url);
    assert.deepEqual(await Promise.all(objsUrl.map(status)), [404, 404, 404, 404], 'next Sofia day: second files hidden too');
    await srv.stop(); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url);
    assert.deepEqual(await Promise.all(objsUrl.map(status)), [200, 200, 200, 200]);
    // a stored file name of a second file requested with a wrong extension or traversal never serves
    assert.equal((await anon.get(objsUrl[1].replace(/\.\w+$/, '.svg'))).status, 404);
    await wipe();
  });

  test('DS5 public menu.files: one language per menu, no mixing, fallback per menu; order kept; fileUrl === files[0]', async () => {
    const BG = [mkPng('file', [5, 0, 0], 'b1.png'), mkPng('file2', [5, 0, 1], 'b2.png')];
    const EN = [mkPng('fileEn', [5, 0, 2], 'e1.png'), mkPng('fileEn2', [5, 0, 3], 'e2.png')];
    // both languages, 2 pages each
    let m = (await mk(TODAY, 'true', [...BG, ...EN])).data;
    let bg = (await pub('bg')).menu; let en = (await pub('en')).menu;
    assert.deepEqual(bg.files.map((x) => x.fileUrl), [mediaOf(m), mediaOf(m.file2)]); assert.deepEqual(en.files.map((x) => x.fileUrl), [mediaOf({ fileUrl: m.fileEnUrl }), mediaOf(m.fileEn2)]);
    assert.equal(bg.fileUrl, bg.files[0].fileUrl); assert.equal(en.fileUrl, en.files[0].fileUrl);
    assert.deepEqual(Object.keys(bg.files[0]).sort(), ['fileUrl', 'kind', 'mimeType']);
    assert.equal((await anon.get('/api/public/daily-menu')).data.menu?.files.length, 2, 'no lang param -> default language, both pages');
    await wipe();
    // BG: 1 page, EN: 2 pages -> bg=1, en=2 (never mixed)
    m = (await mk(TODAY, 'true', [BG[0], ...EN])).data;
    bg = (await pub('bg')).menu; en = (await pub('en')).menu;
    assert.equal(bg.files.length, 1); assert.equal(bg.files[0].fileUrl, mediaOf(m)); assert.equal(en.files.length, 2);
    await wipe();
    // BG only, 2 pages: EN request falls back to BG, both pages
    m = (await mk(TODAY, 'true', BG)).data;
    en = (await pub('en')).menu; assert.deepEqual(en.files.map((x) => x.fileUrl), [mediaOf(m), mediaOf(m.file2)], 'EN request falls back to both BG pages');
    await wipe();
    // EN only, 2 pages: BG request falls back to EN (both pages)
    m = (await mk(TODAY, 'true', EN)).data;
    bg = (await pub('bg')).menu; assert.equal(bg.files.length, 2); assert.deepEqual(bg.files.map((x) => x.fileUrl), [mediaOf({ fileUrl: m.fileEnUrl }), mediaOf(m.fileEn2)]);
    assert.equal(bg.fileUrl, bg.files[0].fileUrl);
    await wipe();
    // image + PDF
    m = (await mk(TODAY, 'true', [mkPng('file', [5, 1, 0]), F('file2', PDF, 'menu.pdf', 'application/pdf')])).data;
    bg = (await pub('bg')).menu; assert.deepEqual(bg.files.map((x) => x.kind), ['image', 'pdf']);
    assert.equal((await anon.get(bg.files[1].fileUrl)).headers.get('content-type'), 'application/pdf');
    // not published -> null (no leak of files[])
    await admin.patch(`${D}/${m.id}/published`, { json: { published: false } });
    assert.equal((await pub('bg')).menu, null);
    await wipe();
  });

  test('DS6 PUT end-state rules (D-62)', async () => {
    const ALL = [mkPng('file', [6, 0, 0], 'b1.png'), mkPng('file2', [6, 0, 1], 'b2.png'), mkPng('fileEn', [6, 0, 2], 'e1.png'), mkPng('fileEn2', [6, 0, 3], 'e2.png')];
    let m = (await mk(TODAY, 'false', ALL)).data;
    const get = async () => (await admin.get(D)).data.menus.find((x) => x.id === m.id);
    const put = (fields, files = []) => admin.put(`${D}/${m.id}`, { form: mp(fields, files) });
    // removing EN first while EN second stays -> 400 fields.fileEn2, nothing changed
    let r = await put({ removeFileEn: 'true' }); assert.equal(r.status, 400); assert.equal(r.data.error, 'validation'); assert.ok(r.data.fields.fileEn2, JSON.stringify(r.data));
    let g = await get(); assert.ok(g.fileEnUrl && g.fileEn2, 'unchanged after the rejected PUT'); assert.equal(up().length, 4);
    // removing BG first: not possible via flag (no removeFile); an unknown remove flag is ignored
    r = await put({ removeFile: 'true' }); assert.equal(r.status, 200); assert.ok((await get()).file2);
    // remove only the second EN page -> ok, file deleted from disk
    const en2Name = path.basename(g.fileEn2.fileUrl);
    r = await put({ removeFileEn2: 'true' }); assert.equal(r.status, 200); assert.equal(r.data.fileEn2, null); assert.ok(r.data.fileEnUrl);
    assert.ok(!up().includes(en2Name), 'second EN file removed from disk'); assert.equal(up().length, 3);
    // removing EN first now fine
    r = await put({ removeFileEn: 'true' }); assert.equal(r.status, 200); assert.equal(r.data.fileEnUrl, null); assert.equal(up().length, 2);
    // add a second EN page without any EN first -> 400 fields.fileEn2
    r = await put({}, [mkPng('fileEn2', [6, 1, 0])]); assert.equal(r.status, 400); assert.ok(r.data.fields.fileEn2); assert.equal(up().length, 2); assert.deepEqual(await tmpEmpty(), []);
    // EN first + second in one request: ok
    r = await put({}, [mkPng('fileEn', [6, 1, 1]), mkPng('fileEn2', [6, 1, 2])]); assert.equal(r.status, 200); assert.ok(r.data.fileEnUrl && r.data.fileEn2); assert.equal(up().length, 4);
    // remove both EN pages in one request: ok
    r = await put({ removeFileEn: 'true', removeFileEn2: 'true' }); assert.equal(r.status, 200); assert.equal(r.data.fileEnUrl, null); assert.equal(r.data.fileEn2, null); assert.equal(up().length, 2);
    // an uploaded field wins over its remove flag
    r = await put({ removeFile2: 'true' }, [mkPng('file2', [6, 2, 0], 'b2new.png')]); assert.equal(r.status, 200); assert.equal(r.data.file2.originalName, 'b2new.png'); assert.equal(up().length, 2, 'old second page replaced and deleted');
    // replacing a second page deletes the old file and serves the new one
    const old2 = path.basename(r.data.file2.fileUrl);
    r = await put({}, [mkPng('file2', [6, 2, 1], 'b2newer.png')]); assert.equal(r.status, 200); assert.ok(!up().includes(old2)); assert.equal(r.data.file2.originalName, 'b2newer.png'); assert.equal(up().length, 2);
    // remove the BG second page; removing it again (no second page) is a no-op 200
    r = await put({ removeFile2: 'true' }); assert.equal(r.status, 200); assert.equal(r.data.file2, null); assert.equal(up().length, 1);
    r = await put({ removeFile2: 'true', removeFileEn2: 'true', removeFileEn: 'true' }); assert.equal(r.status, 200);
    // replacing the BG first page keeps (and does not touch) the second page
    r = await put({}, [mkPng('file2', [6, 3, 0], 'keep2.png')]); assert.equal(r.status, 200); const keep2 = path.basename(r.data.file2.fileUrl);
    r = await put({}, [mkPng('file', [6, 3, 1], 'b1new.png')]); assert.equal(r.status, 200); assert.equal(r.data.originalName, 'b1new.png'); assert.equal(path.basename(r.data.file2.fileUrl), keep2); assert.equal(up().length, 2);
    await wipe(); assert.deepEqual(up(), []);

    // EN-only menu: removing its only first page leaves no file at all -> 400 fields.fileEn (also with the second removed or kept)
    m = (await mk(TODAY, 'false', [mkPng('fileEn', [6, 4, 0]), mkPng('fileEn2', [6, 4, 1])])).data; assert.equal(up().length, 2);
    r = await put({ removeFileEn: 'true' }); assert.equal(r.status, 400); assert.ok(r.data.fields.fileEn, JSON.stringify(r.data.fields));
    r = await put({ removeFileEn: 'true', removeFileEn2: 'true' }); assert.equal(r.status, 400); assert.ok(r.data.fields.fileEn, JSON.stringify(r.data.fields));
    assert.equal(up().length, 2, 'rejected PUTs delete nothing'); assert.equal(dbq('SELECT COUNT(*) n FROM files')[0].n, 2);
    // second BG page on an EN-only menu -> 400 fields.file2
    r = await put({}, [mkPng('file2', [6, 4, 2])]); assert.equal(r.status, 400); assert.ok(r.data.fields.file2); assert.equal(up().length, 2); assert.deepEqual(await tmpEmpty(), []);
    // BG first + second added together to an EN-only menu: ok
    r = await put({}, [mkPng('file', [6, 4, 3]), mkPng('file2', [6, 4, 4])]); assert.equal(r.status, 200); assert.equal(up().length, 4);
    // now removing EN first + second is fine (BG remains)
    r = await put({ removeFileEn: 'true', removeFileEn2: 'true' }); assert.equal(r.status, 200); assert.equal(up().length, 2);
    // unknown id -> 404; remove flags are booleans only ('1' not accepted => treated as false and ignored)
    assert.equal((await admin.put(`${D}/999999`, { form: mp({ removeFile2: 'true' }) })).status, 404);
    r = await put({ removeFile2: 'yes' }); assert.equal(r.status, 200); assert.ok(r.data.file2, 'non-boolean remove flag does not remove');
    await wipe(); assert.deepEqual(up(), []);
  });

  test('DS7 replace-on-POST (replace=true) removes ALL old files incl. second pages and stores the new set', async () => {
    const a = (await mk(TODAY, 'false', [mkPng('file', [7, 0, 0]), mkPng('file2', [7, 0, 1]), mkPng('fileEn', [7, 0, 2]), mkPng('fileEn2', [7, 0, 3])])).data; assert.equal(up().length, 4);
    let r = await mk(TODAY, 'false', [mkPng('file', [7, 1, 0])]); assert.equal(r.status, 409); assert.equal(r.data.error, 'date_exists'); assert.equal(up().length, 4, '409 stores nothing');
    r = await mk(TODAY, 'true', [mkPng('file', [7, 1, 1]), mkPng('file2', [7, 1, 2])], { replace: 'true' }); assert.equal(r.status, 200); assert.equal(r.data.id, a.id);
    assert.equal(r.data.fileEn2, null); assert.equal(r.data.fileEnUrl, null); assert.ok(r.data.file2);
    assert.equal(up().length, 2); assert.equal(dbq('SELECT COUNT(*) n FROM files')[0].n, 2);
    await wipe();
  });

  test('DS8 spoofed / oversize second files: 415 / 413 with the offending field, nothing stored, tmp empty (all four fields)', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 1)]);
    const base = (extra) => [mkPng('file', [8, 0, 0], 'ok1.png'), mkPng('fileEn', [8, 0, 1], 'ok2.png'), ...extra];
    const spoofs = [
      ['file2', html, 'x.png', 'image/png'], ['file2', svg, 'x.svg', 'image/svg+xml'], ['file2', svg, 'x.png', 'image/png'], ['file2', exe, 'x.pdf', 'application/pdf'], ['file2', PDF.subarray(0, 3), 'x.pdf', 'application/pdf'],
      ['fileEn2', html, 'x.jpg', 'image/jpeg'], ['fileEn2', exe, 'x.png', 'image/png'], ['fileEn2', Buffer.alloc(0), 'empty.png', 'image/png'], ['fileEn2', Buffer.from('GIF89a' + 'x'.repeat(50)), 'x.png', 'image/gif'],
    ];
    for (const [field, buf, name, type] of spoofs) {
      const r = await mk(TODAY, 'true', base([F(field, buf, name, type)]));
      assert.ok([400, 415].includes(r.status), `POST ${field} ${name}: ${r.status}`);
      if (r.status === 415) { assert.equal(r.data.error, 'unsupported_type'); assert.ok(r.data.fields?.[field], `POST ${field}: fields ${JSON.stringify(r.data.fields)}`); }
      assert.deepEqual(up(), [], `POST ${field} ${name} leaves no file`); assert.equal(dbq('SELECT COUNT(*) n FROM daily_menus')[0].n, 0);
    }
    // the 415 cases are really 415 for the plain-spoof ones
    for (const field of ['file2', 'fileEn2']) { const r = await mk(TODAY, 'true', base([F(field, html, 'x.png', 'image/png')])); assert.equal(r.status, 415, field); assert.equal(r.data.fields[field].length > 0, true); }
    // PUT on an existing menu: spoofed second files leave the menu and the disk untouched
    const m = (await mk(TODAY, 'true', [mkPng('file', [8, 1, 0]), mkPng('fileEn', [8, 1, 1])])).data; assert.equal(up().length, 2);
    for (const field of ['file2', 'fileEn2']) {
      const r = await admin.put(`${D}/${m.id}`, { form: mp({}, [F(field, html, 'x.png', 'image/png')]) });
      assert.equal(r.status, 415, `PUT ${field}`); assert.ok(r.data.fields[field]);
    }
    assert.equal(up().length, 2); assert.deepEqual(await tmpEmpty(), []);
    // oversize: 50 MB + 1 -> 413 with fields.<field>; exactly 50 MB accepted
    const big = (head, n) => { const b = Buffer.alloc(n); head.copy(b); return b; };
    const PNGH = png([9, 9, 9]).subarray(0, 8);
    for (const field of ['file2', 'fileEn2']) {
      let r = await admin.put(`${D}/${m.id}`, { form: mp({}, [F(field, big(PNGH, 50 * MB + 1), 'big.png', 'image/png')]) });
      assert.equal(r.status, 413, `PUT ${field} 50MB+1: ${r.status}`); assert.equal(r.data.error, 'file_too_large'); assert.ok(r.data.fields?.[field], JSON.stringify(r.data));
      assert.equal(up().length, 2); assert.deepEqual(await tmpEmpty(), []);
      r = await mk(TOMORROW, 'false', [mkPng('file', [8, 2, 0]), mkPng('fileEn', [8, 2, 1]), F(field, big(PNGH, 50 * MB + 1), 'big.png', 'image/png')]);
      assert.equal(r.status, 413, `POST ${field} 50MB+1: ${r.status}`); assert.ok(r.data.fields?.[field]);
      assert.equal(up().length, 2, 'no partial store of the other (valid) files'); assert.deepEqual(await tmpEmpty(), []);
      assert.equal(dbq('SELECT COUNT(*) n FROM daily_menus')[0].n, 1);
    }
    const ok50 = await admin.put(`${D}/${m.id}`, { form: mp({}, [F('file2', big(PNGH, 50 * MB), 'edge.png', 'image/png')]) }); assert.equal(ok50.status, 200, 'exactly 50 MB accepted');
    assert.equal(ok50.data.file2.sizeBytes, 50 * MB);
    // a file field that is not one of the four -> 400, nothing stored
    const x = await admin.put(`${D}/${m.id}`, { form: mp({}, [mkPng('file3', [9, 0, 0])]) }); assert.equal(x.status, 400, 'unexpected field name');
    // two files for the same field -> rejected, nothing stored
    const fd = mp({ date: TOMORROW }, [mkPng('file2', [9, 0, 1]), mkPng('file2', [9, 0, 2])]);
    const dup = await admin.post(D, { form: fd }); assert.ok(dup.status >= 400 && dup.status < 500, `duplicate field ${dup.status}`);
    assert.deepEqual(await tmpEmpty(), []);
    await wipe(); assert.deepEqual(up(), []);
  });

  test('DS9 auth + CSRF still enforced for the new fields and for second-page media in the admin API', async () => {
    const m = (await mk(TODAY, 'false', [mkPng('file', [10, 0, 0]), mkPng('file2', [10, 0, 1])])).data;
    const form = () => mp({ date: TOMORROW }, [mkPng('file', [10, 1, 0]), mkPng('file2', [10, 1, 1])]);
    assert.equal((await anon.post(D, { form: form() })).status, 401);
    assert.equal((await anon.put(`${D}/${m.id}`, { form: mp({ removeFile2: 'true' }) })).status, 401);
    assert.equal((await anon.get(m.file2.fileUrl)).status, 401, 'admin media of a second page needs a session');
    assert.equal((await admin.post(D, { form: form(), csrf: false })).status, 403, 'CSRF header missing');
    assert.equal((await admin.put(`${D}/${m.id}`, { form: mp({ removeFile2: 'true' }), csrf: false })).status, 403);
    assert.equal((await admin.post(D, { form: form(), origin: 'https://evil.example' })).status, 403, 'foreign origin');
    assert.ok((await admin.get(D)).data.menus[0].file2, 'rejected requests changed nothing');
    assert.equal(up().length, 2);
    await wipe();
  });

  test('DS10 original names of second files: server strips markup-significant characters (< > " : * ? |) and any path; harmless entities stay verbatim; stored names are random hex', async () => {
    const evil = '<img src=x onerror=alert(1)>.png';
    const ent = '&lt;img src=x onerror=alert(1)&gt;\'x.png';
    const m = (await mk(TODAY, 'false', [mkPng('file', [11, 0, 0], 'a.png'), mkPng('file2', [11, 0, 1], evil), mkPng('fileEn', [11, 0, 2], 'b.png'), mkPng('fileEn2', [11, 0, 3], '../../etc/<b>x</b>.png')])).data;
    assert.equal(m.file2.originalName, '_img src=x onerror=alert(1)_.png', 'D-62 second file name sanitised like the first');
    assert.doesNotMatch(m.fileEn2.originalName, /[<>"\\/]/, m.fileEn2.originalName);
    assert.doesNotMatch(m.fileEn2.fileUrl, /\.\./); assert.match(m.fileEn2.fileUrl, /^\/api\/admin\/media\/[0-9a-f]{32}\.png$/);
    assert.ok(up().every((n) => /^[0-9a-f]{32}\.(png|jpg|webp|pdf)$/.test(n)), up().join());
    const r = await admin.put(`${D}/${m.id}`, { form: mp({}, [mkPng('file2', [11, 1, 0], ent)]) }); assert.equal(r.status, 200);
    assert.equal(r.data.file2.originalName, ent, 'entity text with quotes-free content stored verbatim (the UI must render it as text)');
    await wipe();
  });

  test('DS11 D-45 cleanup of a past menu removes ALL 4 files from disk and DB rows; the sweep keeps second files of live menus', async () => {
    await wipe();
    // old menu (today 06-15), 4 files
    const old = (await mk(TODAY, 'true', [mkPng('file', [12, 0, 0]), mkPng('file2', [12, 0, 1]), mkPng('fileEn', [12, 0, 2]), mkPng('fileEn2', [12, 0, 3])])).data;
    assert.equal(up().length, 4);
    const oldNames = up();
    // a menu for tomorrow with 4 files stays when the clock moves to 06-16 and an upload triggers the cleanup
    const next = (await mk(TOMORROW, 'false', [mkPng('file', [12, 1, 0]), mkPng('file2', [12, 1, 1]), mkPng('fileEn', [12, 1, 2]), mkPng('fileEn2', [12, 1, 3])])).data;
    assert.equal(up().length, 8);
    await srv.stop(); srv = await startServer({ port: PORT, dataDir: dir, now: '2026-06-16T10:00:00Z' }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url);
    assert.equal(up().length, 8, 'the clock alone deletes nothing');
    // upload triggers the cleanup
    const r = await mk('2026-06-20', 'false', [mkPng('file', [12, 2, 0])]); assert.equal(r.status, 201);
    assert.deepEqual(dbq('SELECT menu_date d FROM daily_menus ORDER BY menu_date').map((x) => x.d), [TOMORROW, '2026-06-20']);
    for (const n of oldNames) assert.ok(!up().includes(n), `old file ${n} removed from disk`);
    assert.equal(up().length, 5, '4 (next) + 1 (new); all 4 files of the past menu are gone');
    assert.equal(dbq('SELECT COUNT(*) n FROM files')[0].n, 5);
    assert.deepEqual(await tmpEmpty(), []);
    // orphan sweep (startup): a restart does not delete live second-page files
    await srv.stop(); srv = await startServer({ port: PORT, dataDir: dir, now: '2026-06-16T10:00:00Z' }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url);
    const g = (await admin.get(D)).data.menus.find((x) => x.id === next.id);
    assert.equal((await admin.get(g.file2.fileUrl)).status, 200); assert.equal((await admin.get(g.fileEn2.fileUrl)).status, 200);
    assert.equal(up().length, 5);
    // an orphaned file row (no references) IS swept at startup while second-page files are not: insert one directly
    const dbw = new DatabaseSync(path.join(dir, 'kota.db')); const orphan = 'f'.repeat(32) + '.png';
    dbw.prepare('INSERT INTO files(stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?)').run(orphan, 'orphan.png', 'image/png', 10, 1); dbw.close();
    fs.writeFileSync(path.join(dir, 'uploads', orphan), 'x');
    await srv.stop(); srv = await startServer({ port: PORT, dataDir: dir, now: '2026-06-16T10:00:00Z' }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url);
    await sleep(500);
    assert.ok(!up().includes(orphan), 'unreferenced file swept'); assert.equal(up().length, 5, 'second-page files of live menus survived the sweep');
    // deleting the future menu removes all its files
    assert.equal((await admin.del(`${D}/${next.id}`)).status, 204); assert.equal(up().length, 1);
    await wipe();
  });
});

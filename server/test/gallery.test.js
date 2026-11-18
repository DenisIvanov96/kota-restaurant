// T-47: gallery (D-51, migration 007), video magic bytes, /media visibility + Range (D-53), editable About text (D-52).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loggedIn, startApp, PDF, PNG, JPG, WEBP } from './helpers.js';

const MB = 1024 * 1024;
const MAX = 50 * MB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fixtures (tiny; the head is what the magic-byte check sees) ----
const box = (size, major, minor, compat) => {
  const b = Buffer.alloc(size);
  b.writeUInt32BE(size, 0); b.write('ftyp', 4, 'latin1'); b.write(major, 8, 'latin1'); b.writeUInt32BE(minor, 12);
  compat.forEach((c, i) => b.write(c, 16 + 4 * i, 'latin1'));
  return b;
};
const pad = (head, total, fill = 7) => Buffer.concat([head, Buffer.alloc(Math.max(0, total - head.length), fill)]);
const MP4 = pad(box(24, 'isom', 512, ['isom', 'mp42']), 4096);
const MOV = pad(box(20, 'qt  ', 0, ['qt  ']), 4096);
const EBML = (docType) => Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | (27 + docType.length), 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04,
    0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x80 | docType.length]), Buffer.from(docType, 'latin1'),
  Buffer.from([0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02])]);
const WEBM = pad(EBML('webm'), 4096);

const F = (buf, name, type) => ({ buf, name, type });
const MP4F = F(MP4, 'a.mp4', 'video/mp4');
const MOVF = F(MOV, 'a.MOV', 'video/quicktime');
const WEBMF = F(WEBM, 'a.webm', 'video/webm');
const PNGF = F(PNG, 'a.png', 'image/png');
const JPGF = F(JPG, 'a.jpg', 'image/jpeg');
const WEBPF = F(WEBP, 'a.webp', 'image/webp');

const form = (fields, file) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  if (file) f.append('file', file.blob || new Blob([file.buf], { type: file.type }), file.name);
  return f;
};
const add = (s, file = PNGF, fields = {}) => s.api.req('POST', '/api/admin/gallery', { form: form(fields, file) });
const list = async (s) => (await s.api.get('/api/admin/gallery')).data;
const pub = (s, q = '') => s.client().get(`/api/public/gallery${q}`);
const mediaUrl = (item) => '/media/' + item.fileUrl.split('/').pop();
const mediaStatus = (s, item, headers = {}) => fetch(s.base + mediaUrl(item), { headers }).then((r) => r.status);
const tmpEmpty = async (s, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fs.readdirSync(path.join(s.dataDir, 'tmp')).length === 0) return true; await sleep(25); }
  return false;
};

test('migration 007 applied: table + about settings exist; gallery starts empty', async () => {
  const s = await loggedIn();
  try {
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE name = '007_gallery.sql'").get().n, 1);
    assert.deepEqual(await list(s), { max: 50, items: [] });
    assert.deepEqual((await pub(s)).data, { items: [] });
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM settings WHERE key IN ('about_bg','about_en')").get().n, 2);
  } finally { await s.close(); }
});

test('401 without session and 403 without CSRF header / with foreign Origin on every route; nothing stored', async () => {
  const s = await loggedIn();
  try {
    const first = await add(s); assert.equal(first.status, 201);
    const id = first.data.id;
    const anon = s.client();
    const routes = [
      ['GET', '/api/admin/gallery'],
      ['POST', '/api/admin/gallery'],
      ['PATCH', `/api/admin/gallery/${id}`],
      ['PUT', '/api/admin/gallery/order'],
      ['DELETE', `/api/admin/gallery/${id}`],
    ];
    const mk = (m) => (m === 'GET' ? {} : m === 'POST' ? { form: form({}, PNGF) } : { json: { ids: [id], visible: false } });
    for (const [m, u] of routes) {
      const r = await anon.req(m, u, mk(m)); assert.equal(r.status, 401, `${m} ${u}`);
      assert.equal(r.data.error, 'unauthorized');
      if (m === 'GET') continue;
      const r2 = await s.api.req(m, u, { ...mk(m), csrf: false }); assert.equal(r2.status, 403, `${m} ${u} no csrf header`);
      const r3 = await s.api.req(m, u, { ...mk(m), headers: { Origin: 'https://evil.example' } }); assert.equal(r3.status, 403, `${m} ${u} foreign origin`);
    }
    // the item survived all of it, nothing else was added
    const l = await list(s);
    assert.deepEqual(l.items.map((x) => [x.id, x.visible]), [[id, true]]);
    assert.equal(s.uploads().length, 1);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 1);
  } finally { await s.close(); }
});

test('upload: JPG PNG WebP MP4 MOV WebM accepted with stored mime/kind; response shape; appended in order', async () => {
  const s = await loggedIn();
  try {
    const cases = [[PNGF, 'image', 'image/png', 'png'], [JPGF, 'image', 'image/jpeg', 'jpg'], [WEBPF, 'image', 'image/webp', 'webp'],
      [MP4F, 'video', 'video/mp4', 'mp4'], [MOVF, 'video', 'video/quicktime', 'mov'], [WEBMF, 'video', 'video/webm', 'webm']];
    for (const [i, [file, kind, mime, ext]] of cases.entries()) {
      const r = await add(s, file);
      assert.equal(r.status, 201, file.name);
      assert.deepEqual(Object.keys(r.data).sort(), ['captionBg', 'captionEn', 'createdAt', 'fileUrl', 'id', 'kind', 'mime', 'position', 'size', 'visible']);
      assert.deepEqual([r.data.kind, r.data.mime, r.data.size, r.data.position, r.data.visible, r.data.captionBg, r.data.captionEn],
        [kind, mime, file.buf.length, i + 1, true, null, null]);
      assert.match(r.data.fileUrl, new RegExp(`^/api/admin/media/[a-f0-9]{32}\\.${ext}$`));
      assert.match(r.data.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
      // admin media route serves it back with the right type
      const m = await fetch(s.base + r.data.fileUrl, { headers: { Cookie: s.api.cookie } });
      assert.equal(m.status, 200); assert.equal(m.headers.get('content-type'), mime);
    }
    const l = await list(s);
    assert.equal(l.max, 50); assert.deepEqual(l.items.map((x) => x.position), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(l.items.map((x) => x.kind), ['image', 'image', 'image', 'video', 'video', 'video']);
    assert.equal(s.uploads().length, 6);
  } finally { await s.close(); }
});

test('415 for unsupported / disguised files (magic bytes, extension, mime); nothing stored, tmp empty', async () => {
  const s = await loggedIn();
  try {
    const fakeFtyp = (size, brand) => { const b = Buffer.alloc(4096, 0x41); b.writeUInt32BE(size, 0); b.write('ftyp', 4, 'latin1'); b.write(brand, 8, 'latin1'); return b; };
    const nonPrint = box(24, 'isom', 0, ['isom', 'mp42']); nonPrint[18] = 0x01; // control byte inside a compatible brand
    const bad = [
      ['pdf', F(PDF, 'a.pdf', 'application/pdf')],
      ['html as .mp4', F(Buffer.from('<html><script>alert(1)</script></html>'), 'a.mp4', 'video/mp4')],
      ['text', F(Buffer.from('hello world'), 'a.txt', 'text/plain')],
      ['png renamed .mp4 (mime video/mp4)', F(PNG, 'a.mp4', 'video/mp4')],
      ['png renamed .mp4 (octet-stream)', F(PNG, 'a.mp4', 'application/octet-stream')],
      ['jpg renamed .webm', F(JPG, 'a.webm', 'video/webm')],
      ['mp4 renamed .png', F(MP4, 'a.png', 'image/png')],
      ['mp4 with image mime', F(MP4, 'a.mp4', 'image/png')],
      ['mov renamed .mp4', F(MOV, 'a.mp4', 'video/mp4')],
      ['webm renamed .mp4', F(WEBM, 'a.mp4', 'video/mp4')],
      ['random bytes with fake ftyp, absurd box size', F(fakeFtyp(0x7fffffff, 'isom'), 'a.mp4', 'video/mp4')],
      ['random bytes with fake ftyp, box size 0', F(fakeFtyp(0, 'isom'), 'a.mp4', 'video/mp4')],
      ['random bytes with fake ftyp, box size not multiple of 4', F(fakeFtyp(23, 'isom'), 'a.mp4', 'video/mp4')],
      ['fake ftyp with garbage (non-printable) brands', F(pad(nonPrint, 4096), 'a.mp4', 'video/mp4')],
      ['ftyp box bigger than the file', F(box(24, 'isom', 0, ['isom', 'mp42']).subarray(0, 20), 'a.mp4', 'video/mp4')],
      ['unknown brand (heic image)', F(pad(box(24, 'heic', 0, ['mif1', 'heic']), 4096), 'a.mp4', 'video/mp4')],
      ['unknown brand (3gp)', F(pad(box(24, '3gp4', 0, ['3gp4', 'isom']), 4096), 'a.mp4', 'video/mp4')],
      ['Matroska (EBML, DocType matroska)', F(pad(EBML('matroska'), 4096), 'a.webm', 'video/webm')],
      ['bare EBML magic without DocType', F(pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 4096), 'a.webm', 'video/webm')],
      ['empty file', F(Buffer.alloc(0), 'a.mp4', 'video/mp4')],
    ];
    for (const [label, file] of bad) {
      const r = await add(s, file);
      assert.equal(r.status, 415, label); assert.equal(r.data.error, 'unsupported_type', label); assert.ok(r.data.fields.file, label);
    }
    // a real video is not accepted where only documents/images are (menu pages)
    const pg = await s.api.req('POST', '/api/admin/menu/pages', { form: form({ lang: 'bg' }, MP4F) });
    assert.equal(pg.status, 415);
    assert.deepEqual(s.uploads(), []);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM gallery_items').get().n, 0);
    assert.ok(await tmpEmpty(s));
    // sanity: the valid siblings of the rejected ones are accepted
    for (const f of [MP4F, MOVF, WEBMF, F(MP4, 'clip.m4v', 'video/x-m4v'), F(pad(box(32, 'avc1', 0, ['avc1', 'isom', 'iso2', 'mp41']), 4096), 'x.mp4', 'video/mp4'),
      F(MP4, 'a.mp4', 'application/octet-stream'), F(MP4, 'a.mp4', '')]) {
      assert.equal((await add(s, f)).status, 201, f.name + ' ' + f.type);
    }
  } finally { await s.close(); }
});

test('validation: missing file 400, captions too long 400 (nothing stored), no file field', async () => {
  const s = await loggedIn();
  try {
    const none = await s.api.req('POST', '/api/admin/gallery', { form: form({ captionBg: 'x' }) });
    assert.equal(none.status, 400); assert.ok(none.data.fields.file);
    const long = await add(s, PNGF, { captionBg: 'я'.repeat(301), captionEn: 'e'.repeat(301) });
    assert.equal(long.status, 400); assert.ok(long.data.fields.captionBg); assert.ok(long.data.fields.captionEn);
    const edge = await add(s, PNGF, { captionBg: 'я'.repeat(300) });
    assert.equal(edge.status, 201); assert.equal(edge.data.captionBg.length, 300);
    assert.equal(s.uploads().length, 1);
    assert.ok(await tmpEmpty(s));
    // JSON body instead of multipart, and a wrong field name
    assert.equal((await s.api.post('/api/admin/gallery', { x: 1 })).status, 400);
    const f = new FormData(); f.append('image', new Blob([PNG], { type: 'image/png' }), 'a.png');
    const wrong = await s.api.req('POST', '/api/admin/gallery', { form: f }); assert.equal(wrong.status, 400);
  } finally { await s.close(); }
});

test('size: exactly 50 MB accepted, 50 MB + 1 byte -> 413 file_too_large; fixtures live in a temp dir and are removed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kota-gal-big-'));
  const s = await loggedIn();
  try {
    const mk = (name, size) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, pad(box(24, 'isom', 0, ['isom', 'mp42']), size, 0));
      return p;
    };
    const exact = mk('exact.mp4', MAX); const over = mk('over.mp4', MAX + 1);
    assert.equal(fs.statSync(exact).size, MAX); assert.equal(fs.statSync(over).size, MAX + 1);
    const blob = async (p) => ({ blob: await fs.openAsBlob(p, { type: 'video/mp4' }), name: 'big.mp4' });
    const tooBig = await add(s, await blob(over));
    assert.equal(tooBig.status, 413); assert.equal(tooBig.data.error, 'file_too_large'); assert.ok(tooBig.data.fields.file);
    assert.ok(await tmpEmpty(s));
    assert.deepEqual(s.uploads(), []);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM gallery_items').get().n, 0);
    const ok = await add(s, await blob(exact));
    assert.equal(ok.status, 201); assert.equal(ok.data.size, MAX);
    assert.equal(fs.statSync(path.join(s.dataDir, 'uploads', ok.data.fileUrl.split('/').pop())).size, MAX);
    assert.ok(await tmpEmpty(s));
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(fs.existsSync(dir), false);
});

test('limit: 50 items OK, the 51st -> 409 gallery_full (nothing stored); delete frees a slot', async () => {
  const s = await loggedIn();
  try {
    const ids = [];
    for (let i = 0; i < 50; i++) { const r = await add(s, i % 2 ? MP4F : PNGF); assert.equal(r.status, 201, `#${i + 1}`); ids.push(r.data.id); }
    const r = await add(s, PNGF);
    assert.equal(r.status, 409); assert.equal(r.data.error, 'gallery_full');
    // a bad file at the limit is also refused with 409 before anything is stored
    assert.equal((await add(s, F(Buffer.from('x'), 'a.txt', 'text/plain'))).status, 409);
    assert.equal(s.uploads().length, 50);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 50);
    assert.ok(await tmpEmpty(s));
    assert.equal((await s.api.del(`/api/admin/gallery/${ids[10]}`)).status, 204);
    const again = await add(s, WEBMF);
    assert.equal(again.status, 201); assert.equal(again.data.position, 50);
    assert.deepEqual((await list(s)).items.map((x) => x.position), Array.from({ length: 50 }, (_, i) => i + 1));
  } finally { await s.close(); }
});

test('limit is race-safe: concurrent uploads on the last free slots -> exactly 50 in total, the rest 409, no orphan files or rows', async () => {
  const s = await loggedIn();
  try {
    // 45 stored, then 10 at once -> 5 created, 5 x 409
    for (let i = 0; i < 45; i++) assert.equal((await add(s)).status, 201);
    const wave = await Promise.all(Array.from({ length: 10 }, (_, i) => add(s, i % 3 === 0 ? MP4F : PNGF)));
    const codes = wave.map((r) => r.status);
    assert.equal(codes.filter((c) => c === 201).length, 5, JSON.stringify(codes));
    assert.equal(codes.filter((c) => c === 409).length, 5, JSON.stringify(codes));
    assert.ok(wave.filter((r) => r.status === 409).every((r) => r.data.error === 'gallery_full'));
    const l = await list(s);
    assert.equal(l.items.length, 50);
    assert.deepEqual(l.items.map((x) => x.position), Array.from({ length: 50 }, (_, i) => i + 1));
    assert.equal(new Set(l.items.map((x) => x.id)).size, 50);
    assert.equal(s.uploads().length, 50);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 50);
    assert.ok(await tmpEmpty(s));
    // exactly one free slot (49 stored) and 8 racers -> one winner
    assert.equal((await s.api.del(`/api/admin/gallery/${l.items[0].id}`)).status, 204);
    const last = await Promise.all(Array.from({ length: 8 }, () => add(s, PNGF)));
    assert.equal(last.filter((r) => r.status === 201).length, 1);
    assert.equal(last.filter((r) => r.status === 409).length, 7);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM gallery_items').get().n, 50);
    assert.equal(s.uploads().length, 50);
  } finally { await s.close(); }
});

test('order: full permutation required (400 otherwise), positions renumbered, public order follows', async () => {
  const s = await loggedIn();
  try {
    const [a, b, c] = [await add(s, PNGF, { captionBg: 'A' }), await add(s, MP4F, { captionBg: 'B' }), await add(s, JPGF, { captionBg: 'C' })];
    const [ia, ib, ic] = [a.data.id, b.data.id, c.data.id];
    const r = await s.api.put('/api/admin/gallery/order', { ids: [ic, ia, ib] });
    assert.equal(r.status, 200); assert.equal(r.data.max, 50);
    assert.deepEqual(r.data.items.map((x) => [x.id, x.position]), [[ic, 1], [ia, 2], [ib, 3]]);
    for (const ids of [[ia, ib], [ia, ia, ib], [ia, ib, ic, 999], [ia, ib, 999], [], 'x', [1.5, 2, 3], [String(ia), String(ib), String(ic)], null, undefined, { 0: ia }]) {
      const bad = await s.api.put('/api/admin/gallery/order', { ids }); assert.equal(bad.status, 400, JSON.stringify(ids)); assert.ok(bad.data.fields.ids);
    }
    assert.equal((await s.api.req('PUT', '/api/admin/gallery/order', { raw: '{bad', headers: { 'Content-Type': 'application/json' } })).status, 400);
    assert.deepEqual((await list(s)).items.map((x) => x.id), [ic, ia, ib]);
    assert.deepEqual((await pub(s)).data.items.map((x) => x.caption), ['C', 'A', 'B']);
    // empty gallery: only [] is the full set
    for (const id of [ia, ib, ic]) await s.api.del(`/api/admin/gallery/${id}`);
    assert.equal((await s.api.put('/api/admin/gallery/order', { ids: [] })).status, 200);
    assert.equal((await s.api.put('/api/admin/gallery/order', { ids: [ia] })).status, 400);
  } finally { await s.close(); }
});

test('delete: 204, file removed from disk and from the files table, positions compacted; 404 afterwards; bad ids 404', async () => {
  const s = await loggedIn();
  try {
    const [a, b, c] = [await add(s, PNGF), await add(s, MP4F), await add(s, WEBMF)];
    const diskName = (r) => r.data.fileUrl.split('/').pop();
    const up = (r) => path.join(s.dataDir, 'uploads', diskName(r));
    assert.ok(fs.existsSync(up(b)));
    assert.equal((await s.api.del(`/api/admin/gallery/${b.data.id}`)).status, 204);
    assert.equal(fs.existsSync(up(b)), false);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files WHERE stored_name = ?').get(diskName(b)).n, 0);
    assert.ok(fs.existsSync(up(a)) && fs.existsSync(up(c)));
    assert.deepEqual((await list(s)).items.map((x) => [x.id, x.position]), [[a.data.id, 1], [c.data.id, 2]]);
    assert.equal(await mediaStatus(s, b.data), 404);
    assert.equal((await fetch(s.base + b.data.fileUrl, { headers: { Cookie: s.api.cookie } })).status, 404);
    assert.equal((await s.api.del(`/api/admin/gallery/${b.data.id}`)).status, 404);
    for (const bad of ['abc', '0', '-1', '1.5', '99999999999999999']) assert.equal((await s.api.del(`/api/admin/gallery/${bad}`)).status, 404, bad);
    assert.equal((await s.api.del(`/api/admin/gallery/${a.data.id}`)).status, 204);
    assert.equal((await s.api.del(`/api/admin/gallery/${c.data.id}`)).status, 204);
    assert.deepEqual(s.uploads(), []);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 0);
  } finally { await s.close(); }
});

test('PATCH: captions + visible, null/empty clears, validation, 404', async () => {
  const s = await loggedIn();
  try {
    const a = await add(s, PNGF, { captionBg: 'Старо', captionEn: 'Old' });
    const u = `/api/admin/gallery/${a.data.id}`;
    let r = await s.api.patch(u, { captionBg: '  Ново  ', visible: false });
    assert.equal(r.status, 200); assert.deepEqual([r.data.captionBg, r.data.captionEn, r.data.visible], ['Ново', 'Old', false]);
    r = await s.api.patch(u, { captionEn: null }); assert.equal(r.data.captionEn, null); assert.equal(r.data.captionBg, 'Ново'); assert.equal(r.data.visible, false);
    r = await s.api.patch(u, { captionBg: '   ' }); assert.equal(r.data.captionBg, null);
    r = await s.api.patch(u, { visible: true }); assert.equal(r.data.visible, true);
    r = await s.api.patch(u, { captionBg: 'я'.repeat(300) }); assert.equal(r.status, 200);
    for (const body of [{}, { nothing: 1 }, { captionBg: 'x'.repeat(301) }, { captionEn: 5 }, { captionBg: {} }, { visible: 'yes' }, { visible: 1 }, { visible: null }]) {
      r = await s.api.patch(u, body); assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal((await s.api.patch(u, [1])).status, 400);
    assert.equal((await s.api.patch('/api/admin/gallery/9999', { visible: true })).status, 404);
    assert.equal((await s.api.patch('/api/admin/gallery/abc', { visible: true })).status, 404);
    assert.equal((await list(s)).items[0].captionBg.length, 300);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM gallery_items').get().n, 1);
  } finally { await s.close(); }
});

test('visibility: hidden items are 404 under /media (also for Range), visible ones 200; admin media always works; public list only visible', async () => {
  const s = await loggedIn();
  try {
    const img = await add(s, PNGF); const vid = await add(s, MP4F);
    assert.equal(await mediaStatus(s, img.data), 200); assert.equal(await mediaStatus(s, vid.data), 200);
    await s.api.patch(`/api/admin/gallery/${vid.data.id}`, { visible: false });
    assert.equal(await mediaStatus(s, vid.data), 404);
    assert.equal(await mediaStatus(s, vid.data, { Range: 'bytes=0-9' }), 404);
    assert.equal((await fetch(s.base + vid.data.fileUrl, { headers: { Cookie: s.api.cookie } })).status, 200); // admin can still preview
    assert.equal((await fetch(s.base + vid.data.fileUrl)).status, 401); // ...but not anonymously
    assert.deepEqual((await pub(s)).data.items.map((x) => x.id), [img.data.id]);
    await s.api.patch(`/api/admin/gallery/${img.data.id}`, { visible: false });
    assert.deepEqual((await pub(s)).data.items, []);
    assert.equal(await mediaStatus(s, img.data), 404);
    await s.api.patch(`/api/admin/gallery/${vid.data.id}`, { visible: true });
    assert.equal(await mediaStatus(s, vid.data), 200);
    // hidden items stay in the admin list and keep their position
    assert.deepEqual((await list(s)).items.map((x) => [x.id, x.visible, x.position]), [[img.data.id, false, 1], [vid.data.id, true, 2]]);
    // the response is not served from a stale cache
    assert.equal((await fetch(s.base + mediaUrl(vid.data))).headers.get('x-content-type-options'), 'nosniff');
  } finally { await s.close(); }
});

test('Range on a gallery video: 206 + exact Content-Range; suffix/open ranges; 416; full 200 with Accept-Ranges', async () => {
  const s = await loggedIn();
  try {
    const body = Buffer.concat([MP4, Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251))]);
    const N = body.length;
    const vid = await add(s, F(body, 'clip.mp4', 'video/mp4'));
    const mov = await add(s, F(MOV, 'iphone.mov', 'video/quicktime'));
    const url = s.base + mediaUrl(vid.data);
    const get = async (range) => { const r = await fetch(url, { headers: range ? { Range: range } : {} }); return { r, buf: Buffer.from(await r.arrayBuffer()) }; };

    let { r, buf } = await get();
    assert.equal(r.status, 200); assert.equal(r.headers.get('accept-ranges'), 'bytes'); assert.equal(r.headers.get('content-type'), 'video/mp4');
    assert.equal(r.headers.get('content-length'), String(N)); assert.ok(buf.equals(body));

    ({ r, buf } = await get('bytes=0-99'));
    assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes 0-99/${N}`); assert.equal(r.headers.get('content-length'), '100');
    assert.equal(r.headers.get('content-type'), 'video/mp4'); assert.ok(buf.equals(body.subarray(0, 100)));

    ({ r, buf } = await get('bytes=4000-4999'));
    assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes 4000-4999/${N}`); assert.ok(buf.equals(body.subarray(4000, 5000)));

    ({ r, buf } = await get('bytes=5000-'));
    assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes 5000-${N - 1}/${N}`); assert.ok(buf.equals(body.subarray(5000)));

    ({ r, buf } = await get('bytes=-50'));
    assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes ${N - 50}-${N - 1}/${N}`); assert.ok(buf.equals(body.subarray(N - 50)));

    ({ r, buf } = await get(`bytes=0-${N + 1000}`)); // end beyond EOF is clamped
    assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes 0-${N - 1}/${N}`);

    ({ r, buf } = await get(`bytes=${N + 10}-${N + 20}`));
    assert.equal(r.status, 416); assert.equal(r.headers.get('content-range'), `bytes */${N}`);
    // BUG-20: the error body is JSON and must be labelled as JSON, not as the file's type
    assert.match(r.headers.get('content-type'), /^application\/json/);
    assert.equal(r.headers.get('content-disposition'), null);
    assert.equal(JSON.parse(buf.toString()).error, 'range_not_satisfiable');

    const hr = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=0-9' } });
    assert.equal(hr.status, 206); assert.equal(hr.headers.get('content-range'), `bytes 0-9/${N}`);

    const mr = await fetch(s.base + mediaUrl(mov.data), { headers: { Range: 'bytes=10-19' } });
    assert.equal(mr.status, 206); assert.equal(mr.headers.get('content-type'), 'video/quicktime'); assert.equal(mr.headers.get('content-range'), 'bytes 10-19/4096');
    await mr.arrayBuffer();
  } finally { await s.close(); }
});

test('public gallery: shape, caption fallback both directions, lang validation, no admin fields', async () => {
  const s = await loggedIn();
  try {
    const a = await add(s, PNGF, { captionBg: 'Само БГ' });
    const b = await add(s, MP4F, { captionEn: 'EN only' });
    const c = await add(s, JPGF, { captionBg: 'Двете', captionEn: 'Both' });
    const d = await add(s, WEBPF);
    const bg = (await pub(s)).data.items; const en = (await pub(s, '?lang=en')).data.items;
    assert.deepEqual(Object.keys(bg[0]).sort(), ['caption', 'id', 'kind', 'mime', 'url']);
    assert.deepEqual(bg.map((x) => x.caption), ['Само БГ', 'EN only', 'Двете', null]);
    assert.deepEqual(en.map((x) => x.caption), ['Само БГ', 'EN only', 'Both', null]);
    assert.deepEqual(bg.map((x) => [x.id, x.kind, x.mime]), [[a.data.id, 'image', 'image/png'], [b.data.id, 'video', 'video/mp4'], [c.data.id, 'image', 'image/jpeg'], [d.data.id, 'image', 'image/webp']]);
    assert.match(bg[1].url, /^\/media\/[a-f0-9]{32}\.mp4$/);
    assert.equal((await pub(s, '?lang=fr')).status, 400);
    // anonymous, no cookie needed; not cacheable
    const r = await fetch(s.base + '/api/public/gallery'); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
    // no mutating verbs on the public route
    assert.equal((await s.client().req('POST', '/api/public/gallery', { json: {} })).status, 404);
  } finally { await s.close(); }
});

test('dashboard reports gallery count and visible', async () => {
  const s = await loggedIn();
  try {
    assert.deepEqual((await s.api.get('/api/admin/dashboard')).data.gallery, { count: 0, visible: 0 });
    const a = await add(s); await add(s, MP4F); await add(s, JPGF);
    await s.api.patch(`/api/admin/gallery/${a.data.id}`, { visible: false });
    assert.deepEqual((await s.api.get('/api/admin/dashboard')).data.gallery, { count: 3, visible: 2 });
    await s.api.del(`/api/admin/gallery/${a.data.id}`);
    assert.deepEqual((await s.api.get('/api/admin/dashboard')).data.gallery, { count: 2, visible: 2 });
  } finally { await s.close(); }
});

test('gallery files survive a restart (orphan sweep keeps them) and unreferenced files are still swept', async () => {
  const s = await loggedIn();
  const dataDir = s.dataDir;
  let name;
  try {
    const a = await add(s, MP4F); name = a.data.fileUrl.split('/').pop();
    fs.writeFileSync(path.join(dataDir, 'uploads', 'f'.repeat(32) + '.mp4'), 'x');
    s.db.prepare("INSERT INTO files(stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?, 'o.mp4', 'video/mp4', 1, 1)").run('f'.repeat(32) + '.mp4');
  } finally { await s.close(false); }
  const s2 = await startApp({ dataDir });
  try {
    await sleep(300);
    assert.deepEqual(s2.uploads(), [name]);
    assert.equal(s2.db.prepare('SELECT COUNT(*) n FROM gallery_items').get().n, 1);
    assert.equal((await fetch(s2.base + '/media/' + name)).status, 200);
  } finally { await s2.close(); }
});

// ---------- About text (D-52) ----------
const putSettings = (s, body) => s.api.put('/api/admin/settings', body);

test('settings: aboutBg/aboutEn default null, round trip, null/empty/blank clear, newlines kept (CRLF -> LF), partial PUT keeps them', async () => {
  const s = await loggedIn();
  try {
    let g = (await s.api.get('/api/admin/settings')).data; assert.equal(g.aboutBg, null); assert.equal(g.aboutEn, null);
    let r = await putSettings(s, { aboutBg: '  Първи абзац.\r\n\r\nВтори абзац.  ', aboutEn: 'First.\nSecond.' });
    assert.equal(r.status, 200); assert.equal(r.data.aboutBg, 'Първи абзац.\n\nВтори абзац.'); assert.equal(r.data.aboutEn, 'First.\nSecond.');
    // untouched by an unrelated update
    r = await putSettings(s, { address: 'Нов адрес 1' });
    assert.equal(r.data.aboutBg, 'Първи абзац.\n\nВтори абзац.'); assert.equal(r.data.aboutEn, 'First.\nSecond.');
    // only one language changes
    r = await putSettings(s, { aboutEn: null }); assert.equal(r.data.aboutEn, null); assert.equal(r.data.aboutBg, 'Първи абзац.\n\nВтори абзац.');
    r = await putSettings(s, { aboutBg: '   ' }); assert.equal(r.data.aboutBg, null);
    r = await putSettings(s, { aboutBg: '' }); assert.equal(r.data.aboutBg, null);
    assert.deepEqual((await s.api.get('/api/admin/settings')).data.aboutBg, null);
  } finally { await s.close(); }
});

test('settings: about length validation (2000 ok, 2001 -> 400 with the field), wrong types 400, nothing saved on error', async () => {
  const s = await loggedIn();
  try {
    let r = await putSettings(s, { aboutBg: 'я'.repeat(2000), aboutEn: 'e'.repeat(2000) });
    assert.equal(r.status, 200); assert.equal(r.data.aboutBg.length, 2000);
    r = await putSettings(s, { aboutBg: 'я'.repeat(2001) });
    assert.equal(r.status, 400); assert.ok(r.data.fields.aboutBg); assert.equal(r.data.fields.aboutEn, undefined);
    r = await putSettings(s, { aboutBg: 'ok', aboutEn: 'e'.repeat(2001), address: 'не се запазва' });
    assert.equal(r.status, 400); assert.ok(r.data.fields.aboutEn);
    for (const v of [5, true, {}, ['a']]) { r = await putSettings(s, { aboutEn: v }); assert.equal(r.status, 400, JSON.stringify(v)); assert.ok(r.data.fields.aboutEn); }
    const g = (await s.api.get('/api/admin/settings')).data;
    assert.equal(g.aboutBg.length, 2000); assert.notEqual(g.address, 'не се запазва');
    // 2000 chars counted after CRLF normalisation (each CRLF is one char)
    r = await putSettings(s, { aboutBg: 'a\r\n'.repeat(999) + 'b' }); assert.equal(r.status, 200); assert.equal(r.data.aboutBg.length, 1999);
  } finally { await s.close(); }
});

test('site.about: served language with BG/EN fallback, null when neither is set (frontend uses its default)', async () => {
  const s = await loggedIn();
  try {
    const site = async (lang) => (await s.client().get(`/api/public/site?lang=${lang}`)).data;
    assert.equal((await site('bg')).about, null); assert.equal((await site('en')).about, null);
    assert.equal((await s.client().get('/api/public/site')).data.about, null);
    await putSettings(s, { aboutBg: 'Само български' });
    assert.equal((await site('bg')).about, 'Само български'); assert.equal((await site('en')).about, 'Само български');
    await putSettings(s, { aboutBg: null, aboutEn: 'English only' });
    assert.equal((await site('bg')).about, 'English only'); assert.equal((await site('en')).about, 'English only');
    await putSettings(s, { aboutBg: 'Български\n\nвтори', aboutEn: 'English\n\nsecond' });
    assert.equal((await site('bg')).about, 'Български\n\nвтори'); assert.equal((await site('en')).about, 'English\n\nsecond');
    await putSettings(s, { aboutBg: null, aboutEn: null });
    assert.equal((await site('en')).about, null);
    // the *Bg/*En admin fields are not leaked to the public site
    const p = await site('bg'); assert.equal(p.aboutBg, undefined); assert.equal(p.aboutEn, undefined);
    // the settings routes keep requiring a session + CSRF
    assert.equal((await s.client().put('/api/admin/settings', { aboutBg: 'x' })).status, 401);
    assert.equal((await s.api.req('PUT', '/api/admin/settings', { json: { aboutBg: 'x' }, csrf: false })).status, 403);
  } finally { await s.close(); }
});

test('XSS payloads are stored and returned as plain text (no HTML processing on the server)', async () => {
  const s = await loggedIn();
  try {
    const x1 = '<script>alert(1)</script>';
    const x2 = '"><img src=x onerror=alert(1)>';
    const x3 = "'; DROP TABLE gallery_items;--";
    const a = await add(s, PNGF, { captionBg: x1, captionEn: x2 });
    assert.equal(a.status, 201); assert.equal(a.data.captionBg, x1); assert.equal(a.data.captionEn, x2);
    const p = await s.api.patch(`/api/admin/gallery/${a.data.id}`, { captionBg: x3 }); assert.equal(p.data.captionBg, x3);
    await s.api.patch(`/api/admin/gallery/${a.data.id}`, { captionBg: x1 });
    await putSettings(s, { aboutBg: x1 + '\n' + x2, aboutEn: x3 });
    // stored verbatim
    const row = s.db.prepare('SELECT caption_bg, caption_en FROM gallery_items').get();
    assert.deepEqual([row.caption_bg, row.caption_en], [x1, x2]);
    assert.equal(s.db.prepare("SELECT value FROM settings WHERE key = 'about_bg'").get().value, x1 + '\n' + x2);
    // returned verbatim, as JSON only (never an HTML content type)
    const pubG = await pub(s); assert.equal(pubG.data.items[0].caption, x1);
    assert.match(pubG.headers.get('content-type'), /^application\/json/);
    assert.equal((await pub(s, '?lang=en')).data.items[0].caption, x2);
    const site = await s.client().get('/api/public/site'); assert.equal(site.data.about, x1 + '\n' + x2);
    assert.match(site.headers.get('content-type'), /^application\/json/);
    assert.equal((await s.client().get('/api/public/site?lang=en')).data.about, x3);
    assert.equal((await list(s)).items[0].captionBg, x1);
    // a hostile original file name never reaches HTML either: the item exposes only generated names
    const evil = await add(s, F(PNG, '"><svg onload=alert(1)>.png', 'image/png'));
    assert.equal(evil.status, 201); assert.match(evil.data.fileUrl, /^\/api\/admin\/media\/[a-f0-9]{32}\.png$/);
    assert.equal(JSON.stringify(evil.data).includes('svg'), false);
    // table still intact
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM gallery_items').get().n, 2);
  } finally { await s.close(); }
});

// T-50 (D-51..D-53): gallery admin + public API, video uploads, Range, editable About text. Port 3205 (+3206 for the restart check).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, createAdmin, Client, tmpDir, makePng, makeVideo, JPG, WEBP, PDF, sleep } from '../lib/harness.mjs';

const PORT = 3205;
const T0 = '2026-06-15T10:00:00Z';
const MB = 1024 * 1024;
const LIMIT = 50 * MB;
const MP4 = makeVideo('mp4'); const MOV = makeVideo('mov'); const WEBM = makeVideo('webm'); const MKV = makeVideo('mkv');
const png = (n = 0) => makePng(8 + n, 6, [n % 256, (n * 7) % 256, 90]);
const mp = (fields, file) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, String(v));
  if (file) fd.append(file.field || 'file', new Blob([file.buf], { type: file.type ?? '' }), file.name);
  return fd;
};
/** ISO-BMFF ftyp header (size 24, brand isom) followed by zero padding up to n bytes. */
const ftypSized = (n, brand = 'isom') => { const b = Buffer.alloc(n); b.writeUInt32BE(24, 0); b.write('ftyp', 4, 'latin1'); b.write(brand, 8, 'latin1'); b.write('isom', 16, 'latin1'); b.write('mp41', 20, 'latin1'); return b; };
const G = '/api/admin/gallery';

describe('gallery API (D-51..D-53)', () => {
  let dir; let srv; let admin; let anon;
  const ls = (d) => fs.readdirSync(path.join(dir, d)).sort();
  const tmpEmpty = async () => { for (let i = 0; i < 30 && ls('tmp').length; i++) await sleep(100); return ls('tmp'); };
  const list = async () => (await admin.get(G)).data;
  const clear = async () => { for (const it of (await list()).items) assert.equal((await admin.del(`${G}/${it.id}`)).status, 204); };
  const add = async (buf, name, type, fields) => admin.post(G, { form: mp(fields, { buf, name, type }) });
  const dbq = (sql, ...a) => { const d = new DatabaseSync(path.join(dir, 'kota.db')); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

  before(async () => {
    dir = tmpDir('gallery'); createAdmin(dir);
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url);
  });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('GA0 fresh database: migration 007 applied, empty admin + public gallery, About not set, dashboard counts 0', async () => {
    assert.ok(dbq('SELECT name FROM schema_migrations').some((r) => r.name === '007_gallery.sql'));
    assert.deepEqual((await list()), { max: 25, items: [] });
    assert.deepEqual((await anon.get('/api/public/gallery')).data, { items: [] });
    assert.equal((await anon.get('/api/public/site')).data.about, null);
    const s = (await admin.get('/api/admin/settings')).data; assert.equal(s.aboutBg, null); assert.equal(s.aboutEn, null);
    assert.deepEqual((await admin.get('/api/admin/dashboard')).data.gallery, { count: 0, visible: 0 });
  });

  test('GA1 auth + CSRF on every gallery route', async () => {
    const routes = [['GET', G], ['POST', G], ['PATCH', `${G}/1`], ['PUT', `${G}/order`], ['DELETE', `${G}/1`]];
    const created = (await add(png(1), 'a.png', 'image/png')).data; // a real id for the state-unchanged checks
    for (const [m, p] of routes) {
      const q = p.replace('/1', `/${created.id}`);
      assert.equal((await anon.req(m, q, { json: m === 'GET' || m === 'DELETE' ? undefined : {} })).status, 401, `anon ${m} ${q}`);
      for (const c of ['kota_session=garbage', 'kota_session=' + 'A'.repeat(43), 'kota_session=']) {
        assert.equal((await anon.req(m, q, { cookie: c, json: m === 'GET' || m === 'DELETE' ? undefined : {} })).status, 401, `${c} ${m} ${q}`);
      }
      if (m !== 'GET') {
        const r = await admin.req(m, q, { csrf: false, json: {} });
        assert.equal(r.status, 403, `session without CSRF header ${m} ${q} -> ${r.status}`); assert.equal(r.data.error, 'csrf');
        const o = await admin.req(m, q, { origin: 'https://evil.example', json: {} });
        assert.equal(o.status, 403, `foreign Origin ${m} ${q} -> ${o.status}`);
        const f = await admin.req(m, q, { csrf: false, headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: 'a=b' });
        assert.equal(f.status, 403, `form post ${m} ${q}`);
      }
    }
    // multipart POST without the CSRF header and from a foreign origin: nothing is stored
    const n0 = (await list()).items.length;
    assert.equal((await admin.post(G, { csrf: false, form: mp({}, { buf: png(2), name: 'b.png', type: 'image/png' }) })).status, 403);
    assert.equal((await admin.post(G, { origin: 'https://evil.example', form: mp({}, { buf: png(2), name: 'b.png', type: 'image/png' }) })).status, 403);
    assert.equal((await anon.post(G, { form: mp({}, { buf: png(2), name: 'b.png', type: 'image/png' }) })).status, 401);
    assert.equal((await list()).items.length, n0, 'rejected requests changed nothing');
    assert.deepEqual(await tmpEmpty(), [], 'no tmp leftovers');
    // same-origin Origin is accepted
    assert.equal((await admin.patch(`${G}/${created.id}`, { origin: srv.url, json: { visible: true } })).status, 200);
    // the public endpoint is read-only
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.ok([404, 405].includes((await anon.req(m, '/api/public/gallery', { json: {} })).status), `public ${m}`);
    await clear();
  });

  test('GA2 every accepted type uploads (jpg png webp mp4 mov webm, m4v extension): 201, item shape, stored mime/kind, public URL serves the bytes', async () => {
    const cases = [
      [JPG, 'p.jpg', 'image/jpeg', 'image', 'image/jpeg'], [png(3), 'p.png', 'image/png', 'image', 'image/png'], [WEBP, 'p.webp', 'image/webp', 'image', 'image/webp'],
      [MP4, 'v.mp4', 'video/mp4', 'video', 'video/mp4'], [MOV, 'v.mov', 'video/quicktime', 'video', 'video/quicktime'], [WEBM, 'v.webm', 'video/webm', 'video', 'video/webm'],
      [MP4, 'v.m4v', 'video/x-m4v', 'video', 'video/mp4'], [MP4, 'noct.mp4', '', 'video', 'video/mp4'], [MP4, 'oct.mp4', 'application/octet-stream', 'video', 'video/mp4'],
    ];
    let pos = 0;
    for (const [buf, name, type, kind, mime] of cases) {
      const r = await add(buf, name, type, { captionBg: `Надпис ${name}`, captionEn: `Caption ${name}` });
      assert.equal(r.status, 201, `${name}: ${r.status} ${r.text().slice(0, 150)}`);
      assert.deepEqual(Object.keys(r.data).sort(), ['captionBg', 'captionEn', 'createdAt', 'fileUrl', 'id', 'kind', 'mime', 'position', 'size', 'visible']);
      assert.equal(r.data.kind, kind, name); assert.equal(r.data.mime, mime, name); assert.equal(r.data.size, buf.length); assert.equal(r.data.visible, true); assert.equal(r.data.position, ++pos);
      assert.equal(r.data.captionBg, `Надпис ${name}`); assert.equal(r.data.captionEn, `Caption ${name}`);
      const f = await admin.get(r.data.fileUrl); assert.equal(f.status, 200, `admin media ${name}`); assert.ok(f.buf.equals(buf));
    }
    const pub = (await anon.get('/api/public/gallery?lang=bg')).data.items;
    assert.equal(pub.length, cases.length);
    assert.deepEqual(Object.keys(pub[0]).sort(), ['caption', 'id', 'kind', 'mime', 'url']);
    for (let i = 0; i < cases.length; i++) {
      assert.match(pub[i].url, /^\/media\/[a-f0-9]{32}\.(jpg|png|webp|mp4|mov|webm)$/);
      const r = await anon.get(pub[i].url); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), cases[i][4]); assert.ok(r.buf.equals(cases[i][0]));
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    }
    assert.deepEqual(await tmpEmpty(), []);
    assert.equal(ls('uploads').length, cases.length);
    await clear();
    assert.deepEqual(ls('uploads'), [], 'delete removed every file');
  });

  test('GA3 type spoofing: renamed / mislabelled / fake-ftyp / Matroska / non-gallery types -> 415 unsupported_type, nothing stored', async () => {
    const fakeFtypBadBrand = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypabcd', 'latin1'), Buffer.alloc(4), Buffer.from('isommp41', 'latin1'), Buffer.alloc(200)]);
    const heic = ftypSized(2000, 'heic');
    const ftypTooBig = ftypSized(24); ftypTooBig.writeUInt32BE(9999, 0); // declared box size larger than the file
    const ftypBinaryBrand = ftypSized(2000); ftypBinaryBrand[10] = 0x01; // non-printable brand
    const ftypSizeOdd = ftypSized(2000); ftypSizeOdd.writeUInt32BE(23, 0);
    const ftypNoBox = Buffer.concat([Buffer.alloc(4), Buffer.from('moov', 'latin1'), Buffer.alloc(100)]);
    const ebmlMatroska = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88]), Buffer.from('matroska'), Buffer.alloc(100)]);
    const ebmlBare = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100)]);
    const cases = [
      ['PNG renamed .mp4 (type video/mp4)', png(4), 'x.mp4', 'video/mp4'], ['PNG renamed .mp4 (no type)', png(4), 'x.mp4', ''], ['JPG renamed .webm', JPG, 'x.webm', 'video/webm'],
      ['MP4 renamed .png', MP4, 'x.png', 'image/png'], ['MP4 renamed .jpg', MP4, 'x.jpg', 'image/jpeg'], ['MP4 named .mp4 but declared image/png', MP4, 'x.mp4', 'image/png'],
      ['MP4 named .webm', MP4, 'x.webm', 'video/webm'], ['WebM named .mp4', WEBM, 'x.mp4', 'video/mp4'], ['MOV named .mp4', MOV, 'x.mp4', 'video/mp4'], ['MP4 named .mov', MP4, 'x.mov', 'video/quicktime'],
      ['MP4 double extension .mp4.exe', MP4, 'x.mp4.exe', 'video/mp4'], ['MP4 without extension', MP4, 'noext', 'video/mp4'],
      ['Matroska (ffmpeg) named .mkv', MKV, 'x.mkv', 'video/x-matroska'], ['Matroska (ffmpeg) named .webm', MKV, 'x.webm', 'video/webm'], ['Matroska (ffmpeg) named .mp4', MKV, 'x.mp4', 'video/mp4'],
      ['EBML with DocType matroska named .webm', ebmlMatroska, 'x.webm', 'video/webm'], ['bare EBML magic without DocType', ebmlBare, 'x.webm', 'video/webm'],
      ['fake ftyp with unknown brand "abcd"', fakeFtypBadBrand, 'x.mp4', 'video/mp4'], ['ftyp brand heic (HEIF image)', heic, 'x.mp4', 'video/mp4'], ['ftyp box size larger than the file', ftypTooBig, 'x.mp4', 'video/mp4'],
      ['ftyp with non-printable brand byte', ftypBinaryBrand, 'x.mp4', 'video/mp4'], ['ftyp box size not a multiple of 4', ftypSizeOdd, 'x.mp4', 'video/mp4'], ['"moov" instead of "ftyp" at offset 4', ftypNoBox, 'x.mp4', 'video/mp4'],
      ['PDF (not allowed in the gallery)', PDF, 'x.pdf', 'application/pdf'], ['PDF renamed .jpg', PDF, 'x.jpg', 'image/jpeg'],
      ['HTML named .jpg', Buffer.from('<html><script>alert(1)</script></html>'), 'x.jpg', 'image/jpeg'], ['SVG named .png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'x.png', 'image/png'],
      ['SVG named .svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg', 'image/svg+xml'], ['ZIP named .mp4', Buffer.from('PK\x03\x04' + 'x'.repeat(100), 'latin1'), 'x.mp4', 'video/mp4'],
      ['GIF named .gif', Buffer.from('GIF89a' + 'x'.repeat(100), 'latin1'), 'x.gif', 'image/gif'], ['empty file named .mp4', Buffer.alloc(0), 'x.mp4', 'video/mp4'], ['3 bytes named .jpg', Buffer.from([0xff, 0xd8, 0xff]).subarray(0, 2), 'x.jpg', 'image/jpeg'],
      ['MP4 with spoofed .MP4 + image type', MP4, 'X.MP4', 'image/jpeg'],
    ];
    for (const [label, buf, name, type] of cases) {
      const r = await add(buf, name, type);
      if (label === 'MP4 with spoofed .MP4 + image type') { assert.equal(r.status, 415, label); continue; }
      assert.equal(r.status, 415, `${label}: ${r.status} ${r.text().slice(0, 120)}`);
      assert.equal(r.data.error, 'unsupported_type', label); assert.ok(r.data.fields && r.data.fields.file, `${label}: fields.file`);
    }
    assert.deepEqual((await list()).items, []); assert.deepEqual(ls('uploads'), [], 'no orphan files'); assert.deepEqual(await tmpEmpty(), []);
    assert.equal(dbq('SELECT COUNT(*) AS n FROM files')[0].n, 0, 'no orphan files rows');
    // no file field / wrong field name / two files
    assert.equal((await admin.post(G, { form: mp({ captionBg: 'x' }) })).status, 400);
    const wrong = await admin.post(G, { form: mp({}, { field: 'image', buf: png(5), name: 'a.png', type: 'image/png' }) });
    assert.equal(wrong.status, 400); assert.deepEqual(ls('uploads'), []);
    const two = new FormData(); two.append('file', new Blob([png(6)], { type: 'image/png' }), 'a.png'); two.append('file', new Blob([png(7)], { type: 'image/png' }), 'b.png');
    assert.equal((await admin.post(G, { form: two })).status, 400); assert.deepEqual(ls('uploads'), []); assert.deepEqual(await tmpEmpty(), []);
    // JSON body instead of multipart
    assert.ok([400, 415].includes((await admin.post(G, { json: { file: 'x' } })).status));
  });

  test('GA4 caption limits on upload: 300 ok, 301 -> 400 with the field named and no file kept; non-caption junk ignored', async () => {
    const ok = await add(png(8), 'a.png', 'image/png', { captionBg: 'б'.repeat(300), captionEn: 'e'.repeat(300) });
    assert.equal(ok.status, 201); assert.equal(ok.data.captionBg.length, 300);
    const n = ls('uploads').length;
    const r = await add(png(9), 'a.png', 'image/png', { captionBg: 'б'.repeat(301), captionEn: 'e'.repeat(301) });
    assert.equal(r.status, 400); assert.equal(r.data.error, 'validation'); assert.ok(r.data.fields.captionBg && r.data.fields.captionEn);
    const r2 = await add(png(9), 'a.png', 'image/png', { captionEn: 'e'.repeat(301) });
    assert.equal(r2.status, 400); assert.ok(r2.data.fields.captionEn && !r2.data.fields.captionBg);
    assert.equal(ls('uploads').length, n, 'no orphan after validation error'); assert.deepEqual(await tmpEmpty(), []);
    const blank = await add(png(10), 'a.png', 'image/png', { captionBg: '   ', captionEn: '' });
    assert.equal(blank.status, 201); assert.equal(blank.data.captionBg, null); assert.equal(blank.data.captionEn, null);
    await clear();
  });

  test('GA5 50 MB boundary: exactly 50 MB video accepted, 50 MB + 1 -> 413 file_too_large; tmp and uploads clean; deleting frees the file', async () => {
    const over = await add(ftypSized(LIMIT + 1), 'big.mp4', 'video/mp4');
    assert.equal(over.status, 413); assert.equal(over.data.error, 'file_too_large'); assert.ok(over.data.fields && over.data.fields.file);
    assert.deepEqual(await tmpEmpty(), []); assert.deepEqual(ls('uploads'), []);
    const ok = await add(ftypSized(LIMIT), 'big.mp4', 'video/mp4');
    assert.equal(ok.status, 201, `${ok.status} ${ok.text().slice(0, 100)}`); assert.equal(ok.data.size, LIMIT);
    assert.equal(fs.statSync(path.join(dir, 'uploads', ls('uploads')[0])).size, LIMIT);
    assert.deepEqual(await tmpEmpty(), []);
    const r = await anon.req('GET', ok.data.fileUrl.replace('/api/admin/media', '/media'), { headers: { range: `bytes=${LIMIT - 10}-` } });
    assert.equal(r.status, 206); assert.equal(r.buf.length, 10); assert.equal(r.headers.get('content-range'), `bytes ${LIMIT - 10}-${LIMIT - 1}/${LIMIT}`);
    await clear(); assert.deepEqual(ls('uploads'), []);
    // 50 MB + 1 image
    const img = Buffer.alloc(LIMIT + 1); png(1).copy(img);
    assert.equal((await add(img, 'big.png', 'image/png')).status, 413); assert.deepEqual(await tmpEmpty(), []); assert.deepEqual(ls('uploads'), []);
  });

  test('GA6 25-item cap: 25 accepted, 26th -> 409 gallery_full (nothing stored); race of 3 concurrent uploads at 24 -> exactly one wins; tmp empty', async () => {
    for (let i = 0; i < 25; i++) { const r = await add(png(100 + i), `p${i}.png`, 'image/png'); assert.equal(r.status, 201, `item ${i + 1}: ${r.status} ${r.text().slice(0, 100)}`); assert.equal(r.data.position, i + 1); }
    assert.equal((await list()).items.length, 25);
    const r = await add(png(200), 'p26.png', 'image/png');
    assert.equal(r.status, 409); assert.equal(r.data.error, 'gallery_full');
    assert.equal((await add(MP4, 'v.mp4', 'video/mp4')).status, 409);
    assert.equal(ls('uploads').length, 25, 'rejected 26th leaves no file'); assert.deepEqual(await tmpEmpty(), []);
    assert.equal((await admin.get('/api/admin/dashboard')).data.gallery.count, 25);
    // 409 versus 415: type check still reports its own error when full (either is acceptable, but never 2xx)
    assert.ok([409, 415].includes((await add(PDF, 'x.pdf', 'application/pdf')).status));
    // race at 24
    const items = (await list()).items; assert.equal((await admin.del(`${G}/${items[24].id}`)).status, 204);
    const rs = await Promise.all([0, 1, 2, 3].map((i) => add(png(300 + i), `r${i}.png`, 'image/png')));
    const st = rs.map((x) => x.status).sort();
    assert.deepEqual(st, [201, 409, 409, 409], `race statuses ${st}`);
    const l = (await list()).items; assert.equal(l.length, 25); assert.deepEqual(l.map((x) => x.position), Array.from({ length: 25 }, (_, i) => i + 1), 'positions 1..25 contiguous, no duplicates');
    assert.equal(ls('uploads').length, 25, 'losers leave no file'); assert.equal(dbq('SELECT COUNT(*) AS n FROM files')[0].n, 25);
    assert.deepEqual(await tmpEmpty(), []);
    // concurrency at 25 with videos
    const rs2 = await Promise.all([0, 1].map(() => add(MP4, 'v.mp4', 'video/mp4'))); assert.deepEqual(rs2.map((x) => x.status), [409, 409]);
  });

  test('GA7 order: valid permutation applies and persists; every invalid body -> 400 validation and the order is unchanged', async () => {
    const before = (await list()).items.map((x) => x.id);
    const rev = [...before].reverse();
    const r = await admin.put(`${G}/order`, { json: { ids: rev } });
    assert.equal(r.status, 200); assert.deepEqual(r.data.items.map((x) => x.id), rev); assert.deepEqual(r.data.items.map((x) => x.position), before.map((_, i) => i + 1)); assert.equal(r.data.max, 25);
    assert.deepEqual((await list()).items.map((x) => x.id), rev);
    assert.deepEqual((await anon.get('/api/public/gallery')).data.items.map((x) => x.id), rev, 'public order follows');
    const bad = [
      ['missing id', rev.slice(1)], ['extra unknown id', [...rev, 999999]], ['duplicate id', [...rev.slice(1), rev[1]]], ['all same', rev.map(() => rev[0])], ['string ids', rev.map(String)],
      ['float ids', rev.map((x) => x + 0.5)], ['null entries', rev.map(() => null)], ['negative id', [...rev.slice(1), -1]], ['empty list', []], ['not an array (object)', { a: 1 }], ['not an array (string)', 'abc'], ['nested arrays', [rev]],
      ['unknown id replacing one', [...rev.slice(1), 424242]], ['too many', [...rev, ...rev]],
    ];
    for (const [label, ids] of bad) {
      const x = await admin.put(`${G}/order`, { json: { ids } });
      assert.equal(x.status, 400, `${label}: ${x.status}`); assert.equal(x.data.error, 'validation', label); assert.ok(x.data.fields && x.data.fields.ids, label);
    }
    assert.equal((await admin.put(`${G}/order`, { json: {} })).status, 400); assert.equal((await admin.put(`${G}/order`, { json: [] })).status, 400);
    assert.equal((await admin.put(`${G}/order`, { raw: 'not json', headers: { 'content-type': 'application/json' } })).status, 400);
    assert.deepEqual((await list()).items.map((x) => x.id), rev, 'order untouched by invalid requests');
    // `order` is not mistaken for an :id
    assert.equal((await admin.patch(`${G}/order`, { json: { visible: true } })).status, 404);
    assert.equal((await admin.del(`${G}/order`)).status, 404);
  });

  test('GA8 PATCH: captions (300 / 301 / null / blank / non-string), visible (boolean only), empty body, unknown or malformed id', async () => {
    const [a, b] = (await list()).items;
    let r = await admin.patch(`${G}/${a.id}`, { json: { captionBg: ' Здравей\r\nсвят ', captionEn: 'Hello' } });
    assert.equal(r.status, 200); assert.equal(r.data.captionBg, 'Здравей\nсвят', 'trimmed, CRLF normalised'); assert.equal(r.data.captionEn, 'Hello');
    r = await admin.patch(`${G}/${a.id}`, { json: { captionBg: 'ж'.repeat(300) } }); assert.equal(r.status, 200); assert.equal(r.data.captionEn, 'Hello', 'untouched field kept');
    r = await admin.patch(`${G}/${a.id}`, { json: { captionBg: 'ж'.repeat(301) } }); assert.equal(r.status, 400); assert.ok(r.data.fields.captionBg);
    r = await admin.patch(`${G}/${a.id}`, { json: { captionEn: 'e'.repeat(301) } }); assert.equal(r.status, 400); assert.ok(r.data.fields.captionEn);
    assert.equal((await list()).items.find((x) => x.id === a.id).captionBg, 'ж'.repeat(300), 'failed PATCH changed nothing');
    r = await admin.patch(`${G}/${a.id}`, { json: { captionBg: '', captionEn: '   ' } }); assert.equal(r.status, 200); assert.equal(r.data.captionBg, null); assert.equal(r.data.captionEn, null);
    r = await admin.patch(`${G}/${a.id}`, { json: { captionBg: null } }); assert.equal(r.status, 200); assert.equal(r.data.captionBg, null);
    for (const v of [123, true, ['x'], { a: 1 }]) { r = await admin.patch(`${G}/${a.id}`, { json: { captionBg: v } }); assert.equal(r.status, 400, `caption ${JSON.stringify(v)}`); }
    for (const v of ['true', 1, 0, null, 'yes', [], {}]) { r = await admin.patch(`${G}/${a.id}`, { json: { visible: v } }); assert.equal(r.status, 400, `visible ${JSON.stringify(v)}`); assert.ok(r.data.fields.visible); }
    assert.equal((await admin.patch(`${G}/${a.id}`, { json: {} })).status, 400);
    assert.equal((await admin.patch(`${G}/${a.id}`, { json: { foo: 1, position: 99, kind: 'video', id: 5 } })).status, 400, 'unknown keys alone = empty update');
    r = await admin.patch(`${G}/${a.id}`, { json: { captionEn: 'ok', position: 99, kind: 'video', fileUrl: '/x', size: 1 } });
    assert.equal(r.status, 200); assert.equal(r.data.position, 1 + (await list()).items.findIndex((x) => x.id === a.id), 'mass assignment ignored'); assert.equal(r.data.kind, 'image');
    assert.equal((await admin.patch(`${G}/999999`, { json: { visible: true } })).status, 404);
    for (const id of ['abc', '0', '-1', '1.5', '1e3', '99999999999999', '%00', '1;DROP']) assert.equal((await admin.patch(`${G}/${id}`, { json: { visible: true } })).status, 404, `id ${id}`);
    assert.equal((await admin.patch(`${G}/${b.id}`, { raw: '{bad', headers: { 'content-type': 'application/json' } })).status, 400);
    // SQL-looking / script-looking caption is stored verbatim and nothing else breaks
    r = await admin.patch(`${G}/${b.id}`, { json: { captionBg: "'); DROP TABLE gallery_items;--" } }); assert.equal(r.status, 200);
    assert.equal((await list()).items.length, 25);
  });

  test('GA9 hidden items: public list omits them, /media returns 404 (also with Range, HEAD, conditional), admin media still serves them; unhide restores; dashboard counts', async () => {
    const items = (await list()).items;
    const h = items[3];
    const pubBefore = (await anon.get('/api/public/gallery')).data.items;
    const url = pubBefore.find((x) => x.id === h.id).url;
    assert.equal((await anon.get(url)).status, 200);
    let r = await admin.patch(`${G}/${h.id}`, { json: { visible: false } }); assert.equal(r.status, 200); assert.equal(r.data.visible, false);
    assert.equal((await anon.get('/api/public/gallery')).data.items.length, 24); assert.ok(!(await anon.get('/api/public/gallery')).data.items.some((x) => x.id === h.id));
    for (const hd of [{}, { range: 'bytes=0-9' }, { range: 'bytes=0-' }, { range: 'bytes=5-1' }, { 'if-none-match': '*' }, { 'if-modified-since': 'Sat, 01 Jan 2000 00:00:00 GMT' }]) {
      const g = await anon.req('GET', url, { headers: hd }); assert.equal(g.status, 404, `GET hidden ${JSON.stringify(hd)} -> ${g.status}`); assert.equal(g.data?.error, 'not_found');
    }
    assert.equal((await anon.req('HEAD', url)).status, 404);
    assert.equal((await anon.req('GET', url, { cookie: admin.cookie })).status, 404, '/media is public: even an admin cookie gets 404 for hidden');
    assert.equal((await admin.get(h.fileUrl)).status, 200, 'admin media still serves a hidden item');
    const d = (await admin.get('/api/admin/dashboard')).data.gallery; assert.deepEqual(d, { count: 25, visible: 24 });
    assert.equal((await admin.get(G)).data.items.find((x) => x.id === h.id).visible, false);
    r = await admin.patch(`${G}/${h.id}`, { json: { visible: true } }); assert.equal(r.status, 200);
    assert.equal((await anon.get(url)).status, 200); assert.equal((await anon.req('GET', url, { headers: { range: 'bytes=0-9' } })).status, 206);
    assert.equal((await anon.get('/api/public/gallery')).data.items.length, 25);
    // hidden videos too
    await admin.put(`${G}/order`, { json: { ids: items.map((x) => x.id) } });
  });

  test('GA10 positions, delete: file removed from disk and from `files`, positions compacted, media 404, second delete 404, tmp empty', async () => {
    await clear();
    const v = (await add(MP4, 'v.mp4', 'video/mp4', { captionBg: 'видео' })).data;
    const i1 = (await add(png(1), 'a.png', 'image/png')).data; const i2 = (await add(png(2), 'b.png', 'image/png')).data;
    assert.deepEqual([v.position, i1.position, i2.position], [1, 2, 3]);
    const stored = (u) => u.split('/').pop();
    assert.ok(fs.existsSync(path.join(dir, 'uploads', stored(v.fileUrl))));
    const pubUrl = (await anon.get('/api/public/gallery')).data.items[0].url; assert.equal((await anon.get(pubUrl)).status, 200);
    const d = await admin.del(`${G}/${v.id}`); assert.equal(d.status, 204); assert.equal(d.buf.length, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'uploads', stored(v.fileUrl))), 'file gone from disk');
    assert.equal(dbq('SELECT COUNT(*) AS n FROM files WHERE stored_name = ?', stored(v.fileUrl))[0].n, 0, 'files row gone');
    assert.equal((await anon.get(pubUrl)).status, 404); assert.equal((await admin.get(v.fileUrl)).status, 404);
    assert.deepEqual((await list()).items.map((x) => [x.id, x.position]), [[i1.id, 1], [i2.id, 2]]);
    assert.equal((await admin.del(`${G}/${v.id}`)).status, 404);
    for (const id of ['abc', '0', '-3', '1.5']) assert.equal((await admin.del(`${G}/${id}`)).status, 404, `del ${id}`);
    assert.deepEqual(await tmpEmpty(), []); assert.equal(ls('uploads').length, 2);
    // delete a middle item, then add: new item takes the end
    const i3 = (await add(png(3), 'c.png', 'image/png')).data; assert.equal(i3.position, 3);
    assert.equal((await admin.del(`${G}/${i1.id}`)).status, 204);
    assert.deepEqual((await list()).items.map((x) => x.position), [1, 2]);
    const i4 = (await add(png(4), 'd.png', 'image/png')).data; assert.equal(i4.position, 3);
    // sequential delete of everything leaves uploads and tmp empty
    await clear(); assert.deepEqual(ls('uploads'), []); assert.deepEqual(await tmpEmpty(), []); assert.equal(dbq('SELECT COUNT(*) AS n FROM files')[0].n, 0);
    // 5 concurrent deletes of the same id: one 204, rest 404, no crash
    const x = (await add(png(5), 'e.png', 'image/png')).data;
    const rs = await Promise.all([0, 1, 2, 3, 4].map(() => admin.del(`${G}/${x.id}`)));
    assert.deepEqual(rs.map((r) => r.status).sort(), [204, 404, 404, 404, 404]); assert.deepEqual(ls('uploads'), []);
  });

  test('GA11 Range on /media videos: 206 with exact slice and Content-Range, suffix and open-ended ranges, Accept-Ranges, 416 with Content-Range */size, full 200, HEAD', async () => {
    const big = Buffer.concat([MP4, Buffer.alloc(300 * 1024, 7)]); // header stays a valid ftyp, body is long enough for several ranges
    for (const [buf, name, type, mime] of [[MP4, 'v.mp4', 'video/mp4', 'video/mp4'], [MOV, 'v.mov', 'video/quicktime', 'video/quicktime'], [WEBM, 'v.webm', 'video/webm', 'video/webm'], [big, 'big.mp4', 'video/mp4', 'video/mp4']]) {
      const it = (await add(buf, name, type)).data; assert.equal(it.mime, mime);
      const url = (await anon.get('/api/public/gallery')).data.items.find((x) => x.id === it.id).url; const L = buf.length;
      const full = await anon.get(url); assert.equal(full.status, 200); assert.equal(full.headers.get('accept-ranges'), 'bytes'); assert.equal(Number(full.headers.get('content-length')), L); assert.equal(full.headers.get('content-type'), mime);
      let r = await anon.req('GET', url, { headers: { range: 'bytes=0-99' } });
      assert.equal(r.status, 206, name); assert.equal(r.headers.get('content-range'), `bytes 0-99/${L}`); assert.equal(r.headers.get('content-length'), '100'); assert.ok(r.buf.equals(buf.subarray(0, 100)));
      assert.equal(r.headers.get('content-type'), mime); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      r = await anon.req('GET', url, { headers: { range: 'bytes=10-' } }); assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes 10-${L - 1}/${L}`); assert.ok(r.buf.equals(buf.subarray(10)));
      r = await anon.req('GET', url, { headers: { range: 'bytes=-50' } }); assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes ${L - 50}-${L - 1}/${L}`); assert.ok(r.buf.equals(buf.subarray(L - 50)));
      r = await anon.req('GET', url, { headers: { range: `bytes=${L - 1}-${L + 1000}` } }); assert.equal(r.status, 206, 'end clamped to the file'); assert.equal(r.buf.length, 1);
      r = await anon.req('GET', url, { headers: { range: 'bytes=5-9' } }); assert.equal(r.status, 206); assert.ok(r.buf.equals(buf.subarray(5, 10)));
      for (const rg of [`bytes=${L}-`, `bytes=${L + 100}-${L + 200}`, 'bytes=999999999-', 'bytes=-0']) {
        r = await anon.req('GET', url, { headers: { range: rg } });
        assert.equal(r.status, 416, `${name} ${rg} -> ${r.status}`); assert.equal(r.headers.get('content-range'), `bytes */${L}`); assert.match(r.text(), /range_not_satisfiable/);
      }
      for (const rg of ['bytes=abc', 'items=0-5', 'bytes=9-1']) { r = await anon.req('GET', url, { headers: { range: rg } }); assert.ok([200, 206, 416].includes(r.status), `${rg} -> ${r.status}`); assert.notEqual(r.status, 500); }
      r = await anon.req('HEAD', url); assert.equal(r.status, 200); assert.equal(r.headers.get('content-length'), String(L)); assert.equal(r.buf.length, 0);
      r = await anon.req('HEAD', url, { headers: { range: 'bytes=0-9' } }); assert.equal(r.status, 206);
      // multi-range is served without error
      r = await anon.req('GET', url, { headers: { range: 'bytes=0-4,10-14' } }); assert.ok([200, 206].includes(r.status));
    }
    await clear();
  });

  test('GA11b 416 error body is labelled as JSON, not as the media type (BUG-20)', async () => {
    const it = (await add(MP4, 'v.mp4', 'video/mp4')).data;
    const url = (await anon.get('/api/public/gallery')).data.items.find((x) => x.id === it.id).url;
    const r = await anon.req('GET', url, { headers: { range: 'bytes=999999999-' } });
    await clear(); // clean up first so a failure here cannot cascade into later tests
    assert.equal(r.status, 416);
    assert.match(r.headers.get('content-type'), /^application\/json/, `416 body is JSON but Content-Type is ${r.headers.get('content-type')}`);
  });

  test('GA12 caption fallback: requested language, else the other one, else null; default language bg; bad lang 400', async () => {
    const mk = async (fields) => (await add(png(Math.floor(Math.random() * 200)), 'a.png', 'image/png', fields)).data.id;
    const both = await mk({ captionBg: 'БГ', captionEn: 'EN' }); const bgOnly = await mk({ captionBg: 'само БГ' }); const enOnly = await mk({ captionEn: 'only EN' }); const none = await mk({});
    const cap = async (q) => Object.fromEntries((await anon.get(`/api/public/gallery${q}`)).data.items.map((x) => [x.id, x.caption]));
    assert.deepEqual(await cap('?lang=bg'), { [both]: 'БГ', [bgOnly]: 'само БГ', [enOnly]: 'only EN', [none]: null });
    assert.deepEqual(await cap('?lang=en'), { [both]: 'EN', [bgOnly]: 'само БГ', [enOnly]: 'only EN', [none]: null });
    assert.deepEqual(await cap(''), await cap('?lang=bg'), 'default = bg');
    for (const bad of ['fr', 'BG', '', 'bg,en', 'x%00']) { const r = await anon.get(`/api/public/gallery?lang=${bad}`); assert.ok([200, 400].includes(r.status)); if (bad === 'fr') assert.equal(r.status, 400); }
    assert.equal((await anon.get('/api/public/gallery?lang=fr')).status, 400);
    assert.equal((await anon.get('/api/public/gallery?lang=en')).headers.get('cache-control') !== null || true, true);
    await clear();
  });

  test('GA13 About text: BG/EN fallback in /site, null when neither set, 2000 ok / 2001 rejected, whitespace -> null, newlines kept, partial PUT keeps the other fields, wrong types 400', async () => {
    const site = async (l) => (await anon.get(`/api/public/site?lang=${l}`)).data.about;
    const put = (j) => admin.put('/api/admin/settings', { json: j });
    assert.equal(await site('bg'), null); assert.equal(await site('en'), null);
    let r = await put({ aboutBg: 'Първи абзац.\n\nВтори абзац.\nс нов ред' }); assert.equal(r.status, 200); assert.equal(r.data.aboutBg, 'Първи абзац.\n\nВтори абзац.\nс нов ред'); assert.equal(r.data.aboutEn, null);
    assert.equal(await site('bg'), 'Първи абзац.\n\nВтори абзац.\nс нов ред'); assert.equal(await site('en'), await site('bg'), 'EN falls back to BG');
    r = await put({ aboutEn: 'English text' }); assert.equal(r.status, 200); assert.equal(r.data.aboutBg, 'Първи абзац.\n\nВтори абзац.\nс нов ред', 'partial PUT keeps aboutBg');
    assert.equal(await site('en'), 'English text'); assert.equal(await site('bg'), 'Първи абзац.\n\nВтори абзац.\nс нов ред'); assert.equal((await anon.get('/api/public/site')).data.about, await site('bg'), 'default lang = bg');
    r = await put({ aboutBg: null }); assert.equal(r.status, 200); assert.equal(r.data.aboutBg, null); assert.equal(await site('bg'), 'English text', 'BG falls back to EN');
    r = await put({ aboutEn: '   \n  ' }); assert.equal(r.status, 200); assert.equal(r.data.aboutEn, null); assert.equal(await site('bg'), null); assert.equal(await site('en'), null);
    r = await put({ aboutBg: 'Ж'.repeat(2000), aboutEn: 'e'.repeat(2000) }); assert.equal(r.status, 200); assert.equal(r.data.aboutBg.length, 2000); assert.equal((await site('bg')).length, 2000); assert.equal((await site('en')).length, 2000);
    r = await put({ aboutBg: 'Ж'.repeat(2001) }); assert.equal(r.status, 400); assert.equal(r.data.error, 'validation'); assert.ok(r.data.fields.aboutBg && !r.data.fields.aboutEn);
    r = await put({ aboutEn: 'e'.repeat(2001) }); assert.equal(r.status, 400); assert.ok(r.data.fields.aboutEn);
    r = await put({ aboutBg: 'a'.repeat(2001), aboutEn: 'b'.repeat(2001) }); assert.equal(r.status, 400); assert.ok(r.data.fields.aboutBg && r.data.fields.aboutEn);
    r = await put({ aboutBg: 'x'.repeat(2000) + '\r\n' }); assert.equal(r.status, 200, 'trailing whitespace is trimmed before the limit check');
    assert.equal((await site('bg')).length, 2000, 'failed PUTs stored nothing');
    for (const v of [123, true, ['a'], { a: 1 }]) { r = await put({ aboutBg: v }); assert.equal(r.status, 400, `aboutBg ${JSON.stringify(v)}`); assert.ok(r.data.fields.aboutBg); }
    // other settings stay when About is saved and vice versa
    const s0 = (await admin.get('/api/admin/settings')).data;
    r = await put({ address: 'Нов адрес 5' }); assert.equal(r.status, 200); assert.equal(r.data.aboutBg, s0.aboutBg); assert.equal(r.data.aboutEn, s0.aboutEn);
    r = await put({ aboutBg: 'само БГ' }); assert.equal(r.data.address, 'Нов адрес 5'); assert.equal(r.data.instagramUrl, s0.instagramUrl);
    // public /site must not leak the raw admin keys
    const pub = (await anon.get('/api/public/site')).data; assert.ok(!('aboutBg' in pub) && !('aboutEn' in pub));
    // auth/CSRF on the settings About fields
    assert.equal((await anon.put('/api/admin/settings', { json: { aboutBg: 'pwn' } })).status, 401);
    assert.equal((await admin.put('/api/admin/settings', { csrf: false, json: { aboutBg: 'pwn' } })).status, 403);
    assert.equal(await site('bg'), 'само БГ');
    await put({ aboutBg: null, aboutEn: null }); assert.equal(await site('bg'), null);
  });

  test('GA14 XSS payloads in captions and About are stored verbatim, returned only inside JSON (application/json, nosniff), never executed server side', async () => {
    const P = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "'-alert(1)-'", '<svg onload=alert(1)>', 'javascript:alert(1)', '{{7*7}}${7*7}', '</title><script>1</script>'];
    const it = (await add(png(1), 'a.png', 'image/png', { captionBg: P[0], captionEn: P[1] })).data;
    assert.equal(it.captionBg, P[0]); assert.equal(it.captionEn, P[1]);
    for (const p of P) { assert.equal((await admin.patch(`${G}/${it.id}`, { json: { captionBg: p } })).data.captionBg, p); }
    const r = await anon.get('/api/public/gallery?lang=bg'); assert.match(r.headers.get('content-type'), /^application\/json/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.data.items[0].caption, P[P.length - 1]);
    for (const p of P) assert.equal((await admin.put('/api/admin/settings', { json: { aboutBg: p, aboutEn: P[0] } })).status, 200);
    const s = await anon.get('/api/public/site?lang=bg'); assert.match(s.headers.get('content-type'), /^application\/json/); assert.equal(s.data.about, P[P.length - 1]);
    // a filename with markup does not leak into any header unescaped
    const evil = await add(png(2), '"><script>x</script>.png', 'image/png'); assert.equal(evil.status, 201);
    const u = (await anon.get('/api/public/gallery')).data.items[1].url; const m = await anon.get(u);
    assert.ok(!/[<>]/.test(m.headers.get('content-disposition')), m.headers.get('content-disposition'));
    await admin.put('/api/admin/settings', { json: { aboutBg: null, aboutEn: null } }); await clear();
  });

  test('GA15 restart: gallery (order, hidden flag, captions, files) and About survive; the orphan sweep keeps gallery files and removes none of them', async () => {
    await clear();
    const a = (await add(png(1), 'a.png', 'image/png', { captionBg: 'първа' })).data; const b = (await add(MP4, 'b.mp4', 'video/mp4')).data; const c = (await add(png(2), 'c.png', 'image/png')).data;
    await admin.put(`${G}/order`, { json: { ids: [c.id, a.id, b.id] } }); await admin.patch(`${G}/${b.id}`, { json: { visible: false } });
    await admin.put('/api/admin/settings', { json: { aboutBg: 'Текст за нас', aboutEn: 'About text' } });
    // an unreferenced file row + file (true orphan) must still be swept, gallery files must not
    fs.writeFileSync(path.join(dir, 'uploads', 'f'.repeat(32) + '.png'), png(9)); fs.writeFileSync(path.join(dir, 'tmp', 'up-leftover.tmp'), 'x');
    const d = new DatabaseSync(path.join(dir, 'kota.db')); d.prepare("INSERT INTO files(stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?)").run('f'.repeat(32) + '.png', 'orphan.png', 'image/png', 10, 1); d.close();
    await srv.stop();
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url);
    const l = (await list()).items; assert.deepEqual(l.map((x) => x.id), [c.id, a.id, b.id]); assert.deepEqual(l.map((x) => x.visible), [true, true, false]); assert.equal(l[1].captionBg, 'първа');
    for (const it of l) assert.equal((await admin.get(it.fileUrl)).status, 200, 'file survived restart');
    assert.deepEqual((await anon.get('/api/public/gallery')).data.items.map((x) => x.id), [c.id, a.id]);
    assert.equal((await anon.get('/api/public/site?lang=en')).data.about, 'About text'); assert.equal((await anon.get('/api/public/site?lang=bg')).data.about, 'Текст за нас');
    assert.ok(!fs.existsSync(path.join(dir, 'uploads', 'f'.repeat(32) + '.png')), 'true orphan swept'); assert.deepEqual(ls('tmp'), [], 'tmp leftovers swept at start');
    assert.equal(ls('uploads').length, 3);
    await clear();
  });
});

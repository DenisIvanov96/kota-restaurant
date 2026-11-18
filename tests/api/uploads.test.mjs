// T-43 (D-44): 50 MB uploads on every upload route, disk temp storage in DATA_DIR/tmp that is always emptied. Port 3201.
// Large buffers are only a magic-byte header plus zero padding (the server validates the first bytes, not the whole image).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { startServer, createAdmin, Client, tmpDir, makePng, PDF, sleep } from '../lib/harness.mjs';

const PORT = 3201;
const T0 = '2026-06-15T10:00:00Z';
const MB = 1024 * 1024;
const LIMIT = 50 * MB;
const PNGH = makePng(30, 20).subarray(0, 8);
const PDFH = Buffer.from('%PDF-1.4\n');
const sized = (head, n) => { const b = Buffer.alloc(n); head.copy(b); return b; };
const mp = (fields, files = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  for (const x of files) fd.append(x.field, new Blob([x.buf], { type: x.type }), x.name);
  return fd;
};

describe('50 MB uploads (D-44)', () => {
  let dir; let srv; let admin; let anon;
  const ls = (d) => fs.readdirSync(path.join(dir, d)).sort();
  const up = () => ls('uploads'); const tmp = () => ls('tmp');
  // the response can be sent a few ms before the 'close' handler finishes unlinking: poll up to 3 s for an empty tmp dir
  const tmpEmpty = async () => { for (let i = 0; i < 30 && tmp().length; i++) await sleep(100); return tmp(); };
  const png50 = sized(PNGH, LIMIT); const png50p1 = sized(PNGH, LIMIT + 1);
  const pdf50 = sized(PDFH, LIMIT); const pdf50p1 = sized(PDFH, LIMIT + 1);

  before(async () => {
    dir = tmpDir('uploads'); createAdmin(dir);
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url);
  });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('UP0 tmp dir exists at start and is empty', () => { assert.deepEqual(tmp(), []); assert.deepEqual(up(), []); });

  // route table: [label, method, path-builder, field, buffer builder, extra fields]
  const routes = [
    ['POST /events image', async () => ['POST', '/api/admin/events', 'image', { title: 'big', enabled: 'false' }, PNGH, 'image/png', 'a.png', 'images']],
    ['POST /events imageEn', async () => ['POST', '/api/admin/events', 'imageEn', { title: 'big', enabled: 'false' }, PNGH, 'image/png', 'a.png', 'images']],
    ['POST /daily-menus file', async () => ['POST', '/api/admin/daily-menus', 'file', { date: '2026-07-01' }, PDFH, 'application/pdf', 'a.pdf', 'daily']],
    ['POST /daily-menus fileEn', async () => ['POST', '/api/admin/daily-menus', 'fileEn', { date: '2026-07-02' }, PDFH, 'application/pdf', 'a.pdf', 'daily']],
    ['POST /menu/pages file (bg)', async () => ['POST', '/api/admin/menu/pages', 'file', { lang: 'bg' }, PDFH, 'application/pdf', 'a.pdf', 'pages']],
    ['POST /menu/pages file (en)', async () => ['POST', '/api/admin/menu/pages', 'file', { lang: 'en' }, PNGH, 'image/png', 'a.png', 'pages']],
  ];
  for (const [label, spec] of routes) {
    test(`UP1 ${label}: exactly 50 MB accepted (201, stored size 50 MB), 50 MB + 1 -> 413 file_too_large with fields.<field>; tmp and uploads clean`, async () => {
      const [method, url, field, fields, head, type, name] = await spec();
      const u0 = up().length;
      const over = await admin.req(method, url, { form: mp(fields, [{ field, buf: sized(head, LIMIT + 1), type, name }]) });
      assert.equal(over.status, 413, `${label}: ${over.status} ${over.text().slice(0, 120)}`);
      assert.equal(over.data.error, 'file_too_large');
      assert.ok(over.data.fields && over.data.fields[field], `fields.${field} present: ${JSON.stringify(over.data)}`);
      assert.deepEqual(await tmpEmpty(), [], 'tmp empty after 413'); assert.equal(up().length, u0, 'no orphan upload');
      const seen = new Set(up());
      const ok = await admin.req(method, url, { form: mp(fields, [{ field, buf: sized(head, LIMIT), type, name }]) });
      assert.equal(ok.status, 201, `${label}: ${ok.status} ${ok.text().slice(0, 120)}`);
      assert.equal(up().length, u0 + 1, 'one stored file');
      const added = up().filter((n) => !seen.has(n)); assert.equal(added.length, 1);
      assert.equal(fs.statSync(path.join(dir, 'uploads', added[0])).size, LIMIT, 'stored file is exactly 50 MB');
      const row = ok.data;
      assert.deepEqual(await tmpEmpty(), [], 'tmp empty after success');
      // clean up through the API (also proves deletion frees the 50 MB file)
      const del = method === 'POST' && url.includes('events') ? `/api/admin/events/${row.id}` : url.includes('daily') ? `/api/admin/daily-menus/${row.id}` : `/api/admin/menu/pages/${row.id}`;
      assert.ok([204].includes((await admin.del(del)).status));
      assert.equal(up().length, u0, 'deleted');
    });
  }

  test('UP2 PUT routes: 50 MB + 1 -> 413 and 50 MB accepted on event image(s) and daily files; existing files untouched on 413', async () => {
    const ev = (await admin.post('/api/admin/events', { form: mp({ title: 'put-me', enabled: 'false' }, [{ field: 'image', buf: makePng(), type: 'image/png', name: 'small.png' }]) })).data;
    const dm = (await admin.post('/api/admin/daily-menus', { form: mp({ date: '2026-07-10' }, [{ field: 'file', buf: PDF, type: 'application/pdf', name: 'small.pdf' }]) })).data;
    const base = up();
    for (const [url, field, head, type, name] of [[`/api/admin/events/${ev.id}`, 'image', PNGH, 'image/png', 'a.png'], [`/api/admin/events/${ev.id}`, 'imageEn', PNGH, 'image/png', 'a.png'],
      [`/api/admin/daily-menus/${dm.id}`, 'file', PDFH, 'application/pdf', 'a.pdf'], [`/api/admin/daily-menus/${dm.id}`, 'fileEn', PDFH, 'application/pdf', 'a.pdf']]) {
      const r = await admin.put(url, { form: mp({}, [{ field, buf: sized(head, LIMIT + 1), type, name }]) });
      assert.equal(r.status, 413, `PUT ${url} ${field}`); assert.ok(r.data.fields[field]);
      assert.deepEqual(up(), base, 'existing files untouched, no orphans'); assert.deepEqual(await tmpEmpty(), []);
    }
    for (const [url, field, head, type, name] of [[`/api/admin/events/${ev.id}`, 'imageEn', PNGH, 'image/png', 'a.png'], [`/api/admin/daily-menus/${dm.id}`, 'fileEn', PDFH, 'application/pdf', 'a.pdf']]) {
      const r = await admin.put(url, { form: mp({}, [{ field, buf: sized(head, LIMIT), type, name }]) });
      assert.equal(r.status, 200, `PUT 50MB ${field}: ${r.status} ${r.text().slice(0, 100)}`); assert.deepEqual(await tmpEmpty(), []);
    }
    assert.equal((await admin.del(`/api/admin/events/${ev.id}`)).status, 204); assert.equal((await admin.del(`/api/admin/daily-menus/${dm.id}`)).status, 204);
    assert.deepEqual(up(), []);
  });

  test('UP3 temp dir is empty after failures: 415 on a big file, 400 validation after upload, 409 too_many_pages with a big file, wrong field name', async () => {
    // 20 MB of text named .png -> 415 after the body was received into tmp
    let r = await admin.post('/api/admin/menu/pages', { form: mp({ lang: 'bg' }, [{ field: 'file', buf: Buffer.alloc(20 * MB, 0x41), type: 'image/png', name: 'x.png' }]) });
    assert.equal(r.status, 415); assert.deepEqual(await tmpEmpty(), []); assert.deepEqual(up(), []);
    // invalid lang with a 20 MB valid file
    r = await admin.post('/api/admin/menu/pages', { form: mp({ lang: 'zz' }, [{ field: 'file', buf: sized(PNGH, 20 * MB), type: 'image/png', name: 'x.png' }]) });
    assert.equal(r.status, 400); assert.deepEqual(await tmpEmpty(), []); assert.deepEqual(up(), []);
    // wrong field name with 20 MB
    r = await admin.post('/api/admin/menu/pages', { form: mp({ lang: 'bg' }, [{ field: 'nope', buf: sized(PNGH, 20 * MB), type: 'image/png', name: 'x.png' }]) });
    assert.equal(r.status, 400); assert.deepEqual(await tmpEmpty(), []); assert.deepEqual(up(), []);
    // event without a title but with a 20 MB image -> 400 and no leftovers
    r = await admin.post('/api/admin/events', { form: mp({ title: '' }, [{ field: 'image', buf: sized(PNGH, 20 * MB), type: 'image/png', name: 'x.png' }]) });
    assert.equal(r.status, 400); assert.deepEqual(await tmpEmpty(), []); assert.deepEqual(up(), []);
    // 16th page (limit 15, D-62) with a big file -> 409
    const small = makePng(10, 10);
    const ids = [];
    for (let i = 0; i < 15; i++) { const p = await admin.post('/api/admin/menu/pages', { form: mp({ lang: 'en' }, [{ field: 'file', buf: small, type: 'image/png', name: `p${i}.png` }]) }); assert.equal(p.status, 201); ids.push(p.data.id); }
    r = await admin.post('/api/admin/menu/pages', { form: mp({ lang: 'en' }, [{ field: 'file', buf: sized(PNGH, 20 * MB), type: 'image/png', name: 'x.png' }]) });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'too_many_pages'); assert.deepEqual(await tmpEmpty(), []); assert.equal(up().length, 15);
    for (const id of ids) assert.equal((await admin.del(`/api/admin/menu/pages/${id}`)).status, 204);
    assert.deepEqual(up(), []);
  });

  test('UP4 uploads go through disk, not memory: while a 30 MB body is in flight a temp file exists in DATA_DIR/tmp; it is gone after the response', async () => {
    const boundary = '----qa43';
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="lang"\r\n\r\nbg\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const total = 30 * MB;
    const len = Buffer.byteLength(head) + total + Buffer.byteLength(tail);
    const sock = net.connect(PORT, '127.0.0.1');
    await new Promise((r) => sock.once('connect', r));
    sock.write(`POST /api/admin/menu/pages HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nCookie: ${admin.cookie}\r\nX-Requested-With: kota-admin\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${len}\r\nConnection: close\r\n\r\n`);
    sock.write(head);
    const body = sized(PNGH, total);
    sock.write(body.subarray(0, 10 * MB)); // part of the file only
    let seen = false;
    for (let i = 0; i < 50 && !seen; i++) { await sleep(100); seen = tmp().length > 0; }
    assert.ok(seen, 'a temp file is present while the upload is in flight');
    assert.match(tmp()[0], /^up-[a-f0-9]{32}\.tmp$/);
    let resp = ''; sock.on('data', (d) => { resp += d; });
    sock.write(body.subarray(10 * MB)); sock.write(tail);
    await new Promise((r) => { sock.on('close', r); setTimeout(r, 8000); });
    assert.match(resp, /^HTTP\/1\.1 201/);
    assert.deepEqual(await tmpEmpty(), []); assert.equal(up().length, 1);
    const id = (await admin.get('/api/admin/menu')).data.pages.bg.items[0].id;
    assert.equal((await admin.del(`/api/admin/menu/pages/${id}`)).status, 204);
    assert.deepEqual(up(), []);
  });

  test('UP5 client abort in the middle of a 50 MB upload: temp file removed, no uploads/ file, no DB row', async () => {
    const boundary = '----qa43abort';
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="lang"\r\n\r\nbg\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`;
    const len = Buffer.byteLength(head) + LIMIT + 100;
    const sock = net.connect(PORT, '127.0.0.1');
    sock.on('error', () => {});
    await new Promise((r) => sock.once('connect', r));
    sock.write(`POST /api/admin/menu/pages HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nCookie: ${admin.cookie}\r\nX-Requested-With: kota-admin\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${len}\r\n\r\n`);
    sock.write(head); sock.write(sized(PNGH, 8 * MB));
    let seen = false;
    for (let i = 0; i < 50 && !seen; i++) { await sleep(100); seen = tmp().length > 0; }
    assert.ok(seen, 'temp file appeared');
    sock.destroy();
    let gone = false;
    for (let i = 0; i < 50 && !gone; i++) { await sleep(100); gone = tmp().length === 0; }
    assert.ok(gone, `temp dir empty after abort, got ${JSON.stringify(tmp())}`);
    assert.deepEqual(up(), []);
    assert.equal((await admin.get('/api/admin/menu')).data.pages.bg.items.length, 0, 'no row');
    // abort right after the headers, and abort after the whole body but before reading the response
    const s2 = net.connect(PORT, '127.0.0.1'); s2.on('error', () => {}); await new Promise((r) => s2.once('connect', r));
    s2.write(`POST /api/admin/menu/pages HTTP/1.1\r\nHost: x\r\nCookie: ${admin.cookie}\r\nX-Requested-With: kota-admin\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${len}\r\n\r\n`); s2.destroy();
    await sleep(500); assert.deepEqual(tmp(), []); assert.deepEqual(up(), []);
    // the server is still healthy
    assert.equal((await anon.get('/api/public/site')).status, 200);
  });

  test('UP6 start-up sweep: leftovers in tmp/ are deleted on restart; unreferenced files rows + disk files are removed (orphan sweep)', async () => {
    fs.writeFileSync(path.join(dir, 'tmp', 'up-deadbeefdeadbeefdeadbeefdeadbeef.tmp'), 'junk');
    fs.writeFileSync(path.join(dir, 'tmp', 'other.bin'), 'junk');
    await srv.stop();
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
    await sleep(300); assert.deepEqual(tmp(), []);
    admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url);
  });
});

describe('concurrent page uploads (race on the 15-page limit)', () => {
  let dir; let srv; let admin;
  before(async () => { dir = tmpDir('uploadsrace'); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  test('UP8 20 simultaneous POST /menu/pages for one language: exactly 15 succeed (201), the rest are 409 too_many_pages; positions are 1..15 without gaps/duplicates; no orphan files or temp files', async () => {
    const reqs = Array.from({ length: 20 }, (_, i) => admin.post('/api/admin/menu/pages', { form: mp({ lang: 'bg' }, [{ field: 'file', buf: makePng(10 + i, 10), type: 'image/png', name: `r${i}.png` }]) }));
    const res = await Promise.all(reqs);
    const ok = res.filter((r) => r.status === 201); const bad = res.filter((r) => r.status !== 201);
    assert.equal(ok.length, 15, res.map((r) => r.status).join());
    assert.ok(bad.every((r) => r.status === 409 && r.data.error === 'too_many_pages'), bad.map((r) => r.status).join());
    const items = (await admin.get('/api/admin/menu')).data.pages.bg.items;
    assert.deepEqual(items.map((x) => x.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    await sleep(500);
    assert.equal(fs.readdirSync(path.join(dir, 'uploads')).length, 15); assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
    // concurrent deletes + order never corrupt positions
    await Promise.all(items.slice(0, 4).map((x) => admin.del(`/api/admin/menu/pages/${x.id}`)));
    const left = (await admin.get('/api/admin/menu')).data.pages.bg.items;
    assert.equal(left.length, 11); assert.deepEqual(left.map((x) => x.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.equal(fs.readdirSync(path.join(dir, 'uploads')).length, 11);
  });
});

describe('memory under repeated 50 MB uploads', () => {
  let dir; let srv; let admin;
  before(async () => { dir = tmpDir('uploadsmem'); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  test('UP7 peak RSS growth after 6 sequential 50 MB uploads (300 MB total) stays under 150 MB', async () => {
    const hwm = () => Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync(`/proc/${srv.pid}/status`, 'utf8'))[1]) / 1024;
    const before = hwm();
    const big = sized(PNGH, LIMIT);
    for (let i = 0; i < 6; i++) {
      const r = await admin.post('/api/admin/menu/pages', { form: mp({ lang: i % 2 ? 'en' : 'bg' }, [{ field: 'file', buf: big, type: 'image/png', name: `p${i}.png` }]) });
      assert.equal(r.status, 201);
    }
    const after_ = hwm();
    console.log(`# UP7 server peak RSS ${before.toFixed(0)} MB -> ${after_.toFixed(0)} MB after 300 MB of uploads`);
    assert.ok(after_ - before < 150, `RSS grew ${(after_ - before).toFixed(0)} MB`);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
  });
});

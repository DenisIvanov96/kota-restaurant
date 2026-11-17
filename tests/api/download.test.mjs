// T-43 / T-46 (D-49): menu download is ADMIN-ONLY: GET /api/admin/menu/pages/download?lang= (ZIP of all pages of a language); the public endpoint is gone. Port 3203.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { startServer, createAdmin, Client, tmpDir, makePng, PDF, WEBP, SCRATCH, sleep } from '../lib/harness.mjs';

const PORT = 3203;
const T0 = '2026-06-15T10:00:00Z';
const MB = 1024 * 1024;
const mp = (fields, files = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  for (const x of files) fd.append(x.field, new Blob([x.buf], { type: x.type }), x.name);
  return fd;
};
const png = (c) => makePng(30, 20, c);
const PNG_A = png([200, 10, 10]); const PNG_B = png([10, 200, 10]);
const PDF_A = Buffer.concat([PDF, Buffer.from('%page-two\n')]);
const WEBP_A = Buffer.concat([WEBP, Buffer.alloc(100, 7)]);

/** Independent ZIP reader: End Of Central Directory -> central directory -> local headers; verifies CRC32 with zlib.crc32. */
export function readZip(buf) {
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, 'EOCD signature at the end (no comment)');
  const count = buf.readUInt16LE(eocd + 10); const cdSize = buf.readUInt32LE(eocd + 12); const cdOff = buf.readUInt32LE(eocd + 16);
  assert.equal(cdOff + cdSize, eocd, 'central directory ends at EOCD');
  const out = []; let p = cdOff;
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central header ' + i);
    const method = buf.readUInt16LE(p + 10); const crc = buf.readUInt32LE(p + 16); const csize = buf.readUInt32LE(p + 20); const usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28); const el = buf.readUInt16LE(p + 30); const cl = buf.readUInt16LE(p + 32); const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    assert.equal(buf.readUInt32LE(off), 0x04034b50, 'local header ' + name);
    const lnl = buf.readUInt16LE(off + 26); const lel = buf.readUInt16LE(off + 28);
    assert.equal(buf.subarray(off + 30, off + 30 + lnl).toString('utf8'), name, 'local name = central name');
    assert.equal(buf.readUInt32LE(off + 14), crc, 'local crc = central crc'); assert.equal(buf.readUInt32LE(off + 22), usize);
    const data = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
    assert.equal(method, 0, 'stored'); assert.equal(csize, usize);
    assert.equal(zlib.crc32(data) >>> 0, crc, 'CRC32 of entry data matches header: ' + name);
    out.push({ name, data, crc });
    p += 46 + nl + el + cl;
  }
  assert.equal(p, cdOff + cdSize);
  return out;
}

/** GET that can pause: returns { res, headers, readAll() } using node:http so the body can be consumed slowly. */
function rawGet(url, { method = 'GET', cookie } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: cookie ? { cookie } : {} }, (res) => resolve({ res, req }));
    req.on('error', reject); req.end();
  });
}

describe('admin menu download (D-49)', () => {
  let dir; let srv; let admin; let anon;
  const up = () => fs.readdirSync(path.join(dir, 'uploads'));
  const AD = '/api/admin/menu/pages/download';
  const dl = (q = '', o) => admin.get(`${AD}${q}`, o);
  const pubdl = (q = '', o) => anon.get(`/api/public/menu/download${q}`, o);
  const addPage = async (lang, buf, name, type) => { const r = await admin.post('/api/admin/menu/pages', { form: mp({ lang }, [{ field: 'file', buf, name, type }]) }); assert.equal(r.status, 201, r.text().slice(0, 150)); return r.data; };
  const setPub = (lang, published) => admin.put('/api/admin/menu/pages/published', { json: { lang, published } });
  const fdCount = (pid) => fs.readdirSync(`/proc/${pid}/fd`).length;

  before(async () => { dir = tmpDir('dl'); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('DL1 the public download endpoint is gone: GET/HEAD (any lang, with or without live pages) -> 404 not_found JSON, never a ZIP; other methods 4xx', async () => {
    const check = async (label) => {
      for (const q of ['', '?lang=bg', '?lang=en']) {
        const r = await pubdl(q); assert.equal(r.status, 404, `${label} GET ${q} -> ${r.status}`);
        assert.notEqual(r.headers.get('content-type'), 'application/zip'); assert.equal(r.headers.get('content-disposition'), null);
        const h = await anon.req('HEAD', `/api/public/menu/download${q}`); assert.equal(h.status, 404, `${label} HEAD ${q} -> ${h.status}`);
      }
      // a bad ?lang is rejected by the public router's generic lang check (400) like on any public route; never a ZIP
      const bad = await pubdl('?lang=fr'); assert.ok([400, 404].includes(bad.status)); assert.notEqual(bad.headers.get('content-type'), 'application/zip');
      for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) { const r = await anon.req(m, '/api/public/menu/download?lang=bg', { csrf: false }); assert.ok(r.status >= 400 && r.status < 500, `${m} -> ${r.status}`); }
    };
    await check('fresh DB');
    // with live published pages in file mode (the old precondition for a 200)
    await admin.put('/api/admin/menu/draft', { json: { categories: [{ name: 'К', items: [{ name: 'Я', description: '', priceCents: 100, available: true }] }] } });
    await admin.post('/api/admin/menu/publish');
    pg = [await addPage('bg', PNG_A, 'първа.png', 'image/png'), await addPage('bg', PDF_A, 'second.pdf', 'application/pdf'), await addPage('bg', WEBP_A, 'third.webp', 'image/webp')];
    await setPub('bg', true);
    assert.equal((await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } })).status, 200);
    assert.equal((await anon.get('/api/public/menu?lang=bg')).data.file.pages.length, 3, 'precondition: 3 live public pages');
    await check('3 live pages, mode=file');
    // the public menu JSON does not advertise a download either
    assert.doesNotMatch((await anon.get('/api/public/menu?lang=bg')).text(), /download/i);
    // an authenticated admin session does not resurrect the public route
    assert.equal((await pubdl('?lang=bg', { cookie: admin.cookie })).status, 404);
    await admin.put('/api/admin/menu/mode', { json: { mode: 'structured' } }); await setPub('bg', false);
  });
  let pg;

  test('DL2 auth: no session -> 401 unauthorized for GET and HEAD (also forged cookies, also with an invalid/missing lang: auth comes first); no body/ZIP bytes leak', async () => {
    for (const q of ['', '?lang=bg', '?lang=en', '?lang=fr', '?lang=../../etc/passwd']) {
      const r = await anon.get(`${AD}${q}`); assert.equal(r.status, 401, `${q} -> ${r.status}`); assert.equal(r.data.error, 'unauthorized');
      assert.notEqual(r.headers.get('content-type'), 'application/zip'); assert.equal(r.headers.get('content-disposition'), null);
      const h = await anon.req('HEAD', `${AD}${q}`); assert.equal(h.status, 401, `HEAD ${q} -> ${h.status}`);
    }
    for (const c of ['kota_session=garbage', 'kota_session=' + 'A'.repeat(43), 'kota_session=']) assert.equal((await anon.get(`${AD}?lang=bg`, { cookie: c })).status, 401, c);
    // a session that was logged out is dead
    const c2 = new Client(srv.url); await c2.login(); assert.equal((await c2.get(`${AD}?lang=bg`)).status, 200);
    const stale = c2.cookie; assert.equal((await c2.post('/api/admin/logout')).status, 204);
    assert.equal((await anon.get(`${AD}?lang=bg`, { cookie: stale })).status, 401, 'logged-out session cookie rejected');
  });

  test('DL3 404 not_found for a language with no pages (no fallback to the other language), and for a fresh DB with the default lang', async () => {
    // pg are in BG (unpublished); EN has none
    assert.equal((await dl('?lang=en')).status, 404); assert.equal((await dl('?lang=en')).data.error, 'not_found');
    const tmp = new Client(srv.url); await tmp.login();
    for (const x of pg) assert.equal((await admin.del(`/api/admin/menu/pages/${x.id}`)).status, 204);
    for (const q of ['', '?lang=bg', '?lang=en']) { const r = await dl(q); assert.equal(r.status, 404, `${q} -> ${r.status}`); assert.equal(r.data.error, 'not_found'); assert.notEqual(r.headers.get('content-type'), 'application/zip'); }
    assert.equal((await admin.req('HEAD', `${AD}?lang=bg`)).status, 404);
    assert.deepEqual(up(), []);
  });

  test('DL4 bad lang with a session -> 400 validation with fields.lang (never 500, no file system access, no leakage)', async () => {
    for (const q of ['?lang=fr', '?lang=', '?lang=BG', '?lang=bg,en', '?lang=bg%00', '?lang=../../etc/passwd', '?lang=..%2f..%2fapp', '?lang=bg&lang=en', '?lang=%2e%2e', `?lang=${'a'.repeat(5000)}`]) {
      const r = await dl(q); assert.equal(r.status, 400, `${q.slice(0, 40)} -> ${r.status}`);
      assert.equal(r.data.error, 'validation', q.slice(0, 40)); assert.ok(r.data.fields && r.data.fields.lang, `fields.lang for ${q.slice(0, 40)}`);
      assert.doesNotMatch(r.text(), /etc\/passwd|ENOENT|stack|at \w+ \(/);
    }
  });

  test('DL5 3 pages (png, pdf, webp) UNPUBLISHED and mode=structured: ZIP headers, size, entries in page order, CRCs, bytes identical, default lang = bg, HEAD', async () => {
    pg = [await addPage('bg', PNG_A, 'първа.png', 'image/png'), await addPage('bg', PDF_A, 'second.pdf', 'application/pdf'), await addPage('bg', WEBP_A, 'third.webp', 'image/webp')];
    const pubState = (await admin.get('/api/admin/menu')).data; assert.equal(pubState.pages.bg.published, false); assert.equal(pubState.mode, 'structured');
    const r = await dl('?lang=bg');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/zip');
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="kota1-menu-bg.zip"');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(Number(r.headers.get('content-length')), r.buf.length, 'Content-Length = real size');
    const z = readZip(r.buf);
    assert.deepEqual(z.map((e) => e.name), ['kota1-menu-bg-page-01.png', 'kota1-menu-bg-page-02.pdf', 'kota1-menu-bg-page-03.webp']);
    assert.ok(z[0].data.equals(PNG_A)); assert.ok(z[1].data.equals(PDF_A)); assert.ok(z[2].data.equals(WEBP_A));
    assert.ok((await dl()).buf.equals(r.buf), 'no lang = bg, byte-identical');
    assert.ok((await dl('?lang=bg&file=../../server/src/app.js&path=/etc/passwd&page=99&stored=0123456789abcdef0123456789abcdef.png')).buf.equals(r.buf), 'extra query input ignored');
    fs.mkdirSync(path.join(SCRATCH, 'dl-out'), { recursive: true });
    const zp = path.join(SCRATCH, `dl-${process.pid}.zip`); fs.writeFileSync(zp, r.buf);
    const t = spawnSync('unzip', ['-t', zp], { encoding: 'utf8' });
    assert.equal(t.status, 0, t.stdout + t.stderr); assert.match(t.stdout, /No errors detected/);
    const py = spawnSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(",".join(z.namelist()))', zp], { encoding: 'utf8' });
    assert.equal(py.stdout.split('\n')[0], 'None'); assert.equal(py.stdout.split('\n')[1], z.map((e) => e.name).join(','));
    fs.rmSync(zp, { force: true });
    const h = await admin.req('HEAD', `${AD}?lang=bg`); assert.equal(h.status, 200); assert.equal(h.buf.length, 0); assert.equal(Number(h.headers.get('content-length')), r.buf.length); assert.equal(h.headers.get('content-type'), 'application/zip');
    // published: same output (published or not)
    await setPub('bg', true); assert.ok((await dl('?lang=bg')).buf.equals(r.buf), 'published state does not change the ZIP');
    await setPub('bg', false);
  });

  test('DL6 order follows the admin page order; deleting a page renumbers; single page still a ZIP', async () => {
    assert.equal((await admin.put('/api/admin/menu/pages/order', { json: { lang: 'bg', ids: [pg[2].id, pg[0].id, pg[1].id] } })).status, 200);
    let z = readZip((await dl()).buf);
    assert.deepEqual(z.map((e) => e.name), ['kota1-menu-bg-page-01.webp', 'kota1-menu-bg-page-02.png', 'kota1-menu-bg-page-03.pdf']);
    assert.ok(z[0].data.equals(WEBP_A) && z[1].data.equals(PNG_A) && z[2].data.equals(PDF_A));
    assert.equal((await admin.del(`/api/admin/menu/pages/${pg[0].id}`)).status, 204);
    z = readZip((await dl()).buf);
    assert.deepEqual(z.map((e) => e.name), ['kota1-menu-bg-page-01.webp', 'kota1-menu-bg-page-02.pdf']);
    assert.equal((await admin.del(`/api/admin/menu/pages/${pg[1].id}`)).status, 204);
    const one = await dl(); assert.equal(one.status, 200); z = readZip(one.buf); assert.equal(z.length, 1); assert.ok(z[0].data.equals(WEBP_A));
    pg = [await addPage('bg', PNG_A, 'again.png', 'image/png')];
  });

  test('DL7 languages are separate and there is NO fallback: EN ZIP has only EN pages (published or not); BG ZIP only BG pages; each named by its language; BG pages unaffected by EN state', async () => {
    assert.equal((await dl('?lang=en')).status, 404, 'EN empty while BG has pages -> 404, not the BG ZIP');
    await addPage('en', PNG_B, 'e1.png', 'image/png'); await addPage('en', PDF, 'e2.pdf', 'application/pdf');
    assert.equal((await admin.get('/api/admin/menu')).data.pages.en.published, false);
    let r = await dl('?lang=en'); assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="kota1-menu-en.zip"');
    let z = readZip(r.buf); assert.deepEqual(z.map((e) => e.name), ['kota1-menu-en-page-01.png', 'kota1-menu-en-page-02.pdf']); assert.ok(z[0].data.equals(PNG_B)); assert.ok(z[1].data.equals(PDF));
    r = await dl('?lang=bg'); assert.equal(r.headers.get('content-disposition'), 'attachment; filename="kota1-menu-bg.zip"');
    z = readZip(r.buf); assert.deepEqual(z.map((e) => e.name), ['kota1-menu-bg-page-01.webp', 'kota1-menu-bg-page-02.png']); assert.ok(z[0].data.equals(WEBP_A) && z[1].data.equals(PNG_A)); // BG = the 2 BG pages left by DL6, no EN content
    // publish EN, unpublish BG: both still download the same content
    await setPub('en', true);
    assert.equal(readZip((await dl('?lang=en')).buf).length, 2); assert.equal(readZip((await dl('?lang=bg')).buf).length, 2);
    await setPub('en', false);
    // public site is unaffected / unchanged: no file mode requested, public never lists EN unpublished pages
    assert.equal((await anon.get('/api/public/menu?lang=en')).status, 200);
    for (const x of (await admin.get('/api/admin/menu')).data.pages.en.items) assert.equal((await admin.del(`/api/admin/menu/pages/${x.id}`)).status, 204);
    assert.equal((await dl('?lang=en')).status, 404, 'EN empty again');
    // array-style query keys are not a lang: ignored => default bg
    assert.equal((await dl('?lang[]=en')).status, 200);
  });

  test('DL8 other methods on the admin route: POST/PUT/DELETE/PATCH are not a download (4xx); CSRF header not needed for GET; traversal in the path is 4xx', async () => {
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) { const r = await admin.req(m, `${AD}?lang=bg`); assert.ok(r.status >= 400 && r.status < 500, `${m} -> ${r.status}`); assert.notEqual(r.headers.get('content-type'), 'application/zip'); }
    const noCsrf = await admin.req('GET', `${AD}?lang=bg`, { csrf: false }); assert.equal(noCsrf.status, 200);
    for (const p of [`${AD}/../../../etc/passwd`, `${AD}/%2e%2e%2fapp.js`, `${AD}/x`, `/api/admin/menu/pages/download%2f..%2f..%2fpackage.json`]) {
      const r = await admin.get(p); assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`); assert.doesNotMatch(r.text(), /"name": "kota-restaurant"|root:/);
    }
    // the route name must not be swallowed by /pages/:id
    assert.equal((await admin.del('/api/admin/menu/pages/download')).status >= 400, true);
  });

  test('DL9 delete mid-download: a started download completes as a valid ZIP (files opened up front); the next request reflects the change (404)', async () => {
    for (const x of (await admin.get('/api/admin/menu')).data.pages.bg.items) await admin.del(`/api/admin/menu/pages/${x.id}`);
    const big = (mark) => { const b = Buffer.alloc(25 * MB); makePng(10, 10).copy(b); b.write(mark, b.length - 20); return b; };
    const bigs = [big('page-one'), big('page-two'), big('page-three')];
    for (let i = 0; i < 3; i++) await addPage('bg', bigs[i], `b${i}.png`, 'image/png');
    const { res } = await rawGet(`${srv.url}${AD}?lang=bg`, { cookie: admin.cookie });
    assert.equal(res.statusCode, 200); const len = Number(res.headers['content-length']);
    const chunks = []; let got = 0;
    res.pause();
    let midway = false;
    await new Promise((resolve) => { res.on('data', (c) => { chunks.push(c); got += c.length; if (!midway && got > 2 * MB) { midway = true; res.pause(); resolve(); } }); res.resume(); });
    assert.ok(got < len / 2, 'paused well before the end');
    for (const x of (await admin.get('/api/admin/menu')).data.pages.bg.items) assert.equal((await admin.del(`/api/admin/menu/pages/${x.id}`)).status, 204);
    assert.equal(up().length, 0, 'BG page files deleted from disk');
    await new Promise((resolve, reject) => { res.on('end', resolve); res.on('error', reject); res.on('aborted', () => reject(new Error('aborted'))); res.resume(); });
    const body = Buffer.concat(chunks); assert.equal(body.length, len, 'complete body');
    const z = readZip(body); assert.equal(z.length, 3); for (let i = 0; i < 3; i++) assert.ok(z[i].data.equals(bigs[i]), 'entry ' + i);
    assert.equal((await dl('?lang=bg')).status, 404);
  });

  test('DL10 client abort mid-download: server stays healthy, file descriptors are released, other downloads still work', async () => {
    const b1 = Buffer.alloc(30 * MB, 1); makePng(8, 8).copy(b1); const b2 = Buffer.alloc(30 * MB, 2); makePng(9, 9).copy(b2);
    await addPage('bg', b1, 'x1.png', 'image/png'); await addPage('bg', b2, 'x2.png', 'image/png');
    const fd0 = fdCount(srv.pid);
    for (let i = 0; i < 5; i++) {
      const { res, req } = await rawGet(`${srv.url}${AD}?lang=bg`, { cookie: admin.cookie });
      await new Promise((r) => { res.once('data', r); }); res.pause(); await sleep(50);
      req.destroy(); res.destroy();
    }
    await sleep(500);
    assert.ok(fdCount(srv.pid) <= fd0 + 1, `fd count ${fdCount(srv.pid)} vs ${fd0}`);
    const ok = await dl('?lang=bg'); assert.equal(ok.status, 200); assert.equal(readZip(ok.buf).length, 2);
    assert.equal((await anon.get('/api/public/site')).status, 200);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
  });

  test('DL11 a page file that is unreadable on disk -> clean 404 (ENOENT), no crash, recovers when restored', async () => {
    const f = up().sort(); fs.renameSync(path.join(dir, 'uploads', f[0]), path.join(dir, 'uploads', f[0] + '.bak'));
    const r = await dl('?lang=bg'); assert.equal(r.status, 404, String(r.status));
    fs.renameSync(path.join(dir, 'uploads', f[0] + '.bak'), path.join(dir, 'uploads', f[0]));
    assert.equal((await dl('?lang=bg')).status, 200);
  });
});

describe('admin menu download: 10 pages x 50 MB (500 MB ZIP) streams from disk without buffering', () => {
  let dir; let srv; let admin;
  before(async () => { dir = tmpDir('dlbig'); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  test('DL12 10 x 50 MB pages: ZIP downloads (Content-Length exact), `unzip -t` passes, entry CRCs match, server peak RSS growth < 150 MB', async () => {
    const heads = makePng(5, 5);
    const outZip = path.join(SCRATCH, `dlbig-${process.pid}.zip`);
    try {
      for (let i = 0; i < 10; i++) {
        const b = Buffer.alloc(50 * MB, i + 1); heads.copy(b);
        const r = await admin.post('/api/admin/menu/pages', { form: mp({ lang: 'bg' }, [{ field: 'file', buf: b, type: 'image/png', name: `p${i}.png` }]) }); assert.equal(r.status, 201, `page ${i} ${r.status}`);
      }
      assert.equal((await admin.post('/api/admin/menu/pages', { form: mp({ lang: 'bg' }, [{ field: 'file', buf: heads, type: 'image/png', name: 'x.png' }]) })).status, 409, '11th page blocked');
      // pages stay UNPUBLISHED and the menu stays in structured mode: the admin ZIP does not depend on either
      const hwm = () => Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync(`/proc/${srv.pid}/status`, 'utf8'))[1]) / 1024;
      const before = hwm(); const t0 = Date.now();
      const res = await fetch(`${srv.url}/api/admin/menu/pages/download?lang=bg`, { headers: { cookie: admin.cookie } });
      assert.equal(res.status, 200); const len = Number(res.headers.get('content-length'));
      const ws = fs.createWriteStream(outZip); let n = 0;
      for await (const c of res.body) { n += c.length; if (!ws.write(c)) await new Promise((r) => ws.once('drain', r)); }
      await new Promise((r) => ws.end(r));
      const ms = Date.now() - t0; const after_ = hwm();
      console.log(`# DL12 ${(n / MB).toFixed(0)} MB zip in ${ms} ms; server peak RSS ${before.toFixed(0)} -> ${after_.toFixed(0)} MB`);
      assert.equal(n, len); assert.equal(fs.statSync(outZip).size, len);
      const t = spawnSync('unzip', ['-t', outZip], { encoding: 'utf8', maxBuffer: 1 << 24 });
      assert.equal(t.status, 0, t.stdout.slice(-300) + t.stderr); assert.match(t.stdout, /No errors detected/); assert.equal((t.stdout.match(/OK\n/g) || []).length, 10);
      const py = spawnSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(len(z.namelist()));print(z.namelist()[0],z.namelist()[9])', outZip], { encoding: 'utf8' });
      assert.match(py.stdout, /^None\n10\nkota1-menu-bg-page-01\.png kota1-menu-bg-page-10\.png/);
      assert.ok(after_ - before < 150, `RSS grew ${(after_ - before).toFixed(0)} MB`);
    } finally { fs.rmSync(outZip, { force: true }); }
  });
});

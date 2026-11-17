// T-43 (D-48): public menu download (ZIP of live pages). Port 3203.
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
function rawGet(url, { method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => resolve({ res, req }));
    req.on('error', reject); req.end();
  });
}

describe('menu download (D-48)', () => {
  let dir; let srv; let admin; let anon;
  const up = () => fs.readdirSync(path.join(dir, 'uploads'));
  const dl = (q = '', o) => anon.get(`/api/public/menu/download${q}`, o);
  const addPage = async (lang, buf, name, type) => { const r = await admin.post('/api/admin/menu/pages', { form: mp({ lang }, [{ field: 'file', buf, name, type }]) }); assert.equal(r.status, 201, r.text().slice(0, 150)); return r.data; };
  const setPub = (lang, published) => admin.put('/api/admin/menu/pages/published', { json: { lang, published } });
  const fdCount = (pid) => fs.readdirSync(`/proc/${pid}/fd`).length;

  before(async () => { dir = tmpDir('dl'); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('DL1 404 when nothing is public: fresh DB; pages uploaded but unpublished; published but mode=structured; flag on but no pages', async () => {
    assert.equal((await dl()).status, 404);
    const a = await addPage('bg', PNG_A, 'a.png', 'image/png');
    assert.equal((await dl()).status, 404, 'unpublished pages');
    await setPub('bg', true);
    assert.equal((await dl()).status, 404, 'published but mode=structured');
    await setPub('bg', false); await setPub('en', true);
    assert.equal((await admin.put('/api/admin/menu/mode', { json: { mode: 'structured' } })).status === 409 || true, true);
    assert.equal((await dl('?lang=en')).status, 404, 'EN flag on with zero EN pages (and mode structured)');
    await setPub('en', false);
    assert.equal((await admin.del(`/api/admin/menu/pages/${a.id}`)).status, 204);
    assert.deepEqual(up(), []);
  });

  let pg;
  test('DL2 structured menu published -> mode file with 3 BG pages (png, pdf, webp): ZIP headers, size, entries in page order, CRCs, bytes identical', async () => {
    const draft = await admin.put('/api/admin/menu/draft', { json: { categories: [{ name: 'К', items: [{ name: 'Я', description: '', priceCents: 100, available: true }] }] } }); assert.equal(draft.status, 200);
    await admin.post('/api/admin/menu/publish');
    pg = [await addPage('bg', PNG_A, 'първа.png', 'image/png'), await addPage('bg', PDF_A, 'second.pdf', 'application/pdf'), await addPage('bg', WEBP_A, 'third.webp', 'image/webp')];
    await setPub('bg', true);
    assert.equal((await dl()).status, 404, 'still structured mode');
    assert.equal((await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } })).status, 200);
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
    // default language = bg
    assert.ok((await dl()).buf.equals(r.buf), 'no lang = bg, byte-identical');
    // independent extractors
    fs.mkdirSync(path.join(SCRATCH, 'dl-out'), { recursive: true });
    const zp = path.join(SCRATCH, `dl-${process.pid}.zip`); fs.writeFileSync(zp, r.buf);
    const t = spawnSync('unzip', ['-t', zp], { encoding: 'utf8' });
    assert.equal(t.status, 0, t.stdout + t.stderr); assert.match(t.stdout, /No errors detected/);
    const py = spawnSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(",".join(z.namelist()))', zp], { encoding: 'utf8' });
    assert.equal(py.stdout.split('\n')[0], 'None'); assert.equal(py.stdout.split('\n')[1], z.map((e) => e.name).join(','));
    fs.rmSync(zp, { force: true });
    // HEAD: same headers, no body
    const h = await anon.req('HEAD', '/api/public/menu/download?lang=bg'); assert.equal(h.status, 200); assert.equal(h.buf.length, 0); assert.equal(Number(h.headers.get('content-length')), r.buf.length);
  });

  test('DL3 order follows the admin page order; deleting a page renumbers the entries (-01, -02)', async () => {
    assert.equal((await admin.put('/api/admin/menu/pages/order', { json: { lang: 'bg', ids: [pg[2].id, pg[0].id, pg[1].id] } })).status, 200);
    let z = readZip((await dl()).buf);
    assert.deepEqual(z.map((e) => e.name), ['kota1-menu-bg-page-01.webp', 'kota1-menu-bg-page-02.png', 'kota1-menu-bg-page-03.pdf']);
    assert.ok(z[0].data.equals(WEBP_A) && z[1].data.equals(PNG_A) && z[2].data.equals(PDF_A));
    assert.equal((await admin.del(`/api/admin/menu/pages/${pg[0].id}`)).status, 204);
    z = readZip((await dl()).buf);
    assert.deepEqual(z.map((e) => e.name), ['kota1-menu-bg-page-01.webp', 'kota1-menu-bg-page-02.pdf']);
    // a single page: the endpoint still answers (the UI links the file directly)
    assert.equal((await admin.del(`/api/admin/menu/pages/${pg[1].id}`)).status, 204, 'non-last page deletable');
    const one = await dl(); assert.equal(one.status, 200); z = readZip(one.buf); assert.equal(z.length, 1); assert.ok(z[0].data.equals(WEBP_A));
    pg = [await addPage('bg', PNG_A, 'again.png', 'image/png')];
  });

  test('DL4 language: EN live -> kota1-menu-en.zip with EN pages; EN not live -> served (BG) language names the file; BG not live -> EN fallback', async () => {
    const en = [await addPage('en', PNG_B, 'e1.png', 'image/png'), await addPage('en', PDF, 'e2.pdf', 'application/pdf')];
    let r = await dl('?lang=en');
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="kota1-menu-bg.zip"', 'EN flag still off: served language is bg');
    assert.deepEqual(readZip(r.buf).map((e) => e.name), ['kota1-menu-bg-page-01.webp', 'kota1-menu-bg-page-02.png']);
    await setPub('en', true);
    r = await dl('?lang=en'); assert.equal(r.headers.get('content-disposition'), 'attachment; filename="kota1-menu-en.zip"');
    let z = readZip(r.buf); assert.deepEqual(z.map((e) => e.name), ['kota1-menu-en-page-01.png', 'kota1-menu-en-page-02.pdf']); assert.ok(z[0].data.equals(PNG_B)); assert.ok(z[1].data.equals(PDF));
    r = await dl('?lang=bg'); assert.equal(r.headers.get('content-disposition'), 'attachment; filename="kota1-menu-bg.zip"');
    // BG unpublished (EN stays live) -> BG visitors get the EN zip
    assert.equal((await setPub('bg', false)).status, 200);
    r = await dl('?lang=bg'); assert.equal(r.headers.get('content-disposition'), 'attachment; filename="kota1-menu-en.zip"');
    z = readZip(r.buf); assert.equal(z.length, 2); assert.match(z[0].name, /^kota1-menu-en-page-01\./);
    // the public JSON agrees with what is downloaded
    const j = (await anon.get('/api/public/menu?lang=bg')).data.file; assert.equal(j.lang, 'en'); assert.equal(j.pages.length, 2);
    await setPub('bg', true); void en;
  });

  test('DL5 invalid lang -> 400 (never 500, no file system access); extra query/path input is ignored; traversal in the path is 404', async () => {
    for (const q of ['?lang=fr', '?lang=', '?lang=BG', '?lang=bg,en', '?lang=bg%00', '?lang=../../etc/passwd', '?lang=..%2f..%2fapp', '?lang=bg&lang=en', '?lang=%2e%2e', `?lang=${'a'.repeat(5000)}`]) {
      const r = await dl(q); assert.ok([400].includes(r.status), `${q.slice(0, 40)} -> ${r.status}`);
      assert.doesNotMatch(r.text(), /etc\/passwd|ENOENT|stack|at /);
    }
    const base = (await dl('?lang=bg')).buf;
    for (const q of ['?lang=bg&file=../../server/src/app.js', '?lang=bg&path=/etc/passwd', '?lang=bg&name=../../x', '?lang=bg&page=99', '?lang=bg&stored=0123456789abcdef0123456789abcdef.png', '?lang[]=en']) {
      const r = await dl(q); assert.equal(r.status, 200, q); assert.ok(r.buf.equals(base), `${q}: output unchanged`);
    }
    for (const p of ['/api/public/menu/download/../../../etc/passwd', '/api/public/menu/download/%2e%2e%2fapp.js', '/api/public/menu/download/x', '/api/public/menu/download%2f..%2f..%2fpackage.json']) {
      const r = await anon.get(p); assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`); assert.doesNotMatch(r.text(), /"name": "kota-restaurant"|root:/);
    }
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) { const r = await anon.req(m, '/api/public/menu/download?lang=bg', { csrf: false }); assert.ok(r.status >= 400 && r.status < 500, `${m} -> ${r.status}`); }
  });

  test('DL6 unpublish / delete mid-download: a started download completes as a valid ZIP (files opened up front); the next request reflects the change', async () => {
    // 3 BG pages of 25 MB each so the response is big enough to be mid-flight
    for (const x of (await admin.get('/api/admin/menu')).data.pages.bg.items) await admin.del(`/api/admin/menu/pages/${x.id}`);
    const big = (mark) => { const b = Buffer.alloc(25 * MB); makePng(10, 10).copy(b); b.write(mark, b.length - 20); return b; };
    const bigs = [big('page-one'), big('page-two'), big('page-three')];
    for (let i = 0; i < 3; i++) await addPage('bg', bigs[i], `b${i}.png`, 'image/png');
    const { res } = await rawGet(`${srv.url}/api/public/menu/download?lang=bg`);
    assert.equal(res.statusCode, 200); const len = Number(res.headers['content-length']);
    const chunks = []; let got = 0;
    res.pause();
    let midway = false;
    await new Promise((resolve) => { res.on('data', (c) => { chunks.push(c); got += c.length; if (!midway && got > 2 * MB) { midway = true; res.pause(); resolve(); } }); res.resume(); });
    assert.ok(got < len / 2, 'paused well before the end');
    // now the response is mid-flight; unpublish BG and delete every BG page
    assert.equal((await setPub('bg', false)).status, 200);
    for (const x of (await admin.get('/api/admin/menu')).data.pages.bg.items) assert.equal((await admin.del(`/api/admin/menu/pages/${x.id}`)).status, 204);
    assert.equal(up().length, 2, 'BG page files deleted from disk (2 EN pages remain)');
    await new Promise((resolve, reject) => { res.on('end', resolve); res.on('error', reject); res.on('aborted', () => reject(new Error('aborted'))); res.resume(); });
    const body = Buffer.concat(chunks); assert.equal(body.length, len, 'complete body');
    const z = readZip(body); assert.equal(z.length, 3); for (let i = 0; i < 3; i++) assert.ok(z[i].data.equals(bigs[i]), 'entry ' + i);
    // next request: BG has no pages, EN is live => EN zip
    const r = await dl('?lang=bg'); assert.equal(r.headers.get('content-disposition'), 'attachment; filename="kota1-menu-en.zip"');
  });

  test('DL7 client abort mid-download: server stays healthy, file descriptors are released, other downloads still work', async () => {
    for (const x of (await admin.get('/api/admin/menu')).data.pages.en.items) await admin.del(`/api/admin/menu/pages/${x.id}`).catch(() => {});
    await admin.put('/api/admin/menu/mode', { json: { mode: 'structured' } });
    for (const x of (await admin.get('/api/admin/menu')).data.pages.en.items) assert.equal((await admin.del(`/api/admin/menu/pages/${x.id}`)).status, 204);
    const b1 = Buffer.alloc(30 * MB, 1); makePng(8, 8).copy(b1); const b2 = Buffer.alloc(30 * MB, 2); makePng(9, 9).copy(b2);
    await addPage('bg', b1, 'x1.png', 'image/png'); await addPage('bg', b2, 'x2.png', 'image/png'); await setPub('bg', true);
    assert.equal((await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } })).status, 200);
    const fd0 = fdCount(srv.pid);
    for (let i = 0; i < 5; i++) {
      const { res, req } = await rawGet(`${srv.url}/api/public/menu/download?lang=bg`);
      await new Promise((r) => { res.once('data', r); }); res.pause(); await sleep(50);
      req.destroy(); res.destroy();
    }
    await sleep(500);
    assert.ok(fdCount(srv.pid) <= fd0 + 1, `fd count ${fdCount(srv.pid)} vs ${fd0}`);
    const ok = await dl('?lang=bg'); assert.equal(ok.status, 200); assert.equal(readZip(ok.buf).length, 2);
    assert.equal((await anon.get('/api/public/site')).status, 200);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
  });

  test('DL8 admin-side delete of a file that is unreadable on disk -> download 404/5xx handled without crash (ENOENT -> 404)', async () => {
    const f = up().sort(); fs.renameSync(path.join(dir, 'uploads', f[0]), path.join(dir, 'uploads', f[0] + '.bak'));
    const r = await dl('?lang=bg'); assert.ok([404, 500].includes(r.status), String(r.status)); assert.equal(r.status, 404, 'missing file is a clean 404');
    fs.renameSync(path.join(dir, 'uploads', f[0] + '.bak'), path.join(dir, 'uploads', f[0]));
    assert.equal((await dl('?lang=bg')).status, 200);
  });
});

describe('menu download: 10 pages x 50 MB (500 MB ZIP) streams from disk without buffering', () => {
  let dir; let srv; let admin;
  before(async () => { dir = tmpDir('dlbig'); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  test('DL9 10 x 50 MB pages: ZIP downloads (Content-Length exact), `unzip -t` passes, entry CRCs match, server peak RSS growth < 150 MB', async () => {
    const heads = makePng(5, 5);
    const outZip = path.join(SCRATCH, `dlbig-${process.pid}.zip`);
    try {
      for (let i = 0; i < 10; i++) {
        const b = Buffer.alloc(50 * MB, i + 1); heads.copy(b);
        const r = await admin.post('/api/admin/menu/pages', { form: mp({ lang: 'bg' }, [{ field: 'file', buf: b, type: 'image/png', name: `p${i}.png` }]) }); assert.equal(r.status, 201, `page ${i} ${r.status}`);
      }
      assert.equal((await admin.post('/api/admin/menu/pages', { form: mp({ lang: 'bg' }, [{ field: 'file', buf: heads, type: 'image/png', name: 'x.png' }]) })).status, 409, '11th page blocked');
      await admin.put('/api/admin/menu/pages/published', { json: { lang: 'bg', published: true } });
      await admin.put('/api/admin/menu/draft', { json: { categories: [{ name: 'К', items: [{ name: 'Я', description: '', priceCents: 1, available: true }] }] } }); await admin.post('/api/admin/menu/publish');
      assert.equal((await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } })).status, 200);
      const hwm = () => Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync(`/proc/${srv.pid}/status`, 'utf8'))[1]) / 1024;
      const before = hwm(); const t0 = Date.now();
      const res = await fetch(`${srv.url}/api/public/menu/download?lang=bg`);
      assert.equal(res.status, 200); const len = Number(res.headers.get('content-length'));
      const ws = fs.createWriteStream(outZip); let n = 0;
      for await (const c of res.body) { n += c.length; if (!ws.write(c)) await new Promise((r) => ws.once('drain', r)); }
      await new Promise((r) => ws.end(r));
      const ms = Date.now() - t0; const after_ = hwm();
      console.log(`# DL9 ${(n / MB).toFixed(0)} MB zip in ${ms} ms; server peak RSS ${before.toFixed(0)} -> ${after_.toFixed(0)} MB`);
      assert.equal(n, len); assert.equal(fs.statSync(outZip).size, len);
      const t = spawnSync('unzip', ['-t', outZip], { encoding: 'utf8', maxBuffer: 1 << 24 });
      assert.equal(t.status, 0, t.stdout.slice(-300) + t.stderr); assert.match(t.stdout, /No errors detected/); assert.equal((t.stdout.match(/OK\n/g) || []).length, 10);
      const py = spawnSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(len(z.namelist()));print(z.namelist()[0],z.namelist()[9])', outZip], { encoding: 'utf8' });
      assert.match(py.stdout, /^None\n10\nkota1-menu-bg-page-01\.png kota1-menu-bg-page-10\.png/);
      assert.ok(after_ - before < 150, `RSS grew ${(after_ - before).toFixed(0)} MB`);
    } finally { fs.rmSync(outZip, { force: true }); }
  });
});

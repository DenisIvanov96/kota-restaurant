// T-44: GET /api/admin/menu/pages/download (D-49) - streamed ZIP of all pages of one language, admin only.
// The public route (D-48) is gone and must 404.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { loggedIn, PDF, PNG, JPG } from './helpers.js';
import { prepareZip, ZipTooLargeError } from '../src/zip.js';

const form = (lang, file) => {
  const f = new FormData();
  f.append('lang', lang);
  f.append('file', new Blob([file.buf], { type: file.type }), file.name);
  return f;
};
const PDFF = { buf: PDF, name: 'a.pdf', type: 'application/pdf' };
const JPGF = { buf: JPG, name: 'b.jpg', type: 'image/jpeg' };
const PNGF = { buf: PNG, name: 'c.png', type: 'image/png' };
const add = async (s, lang, file) => {
  const r = await s.api.req('POST', '/api/admin/menu/pages', { form: form(lang, file) });
  assert.equal(r.status, 201);
  return r.data;
};
const fileMode = async (s, ...langs) => {
  for (const l of langs) assert.equal((await s.api.put('/api/admin/menu/pages/published', { lang: l, published: true })).status, 200);
  assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'file' })).status, 200);
};
const URL_ = '/api/admin/menu/pages/download';
const authH = (s) => ({ Cookie: s.api.cookie });
const download = async (s, q = '?lang=bg') => {
  const res = await fetch(`${s.base}${URL_}${q}`, { headers: authH(s) });
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
};

/** Tiny ZIP parser: walks the central directory and cross-checks every local header. */
function parseZip(buf) {
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, 'EOCD signature at the very end (no comment)');
  const count = buf.readUInt16LE(eocd + 10);
  assert.equal(buf.readUInt16LE(eocd + 8), count);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  assert.equal(cdOff + cdSize, eocd, 'central directory ends where EOCD starts');
  const out = [];
  let p = cdOff;
  let expectLocal = 0;
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central signature');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    assert.ok(flags & 0x0800, 'UTF-8 flag');
    assert.equal(method, 0, 'stored');
    assert.equal(csize, usize);
    assert.equal(off, expectLocal, 'entries are contiguous, in order');
    assert.equal(buf.readUInt32LE(off), 0x04034b50, 'local signature');
    assert.equal(buf.readUInt16LE(off + 6), flags);
    assert.equal(buf.readUInt32LE(off + 14), crc);
    assert.equal(buf.readUInt32LE(off + 18), csize);
    assert.equal(buf.readUInt32LE(off + 22), usize);
    assert.equal(buf.readUInt16LE(off + 26), nlen);
    assert.equal(buf.toString('utf8', off + 30, off + 30 + nlen), name);
    const dataStart = off + 30 + nlen + buf.readUInt16LE(off + 28);
    const data = buf.subarray(dataStart, dataStart + usize);
    assert.equal(data.length, usize);
    assert.equal(zlib.crc32(data) >>> 0, crc, `CRC of ${name}`);
    expectLocal = dataStart + usize;
    out.push({ name, data });
    p += 46 + nlen + xlen + clen;
  }
  assert.equal(p, eocd);
  assert.equal(expectLocal, cdOff, 'last entry data ends where the central directory starts');
  return out;
};

const hasUnzip = spawnSync('unzip', ['-v']).status === 0;
const uploadFds = (dataDir) => fs.readdirSync('/proc/self/fd').filter((fd) => {
  try { return fs.readlinkSync(`/proc/self/fd/${fd}`).startsWith(path.join(dataDir, 'uploads')); } catch { return false; }
}).length;

test('3 pages (pdf, jpg, png) -> valid ZIP: headers, CRCs, sizes, names, order, response headers', async () => {
  const s = await loggedIn();
  try {
    await add(s, 'bg', PDFF); await add(s, 'bg', JPGF); await add(s, 'bg', PNGF);
    const { res, buf } = await download(s); // nothing published, structured mode: still downloadable by an admin
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="kota1-menu-bg.zip"');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(Number(res.headers.get('content-length')), buf.length);
    const entries = parseZip(buf);
    assert.deepEqual(entries.map((e) => e.name), ['kota1-menu-bg-page-01.pdf', 'kota1-menu-bg-page-02.jpg', 'kota1-menu-bg-page-03.png']);
    assert.ok(entries[0].data.equals(PDF) && entries[1].data.equals(JPG) && entries[2].data.equals(PNG));
    if (hasUnzip) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kota-zip-'));
      try {
        const f = path.join(dir, 'm.zip'); fs.writeFileSync(f, buf);
        const t = spawnSync('unzip', ['-t', f], { encoding: 'utf8' });
        assert.equal(t.status, 0, t.stdout + t.stderr);
        assert.match(t.stdout, /No errors detected/);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
    // order follows the admin order
    const ids = (await s.api.get('/api/admin/menu')).data.pages.bg.items.map((x) => x.id);
    assert.equal((await s.api.put('/api/admin/menu/pages/order', { lang: 'bg', ids: [...ids].reverse() })).status, 200);
    const again = parseZip((await download(s)).buf);
    assert.deepEqual(again.map((e) => e.data.length), [PNG.length, JPG.length, PDF.length]);
    assert.deepEqual(again.map((e) => e.name), ['kota1-menu-bg-page-01.png', 'kota1-menu-bg-page-02.jpg', 'kota1-menu-bg-page-03.pdf']);
    // HEAD works and sends no body
    const head = await fetch(`${s.base}${URL_}`, { method: 'HEAD', headers: authH(s) });
    assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
  } finally { await s.close(); }
});

test('language: default bg, ?lang=en own pages, unpublished included, no fallback, 400 on invalid lang', async () => {
  const s = await loggedIn();
  try {
    await add(s, 'bg', PDFF); await add(s, 'bg', JPGF); await add(s, 'en', PNGF); await add(s, 'en', PNGF);
    // nothing is published: pages of each language are still served, own language only
    let r = await download(s, '?lang=en');
    assert.equal(r.res.status, 200);
    assert.equal(r.res.headers.get('content-disposition'), 'attachment; filename="kota1-menu-en.zip"');
    assert.deepEqual(parseZip(r.buf).map((e) => e.name), ['kota1-menu-en-page-01.png', 'kota1-menu-en-page-02.png']);
    r = await download(s, '?lang=bg');
    assert.equal(r.res.headers.get('content-disposition'), 'attachment; filename="kota1-menu-bg.zip"');
    assert.deepEqual(parseZip(r.buf).map((e) => e.name), ['kota1-menu-bg-page-01.pdf', 'kota1-menu-bg-page-02.jpg']);
    assert.equal(parseZip((await download(s, '')).buf).length, 2); // default bg
    // published or not makes no difference
    await fileMode(s, 'bg');
    assert.equal(parseZip((await download(s, '?lang=en')).buf).length, 2); // en unpublished, still its own pages
    // one published + one unpublished page set: both complete (page-level published flag is per language)
    await s.api.put('/api/admin/menu/pages/published', { lang: 'en', published: true });
    assert.equal(parseZip((await download(s, '?lang=en')).buf).length, 2);
    // invalid lang
    for (const q of ['?lang=fr', '?lang=', '?lang=bg&lang=en']) {
      const bad = await s.api.get(`${URL_}${q}`);
      assert.equal(bad.status, 400, q); assert.equal(bad.data.error, 'validation'); assert.ok(bad.data.fields.lang);
    }
  } finally { await s.close(); }
});

test('no fallback: a language without pages is a 404 JSON even when the other language has pages (published or not)', async () => {
  const s = await loggedIn();
  try {
    for (const q of ['', '?lang=bg', '?lang=en']) {
      const r = await s.api.get(`${URL_}${q}`); // fresh install, no pages at all
      assert.equal(r.status, 404, q); assert.equal(r.data.error, 'not_found');
    }
    await add(s, 'bg', PDFF);
    let r = await s.api.get(`${URL_}?lang=en`);
    assert.equal(r.status, 404); assert.equal(r.data.error, 'not_found');
    await fileMode(s, 'bg'); // bg live and public
    r = await s.api.get(`${URL_}?lang=en`);
    assert.equal(r.status, 404); assert.equal(r.data.error, 'not_found');
    assert.equal((await s.api.get(`${URL_}?lang=bg`)).status, 200);
  } finally { await s.close(); }
});

test('auth: 401 without a session (also after logout and for HEAD); the public route no longer exists (404)', async () => {
  const s = await loggedIn();
  try {
    await add(s, 'bg', PDFF);
    await fileMode(s, 'bg'); // live in public file mode: still no public ZIP
    for (const q of ['', '?lang=bg', '?lang=fr']) {
      const r = await s.client().get(`${URL_}${q}`);
      assert.equal(r.status, 401, q); assert.equal(r.data.error, 'unauthorized');
    }
    assert.equal((await fetch(`${s.base}${URL_}?lang=bg`, { method: 'HEAD' })).status, 401);
    for (const q of ['', '?lang=bg', '?lang=en']) {
      for (const method of ['GET', 'HEAD']) {
        const pub = await fetch(`${s.base}/api/public/menu/download${q}`, { method });
        assert.equal(pub.status, 404, `${method} ${q}`);
        if (method === 'GET') { assert.equal((await pub.json()).error, 'not_found'); }
      }
    }
    // admin session on the public path does not help either
    assert.equal((await fetch(`${s.base}/api/public/menu/download?lang=bg`, { headers: authH(s) })).status, 404);
    assert.equal((await s.api.get(`${URL_}?lang=bg`)).status, 200);
    await s.api.post('/api/admin/logout');
    assert.equal((await fetch(`${s.base}${URL_}?lang=bg`, { headers: authH(s) })).status, 401);
  } finally { await s.close(); }
});

test('large pages: byte-exact, and a client abort mid-download stops reading, releases files, server keeps working', async () => {
  const s = await loggedIn();
  try {
    const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(40 * 1024 * 1024, 7)]);
    for (let i = 0; i < 3; i++) await add(s, 'bg', { buf: big, name: `big${i}.png`, type: 'image/png' });
    const baseline = uploadFds(s.dataDir);
    // abort after the first chunk
    await new Promise((resolve, reject) => {
      const req = http.get(`${s.base}${URL_}?lang=bg`, { headers: authH(s) }, (res) => {
        assert.equal(res.statusCode, 200);
        res.once('data', () => { req.destroy(); resolve(); });
      });
      req.on('error', (e) => (e.code === 'ECONNRESET' ? resolve() : reject(e)));
    });
    // fds are released shortly after the socket closes
    for (let i = 0; i < 50 && uploadFds(s.dataDir) > baseline; i++) await new Promise((r) => setTimeout(r, 40));
    assert.equal(uploadFds(s.dataDir), baseline, 'no upload files left open after abort');
    assert.equal((await s.client().get('/api/public/menu')).status, 200); // still alive
    // a complete download afterwards is byte-exact (120 MB; CRCs come from the cache on the 2nd request)
    const full = await download(s);
    assert.equal(full.res.status, 200);
    const entries = parseZip(full.buf);
    assert.equal(entries.length, 3);
    assert.ok(entries.every((e) => e.data.length === big.length && e.data.equals(big)));
    assert.equal(uploadFds(s.dataDir), baseline);
  } finally { await s.close(); }
});

test('zip writer: ZIP64-sized input is rejected, missing file rejects and leaves nothing open, UTF-8 names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kota-zipw-'));
  try {
    const f = path.join(dir, 'x.bin'); fs.writeFileSync(f, 'hello');
    const z = await prepareZip([{ name: 'меню-1.txt', path: f }]);
    const chunks = []; for await (const c of z.stream()) chunks.push(c);
    await z.close(); await z.close(); // idempotent
    const buf = Buffer.concat(chunks);
    assert.equal(buf.length, z.size);
    const [e] = parseZip(buf);
    assert.equal(e.name, 'меню-1.txt'); assert.equal(e.data.toString(), 'hello');
    // empty file
    const empty = path.join(dir, 'e.bin'); fs.writeFileSync(empty, '');
    const z0 = await prepareZip([{ name: 'e.txt', path: empty }]);
    const c0 = []; for await (const c of z0.stream()) c0.push(c);
    await z0.close();
    assert.equal(parseZip(Buffer.concat(c0))[0].data.length, 0);
    // > 4 GB: a sparse file makes it cheap (size check happens before any reading)
    const sparse = path.join(dir, 'sparse.bin'); const fd = fs.openSync(sparse, 'w'); fs.ftruncateSync(fd, 0x100000000 + 10); fs.closeSync(fd);
    await assert.rejects(prepareZip([{ name: 's.bin', path: sparse }]), ZipTooLargeError);
    await assert.rejects(prepareZip([{ name: 'a', path: f }, { name: 'b', path: path.join(dir, 'missing') }]), { code: 'ENOENT' });
    assert.equal(uploadFds(dir), 0);
    assert.equal(fs.readdirSync('/proc/self/fd').filter((n) => { try { return fs.readlinkSync(`/proc/self/fd/${n}`).startsWith(dir); } catch { return false; } }).length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

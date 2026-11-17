// T-41: GET /api/public/menu/download (D-48) - streamed ZIP of the live menu pages.
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
const download = async (s, q = '?lang=bg') => {
  const res = await fetch(`${s.base}/api/public/menu/download${q}`);
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
    await fileMode(s, 'bg');
    const { res, buf } = await download(s);
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
    const head = await fetch(`${s.base}/api/public/menu/download`, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
  } finally { await s.close(); }
});

test('language: default bg, ?lang=en own pages, fallback to the other language, 400 on invalid lang', async () => {
  const s = await loggedIn();
  try {
    await add(s, 'bg', PDFF); await add(s, 'bg', JPGF); await add(s, 'en', PNGF); await add(s, 'en', PNGF);
    await fileMode(s, 'bg');
    // only bg is live: en request falls back to bg (named after the language served)
    let r = await download(s, '?lang=en');
    assert.equal(r.res.status, 200);
    assert.equal(r.res.headers.get('content-disposition'), 'attachment; filename="kota1-menu-bg.zip"');
    assert.deepEqual(parseZip(r.buf).map((e) => e.name), ['kota1-menu-bg-page-01.pdf', 'kota1-menu-bg-page-02.jpg']);
    // en goes live
    await s.api.put('/api/admin/menu/pages/published', { lang: 'en', published: true });
    r = await download(s, '?lang=en');
    assert.equal(r.res.headers.get('content-disposition'), 'attachment; filename="kota1-menu-en.zip"');
    assert.deepEqual(parseZip(r.buf).map((e) => e.name), ['kota1-menu-en-page-01.png', 'kota1-menu-en-page-02.png']);
    assert.equal(parseZip((await download(s, '')).buf).length, 2); // default bg
    // bg unpublished: bg request falls back to en
    await s.api.put('/api/admin/menu/pages/published', { lang: 'bg', published: false });
    r = await download(s, '?lang=bg');
    assert.equal(r.res.headers.get('content-disposition'), 'attachment; filename="kota1-menu-en.zip"');
    assert.deepEqual(parseZip(r.buf).map((e) => e.name), ['kota1-menu-en-page-01.png', 'kota1-menu-en-page-02.png']);
    // invalid lang
    for (const q of ['?lang=fr', '?lang=', '?lang=bg&lang=en']) {
      const bad = await s.client().get(`/api/public/menu/download${q}`);
      assert.equal(bad.status, 400, q); assert.equal(bad.data.error, 'validation'); assert.ok(bad.data.fields.lang);
    }
  } finally { await s.close(); }
});

test('404 JSON: nothing published, structured mode, no pages; recovers when published', async () => {
  const s = await loggedIn();
  try {
    const json404 = async () => {
      const r = await s.client().get('/api/public/menu/download?lang=bg');
      assert.equal(r.status, 404); assert.equal(r.data.error, 'not_found'); assert.equal(r.headers.get('cache-control'), 'no-store');
    };
    await json404(); // fresh install: structured mode, no pages
    await add(s, 'bg', PDFF); await add(s, 'en', JPGF);
    await json404(); // pages exist, nothing published, structured mode
    await s.api.put('/api/admin/menu/pages/published', { lang: 'bg', published: true });
    await json404(); // a language is live but mode is structured
    await fileMode(s, 'bg');
    assert.equal((await download(s)).res.status, 200);
    await s.api.put('/api/admin/menu/draft', { categories: [] }); await s.api.post('/api/admin/menu/publish'); // structured mode needs a published menu
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'structured' })).status, 200);
    await json404(); // back to structured: no download even though pages stay published
    // a published language with zero pages is not live
    const s2 = await loggedIn();
    try {
      await s2.api.put('/api/admin/menu/pages/published', { lang: 'bg', published: true });
      const r = await s2.client().get('/api/public/menu/download'); assert.equal(r.status, 404);
    } finally { await s2.close(); }
  } finally { await s.close(); }
});

test('large pages: byte-exact, and a client abort mid-download stops reading, releases files, server keeps working', async () => {
  const s = await loggedIn();
  try {
    const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(40 * 1024 * 1024, 7)]);
    for (let i = 0; i < 3; i++) await add(s, 'bg', { buf: big, name: `big${i}.png`, type: 'image/png' });
    await fileMode(s, 'bg');
    const baseline = uploadFds(s.dataDir);
    // abort after the first chunk
    await new Promise((resolve, reject) => {
      const req = http.get(`${s.base}/api/public/menu/download?lang=bg`, (res) => {
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

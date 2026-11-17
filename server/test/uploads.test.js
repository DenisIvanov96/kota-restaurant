// T-38: 50 MB uploads, disk temp storage in DATA_DIR/tmp, temp-file hygiene (D-44).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { loggedIn, startApp, PNG, PDF } from './helpers.js';

const MB = 1024 * 1024;
const MAX = 50 * MB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpFiles = (s) => fs.readdirSync(path.join(s.dataDir, 'tmp'));
async function tmpEmpty(s, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (tmpFiles(s).length === 0) return true; await sleep(25); }
  return false;
}
/** A file of exactly `size` bytes starting with the magic bytes of `head` (rest zeros): cheap to build. */
const big = (head, size) => { const b = Buffer.alloc(size); head.copy(b); return b; };
const form = (fields, files) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  for (const x of files) f.append(x.field, new Blob([x.buf], { type: x.type }), x.name);
  return f;
};
const post = (s, url, fields, files, method = 'POST') => s.api.req(method, url, { form: form(fields, files) });
const png = (field, size) => ({ field, buf: big(PNG, size), name: 'a.png', type: 'image/png' });
const pdf = (field, size) => ({ field, buf: big(PDF, size), name: 'a.pdf', type: 'application/pdf' });

test('tmp dir is created on start and stale temp files are removed', async () => {
  const s = await startApp();
  const dataDir = s.dataDir;
  try {
    assert.ok(fs.statSync(path.join(dataDir, 'tmp')).isDirectory());
    fs.writeFileSync(path.join(dataDir, 'tmp', 'up-stale.tmp'), 'x');
    fs.mkdirSync(path.join(dataDir, 'tmp', 'dir'));
  } finally { await s.close(false); }
  const s2 = await startApp({ dataDir });
  try {
    assert.deepEqual(tmpFiles(s2), []);
  } finally { await s2.close(); }
});

test('exactly 50 MB is accepted everywhere; stored in uploads/, tmp left empty', async () => {
  const s = await loggedIn();
  try {
    const ev = await post(s, '/api/admin/events', { title: 'E', enabled: true }, [png('image', MAX)]);
    assert.equal(ev.status, 201);
    const dm = await post(s, '/api/admin/daily-menus', { date: '2026-06-15', published: true }, [pdf('file', MAX)]);
    assert.equal(dm.status, 201); assert.equal(dm.data.sizeBytes, MAX);
    const pg = await post(s, '/api/admin/menu/pages', { lang: 'en' }, [pdf('file', MAX)]);
    assert.equal(pg.status, 201); assert.equal(pg.data.sizeBytes, MAX);
    const sizes = s.uploads().map((n) => fs.statSync(path.join(s.dataDir, 'uploads', n)).size);
    assert.deepEqual(sizes, [MAX, MAX, MAX]);
    assert.ok(await tmpEmpty(s));
    // the file served back is complete
    const res = await fetch(s.base + pg.data.fileUrl, { headers: { Cookie: s.api.cookie } });
    assert.equal((await res.arrayBuffer()).byteLength, MAX);
  } finally { await s.close(); }
});

test('50 MB + 1 byte -> 413 file_too_large with the field named; nothing left in tmp, uploads or the DB', async () => {
  const s = await loggedIn();
  try {
    const cases = [
      ['/api/admin/events', { title: 'E' }, png('image', MAX + 1), 'image'],
      ['/api/admin/events', { title: 'E' }, png('imageEn', MAX + 1), 'imageEn'],
      ['/api/admin/daily-menus', { date: '2026-06-15' }, pdf('file', MAX + 1), 'file'],
      ['/api/admin/daily-menus', { date: '2026-06-15' }, pdf('fileEn', MAX + 1), 'fileEn'],
      ['/api/admin/menu/pages', { lang: 'bg' }, pdf('file', MAX + 1), 'file'],
    ];
    for (const [url, fields, file, field] of cases) {
      const r = await post(s, url, fields, [file]);
      assert.equal(r.status, 413, `${url} ${field}`);
      assert.equal(r.data.error, 'file_too_large');
      assert.ok(r.data.fields[field], `fields.${field}`);
      assert.ok(await tmpEmpty(s), `tmp empty after ${field}`);
    }
    // a valid small file next to an oversized one: both discarded
    const r = await post(s, '/api/admin/events', { title: 'E' }, [png('image', 1000), png('imageEn', MAX + 1)]);
    assert.equal(r.status, 413);
    assert.ok(await tmpEmpty(s));
    assert.deepEqual(s.uploads(), []);
    for (const t of ['files', 'events', 'daily_menus', 'menu_files']) assert.equal(s.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t);
  } finally { await s.close(); }
});

test('temp files are deleted on every error path (415, 400, 409, 404) and after success', async () => {
  const s = await loggedIn();
  try {
    const fake = { field: 'image', buf: Buffer.concat([Buffer.from('<html>'), Buffer.alloc(2 * MB)]), name: 'x.png', type: 'image/png' };
    assert.equal((await post(s, '/api/admin/events', { title: 'E' }, [fake])).status, 415);
    assert.ok(await tmpEmpty(s));
    // magic bytes come from the head: valid PNG head but extension says pdf
    assert.equal((await post(s, '/api/admin/events', { title: 'E' }, [{ ...png('image', 2 * MB), name: 'x.pdf', type: 'application/pdf' }])).status, 415);
    assert.ok(await tmpEmpty(s));
    // validation failure after the upload was received
    assert.equal((await post(s, '/api/admin/events', { title: '' }, [png('image', 2 * MB)])).status, 400);
    assert.ok(await tmpEmpty(s));
    assert.equal((await post(s, '/api/admin/menu/pages', { lang: 'xx' }, [pdf('file', 2 * MB)])).status, 400);
    assert.ok(await tmpEmpty(s));
    assert.equal((await post(s, '/api/admin/events/999', { title: 'E' }, [png('image', 2 * MB)], 'PUT')).status, 404);
    assert.ok(await tmpEmpty(s));
    // conflict
    assert.equal((await post(s, '/api/admin/daily-menus', { date: '2026-06-15' }, [pdf('file', 2 * MB)])).status, 201);
    assert.equal((await post(s, '/api/admin/daily-menus', { date: '2026-06-15' }, [pdf('file', 2 * MB)])).status, 409);
    assert.ok(await tmpEmpty(s));
    assert.equal(s.uploads().length, 1);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 1);
    // unauthenticated / no CSRF: rejected before the body is read
    assert.equal((await s.client().req('POST', '/api/admin/events', { form: form({ title: 'E' }, [png('image', MB)]) })).status, 401);
    assert.equal((await s.api.req('POST', '/api/admin/events', { csrf: false, form: form({ title: 'E' }, [png('image', MB)]) })).status, 403);
    assert.ok(await tmpEmpty(s));
  } finally { await s.close(); }
});

test('client abort in the middle of an upload leaves no temp file behind', async () => {
  const s = await loggedIn();
  try {
    const boundary = '----kotaabort';
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nE\r\n--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`;
    const url = new URL(s.base);
    const sock = net.connect(Number(url.port), url.hostname);
    sock.on('error', () => {});
    await new Promise((r) => sock.once('connect', r));
    sock.write(`POST /api/admin/events HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${s.api.cookie}\r\nX-Requested-With: kota-admin\r\n`
      + `Content-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${60 * MB}\r\n\r\n`);
    sock.write(head);
    sock.write(big(PNG, 4 * MB));
    const end = Date.now() + 3000;
    while (Date.now() < end && tmpFiles(s).length === 0) await sleep(10);
    assert.equal(tmpFiles(s).length, 1, 'a temp file exists while the upload is in progress');
    sock.destroy();
    assert.ok(await tmpEmpty(s), 'tmp emptied after the abort');
    assert.deepEqual(s.uploads(), []);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM events').get().n, 0);
  } finally { await s.close(); }
});

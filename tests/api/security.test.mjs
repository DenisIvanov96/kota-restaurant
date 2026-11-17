// Independent security tests against a real server process. Port 3201 (+3205/3206 for rate limit / production).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PDF, JPG, WEBP, PASSWORD, ROOT } from '../lib/harness.mjs';

const NOW = '2026-06-15T10:00:00Z';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
const PNG = makePng();

/** Raw HTTP request so that the path is sent exactly as given (fetch normalises ../). */
function rawGet(port, rawPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET', headers }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}

describe('security (dev mode server)', () => {
  const PORT = 3201;
  let dir; let srv; let admin; let anon; let up;
  before(async () => {
    dir = tmpDir('sec'); createAdmin(dir);
    srv = await startServer({ port: PORT, dataDir: dir, now: NOW });
    admin = new Client(srv.url); await admin.login();
    anon = new Client(srv.url);
    up = (name) => fs.readdirSync(path.join(dir, 'uploads')).length;
  });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  // ---- S1: every admin endpoint rejects unauthenticated requests ----
  const ENDPOINTS = [
    ['GET', '/api/admin/me'], ['GET', '/api/admin/dashboard'], ['GET', '/api/admin/settings'], ['PUT', '/api/admin/settings'],
    ['GET', '/api/admin/media/00000000000000000000000000000000.png'],
    ['POST', '/api/admin/logout'], ['POST', '/api/admin/password'], ['POST', '/api/admin/totp/setup'],
    ['POST', '/api/admin/totp/enable'], ['POST', '/api/admin/totp/disable'],
    ['GET', '/api/admin/events'], ['POST', '/api/admin/events'], ['PUT', '/api/admin/events/1'],
    ['PATCH', '/api/admin/events/1/enabled'], ['DELETE', '/api/admin/events/1'],
    ['GET', '/api/admin/daily-menus'], ['POST', '/api/admin/daily-menus'], ['PUT', '/api/admin/daily-menus/1'],
    ['PATCH', '/api/admin/daily-menus/1/published'], ['DELETE', '/api/admin/daily-menus/1'],
    ['GET', '/api/admin/menu'], ['PUT', '/api/admin/menu/draft'], ['POST', '/api/admin/menu/draft/discard'],
    ['POST', '/api/admin/menu/publish'], ['POST', '/api/admin/menu/pages'], ['PUT', '/api/admin/menu/pages/order'], ['PUT', '/api/admin/menu/pages/published'],
    ['DELETE', '/api/admin/menu/pages/1'], ['PUT', '/api/admin/menu/mode'],
    ['GET', '/api/admin/menu/pages/download?lang=bg'], ['GET', '/api/admin/menu/pages/download'], ['GET', '/api/admin/menu/pages/download?lang=zz'], // D-49: admin-only ZIP; auth must precede validation
    ['POST', '/api/admin/menu/files'], ['PATCH', '/api/admin/menu/files/1/published'], ['DELETE', '/api/admin/menu/files/1'], // removed in T-38: must still not answer unauthenticated requests with anything but 401
    ['GET', '/api/admin/gallery'], ['POST', '/api/admin/gallery'], ['PATCH', '/api/admin/gallery/1'], ['PUT', '/api/admin/gallery/order'], ['DELETE', '/api/admin/gallery/1'], // T-50: D-51 gallery admin API
    ['GET', '/api/admin/does-not-exist'],
  ];
  test(`S1a all ${ENDPOINTS.length} admin endpoints: no cookie + CSRF header => 401`, async () => {
    for (const [m, p] of ENDPOINTS) {
      const r = await anon.req(m, p, { json: m === 'GET' || m === 'DELETE' ? undefined : {} });
      assert.equal(r.status, 401, `${m} ${p} -> ${r.status}`);
    }
  });
  test('S1b non-GET without CSRF header and without cookie => 401 or 403 (never 2xx)', async () => {
    for (const [m, p] of ENDPOINTS.filter(([m]) => m !== 'GET')) {
      const r = await anon.req(m, p, { csrf: false, json: {} });
      assert.ok([401, 403].includes(r.status), `${m} ${p} -> ${r.status}`);
    }
  });
  test('S1c garbage / forged / truncated session cookies rejected on every endpoint', async () => {
    const cookies = ['kota_session=garbage', 'kota_session=', 'kota_session=' + 'A'.repeat(43), 'kota_session=../../etc/passwd',
      "kota_session=' OR '1'='1", 'kota_session=' + 'a'.repeat(5000), 'kota_session=1; kota_session=2', 'kota_session=%00'];
    for (const c of cookies) {
      for (const [m, p] of ENDPOINTS) {
        const r = await anon.req(m, p, { cookie: c, json: m === 'GET' || m === 'DELETE' ? undefined : {} });
        assert.equal(r.status, 401, `${c.slice(0, 30)} ${m} ${p} -> ${r.status}`);
      }
    }
  });
  test('S1d valid CSRF header but no session cannot modify content (state unchanged)', async () => {
    const before = (await admin.get('/api/admin/events')).data.events.length;
    const r = await anon.post('/api/admin/events', { form: form({ title: 'hacked', enabled: 'true' }) });
    assert.equal(r.status, 401);
    assert.equal((await anon.put('/api/admin/menu/draft', { json: { categories: [{ name: 'x', items: [] }] } })).status, 401);
    assert.equal((await anon.put('/api/admin/settings', { json: { address: 'pwned' } })).status, 401);
    assert.equal((await admin.get('/api/admin/events')).data.events.length, before);
    assert.notEqual((await anon.get('/api/public/site')).data.address, 'pwned');
  });
  test('S1e public API is read-only (non-GET => 404/405, no state change)', async () => {
    for (const p of ['/api/public/site', '/api/public/events', '/api/public/daily-menu', '/api/public/menu']) {
      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const r = await anon.req(m, p, { json: {} });
        assert.ok([404, 405].includes(r.status), `${m} ${p} -> ${r.status}`);
      }
    }
    const r = await anon.req('POST', '/media/x.png', { json: {} });
    assert.ok([404, 405].includes(r.status));
  });

  // ---- S2: CSRF / Origin / CORS ----
  test('S2a cross-origin Origin header rejected (403 csrf) even with session + CSRF header', async () => {
    for (const origin of ['https://evil.example', 'http://127.0.0.1:9999', 'null', `http://127.0.0.1.evil.example:${PORT}`, 'garbage']) {
      const r = await admin.post('/api/admin/logout', { origin });
      assert.equal(r.status, 403, `origin ${origin} -> ${r.status}`);
      assert.equal(r.data.error, 'csrf');
    }
    assert.equal((await admin.get('/api/admin/me')).status, 200, 'session must still be alive after rejected logout');
  });
  test('S2b login endpoint also checks Origin and CSRF header', async () => {
    assert.equal((await anon.post('/api/admin/login', { origin: 'https://evil.example', json: { username: 'owner', password: PASSWORD } })).status, 403);
    assert.equal((await anon.post('/api/admin/login', { csrf: false, json: { username: 'owner', password: PASSWORD } })).status, 403);
  });
  test('S2c same-origin Origin accepted', async () => {
    const r = await admin.patch('/api/admin/events/99999/enabled', { origin: srv.url, json: { enabled: true } });
    assert.equal(r.status, 404); // passed CSRF, not found
  });
  test('S2d CSRF via classic HTML form post (urlencoded/text, no header) rejected', async () => {
    const r = await admin.req('POST', '/api/admin/menu/publish', { csrf: false, headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: 'a=b' });
    assert.equal(r.status, 403);
  });
  test('S2e no CORS headers are emitted (preflight does not authorise other origins)', async () => {
    const r = await fetch(srv.url + '/api/admin/me', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    const g = await fetch(srv.url + '/api/public/events', { headers: { origin: 'https://evil.example' } });
    assert.equal(g.headers.get('access-control-allow-origin'), null);
  });

  // ---- S3: cookie flags ----
  test('S3 session cookie: HttpOnly; SameSite=Strict; Path=/; no Secure in dev; token random 43 chars', async () => {
    const c = new Client(srv.url); await c.login();
    const sc = c.lastSetCookie[0];
    assert.match(sc, /^kota_session=[A-Za-z0-9_-]{43};/);
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Path=\//); assert.match(sc, /Max-Age=604800/);
    assert.doesNotMatch(sc, /Secure/);
    const c2 = new Client(srv.url); await c2.login();
    assert.notEqual(c.cookie, c2.cookie, 'tokens differ per login');
  });

  // ---- S4: session lifecycle ----
  test('S4a logout invalidates the session server-side (old cookie unusable) and clears cookie', async () => {
    const c = new Client(srv.url); await c.login();
    const old = c.cookie;
    assert.equal((await c.get('/api/admin/me')).status, 200);
    const r = await c.post('/api/admin/logout');
    assert.equal(r.status, 204);
    assert.match(c.lastSetCookie[0], /Max-Age=0/);
    assert.equal((await anon.get('/api/admin/me', { cookie: old })).status, 401);
    assert.equal((await anon.post('/api/admin/events', { cookie: old, form: form({ title: 'x' }) })).status, 401);
  });
  test('S4b password change revokes other sessions, keeps current, old password dead', async () => {
    const dir2 = tmpDir('pw'); createAdmin(dir2, 'pwuser', PASSWORD);
    const s2 = await startServer({ port: 3206, dataDir: dir2, now: NOW });
    try {
      const a = new Client(s2.url); const b = new Client(s2.url);
      await a.login('pwuser'); await b.login('pwuser');
      assert.equal((await b.get('/api/admin/me')).status, 200);
      const bad = await a.post('/api/admin/password', { json: { currentPassword: 'wrong-wrong-wrong', newPassword: 'another-new-password-1' } });
      assert.equal(bad.status, 400); assert.ok(bad.data.fields.currentPassword);
      assert.equal((await b.get('/api/admin/me')).status, 200, 'failed change must not revoke');
      const short = await a.post('/api/admin/password', { json: { currentPassword: PASSWORD, newPassword: 'short' } });
      assert.equal(short.status, 400); assert.ok(short.data.fields.newPassword);
      const ok = await a.post('/api/admin/password', { json: { currentPassword: PASSWORD, newPassword: 'another-new-password-1' } });
      assert.equal(ok.status, 204);
      assert.equal((await b.get('/api/admin/me')).status, 401, 'other session revoked');
      assert.equal((await a.get('/api/admin/me')).status, 200, 'current session kept');
      assert.equal((await new Client(s2.url).req('POST', '/api/admin/login', { json: { username: 'pwuser', password: PASSWORD } })).status, 401);
      assert.equal((await new Client(s2.url).req('POST', '/api/admin/login', { json: { username: 'pwuser', password: 'another-new-password-1' } })).status, 200);
    } finally { await s2.stop(); fs.rmSync(dir2, { recursive: true, force: true }); }
  });
  test('S4c login errors do not reveal whether username exists; malformed login bodies => 400', async () => {
    const c = new Client(srv.url);
    const a = await c.post('/api/admin/login', { json: { username: 'owner', password: 'x'.repeat(14) } });
    const b = await c.post('/api/admin/login', { json: { username: 'nobody', password: 'x'.repeat(14) } });
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    assert.deepEqual(a.data, b.data);
    for (const body of [{ username: { $ne: 1 }, password: { $ne: 1 } }, { username: 'owner' }, {}, { username: 'a'.repeat(101), password: 'x' }, { username: ['owner'], password: 'x' }]) {
      const r = await c.post('/api/admin/login', { json: body });
      assert.ok([400, 401].includes(r.status) && r.status !== 200, JSON.stringify(body) + ' -> ' + r.status);
    }
    assert.equal((await c.post('/api/admin/login', { raw: 'not json', headers: { 'content-type': 'application/json' } })).status, 400);
  });
  test('S4d no registration endpoint exists', async () => {
    for (const p of ['/api/admin/register', '/api/admin/signup', '/api/admin/users', '/api/register', '/register']) {
      const r = await anon.post(p, { json: { username: 'evil', password: 'x'.repeat(20) } });
      assert.ok([401, 403, 404].includes(r.status), `${p} -> ${r.status}`);
    }
    assert.equal((await admin.post('/api/admin/register', { json: { username: 'evil', password: 'x'.repeat(20) } })).status, 404);
  });

  // ---- S5: uploads ----
  const EV = '/api/admin/events';
  const evForm = (file) => form({ title: 'upload test', enabled: 'false' }, file && { field: 'image', ...file });
  const BAD = [
    ['HTML text renamed .pdf', Buffer.from('<html><script>alert(1)</script></html>'), 'x.pdf', 'application/pdf', 'file'],
    ['HTML text renamed .png (image/png)', Buffer.from('<html><script>alert(1)</script></html>'), 'x.png', 'image/png', 'image'],
    ['PNG bytes renamed .pdf', PNG, 'x.pdf', 'application/pdf', 'file'],
    ['PDF bytes named .png', PDF, 'x.png', 'image/png', 'image'],
    ['SVG as .svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg', 'image/svg+xml', 'image'],
    ['SVG as .png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png', 'image/png', 'image'],
    ['HTML as .html', Buffer.from('<!doctype html><script>alert(1)</script>'), 'x.html', 'text/html', 'image'],
    ['PNG magic but .html ext', PNG, 'x.html', 'image/png', 'image'],
    ['PNG magic but .svg ext', PNG, 'x.svg', 'image/svg+xml', 'image'],
    ['PNG magic but no extension', PNG, 'noext', 'image/png', 'image'],
    ['PNG with double ext .png.html', PNG, 'x.png.html', 'image/png', 'image'],
    ['GIF + script polyglot', Buffer.concat([Buffer.from('GIF89a'), Buffer.from('<script>alert(1)</script>')]), 'x.png', 'image/png', 'image'],
    ['empty file', Buffer.alloc(0), 'x.png', 'image/png', 'image'],
    ['PNG bytes with text/html declared MIME', PNG, 'x.png', 'text/html', 'image'],
    ['JS file', Buffer.from('alert(1)'), 'x.js', 'application/javascript', 'image'],
    ['PHP-ish', Buffer.from('<?php system($_GET[0]); ?>'), 'shell.php', 'application/x-php', 'image'],
  ];
  test('S5a invalid event image uploads rejected (415/400) and leave no orphan files', async () => {
    const n0 = up();
    for (const [label, buf, name, type] of BAD) {
      const r = await admin.post(EV, { form: evForm({ buf, name, type }) });
      assert.ok([400, 415].includes(r.status), `${label} -> ${r.status} ${r.text().slice(0, 100)}`);
    }
    assert.equal(up(), n0, 'no orphan files');
    assert.equal((await admin.get(EV)).data.events.filter((e) => e.title === 'upload test').length, 0, 'no event row created');
  });
  test('S5b invalid daily-menu and menu-page uploads rejected', async () => {
    const n0 = up();
    for (const [label, buf, name, type] of BAD) {
      if (label.includes('PDF bytes named .png') || label === 'PNG bytes renamed .pdf') { /* covered below */ }
      const r1 = await admin.post('/api/admin/daily-menus', { form: form({ date: '2026-07-01', published: 'true' }, { field: 'file', buf, name, type }) });
      assert.ok([400, 415].includes(r1.status), `daily ${label} -> ${r1.status}`);
      const r2 = await admin.post('/api/admin/menu/pages', { form: form({ lang: 'bg' }, { field: 'file', buf, name, type }) });
      assert.ok([400, 415].includes(r2.status), `menu page ${label} -> ${r2.status}`);
    }
    assert.equal(up(), n0);
  });
  test('S5c PDF is NOT acceptable as event image; SVG/HTML never accepted anywhere', async () => {
    const r = await admin.post(EV, { form: evForm({ buf: PDF, name: 'x.pdf', type: 'application/pdf' }) });
    assert.equal(r.status, 415);
  });
  test('S5d oversize uploads => 413 at 50 MB + 1 (event, daily, menu page), no orphans (D-44; the 5/10/15 MB limits are gone)', async () => {
    const n0 = up();
    const big = (head) => Buffer.concat([head, Buffer.alloc(50 * 1024 * 1024 - head.length + 1, 0x41)]);
    let r = await admin.post(EV, { form: evForm({ buf: big(PNG.subarray(0, 8)), name: 'big.png', type: 'image/png' }) });
    assert.equal(r.status, 413, 'event ' + r.status);
    r = await admin.post('/api/admin/daily-menus', { form: form({ date: '2026-07-02', published: 'true' }, { field: 'file', buf: big(Buffer.from('%PDF-1.4\n')), name: 'big.pdf', type: 'application/pdf' }) });
    assert.equal(r.status, 413, 'daily ' + r.status);
    r = await admin.post('/api/admin/menu/pages', { form: form({ lang: 'bg' }, { field: 'file', buf: big(Buffer.from('%PDF-1.4\n')), name: 'big.pdf', type: 'application/pdf' }) });
    assert.equal(r.status, 413, 'menu page ' + r.status);
    assert.equal(up(), n0);
  });
  test('S5e a file of exactly 50 MB is accepted (event image) and a 6 MB image (old limit 5 MB) too', async () => {
    const head = PNG.subarray(0, 8);
    for (const mb of [6, 50]) {
      const buf = Buffer.concat([head, Buffer.alloc(mb * 1024 * 1024 - head.length, 0)]);
      const r = await admin.post(EV, { form: evForm({ buf, name: 'edge.png', type: 'image/png' }) });
      assert.equal(r.status, 201, `${mb} MB -> ${r.status}`);
      await admin.del(`${EV}/${r.data.id}`);
    }
  });
  test('S5f polyglot: valid PNG header + trailing <script> is served only as image/png with nosniff + CSP (cannot execute)', async () => {
    const poly = Buffer.concat([PNG, Buffer.from('<script>window.__xss=1</script>')]);
    const r = await admin.post(EV, { form: form({ title: 'poly', enabled: 'true' }, { field: 'image', buf: poly, name: 'p.png', type: 'image/png' }) });
    assert.equal(r.status, 201);
    const pub = (await anon.get('/api/public/events')).data.events.find((e) => e.title === 'poly');
    const m = await anon.get(pub.imageUrl);
    assert.equal(m.status, 200);
    assert.equal(m.headers.get('content-type'), 'image/png');
    assert.equal(m.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(m.headers.get('content-security-policy'), CSP);
    assert.match(m.headers.get('content-disposition'), /^inline/);
    await admin.del(`${EV}/${r.data.id}`);
  });
  test('S5g hostile original filenames are sanitised; stored name is random hex; path never leaks', async () => {
    for (const name of ['../../../../etc/passwd.png', '..\\..\\win.png', 'a"b<c>d.png', 'x\r\nSet-Cookie: a=b.png', 'é\u0000.png', 'a'.repeat(400) + '.png']) {
      const r = await admin.post('/api/admin/menu/pages', { form: form({ lang: 'bg' }, { field: 'file', buf: PNG, name, type: 'image/png' }) });
      if (r.status !== 201) { assert.ok([400, 415].includes(r.status), name + ' -> ' + r.status); continue; }
      assert.match(r.data.fileUrl, /^\/api\/admin\/media\/[a-f0-9]{32}\.png$/);
      assert.ok(r.data.originalName.length <= 200);
      assert.doesNotMatch(r.data.originalName, /[\\/<>"\r\n\u0000]/, r.data.originalName);
      const m = await admin.get(r.data.fileUrl);
      assert.equal(m.status, 200);
      assert.doesNotMatch(m.headers.get('content-disposition'), /[\r\n]/);
      await admin.del(`/api/admin/menu/pages/${r.data.id}`);
    }
  });
  test('S5h wrong multipart field name / multiple files / no file => 4xx, no orphans', async () => {
    const n0 = up();
    let fd = new FormData(); fd.append('title', 't'); fd.append('wrongfield', new Blob([PNG], { type: 'image/png' }), 'a.png');
    let r = await admin.post(EV, { form: fd });
    assert.ok(r.status >= 400 && r.status < 500, 'wrong field ' + r.status);
    fd = new FormData(); fd.append('title', 't'); fd.append('image', new Blob([PNG], { type: 'image/png' }), 'a.png'); fd.append('image', new Blob([PNG], { type: 'image/png' }), 'b.png');
    r = await admin.post(EV, { form: fd });
    assert.ok(r.status >= 400 && r.status < 500, 'two files ' + r.status);
    r = await admin.post('/api/admin/menu/pages', { form: form({ lang: 'bg' }) });
    assert.equal(r.status, 400);
    r = await admin.post('/api/admin/menu/pages', { form: form({ lang: 'xx' }, { field: 'file', buf: PNG, name: 'a.png', type: 'image/png' }) });
    assert.equal(r.status, 400);
    assert.equal(up(), n0);
  });
  test('S5i accepted types: jpg, png, webp, pdf all pass (sanity for rejection logic)', async () => {
    for (const [buf, name, type, ep] of [[JPG, 'a.jpg', 'image/jpeg'], [JPG, 'a.jpeg', 'image/jpeg'], [PNG, 'a.png', 'image/png'], [WEBP, 'a.webp', 'image/webp'], [PDF, 'a.pdf', 'application/pdf']]) {
      const r = await admin.post('/api/admin/menu/pages', { form: form({ lang: 'en' }, { field: 'file', buf, name, type }) });
      assert.equal(r.status, 201, name);
      await admin.del(`/api/admin/menu/pages/${r.data.id}`);
    }
  });
  test('S5j menu pages are not public until their language is published AND mode=file; admin media needs a session; page uploads need CSRF', async () => {
    const r = await admin.post('/api/admin/menu/pages', { form: form({ lang: 'en' }, { field: 'file', buf: PNG, name: 'p.png', type: 'image/png' }) });
    assert.equal(r.status, 201);
    const pubUrl = r.data.fileUrl.replace('/api/admin', '');
    assert.equal((await anon.get(pubUrl)).status, 404, 'unpublished page: /media 404');
    assert.equal((await anon.get(r.data.fileUrl)).status, 401, 'admin media needs a session');
    assert.equal((await admin.put('/api/admin/menu/pages/published', { json: { lang: 'en', published: true } })).status, 200);
    assert.equal((await anon.get(pubUrl)).status, 404, 'published flag but mode=structured: still 404');
    assert.equal((await anon.get('/api/public/menu')).data.file, null);
    assert.equal((await admin.put('/api/admin/menu/pages/published', { json: { lang: 'en', published: false } })).status, 200);
    const noCsrf = await admin.post('/api/admin/menu/pages', { csrf: false, form: form({ lang: 'en' }, { field: 'file', buf: PNG, name: 'p.png', type: 'image/png' }) });
    assert.ok([401, 403].includes(noCsrf.status), 'no CSRF header: ' + noCsrf.status);
    const cross = await admin.post('/api/admin/menu/pages', { origin: 'https://evil.example', form: form({ lang: 'en' }, { field: 'file', buf: PNG, name: 'p.png', type: 'image/png' }) });
    assert.equal(cross.status, 403);
    await admin.del(`/api/admin/menu/pages/${r.data.id}`);
  });

  // ---- S6: traversal + non-served paths ----
  test('S6a path traversal on /media and /api/admin/media never returns a file', async () => {
    const evil = ['..%2f..%2fserver%2fsrc%2fapp.js', '%2e%2e%2f%2e%2e%2fpackage.json', '..%2F..%2F..%2Fetc%2Fpasswd', '%252e%252e%252fpackage.json',
      '....//....//package.json', '..%5c..%5cpackage.json', 'kota.db', '..%2fkota.db', '%00', 'a.png%00.html', '0'.repeat(32) + '.png', 'A'.repeat(32) + '.PNG', '.env'];
    for (const base of ['/media/', '/api/admin/media/']) {
      for (const e of evil) {
        const r = base.startsWith('/api') ? await admin.get(base + e) : await rawGet(Number(new URL(srv.url).port), base + e);
        const status = r.status;
        assert.ok([400, 401, 404].includes(status), `${base}${e} -> ${status}`);
      }
    }
    for (const p of ['/media/../package.json', '/media/../../server/src/app.js', '/api/admin/media/../../../package.json', '/media/./../data/kota.db']) {
      const r = await rawGet(Number(new URL(srv.url).port), p, { cookie: admin.cookie });
      assert.ok(r.status === 404 || r.status === 400 || r.status === 401, `${p} -> ${r.status}`);
      assert.doesNotMatch(r.body.toString(), /"name": "kota-restaurant"|createApp|SQLite format/);
    }
  });
  test('S6b internal files are not served over HTTP', async () => {
    const paths = ['/server/src/app.js', '/server/', '/server/test/helpers.js', '/data/kota.db', '/data/', '/.env', '/.env.example', '/package.json', '/package-lock.json',
      '/docs/ARCHITECTURE.md', '/docs/', '/ops/', '/ops/Caddyfile', '/.git/config', '/.git/HEAD', '/.git/', '/node_modules/express/package.json',
      '/README.md', '/CLAUDE.md', '/tests/lib/harness.mjs', '/.gitignore', '/.claude/', '/server/migrations/001_init.sql'];
    for (const p of paths) {
      const r = await rawGet(PORT, p);
      assert.equal(r.status, 404, `${p} -> ${r.status}`);
      assert.doesNotMatch(r.body.toString(), /createApp|express|CREATE TABLE|\[core\]|SQLite format/);
    }
    for (const p of ['/..%2fpackage.json', '/%2e%2e/package.json', '/css/..%2f..%2fpackage.json', '/css/%2e%2e%2f%2e%2e%2fserver/src/app.js', '/..\\package.json', '/admin/..%2f..%2fpackage.json', '/%252e%252e/package.json']) {
      const r = await rawGet(PORT, p);
      assert.ok([400, 403, 404].includes(r.status), `${p} -> ${r.status}`);
      assert.doesNotMatch(r.body.toString(), /"name": "kota-restaurant"|createApp/);
    }
  });
  test('S6c unknown routes / errors do not leak stack traces; malformed ids => 404', async () => {
    for (const p of ['/api/admin/events/abc', '/api/admin/events/-1', '/api/admin/events/1e3', '/api/admin/events/99999999999999999999', '/api/admin/daily-menus/0/published']) {
      const r = await admin.req(p.endsWith('published') ? 'PATCH' : 'PUT', p, { json: {} });
      assert.equal(r.status, 404, `${p} -> ${r.status}`);
      assert.doesNotMatch(r.text(), /at .*\(.*:\d+:\d+\)|node:internal/);
    }
    const r = await anon.get('/api/nonexistent');
    assert.equal(r.status, 404);
    assert.equal(r.data.error, 'not_found');
  });

  // ---- S7: headers ----
  test('S7 security headers + CSP on HTML, API, media, static, 404', async () => {
    // create a public image so /media can be checked
    const ev = await admin.post(EV, { form: form({ title: 'hdr', enabled: 'true' }, { field: 'image', buf: PNG, name: 'h.png', type: 'image/png' }) });
    const imgUrl = (await anon.get('/api/public/events')).data.events.find((e) => e.title === 'hdr').imageUrl;
    const targets = ['/', '/daily-menu', '/daily-menu.html', '/admin/', '/admin', '/css/style.css', '/js/index.js', '/admin/js/app.js', '/api/public/site', '/api/public/events',
      '/api/public/menu', '/api/public/daily-menu', '/api/admin/me', '/api/admin/events', imgUrl, '/does-not-exist', '/api/nope'];
    for (const t of targets) {
      const r = await admin.get(t);
      const h = r.headers;
      if (r.status === 301) { // express.static directory redirect: stricter CSP 'none' on the redirect body (harmless)
        assert.equal(h.get('location'), '/admin/'); assert.equal(h.get('content-security-policy'), "default-src 'none'"); continue;
      }
      assert.equal(h.get('content-security-policy'), CSP, `CSP ${t}`);
      assert.equal(h.get('x-content-type-options'), 'nosniff', `nosniff ${t}`);
      assert.equal(h.get('referrer-policy'), 'same-origin', `referrer ${t}`);
      assert.equal(h.get('x-frame-options'), 'SAMEORIGIN', `xfo ${t}`);
      assert.equal(h.get('x-powered-by'), null, `x-powered-by ${t}`);
      if (t.startsWith('/api/')) assert.equal(h.get('cache-control'), 'no-store', `cache ${t}`);
      if (t.startsWith('/admin') || t.startsWith('/api/admin')) assert.equal(h.get('x-robots-tag'), 'noindex', `robots ${t}`);
    }
    for (const t of ['/', '/daily-menu', '/admin/', imgUrl]) assert.equal((await admin.get(t)).headers.get('cache-control'), 'no-cache', `cache ${t}`);
    assert.equal((await admin.get('/')).headers.get('x-robots-tag'), null, 'public page must stay indexable');
    await admin.del(`${EV}/${ev.data.id}`);
  });
  test('S7b HTML has no inline script / on* handlers / style attributes (CSP-compatible)', async () => {
    for (const p of ['/', '/daily-menu', '/admin/']) {
      const html = (await anon.get(p)).text();
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `inline script in ${p}`);
      assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `on* attr in ${p}`);
      assert.doesNotMatch(html, /\sstyle\s*=/i, `style attr in ${p}`);
      for (const m of html.matchAll(/<script[^>]*src="([^"]+)"/g)) assert.ok(m[1].startsWith('/'), `external script ${m[1]}`);
    }
  });

  // ---- S8: input validation ----
  test('S8a validation: event fields, dates, limits => 400 with `fields`', async () => {
    const cases = [
      [{ title: '' }, 'title'], [{ title: 'x'.repeat(121) }, 'title'], [{ title: 't', description: 'd'.repeat(2001) }, 'description'],
      [{ title: 't', startsAt: '2026-13-01T10:00' }, 'startsAt'], [{ title: 't', expiresAt: 'tomorrow' }, 'expiresAt'], [{ title: 't', eventAt: '2026-02-30T10:00' }, 'eventAt'],
      [{ title: 't', startsAt: '2026-07-02T10:00', expiresAt: '2026-07-01T10:00' }, 'expiresAt'], [{ title: 't', startsAt: '2026-07-02T10:00', expiresAt: '2026-07-02T10:00' }, 'expiresAt'],
      [{ title: 't', enabled: 'maybe' }, 'enabled'],
    ];
    for (const [f, key] of cases) {
      const r = await admin.post(EV, { form: form(f) });
      assert.equal(r.status, 400, JSON.stringify(f) + ' -> ' + r.status);
      assert.ok(r.data.fields && r.data.fields[key], `fields.${key} missing: ${JSON.stringify(r.data)}`);
    }
    assert.equal((await admin.post(EV, { form: form({ title: 'x'.repeat(120), description: 'd'.repeat(2000) }) })).status, 201);
  });
  test('S8b validation: draft menu edge cases', async () => {
    const put = (categories) => admin.put('/api/admin/menu/draft', { json: { categories } });
    const item = (o) => ({ name: 'n', description: '', priceCents: 100, available: true, ...o });
    for (const [label, cats] of [
      ['negative price', [{ name: 'c', items: [item({ priceCents: -1 })] }]], ['float price', [{ name: 'c', items: [item({ priceCents: 1.5 })] }]],
      ['string price', [{ name: 'c', items: [item({ priceCents: '100' })] }]], ['too high', [{ name: 'c', items: [item({ priceCents: 10000001 })] }]],
      ['empty name', [{ name: ' ', items: [] }]], ['item name 101', [{ name: 'c', items: [item({ name: 'x'.repeat(101) })] }]],
      ['desc 501', [{ name: 'c', items: [item({ description: 'x'.repeat(501) })] }]], ['51 cats', Array.from({ length: 51 }, (_, i) => ({ name: 'c' + i, items: [] }))],
      ['unknown id', [{ id: 99999, name: 'c', items: [] }]], ['duplicate id', [{ id: 1, name: 'a', items: [] }, { id: 1, name: 'b', items: [] }]],
      ['non-object cat', ['str']], ['201 items', [{ name: 'c', items: Array.from({ length: 201 }, () => item({})) }]],
      ['object name', [{ name: { a: 1 }, items: [] }]],
    ]) {
      const r = await put(cats);
      assert.equal(r.status, 400, `${label} -> ${r.status}`);
      assert.ok(r.data.fields, label);
    }
    assert.equal((await admin.put('/api/admin/menu/draft', { json: { categories: 'x' } })).status, 400);
    assert.equal((await admin.put('/api/admin/menu/draft', { json: {} })).status, 400);
    const proto = await admin.put('/api/admin/menu/draft', { raw: '{"__proto__":{"polluted":1},"categories":[{"name":"p","items":[]}]}', headers: { 'content-type': 'application/json' } });
    assert.ok([200, 400].includes(proto.status));
    assert.equal(({}).polluted, undefined);
    assert.equal((await admin.get('/api/admin/me')).status, 200, 'server still healthy');
    await admin.put('/api/admin/menu/draft', { json: { categories: [] } });
  });
  test('S8c validation: settings, oversized JSON, bad JSON', async () => {
    for (const body of [{ reservationPhone: 'call me' }, { reservationPhone: '1'.repeat(31) }, { address: 'x'.repeat(201) }, { openingHours: 'x'.repeat(501) }, { currencySymbol: 'x'.repeat(6) }, { currencySymbol: '' }, { address: 5 }]) {
      const r = await admin.put('/api/admin/settings', { json: body });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60) + ' -> ' + r.status);
    }
    const big = await admin.put('/api/admin/settings', { raw: JSON.stringify({ address: 'x'.repeat(2 * 1024 * 1024) }), headers: { 'content-type': 'application/json' } });
    assert.equal(big.status, 413);
    const bad = await admin.put('/api/admin/settings', { raw: '{bad', headers: { 'content-type': 'application/json' } });
    assert.equal(bad.status, 400);
    const ok = await admin.put('/api/admin/settings', { json: { reservationPhone: '+359 88 123 4567', address: 'ул. Тест 1', openingHours: '10-22', currencySymbol: '€' } });
    assert.equal(ok.status, 200);
  });
  test('S8d SQL-injection-like text is stored literally (parametrised queries)', async () => {
    const t = "Robert'); DROP TABLE events;--";
    const r = await admin.post(EV, { form: form({ title: t, description: "' OR 1=1 --", enabled: 'true' }) });
    assert.equal(r.status, 201);
    const list = (await admin.get(EV)).data.events;
    assert.ok(list.find((e) => e.title === t));
    await admin.del(`${EV}/${r.data.id}`);
  });
  test('S8e public API exposes only whitelisted fields (no admin-only data)', async () => {
    const ev = await admin.post(EV, { form: form({ title: 'pub', enabled: 'true', startsAt: '2026-06-01T10:00', expiresAt: '2026-07-01T10:00' }) });
    const e = (await anon.get('/api/public/events')).data.events.find((x) => x.title === 'pub');
    assert.deepEqual(Object.keys(e).sort(), ['description', 'eventAt', 'id', 'imageUrl', 'title']);
    const s = (await anon.get('/api/public/site')).data;
    assert.deepEqual(Object.keys(s).sort(), ['about', 'address', 'currencySymbol', 'instagramUrl', 'lang', 'openingHours', 'reservationPhone']); // `lang` added by T-14 (D-27); `instagramUrl` added by T-26 (D-36, public by design: it is shown on the site); `about` added by T-47 (D-52: served About text or null, public by design)
    assert.equal(s.lang, 'bg');
    await admin.del(`${EV}/${ev.data.id}`);
  });
  test('S8f admin cannot be created / modified via API: settings PUT ignores unknown keys (mass assignment)', async () => {
    const r = await admin.put('/api/admin/settings', { json: { menu_mode: 'file', menuMode: 'file', draft_updated_at: '0', admins: [] } });
    assert.equal(r.status, 200);
    assert.equal((await admin.get('/api/admin/menu')).data.mode, 'structured');
  });

  // ---- S9: secrets in repo ----
  test('S9 git grep for secrets (printed for manual triage; asserts no obvious credentials in tracked files)', () => {
    let out = '';
    try { out = execSync('git grep -nIiE "api[_-]?key|secret|password|token" -- . ":!package-lock.json" ":!tests"', { cwd: ROOT, encoding: 'utf8' }); } catch (e) { out = e.stdout || ''; }
    const lines = out.split('\n').filter(Boolean);
    console.log(`# git grep matches (excluding tests/ and lockfile): ${lines.length}`);
    // hard failures: private keys, long literal credentials, cloud keys
    const hard = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => !f.startsWith('tests/') && f !== 'package-lock.json')
      .flatMap((f) => { const t = fs.readFileSync(path.join(ROOT, f), 'utf8'); return [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /ghp_[A-Za-z0-9]{30,}/, /sk-[A-Za-z0-9]{20,}/, /xox[bp]-[A-Za-z0-9-]{10,}/].filter((re) => re.test(t)).map((re) => `${f}: ${re}`); });
    assert.deepEqual(hard, []);
    const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n');
    assert.ok(!tracked.some((f) => /(^|\/)\.env$|\.db$|\.db-wal$|^data\//.test(f)), 'no env/db/data files tracked');
  });
});

describe('security: login rate limiting (own server, port 3205)', () => {
  let dir; let srv;
  before(async () => { dir = tmpDir('rl'); createAdmin(dir); srv = await startServer({ port: 3205, dataDir: dir, now: NOW }); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  test('S10a 5 failures from one IP => 6th attempt 429 with Retry-After/retryAfter, even with the correct password; X-Forwarded-For spoofing does not bypass when TRUST_PROXY is off', async () => {
    const c = new Client(srv.url);
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/api/admin/login', { headers: { 'x-forwarded-for': `10.0.0.${i}` }, json: { username: 'owner', password: 'wrong-wrong-wrong' } });
      assert.equal(r.status, 401, `attempt ${i + 1}`);
    }
    const blocked = await c.post('/api/admin/login', { headers: { 'x-forwarded-for': '10.9.9.9' }, json: { username: 'owner', password: 'wrong-wrong-wrong' } });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.error, 'rate_limited');
    assert.ok(blocked.data.retryAfter > 0 && blocked.data.retryAfter <= 900);
    assert.equal(Number(blocked.headers.get('retry-after')), blocked.data.retryAfter);
    const good = await c.post('/api/admin/login', { json: { username: 'owner', password: PASSWORD } });
    assert.equal(good.status, 429, 'correct password still blocked during lockout');
    const other = await c.post('/api/admin/login', { json: { username: 'someoneelse', password: 'wrong-wrong-wrong' } });
    assert.equal(other.status, 429, 'IP limit applies across usernames');
  });
});

describe('security: per-username limit behind a proxy (TRUST_PROXY=1, port 3207)', () => {
  let dir; let srv;
  before(async () => { dir = tmpDir('rl2'); createAdmin(dir); srv = await startServer({ port: 3207, dataDir: dir, now: NOW, env: { TRUST_PROXY: '1' } }); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  test('S10b 10 failures for one username from 10 different IPs => 11th IP blocked; successful login resets user counter', async () => {
    const c = new Client(srv.url);
    for (let i = 0; i < 10; i++) {
      const r = await c.post('/api/admin/login', { headers: { 'x-forwarded-for': `203.0.113.${i + 1}` }, json: { username: 'OWNER', password: 'wrong-wrong-wrong' } });
      assert.equal(r.status, 401, `attempt ${i + 1}`);
    }
    const r = await c.post('/api/admin/login', { headers: { 'x-forwarded-for': '203.0.113.200' }, json: { username: 'owner', password: PASSWORD } });
    assert.equal(r.status, 429, 'username lockout is case-insensitive and cross-IP');
  });
});

describe('security: production mode (NODE_ENV=production, default HOST, port 3206 reused after S4b)', () => {
  let dir; let srv;
  before(async () => { dir = tmpDir('prod'); createAdmin(dir); srv = await startServer({ port: 3204, dataDir: dir, now: NOW, env: { NODE_ENV: 'production' } }); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  test('S11a production: Secure cookie, KOTA_NOW ignored, binds loopback only', async () => {
    assert.doesNotMatch(srv.log(), /test hook/, 'KOTA_NOW must be ignored in production');
    assert.match(srv.log(), /127\.0\.0\.1:3204/);
    const c = new Client(srv.url); await c.login();
    const sc = c.lastSetCookie[0];
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /; Secure/);
    const today = (await c.get('/api/public/daily-menu')).data.today;
    const real = new Date().toISOString().slice(0, 10);
    assert.ok(Math.abs(Date.parse(today) - Date.parse(real)) <= 86400000, `server uses real clock (today=${today})`);
    assert.notEqual(today, '2026-06-15');
    const r = await c.post('/api/admin/logout');
    assert.match(c.lastSetCookie[0], /Secure/, 'clearing cookie also Secure');
    const h = (await new Client(srv.url).get('/')).headers;
    assert.equal(h.get('content-security-policy'), CSP);
  });
  test('S11b production: internal paths still 404', async () => {
    for (const p of ['/server/src/app.js', '/.env', '/package.json', '/data/kota.db', '/docs/ARCHITECTURE.md', '/.git/config']) {
      assert.equal((await rawGet(3204, p)).status, 404, p);
    }
  });
});

describe('security: session timeouts via clock advance (port 3208)', () => {
  let dir;
  before(() => { dir = tmpDir('sess'); createAdmin(dir); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  test('S12a idle timeout 12h: valid at +11h59m, dead at +12h01m of inactivity', async () => {
    const t0 = Date.parse(NOW);
    let s = await startServer({ port: 3208, dataDir: dir, now: new Date(t0).toISOString() });
    const c = new Client(s.url); await c.login(); const cookie = c.cookie; await s.stop();
    s = await startServer({ port: 3208, dataDir: dir, now: new Date(t0 + (12 * 60 - 1) * 60000).toISOString() });
    assert.equal((await new Client(s.url).get('/api/admin/me', { cookie })).status, 200, 'still valid at 11h59m and refreshed');
    await s.stop();
    s = await startServer({ port: 3208, dataDir: dir, now: new Date(t0 + (12 * 60 - 1) * 60000 + (12 * 60 + 1) * 60000).toISOString() });
    assert.equal((await new Client(s.url).get('/api/admin/me', { cookie })).status, 401, 'dead after 12h01m idle');
    await s.stop();
  });
  test('S12b absolute lifetime 7 days even with continuous activity', async () => {
    const t0 = Date.parse(NOW);
    let s = await startServer({ port: 3208, dataDir: dir, now: new Date(t0).toISOString() });
    const c = new Client(s.url); await c.login(); const cookie = c.cookie; await s.stop();
    let t = t0; let alive = true; let diedAt = null;
    for (let step = 1; step <= 16 && alive; step++) {
      t = t0 + step * 11 * 3600 * 1000; // every 11h
      s = await startServer({ port: 3208, dataDir: dir, now: new Date(t).toISOString() });
      const r = await new Client(s.url).get('/api/admin/me', { cookie });
      await s.stop();
      if (r.status !== 200) { alive = false; diedAt = (t - t0) / 3600000; }
    }
    assert.equal(alive, false, 'session must expire');
    assert.ok(diedAt > 168 && diedAt <= 168 + 11, `died at +${diedAt}h (expected first check after 168h)`);
  });
});

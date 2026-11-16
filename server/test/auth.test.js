import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, loggedIn, makeClient, formData, PASSWORD } from './helpers.js';
import { totpCode, base32Encode, verifyTotp } from '../src/auth.js';

const ROUTES = [
  ['POST', '/api/admin/logout'], ['GET', '/api/admin/me'], ['POST', '/api/admin/password'],
  ['POST', '/api/admin/totp/setup'], ['POST', '/api/admin/totp/enable'], ['POST', '/api/admin/totp/disable'],
  ['GET', '/api/admin/dashboard'], ['GET', '/api/admin/settings'], ['PUT', '/api/admin/settings'],
  ['GET', '/api/admin/media/' + 'a'.repeat(32) + '.pdf'],
  ['GET', '/api/admin/events'], ['POST', '/api/admin/events'], ['PUT', '/api/admin/events/1'],
  ['PATCH', '/api/admin/events/1/enabled'], ['DELETE', '/api/admin/events/1'],
  ['GET', '/api/admin/daily-menus'], ['POST', '/api/admin/daily-menus'], ['PUT', '/api/admin/daily-menus/1'],
  ['PATCH', '/api/admin/daily-menus/1/published'], ['DELETE', '/api/admin/daily-menus/1'],
  ['GET', '/api/admin/menu'], ['PUT', '/api/admin/menu/draft'], ['POST', '/api/admin/menu/draft/discard'],
  ['POST', '/api/admin/menu/publish'], ['POST', '/api/admin/menu/files'],
  ['PATCH', '/api/admin/menu/files/1/published'], ['DELETE', '/api/admin/menu/files/1'], ['PUT', '/api/admin/menu/mode'],
];

test('every admin route: 401 without session, 403 without CSRF header', async () => {
  const s = await loggedIn();
  try {
    const anon = makeClient(s.base);
    for (const [m, u] of ROUTES) {
      const r = await anon.req(m, u, { json: m === 'GET' || m === 'DELETE' ? undefined : {} });
      assert.equal(r.status, 401, `${m} ${u} anon`);
      assert.equal(r.data.error, 'unauthorized');
      if (m !== 'GET') {
        const r2 = await s.api.req(m, u, { csrf: false, json: {} });
        assert.equal(r2.status, 403, `${m} ${u} no csrf`);
        assert.equal(r2.data.error, 'csrf');
      } else {
        const r3 = await s.api.req(m, u);
        assert.notEqual(r3.status, 401, `${m} ${u} with session`);
      }
    }
  } finally { await s.close(); }
});

test('login: csrf header and origin checks apply to login too', async () => {
  const s = await startApp(); await s.addAdmin();
  try {
    const c = s.client();
    assert.equal((await c.req('POST', '/api/admin/login', { csrf: false, json: { username: 'boss', password: PASSWORD } })).status, 403);
    const bad = await c.req('POST', '/api/admin/login', { json: { username: 'boss', password: PASSWORD }, headers: { Origin: 'http://evil.example' } });
    assert.equal(bad.status, 403);
    const good = await c.req('POST', '/api/admin/login', { json: { username: 'boss', password: PASSWORD }, headers: { Origin: s.base } });
    assert.equal(good.status, 200);
  } finally { await s.close(); }
});

test('login success sets hardened cookie; me and logout work; failures are 401', async () => {
  const s = await startApp(); await s.addAdmin();
  try {
    const c = s.client();
    assert.equal((await c.login('boss', 'wrong password!!')).status, 401);
    assert.equal((await c.login('nobody', PASSWORD)).status, 401);
    assert.equal((await c.post('/api/admin/login', { username: 5 })).status, 400);
    const ok = await c.login('BOSS');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data, { admin: { username: 'boss', totpEnabled: false } });
    assert.match(ok.setCookie, /^kota_session=[\w-]{43};/);
    assert.match(ok.setCookie, /HttpOnly/); assert.match(ok.setCookie, /SameSite=Strict/); assert.match(ok.setCookie, /Path=\//);
    assert.doesNotMatch(ok.setCookie, /Secure/);
    assert.equal((await c.get('/api/admin/me')).data.admin.username, 'boss');
    // only a hash is stored
    const token = c.cookie.split('=')[1];
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(token).n, 0);
    assert.equal((await c.post('/api/admin/logout')).status, 204);
    assert.equal((await c.get('/api/admin/me')).status, 401);
  } finally { await s.close(); }
});

test('login rate limit: 5 failures per IP then 429 with retryAfter; window expires', async () => {
  const s = await startApp(); await s.addAdmin();
  try {
    const c = s.client();
    for (let i = 0; i < 5; i++) assert.equal((await c.login('boss', 'bad password 123')).status, 401);
    const r = await c.login('boss', PASSWORD); // even correct password is blocked
    assert.equal(r.status, 429);
    assert.equal(r.data.error, 'rate_limited');
    assert.ok(r.data.retryAfter > 0 && r.data.retryAfter <= 900);
    s.clock.t += 15 * 60 * 1000 + 1000;
    assert.equal((await c.login()).status, 200);
  } finally { await s.close(); }
});

test('login rate limit per username: 10 failures from different IPs', async () => {
  const s = await startApp({ trustProxy: 1 }); await s.addAdmin();
  try {
    const c = s.client();
    for (let i = 0; i < 10; i++) {
      const r = await c.req('POST', '/api/admin/login', { json: { username: 'boss', password: 'bad password 123' }, headers: { 'X-Forwarded-For': `10.0.0.${i + 1}` } });
      assert.equal(r.status, 401);
    }
    const r = await c.req('POST', '/api/admin/login', { json: { username: 'boss', password: PASSWORD }, headers: { 'X-Forwarded-For': '10.0.1.1' } });
    assert.equal(r.status, 429);
  } finally { await s.close(); }
});

test('sessions expire: idle 12 h and absolute 7 days', async () => {
  const s = await loggedIn();
  try {
    s.clock.t += 11 * 3600 * 1000;
    assert.equal((await s.api.get('/api/admin/me')).status, 200);
    s.clock.t += 11 * 3600 * 1000; // active within idle window each time
    assert.equal((await s.api.get('/api/admin/me')).status, 200);
    s.clock.t += 13 * 3600 * 1000;
    assert.equal((await s.api.get('/api/admin/me')).status, 401);
    await s.api.login();
    for (let i = 0; i < 16; i++) { s.clock.t += 10 * 3600 * 1000; assert.equal((await s.api.get('/api/admin/me')).status, 200, 'step ' + i); }
    s.clock.t += 10 * 3600 * 1000; // 170 h after login: beyond 7 days although never idle
    assert.equal((await s.api.get('/api/admin/me')).status, 401);
  } finally { await s.close(); }
});

test('TOTP: setup, enable, login requires code, disable', async () => {
  const s = await loggedIn();
  try {
    const setup = await s.api.post('/api/admin/totp/setup');
    assert.equal(setup.status, 200);
    assert.match(setup.data.secret, /^[A-Z2-7]{32}$/);
    assert.match(setup.data.otpauthUrl, /^otpauth:\/\/totp\/Kota1:boss\?secret=/);
    assert.equal((await s.api.post('/api/admin/totp/enable', { code: '000000' })).status, 400);
    const code = totpCode(setup.data.secret, s.clock.t);
    assert.equal((await s.api.post('/api/admin/totp/enable', { code })).status, 204);
    assert.equal((await s.api.get('/api/admin/me')).data.admin.totpEnabled, true);

    const c2 = s.client();
    const r1 = await c2.login();
    assert.equal(r1.status, 401); assert.equal(r1.data.error, 'totp_required');
    assert.equal(c2.cookie, '');
    const r2 = await c2.login('boss', PASSWORD, '123456');
    assert.equal(r2.status, 401); assert.equal(r2.data.error, 'invalid_credentials');
    const r3 = await c2.login('boss', PASSWORD, totpCode(setup.data.secret, s.clock.t));
    assert.equal(r3.status, 200); assert.equal(r3.data.admin.totpEnabled, true);

    // disable needs password and code
    assert.equal((await s.api.post('/api/admin/totp/disable', { password: 'nope nope nope', code: totpCode(setup.data.secret, s.clock.t) })).status, 400);
    assert.equal((await s.api.post('/api/admin/totp/disable', { password: PASSWORD, code: '111111' })).status, 400);
    assert.equal((await s.api.post('/api/admin/totp/disable', { password: PASSWORD, code: totpCode(setup.data.secret, s.clock.t) })).status, 204);
    assert.equal((await s.client().login()).status, 200);
  } finally { await s.close(); }
});

test('TOTP matches RFC 6238 SHA-1 vector and accepts +-1 step only', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totpCode(secret, 59000), '287082'); // RFC 6238 (last 6 digits of 94287082)
  assert.ok(verifyTotp(secret, '287082', 59000 + 30000));
  assert.ok(!verifyTotp(secret, '287082', 59000 + 90000));
  assert.ok(!verifyTotp(secret, 'abcdef', 59000));
});

test('password change: validation, wrong current, other sessions revoked, new password works', async () => {
  const s = await loggedIn();
  try {
    const other = s.client(); assert.equal((await other.login()).status, 200);
    assert.equal((await s.api.post('/api/admin/password', { currentPassword: PASSWORD, newPassword: 'short' })).status, 400);
    const wrong = await s.api.post('/api/admin/password', { currentPassword: 'wrong wrong wrong', newPassword: 'a brand new password' });
    assert.equal(wrong.status, 400); assert.ok(wrong.data.fields.currentPassword);
    assert.equal((await s.api.post('/api/admin/password', { currentPassword: PASSWORD, newPassword: 'a brand new password' })).status, 204);
    assert.equal((await other.get('/api/admin/me')).status, 401);
    assert.equal((await s.api.get('/api/admin/me')).status, 200);
    assert.equal((await s.client().login('boss', PASSWORD)).status, 401);
    assert.equal((await s.client().login('boss', 'a brand new password')).status, 200);
  } finally { await s.close(); }
});

test('no registration route; unknown api routes are JSON 404 without stack traces', async () => {
  const s = await startApp();
  try {
    const c = s.client();
    for (const u of ['/api/admin/register', '/api/register', '/api/nothing']) {
      const r = await c.req('POST', u, { json: {} });
      assert.ok([401, 404].includes(r.status));
      assert.ok(r.data && r.data.error);
    }
    const bad = await c.req('POST', '/api/admin/login', { raw: '{not json', headers: { 'Content-Type': 'application/json' } });
    assert.equal(bad.status, 400); assert.equal(bad.data.error, 'invalid_json');
  } finally { await s.close(); }
});

test('settings: validation and round trip, public site mirrors it', async () => {
  const s = await loggedIn();
  try {
    assert.deepEqual((await s.api.get('/api/admin/settings')).data, { reservationPhone: '', address: '', openingHours: '', addressEn: '', openingHoursEn: '', currencySymbol: '€' });
    const bad = await s.api.put('/api/admin/settings', { reservationPhone: 'call me <b>', address: 'x'.repeat(201), currencySymbol: '123456' });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.data.fields).sort(), ['address', 'currencySymbol', 'reservationPhone']);
    const ok = await s.api.put('/api/admin/settings', { reservationPhone: '+359 88 123-4567', address: 'ул. Тест 1', openingHours: 'Пон-Нед 10-22', currencySymbol: 'лв' });
    assert.equal(ok.status, 200);
    const pub = await s.client().get('/api/public/site');
    const { addressEn, openingHoursEn, ...bgShape } = ok.data; // public site: resolved text + lang, no *En fields
    assert.deepEqual(pub.data, { lang: 'bg', ...bgShape });
    assert.equal(addressEn, '');
    assert.equal(openingHoursEn, '');
    assert.equal(pub.data.reservationPhone, '+359 88 123-4567');
  } finally { await s.close(); }
});

test('headers: security headers, no-store on api, noindex on admin', async () => {
  const s = await startApp();
  try {
    const r = await fetch(s.base + '/api/public/site');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'same-origin');
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    const a = await fetch(s.base + '/api/admin/me');
    assert.equal(a.headers.get('x-robots-tag'), 'noindex');
    const idx = await fetch(s.base + '/');
    assert.equal(idx.status, 200);
    assert.equal(idx.headers.get('cache-control'), 'no-cache');
    assert.equal(idx.headers.get('x-frame-options'), 'SAMEORIGIN');
    const adm = await fetch(s.base + '/admin', { redirect: 'manual' });
    assert.equal(adm.headers.get('x-robots-tag'), 'noindex');
  } finally { await s.close(); }
});

test('only public/ is served statically', async () => {
  const s = await startApp();
  try {
    for (const u of ['/package.json', '/server/src/app.js', '/docs/ARCHITECTURE.md', '/data/kota.db', '/.env', '/../package.json', '/%2e%2e/package.json', '/node_modules/express/package.json']) {
      const r = await fetch(s.base + u);
      assert.equal(r.status, 404, u);
    }
  } finally { await s.close(); }
});

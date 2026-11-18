// T-52 / D-55: editable contact email (setting contact_email, admin contactEmail, public site.email).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loggedIn } from './helpers.js';

const put = (s, body) => s.api.put('/api/admin/settings', body);
const site = async (s, lang = 'bg') => (await s.client().get(`/api/public/site?lang=${lang}`)).data;

test('contactEmail: migration 008 seeds example@gmail.com; admin and public both show it', async () => {
  const s = await loggedIn();
  try {
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE name = '008_contact_email.sql'").get().n, 1);
    assert.equal(s.db.prepare("SELECT value FROM settings WHERE key = 'contact_email'").get().value, 'example@gmail.com');
    assert.equal((await s.api.get('/api/admin/settings')).data.contactEmail, 'example@gmail.com');
    for (const lang of ['bg', 'en']) {
      const p = await site(s, lang);
      assert.equal(p.email, 'example@gmail.com'); assert.equal(p.contactEmail, undefined);
    }
  } finally { await s.close(); }
});

test('contactEmail: set (trimmed), update, clear with empty/whitespace/null; public email mirrors it; clear survives restart', async () => {
  const s = await loggedIn();
  try {
    for (const v of ['info@kota1.bg', '  Info.Name+tag@Mail.Kota-1.co.uk  ', 'a@b.c', 'ünï@пример.бг', 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(55) + '.bg']) {
      const r = await put(s, { contactEmail: v });
      assert.equal(r.status, 200, v); assert.equal(r.data.contactEmail, v.trim());
      assert.equal((await site(s)).email, v.trim());
    }
    for (const empty of ['', '   ', null]) {
      await put(s, { contactEmail: 'x@y.bg' });
      const r = await put(s, { contactEmail: empty });
      assert.equal(r.status, 200, JSON.stringify(empty)); assert.equal(r.data.contactEmail, null);
      assert.equal((await s.api.get('/api/admin/settings')).data.contactEmail, null);
      assert.equal((await site(s)).email, null);
      assert.equal((await site(s, 'en')).email, null);
    }
  } finally { await s.close(); }
});

test('contactEmail: invalid input -> 400 fields.contactEmail, value unchanged, nothing else saved', async () => {
  const s = await loggedIn();
  try {
    await put(s, { contactEmail: 'keep@kota1.bg' });
    const long = 'a'.repeat(250) + '@b.co'; // 255 chars
    assert.equal(long.length, 255);
    const bad = [
      'no-at-sign.bg', 'two@@signs.bg', 'a@b@c.bg', 'a b@c.bg', 'a@b c.bg', 'a@b.bg ok', 'a\tb@c.bg', 'a@b.bg\nBcc: x@y.bg', 'a@b\u0000.bg', 'a​@b.bg',
      'a@nodot', 'a@localhost', 'a@.bg', 'a@bg.', 'a@b..bg', 'a@-b.bg', 'a@b-.bg', '@b.bg', 'a@', '@', '.a@b.bg', 'a.@b.bg', 'a..b@c.bg', 'a@b.bg,c@d.bg',
      long, 'x'.repeat(300),
      '<script>alert(1)</script>', '<script>alert(1)</script>@evil.bg', 'a@<script>.bg', '"><img src=x onerror=alert(1)>@a.bg', 'a@b.bg<script>',
      '<b>x</b>@a.bg', "a'onmouseover='alert(1)@b.bg", 'a"@b.bg', 'javascript:alert(1)@a.bg', 'mailto:a@b.bg', 'a(b)@c.bg', 'a;b@c.bg', 'a@b.bg?subject=x y', '&lt;b&gt;@a.bg',
    ];
    for (const v of bad) {
      const r = await put(s, { contactEmail: v, address: 'не се запазва' });
      assert.equal(r.status, 400, JSON.stringify(v));
      assert.equal(r.data.error, 'validation', JSON.stringify(v));
      assert.ok(r.data.fields.contactEmail, JSON.stringify(v));
      assert.deepEqual(Object.keys(r.data.fields), ['contactEmail']);
    }
    for (const v of [5, true, {}, ['a@b.bg']]) {
      const r = await put(s, { contactEmail: v });
      assert.equal(r.status, 400, JSON.stringify(v)); assert.ok(r.data.fields.contactEmail);
    }
    const st = (await s.api.get('/api/admin/settings')).data;
    assert.equal(st.contactEmail, 'keep@kota1.bg'); assert.notEqual(st.address, 'не се запазва');
    assert.equal((await site(s)).email, 'keep@kota1.bg');
    // max length boundary: 254 accepted
    const edge = 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(58) + '.bg';
    assert.equal(edge.length, 254);
    assert.equal((await put(s, { contactEmail: edge })).status, 200);
  } finally { await s.close(); }
});

test('contactEmail: PUT without the key leaves it unchanged (set and cleared); other fields still save', async () => {
  const s = await loggedIn();
  try {
    let r = await put(s, { openingHours: 'Пон-Нед 10-22' });
    assert.equal(r.status, 200); assert.equal(r.data.contactEmail, 'example@gmail.com');
    await put(s, { contactEmail: 'me@kota1.bg' });
    r = await put(s, { reservationPhone: '+359 88 123-4567' });
    assert.equal(r.data.contactEmail, 'me@kota1.bg'); assert.equal(r.data.reservationPhone, '+359 88 123-4567');
    assert.equal((await site(s)).email, 'me@kota1.bg');
    await put(s, { contactEmail: '' });
    r = await put(s, { openingHoursEn: 'Mon-Sun 10-22' });
    assert.equal(r.data.contactEmail, null); assert.equal((await site(s)).email, null);
    assert.equal(s.db.prepare("SELECT value FROM settings WHERE key = 'contact_email'").get().value, '');
  } finally { await s.close(); }
});

test('contactEmail: PUT /api/admin/settings still needs a session (401) and a CSRF token (403)', async () => {
  const s = await loggedIn();
  try {
    assert.equal((await s.client().put('/api/admin/settings', { contactEmail: 'x@y.bg' })).status, 401);
    assert.equal((await s.api.req('PUT', '/api/admin/settings', { csrf: false, json: { contactEmail: 'x@y.bg' } })).status, 403);
    assert.equal((await s.api.get('/api/admin/settings')).data.contactEmail, 'example@gmail.com');
  } finally { await s.close(); }
});

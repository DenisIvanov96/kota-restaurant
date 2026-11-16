import test from 'node:test';
import assert from 'node:assert/strict';
import { loggedIn, formData, PNG, JPG, PDF } from './helpers.js';

const img = (buf = PNG, name = 'pic.png', type = 'image/png') => ({ field: 'image', buf, name, type });
const create = (s, fields, file) => s.api.req('POST', '/api/admin/events', { form: formData(fields, file) });
const publicIds = async (s) => (await s.client().get('/api/public/events')).data.events.map((e) => e.id);

test('event visibility: disabled, scheduled, active, expired (injected clock, Sofia time)', async () => {
  const s = await loggedIn({ iso: '2026-06-15T10:00:00Z' }); // 13:00 Sofia
  try {
    const mk = async (title, extra) => (await create(s, { title, description: 'd', ...extra })).data;
    const disabled = await mk('off', { enabled: false });
    const noWindow = await mk('always', { enabled: true });
    const future = await mk('future', { enabled: true, startsAt: '2026-06-15T14:00' });
    const expiring = await mk('expiring', { enabled: true, startsAt: '2026-06-15T12:00', expiresAt: '2026-06-15T15:00' });
    const past = await mk('past', { enabled: true, expiresAt: '2026-06-15T12:59' });
    assert.deepEqual([disabled, noWindow, future, expiring, past].map((e) => e.status), ['disabled', 'active', 'scheduled', 'active', 'expired']);
    assert.deepEqual((await publicIds(s)).sort(), [noWindow.id, expiring.id].sort());

    s.clock.t = Date.parse('2026-06-15T11:00:00Z'); // 14:00 Sofia: exactly start
    assert.ok((await publicIds(s)).includes(future.id));
    s.clock.t = Date.parse('2026-06-15T12:00:00Z'); // 15:00 Sofia: exactly expiry -> gone
    assert.ok(!(await publicIds(s)).includes(expiring.id));
    const list = (await s.api.get('/api/admin/events')).data.events;
    assert.equal(list.find((e) => e.id === expiring.id).status, 'expired');

    const dash = (await s.api.get('/api/admin/dashboard')).data;
    assert.equal(dash.events.disabled, 1); assert.equal(dash.events.expired, 2); assert.equal(dash.events.active, 2);
    assert.deepEqual(dash.events.activeTitles.sort(), ['always', 'future']);

    // toggle
    const off = await s.api.patch(`/api/admin/events/${noWindow.id}/enabled`, { enabled: false });
    assert.equal(off.data.status, 'disabled');
    assert.ok(!(await publicIds(s)).includes(noWindow.id));
    assert.equal((await s.api.patch(`/api/admin/events/${noWindow.id}/enabled`, { enabled: 'maybe' })).status, 400);
  } finally { await s.close(); }
});

test('event validation and ordering', async () => {
  const s = await loggedIn();
  try {
    const r = await create(s, { title: '', description: 'x'.repeat(2001), startsAt: 'nonsense', enabled: 'yes' });
    assert.equal(r.status, 400);
    assert.deepEqual(Object.keys(r.data.fields).sort(), ['description', 'enabled', 'startsAt', 'title']);
    const r2 = await create(s, { title: 't', enabled: true, startsAt: '2026-06-16T10:00', expiresAt: '2026-06-16T10:00' });
    assert.equal(r2.status, 400); assert.ok(r2.data.fields.expiresAt);
    assert.equal((await s.api.put('/api/admin/events/999', { title: 'x' })).status, 404);

    await create(s, { title: 'B', enabled: true, eventAt: '2026-07-02T20:00' });
    await create(s, { title: 'A', enabled: true, eventAt: '2026-07-01T20:00' });
    await create(s, { title: 'none', enabled: true });
    const titles = (await s.client().get('/api/public/events')).data.events.map((e) => e.title);
    assert.deepEqual(titles, ['A', 'B', 'none']);
    assert.equal((await s.client().get('/api/public/events')).data.events[0].eventAt, '2026-07-01T20:00');
  } finally { await s.close(); }
});

test('event image: stored safely, /media only while event is public, replaced/removed/deleted files vanish', async () => {
  const s = await loggedIn();
  try {
    const c = await create(s, { title: 'img', enabled: false }, img());
    assert.equal(c.status, 201);
    const url = c.data.imageUrl;
    assert.match(url, /^\/api\/admin\/media\/[a-f0-9]{32}\.png$/);
    const name = url.split('/').pop();
    assert.deepEqual(s.uploads(), [name]);
    const mediaUrl = '/media/' + name;

    assert.equal((await s.client().get(mediaUrl)).status, 404); // disabled
    const adminGet = await fetch(s.base + url, { headers: { Cookie: s.api.cookie } });
    assert.equal(adminGet.status, 200);
    assert.equal(adminGet.headers.get('content-type'), 'image/png');
    assert.equal(adminGet.headers.get('x-content-type-options'), 'nosniff');
    assert.match(adminGet.headers.get('content-disposition'), /^inline; filename="pic.png"/);
    assert.equal((await fetch(s.base + url)).status, 401);

    await s.api.patch(`/api/admin/events/${c.data.id}/enabled`, { enabled: true });
    const pub = await fetch(s.base + mediaUrl);
    assert.equal(pub.status, 200);
    assert.deepEqual(Buffer.from(await pub.arrayBuffer()), PNG);
    assert.equal(pub.headers.get('cache-control'), 'no-cache');
    assert.equal((await s.client().get('/api/public/events')).data.events[0].imageUrl, mediaUrl);

    // expiry hides media too
    const ex = await s.api.req('PUT', `/api/admin/events/${c.data.id}`, { form: formData({ expiresAt: '2026-06-15T13:30' }) });
    assert.equal(ex.status, 200);
    s.clock.t += 3600 * 1000;
    assert.equal((await fetch(s.base + mediaUrl)).status, 404);
    s.clock.t -= 3600 * 1000;

    // replace image: old file removed
    const rep = await s.api.req('PUT', `/api/admin/events/${c.data.id}`, { form: formData({ title: 'img2' }, img(JPG, 'x.jpeg', 'image/jpeg')) });
    assert.equal(rep.status, 200); assert.equal(rep.data.title, 'img2');
    assert.match(rep.data.imageUrl, /\.jpg$/);
    assert.equal(s.uploads().length, 1);
    assert.ok(!s.uploads().includes(name));
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 1);

    // remove image
    const rm = await s.api.req('PUT', `/api/admin/events/${c.data.id}`, { form: formData({ removeImage: 'true' }) });
    assert.equal(rm.data.imageUrl, null);
    assert.equal(s.uploads().length, 0);

    // delete event deletes image
    const c2 = await create(s, { title: 'img3', enabled: true }, img());
    assert.equal(s.uploads().length, 1);
    assert.equal((await s.api.del(`/api/admin/events/${c2.data.id}`)).status, 204);
    assert.equal(s.uploads().length, 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 0);
  } finally { await s.close(); }
});

test('upload rejection: fake PDF, SVG, HTML, extension/type mismatch, PDF as event image, oversize; no orphans', async () => {
  const s = await loggedIn();
  try {
    const fakePdf = await s.api.req('POST', '/api/admin/daily-menus', { form: formData({ date: '2026-06-15', published: true }, { field: 'file', buf: Buffer.from('<html>not a pdf</html>'), name: 'menu.pdf', type: 'application/pdf' }) });
    assert.equal(fakePdf.status, 415);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const r1 = await create(s, { title: 'svg', enabled: true }, img(svg, 'x.svg', 'image/svg+xml'));
    assert.equal(r1.status, 415);
    const r1b = await create(s, { title: 'svg', enabled: true }, img(svg, 'x.png', 'image/png'));
    assert.equal(r1b.status, 415);
    assert.equal((await create(s, { title: 'pdf', enabled: true }, img(PDF, 'x.pdf', 'application/pdf'))).status, 415);
    assert.equal((await create(s, { title: 'm', enabled: true }, img(PNG, 'x.jpg', 'image/png'))).status, 415); // ext mismatch
    assert.equal((await create(s, { title: 'm', enabled: true }, img(PNG, 'x.png', 'image/jpeg'))).status, 415); // mime mismatch
    // oversize (5 MB limit for event images)
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10, 7)]);
    const r2 = await create(s, { title: 'big', enabled: true }, img(big));
    assert.equal(r2.status, 413);
    assert.equal(r2.data.error, 'file_too_large');
    // daily menu limit 10 MB
    const big2 = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024 + 10, 7)]);
    assert.equal((await s.api.req('POST', '/api/admin/daily-menus', { form: formData({ date: '2026-06-15' }, { field: 'file', buf: big2, name: 'm.pdf', type: 'application/pdf' }) })).status, 413);
    assert.equal(s.uploads().length, 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM events').get().n, 0);
    // validation failure with a valid file leaves nothing behind
    assert.equal((await create(s, { title: '', enabled: true }, img())).status, 400);
    assert.equal(s.uploads().length, 0);
  } finally { await s.close(); }
});

test('media routes: traversal and bad names are 404; unknown valid names 404', async () => {
  const s = await loggedIn();
  try {
    await create(s, { title: 'x', enabled: true }, img());
    const attempts = ['../package.json', '..%2fpackage.json', '%2e%2e%2fpackage.json', '..%5cpackage.json', 'a.png', 'A'.repeat(32) + '.png',
      'a'.repeat(32) + '.svg', 'a'.repeat(32) + '.png', 'a'.repeat(32) + '.png%00', '..%2f..%2fdata%2fkota.db', 'kota.db'];
    for (const a of attempts) {
      const r1 = await fetch(`${s.base}/media/${a}`);
      assert.equal(r1.status, 404, 'public ' + a);
      const r2 = await fetch(`${s.base}/api/admin/media/${a}`, { headers: { Cookie: s.api.cookie } });
      assert.equal(r2.status, 404, 'admin ' + a);
    }
    const r = await fetch(`${s.base}/media/..%2f..%2fpackage.json`);
    assert.doesNotMatch(await r.text(), /express/);
  } finally { await s.close(); }
});

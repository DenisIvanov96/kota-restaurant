import test from 'node:test';
import assert from 'node:assert/strict';
import { loggedIn, formData, PDF, PNG } from './helpers.js';

const file = (buf = PDF, name = 'menu.pdf', type = 'application/pdf') => ({ field: 'file', buf, name, type });
const add = (s, fields, f = file()) => s.api.req('POST', '/api/admin/daily-menus', { form: formData(fields, f) });
const pubMenu = async (s) => (await s.client().get('/api/public/daily-menu')).data;

test('daily menu is public only on its own Sofia date and only when published', async () => {
  const s = await loggedIn({ iso: '2026-06-15T10:00:00Z' });
  try {
    const y = (await add(s, { date: '2026-06-14', published: true })).data;
    const t = (await add(s, { date: '2026-06-15', published: true })).data;
    const tm = (await add(s, { date: '2026-06-16', published: true })).data;
    assert.equal((await add(s, { date: '2026-06-15', published: true })).status, 409);
    let p = await pubMenu(s);
    assert.equal(p.today, '2026-06-15');
    assert.equal(p.menu.date, '2026-06-15');
    assert.equal(p.menu.kind, 'pdf'); assert.equal(p.menu.mimeType, 'application/pdf');
    assert.match(p.menu.fileUrl, /^\/media\/[a-f0-9]{32}\.pdf$/);
    // media visibility follows the same rule
    const mediaOf = (m) => m.fileUrl.replace('/api/admin', '');
    assert.equal((await fetch(s.base + p.menu.fileUrl)).status, 200);
    const yMedia = y.fileUrl.replace('/api/admin/media', '/media');
    const tmMedia = tm.fileUrl.replace('/api/admin/media', '/media');
    assert.equal((await fetch(s.base + yMedia)).status, 404);
    assert.equal((await fetch(s.base + tmMedia)).status, 404);
    void mediaOf;

    // unpublish today -> none
    await s.api.patch(`/api/admin/daily-menus/${t.id}/published`, { published: false });
    assert.equal((await pubMenu(s)).menu, null);
    await s.api.patch(`/api/admin/daily-menus/${t.id}/published`, { published: true });

    // just before Sofia midnight (21:00Z) still the 15th, at midnight the 16th
    s.clock.t = Date.parse('2026-06-15T20:59:59Z');
    assert.equal((await pubMenu(s)).menu.date, '2026-06-15');
    s.clock.t = Date.parse('2026-06-15T21:00:00Z');
    p = await pubMenu(s);
    assert.equal(p.today, '2026-06-16'); assert.equal(p.menu.date, '2026-06-16');
    assert.equal((await fetch(s.base + p.menu.fileUrl)).status, 200);
    assert.equal((await fetch(s.base + t.fileUrl.replace('/api/admin/media', '/media'))).status, 404);

    const dash = (await s.api.get('/api/admin/dashboard')).data;
    assert.equal(dash.today, '2026-06-16');
    assert.equal(dash.dailyMenu.today.id, tm.id);
    assert.equal(dash.dailyMenu.tomorrow, null);
  } finally { await s.close(); }
});

test('daily menu around DST change (spring forward 2026-03-29, autumn 2026-10-25)', async () => {
  const s = await loggedIn({ iso: '2026-03-28T12:00:00Z' });
  try {
    for (const d of ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-25', '2026-10-26']) await add(s, { date: d, published: true });
    const at = async (iso) => { s.clock.t = Date.parse(iso); return (await pubMenu(s)); };
    assert.equal((await at('2026-03-28T21:59:59Z')).menu.date, '2026-03-28'); // 23:59:59 EET
    assert.equal((await at('2026-03-28T22:00:00Z')).menu.date, '2026-03-29'); // midnight EET
    assert.equal((await at('2026-03-29T20:59:59Z')).menu.date, '2026-03-29'); // 23:59:59 EEST (day is 23 h)
    assert.equal((await at('2026-03-29T21:00:00Z')).menu.date, '2026-03-30');
    assert.equal((await at('2026-10-24T20:59:59Z')).today, '2026-10-24');
    assert.equal((await at('2026-10-24T21:00:00Z')).menu.date, '2026-10-25');
    assert.equal((await at('2026-10-25T21:59:59Z')).menu.date, '2026-10-25'); // day is 25 h
    assert.equal((await at('2026-10-25T22:00:00Z')).menu.date, '2026-10-26');
  } finally { await s.close(); }
});

test('replace flow: 409 date_exists then replace=true replaces and removes old file', async () => {
  const s = await loggedIn();
  try {
    const a = await add(s, { date: '2026-06-15', published: false });
    assert.equal(a.status, 201);
    const oldName = a.data.fileUrl.split('/').pop();
    assert.equal((await pubMenu(s)).menu, null); // draft never public
    const dup = await add(s, { date: '2026-06-15', published: true }, file(PNG, 'n.png', 'image/png'));
    assert.equal(dup.status, 409);
    assert.equal(dup.data.error, 'date_exists'); assert.equal(dup.data.existingId, a.data.id);
    assert.deepEqual(s.uploads(), [oldName]); // rejected upload left nothing

    const rep = await add(s, { date: '2026-06-15', published: true, replace: 'true' }, file(PNG, 'n.png', 'image/png'));
    assert.equal(rep.status, 200);
    assert.equal(rep.data.id, a.data.id); assert.equal(rep.data.kind, 'image'); assert.equal(rep.data.published, true);
    assert.equal(s.uploads().length, 1); assert.ok(!s.uploads().includes(oldName));
    assert.equal((await s.api.get('/api/admin/daily-menus')).data.menus.length, 1);
    assert.equal((await pubMenu(s)).menu.kind, 'image');
  } finally { await s.close(); }
});

test('daily menu update/move/delete and validation', async () => {
  const s = await loggedIn();
  try {
    const a = (await add(s, { date: '2026-06-15', published: true })).data;
    const b = (await add(s, { date: '2026-06-16', published: false })).data;
    assert.equal((await add(s, { date: '2026-02-31' })).status, 400);
    assert.equal((await s.api.req('POST', '/api/admin/daily-menus', { form: formData({ date: '2026-06-17' }) })).status, 400); // no file
    const mv = await s.api.req('PUT', `/api/admin/daily-menus/${b.id}`, { form: formData({ date: '2026-06-15' }) });
    assert.equal(mv.status, 409); assert.equal(mv.data.existingId, a.id);
    const ok = await s.api.req('PUT', `/api/admin/daily-menus/${b.id}`, { form: formData({ date: '2026-06-18', published: true }, file(PNG, 'a.png', 'image/png')) });
    assert.equal(ok.status, 200); assert.equal(ok.data.date, '2026-06-18'); assert.equal(s.uploads().length, 2);
    const list = (await s.api.get('/api/admin/daily-menus')).data;
    assert.deepEqual(list.menus.map((m) => m.date), ['2026-06-18', '2026-06-15']);
    assert.equal(list.today, '2026-06-15');
    assert.equal((await s.api.del(`/api/admin/daily-menus/${a.id}`)).status, 204);
    assert.equal(s.uploads().length, 1);
    assert.equal((await s.api.del(`/api/admin/daily-menus/${a.id}`)).status, 404);
    assert.equal((await s.api.get('/api/admin/daily-menus/abc')).status, 404);
  } finally { await s.close(); }
});

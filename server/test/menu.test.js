import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loggedIn, startApp, formData, PDF, JPG, PASSWORD } from './helpers.js';

const file = (buf = PDF, name = 'menu.pdf', type = 'application/pdf') => ({ field: 'file', buf, name, type });
const pubMenu = async (s) => (await s.client().get('/api/public/menu')).data;
const draft = {
  categories: [
    { name: 'Салати', items: [{ name: 'Шопска', description: 'домати', priceCents: 650, available: true }, { name: 'Таратор', description: '', priceCents: 500, available: false }] },
    { name: 'Основни', items: [] },
  ],
};

test('structured menu: draft never public until publish; discard; unpublished flag', async () => {
  const s = await loggedIn();
  try {
    let pm = await pubMenu(s);
    assert.equal(pm.mode, 'structured'); assert.equal(pm.structured, null); assert.equal(pm.file, null); assert.equal(pm.currencySymbol, '€');

    const saved = await s.api.put('/api/admin/menu/draft', draft);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.categories[0].items[1].available, false);
    assert.equal((await pubMenu(s)).structured, null); // draft hidden
    let adm = (await s.api.get('/api/admin/menu')).data;
    assert.equal(adm.hasUnpublishedChanges, true); assert.equal(adm.published, null);

    assert.equal((await s.api.post('/api/admin/menu/publish')).status, 200);
    pm = await pubMenu(s);
    assert.deepEqual(pm.structured.categories.map((c) => c.name), ['Салати', 'Основни']);
    assert.equal(pm.structured.categories[0].items[0].priceCents, 650);
    assert.equal((await s.api.get('/api/admin/menu')).data.hasUnpublishedChanges, false);

    // edit: rename, reorder, delete one item, add a new one
    const d = saved.data;
    const edit = { categories: [
      { id: d.categories[1].id, name: 'Основни ястия', items: [{ name: 'Кебап', description: '', priceCents: 900, available: true }] },
      { id: d.categories[0].id, name: 'Салати', items: [{ id: d.categories[0].items[0].id, name: 'Шопска салата', description: 'домати', priceCents: 700, available: true }] },
    ] };
    const e = await s.api.put('/api/admin/menu/draft', edit);
    assert.deepEqual(e.data.categories.map((c) => c.name), ['Основни ястия', 'Салати']);
    assert.equal(e.data.categories[1].items.length, 1); // Таратор deleted
    assert.equal(e.data.categories[1].items[0].id, d.categories[0].items[0].id);
    assert.equal((await pubMenu(s)).structured.categories[0].name, 'Салати'); // public unchanged
    assert.equal((await s.api.get('/api/admin/menu')).data.hasUnpublishedChanges, true);

    const disc = await s.api.post('/api/admin/menu/draft/discard');
    assert.deepEqual(disc.data.categories.map((c) => c.name), ['Салати', 'Основни']);
    assert.equal((await s.api.get('/api/admin/menu')).data.hasUnpublishedChanges, false);

    await s.api.put('/api/admin/menu/draft', edit.categories ? { categories: [{ name: 'Нова', items: [] }] } : edit);
    await s.api.post('/api/admin/menu/publish');
    assert.deepEqual((await pubMenu(s)).structured.categories.map((c) => c.name), ['Нова']);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM menu_versions').get().n, 2); // history kept
  } finally { await s.close(); }
});

test('draft validation', async () => {
  const s = await loggedIn();
  try {
    const bad = async (body) => (await s.api.put('/api/admin/menu/draft', body)).status;
    assert.equal(await bad({}), 400);
    assert.equal(await bad({ categories: [{ name: '', items: [] }] }), 400);
    assert.equal(await bad({ categories: [{ name: 'a', items: [{ name: 'x', description: '', priceCents: 1.5, available: true }] }] }), 400);
    assert.equal(await bad({ categories: [{ name: 'a', items: [{ name: 'x', description: '', priceCents: -1, available: true }] }] }), 400);
    assert.equal(await bad({ categories: [{ name: 'a', items: [{ name: 'x', description: '', priceCents: 10000001, available: true }] }] }), 400);
    assert.equal(await bad({ categories: [{ name: 'a', items: [{ name: 'x', description: 'd'.repeat(501), priceCents: 1, available: true }] }] }), 400);
    assert.equal(await bad({ categories: [{ id: 999, name: 'a', items: [] }] }), 400);
    assert.equal(await bad({ categories: Array.from({ length: 51 }, () => ({ name: 'a', items: [] })) }), 400);
    const r = await s.api.put('/api/admin/menu/draft', { categories: [{ name: '', items: [{ name: 'x', priceCents: 'abc', available: true }] }] });
    assert.ok(r.data.fields['categories[0].name'] && r.data.fields['categories[0].items[0].priceCents']);
    assert.equal(await bad({ categories: [{ name: 'a', items: [{ name: 'x', description: '', priceCents: 10000000, available: true }] }] }), 200);
  } finally { await s.close(); }
});

test('file mode: upload, publish one, mode switch rules, in_use delete, public file', async () => {
  const s = await loggedIn();
  try {
    // nothing published in either mode
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'file' })).status, 409);
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'file' })).data.error, 'nothing_published');
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'structured' })).status, 409);
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'bogus' })).status, 400);

    const f1 = await s.api.req('POST', '/api/admin/menu/files', { form: formData({}, file()) });
    const f2 = await s.api.req('POST', '/api/admin/menu/files', { form: formData({}, file(JPG, 'm.jpg', 'image/jpeg')) });
    assert.equal(f1.status, 201); assert.equal(f1.data.published, false);
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'file' })).status, 409); // uploaded, not published
    assert.equal((await s.api.req('POST', '/api/admin/menu/files', { form: formData({}) })).status, 400);

    await s.api.patch(`/api/admin/menu/files/${f1.data.id}/published`, { published: true });
    await s.api.patch(`/api/admin/menu/files/${f2.data.id}/published`, { published: true }); // unpublishes f1
    const files = (await s.api.get('/api/admin/menu')).data.files;
    assert.deepEqual(files.map((f) => [f.id, f.published]), [[f2.data.id, true], [f1.data.id, false]]);

    // still structured mode: file not public
    assert.equal((await fetch(s.base + f2.data.fileUrl.replace('/api/admin/media', '/media'))).status, 404);
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'file' })).data.mode, 'file');
    const pm = await pubMenu(s);
    assert.equal(pm.mode, 'file'); assert.equal(pm.structured, null); assert.equal(pm.file.kind, 'image');
    assert.equal((await fetch(s.base + pm.file.fileUrl)).status, 200);
    assert.equal((await fetch(s.base + f1.data.fileUrl.replace('/api/admin/media', '/media'))).status, 404);

    // in_use
    const del = await s.api.del(`/api/admin/menu/files/${f2.data.id}`);
    assert.equal(del.status, 409); assert.equal(del.data.error, 'in_use');
    assert.equal((await s.api.patch(`/api/admin/menu/files/${f2.data.id}/published`, { published: false })).status, 409);
    assert.equal((await s.api.del(`/api/admin/menu/files/${f1.data.id}`)).status, 204);
    assert.equal(s.uploads().length, 1);

    // switch back needs a snapshot
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'structured' })).status, 409);
    await s.api.put('/api/admin/menu/draft', draft);
    await s.api.post('/api/admin/menu/publish');
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'structured' })).status, 200);
    assert.equal((await pubMenu(s)).file, null);
    assert.equal((await s.api.del(`/api/admin/menu/files/${f2.data.id}`)).status, 204);
    assert.equal(s.uploads().length, 0);
    assert.equal((await s.api.get('/api/admin/dashboard')).data.menu.mode, 'structured');
  } finally { await s.close(); }
});

test('persistence: data survives closing and reopening the database; migrations are idempotent', async () => {
  const s = await loggedIn();
  const dataDir = s.dataDir;
  await s.api.put('/api/admin/menu/draft', draft);
  await s.api.post('/api/admin/menu/publish');
  await s.api.put('/api/admin/settings', { address: 'Улица 1' });
  const ev = await s.api.req('POST', '/api/admin/events', { form: formData({ title: 'keep', enabled: true }, { field: 'image', buf: JPG, name: 'a.jpg', type: 'image/jpeg' }) });
  const migs = s.db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n;
  await s.close(false);
  const s2 = await startApp({ dataDir });
  try {
    const c = s2.client();
    assert.equal((await c.get('/api/public/site')).data.address, 'Улица 1');
    assert.equal((await c.get('/api/public/menu')).data.structured.categories.length, 2);
    const evs = (await c.get('/api/public/events')).data.events;
    assert.equal(evs[0].title, 'keep');
    assert.equal((await fetch(s2.base + evs[0].imageUrl)).status, 200);
    assert.equal((await c.login('boss', PASSWORD)).status, 200); // admin persisted
    assert.equal(s2.db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, migs);
    assert.equal(ev.status, 201);
  } finally { await s2.close(); }
  assert.ok(!fs.existsSync(path.join(dataDir, 'uploads')));
});

test('CRLF normalised for dish description and settings (BUG-4)', async () => {
  const s = await loggedIn();
  try {
    const d500 = Array(12).fill('x'.repeat(44)).join('\n').slice(0, 500);
    assert.equal(d500.length, 500);
    const put = (desc) => s.api.put('/api/admin/menu/draft', { categories: [{ name: 'C\r\nD', items: [{ name: 'i', description: desc, priceCents: 1 }] }] });
    const ok = await put(d500.replace(/\n/g, '\r\n'));
    assert.equal(ok.status, 200);
    const d = ok.data;
    const cat = d.categories[0];
    assert.equal(cat.name, 'C\nD');
    assert.equal(cat.items[0].description, d500);
    assert.equal((await put((d500 + 'y').replace(/\n/g, '\r\n'))).status, 400);

    const h500 = Array(12).fill('y'.repeat(44)).join('\n').slice(0, 500);
    const st = await s.api.put('/api/admin/settings', { openingHours: h500.replace(/\n/g, '\r\n'), address: 'a\rb' });
    assert.equal(st.status, 200);
    assert.equal(st.data.openingHours, h500);
    assert.equal(st.data.address, 'a\nb');
    assert.equal((await s.api.put('/api/admin/settings', { openingHours: (h500 + 'z').replace(/\n/g, '\r\n') })).status, 400);
  } finally { await s.close(); }
});

// Regular menu (structured draft/publish, file mode, mode switch) + persistence across restart. Port 3203.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PDF, WEBP } from '../lib/harness.mjs';

const PORT = 3203;
const T0 = '2026-06-15T10:00:00Z';
const PNG = makePng(30, 20, [30, 30, 200]);

describe('regular menu', () => {
  let dir; let srv; let admin; let anon;
  const uploads = () => fs.readdirSync(path.join(dir, 'uploads')).sort();
  const pub = async () => (await anon.get('/api/public/menu')).data;
  const adm = async () => (await admin.get('/api/admin/menu')).data;
  const item = (name, priceCents, extra = {}) => ({ name, description: '', priceCents, available: true, ...extra });
  const putDraft = (categories) => admin.put('/api/admin/menu/draft', { json: { categories } });
  const names = (cats) => cats.map((c) => `${c.name}:[${c.items.map((i) => `${i.name}=${i.priceCents}${i.available ? '' : '!'}`).join(',')}]`).join(' | ');
  const uploadFile = async (buf, name, type) => (await admin.post('/api/admin/menu/files', { form: form({}, { field: 'file', buf, name, type }) }));

  before(async () => { dir = tmpDir('menu'); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  let draft;
  test('M0 initial state: structured mode, nothing published => public structured null; both mode switches => 409 nothing_published', async () => {
    const p = await pub(); assert.equal(p.mode, 'structured'); assert.equal(p.structured, null); assert.equal(p.file, null);
    const r = await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'nothing_published'); assert.ok(r.data.message);
    assert.equal((await admin.put('/api/admin/menu/mode', { json: { mode: 'bogus' } })).status, 400);
  });
  test('M1 admin creates dishes/categories; DRAFT does NOT appear publicly before publish', async () => {
    const r = await putDraft([{ name: 'Салати', items: [item('Шопска', 650), item('Таратор', 500)] }, { name: 'Основни', items: [item('Кебапче', 250, { description: 'на скара' })] }]);
    assert.equal(r.status, 200); draft = r.data;
    assert.equal(draft.categories.length, 2); assert.ok(draft.categories[0].id && draft.categories[0].items[0].id);
    assert.equal((await pub()).structured, null, 'draft invisible');
    const a = await adm(); assert.equal(a.published, null); assert.equal(a.hasUnpublishedChanges, true);
    assert.equal((await admin.get('/api/admin/dashboard')).data.menu.hasUnpublishedChanges, true);
  });
  test('M2 publish => public shows exact draft snapshot; only the active mode filled', async () => {
    const r = await admin.post('/api/admin/menu/publish'); assert.equal(r.status, 200); assert.match(r.data.publishedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
    const p = await pub();
    assert.equal(p.mode, 'structured'); assert.equal(p.file, null); assert.equal(p.currencySymbol, '€');
    assert.equal(names(p.structured.categories), 'Салати:[Шопска=650,Таратор=500] | Основни:[Кебапче=250]');
    assert.equal(p.structured.categories[1].items[0].description, 'на скара');
    assert.equal((await adm()).hasUnpublishedChanges, false);
  });
  test('M3 edit names, update prices, add + remove dishes/categories in draft: public unchanged until publish, then updated', async () => {
    const d = (await adm()).draft;
    const [sal, main] = d.categories;
    const r = await putDraft([
      { id: sal.id, name: 'Салати (нови)', items: [{ ...sal.items[0], name: 'Шопска салата', priceCents: 700 }, item('Зелена', 450)] }, // rename+price, remove Таратор, add Зелена
      { id: main.id, name: 'Основни', items: [{ ...main.items[0], available: false }] },
      { name: 'Десерти', items: [item('Баклава', 400)] },
    ]);
    assert.equal(r.status, 200, r.text());
    const expectedPublic = 'Салати:[Шопска=650,Таратор=500] | Основни:[Кебапче=250]';
    assert.equal(names((await pub()).structured.categories), expectedPublic, 'public unchanged by draft edits');
    assert.equal((await adm()).hasUnpublishedChanges, true);
    assert.equal((await admin.post('/api/admin/menu/publish')).status, 200);
    assert.equal(names((await pub()).structured.categories), 'Салати (нови):[Шопска салата=700,Зелена=450] | Основни:[Кебапче=250!] | Десерти:[Баклава=400]');
    assert.equal((await adm()).hasUnpublishedChanges, false);
  });
  test('M4 reorder (array order = display order) and category removal', async () => {
    const d = (await adm()).draft;
    const [a, b, c] = d.categories;
    await putDraft([c, a, { ...b, items: [] }].map((x) => ({ id: x.id, name: x.name, items: x.items })));
    await putDraft([c, a].map((x) => ({ id: x.id, name: x.name, items: x.items })));
    assert.equal((await adm()).draft.categories.map((x) => x.name).join(), 'Десерти,Салати (нови)');
    await admin.post('/api/admin/menu/publish');
    assert.equal((await pub()).structured.categories.map((x) => x.name).join(), 'Десерти,Салати (нови)');
  });
  test('M5 discard restores draft to the published snapshot; public unaffected', async () => {
    const d = (await adm()).draft;
    await putDraft([{ name: 'Junk', items: [item('x', 1)] }]);
    assert.equal((await adm()).hasUnpublishedChanges, true);
    const before = names((await pub()).structured.categories);
    const r = await admin.post('/api/admin/menu/draft/discard');
    assert.equal(r.status, 200);
    assert.equal(names(r.data.categories), before.replace(/!/g, '!'));
    assert.equal((await adm()).hasUnpublishedChanges, false);
    assert.equal(names((await pub()).structured.categories), before);
    // draft can be saved again after discard with fresh ids
    assert.equal((await putDraft(r.data.categories)).status, 200);
    void d;
  });
  test('M6 currency symbol setting reaches public menu', async () => {
    await admin.put('/api/admin/settings', { json: { currencySymbol: 'лв' } });
    assert.equal((await pub()).currencySymbol, 'лв');
    await admin.put('/api/admin/settings', { json: { currencySymbol: '€' } });
  });

  let f1; let f2;
  test('M7 uploading a menu file (pdf/image) does not change what is public; /media of unpublished file is 404', async () => {
    const before = JSON.stringify(await pub());
    const r = await uploadFile(PNG, 'menu1.png', 'image/png'); assert.equal(r.status, 201); f1 = r.data;
    assert.equal(r.data.published, false); assert.equal(r.data.kind, 'image');
    assert.equal(JSON.stringify(await pub()), before);
    assert.equal((await anon.get(f1.fileUrl.replace('/api/admin/media/', '/media/'))).status, 404);
    assert.equal((await admin.get(f1.fileUrl)).status, 200);
    const r2 = await uploadFile(PDF, 'menu2.pdf', 'application/pdf'); assert.equal(r2.status, 201); f2 = r2.data; assert.equal(f2.kind, 'pdf');
  });
  test('M8 publishing a file while mode=structured keeps structured public and the file private; only ONE published file at a time', async () => {
    assert.equal((await admin.patch(`/api/admin/menu/files/${f1.id}/published`, { json: { published: true } })).status, 200);
    const p = await pub(); assert.equal(p.mode, 'structured'); assert.equal(p.file, null); assert.ok(p.structured);
    assert.equal((await anon.get(f1.fileUrl.replace('/api/admin/media/', '/media/'))).status, 404, 'file not public in structured mode');
    assert.equal((await admin.patch(`/api/admin/menu/files/${f2.id}/published`, { json: { published: true } })).status, 200);
    const files = (await adm()).files; assert.equal(files.filter((f) => f.published).length, 1); assert.equal(files.find((f) => f.id === f2.id).published, true);
    // unpublish allowed when not live
    assert.equal((await admin.patch(`/api/admin/menu/files/${f2.id}/published`, { json: { published: false } })).status, 200);
    assert.equal((await admin.patch(`/api/admin/menu/files/${f1.id}/published`, { json: { published: true } })).status, 200);
  });
  test('M9 mode switch structured -> file: public becomes the file ONLY (structured null); file /media works', async () => {
    const r = await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } }); assert.equal(r.status, 200); assert.equal(r.data.mode, 'file');
    const p = await pub(); assert.equal(p.mode, 'file'); assert.equal(p.structured, null); assert.ok(p.file);
    assert.equal(p.file.kind, 'image'); assert.equal(p.file.mimeType, 'image/png');
    const m = await anon.get(p.file.fileUrl); assert.equal(m.status, 200); assert.ok(m.buf.equals(PNG));
    assert.equal((await adm()).mode, 'file');
  });
  test('M10 delete / unpublish of the LIVE file is blocked (409 in_use); nothing changes', async () => {
    const d = await admin.del(`/api/admin/menu/files/${f1.id}`); assert.equal(d.status, 409); assert.equal(d.data.error, 'in_use');
    const u = await admin.patch(`/api/admin/menu/files/${f1.id}/published`, { json: { published: false } }); assert.equal(u.status, 409); assert.equal(u.data.error, 'in_use');
    assert.ok((await pub()).file);
    assert.equal((await anon.get((await pub()).file.fileUrl)).status, 200);
  });
  test('M11 replacing the file: publish another file => public switches, old /media URL dead; draft edits do not leak in file mode', async () => {
    const old = (await pub()).file.fileUrl;
    const f3 = (await uploadFile(WEBP, 'menu3.webp', 'image/webp')).data;
    assert.equal((await pub()).file.fileUrl, old, 'upload alone changes nothing');
    assert.equal((await admin.patch(`/api/admin/menu/files/${f3.id}/published`, { json: { published: true } })).status, 200);
    const p = await pub(); assert.notEqual(p.file.fileUrl, old); assert.equal(p.file.mimeType, 'image/webp');
    assert.equal((await anon.get(old)).status, 404, 'previous live file no longer public');
    assert.equal((await anon.get(p.file.fileUrl)).status, 200);
    // structured edits + publish while in file mode do not change public
    await putDraft([{ name: 'Hidden', items: [item('Nope', 1)] }]); await admin.post('/api/admin/menu/publish');
    const p2 = await pub(); assert.equal(p2.structured, null); assert.equal(p2.mode, 'file');
    // old file can now be deleted (no longer live) and its disk file goes away
    const n = uploads().length;
    assert.equal((await admin.del(`/api/admin/menu/files/${f1.id}`)).status, 204);
    assert.equal(uploads().length, n - 1);
  });
  test('M12 mode switch file -> structured shows latest published snapshot; the file stops being public', async () => {
    const live = (await pub()).file.fileUrl;
    assert.equal((await admin.put('/api/admin/menu/mode', { json: { mode: 'structured' } })).status, 200);
    const p = await pub(); assert.equal(p.mode, 'structured'); assert.equal(p.file, null); assert.equal(p.structured.categories[0].name, 'Hidden');
    assert.equal((await anon.get(live)).status, 404);
    assert.equal((await anon.get('/api/public/menu')).data.structured.categories.length, 1);
  });
  test('M13 file-mode with nothing published: switching blocked; after deleting all files cannot switch', async () => {
    for (const f of (await adm()).files) await admin.del(`/api/admin/menu/files/${f.id}`);
    assert.equal((await adm()).files.length, 0);
    const r = await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } }); assert.equal(r.status, 409); assert.equal(r.data.error, 'nothing_published');
  });

  test('P1 data persists across server restart (same DATA_DIR): menu, files, settings, events, sessions', async () => {
    await admin.put('/api/admin/settings', { json: { reservationPhone: '+359 2 123', address: 'Sofia', openingHours: '10-22' } });
    const ev = await admin.post('/api/admin/events', { form: form({ title: 'Persist me', enabled: 'true' }, { field: 'image', buf: PNG, name: 'e.png', type: 'image/png' }) });
    const dmenu = await admin.post('/api/admin/daily-menus', { form: form({ date: '2026-06-15', published: 'true' }, { field: 'file', buf: PDF, name: 'd.pdf', type: 'application/pdf' }) });
    const beforePub = JSON.stringify(await pub());
    const evUrl = (await anon.get('/api/public/events')).data.events[0].imageUrl;
    const dUrl = (await anon.get('/api/public/daily-menu')).data.menu.fileUrl;
    const cookie = admin.cookie;
    await srv.stop();
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
    anon = new Client(srv.url);
    assert.equal(JSON.stringify((await anon.get('/api/public/menu')).data), beforePub, 'public menu identical');
    assert.equal((await anon.get('/api/public/site')).data.address, 'Sofia');
    assert.equal((await anon.get('/api/public/events')).data.events[0].title, 'Persist me');
    assert.equal((await anon.get(evUrl)).status, 200); assert.equal((await anon.get(dUrl)).status, 200);
    assert.equal((await anon.get('/api/public/daily-menu')).data.menu.kind, 'pdf');
    assert.equal((await anon.get('/api/admin/me', { cookie })).status, 200, 'session survives restart');
    assert.equal(ev.status, 201); assert.equal(dmenu.status, 201);
  });
  test('P2 content updates need no restart: edit event title -> next public request sees it', async () => {
    const c = new Client(srv.url); await c.login();
    const id = (await c.get('/api/admin/events')).data.events[0].id;
    await c.put(`/api/admin/events/${id}`, { form: form({ title: 'Renamed live' }) });
    assert.equal((await anon.get('/api/public/events')).data.events[0].title, 'Renamed live');
  });
  test('P3 migrations idempotent: several restarts keep data, no errors in log', async () => {
    for (let i = 0; i < 3; i++) { await srv.stop(); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); }
    assert.doesNotMatch(srv.log(), /error|Error/);
    assert.equal((await new Client(srv.url).get('/api/public/events')).data.events[0].title, 'Renamed live');
  });
});

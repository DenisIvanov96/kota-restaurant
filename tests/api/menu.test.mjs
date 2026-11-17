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
  const uploadFile = async (buf, name, type, lang) => (await admin.post('/api/admin/menu/pages', { form: form(lang ? { lang } : {}, { field: 'file', buf, name, type }) }));
  const setPub = (lang, published) => admin.put('/api/admin/menu/pages/published', { json: { lang, published } });
  const toMedia = (u) => u.replace('/api/admin/media/', '/media/');

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
  test('M7 uploading a menu page (pdf/image) does not change what is public; /media of an unpublished page is 404; admin can preview', async () => {
    const before = JSON.stringify(await pub());
    const r = await uploadFile(PNG, 'menu1.png', 'image/png'); assert.equal(r.status, 201); f1 = r.data;
    assert.equal(r.data.kind, 'image'); assert.equal(r.data.position, 1); assert.equal(r.data.lang, 'bg');
    assert.equal(JSON.stringify(await pub()), before);
    assert.equal((await anon.get(toMedia(f1.fileUrl))).status, 404);
    assert.equal((await admin.get(f1.fileUrl)).status, 200);
    const r2 = await uploadFile(PDF, 'menu2.pdf', 'application/pdf'); assert.equal(r2.status, 201); f2 = r2.data; assert.equal(f2.kind, 'pdf'); assert.equal(f2.position, 2, 'appended last');
    const pg = (await adm()).pages; assert.equal(pg.bg.published, false); assert.deepEqual(pg.bg.items.map((x) => x.id), [f1.id, f2.id]); assert.deepEqual(pg.en.items, []);
  });
  test('M8 publishing the page set while mode=structured keeps structured public and the pages private; flag is per language', async () => {
    assert.equal((await setPub('bg', true)).status, 200);
    const p = await pub(); assert.equal(p.mode, 'structured'); assert.equal(p.file, null); assert.ok(p.structured);
    assert.equal((await anon.get(toMedia(f1.fileUrl))).status, 404, 'pages not public in structured mode');
    assert.equal((await anon.get(toMedia(f2.fileUrl))).status, 404);
    const pg = (await adm()).pages; assert.equal(pg.bg.published, true); assert.equal(pg.en.published, false);
    // a flag can be switched off while not live
    assert.equal((await setPub('bg', false)).status, 200); assert.equal((await adm()).pages.bg.published, false);
    assert.equal((await setPub('bg', true)).status, 200);
    assert.equal((await setPub('bg', 'maybe')).status, 400); assert.equal((await setPub('fr', true)).status, 400);
  });
  test('M9 mode switch structured -> file: public becomes the ordered pages ONLY (structured null); /media works for every page', async () => {
    const r = await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } }); assert.equal(r.status, 200); assert.equal(r.data.mode, 'file');
    const p = await pub(); assert.equal(p.mode, 'file'); assert.equal(p.structured, null); assert.ok(p.file);
    assert.equal(p.file.lang, 'bg'); assert.equal(p.file.pages.length, 2);
    assert.deepEqual(p.file.pages.map((x) => [x.kind, x.mimeType]), [['image', 'image/png'], ['pdf', 'application/pdf']]);
    const m = await anon.get(p.file.pages[0].fileUrl); assert.equal(m.status, 200); assert.ok(m.buf.equals(PNG));
    assert.equal((await anon.get(p.file.pages[1].fileUrl)).status, 200);
    assert.equal((await adm()).mode, 'file');
  });
  test('M10 delete of the last page / unpublish of the LIVE language are blocked (409 in_use); a non-last page can be deleted; nothing else changes', async () => {
    const u = await setPub('bg', false); assert.equal(u.status, 409); assert.equal(u.data.error, 'in_use');
    assert.ok((await pub()).file);
    // reorder: f2 first
    let r = await admin.put('/api/admin/menu/pages/order', { json: { lang: 'bg', ids: [f2.id, f1.id] } }); assert.equal(r.status, 200); assert.deepEqual(r.data.items.map((x) => x.id), [f2.id, f1.id]); assert.deepEqual(r.data.items.map((x) => x.position), [1, 2]);
    assert.equal((await pub()).file.pages[0].kind, 'pdf', 'public order follows the admin order immediately');
    const d = await admin.del(`/api/admin/menu/pages/${f2.id}`); assert.equal(d.status, 204);
    assert.deepEqual((await adm()).pages.bg.items.map((x) => [x.id, x.position]), [[f1.id, 1]], 'positions renumbered');
    r = await admin.del(`/api/admin/menu/pages/${f1.id}`); assert.equal(r.status, 409); assert.equal(r.data.error, 'in_use');
    assert.equal((await anon.get((await pub()).file.pages[0].fileUrl)).status, 200);
  });
  test('M11 adding / replacing pages while live is immediate; draft edits do not leak in file mode; deleting frees the disk file', async () => {
    const old = (await pub()).file.pages[0].fileUrl;
    const f3 = (await uploadFile(WEBP, 'menu3.webp', 'image/webp')).data;
    const p = await pub(); assert.equal(p.file.pages.length, 2, 'new page of a published set is live immediately'); assert.equal(p.file.pages[0].fileUrl, old); assert.equal(p.file.pages[1].mimeType, 'image/webp');
    assert.equal((await anon.get(p.file.pages[1].fileUrl)).status, 200);
    // structured edits + publish while in file mode do not change public
    await putDraft([{ name: 'Hidden', items: [item('Nope', 1)] }]); await admin.post('/api/admin/menu/publish');
    const p2 = await pub(); assert.equal(p2.structured, null); assert.equal(p2.mode, 'file');
    // delete the old first page (a non-last page): its disk file goes away, public no longer lists it
    const n = uploads().length;
    assert.equal((await admin.del(`/api/admin/menu/pages/${f1.id}`)).status, 204);
    assert.equal(uploads().length, n - 1);
    assert.equal((await anon.get(old)).status, 404, 'deleted page no longer public');
    const p3 = await pub(); assert.equal(p3.file.pages.length, 1); assert.equal(p3.file.pages[0].mimeType, 'image/webp');
    void f3;
  });
  test('M12 mode switch file -> structured shows latest published snapshot; the pages stop being public', async () => {
    const live = (await pub()).file.pages[0].fileUrl;
    assert.equal((await admin.put('/api/admin/menu/mode', { json: { mode: 'structured' } })).status, 200);
    const p = await pub(); assert.equal(p.mode, 'structured'); assert.equal(p.file, null); assert.equal(p.structured.categories[0].name, 'Hidden');
    assert.equal((await anon.get(live)).status, 404);
    assert.equal((await anon.get('/api/public/menu')).data.structured.categories.length, 1);
  });
  test('M13 file-mode with nothing live: switching blocked (flag off, or flag on but no pages); after deleting all pages cannot switch', async () => {
    await setPub('bg', false);
    let r = await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } }); assert.equal(r.status, 409); assert.equal(r.data.error, 'nothing_published');
    await setPub('bg', true); // flag on + page present = live
    for (const x of (await adm()).pages.bg.items) assert.equal((await admin.del(`/api/admin/menu/pages/${x.id}`)).status, 204, 'not in file mode: deletable');
    assert.equal((await adm()).pages.bg.items.length, 0);
    r = await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } }); assert.equal(r.status, 409, 'flag on but zero pages is not live'); assert.equal(r.data.error, 'nothing_published');
    await setPub('bg', false);
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

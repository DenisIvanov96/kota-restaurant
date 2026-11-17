import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loggedIn, startApp, PNG, JPG, PDF, WEBP } from './helpers.js';

// multipart helper with several files: files = [{ field, buf, name, type }]
const form = (fields = {}, files = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.append(k, String(v));
  for (const x of files) f.append(x.field, new Blob([x.buf], { type: x.type }), x.name);
  return f;
};
const png = (field, name = 'a.png') => ({ field, buf: PNG, name, type: 'image/png' });
const jpg = (field, name = 'b.jpg') => ({ field, buf: JPG, name, type: 'image/jpeg' });
const pdf = (field, name = 'm.pdf') => ({ field, buf: PDF, name, type: 'application/pdf' });
const pubGet = (s, p) => s.client().get(`/api/public/${p}`);
const nFiles = (s) => s.db.prepare('SELECT COUNT(*) n FROM files').get().n;
const noOrphans = (s) => {
  const rows = s.db.prepare('SELECT stored_name FROM files').all().map((r) => r.stored_name).sort();
  assert.deepEqual(s.uploads().sort(), rows);
};

// ---------- migration 005 ----------
test('migration 005 on an existing DB: rows survive, new columns default, EN-only daily menu possible', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kota-mig5-'));
  fs.mkdirSync(path.join(dataDir, 'uploads'));
  const mig = (n) => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations', n), 'utf8');
  const old = new DatabaseSync(path.join(dataDir, 'kota.db'));
  old.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const n of ['001_init.sql', '002_i18n.sql', '003_default_address.sql', '004_fix_default_address_en.sql']) {
    old.exec(mig(n)); old.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run(n, 1);
  }
  old.prepare("INSERT INTO files(id, stored_name, original_name, mime_type, size_bytes, created_at) VALUES (1,'" + 'a'.repeat(32) + ".pdf','m.pdf','application/pdf',10,1)").run();
  old.prepare("INSERT INTO files(id, stored_name, original_name, mime_type, size_bytes, created_at) VALUES (2,'" + 'b'.repeat(32) + ".pdf','n.pdf','application/pdf',10,1)").run();
  old.prepare("INSERT INTO daily_menus(menu_date, file_id, published, created_at, updated_at) VALUES ('2026-06-15', 1, 1, 5, 6)").run();
  old.prepare('INSERT INTO menu_files(file_id, published, created_at) VALUES (2, 1, 7)').run();
  old.close();
  const s = await loggedIn({ dataDir });
  try {
    const dm = s.db.prepare('SELECT * FROM daily_menus').all();
    assert.equal(dm.length, 1);
    assert.deepEqual([dm[0].menu_date, dm[0].file_id, dm[0].file_en_id, dm[0].published, dm[0].created_at, dm[0].updated_at], ['2026-06-15', 1, null, 1, 5, 6]);
    assert.equal(s.db.prepare('SELECT lang FROM menu_files').get().lang, 'bg');
    const list = (await s.api.get('/api/admin/daily-menus')).data.menus;
    assert.equal(list[0].fileEnUrl, null); assert.match(list[0].fileUrl, /^\/api\/admin\/media\/a{32}\.pdf$/);
    // EN-only daily menu now possible (file_id nullable)
    const r = await s.api.req('POST', '/api/admin/daily-menus', { form: form({ date: '2026-06-16' }, [pdf('fileEn')]) });
    assert.equal(r.status, 201);
  } finally { await s.close(); }
});

// ---------- events ----------
test('events: title required in at least one language; EN-only and BG-only accepted', async () => {
  const s = await loggedIn();
  try {
    const post = (fields, files) => s.api.req('POST', '/api/admin/events', { form: form(fields, files) });
    const none = await post({ title: '', titleEn: '  ', enabled: true });
    assert.equal(none.status, 400); assert.ok(none.data.fields.title);
    assert.equal((await post({ enabled: true })).status, 400);
    assert.equal((await post({ title: 'x'.repeat(121) })).status, 400);
    assert.equal((await post({ titleEn: 'x'.repeat(121) })).status, 400);
    const en = await post({ titleEn: 'Only EN', enabled: true });
    assert.equal(en.status, 201); assert.equal(en.data.title, ''); assert.equal(en.data.titleEn, 'Only EN');
    const bg = await post({ title: 'Само БГ', enabled: true });
    assert.equal(bg.status, 201); assert.equal(bg.data.titleEn, '');
    // PUT: clearing the only title is rejected; clearing BG while EN exists is fine
    const clr = await s.api.req('PUT', `/api/admin/events/${bg.data.id}`, { form: form({ title: '' }) });
    assert.equal(clr.status, 400);
    const ok = await s.api.req('PUT', `/api/admin/events/${bg.data.id}`, { form: form({ title: '', titleEn: 'Now EN' }) });
    assert.equal(ok.status, 200); assert.equal(ok.data.title, '');
    // dashboard shows a title for EN-only events
    assert.deepEqual((await s.api.get('/api/admin/dashboard')).data.events.activeTitles.sort(), ['Now EN', 'Only EN']);
  } finally { await s.close(); }
});

test('events: public fallback both directions for title, description and image', async () => {
  const s = await loggedIn();
  try {
    const post = (fields, files) => s.api.req('POST', '/api/admin/events', { form: form(fields, files) });
    const onlyEn = (await post({ titleEn: 'EN title', descriptionEn: 'EN desc', enabled: true }, [png('imageEn')])).data;
    const onlyBg = (await post({ title: 'БГ заглавие', description: 'БГ опис', enabled: true }, [png('image')])).data;
    const both = (await post({ title: 'БГ', titleEn: 'EN', description: 'БГ д', descriptionEn: '', enabled: true }, [png('image'), jpg('imageEn')])).data;
    assert.match(onlyEn.imageEnUrl, /^\/api\/admin\/media\/[a-f0-9]{32}\.png$/); assert.equal(onlyEn.imageUrl, null);
    const get = async (lang) => Object.fromEntries((await pubGet(s, `events?lang=${lang}`)).data.events.map((e) => [e.id, e]));
    const bg = await get('bg'); const en = await get('en');
    assert.equal(bg[onlyEn.id].title, 'EN title'); assert.equal(bg[onlyEn.id].description, 'EN desc'); // bg falls back to EN
    assert.equal(en[onlyBg.id].title, 'БГ заглавие'); assert.equal(en[onlyBg.id].description, 'БГ опис'); // en falls back to BG
    assert.equal(bg[both.id].title, 'БГ'); assert.equal(en[both.id].title, 'EN');
    assert.equal(en[both.id].description, 'БГ д'); // per-field fallback
    // images
    const stored = (id, col) => s.db.prepare(`SELECT f.stored_name n FROM events e JOIN files f ON f.id = e.${col} WHERE e.id = ?`).get(id).n;
    assert.equal(bg[onlyEn.id].imageUrl, '/media/' + stored(onlyEn.id, 'image_en_file_id'));
    assert.equal(en[onlyBg.id].imageUrl, '/media/' + stored(onlyBg.id, 'image_file_id'));
    assert.equal(bg[both.id].imageUrl, '/media/' + stored(both.id, 'image_file_id'));
    assert.equal(en[both.id].imageUrl, '/media/' + stored(both.id, 'image_en_file_id'));
    // both EN and BG image reachable via /media while public
    for (const n of [stored(both.id, 'image_file_id'), stored(both.id, 'image_en_file_id'), stored(onlyEn.id, 'image_en_file_id')]) {
      assert.equal((await fetch(`${s.base}/media/${n}`)).status, 200);
    }
    // no field leak of the other language into the public object
    assert.deepEqual(Object.keys(bg[both.id]).sort(), ['description', 'eventAt', 'id', 'imageUrl', 'title']);
  } finally { await s.close(); }
});

test('events: EN image media visibility follows the event, replace/remove/delete leave no orphans', async () => {
  const s = await loggedIn();
  try {
    const c = await s.api.req('POST', '/api/admin/events', { form: form({ title: 't', enabled: false }, [png('image'), jpg('imageEn')]) });
    assert.equal(c.status, 201); assert.equal(s.uploads().length, 2);
    const enName = c.data.imageEnUrl.split('/').pop();
    assert.equal((await fetch(`${s.base}/media/${enName}`)).status, 404); // disabled
    assert.equal((await fetch(s.base + c.data.imageEnUrl)).status, 401);   // admin url needs login
    assert.equal((await fetch(s.base + c.data.imageEnUrl, { headers: { Cookie: s.api.cookie } })).status, 200);
    await s.api.patch(`/api/admin/events/${c.data.id}/enabled`, { enabled: true });
    assert.equal((await fetch(`${s.base}/media/${enName}`)).status, 200);
    // expiry hides it
    await s.api.req('PUT', `/api/admin/events/${c.data.id}`, { form: form({ expiresAt: '2026-06-15T13:30' }) });
    s.clock.t += 3600 * 1000;
    assert.equal((await fetch(`${s.base}/media/${enName}`)).status, 404);
    s.clock.t -= 3600 * 1000;
    // replace EN only -> old EN removed, BG kept
    const rep = await s.api.req('PUT', `/api/admin/events/${c.data.id}`, { form: form({}, [{ field: 'imageEn', buf: WEBP, name: 'w.webp', type: 'image/webp' }]) });
    assert.equal(rep.status, 200); assert.match(rep.data.imageEnUrl, /\.webp$/); assert.equal(rep.data.imageUrl, c.data.imageUrl);
    assert.equal(s.uploads().length, 2); assert.ok(!s.uploads().includes(enName)); noOrphans(s);
    // remove EN only
    const rm = await s.api.req('PUT', `/api/admin/events/${c.data.id}`, { form: form({ removeImageEn: 'true' }) });
    assert.equal(rm.data.imageEnUrl, null); assert.ok(rm.data.imageUrl);
    assert.equal(s.uploads().length, 1); noOrphans(s);
    // add EN again then delete the event: both files gone
    await s.api.req('PUT', `/api/admin/events/${c.data.id}`, { form: form({}, [png('imageEn')]) });
    assert.equal(s.uploads().length, 2);
    assert.equal((await s.api.del(`/api/admin/events/${c.data.id}`)).status, 204);
    assert.equal(s.uploads().length, 0); assert.equal(nFiles(s), 0);
  } finally { await s.close(); }
});

test('events: imageEn upload validation (type, extension, mime); nothing left behind', async () => {
  const s = await loggedIn();
  try {
    const post = (files, fields = { title: 't' }) => s.api.req('POST', '/api/admin/events', { form: form(fields, files) });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    let r = await post([{ field: 'imageEn', buf: svg, name: 'x.png', type: 'image/png' }]);
    assert.equal(r.status, 415); assert.ok(r.data.fields.imageEn);
    assert.equal((await post([pdf('imageEn')])).status, 415);
    assert.equal((await post([{ field: 'imageEn', buf: PNG, name: 'x.jpg', type: 'image/png' }])).status, 415);
    assert.equal((await post([{ field: 'imageEn', buf: PNG, name: 'x.png', type: 'image/jpeg' }])).status, 415);
    // valid BG image + invalid EN image: the BG file must be cleaned up too
    assert.equal((await post([png('image'), pdf('imageEn')])).status, 415);
    // validation failure with valid files
    assert.equal((await post([png('image'), jpg('imageEn')], { title: '', titleEn: '' })).status, 400);
    // unknown file field is rejected
    assert.equal((await post([png('other')])).status, 400);
    assert.equal(s.uploads().length, 0); assert.equal(nFiles(s), 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM events').get().n, 0);
    // PUT with bad EN image leaves existing files and DB untouched
    const c = (await post([png('image')])).data;
    assert.equal((await s.api.req('PUT', `/api/admin/events/${c.id}`, { form: form({}, [pdf('imageEn')]) })).status, 415);
    assert.equal(s.uploads().length, 1); noOrphans(s);
  } finally { await s.close(); }
});

// ---------- daily menus ----------
test('daily menu: at least one file; EN-only; public resolution and fallback both directions', async () => {
  const s = await loggedIn();
  try {
    const post = (fields, files) => s.api.req('POST', '/api/admin/daily-menus', { form: form(fields, files) });
    const none = await post({ date: '2026-06-15' }, []);
    assert.equal(none.status, 400); assert.ok(none.data.fields.file);

    // EN only
    const en = await post({ date: '2026-06-15', published: true }, [jpg('fileEn', 'en.jpg')]);
    assert.equal(en.status, 201);
    assert.equal(en.data.fileUrl, null); assert.equal(en.data.kind, null);
    assert.match(en.data.fileEnUrl, /^\/api\/admin\/media\/[a-f0-9]{32}\.jpg$/);
    assert.deepEqual([en.data.mimeTypeEn, en.data.kindEn, en.data.originalNameEn, en.data.sizeBytesEn], ['image/jpeg', 'image', 'en.jpg', JPG.length]);
    for (const lang of ['bg', 'en']) {
      const m = (await pubGet(s, `daily-menu?lang=${lang}`)).data.menu;
      assert.equal(m.kind, 'image'); assert.equal(m.mimeType, 'image/jpeg'); assert.equal(m.fileUrl, '/media/' + en.data.fileEnUrl.split('/').pop());
    }
    assert.equal((await fetch(s.base + '/media/' + en.data.fileEnUrl.split('/').pop())).status, 200);

    // add BG via PUT -> bg gets BG, en gets EN
    const put = await s.api.req('PUT', `/api/admin/daily-menus/${en.data.id}`, { form: form({}, [pdf('file')]) });
    assert.equal(put.status, 200); assert.equal(put.data.kind, 'pdf'); assert.equal(put.data.kindEn, 'image');
    const bgM = (await pubGet(s, 'daily-menu?lang=bg')).data.menu; const enM = (await pubGet(s, 'daily-menu?lang=en')).data.menu;
    assert.equal(bgM.kind, 'pdf'); assert.equal(enM.kind, 'image');
    assert.equal(bgM.fileUrl, '/media/' + put.data.fileUrl.split('/').pop());
    assert.equal(enM.fileUrl, '/media/' + put.data.fileEnUrl.split('/').pop());
    assert.equal((await pubGet(s, 'daily-menu')).data.menu.kind, 'pdf'); // default bg
    // both files public
    for (const u of [put.data.fileUrl, put.data.fileEnUrl]) assert.equal((await fetch(s.base + '/media/' + u.split('/').pop())).status, 200);

    // tomorrow's published menu is not public yet (media neither)
    const tomorrow = await post({ date: '2026-06-16', published: true }, [pdf('file'), pdf('fileEn')]);
    assert.equal(tomorrow.status, 201);
    for (const u of [tomorrow.data.fileUrl, tomorrow.data.fileEnUrl]) assert.equal((await fetch(s.base + '/media/' + u.split('/').pop())).status, 404);
    assert.equal((await pubGet(s, 'daily-menu?lang=en')).data.menu.kind, 'image');

    // BG only: en falls back to BG
    const old = put.data.fileEnUrl.split('/').pop();
    const bgOnly = await s.api.req('PUT', `/api/admin/daily-menus/${put.data.id}`, { form: form({ removeFileEn: 'true' }) });
    assert.equal(bgOnly.data.fileEnUrl, null);
    assert.equal((await pubGet(s, 'daily-menu?lang=en')).data.menu.fileUrl, '/media/' + bgOnly.data.fileUrl.split('/').pop());
    assert.equal((await fetch(`${s.base}/media/${old}`)).status, 404); // removed file gone

    await s.api.patch(`/api/admin/daily-menus/${put.data.id}/published`, { published: false });
    assert.equal((await fetch(`${s.base}/media/${old}`)).status, 404);
    assert.equal((await pubGet(s, 'daily-menu?lang=en')).data.menu, null);
  } finally { await s.close(); }
});

test('daily menu: removeFileEn, replace flow, PUT guards, delete; no orphans', async () => {
  const s = await loggedIn();
  try {
    const post = (fields, files) => s.api.req('POST', '/api/admin/daily-menus', { form: form(fields, files) });
    const c = await post({ date: '2026-06-15', published: true }, [pdf('file'), jpg('fileEn')]);
    assert.equal(c.status, 201); assert.equal(s.uploads().length, 2);
    // replace EN file
    const r1 = await s.api.req('PUT', `/api/admin/daily-menus/${c.data.id}`, { form: form({}, [png('fileEn', 'e.png')]) });
    assert.match(r1.data.fileEnUrl, /\.png$/); assert.equal(r1.data.fileUrl, c.data.fileUrl);
    assert.equal(s.uploads().length, 2); noOrphans(s);
    // remove EN
    const r2 = await s.api.req('PUT', `/api/admin/daily-menus/${c.data.id}`, { form: form({ removeFileEn: 'true' }) });
    assert.equal(r2.data.fileEnUrl, null); assert.equal(r2.data.mimeTypeEn, null); assert.equal(s.uploads().length, 1); noOrphans(s);
    // duplicate date still 409 and leaves no files
    const dup = await post({ date: '2026-06-15' }, [pdf('file'), pdf('fileEn')]);
    assert.equal(dup.status, 409); assert.equal(dup.data.error, 'date_exists'); assert.equal(s.uploads().length, 1);
    // replace=true: whole menu replaced by what was submitted, all old files removed
    await s.api.req('PUT', `/api/admin/daily-menus/${c.data.id}`, { form: form({}, [jpg('fileEn')]) });
    assert.equal(s.uploads().length, 2);
    const rep = await post({ date: '2026-06-15', replace: true }, [pdf('file', 'new.pdf')]);
    assert.equal(rep.status, 200); assert.equal(rep.data.id, c.data.id); assert.equal(rep.data.fileEnUrl, null);
    assert.equal(rep.data.originalName, 'new.pdf'); assert.equal(s.uploads().length, 1); noOrphans(s);
    // EN-only menu: removing the EN file would leave no file
    const e = await post({ date: '2026-06-20' }, [png('fileEn')]);
    const bad = await s.api.req('PUT', `/api/admin/daily-menus/${e.data.id}`, { form: form({ removeFileEn: 'true' }) });
    assert.equal(bad.status, 400); assert.ok(bad.data.fields.fileEn); assert.equal(s.uploads().length, 2);
    // ... unless a BG file is supplied in the same request
    const ok = await s.api.req('PUT', `/api/admin/daily-menus/${e.data.id}`, { form: form({ removeFileEn: 'true' }, [pdf('file')]) });
    assert.equal(ok.status, 200); assert.equal(ok.data.fileEnUrl, null); assert.ok(ok.data.fileUrl); noOrphans(s);
    // delete removes both
    const both = await post({ date: '2026-06-21' }, [pdf('file'), pdf('fileEn')]);
    assert.equal(s.uploads().length, 4);
    assert.equal((await s.api.del(`/api/admin/daily-menus/${both.data.id}`)).status, 204);
    assert.equal(s.uploads().length, 2); noOrphans(s);
  } finally { await s.close(); }
});

test('daily menu: fileEn upload validation; invalid EN leaves nothing behind', async () => {
  const s = await loggedIn();
  try {
    const post = (fields, files) => s.api.req('POST', '/api/admin/daily-menus', { form: form(fields, files) });
    const html = Buffer.from('<html>x</html>');
    let r = await post({ date: '2026-06-15' }, [{ field: 'fileEn', buf: html, name: 'm.pdf', type: 'application/pdf' }]);
    assert.equal(r.status, 415); assert.ok(r.data.fields.fileEn);
    assert.equal((await post({ date: '2026-06-15' }, [pdf('file'), { field: 'fileEn', buf: PNG, name: 'm.pdf', type: 'application/pdf' }])).status, 415);
    assert.equal((await post({ date: 'nope' }, [pdf('file'), pdf('fileEn')])).status, 400);
    assert.equal(s.uploads().length, 0); assert.equal(nFiles(s), 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM daily_menus').get().n, 0);
  } finally { await s.close(); }
});

// ---------- regular menu ----------
test('menu: names required in at least one language; public fallback both directions', async () => {
  const s = await loggedIn();
  try {
    const put = (categories) => s.api.put('/api/admin/menu/draft', { categories });
    const bad = await put([{ name: '', nameEn: '', items: [{ name: '', nameEn: '', priceCents: 100 }] }]);
    assert.equal(bad.status, 400);
    assert.ok(bad.data.fields['categories[0].name']); assert.ok(bad.data.fields['categories[0].items[0].name']);
    assert.equal((await put([{ nameEn: 'x'.repeat(101), items: [] }])).status, 400);
    const ok = await put([
      { name: '', nameEn: 'Only EN cat', items: [{ name: '', nameEn: 'EN dish', description: '', descriptionEn: 'EN d', priceCents: 500 }] },
      { name: 'Само БГ', items: [{ name: 'БГ ястие', description: 'БГ о', priceCents: 700 }, { name: 'И двете', nameEn: 'Both', description: 'БГ', descriptionEn: '', priceCents: 1 }] },
    ]);
    assert.equal(ok.status, 200);
    await s.api.post('/api/admin/menu/publish', {});
    const bg = (await pubGet(s, 'menu?lang=bg')).data.structured.categories;
    const en = (await pubGet(s, 'menu?lang=en')).data.structured.categories;
    assert.equal(bg[0].name, 'Only EN cat'); assert.equal(bg[0].items[0].name, 'EN dish'); assert.equal(bg[0].items[0].description, 'EN d');
    assert.equal(en[1].name, 'Само БГ'); assert.equal(en[1].items[0].name, 'БГ ястие'); assert.equal(en[1].items[0].description, 'БГ о');
    assert.equal(en[1].items[1].name, 'Both'); assert.equal(bg[1].items[1].name, 'И двете'); assert.equal(en[1].items[1].description, 'БГ');
    assert.equal(en[0].name, 'Only EN cat');
  } finally { await s.close(); }
});

test('site settings: address / opening hours fall back both directions', async () => {
  const s = await loggedIn();
  try {
    await s.api.put('/api/admin/settings', { address: '', addressEn: 'EN addr', openingHours: 'БГ часове', openingHoursEn: '' });
    const bg = (await pubGet(s, 'site?lang=bg')).data; const en = (await pubGet(s, 'site?lang=en')).data;
    assert.equal(bg.address, 'EN addr'); assert.equal(en.address, 'EN addr');
    assert.equal(bg.openingHours, 'БГ часове'); assert.equal(en.openingHours, 'БГ часове');
    await s.api.put('/api/admin/settings', { address: 'БГ адрес', addressEn: 'EN addr' });
    assert.equal((await pubGet(s, 'site?lang=bg')).data.address, 'БГ адрес'); assert.equal((await pubGet(s, 'site?lang=en')).data.address, 'EN addr');
  } finally { await s.close(); }
});

test('menu pages per language: upload lang, published flag per language, public pick + fallback, media, in_use', async () => {
  const s = await loggedIn();
  try {
    const up = (lang, f = pdf('file')) => s.api.req('POST', '/api/admin/menu/pages', { form: form(lang === undefined ? {} : { lang }, [f]) });
    assert.equal((await up('fr')).status, 400);
    assert.equal((await up('fr')).data.fields.lang.length > 0, true);
    assert.equal(s.uploads().length, 0);
    const bg1 = await up(); const bg2 = await up('bg', jpg('file')); const en1 = await up('en', pdf('file', 'en.pdf')); const en2 = await up('en', png('file', 'en2.png'));
    assert.deepEqual([bg1.data.lang, bg2.data.lang, en1.data.lang], ['bg', 'bg', 'en']);
    assert.equal(bg1.status, 201);
    const setPub = (lang, published) => s.api.put('/api/admin/menu/pages/published', { lang, published });
    await setPub('bg', true); await setPub('en', true);
    let pages = (await s.api.get('/api/admin/menu')).data.pages;
    assert.deepEqual(pages.bg.items.map((p) => p.id), [bg1.data.id, bg2.data.id]);
    assert.deepEqual(pages.en.items.map((p) => p.id), [en1.data.id, en2.data.id]);

    // media + public pick only in file mode
    const name = (r) => r.data.fileUrl.split('/').pop();
    assert.equal((await fetch(`${s.base}/media/${name(en2)}`)).status, 404);
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'file' })).status, 200);
    const bgF = (await pubGet(s, 'menu?lang=bg')).data.file; const enF = (await pubGet(s, 'menu?lang=en')).data.file;
    assert.deepEqual(bgF.pages.map((p) => p.fileUrl), ['/media/' + name(bg1), '/media/' + name(bg2)]);
    assert.deepEqual(enF.pages.map((p) => p.fileUrl), ['/media/' + name(en1), '/media/' + name(en2)]);
    assert.equal(enF.lang, 'en'); assert.equal(bgF.lang, 'bg');
    for (const r of [bg1, bg2, en1, en2]) assert.equal((await fetch(`${s.base}/media/${name(r)}`)).status, 200);

    // only EN published: bg falls back to EN, bg pages are no longer served
    assert.equal((await setPub('bg', false)).status, 200); // allowed: EN still live
    const fb = (await pubGet(s, 'menu?lang=bg')).data.file;
    assert.equal(fb.lang, 'en'); assert.equal(fb.pages.length, 2);
    assert.equal((await fetch(`${s.base}/media/${name(bg1)}`)).status, 404);
    // the last live language is in use
    const r = await setPub('en', false);
    assert.equal(r.status, 409); assert.equal(r.data.error, 'in_use');
    assert.equal((await s.api.del(`/api/admin/menu/pages/${en1.data.id}`)).status, 204); // not the last EN page
    assert.equal((await s.api.del(`/api/admin/menu/pages/${en2.data.id}`)).status, 409); // last page of the last live language
    // publish bg again, then the EN page may go
    await setPub('bg', true);
    assert.equal((await s.api.del(`/api/admin/menu/pages/${en2.data.id}`)).status, 204);
    assert.equal((await pubGet(s, 'menu?lang=en')).data.file.lang, 'bg'); // en falls back to bg
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'structured' })).status, 409); // no structured snapshot
    assert.equal((await s.api.del(`/api/admin/menu/pages/${bg2.data.id}`)).status, 204);
    assert.equal(nFiles(s), 1); noOrphans(s);
  } finally { await s.close(); }
});

test('menu mode file: ready when only an English page set is published', async () => {
  const s = await loggedIn();
  try {
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'file' })).status, 409);
    const en = await s.api.req('POST', '/api/admin/menu/pages', { form: form({ lang: 'en' }, [pdf('file')]) });
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'file' })).status, 409); // uploaded, unpublished
    await s.api.put('/api/admin/menu/pages/published', { lang: 'en', published: true });
    assert.equal((await s.api.put('/api/admin/menu/mode', { mode: 'file' })).status, 200);
    assert.ok((await pubGet(s, 'menu?lang=bg')).data.file);
    const dash = (await s.api.get('/api/admin/dashboard')).data.menu;
    assert.deepEqual(dash.pages, { bg: { published: false, count: 0 }, en: { published: true, count: 1 } });
    assert.ok(en.data.id);
  } finally { await s.close(); }
});

// ---------- auth / CSRF on changed routes ----------
test('changed routes: 401 without session, 403 without CSRF header', async () => {
  const s = await loggedIn();
  try {
    const anon = s.client();
    const f = () => form({ title: 't' }, [png('imageEn')]);
    for (const [m, u] of [['POST', '/api/admin/events'], ['PUT', '/api/admin/events/1'], ['POST', '/api/admin/daily-menus'], ['PUT', '/api/admin/daily-menus/1'], ['POST', '/api/admin/menu/pages']]) {
      const r = await anon.req(m, u, { form: f() });
      assert.equal(r.status, 401, `${m} ${u} anon`);
      const r2 = await s.api.req(m, u, { form: f(), csrf: false });
      assert.equal(r2.status, 403, `${m} ${u} no csrf`);
    }
    assert.equal(s.uploads().length, 0); assert.equal(nFiles(s), 0);
    // cross-origin form post is rejected
    const r3 = await s.api.req('POST', '/api/admin/daily-menus', { form: form({ date: '2026-06-15' }, [pdf('fileEn')]), headers: { Origin: 'https://evil.example' } });
    assert.ok([401, 403].includes(r3.status));
    assert.equal(s.uploads().length, 0);
  } finally { await s.close(); }
});

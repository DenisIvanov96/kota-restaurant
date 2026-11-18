// Public ?lang=bg|en resolution, per-field fallback, En-field leakage, admin En fields (auth/CSRF/limits), migration 002. Port 3209.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PDF, ROOT } from '../lib/harness.mjs';

const PORT = 3209;
const T0 = '2026-06-15T10:00:00Z';
const PNG = makePng(30, 20, [30, 30, 200]);
const item = (name, priceCents, extra = {}) => ({ name, description: '', priceCents, available: true, ...extra });

describe('i18n API', () => {
  let dir; let srv; let admin; let anon;
  const pub = (p, lang) => anon.get(`/api/public/${p}${lang === undefined ? '' : `?lang=${lang}`}`);
  before(async () => { dir = tmpDir('i18n'); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('I1 site: settings En fields; lang resolution (default/bg/en), per-field fallback', async () => {
    const r = await admin.put('/api/admin/settings', { json: { reservationPhone: '+359 2 123', address: 'ул. Тест 1', addressEn: 'Test St 1', openingHours: 'Пн-Нд 10-22', openingHoursEn: '', currencySymbol: '€' } });
    assert.equal(r.status, 200, r.text()); assert.equal(r.data.addressEn, 'Test St 1'); assert.equal(r.data.openingHoursEn, '');
    const d = (await pub('site')).data; const bg = (await pub('site', 'bg')).data; const en = (await pub('site', 'en')).data;
    assert.equal(d.lang, 'bg'); assert.equal(bg.lang, 'bg'); assert.equal(en.lang, 'en');
    assert.equal(d.address, 'ул. Тест 1'); assert.equal(bg.address, 'ул. Тест 1'); assert.equal(en.address, 'Test St 1');
    assert.equal(en.openingHours, 'Пн-Нд 10-22', 'empty En hours falls back to BG per field');
    assert.equal(en.reservationPhone, '+359 2 123');
  });
  test('I2 site: whitespace-only En field falls back to BG; clearing En restores fallback', async () => {
    await admin.put('/api/admin/settings', { json: { addressEn: '   ' } });
    assert.equal((await pub('site', 'en')).data.address, 'ул. Тест 1');
    await admin.put('/api/admin/settings', { json: { addressEn: 'Test St 1', openingHoursEn: 'Daily 10-22' } });
    const en = (await pub('site', 'en')).data; assert.equal(en.address, 'Test St 1'); assert.equal(en.openingHours, 'Daily 10-22');
    assert.equal((await pub('site', 'bg')).data.openingHours, 'Пн-Нд 10-22');
  });
  test('I3 invalid lang => 400 validation on all four public endpoints (EN, fr, empty, uppercase, array, injection)', async () => {
    for (const ep of ['site', 'events', 'menu', 'daily-menu']) {
      for (const bad of ['fr', '', 'EN', 'en%20', 'bg,en', '%3Cscript%3E', "en'--"]) {
        const r = await anon.get(`/api/public/${ep}?lang=${bad}`);
        assert.equal(r.status, 400, `${ep}?lang=${bad} -> ${r.status}`); assert.equal(r.data.error, 'validation'); assert.ok(r.data.message);
        assert.ok(!r.text().includes('<script'), 'no reflection');
      }
      const arr = await anon.get(`/api/public/${ep}?lang=en&lang=bg`); assert.equal(arr.status, 400, `${ep} repeated lang`);
    }
  });
  test('I4 events: En title/description with per-field fallback; response shape unchanged + lang; admin returns both', async () => {
    const a = await admin.post('/api/admin/events', { form: form({ title: 'Жива музика', titleEn: 'Live music', description: 'Опис', descriptionEn: '', enabled: 'true' }) });
    assert.equal(a.status, 201, a.text()); assert.equal(a.data.titleEn, 'Live music');
    const b = await admin.post('/api/admin/events', { form: form({ title: 'Само БГ', description: 'само български', enabled: 'true' }) });
    assert.equal(b.status, 201, b.text());
    const bg = (await pub('events', 'bg')).data; const en = (await pub('events', 'en')).data; const def = (await pub('events')).data;
    assert.equal(bg.lang, 'bg'); assert.equal(en.lang, 'en'); assert.equal(def.lang, 'bg');
    const ev = (d, t) => d.events.find((e) => e.id === (t === 'a' ? a.data.id : b.data.id));
    assert.equal(ev(bg, 'a').title, 'Жива музика'); assert.equal(ev(def, 'a').title, 'Жива музика');
    assert.equal(ev(en, 'a').title, 'Live music'); assert.equal(ev(en, 'a').description, 'Опис', 'empty descriptionEn -> BG');
    assert.equal(ev(en, 'b').title, 'Само БГ'); assert.equal(ev(en, 'b').description, 'само български');
    assert.deepEqual(Object.keys(ev(en, 'a')).sort(), ['description', 'eventAt', 'id', 'imageUrl', 'title']);
    const adm = (await admin.get('/api/admin/events')).data.events.find((e) => e.id === a.data.id);
    assert.equal(adm.title, 'Жива музика'); assert.equal(adm.titleEn, 'Live music'); assert.equal(adm.descriptionEn, '');
  });
  test('I5 events: PUT can set and clear En fields; omitted En fields are kept', async () => {
    const id = (await admin.get('/api/admin/events')).data.events.find((e) => e.title === 'Жива музика').id;
    let r = await admin.put(`/api/admin/events/${id}`, { form: form({ title: 'Жива музика', descriptionEn: 'Desc EN' }) });
    assert.equal(r.status, 200, r.text());
    let en = (await pub('events', 'en')).data.events.find((e) => e.id === id); assert.equal(en.title, 'Live music', 'titleEn kept when omitted'); assert.equal(en.description, 'Desc EN');
    r = await admin.put(`/api/admin/events/${id}`, { form: form({ title: 'Жива музика', titleEn: '' }) });
    assert.equal(r.status, 200, r.text());
    en = (await pub('events', 'en')).data.events.find((e) => e.id === id); assert.equal(en.title, 'Жива музика', 'cleared titleEn -> BG'); assert.equal(en.description, 'Desc EN');
  });
  test('I6 menu: draft/publish with En fields; per-field fallback in public lang=en; unpublished En edit counts as unpublished change', async () => {
    const r = await admin.put('/api/admin/menu/draft', { json: { categories: [
      { name: 'Салати', nameEn: 'Salads', items: [item('Шопска', 650, { nameEn: 'Shopska salad', description: 'домати', descriptionEn: 'tomatoes' }), item('Таратор', 500, { description: 'студена супа' })] },
      { name: 'Супи', items: [item('Боб чорба', 400, { descriptionEn: 'Bean soup desc' })] },
    ] } });
    assert.equal(r.status, 200, r.text());
    assert.equal(r.data.categories[0].nameEn, 'Salads'); assert.equal(r.data.categories[0].items[0].nameEn, 'Shopska salad');
    assert.equal((await admin.post('/api/admin/menu/publish')).status, 200);
    const a = (await admin.get('/api/admin/menu')).data; assert.equal(a.hasUnpublishedChanges, false);
    assert.equal(a.published.categories[0].items[0].descriptionEn, 'tomatoes', 'published carries En fields (admin)');
    const bg = (await pub('menu', 'bg')).data; const en = (await pub('menu', 'en')).data;
    assert.equal(bg.lang, 'bg'); assert.equal(en.lang, 'en'); assert.equal((await pub('menu')).data.lang, 'bg');
    assert.equal(bg.structured.categories[0].name, 'Салати'); assert.equal(bg.structured.categories[0].items[0].name, 'Шопска');
    const ec = en.structured.categories;
    assert.equal(ec[0].name, 'Salads'); assert.equal(ec[0].items[0].name, 'Shopska salad'); assert.equal(ec[0].items[0].description, 'tomatoes');
    assert.equal(ec[0].items[1].name, 'Таратор', 'item without En name falls back'); assert.equal(ec[0].items[1].description, 'студена супа');
    assert.equal(ec[1].name, 'Супи', 'category without En name falls back'); assert.equal(ec[1].items[0].name, 'Боб чорба'); assert.equal(ec[1].items[0].description, 'Bean soup desc');
    assert.equal(ec[0].items[0].priceCents, 650);
    // En-only edit is an unpublished change
    const d = (await admin.get('/api/admin/menu')).data.draft; d.categories[1].nameEn = 'Soups';
    assert.equal((await admin.put('/api/admin/menu/draft', { json: { categories: d.categories } })).status, 200);
    assert.equal((await admin.get('/api/admin/menu')).data.hasUnpublishedChanges, true, 'En-only edit => hasUnpublishedChanges');
    assert.equal((await pub('menu', 'en')).data.structured.categories[1].name, 'Супи', 'draft En not public until publish');
    await admin.post('/api/admin/menu/publish');
    assert.equal((await pub('menu', 'en')).data.structured.categories[1].name, 'Soups');
    assert.equal((await admin.get('/api/admin/menu')).data.hasUnpublishedChanges, false);
  });
  test('I7 daily-menu: accepts lang, returns lang, shape otherwise unchanged', async () => {
    for (const l of ['bg', 'en', undefined]) { const r = await pub('daily-menu', l); assert.equal(r.status, 200); assert.equal(r.data.lang, l || 'bg'); assert.ok('today' in r.data && 'menu' in r.data); }
  });
  test('I8 En fields never leak: no *En keys in any public response in either language, nor in daily/media', async () => {
    for (const l of [undefined, 'bg', 'en']) for (const ep of ['site', 'events', 'menu', 'daily-menu']) {
      const txt = (await pub(ep, l)).text();
      assert.ok(!/"(titleEn|descriptionEn|nameEn|addressEn|openingHoursEn|title_en|name_en|description_en|address_en)"/.test(txt), `${ep}?lang=${l} leaks an En key: ${txt.slice(0, 200)}`);
    }
    // En text present only when lang=en
    const bgAll = ['site', 'events', 'menu'].map((e) => '').join('');
    const bgTxt = (await pub('site', 'bg')).text() + (await pub('events', 'bg')).text() + (await pub('menu', 'bg')).text() + (await pub('menu')).text();
    for (const s of ['Test St 1', 'Live music', 'Shopska salad', 'Salads', 'Soups', 'Daily 10-22']) assert.ok(!bgTxt.includes(s), `BG response contains En text "${s}"${bgAll}`);
  });
  test('I9 admin En fields: unauthenticated => 401, missing CSRF header => 403, wrong content ignored; no changes made', async () => {
    const before = (await pub('site', 'en')).data.address;
    const un = new Client(srv.url);
    let r = await un.put('/api/admin/settings', { json: { addressEn: 'HACK' }, cookie: '' }); assert.equal(r.status, 401);
    r = await un.put('/api/admin/menu/draft', { json: { categories: [{ name: 'x', nameEn: 'HACK', items: [] }] }, cookie: '' }); assert.equal(r.status, 401);
    r = await un.post('/api/admin/events', { form: form({ title: 't', titleEn: 'HACK' }), cookie: '' }); assert.equal(r.status, 401);
    r = await admin.put('/api/admin/settings', { json: { addressEn: 'HACK' }, csrf: false }); assert.ok([400, 403].includes(r.status), `no CSRF header => ${r.status}`);
    r = await admin.put('/api/admin/settings', { json: { addressEn: 'HACK' }, origin: 'https://evil.example' }); assert.equal(r.status, 403, 'foreign Origin');
    r = await admin.post('/api/admin/events', { form: form({ title: 't', titleEn: 'HACK' }), csrf: false }); assert.ok([400, 403].includes(r.status));
    r = await admin.put('/api/admin/menu/draft', { json: { categories: [{ name: 'x', nameEn: 'HACK', items: [] }] }, csrf: false }); assert.ok([400, 403].includes(r.status));
    assert.equal((await pub('site', 'en')).data.address, before); assert.ok(!(await admin.get('/api/admin/settings')).text().includes('HACK'));
    assert.ok(!(await admin.get('/api/admin/events')).text().includes('HACK'));
  });
  test('I10 limits: titleEn 120/121, descriptionEn 2000/2001, category/item nameEn 100/101, item descEn 500/501, addressEn 200/201, hoursEn 500/501 -> 400 with field key; boundary accepted', async () => {
    const ok = async (r, what) => assert.ok([200, 201].includes(r.status), `${what} boundary => ${r.status} ${r.text().slice(0, 150)}`);
    const bad = (r, key, what) => { assert.equal(r.status, 400, `${what} => ${r.status}`); assert.equal(r.data.error, 'validation'); assert.ok(JSON.stringify(r.data.fields).includes(key), `${what}: fields ${JSON.stringify(r.data.fields)}`); };
    let r = await admin.post('/api/admin/events', { form: form({ title: 'L', titleEn: 'a'.repeat(120) }) }); await ok(r, 'titleEn 120');
    bad(await admin.post('/api/admin/events', { form: form({ title: 'L', titleEn: 'a'.repeat(121) }) }), 'titleEn', 'titleEn 121');
    r = await admin.post('/api/admin/events', { form: form({ title: 'L2', descriptionEn: 'b'.repeat(2000) }) }); await ok(r, 'descriptionEn 2000');
    bad(await admin.post('/api/admin/events', { form: form({ title: 'L', descriptionEn: 'b'.repeat(2001) }) }), 'descriptionEn', 'descriptionEn 2001');
    // CRLF counted after normalisation (as BG fields)
    r = await admin.post('/api/admin/events', { form: form({ title: 'L3', descriptionEn: ('c'.repeat(98) + '\r\n').repeat(20) + 'd'.repeat(20) }) }); await ok(r, 'descriptionEn 2000 incl CRLF');
    assert.ok(!(await admin.get('/api/admin/events')).data.events.find((e) => e.title === 'L3').descriptionEn.includes('\r'));
    const mk = (c, i) => ({ categories: [{ name: 'K', nameEn: c, items: [item('I', 100, i)] }] });
    await ok(await admin.put('/api/admin/menu/draft', { json: mk('a'.repeat(100), { nameEn: 'b'.repeat(100), descriptionEn: 'c'.repeat(500) }) }), 'menu En 100/100/500');
    bad(await admin.put('/api/admin/menu/draft', { json: mk('a'.repeat(101), {}) }), 'nameEn', 'category nameEn 101');
    bad(await admin.put('/api/admin/menu/draft', { json: mk('', { nameEn: 'b'.repeat(101) }) }), 'nameEn', 'item nameEn 101');
    bad(await admin.put('/api/admin/menu/draft', { json: mk('', { descriptionEn: 'c'.repeat(501) }) }), 'descriptionEn', 'item descriptionEn 501');
    await ok(await admin.put('/api/admin/settings', { json: { addressEn: 'a'.repeat(200), openingHoursEn: 'h'.repeat(500) } }), 'settings En 200/500');
    bad(await admin.put('/api/admin/settings', { json: { addressEn: 'a'.repeat(201) } }), 'addressEn', 'addressEn 201');
    bad(await admin.put('/api/admin/settings', { json: { openingHoursEn: 'h'.repeat(501) } }), 'openingHoursEn', 'openingHoursEn 501');
    // type confusion
    bad(await admin.put('/api/admin/settings', { json: { addressEn: 123 } }), 'addressEn', 'addressEn number');
    bad(await admin.put('/api/admin/settings', { json: { addressEn: { a: 1 } } }), 'addressEn', 'addressEn object');
    assert.equal((await admin.put('/api/admin/menu/draft', { json: { categories: [{ name: 'K', nameEn: ['x'], items: [] }] } })).status, 400, 'nameEn array');
    // restore
    await admin.put('/api/admin/settings', { json: { addressEn: 'Test St 1', openingHoursEn: 'Daily 10-22' } });
  });
  test('I11 En fields are trimmed, CRLF-normalised and stored as plain text (HTML kept literal, not interpreted)', async () => {
    const r = await admin.post('/api/admin/events', { form: form({ title: 'Trim', titleEn: '  <b>x</b> & "q"  ', descriptionEn: 'l1\r\nl2' }) });
    assert.equal(r.status, 201, r.text());
    const e = (await admin.get('/api/admin/events')).data.events.find((x) => x.title === 'Trim');
    assert.equal(e.titleEn, '<b>x</b> & "q"'); assert.equal(e.descriptionEn, 'l1\nl2');
  });
  test('I12 public/admin responses are JSON with nosniff (En text in JSON cannot become HTML)', async () => {
    const r = await pub('events', 'en'); assert.match(r.headers.get('content-type'), /application\/json/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });
});

describe('migration 002 on a pre-i18n database', () => {
  const MIG = path.join(ROOT, 'server', 'migrations');
  let dir; let srv;
  after(async () => { if (srv) await srv.stop(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
  test('I13 DB created with ONLY 001_init + data; server start applies 002; data kept, En columns NULL, fallback works, En can then be set', async () => {
    dir = tmpDir('mig'); fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
    const db = new DatabaseSync(path.join(dir, 'kota.db'));
    db.exec(fs.readFileSync(path.join(MIG, '001_init.sql'), 'utf8'));
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
    db.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run('001_init.sql', Date.now());
    const now = Date.parse(T0);
    db.prepare('INSERT INTO events(title, description, enabled, created_at, updated_at) VALUES (?,?,1,?,?)').run('Старо събитие', 'старо описание', now, now);
    const cid = Number(db.prepare('INSERT INTO menu_categories(name, position) VALUES (?,0)').run('Стара категория').lastInsertRowid);
    db.prepare('INSERT INTO menu_items(category_id, name, description, price_cents, available, position) VALUES (?,?,?,?,1,0)').run(cid, 'Старо ястие', 'старо ястие описание', 777);
    // an OLD snapshot (no *En keys at all)
    db.prepare('INSERT INTO menu_versions(snapshot_json, published_at) VALUES (?, ?)').run(JSON.stringify([{ id: cid, name: 'Стара категория', items: [{ id: 1, name: 'Старо ястие', description: 'старо ястие описание', priceCents: 777, available: true }] }]), now);
    db.prepare("UPDATE settings SET value = 'ул. Стара 1' WHERE key = 'address'").run();
    db.prepare("UPDATE settings SET value = '+359 2 999' WHERE key = 'reservation_phone'").run();
    const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    assert.ok(!cols('events').includes('title_en'), 'precondition: pre-i18n schema');
    db.close();

    srv = await startServer({ port: PORT + 0, dataDir: dir, now: T0 }); // port reused: the first describe's server is stopped in its after()
    const anon = new Client(srv.url);
    const en = (await anon.get('/api/public/events?lang=en')).data; assert.equal(en.events[0].title, 'Старо събитие'); assert.equal(en.events[0].description, 'старо описание');
    const m = (await anon.get('/api/public/menu?lang=en')).data.structured.categories[0]; assert.equal(m.name, 'Стара категория'); assert.equal(m.items[0].name, 'Старо ястие'); assert.equal(m.items[0].priceCents, 777);
    assert.equal((await anon.get('/api/public/menu?lang=bg')).data.structured.categories[0].items[0].priceCents, 777);
    const s = (await anon.get('/api/public/site?lang=en')).data; assert.equal(s.address, 'ул. Стара 1'); assert.equal(s.reservationPhone, '+359 2 999');
    await srv.stop(); srv = null;

    const chk = new DatabaseSync(path.join(dir, 'kota.db'));
    const applied = chk.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name);
    assert.deepEqual(applied, ['001_init.sql', '002_i18n.sql', '003_default_address.sql', '004_fix_default_address_en.sql', '005_separate_languages.sql', '006_menu_pages.sql', '007_gallery.sql', '008_contact_email.sql']); // 003 (D-37), 004 (BUG-12 repair) and 005 (D-39..42, T-33) are applied on start as well
    const c2 = (t) => chk.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    assert.ok(c2('events').includes('title_en') && c2('events').includes('description_en') && c2('menu_categories').includes('name_en') && c2('menu_items').includes('name_en') && c2('menu_items').includes('description_en'));
    assert.equal(chk.prepare('SELECT title_en FROM events').get().title_en, null);
    assert.equal(chk.prepare("SELECT value FROM settings WHERE key='address_en'").get().value, '');
    assert.equal(chk.prepare('SELECT COUNT(*) n FROM events').get().n, 1);
    chk.close();

    createAdmin(dir); // second start: migration must be idempotent
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
    const admin = new Client(srv.url); await admin.login();
    const a = (await admin.get('/api/admin/menu')).data;
    assert.equal(a.published.categories[0].name, 'Стара категория'); assert.equal(a.draft.categories[0].nameEn ?? '', '');
    assert.equal(a.hasUnpublishedChanges, false, 'old snapshot (no En keys) vs migrated draft: no phantom unpublished change');
    const ev = (await admin.get('/api/admin/events')).data.events[0]; assert.equal(ev.titleEn, '');
    assert.equal((await admin.put(`/api/admin/events/${ev.id}`, { form: form({ title: 'Старо събитие', titleEn: 'Old event' }) })).status, 200);
    assert.equal((await anon.get('/api/public/events?lang=en')).data.events[0].title, 'Old event');
    assert.equal((await anon.get('/api/public/events?lang=bg')).data.events[0].title, 'Старо събитие');
  });
});

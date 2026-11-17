import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loggedIn, startApp, formData } from './helpers.js';

const MIG_001 = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations', '001_init.sql');
const pub = async (s, p) => (await s.client().get(`/api/public/${p}`));
const createEvent = (s, fields) => s.api.req('POST', '/api/admin/events', { form: formData(fields) });

test('migration 002 on an existing DB: old data survives and reads with fallback', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kota-mig-'));
  fs.mkdirSync(path.join(dataDir, 'uploads'));
  const old = new DatabaseSync(path.join(dataDir, 'kota.db'));
  old.exec(fs.readFileSync(MIG_001, 'utf8'));
  old.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  old.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run('001_init.sql', 1);
  old.prepare("INSERT INTO events(title, description, enabled, created_at, updated_at) VALUES ('Стар', 'описание', 1, 1, 1)").run();
  old.prepare("UPDATE settings SET value = 'ул. Стара 1' WHERE key = 'address'").run();
  old.prepare("INSERT INTO menu_categories(name, position) VALUES ('Салати', 0)").run();
  old.prepare("INSERT INTO menu_items(category_id, name, description, price_cents, position) VALUES (1, 'Шопска', 'домати', 650, 0)").run();
  old.prepare('INSERT INTO menu_versions(snapshot_json, published_at) VALUES (?, ?)').run(
    JSON.stringify([{ id: 1, name: 'Салати', items: [{ id: 1, name: 'Шопска', description: 'домати', priceCents: 650, available: true }] }]), 2);
  old.close();

  const s = await loggedIn({ dataDir });
  try {
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 4);
    for (const lang of ['bg', 'en']) {
      const ev = (await pub(s, `events?lang=${lang}`)).data;
      assert.equal(ev.lang, lang);
      assert.deepEqual([ev.events[0].title, ev.events[0].description], ['Стар', 'описание']);
      // BUG-12: the default English address is NOT seeded over a stored BG address: EN falls back to the BG one
      assert.equal((await pub(s, `site?lang=${lang}`)).data.address, 'ул. Стара 1');
      const m = (await pub(s, `menu?lang=${lang}`)).data;
      assert.equal(m.structured.categories[0].name, 'Салати');
      assert.equal(m.structured.categories[0].items[0].name, 'Шопска');
    }
    // admin reads old rows with empty English fields; unchanged after no-op reads
    const adm = (await s.api.get('/api/admin/menu')).data;
    assert.equal(adm.draft.categories[0].nameEn, ''); assert.equal(adm.draft.categories[0].items[0].descriptionEn, '');
    assert.equal(adm.hasUnpublishedChanges, false); // draft (no En) equals old snapshot (no En)
    const st = (await s.api.get('/api/admin/settings')).data;
    assert.equal(st.address, 'ул. Стара 1'); // 003 never overwrites a stored address
    assert.equal(st.addressEn, ''); // BUG-12: EN default only seeded together with the BG one; assert.equal(st.openingHoursEn, '');
    assert.equal((await s.api.get('/api/admin/events')).data.events[0].titleEn, '');
  } finally { await s.close(); }
});

test('events: titleEn/descriptionEn round-trip, fallback per field, lang=bg ignores En', async () => {
  const s = await loggedIn();
  try {
    const a = await createEvent(s, { title: 'Жива музика', titleEn: 'Live music', description: 'Бг описание', descriptionEn: 'En description', enabled: true });
    assert.equal(a.status, 201);
    assert.equal(a.data.titleEn, 'Live music'); assert.equal(a.data.descriptionEn, 'En description');
    const b = await createEvent(s, { title: 'Само БГ', description: 'само бг', enabled: true });
    assert.equal(b.data.titleEn, ''); assert.equal(b.data.descriptionEn, '');
    const c = await createEvent(s, { title: 'Частичен', titleEn: 'Partial', description: 'бг', enabled: true }); // only title translated
    assert.equal(c.status, 201);

    const byId = (d) => Object.fromEntries(d.events.map((e) => [e.id, e]));
    const en = (await pub(s, 'events?lang=en')).data;
    assert.equal(en.lang, 'en');
    assert.deepEqual([byId(en)[a.data.id].title, byId(en)[a.data.id].description], ['Live music', 'En description']);
    assert.deepEqual([byId(en)[b.data.id].title, byId(en)[b.data.id].description], ['Само БГ', 'само бг']);
    assert.deepEqual([byId(en)[c.data.id].title, byId(en)[c.data.id].description], ['Partial', 'бг']);
    assert.ok(!('titleEn' in byId(en)[a.data.id])); // public shape unchanged

    for (const q of ['events', 'events?lang=bg']) {
      const bg = (await pub(s, q)).data;
      assert.equal(bg.lang, 'bg');
      assert.deepEqual([byId(bg)[a.data.id].title, byId(bg)[a.data.id].description], ['Жива музика', 'Бг описание']);
    }

    // PUT: omitted En fields are kept; explicit empty clears; update works
    const keep = await s.api.req('PUT', `/api/admin/events/${a.data.id}`, { form: formData({ title: 'Жива музика 2' }) });
    assert.equal(keep.data.titleEn, 'Live music'); assert.equal(keep.data.descriptionEn, 'En description');
    const upd = await s.api.req('PUT', `/api/admin/events/${a.data.id}`, { form: formData({ titleEn: 'Live music 2', descriptionEn: '' }) });
    assert.equal(upd.data.titleEn, 'Live music 2'); assert.equal(upd.data.descriptionEn, '');
    const en2 = byId((await pub(s, 'events?lang=en')).data)[a.data.id];
    assert.deepEqual([en2.title, en2.description], ['Live music 2', 'Бг описание']);
    assert.equal((await s.api.get('/api/admin/events')).data.events.find((e) => e.id === a.data.id).titleEn, 'Live music 2');
  } finally { await s.close(); }
});

test('event En fields: limits, CRLF normalisation, optional, auth and CSRF', async () => {
  const s = await loggedIn();
  try {
    const bad = await createEvent(s, { title: 't', titleEn: 'x'.repeat(121), descriptionEn: 'y'.repeat(2001) });
    assert.equal(bad.status, 400); assert.deepEqual(Object.keys(bad.data.fields).sort(), ['descriptionEn', 'titleEn']);
    const ok = await createEvent(s, { title: 't', titleEn: 'x'.repeat(120), descriptionEn: 'y'.repeat(2000) });
    assert.equal(ok.status, 201);
    // CRLF counts as one char (2000 lines of "a\r\n" would exceed; 1000 x "\r\n" separators fits after normalising)
    const crlf = await createEvent(s, { title: 't', descriptionEn: `  ${'a\r\n'.repeat(999)}a  ` });
    assert.equal(crlf.status, 201);
    assert.equal(crlf.data.descriptionEn, `${'a\n'.repeat(999)}a`);
    assert.ok(!crlf.data.descriptionEn.includes('\r'));
    const noEn = await createEvent(s, { title: 't' });
    assert.equal(noEn.status, 201);

    const anon = s.client();
    assert.equal((await anon.post('/api/admin/events', {})).status, 401);
    assert.equal((await s.api.req('POST', '/api/admin/events', { csrf: false, form: formData({ title: 't', titleEn: 'x' }) })).status, 403);
    assert.equal((await s.api.req('PUT', `/api/admin/events/${ok.data.id}`, { csrf: false, form: formData({ titleEn: 'x' }) })).status, 403);
  } finally { await s.close(); }
});

test('settings: addressEn/openingHoursEn round-trip, fallback, limits, CRLF, auth/CSRF', async () => {
  const s = await loggedIn();
  try {
    const put = await s.api.put('/api/admin/settings', { address: 'ул. Витоша 1', addressEn: '1 Vitosha St', openingHours: 'Пн-Нд 10-22', openingHoursEn: 'Mon\r\nSun 10-22' });
    assert.equal(put.status, 200);
    assert.equal(put.data.addressEn, '1 Vitosha St'); assert.equal(put.data.openingHoursEn, 'Mon\nSun 10-22');
    assert.equal((await s.api.get('/api/admin/settings')).data.addressEn, '1 Vitosha St');
    let en = (await pub(s, 'site?lang=en')).data;
    assert.deepEqual([en.lang, en.address, en.openingHours], ['en', '1 Vitosha St', 'Mon\nSun 10-22']);
    assert.ok(!('addressEn' in en));
    let bg = (await pub(s, 'site')).data;
    assert.deepEqual([bg.lang, bg.address, bg.openingHours], ['bg', 'ул. Витоша 1', 'Пн-Нд 10-22']);
    assert.equal((await pub(s, 'site?lang=bg')).data.address, 'ул. Витоша 1'); // lang=bg ignores En

    // partial update keeps En; clearing one field falls back per field
    await s.api.put('/api/admin/settings', { openingHoursEn: '' });
    en = (await pub(s, 'site?lang=en')).data;
    assert.deepEqual([en.address, en.openingHours], ['1 Vitosha St', 'Пн-Нд 10-22']);

    const bad = await s.api.put('/api/admin/settings', { addressEn: 'a'.repeat(201), openingHoursEn: 'b'.repeat(501) });
    assert.equal(bad.status, 400); assert.deepEqual(Object.keys(bad.data.fields).sort(), ['addressEn', 'openingHoursEn']);
    assert.equal((await s.api.put('/api/admin/settings', { addressEn: 5 })).status, 400);
    assert.equal((await s.api.put('/api/admin/settings', { addressEn: 'a'.repeat(200), openingHoursEn: 'b'.repeat(500) })).status, 200);

    assert.equal((await s.client().put('/api/admin/settings', { addressEn: 'x' })).status, 401);
    assert.equal((await s.api.req('PUT', '/api/admin/settings', { csrf: false, json: { addressEn: 'x' } })).status, 403);
  } finally { await s.close(); }
});

const menuDraft = (extra = {}) => ({
  categories: [
    { name: 'Салати', nameEn: 'Salads', items: [
      { name: 'Шопска', nameEn: 'Shopska', description: 'домати', descriptionEn: 'tomatoes', priceCents: 650, ...extra },
      { name: 'Таратор', description: 'кисело мляко', priceCents: 500 }, // no English at all
      { name: 'Лютеница', nameEn: 'Lyutenitsa', description: 'бг', priceCents: 300 }, // name only
    ] },
    { name: 'Основни', items: [] }, // category without English
  ],
});

test('menu: En round-trip, draft hidden, publish includes En, per-field fallback, lang=bg ignores En', async () => {
  const s = await loggedIn();
  try {
    const saved = await s.api.put('/api/admin/menu/draft', menuDraft());
    assert.equal(saved.status, 200);
    const c0 = saved.data.categories[0];
    assert.deepEqual([c0.nameEn, c0.items[0].nameEn, c0.items[0].descriptionEn], ['Salads', 'Shopska', 'tomatoes']);
    assert.deepEqual([c0.items[1].nameEn, c0.items[1].descriptionEn, saved.data.categories[1].nameEn], ['', '', '']);
    assert.equal((await pub(s, 'menu?lang=en')).data.structured, null); // draft stays hidden

    let adm = (await s.api.get('/api/admin/menu')).data;
    assert.equal(adm.hasUnpublishedChanges, true); assert.equal(adm.draft.categories[0].items[0].nameEn, 'Shopska');
    await s.api.post('/api/admin/menu/publish');
    adm = (await s.api.get('/api/admin/menu')).data;
    assert.equal(adm.hasUnpublishedChanges, false);
    assert.equal(adm.published.categories[0].nameEn, 'Salads'); assert.equal(adm.published.categories[0].items[0].descriptionEn, 'tomatoes');

    const en = (await pub(s, 'menu?lang=en')).data;
    assert.equal(en.lang, 'en');
    assert.deepEqual(en.structured.categories.map((c) => c.name), ['Salads', 'Основни']);
    const its = en.structured.categories[0].items;
    assert.deepEqual(its.map((i) => [i.name, i.description]), [['Shopska', 'tomatoes'], ['Таратор', 'кисело мляко'], ['Lyutenitsa', 'бг']]);
    assert.deepEqual(Object.keys(its[0]).sort(), ['available', 'description', 'id', 'name', 'priceCents']); // shape unchanged
    assert.equal(its[0].priceCents, 650);
    assert.ok(!('nameEn' in en.structured.categories[0]));

    for (const q of ['menu', 'menu?lang=bg']) {
      const bg = (await pub(s, q)).data;
      assert.equal(bg.lang, 'bg');
      assert.deepEqual(bg.structured.categories.map((c) => c.name), ['Салати', 'Основни']);
      assert.deepEqual(bg.structured.categories[0].items.map((i) => i.name), ['Шопска', 'Таратор', 'Лютеница']);
    }

    // hasUnpublishedChanges considers each En field
    const d = saved.data;
    const variants = [
      (x) => { x.categories[0].nameEn = 'Salad'; },
      (x) => { x.categories[0].items[0].nameEn = 'Shopska salad'; },
      (x) => { x.categories[0].items[0].descriptionEn = 'tomato'; },
      (x) => { x.categories[1].nameEn = 'Mains'; },
    ];
    for (const mutate of variants) {
      await s.api.post('/api/admin/menu/draft/discard');
      const cur = JSON.parse(JSON.stringify((await s.api.get('/api/admin/menu')).data.draft));
      mutate(cur);
      await s.api.put('/api/admin/menu/draft', cur);
      assert.equal((await s.api.get('/api/admin/menu')).data.hasUnpublishedChanges, true);
    }
    // discard restores En fields from the snapshot (ids are new after discard, content equal)
    const disc = await s.api.post('/api/admin/menu/draft/discard');
    assert.equal(disc.data.categories[0].nameEn, 'Salads'); assert.equal(disc.data.categories[0].items[0].descriptionEn, 'tomatoes');
    assert.equal((await s.api.get('/api/admin/menu')).data.hasUnpublishedChanges, false);
    assert.ok(d);
  } finally { await s.close(); }
});

test('menu: old snapshot without En falls back; draft with En only is an unpublished change', async () => {
  const s = await loggedIn();
  try {
    s.db.prepare('INSERT INTO menu_versions(snapshot_json, published_at) VALUES (?, ?)').run(
      JSON.stringify([{ id: 1, name: 'Супи', items: [{ id: 1, name: 'Таратор', description: 'студена', priceCents: 400, available: true }] }]), 1);
    const en = (await pub(s, 'menu?lang=en')).data;
    assert.deepEqual([en.structured.categories[0].name, en.structured.categories[0].items[0].name, en.structured.categories[0].items[0].description], ['Супи', 'Таратор', 'студена']);
    // draft = same content as old snapshot, plus an English name
    const body = { categories: [{ name: 'Супи', nameEn: 'Soups', items: [{ name: 'Таратор', description: 'студена', priceCents: 400 }] }] };
    await s.api.put('/api/admin/menu/draft', body);
    assert.equal((await s.api.get('/api/admin/menu')).data.hasUnpublishedChanges, true);
    await s.api.post('/api/admin/menu/publish');
    assert.equal((await pub(s, 'menu?lang=en')).data.structured.categories[0].name, 'Soups');
    assert.equal((await pub(s, 'menu')).data.structured.categories[0].name, 'Супи');
  } finally { await s.close(); }
});

test('menu En validation: limits, types, CRLF, auth/CSRF', async () => {
  const s = await loggedIn();
  try {
    const bad = await s.api.put('/api/admin/menu/draft', { categories: [
      { name: 'A', nameEn: 'x'.repeat(101), items: [{ name: 'i', nameEn: 'y'.repeat(101), descriptionEn: 'z'.repeat(501), priceCents: 1 }, { name: 'j', nameEn: 7, priceCents: 1 }] },
    ] });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.data.fields).sort(), [
      'categories[0].items[0].descriptionEn', 'categories[0].items[0].nameEn', 'categories[0].items[1].nameEn', 'categories[0].nameEn']);
    const ok = await s.api.put('/api/admin/menu/draft', { categories: [
      { name: 'A', nameEn: 'x'.repeat(100), items: [{ name: 'i', nameEn: 'y'.repeat(100), descriptionEn: `  ${'z\r\n'.repeat(249)}z  `, priceCents: 1 }] },
    ] });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.categories[0].items[0].descriptionEn, `${'z\n'.repeat(249)}z`);
    assert.equal((await s.client().put('/api/admin/menu/draft', { categories: [] })).status, 401);
    assert.equal((await s.api.req('PUT', '/api/admin/menu/draft', { csrf: false, json: { categories: [] } })).status, 403);
    assert.equal((await s.api.req('POST', '/api/admin/menu/publish', { csrf: false })).status, 403);
  } finally { await s.close(); }
});

test('public endpoints: invalid lang is 400 validation; daily-menu returns lang', async () => {
  const s = await startApp();
  try {
    for (const p of ['site', 'events', 'menu', 'daily-menu']) {
      for (const bad of ['fr', 'EN', '', 'en,bg']) {
        const r = await pub(s, `${p}?lang=${encodeURIComponent(bad)}`);
        assert.equal(r.status, 400, `${p} lang=${bad}`);
        assert.equal(r.data.error, 'validation'); assert.ok(r.data.fields.lang);
      }
      assert.equal((await pub(s, `${p}?lang=en&lang=bg`)).status, 400); // repeated param
      assert.equal((await pub(s, `${p}?lang=en`)).status, 200);
    }
    assert.equal((await pub(s, 'daily-menu')).data.lang, 'bg');
    assert.equal((await pub(s, 'daily-menu?lang=en')).data.lang, 'en');
    assert.equal((await pub(s, 'menu?lang=en')).data.lang, 'en');
  } finally { await s.close(); }
});

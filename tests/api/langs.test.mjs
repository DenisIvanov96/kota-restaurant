// T-35 owner feedback round 2 (D-39..D-42): separate BG / EN content, bidirectional fallback, per-language files,
// /media visibility for EN files, upload validation on imageEn/fileEn, auth/CSRF on changed routes, migration 005.
// Port 3204. Base time 2026-06-15T10:00:00Z = Monday 13:00 in Sofia (UTC+3).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PDF, JPG, WEBP, ROOT } from '../lib/harness.mjs';

const PORT = 3204;
const T0 = '2026-06-15T10:00:00Z';
const TODAY = '2026-06-15';
const png = (c) => makePng(30, 20, c);
const BG_IMG = png([200, 30, 30]); const EN_IMG = png([30, 30, 200]); const BG_IMG2 = png([30, 200, 30]); const EN_IMG2 = png([200, 200, 30]);
const BG_PDF = Buffer.concat([PDF, Buffer.from('%bg\n')]); const EN_PDF = Buffer.concat([PDF, Buffer.from('%en\n')]);
const f = (field, buf, name, type) => ({ field, buf, name, type });
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** multipart with any number of files */
function multi(fields, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, String(v));
  for (const x of files) fd.append(x.field, new Blob([x.buf], { type: x.type ?? '' }), x.name);
  return fd;
}

describe('separate BG/EN content (D-39..D-42)', () => {
  let dir; let srv; let admin; let anon;
  const uploads = () => fs.readdirSync(path.join(dir, 'uploads')).sort();
  const nUp = () => uploads().length;
  async function restartAt(iso) { await srv.stop(); srv = await startServer({ port: PORT, dataDir: dir, now: iso }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); }
  const pubEv = async (lang) => (await anon.get(`/api/public/events?lang=${lang}`)).data.events;
  const pubDaily = async (lang) => (await anon.get(`/api/public/daily-menu?lang=${lang}`)).data.menu;
  const pubMenu = async (lang) => (await anon.get(`/api/public/menu?lang=${lang}`)).data;
  const media = async (url, lang) => anon.get(lang ? `${url}?lang=${lang}` : url);
  const same = (r, buf) => r.status === 200 && Buffer.compare(r.buf, buf) === 0;
  const mkEv = async (fields, files = []) => { const r = await admin.post('/api/admin/events', { form: multi(fields, files) }); assert.equal(r.status, 201, r.text()); return r.data; };
  const mkDaily = async (fields, files = []) => { const r = await admin.post('/api/admin/daily-menus', { form: multi(fields, files) }); assert.ok([200, 201].includes(r.status), r.text()); return r.data; };

  before(async () => { dir = tmpDir('langs'); dirs.push(dir); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); });
  after(async () => { await srv.stop(); });

  // =============================================================== EVENTS (D-39)
  let ev1;
  test('LE1 event with BG+EN title/description/image: admin object has imageEnUrl; public bg = BG text+image, en = EN text+image; /media serves the right bytes', async () => {
    ev1 = await mkEv({ title: 'Джаз вечер', titleEn: 'Jazz night', description: 'Жива музика', descriptionEn: 'Live music', enabled: 'true', eventAt: '2026-06-20T20:00' },
      [f('image', BG_IMG, 'bg.png', 'image/png'), f('imageEn', EN_IMG, 'en.png', 'image/png')]);
    assert.match(ev1.imageUrl, /^\/api\/admin\/media\/[a-f0-9]{32}\.png$/); assert.match(ev1.imageEnUrl, /^\/api\/admin\/media\/[a-f0-9]{32}\.png$/);
    assert.notEqual(ev1.imageUrl, ev1.imageEnUrl);
    const bg = (await pubEv('bg')).find((e) => e.title === 'Джаз вечер'); const en = (await pubEv('en')).find((e) => e.title === 'Jazz night');
    assert.ok(bg && en); assert.equal(bg.description, 'Жива музика'); assert.equal(en.description, 'Live music');
    assert.notEqual(bg.imageUrl, en.imageUrl);
    assert.ok(same(await media(bg.imageUrl), BG_IMG), 'bg image bytes'); assert.ok(same(await media(en.imageUrl), EN_IMG), 'en image bytes');
    assert.equal((await media(en.imageUrl)).headers.get('content-type'), 'image/png');
    // admin media of both
    assert.ok(same(await admin.get(ev1.imageEnUrl), EN_IMG));
  });
  test('LE2 public events JSON never leaks admin-only keys (titleEn/imageEnUrl/admin media path)', async () => {
    for (const l of ['bg', 'en']) {
      const raw = (await anon.get(`/api/public/events?lang=${l}`)).text();
      assert.doesNotMatch(raw, /titleEn|descriptionEn|imageEnUrl|\/api\/admin\//);
    }
    await admin.del(`/api/admin/events/${ev1.id}`); assert.equal(nUp(), 0, 'deleting the event removed both language files');
  });
  test('LE3 fallback matrix: EN-only event (no BG title/description/image) is visible in BG mode with EN text and EN image; BG-only event visible in EN mode', async () => {
    const enOnly = await mkEv({ title: '', titleEn: 'English only', descriptionEn: 'Only english text', enabled: 'true' }, [f('imageEn', EN_IMG2, 'e.png', 'image/png')]);
    assert.equal(enOnly.title, ''); assert.equal(enOnly.imageUrl, null); assert.ok(enOnly.imageEnUrl);
    const bgOnly = await mkEv({ title: 'Само български', description: 'Само БГ описание', enabled: 'true' }, [f('image', BG_IMG2, 'b.png', 'image/png')]);
    assert.equal(bgOnly.titleEn, ''); assert.equal(bgOnly.imageEnUrl, null);
    const inBg = (await pubEv('bg')).find((e) => e.title === 'English only'); assert.ok(inBg, 'EN-only event visible in bg');
    assert.equal(inBg.description, 'Only english text'); assert.ok(same(await media(inBg.imageUrl), EN_IMG2), 'EN image used as fallback in bg');
    const inEn = (await pubEv('en')).find((e) => e.title === 'Само български'); assert.ok(inEn, 'BG-only event visible in en');
    assert.equal(inEn.description, 'Само БГ описание'); assert.ok(same(await media(inEn.imageUrl), BG_IMG2), 'BG image used as fallback in en');
    // default language (no ?lang) is bg
    assert.ok((await anon.get('/api/public/events')).data.events.some((e) => e.title === 'English only'));
    // per-field fallback: EN title but no EN description -> BG description
    const mixed = await mkEv({ title: 'Смесено', titleEn: 'Mixed', description: 'само бг оп', enabled: 'true' });
    const m = (await pubEv('en')).find((e) => e.title === 'Mixed'); assert.equal(m.description, 'само бг оп');
    const m2 = (await pubEv('bg')).find((e) => e.title === 'Смесено'); assert.equal(m2.description, 'само бг оп');
    for (const e of [enOnly, bgOnly, mixed]) await admin.del(`/api/admin/events/${e.id}`);
  });
  test('LE4 title required in at least one language: both empty / whitespace -> 400 fields.title; only EN or only BG -> 201; PUT that empties the last title -> 400, row unchanged', async () => {
    const n0 = nUp();
    for (const body of [{ title: '', titleEn: '' }, { title: '   ', titleEn: '  ' }, { description: 'x' }]) {
      const r = await admin.post('/api/admin/events', { form: multi({ enabled: 'false', ...body }, [f('imageEn', EN_IMG, 'e.png', 'image/png')]) });
      assert.equal(r.status, 400, JSON.stringify(body)); assert.ok(r.data.fields.title, 'error on fields.title');
    }
    assert.equal(nUp(), n0, 'no orphan file after rejected create');
    const a = await mkEv({ titleEn: 'EN title only', enabled: 'false' }); assert.equal(a.title, '');
    const b = await mkEv({ title: 'Само БГ заглавие', enabled: 'false' });
    let r = await admin.put(`/api/admin/events/${a.id}`, { form: multi({ titleEn: '' }) });
    assert.equal(r.status, 400); assert.ok(r.data.fields.title);
    assert.equal((await admin.get('/api/admin/events')).data.events.find((e) => e.id === a.id).titleEn, 'EN title only');
    r = await admin.put(`/api/admin/events/${b.id}`, { form: multi({ title: '', titleEn: 'Now EN' }) }); assert.equal(r.status, 200); assert.equal(r.data.title, ''); assert.equal(r.data.titleEn, 'Now EN');
    r = await admin.put(`/api/admin/events/${b.id}`, { json: { title: '', titleEn: '' } }); assert.equal(r.status, 400);
    r = await admin.put(`/api/admin/events/${b.id}`, { form: multi({ title: 'a'.repeat(121) }) }); assert.equal(r.status, 400); assert.ok(r.data.fields.title);
    r = await admin.put(`/api/admin/events/${b.id}`, { form: multi({ titleEn: 'a'.repeat(121) }) }); assert.equal(r.status, 400); assert.ok(r.data.fields.titleEn);
    for (const e of [a, b]) await admin.del(`/api/admin/events/${e.id}`);
  });
  test('LE5 PUT: replace imageEn deletes the old EN file; removeImageEn deletes it; BG image untouched; delete event removes both files; no orphans', async () => {
    const n0 = nUp();
    const e = await mkEv({ title: 'Файлове', titleEn: 'Files', enabled: 'true' }, [f('image', BG_IMG, 'a.png', 'image/png'), f('imageEn', EN_IMG, 'b.png', 'image/png')]);
    assert.equal(nUp(), n0 + 2);
    const oldEn = e.imageEnUrl; const bgUrl = e.imageUrl;
    let r = await admin.put(`/api/admin/events/${e.id}`, { form: multi({}, [f('imageEn', EN_IMG2, 'c.png', 'image/png')]) });
    assert.equal(r.status, 200); assert.notEqual(r.data.imageEnUrl, oldEn); assert.equal(r.data.imageUrl, bgUrl, 'BG image untouched');
    assert.equal((await admin.get(oldEn)).status, 404, 'old EN file deleted'); assert.equal(nUp(), n0 + 2);
    assert.ok(same(await admin.get(r.data.imageEnUrl), EN_IMG2));
    r = await admin.put(`/api/admin/events/${e.id}`, { form: multi({ removeImageEn: 'true' }) });
    assert.equal(r.status, 200); assert.equal(r.data.imageEnUrl, null); assert.equal(r.data.imageUrl, bgUrl); assert.equal(nUp(), n0 + 1);
    // removeImage (BG) leaves EN alone
    r = await admin.put(`/api/admin/events/${e.id}`, { form: multi({}, [f('imageEn', EN_IMG, 'b.png', 'image/png')]) }); assert.equal(r.status, 200);
    const enUrl = r.data.imageEnUrl;
    r = await admin.put(`/api/admin/events/${e.id}`, { form: multi({ removeImage: 'true' }) });
    assert.equal(r.status, 200); assert.equal(r.data.imageUrl, null); assert.equal(r.data.imageEnUrl, enUrl); assert.equal(nUp(), n0 + 1);
    // a PUT that does not mention either image keeps both
    r = await admin.put(`/api/admin/events/${e.id}`, { form: multi({ titleEn: 'Files 2' }) }); assert.equal(r.data.imageEnUrl, enUrl);
    // new image + removeImageEn in the same request: the upload wins
    r = await admin.put(`/api/admin/events/${e.id}`, { form: multi({ removeImageEn: 'true' }, [f('imageEn', EN_IMG2, 'c.png', 'image/png')]) });
    assert.equal(r.status, 200); assert.ok(r.data.imageEnUrl); assert.equal(nUp(), n0 + 1);
    assert.equal((await admin.del(`/api/admin/events/${e.id}`)).status, 204);
    assert.equal(nUp(), n0, 'delete removed both files');
    // both images on one request
    const e2 = await mkEv({ title: 'Два', enabled: 'false' }, [f('image', BG_IMG, 'a.png', 'image/png'), f('imageEn', EN_IMG, 'b.png', 'image/png')]);
    await admin.del(`/api/admin/events/${e2.id}`); assert.equal(nUp(), n0);
  });
  test('LE6 same bytes uploaded as image and imageEn become two independent files (deleting one language does not break the other)', async () => {
    const e = await mkEv({ title: 'Еднакви', enabled: 'true' }, [f('image', BG_IMG, 'a.png', 'image/png'), f('imageEn', BG_IMG, 'a.png', 'image/png')]);
    assert.notEqual(e.imageUrl, e.imageEnUrl);
    await admin.put(`/api/admin/events/${e.id}`, { form: multi({ removeImageEn: 'true' }) });
    const pub = (await pubEv('bg')).find((x) => x.title === 'Еднакви');
    assert.ok(same(await media(pub.imageUrl), BG_IMG));
    await admin.del(`/api/admin/events/${e.id}`);
  });

  // =============================================================== /media VISIBILITY of EN event images (D-42)
  test('LM1 EN event image follows event visibility in both languages: public -> 200; disabled -> 404; re-enabled -> 200; future start -> 404; expired (time travel) -> 404', async () => {
    const e = await mkEv({ title: 'Видимост', titleEn: 'Visibility', enabled: 'true' }, [f('image', BG_IMG, 'a.png', 'image/png'), f('imageEn', EN_IMG, 'b.png', 'image/png')]);
    const urls = (await pubEv('en')).filter((x) => x.title === 'Visibility').map((x) => x.imageUrl).concat((await pubEv('bg')).filter((x) => x.title === 'Видимост').map((x) => x.imageUrl));
    assert.equal(urls.length, 2); const [enU, bgU] = urls;
    for (const l of [undefined, 'bg', 'en']) { assert.equal((await media(enU, l)).status, 200); assert.equal((await media(bgU, l)).status, 200); }
    await admin.patch(`/api/admin/events/${e.id}/enabled`, { json: { enabled: false } });
    for (const l of [undefined, 'bg', 'en']) { assert.equal((await media(enU, l)).status, 404, `disabled EN ${l}`); assert.equal((await media(bgU, l)).status, 404, `disabled BG ${l}`); }
    assert.equal((await admin.get(e.imageEnUrl)).status, 200, 'admin can still preview the EN image');
    await admin.patch(`/api/admin/events/${e.id}/enabled`, { json: { enabled: true } });
    assert.equal((await media(enU)).status, 200);
    // future start
    await admin.put(`/api/admin/events/${e.id}`, { form: multi({ startsAt: '2026-06-16T10:00' }) });
    assert.equal((await media(enU)).status, 404, 'not started yet'); assert.equal((await media(bgU)).status, 404);
    // expiry window ends 2026-06-15T18:00 Sofia (15:00Z)
    await admin.put(`/api/admin/events/${e.id}`, { form: multi({ startsAt: '', expiresAt: '2026-06-15T18:00' }) });
    assert.equal((await media(enU)).status, 200);
    await restartAt('2026-06-15T16:00:00Z');
    assert.equal((await media(enU)).status, 404, 'expired EN image'); assert.equal((await media(bgU)).status, 404, 'expired BG image');
    assert.ok(!(await pubEv('en')).some((x) => x.title === 'Visibility'));
    await restartAt(T0);
    await admin.del(`/api/admin/events/${e.id}`);
  });

  // =============================================================== DAILY MENU (D-41)
  test('LD1 daily menu with BG + EN files: public bg -> BG file, en -> EN file (kind/mime ok); admin object has fileEn* fields; /media serves the exact bytes', async () => {
    const m = await mkDaily({ date: TODAY, published: 'true' }, [f('file', BG_PDF, 'bg.pdf', 'application/pdf'), f('fileEn', EN_IMG, 'en.png', 'image/png')]);
    assert.equal(m.kind, 'pdf'); assert.equal(m.kindEn, 'image'); assert.equal(m.originalNameEn, 'en.png'); assert.equal(m.mimeTypeEn, 'image/png'); assert.equal(m.sizeBytesEn, EN_IMG.length); assert.match(m.fileEnUrl, /^\/api\/admin\/media\//);
    const bg = await pubDaily('bg'); const en = await pubDaily('en');
    assert.equal(bg.kind, 'pdf'); assert.equal(en.kind, 'image'); assert.notEqual(bg.fileUrl, en.fileUrl);
    assert.ok(same(await media(bg.fileUrl), BG_PDF)); assert.ok(same(await media(en.fileUrl), EN_IMG));
    assert.equal((await media(en.fileUrl)).headers.get('content-type'), 'image/png');
    assert.equal((await anon.get('/api/public/daily-menu')).data.menu.fileUrl, bg.fileUrl, 'default language is bg');
    assert.doesNotMatch((await anon.get('/api/public/daily-menu?lang=en')).text(), /fileEnUrl|originalName|\/api\/admin\//);
    assert.ok(same(await admin.get(m.fileEnUrl), EN_IMG));
  });
  test('LD2 PUT removeFileEn -> EN visitors fall back to BG, EN file deleted from disk; PUT fileEn adds it again; PUT file (BG) replacement keeps EN', async () => {
    const m = (await admin.get('/api/admin/daily-menus')).data.menus[0]; const n0 = nUp();
    let r = await admin.put(`/api/admin/daily-menus/${m.id}`, { form: multi({ removeFileEn: 'true' }) });
    assert.equal(r.status, 200); assert.equal(r.data.fileEnUrl, null); assert.equal(r.data.mimeTypeEn, null); assert.equal(nUp(), n0 - 1);
    assert.equal((await admin.get(m.fileEnUrl)).status, 404);
    assert.equal((await pubDaily('en')).fileUrl, (await pubDaily('bg')).fileUrl, 'EN falls back to BG');
    assert.equal((await media(m.fileEnUrl.replace('/api/admin', ''))).status, 404);
    r = await admin.put(`/api/admin/daily-menus/${m.id}`, { form: multi({}, [f('fileEn', EN_PDF, 'en.pdf', 'application/pdf')]) });
    assert.equal(r.status, 200); assert.equal(r.data.kindEn, 'pdf'); assert.equal(nUp(), n0);
    assert.ok(same(await media((await pubDaily('en')).fileUrl), EN_PDF));
    const enUrl = r.data.fileEnUrl;
    r = await admin.put(`/api/admin/daily-menus/${m.id}`, { form: multi({}, [f('file', png([1, 2, 3]), 'bg2.png', 'image/png')]) });
    assert.equal(r.status, 200); assert.equal(r.data.kind, 'image'); assert.equal(r.data.fileEnUrl, enUrl, 'EN file kept'); assert.equal(nUp(), n0);
    r = await admin.put(`/api/admin/daily-menus/${m.id}`, { form: multi({ removeFileEn: 'true' }, [f('fileEn', EN_IMG2, 'x.png', 'image/png')]) });
    assert.equal(r.status, 200); assert.ok(r.data.fileEnUrl, 'upload wins over remove'); assert.equal(nUp(), n0);
  });
  test('LD3 EN-only daily menu is allowed, visible in BG mode through fallback; BG file fields null; cannot remove the only file; neither file -> 400', async () => {
    const m0 = (await admin.get('/api/admin/daily-menus')).data.menus[0];
    await admin.del(`/api/admin/daily-menus/${m0.id}`);
    const n0 = nUp();
    let r = await admin.post('/api/admin/daily-menus', { form: multi({ date: TODAY, published: 'true' }) });
    assert.equal(r.status, 400); assert.ok(r.data.fields.file, 'no file at all -> fields.file');
    const m = await mkDaily({ date: TODAY, published: 'true' }, [f('fileEn', EN_PDF, 'only-en.pdf', 'application/pdf')]);
    assert.equal(m.fileUrl, null); assert.equal(m.kind, null); assert.equal(m.originalName, null); assert.equal(m.sizeBytes, null); assert.equal(m.mimeType, null); assert.ok(m.fileEnUrl);
    for (const l of ['bg', 'en']) { const p = await pubDaily(l); assert.ok(p, `visible in ${l}`); assert.ok(same(await media(p.fileUrl), EN_PDF), `serves the EN file in ${l}`); }
    r = await admin.put(`/api/admin/daily-menus/${m.id}`, { form: multi({ removeFileEn: 'true' }) });
    assert.equal(r.status, 400); assert.ok(r.data.fields.fileEn, 'fields.fileEn'); assert.equal(nUp(), n0 + 1, 'file kept');
    assert.ok(await pubDaily('en'), 'menu unchanged after rejected removal');
    // removing EN while uploading a BG file in the same request is fine
    r = await admin.put(`/api/admin/daily-menus/${m.id}`, { form: multi({ removeFileEn: 'true' }, [f('file', BG_PDF, 'bg.pdf', 'application/pdf')]) });
    assert.equal(r.status, 200); assert.equal(r.data.fileEnUrl, null); assert.ok(r.data.fileUrl); assert.equal(nUp(), n0 + 1);
    // BG-only: EN visitors fall back to BG
    assert.ok(same(await media((await pubDaily('en')).fileUrl), BG_PDF));
    await admin.del(`/api/admin/daily-menus/${m.id}`); assert.equal(nUp(), n0 - 0 - 0 + 0 - 0, 'all files of the menu deleted');
  });
  test('LD4 POST replace=true replaces BOTH languages (old files deleted, language not re-sent becomes empty); conflict without replace -> 409 date_exists', async () => {
    const n0 = nUp();
    const a = await mkDaily({ date: '2026-06-17', published: 'false' }, [f('file', BG_PDF, 'a.pdf', 'application/pdf'), f('fileEn', EN_PDF, 'b.pdf', 'application/pdf')]);
    assert.equal(nUp(), n0 + 2);
    let r = await admin.post('/api/admin/daily-menus', { form: multi({ date: '2026-06-17' }, [f('fileEn', EN_IMG, 'c.png', 'image/png')]) });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'date_exists'); assert.equal(nUp(), n0 + 2, 'rejected conflict left no orphan');
    r = await admin.post('/api/admin/daily-menus', { form: multi({ date: '2026-06-17', replace: 'true', published: 'true' }, [f('fileEn', EN_IMG, 'c.png', 'image/png')]) });
    assert.equal(r.status, 200); assert.equal(r.data.id, a.id); assert.equal(r.data.fileUrl, null); assert.ok(r.data.fileEnUrl); assert.equal(r.data.published, true); assert.equal(nUp(), n0 + 1);
    assert.equal((await admin.get(a.fileUrl)).status, 404); assert.equal((await admin.get(a.fileEnUrl)).status, 404);
    // PUT can change date and keeps both files; date clash -> 409
    const b = await mkDaily({ date: '2026-06-18' }, [f('file', BG_PDF, 'a.pdf', 'application/pdf')]);
    r = await admin.put(`/api/admin/daily-menus/${b.id}`, { form: multi({ date: '2026-06-17' }) }); assert.equal(r.status, 409);
    for (const x of [a, b]) await admin.del(`/api/admin/daily-menus/${x.id}`);
    assert.equal(nUp(), n0);
  });
  test('LD5 /media visibility of EN daily file: published today -> 200 (bg and en query); unpublished -> 404; date tomorrow -> 404; today then time-travel to tomorrow -> 404', async () => {
    const m = await mkDaily({ date: TODAY, published: 'true' }, [f('file', BG_PDF, 'bg.pdf', 'application/pdf'), f('fileEn', EN_IMG, 'en.png', 'image/png')]);
    const bgU = m.fileUrl.replace('/api/admin', ''); const enU = m.fileEnUrl.replace('/api/admin', '');
    for (const l of [undefined, 'bg', 'en']) { assert.equal((await media(bgU, l)).status, 200); assert.equal((await media(enU, l)).status, 200); }
    await admin.patch(`/api/admin/daily-menus/${m.id}/published`, { json: { published: false } });
    for (const l of [undefined, 'bg', 'en']) { assert.equal((await media(bgU, l)).status, 404, `unpublished BG ${l}`); assert.equal((await media(enU, l)).status, 404, `unpublished EN ${l}`); }
    assert.equal(await pubDaily('en'), null); assert.equal(await pubDaily('bg'), null);
    await admin.patch(`/api/admin/daily-menus/${m.id}/published`, { json: { published: true } });
    assert.equal((await media(enU)).status, 200);
    let r = await admin.put(`/api/admin/daily-menus/${m.id}`, { form: multi({ date: '2026-06-16' }) });
    assert.equal(r.status, 200);
    assert.equal((await media(enU, 'en')).status, 404, 'tomorrow EN'); assert.equal((await media(bgU, 'bg')).status, 404, 'tomorrow BG');
    r = await admin.put(`/api/admin/daily-menus/${m.id}`, { form: multi({ date: TODAY }) }); assert.equal(r.status, 200);
    assert.equal((await media(enU)).status, 200);
    await restartAt('2026-06-15T21:30:00Z'); // 00:30 on 16 June in Sofia -> today is the 16th
    assert.equal((await media(enU)).status, 404, 'yesterday EN after Sofia midnight'); assert.equal((await media(bgU)).status, 404, 'yesterday BG');
    assert.equal(await pubDaily('en'), null);
    await restartAt(T0);
    assert.equal((await media(enU)).status, 200, 'visible again on its date');
    await admin.del(`/api/admin/daily-menus/${m.id}`);
    assert.equal((await media(enU)).status, 404);
  });

  // =============================================================== MENU PAGES per language (D-40, rewritten for D-46 in T-43)
  const pagesOf = async () => (await admin.get('/api/admin/menu')).data.pages;
  const pubUrl = (adminUrl) => adminUrl.replace('/api/admin', '');
  test('LF1 menu pages carry lang (default bg); invalid lang -> 400 fields.lang, no orphan; list returns pages.<lang>.items', async () => {
    const n0 = nUp();
    let r = await admin.post('/api/admin/menu/pages', { form: multi({}, [f('file', BG_IMG, 'bg.png', 'image/png')]) });
    assert.equal(r.status, 201); assert.equal(r.data.lang, 'bg'); assert.equal(r.data.position, 1);
    r = await admin.post('/api/admin/menu/pages', { form: multi({ lang: 'en' }, [f('file', EN_IMG, 'en.png', 'image/png')]) });
    assert.equal(r.status, 201); assert.equal(r.data.lang, 'en'); assert.equal(r.data.position, 1, 'positions are per language');
    for (const bad of ['fr', 'EN', '', 'bg,en', '<script>']) {
      r = await admin.post('/api/admin/menu/pages', { form: multi({ lang: bad }, [f('file', EN_IMG, 'x.png', 'image/png')]) });
      assert.equal(r.status, 400, `lang=${JSON.stringify(bad)}`); assert.ok(r.data.fields.lang);
    }
    assert.equal(nUp(), n0 + 2, 'rejected uploads left no files');
    const pg = await pagesOf();
    assert.deepEqual([pg.bg.items.length, pg.en.items.length], [1, 1]); assert.equal(pg.bg.items[0].lang, 'bg'); assert.equal(pg.en.items[0].lang, 'en');
    assert.deepEqual([pg.bg.published, pg.en.published], [false, false]);
  });
  test('LF2 file mode with pages: EN visitor gets EN set, BG gets BG; flags are per language; fallback when one is missing; in_use only for the last live language', async () => {
    let pg = await pagesOf(); const bgF = pg.bg.items[0]; const enF = pg.en.items[0];
    // nothing published -> switching to file mode refused
    let r = await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } }); assert.equal(r.status, 409); assert.equal(r.data.error, 'nothing_published');
    // publish only EN: file mode becomes possible; BG visitors fall back to EN
    r = await admin.put('/api/admin/menu/pages/published', { json: { lang: 'en', published: true } }); assert.equal(r.status, 200); assert.equal(r.data.published, true);
    r = await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } }); assert.equal(r.status, 200, 'EN-only published set is enough for file mode');
    let p = await pubMenu('bg'); assert.equal(p.mode, 'file'); assert.equal(p.file.lang, 'en'); assert.ok(same(await media(p.file.pages[0].fileUrl), EN_IMG), 'bg visitor falls back to the EN pages');
    p = await pubMenu('en'); assert.equal(p.file.lang, 'en'); assert.ok(same(await media(p.file.pages[0].fileUrl), EN_IMG));
    // publish BG too: both stay published
    r = await admin.put('/api/admin/menu/pages/published', { json: { lang: 'bg', published: true } }); assert.equal(r.status, 200);
    pg = await pagesOf(); assert.deepEqual([pg.bg.published, pg.en.published], [true, true], 'publishing BG does not unpublish EN');
    p = await pubMenu('bg'); assert.equal(p.file.lang, 'bg'); assert.ok(same(await media(p.file.pages[0].fileUrl), BG_IMG), 'bg visitor gets BG page');
    p = await pubMenu('en'); assert.ok(same(await media(p.file.pages[0].fileUrl), EN_IMG), 'en visitor gets EN page');
    assert.doesNotMatch(JSON.stringify(await pubMenu('en')), /originalName|\/api\/admin\/|sizeBytes/);
    // a second BG page is appended and is live immediately (the set is published as a whole)
    r = await admin.post('/api/admin/menu/pages', { form: multi({ lang: 'bg' }, [f('file', BG_IMG2, 'bg2.png', 'image/png')]) }); const bg2 = r.data; assert.equal(bg2.position, 2);
    p = await pubMenu('bg'); assert.equal(p.file.pages.length, 2); assert.ok(same(await media(p.file.pages[0].fileUrl), BG_IMG)); assert.ok(same(await media(p.file.pages[1].fileUrl), BG_IMG2));
    assert.equal((await pubMenu('en')).file.pages.length, 1, 'the EN set is untouched');
    // unpublish EN while BG remains live: allowed; EN visitors fall back to BG; EN page hidden
    r = await admin.put('/api/admin/menu/pages/published', { json: { lang: 'en', published: false } }); assert.equal(r.status, 200, 'EN unpublished while BG remains');
    p = await pubMenu('en'); assert.equal(p.file.lang, 'bg'); assert.equal(p.file.pages.length, 2); assert.ok(same(await media(p.file.pages[1].fileUrl), BG_IMG2), 'EN visitor falls back to the BG set');
    assert.equal((await media(pubUrl(enF.fileUrl))).status, 404, 'unpublished EN page hidden');
    // in_use: the last live language is protected (unpublish, delete of its last page)
    r = await admin.put('/api/admin/menu/pages/published', { json: { lang: 'bg', published: false } }); assert.equal(r.status, 409); assert.equal(r.data.error, 'in_use');
    assert.equal((await admin.del(`/api/admin/menu/pages/${bg2.id}`)).status, 204, 'a non-last page of the live set may be deleted');
    r = await admin.del(`/api/admin/menu/pages/${bgF.id}`); assert.equal(r.status, 409); assert.equal(r.data.error, 'in_use');
    // publish EN again; now the last BG page may go
    await admin.put('/api/admin/menu/pages/published', { json: { lang: 'en', published: true } });
    r = await admin.del(`/api/admin/menu/pages/${bgF.id}`); assert.equal(r.status, 204, 'not the only live language');
    p = await pubMenu('bg'); assert.equal(p.file.lang, 'en'); assert.ok(same(await media(p.file.pages[0].fileUrl), EN_IMG), 'BG visitor falls back to EN after BG pages are gone');
    r = await admin.del(`/api/admin/menu/pages/${enF.id}`); assert.equal(r.status, 409, 'last page of the only live language is in use');
    // switching back to structured frees it (needs a published structured menu)
    await admin.put('/api/admin/menu/draft', { json: { categories: [{ name: 'Кат', nameEn: 'Cat', items: [{ name: 'Я', nameEn: 'D', description: '', descriptionEn: '', priceCents: 100, available: true }] }] } });
    assert.equal((await admin.post('/api/admin/menu/publish')).status, 200);
    r = await admin.put('/api/admin/menu/mode', { json: { mode: 'structured' } }); assert.equal(r.status, 200);
    assert.equal((await media(pubUrl(enF.fileUrl))).status, 404, 'structured mode: no page is public');
    assert.equal((await pubMenu('en')).file, null);
    r = await admin.del(`/api/admin/menu/pages/${enF.id}`); assert.equal(r.status, 204);
    assert.equal(nUp(), 0, 'deleted pages left no files');
  });
  test('LF3 old per-file endpoints are gone (404); dashboard reports menu.pages counts/flags and no publishedFile(s); no orphans', async () => {
    // flags survive deleting all pages of a language (a flag may be set on an empty language); start from a known state
    for (const l of ['bg', 'en']) await admin.put('/api/admin/menu/pages/published', { json: { lang: l, published: false } });
    const a = (await admin.post('/api/admin/menu/pages', { form: multi({ lang: 'en' }, [f('file', EN_PDF, 'only-en.pdf', 'application/pdf')]) })).data;
    const b = (await admin.post('/api/admin/menu/pages', { form: multi({ lang: 'bg' }, [f('file', BG_PDF, 'only-bg.pdf', 'application/pdf')]) })).data;
    await admin.put('/api/admin/menu/pages/published', { json: { lang: 'en', published: true } });
    let d = (await admin.get('/api/admin/dashboard')).data.menu;
    assert.deepEqual(d.pages, { bg: { published: false, count: 1 }, en: { published: true, count: 1 } });
    assert.equal(d.publishedFile, undefined); assert.equal(d.publishedFiles, undefined);
    assert.equal((await admin.post('/api/admin/menu/files', { form: multi({}, [f('file', BG_PDF, 'x.pdf', 'application/pdf')]) })).status, 404);
    assert.equal((await admin.patch(`/api/admin/menu/files/${a.id}/published`, { json: { published: true } })).status, 404);
    assert.equal((await admin.del(`/api/admin/menu/files/${a.id}`)).status, 404);
    assert.equal((await admin.get('/api/admin/menu')).data.files, undefined, 'files key removed from GET /api/admin/menu');
    await admin.put('/api/admin/menu/pages/published', { json: { lang: 'bg', published: true } });
    d = (await admin.get('/api/admin/dashboard')).data.menu; assert.deepEqual(d.pages, { bg: { published: true, count: 1 }, en: { published: true, count: 1 } });
    await admin.del(`/api/admin/menu/pages/${a.id}`); await admin.del(`/api/admin/menu/pages/${b.id}`);
    assert.equal(nUp(), 0, 'every uploaded file of every earlier test is gone (no orphans)');
  });

  // =============================================================== STRUCTURED MENU (D-40)
  const it = (name, nameEn, extra = {}) => ({ name, nameEn, description: '', descriptionEn: '', priceCents: 500, available: true, ...extra });
  test('LS1 names required in >=1 language (category and dish); one-language names saved; whitespace-only both -> 400 on .name key', async () => {
    const put = (categories) => admin.put('/api/admin/menu/draft', { json: { categories } });
    let r = await put([{ name: '', nameEn: '', items: [] }]); assert.equal(r.status, 400); assert.ok(r.data.fields['categories[0].name']);
    r = await put([{ name: ' ', nameEn: '  ', items: [] }]); assert.equal(r.status, 400);
    r = await put([{ name: 'Кат', items: [it('', '')] }]); assert.equal(r.status, 400); assert.ok(r.data.fields['categories[0].items[0].name']);
    r = await put([{ name: 'a'.repeat(101), nameEn: 'x', items: [] }]); assert.equal(r.status, 400); assert.ok(r.data.fields['categories[0].name']);
    r = await put([{ name: '', nameEn: 'Only EN category', items: [it('', 'Only EN dish', { descriptionEn: 'en desc' }), it('Само БГ ястие', '', { description: 'бг описание' }), it('Двуезично', 'Bilingual', { description: 'бг оп', descriptionEn: 'en op' })] }]);
    assert.equal(r.status, 200, r.text());
  });
  test('LS2 publish; public bg/en show names with fallback in both directions; description fallback per field', async () => {
    assert.equal((await admin.post('/api/admin/menu/publish')).status, 200);
    const cat = async (l) => (await pubMenu(l)).structured.categories[0];
    const bg = await cat('bg'); const en = await cat('en');
    assert.equal(bg.name, 'Only EN category', 'BG visitor sees EN category name (BG missing)'); assert.equal(en.name, 'Only EN category');
    assert.deepEqual(bg.items.map((x) => x.name), ['Only EN dish', 'Само БГ ястие', 'Двуезично']);
    assert.deepEqual(en.items.map((x) => x.name), ['Only EN dish', 'Само БГ ястие', 'Bilingual']);
    assert.equal(bg.items[0].description, 'en desc'); assert.equal(en.items[1].description, 'бг описание'); assert.equal(bg.items[2].description, 'бг оп'); assert.equal(en.items[2].description, 'en op');
    assert.doesNotMatch(JSON.stringify(await pubMenu('en')), /nameEn|descriptionEn/);
    // admin draft round trip keeps both languages
    const d = (await admin.get('/api/admin/menu')).data.draft.categories[0];
    assert.equal(d.name, ''); assert.equal(d.nameEn, 'Only EN category'); assert.equal(d.items[0].name, ''); assert.equal(d.items[0].nameEn, 'Only EN dish'); assert.equal(d.items[1].nameEn, '');
    // draft-vs-published detection counts EN-only edits
    assert.equal((await admin.get('/api/admin/menu')).data.hasUnpublishedChanges, false);
    d.items[2].nameEn = 'Bilingual v2';
    await admin.put('/api/admin/menu/draft', { json: { categories: [d] } });
    assert.equal((await admin.get('/api/admin/menu')).data.hasUnpublishedChanges, true, 'EN-only edit is an unpublished change');
    assert.equal((await cat('en')).items[2].name, 'Bilingual', 'public still shows the published EN name');
  });
  test('LS3 dashboard activeTitles uses EN title when BG title empty', async () => {
    const e = await mkEv({ titleEn: 'Dash EN', enabled: 'true' });
    const d = (await admin.get('/api/admin/dashboard')).data;
    assert.ok(JSON.stringify(d).includes('Dash EN')); await admin.del(`/api/admin/events/${e.id}`);
  });

  // =============================================================== UPLOAD VALIDATION on imageEn / fileEn
  const BAD = [
    ['HTML renamed .png', Buffer.from('<html><script>alert(1)</script></html>'), 'x.png', 'image/png'],
    ['SVG as .svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg', 'image/svg+xml'],
    ['SVG as .png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png', 'image/png'],
    ['PDF as image (.png)', PDF, 'x.png', 'image/png'],
    ['PNG bytes renamed .html', BG_IMG, 'x.html', 'image/png'],
    ['PNG bytes with text/html MIME', BG_IMG, 'x.png', 'text/html'],
    ['PNG bytes, no extension', BG_IMG, 'noext', 'image/png'],
    ['PNG bytes named .jpg', BG_IMG, 'x.jpg', 'image/jpeg'],
    ['GIF+script polyglot', Buffer.concat([Buffer.from('GIF89a'), Buffer.from('<script>alert(1)</script>')]), 'x.png', 'image/png'],
    ['empty file', Buffer.alloc(0), 'x.png', 'image/png'],
    ['PHP', Buffer.from('<?php system($_GET[0]); ?>'), 'shell.php', 'application/x-php'],
  ];
  test('LU1 invalid imageEn on event POST and PUT -> 400/415 with fields.imageEn, even with a valid BG image in the same request; no orphans, no row, existing files untouched', async () => {
    const keep = await mkEv({ title: 'Пази', enabled: 'false' }, [f('imageEn', EN_IMG, 'k.png', 'image/png')]);
    const n0 = nUp(); const cnt0 = (await admin.get('/api/admin/events')).data.events.length;
    for (const [label, buf, name, type] of BAD) {
      let r = await admin.post('/api/admin/events', { form: multi({ title: 'bad', enabled: 'false' }, [f('image', BG_IMG, 'ok.png', 'image/png'), f('imageEn', buf, name, type)]) });
      assert.ok([400, 415].includes(r.status), `POST ${label} -> ${r.status}`); assert.ok(r.data.fields && r.data.fields.imageEn, `POST ${label} fields.imageEn`);
      r = await admin.put(`/api/admin/events/${keep.id}`, { form: multi({ title: 'changed' }, [f('image', BG_IMG, 'ok.png', 'image/png'), f('imageEn', buf, name, type)]) });
      assert.ok([400, 415].includes(r.status), `PUT ${label} -> ${r.status}`); assert.ok(r.data.fields && r.data.fields.imageEn);
    }
    assert.equal(nUp(), n0, 'no orphan files'); assert.equal((await admin.get('/api/admin/events')).data.events.length, cnt0);
    const cur = (await admin.get('/api/admin/events')).data.events.find((e) => e.id === keep.id);
    assert.equal(cur.title, 'Пази', 'PUT not applied'); assert.equal(cur.imageEnUrl, keep.imageEnUrl); assert.equal(cur.imageUrl, null);
    // PDF must not be accepted as an event image in either field
    let r = await admin.post('/api/admin/events', { form: multi({ title: 't' }, [f('imageEn', PDF, 'x.pdf', 'application/pdf')]) }); assert.equal(r.status, 415);
    // invalid BG image + valid EN image -> EN file must not be left behind
    r = await admin.post('/api/admin/events', { form: multi({ title: 't' }, [f('image', BAD[0][1], 'x.png', 'image/png'), f('imageEn', EN_IMG, 'ok.png', 'image/png')]) });
    assert.equal(r.status, 415); assert.ok(r.data.fields.image); assert.equal(nUp(), n0);
    await admin.del(`/api/admin/events/${keep.id}`);
  });
  test('LU2 accepted types for imageEn: jpg, png, webp; not pdf', async () => {
    for (const [buf, name, type] of [[JPG, 'a.jpg', 'image/jpeg'], [JPG, 'a.jpeg', 'image/jpeg'], [BG_IMG, 'a.png', 'image/png'], [WEBP, 'a.webp', 'image/webp']]) {
      const e = await mkEv({ title: name, enabled: 'false' }, [f('imageEn', buf, name, type)]); assert.ok(e.imageEnUrl, name); await admin.del(`/api/admin/events/${e.id}`);
    }
  });
  test('LU3 invalid fileEn on daily POST/PUT -> 400/415 with fields.fileEn (valid BG file in same request is discarded); no orphans, no row; valid types accepted (pdf/jpg/png/webp)', async () => {
    const keep = await mkDaily({ date: '2026-07-01' }, [f('file', BG_PDF, 'k.pdf', 'application/pdf')]);
    const n0 = nUp();
    for (const [label, buf, name, type] of BAD) {
      let r = await admin.post('/api/admin/daily-menus', { form: multi({ date: '2026-07-02' }, [f('file', BG_PDF, 'ok.pdf', 'application/pdf'), f('fileEn', buf, name, type)]) });
      assert.ok([400, 415].includes(r.status), `POST ${label} -> ${r.status}`); assert.ok(r.data.fields && r.data.fields.fileEn, `POST ${label} fields.fileEn`);
      r = await admin.put(`/api/admin/daily-menus/${keep.id}`, { form: multi({}, [f('file', BG_PDF, 'ok.pdf', 'application/pdf'), f('fileEn', buf, name, type)]) });
      assert.ok([400, 415].includes(r.status), `PUT ${label} -> ${r.status}`); assert.ok(r.data.fields && r.data.fields.fileEn);
    }
    assert.equal(nUp(), n0, 'no orphan files'); assert.equal((await admin.get('/api/admin/daily-menus')).data.menus.length, 1);
    assert.equal((await admin.get('/api/admin/daily-menus')).data.menus[0].fileEnUrl, null);
    for (const [buf, name, type] of [[BG_PDF, 'a.pdf', 'application/pdf'], [JPG, 'a.jpg', 'image/jpeg'], [BG_IMG, 'a.png', 'image/png'], [WEBP, 'a.webp', 'image/webp']]) {
      const r = await admin.put(`/api/admin/daily-menus/${keep.id}`, { form: multi({}, [f('fileEn', buf, name, type)]) }); assert.equal(r.status, 200, name);
    }
    await admin.del(`/api/admin/daily-menus/${keep.id}`); assert.equal(nUp(), 0);
  });
  test('LU4 old limits are gone (D-44): imageEn 6 MB, fileEn 11 MB and a menu page 16 MB are accepted now; the exact 50 MB boundary is tested in uploads.test.mjs; no orphans', async () => {
    const n0 = nUp();
    const edge = (mb, head) => Buffer.concat([head, Buffer.alloc(mb * 1024 * 1024 - head.length, 0)]);
    const PNGH = BG_IMG.subarray(0, 8); const PDFH = Buffer.from('%PDF-1.4\n');
    let r = await admin.post('/api/admin/events', { form: multi({ title: 'edge', enabled: 'false' }, [f('imageEn', edge(6, PNGH), 'edge.png', 'image/png')]) }); assert.equal(r.status, 201, 'imageEn 6 MB'); await admin.del(`/api/admin/events/${r.data.id}`);
    r = await admin.post('/api/admin/daily-menus', { form: multi({ date: '2026-07-03' }, [f('fileEn', edge(11, PDFH), 'edge.pdf', 'application/pdf')]) }); assert.equal(r.status, 201, 'fileEn 11 MB'); await admin.del(`/api/admin/daily-menus/${r.data.id}`);
    r = await admin.post('/api/admin/menu/pages', { form: multi({ lang: 'en' }, [f('file', edge(16, PDFH), 'edge.pdf', 'application/pdf')]) }); assert.equal(r.status, 201, 'menu page 16 MB'); await admin.del(`/api/admin/menu/pages/${r.data.id}`);
    assert.equal(nUp(), n0);
  });
  test('LU5 unknown / misplaced / duplicated file fields -> 400 bad_upload naming the field, no orphans, no rows: imageFr, fileEn on events, imageEn on daily, 2 files in imageEn, 2 files in fileEn, extra file in menu files', async () => {
    const n0 = nUp(); const ev0 = (await admin.get('/api/admin/events')).data.events.length; const dm0 = (await admin.get('/api/admin/daily-menus')).data.menus.length;
    const cases = [
      ['events imageFr', '/api/admin/events', { title: 't' }, [f('imageFr', BG_IMG, 'a.png', 'image/png')], 'imageFr'],
      ['events fileEn (daily field)', '/api/admin/events', { title: 't' }, [f('fileEn', BG_IMG, 'a.png', 'image/png')], 'fileEn'],
      ['events file', '/api/admin/events', { title: 't' }, [f('file', BG_IMG, 'a.png', 'image/png')], 'file'],
      ['events 2x imageEn', '/api/admin/events', { title: 't' }, [f('imageEn', BG_IMG, 'a.png', 'image/png'), f('imageEn', EN_IMG, 'b.png', 'image/png')], 'imageEn'],
      ['events 2x image', '/api/admin/events', { title: 't' }, [f('image', BG_IMG, 'a.png', 'image/png'), f('image', EN_IMG, 'b.png', 'image/png')], 'image'],
      ['daily imageEn (event field)', '/api/admin/daily-menus', { date: '2026-07-05' }, [f('imageEn', BG_IMG, 'a.png', 'image/png')], 'imageEn'],
      ['daily fileFr', '/api/admin/daily-menus', { date: '2026-07-05' }, [f('file', BG_PDF, 'ok.pdf', 'application/pdf'), f('fileFr', BG_IMG, 'a.png', 'image/png')], 'fileFr'],
      ['daily 2x fileEn', '/api/admin/daily-menus', { date: '2026-07-05' }, [f('fileEn', BG_IMG, 'a.png', 'image/png'), f('fileEn', EN_IMG, 'b.png', 'image/png')], 'fileEn'],
      ['menu/pages fileEn', '/api/admin/menu/pages', { lang: 'en' }, [f('fileEn', BG_IMG, 'a.png', 'image/png')], 'fileEn'], // the offending field is named (the pre-006 single() route reported 'file'; observation, not a defect)
    ];
    for (const [label, url, fields, files, field] of cases) {
      const r = await admin.post(url, { form: multi(fields, files) });
      assert.equal(r.status, 400, `${label} -> ${r.status} ${r.text().slice(0, 100)}`); assert.equal(r.data.error, 'bad_upload', label);
      assert.ok(r.data.fields && r.data.fields[field], `${label}: fields.${field}`);
    }
    // PUT too
    const e = await mkEv({ title: 'x', enabled: 'false' });
    let r = await admin.put(`/api/admin/events/${e.id}`, { form: multi({}, [f('imageFr', BG_IMG, 'a.png', 'image/png')]) }); assert.equal(r.status, 400); assert.equal(r.data.error, 'bad_upload');
    await admin.del(`/api/admin/events/${e.id}`);
    const m = await mkDaily({ date: '2026-07-06' }, [f('file', BG_PDF, 'ok.pdf', 'application/pdf')]);
    r = await admin.put(`/api/admin/daily-menus/${m.id}`, { form: multi({}, [f('fileFr', BG_IMG, 'a.png', 'image/png')]) }); assert.equal(r.status, 400); assert.equal(r.data.error, 'bad_upload');
    await admin.del(`/api/admin/daily-menus/${m.id}`);
    assert.equal(nUp(), n0, 'no orphans'); assert.equal((await admin.get('/api/admin/events')).data.events.length, ev0); assert.equal((await admin.get('/api/admin/daily-menus')).data.menus.length, dm0);
  });
  test('LU6 junk multipart bodies and JSON-without-files on the changed routes -> 4xx (never 500); only a JSON event with a title can be created (no files), nothing else created', async () => {
    for (const [method, url] of [['POST', '/api/admin/events'], ['POST', '/api/admin/daily-menus'], ['POST', '/api/admin/menu/pages']]) {
      const r = await admin.req(method, url, { raw: 'not multipart', headers: { 'content-type': 'multipart/form-data; boundary=zzz' } });
      assert.ok(r.status >= 400 && r.status < 500, `${method} ${url} junk multipart -> ${r.status}`);
    }
    for (const url of ['/api/admin/daily-menus', '/api/admin/menu/pages']) { const r = await admin.post(url, { json: { date: '2026-07-20', lang: 'en' } }); assert.ok(r.status >= 400 && r.status < 500, `JSON ${url} -> ${r.status}`); }
    assert.equal(nUp(), 0);
  });

  // =============================================================== AUTH / CSRF on changed routes
  test('LA1 changed routes: no session -> 401; session without CSRF header -> 401/403; cross-origin -> 403 csrf; state unchanged', async () => {
    const e = await mkEv({ title: 'Auth', titleEn: 'Auth EN', enabled: 'true' }, [f('imageEn', EN_IMG, 'a.png', 'image/png')]);
    const m = await mkDaily({ date: '2026-07-10' }, [f('fileEn', EN_PDF, 'a.pdf', 'application/pdf')]);
    const mf = (await admin.post('/api/admin/menu/pages', { form: multi({ lang: 'en' }, [f('file', EN_IMG, 'a.png', 'image/png')]) })).data;
    const routes = [
      ['POST', '/api/admin/events', () => multi({ title: 'evil' }, [f('imageEn', EN_IMG, 'a.png', 'image/png')])],
      ['PUT', `/api/admin/events/${e.id}`, () => multi({ titleEn: 'evil', removeImageEn: 'true' })],
      ['PATCH', `/api/admin/events/${e.id}/enabled`, null, { enabled: false }],
      ['DELETE', `/api/admin/events/${e.id}`],
      ['POST', '/api/admin/daily-menus', () => multi({ date: '2026-07-11' }, [f('fileEn', EN_PDF, 'a.pdf', 'application/pdf')])],
      ['PUT', `/api/admin/daily-menus/${m.id}`, () => multi({ removeFileEn: 'true', date: '2026-07-12' })],
      ['PATCH', `/api/admin/daily-menus/${m.id}/published`, null, { published: true }],
      ['DELETE', `/api/admin/daily-menus/${m.id}`],
      ['POST', '/api/admin/menu/pages', () => multi({ lang: 'en' }, [f('file', EN_IMG, 'a.png', 'image/png')])],
      ['PUT', '/api/admin/menu/pages/published', null, { lang: 'en', published: true }],
      ['PUT', '/api/admin/menu/pages/order', null, { lang: 'en', ids: [mf.id] }],
      ['DELETE', `/api/admin/menu/pages/${mf.id}`],
      ['PUT', '/api/admin/menu/draft', null, { categories: [{ name: '', nameEn: 'evil', items: [] }] }],
      ['GET', '/api/admin/events'], ['GET', '/api/admin/daily-menus'], ['GET', '/api/admin/menu'], ['GET', '/api/admin/dashboard'],
    ];
    const snap = async () => JSON.stringify([(await admin.get('/api/admin/events')).data, (await admin.get('/api/admin/daily-menus')).data, (await admin.get('/api/admin/menu')).data.pages, (await admin.get('/api/admin/menu')).data.draft]);
    const before = await snap(); const n0 = nUp();
    const bodyOf = (r) => (r[2] ? { form: r[2]() } : r[3] ? { json: r[3] } : {});
    for (const r of routes) {
      const [method, url] = r;
      const a = await anon.req(method, url, bodyOf(r)); assert.equal(a.status, 401, `anon ${method} ${url} -> ${a.status}`);
      if (method === 'GET') continue;
      const noCsrf = await admin.req(method, url, { ...bodyOf(r), csrf: false }); assert.ok([401, 403].includes(noCsrf.status), `no csrf header ${method} ${url} -> ${noCsrf.status}`);
      const cross = await admin.req(method, url, { ...bodyOf(r), origin: 'https://evil.example' }); assert.equal(cross.status, 403, `cross-origin ${method} ${url} -> ${cross.status}`); assert.equal(cross.data.error, 'csrf');
    }
    assert.equal(await snap(), before, 'state unchanged'); assert.equal(nUp(), n0, 'no orphan files');
    // unauthenticated /media of unpublished admin files via the admin path -> 401
    assert.equal((await anon.get(e.imageEnUrl)).status, 401); assert.equal((await anon.get(m.fileEnUrl)).status, 401);
    await admin.del(`/api/admin/events/${e.id}`); await admin.del(`/api/admin/daily-menus/${m.id}`); await admin.del(`/api/admin/menu/pages/${mf.id}`);
    assert.equal(nUp(), 0);
  });
  test('LA2 bad ids and traversal on EN file paths: 404/400, never 500 or file contents', async () => {
    for (const p of ['/media/../../etc/passwd', '/media/..%2f..%2fkota.db', '/media/%2e%2e%2fkota.db', '/media/00000000000000000000000000000000.png', '/media/' + 'a'.repeat(32) + '.svg']) {
      const r = await anon.get(p); assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
    }
    for (const id of ['abc', '0', '-1', '99999', '1e3']) {
      let r = await admin.put(`/api/admin/events/${id}`, { form: multi({ titleEn: 'x' }) }); assert.ok([400, 404].includes(r.status), `event ${id} -> ${r.status}`);
      r = await admin.put(`/api/admin/daily-menus/${id}`, { form: multi({ removeFileEn: 'true' }) }); assert.ok([400, 404].includes(r.status), `daily ${id} -> ${r.status}`);
    }
  });

  // =============================================================== XSS payloads in EN + BG fields stay inert text in API output
  test('LX1 HTML/script payloads in BG and EN fields are stored verbatim and returned as JSON text (nosniff); not HTML-interpreted by the API', async () => {
    const P = (n) => `<img src=x onerror="window.__xss=${n}">&lt;b&gt;`;
    const e = await mkEv({ title: P(1), titleEn: P(2), description: P(3), descriptionEn: P(4), enabled: 'true' });
    await admin.put('/api/admin/menu/draft', { json: { categories: [{ name: P(5), nameEn: P(6), items: [it(P(7), P(8), { description: P(9), descriptionEn: P(10) })] }] } });
    await admin.post('/api/admin/menu/publish');
    for (const l of ['bg', 'en']) {
      for (const url of [`/api/public/events?lang=${l}`, `/api/public/menu?lang=${l}`]) {
        const r = await anon.get(url); assert.match(r.headers.get('content-type'), /^application\/json/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      }
    }
    assert.equal((await pubEv('en')).find((x) => x.id === e.id).title, P(2)); assert.equal((await pubEv('bg')).find((x) => x.id === e.id).title, P(1));
    assert.equal((await pubMenu('en')).structured.categories[0].name, P(6));
    await admin.del(`/api/admin/events/${e.id}`);
  });
});

// =================================================================== migration 005 on an existing (001..004) database
describe('migration 005 on a database created before the change', () => {
  const MIG = path.join(ROOT, 'server', 'migrations');
  let dir; let srv;
  after(async () => { if (srv) await srv.stop(); });
  test('LG1 001..004 DB with an event image, a published daily menu and a published menu file: 005 applies on start, nothing lost, defaults sane; EN can then be added; idempotent restart', async () => {
    dir = tmpDir('mig5'); dirs.push(dir); fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
    const db = new DatabaseSync(path.join(dir, 'kota.db'));
    db.exec('PRAGMA foreign_keys = ON');
    const names = ['001_init.sql', '002_i18n.sql', '003_default_address.sql', '004_fix_default_address_en.sql'];
    for (const n of names) db.exec(fs.readFileSync(path.join(MIG, n), 'utf8'));
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
    for (const n of names) db.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run(n, Date.now());
    const now = Date.parse(T0);
    const mkFile = (stored, orig, mime, buf) => { fs.writeFileSync(path.join(dir, 'uploads', stored), buf); return Number(db.prepare('INSERT INTO files(stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?)').run(stored, orig, mime, buf.length, now).lastInsertRowid); };
    const imgId = mkFile('a'.repeat(32) + '.png', 'ev.png', 'image/png', BG_IMG);
    const dmFile = mkFile('b'.repeat(32) + '.pdf', 'dnes.pdf', 'application/pdf', BG_PDF);
    const mfFile = mkFile('c'.repeat(32) + '.png', 'menu.png', 'image/png', BG_IMG2);
    db.prepare('INSERT INTO events(title, description, image_file_id, enabled, created_at, updated_at) VALUES (?,?,?,1,?,?)').run('Старо събитие', 'опис', imgId, now, now);
    db.prepare('INSERT INTO daily_menus(menu_date, file_id, published, created_at, updated_at) VALUES (?,?,1,?,?)').run(TODAY, dmFile, now, now);
    db.prepare('INSERT INTO menu_files(file_id, published, created_at) VALUES (?,1,?)').run(mfFile, now);
    db.prepare("UPDATE settings SET value='file' WHERE key='menu_mode'").run();
    db.close();

    srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
    const anon = new Client(srv.url);
    const ev = (await anon.get('/api/public/events?lang=en')).data.events[0]; assert.equal(ev.title, 'Старо събитие', 'EN visitor sees BG event (fallback)');
    assert.equal((await anon.get(ev.imageUrl)).status, 200);
    const dm = (await anon.get('/api/public/daily-menu?lang=en')).data.menu; assert.equal(dm.kind, 'pdf'); assert.equal((await anon.get(dm.fileUrl)).status, 200);
    for (const l of ['bg', 'en']) { const m = (await anon.get(`/api/public/menu?lang=${l}`)).data; assert.equal(m.mode, 'file'); assert.equal(m.file.pages.length, 1); assert.equal(m.file.lang, 'bg', 'old (bg) menu file is page 1 of bg and EN falls back to it'); assert.equal((await anon.get(m.file.pages[0].fileUrl)).status, 200, `old menu file visible in ${l}`); }
    await srv.stop(); srv = null;

    const chk = new DatabaseSync(path.join(dir, 'kota.db'));
    assert.deepEqual(chk.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name), [...names, '005_separate_languages.sql', '006_menu_pages.sql', '007_gallery.sql', '008_contact_email.sql']);
    assert.equal(chk.prepare('SELECT lang FROM menu_files').get().lang, 'bg');
    assert.equal(chk.prepare('SELECT image_en_file_id v FROM events').get().v, null);
    const d = chk.prepare('SELECT file_id, file_en_id, published, menu_date FROM daily_menus').get(); assert.equal(d.file_id, dmFile); assert.equal(d.file_en_id, null); assert.equal(d.published, 1); assert.equal(d.menu_date, TODAY);
    const cols = chk.prepare('PRAGMA table_info(daily_menus)').all(); assert.equal(cols.find((c) => c.name === 'file_id').notnull, 0, 'file_id nullable'); assert.ok(cols.find((c) => c.name === 'file_en_id'));
    assert.deepEqual(chk.prepare('PRAGMA foreign_key_check').all(), []); assert.equal(chk.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(chk.prepare("SELECT sql FROM sqlite_master WHERE name='daily_menus'").get().sql.includes('UNIQUE'), true, 'menu_date stays UNIQUE');
    chk.close();

    createAdmin(dir);
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
    const admin = new Client(srv.url); await admin.login();
    const menus = (await admin.get('/api/admin/daily-menus')).data.menus; assert.equal(menus.length, 1); assert.equal(menus[0].fileEnUrl, null); assert.ok(menus[0].fileUrl);
    let r = await admin.put(`/api/admin/daily-menus/${menus[0].id}`, { form: multi({}, [f('fileEn', EN_PDF, 'en.pdf', 'application/pdf')]) }); assert.equal(r.status, 200); assert.ok(r.data.fileEnUrl);
    assert.ok(same2(await anon.get((await anon.get('/api/public/daily-menu?lang=en')).data.menu.fileUrl), EN_PDF));
    assert.ok(same2(await anon.get((await anon.get('/api/public/daily-menu?lang=bg')).data.menu.fileUrl), BG_PDF));
    // a new daily menu with the (previously NOT NULL) BG file missing works on the migrated table
    r = await admin.post('/api/admin/daily-menus', { form: multi({ date: '2026-06-20' }, [f('fileEn', EN_IMG, 'e.png', 'image/png')]) }); assert.equal(r.status, 201);
    r = await admin.get('/api/admin/menu'); assert.equal(r.data.pages.bg.items[0].lang, 'bg'); assert.equal(r.data.pages.bg.published, true, '006: published legacy file sets the bg flag'); assert.equal(r.data.pages.en.items.length, 0);
    await srv.stop();
    srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); // idempotent restart
    assert.equal((await new Client(srv.url).get('/api/public/site')).status, 200);
    await srv.stop(); srv = null;
    const chk2 = new DatabaseSync(path.join(dir, 'kota.db'));
    assert.equal(chk2.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 8); chk2.close();
  });
});
function same2(r, buf) { return r.status === 200 && Buffer.compare(r.buf, buf) === 0; }

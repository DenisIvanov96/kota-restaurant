// T-43 (D-45): daily-menu auto-cleanup. Port 3202. Europe/Sofia = UTC+3 in June, so Sofia midnight 06-18 = 2026-06-17T21:00:00Z.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PDF, JPG, WEBP } from '../lib/harness.mjs';

const PORT = 3202;
const T0 = '2026-06-15T10:00:00Z';
const png = (c) => makePng(30, 20, c);
const mp = (fields, files = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  for (const x of files) fd.append(x.field, new Blob([x.buf], { type: x.type }), x.name);
  return fd;
};

describe('daily menu auto-cleanup (D-45)', () => {
  let dir; let srv; let admin; let anon;
  const up = () => fs.readdirSync(path.join(dir, 'uploads')).sort();
  const dbq = (sql) => { const d = new DatabaseSync(path.join(dir, 'kota.db'), { readOnly: true }); try { return d.prepare(sql).all(); } finally { d.close(); } };
  const dates = () => dbq('SELECT menu_date d FROM daily_menus ORDER BY menu_date').map((r) => r.d);
  async function restartAt(iso) { await srv.stop(); srv = await startServer({ port: PORT, dataDir: dir, now: iso }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); }
  const dm = (date, published, files, extra = {}) => admin.post('/api/admin/daily-menus', { form: mp({ date, published, ...extra }, files) });
  const F = (field, buf, name, type) => ({ field, buf, name, type });
  const ids = {};

  before(async () => { dir = tmpDir('cleanup'); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('CL1 seed: menus for 06-15..06-20 (BG+EN files, published and unpublished) on 06-15 are all kept (none is past)', async () => {
    const specs = [['2026-06-15', 'true', 2], ['2026-06-16', 'false', 2], ['2026-06-17', 'true', 1], ['2026-06-18', 'true', 2], ['2026-06-19', 'false', 1], ['2026-06-20', 'true', 2]];
    let n = 0;
    for (const [date, pubd, nf] of specs) {
      const files = [F('file', png([n, 10, 10]), `bg${date}.png`, 'image/png')];
      if (nf === 2) files.push(F('fileEn', Buffer.concat([PDF, Buffer.from(`%${date}\n`)]), `en${date}.pdf`, 'application/pdf'));
      const r = await dm(date, pubd, files); assert.equal(r.status, 201, `${date}: ${r.text()}`); ids[date] = r.data; n += 20;
    }
    assert.deepEqual(dates(), ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20']);
    assert.equal(up().length, 10); assert.equal(dbq('SELECT COUNT(*) n FROM files')[0].n, 10);
  });

  test('CL2 the clock alone deletes nothing: at 2026-06-17T20:59:59Z (Sofia 23:59:59 on 06-17) nothing is removed; non-uploading edits do not trigger cleanup', async () => {
    await restartAt('2026-06-17T20:59:59Z');
    assert.deepEqual(dates().length, 6);
    // changes that are not uploads: publish toggle, date edit without file, delete
    assert.equal((await admin.patch(`/api/admin/daily-menus/${ids['2026-06-19'].id}/published`, { json: { published: true } })).status, 200);
    assert.equal((await admin.put(`/api/admin/daily-menus/${ids['2026-06-19'].id}`, { form: mp({ published: 'false' }) })).status, 200);
    assert.equal(dates().length, 6, 'PUT/PATCH without a file does not clean up');
    // a failed upload (415) does not clean up either
    const bad = await dm('2026-06-30', 'true', [F('file', Buffer.from('not an image'), 'x.png', 'image/png')]); assert.equal(bad.status, 415);
    assert.equal(dates().length, 6, 'failed upload does not clean up');
    // an event upload is not a daily-menu upload
    const ev = await admin.post('/api/admin/events', { form: mp({ title: 'e', enabled: 'false' }, [F('image', png([1, 2, 3]), 'e.png', 'image/png')]) }); assert.equal(ev.status, 201);
    assert.equal(dates().length, 6, 'event upload does not clean up daily menus');
    await admin.del(`/api/admin/events/${ev.data.id}`);
    // admin list at this instant (06-17 Sofia): today + upcoming only
    const list = (await admin.get('/api/admin/daily-menus')).data;
    assert.equal(list.today, '2026-06-17'); assert.deepEqual(list.menus.map((m) => m.date), ['2026-06-20', '2026-06-19', '2026-06-18', '2026-06-17'], 'past 06-15 and 06-16 hidden from the admin list but still in the DB');
    assert.equal(dates().length, 6);
  });

  test('CL3 first upload on Sofia 06-17 23:59:59 (UTC 20:59:59): deletes 06-15 and 06-16 (BG+EN files, published or not) from DB and disk; 06-17 (today) and later are kept', async () => {
    const before = up();
    const r = await dm('2026-06-25', 'false', [F('file', png([99, 9, 9]), 'new.png', 'image/png')]); assert.equal(r.status, 201); ids['2026-06-25'] = r.data;
    assert.deepEqual(dates(), ['2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20', '2026-06-25']);
    // files rows + disk: 06-15 (2 files) and 06-16 (2 files) removed, new one added
    assert.equal(up().length, before.length - 4 + 1);
    assert.equal(dbq('SELECT COUNT(*) n FROM files')[0].n, up().length, 'files table matches disk: no orphan rows or files');
    for (const d of ['2026-06-15', '2026-06-16']) {
      assert.equal((await admin.put(`/api/admin/daily-menus/${ids[d].id}`, { form: mp({ published: 'true' }) })).status, 404, `${d} gone`);
      assert.equal((await admin.get(ids[d].fileUrl)).status, 404, `${d} file gone`);
      if (ids[d].fileEnUrl) assert.equal((await admin.get(ids[d].fileEnUrl)).status, 404);
    }
    for (const d of ['2026-06-17', '2026-06-18', '2026-06-20']) assert.equal((await admin.get(ids[d].fileUrl)).status, 200, `${d} file kept`);
  });

  test('CL4 PUT that adds a file (fileEn) triggers cleanup too; after Sofia midnight (21:00:00Z) 06-17 becomes past and is deleted by it', async () => {
    await restartAt('2026-06-17T21:00:00Z');
    const t = (await anon.get('/api/public/daily-menu')).data; assert.equal(t.today, '2026-06-18');
    assert.equal(dates().includes('2026-06-17'), true, 'still in the DB until an upload happens');
    // public: 06-17's media is hidden although the row exists
    assert.equal((await anon.get(ids['2026-06-17'].fileUrl.replace('/api/admin', ''))).status, 404);
    const n0 = up().length;
    const r = await admin.put(`/api/admin/daily-menus/${ids['2026-06-20'].id}`, { form: mp({}, [F('fileEn', Buffer.concat([PDF, Buffer.from('%put\n')]), 'put.pdf', 'application/pdf')]) });
    assert.equal(r.status, 200, r.text());
    assert.deepEqual(dates(), ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-25']);
    // 06-17 had one file; 06-20's EN file was replaced (old file deleted, new added) -> net -1
    assert.equal(up().length, n0 - 1);
    assert.equal(dbq('SELECT COUNT(*) n FROM files')[0].n, up().length);
  });

  test('CL5 a past-dated upload is created (exempt) and removed by the next upload; today/future untouched; replace=true path also cleans up', async () => {
    const past = await dm('2026-06-01', 'true', [F('file', JPG, 'p.jpg', 'image/jpeg')]); assert.equal(past.status, 201);
    assert.deepEqual(dates().slice(0, 2), ['2026-06-01', '2026-06-18']);
    const rep = await dm('2026-06-18', 'true', [F('file', WEBP, 'r.webp', 'image/webp')], { replace: 'true' }); assert.equal(rep.status, 200);
    assert.deepEqual(dates(), ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-25'], 'replace upload cleaned 06-01');
    assert.equal(dbq('SELECT COUNT(*) n FROM files')[0].n, up().length);
  });

  test('CL6 an upload on the winter DST boundaries uses Sofia midnight: clock 2026-12-01T22:00:00Z (Sofia 12-02 00:00, UTC+2) deletes 12-01, keeps 12-02', async () => {
    for (const d of Object.values(ids)) { await admin.del(`/api/admin/daily-menus/${d.id}`).catch(() => {}); }
    for (const m of dbq('SELECT id FROM daily_menus')) await admin.del(`/api/admin/daily-menus/${m.id}`);
    await restartAt('2026-11-30T10:00:00Z');
    const a = await dm('2026-12-01', 'true', [F('file', png([5, 5, 5]), 'a.png', 'image/png')]); const b = await dm('2026-12-02', 'true', [F('file', png([6, 6, 6]), 'b.png', 'image/png')]);
    assert.equal(a.status, 201); assert.equal(b.status, 201); assert.deepEqual(dates(), ['2026-12-01', '2026-12-02']);
    await restartAt('2026-12-01T21:59:59Z');
    const c = await dm('2026-12-10', 'false', [F('file', png([7, 7, 7]), 'c.png', 'image/png')]); assert.equal(c.status, 201);
    assert.deepEqual(dates(), ['2026-12-01', '2026-12-02', '2026-12-10'], '21:59:59Z is still 12-01 in Sofia (UTC+2): nothing is past');
    await restartAt('2026-12-01T22:00:00Z');
    const d = await dm('2026-12-11', 'false', [F('file', png([8, 8, 8]), 'd.png', 'image/png')]); assert.equal(d.status, 201);
    assert.deepEqual(dates(), ['2026-12-02', '2026-12-10', '2026-12-11']);
    assert.equal(dbq('SELECT COUNT(*) n FROM files')[0].n, up().length);
  });
});

// T-38: daily-menu auto-cleanup of past dates (D-45), Europe/Sofia.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loggedIn, PDF, PNG } from './helpers.js';

const form = (fields, files = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  for (const x of files) f.append(x.field, new Blob([x.buf], { type: x.type }), x.name);
  return f;
};
const pdf = (field = 'file') => ({ field, buf: PDF, name: 'm.pdf', type: 'application/pdf' });
const png = (field = 'file') => ({ field, buf: PNG, name: 'm.png', type: 'image/png' });
const add = (s, date, files = [pdf()]) => s.api.req('POST', '/api/admin/daily-menus', { form: form({ date, published: true }, files) });
const dates = (s) => s.db.prepare('SELECT menu_date FROM daily_menus ORDER BY menu_date').all().map((r) => r.menu_date);
const seedPast = (s, date, withEn = true) => {
  const mk = (n) => Number(s.db.prepare("INSERT INTO files(stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?, 'o.pdf', 'application/pdf', 1, 1)")
    .run(`${n.repeat(32)}.pdf`, ).lastInsertRowid);
  return s.db.prepare('INSERT INTO daily_menus(menu_date, file_id, file_en_id, published, created_at, updated_at) VALUES (?,?,?,1,1,1)')
    .run(date, mk(date.endsWith('13') ? 'a' : 'b'), withEn ? mk(date.endsWith('13') ? 'c' : 'd') : null);
};

test('after an upload: past dates are deleted with their files; today and future are kept', async () => {
  const s = await loggedIn({ iso: '2026-06-15T10:00:00Z' });
  try {
    // real uploads for past dates (a past-dated menu can be created; it is only removed by a later cleanup)
    assert.equal((await add(s, '2026-06-13', [pdf(), png('fileEn')])).status, 201);
    assert.equal((await add(s, '2026-06-14')).status, 201);
    assert.equal(s.uploads().length, 1); // 06-13 (BG+EN) went when 06-14 was created
    // each creation cleans the older ones, never the menu just written
    assert.deepEqual(dates(s), ['2026-06-14']);
    assert.equal((await add(s, '2026-06-15')).status, 201); // today: removes 06-14
    assert.deepEqual(dates(s), ['2026-06-15']);
    assert.equal((await add(s, '2026-06-16')).status, 201);
    assert.equal((await add(s, '2026-07-01')).status, 201);
    assert.deepEqual(dates(s), ['2026-06-15', '2026-06-16', '2026-07-01']);
    assert.equal(s.uploads().length, 3);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 3);
  } finally { await s.close(); }
});

test('cleanup removes BG and EN files of every past menu (also published ones), on POST and on PUT with a file', async () => {
  const s = await loggedIn({ iso: '2026-06-15T10:00:00Z' });
  try {
    const touch = () => { for (const r of s.db.prepare('SELECT stored_name FROM files').all()) fs.writeFileSync(path.join(s.dataDir, 'uploads', r.stored_name), 'x'); };
    seedPast(s, '2026-06-13'); seedPast(s, '2026-06-12', false);
    touch();
    assert.equal(s.uploads().length, 3);
    // a PUT that does not add a file does not clean up
    const today = await add(s, '2026-06-15');
    assert.equal(today.status, 201); // POST cleaned already
    assert.deepEqual(dates(s), ['2026-06-15']);
    assert.equal(s.uploads().length, 1);
    seedPast(s, '2026-06-10'); touch();
    const n = s.uploads().length;
    assert.equal((await s.api.put(`/api/admin/daily-menus/${today.data.id}`, { published: false })).status, 200);
    assert.deepEqual(dates(s), ['2026-06-10', '2026-06-15']);
    assert.equal(s.uploads().length, n);
    // PUT that adds a file cleans up
    const r = await s.api.req('PUT', `/api/admin/daily-menus/${today.data.id}`, { form: form({}, [png('fileEn')]) });
    assert.equal(r.status, 200);
    assert.deepEqual(dates(s), ['2026-06-15']);
    assert.equal(s.uploads().length, 2);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM files').get().n, 2);
  } finally { await s.close(); }
});

test('Sofia midnight edge: 23:59:59 local keeps today, 00:00:00 local drops it (summer UTC+3 and winter UTC+2)', async () => {
  for (const [before, after, d, next] of [
    ['2026-06-15T20:59:59Z', '2026-06-15T21:00:00Z', '2026-06-15', '2026-06-16'],
    ['2026-12-15T21:59:59Z', '2026-12-15T22:00:00Z', '2026-12-15', '2026-12-16'],
  ]) {
    const s = await loggedIn({ iso: before });
    try {
      seedPast(s, '2026-01-01', false);
      assert.equal((await add(s, d)).status, 201);
      assert.deepEqual(dates(s), [d], `${before}: today kept, older removed`);
      assert.equal((await s.api.get('/api/admin/daily-menus')).data.today, d);
      s.clock.t = Date.parse(after);
      assert.equal((await s.api.get('/api/admin/daily-menus')).data.menus.length, 0, 'list hides past dates');
      assert.equal((await add(s, next)).status, 201);
      assert.deepEqual(dates(s), [next], `${after}: yesterday removed`);
    } finally { await s.close(); }
  }
});

test('GET /api/admin/daily-menus lists today and upcoming only', async () => {
  const s = await loggedIn({ iso: '2026-06-15T10:00:00Z' });
  try {
    seedPast(s, '2026-06-13', false);
    assert.equal((await add(s, '2026-06-16')).status, 201);
    seedPast(s, '2026-06-14', false);
    assert.deepEqual((await s.api.get('/api/admin/daily-menus')).data.menus.map((m) => m.date), ['2026-06-16']);
  } finally { await s.close(); }
});

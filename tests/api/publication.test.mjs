// Publication rules for events and daily menus, with a real server whose clock is advanced via KOTA_NOW + restart (same DATA_DIR).
// Port 3202. Base time 2026-06-15T10:00:00Z = 13:00 in Sofia (UTC+3, summer).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PDF, JPG, WEBP } from '../lib/harness.mjs';

const PORT = 3202;
const T0 = '2026-06-15T10:00:00Z';
const png = (c) => makePng(30, 20, c);

describe('events + daily menu publication (time travel)', () => {
  let dir; let srv; let admin; let anon;
  const uploads = () => fs.readdirSync(path.join(dir, 'uploads')).sort();
  async function restartAt(iso) { await srv.stop(); srv = await startServer({ port: PORT, dataDir: dir, now: iso }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); }
  const pubEvents = async () => (await anon.get('/api/public/events')).data.events;
  const titles = async () => (await pubEvents()).map((e) => e.title);
  const mkEvent = async (f, image) => {
    const r = await admin.post('/api/admin/events', { form: form(f, image && { field: 'image', buf: image, name: 'e.png', type: 'image/png' }) });
    assert.equal(r.status, 201, r.text()); return r.data;
  };

  before(async () => { dir = tmpDir('pub'); createAdmin(dir); srv = await startServer({ port: PORT, dataDir: dir, now: T0 }); admin = new Client(srv.url); await admin.login(); anon = new Client(srv.url); });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  // ================= EVENTS =================
  let evA; let evExp; let evFut; let imgA;
  test('E1 admin can create an enabled event; it is public immediately (API) with image served from /media', async () => {
    evA = await mkEvent({ title: 'Live music', description: 'Jazz night', enabled: 'true', eventAt: '2026-06-20T20:00' }, png([10, 200, 10]));
    assert.equal(evA.status, 'active'); assert.equal(evA.enabled, true);
    const pub = (await pubEvents()).find((e) => e.title === 'Live music');
    assert.ok(pub); assert.equal(pub.eventAt, '2026-06-20T20:00'); assert.equal(pub.description, 'Jazz night');
    imgA = pub.imageUrl; assert.match(imgA, /^\/media\/[a-f0-9]{32}\.png$/);
    const m = await anon.get(imgA); assert.equal(m.status, 200); assert.equal(m.headers.get('content-type'), 'image/png');
  });
  test('E2 admin can DISABLE; event disappears from public API and its /media image 404 right away; list still shows it as disabled', async () => {
    const r = await admin.patch(`/api/admin/events/${evA.id}/enabled`, { json: { enabled: false } });
    assert.equal(r.status, 200); assert.equal(r.data.status, 'disabled'); assert.equal(r.data.enabled, false);
    assert.ok(!(await titles()).includes('Live music'));
    assert.equal((await anon.get(imgA)).status, 404);
    assert.equal((await admin.get(r.data.imageUrl)).status, 200, 'admin can still preview via /api/admin/media');
    assert.ok((await admin.get('/api/admin/events')).data.events.some((e) => e.id === evA.id));
  });
  test('E3 admin can re-ENABLE; visible again immediately', async () => {
    const r = await admin.patch(`/api/admin/events/${evA.id}/enabled`, { json: { enabled: true } });
    assert.equal(r.data.status, 'active');
    assert.ok((await titles()).includes('Live music'));
    assert.equal((await anon.get(imgA)).status, 200);
  });
  test('E4 image + description update show publicly at once; old image URL dies and file is removed from disk', async () => {
    const before = uploads();
    const r = await admin.put(`/api/admin/events/${evA.id}`, { form: form({ title: 'Live music', description: 'Blues night (updated)' }, { field: 'image', buf: png([0, 0, 255]), name: 'new.png', type: 'image/png' }) });
    assert.equal(r.status, 200, r.text());
    const pub = (await pubEvents()).find((e) => e.title === 'Live music');
    assert.equal(pub.description, 'Blues night (updated)');
    assert.notEqual(pub.imageUrl, imgA);
    assert.equal((await anon.get(pub.imageUrl)).status, 200);
    assert.equal((await anon.get(imgA)).status, 404, 'old image URL stops working');
    assert.equal(uploads().length, before.length, 'old file deleted, no orphan');
    assert.equal(r.data.enabled, true, 'partial PUT keeps enabled');
    imgA = pub.imageUrl;
    const r2 = await admin.put(`/api/admin/events/${evA.id}`, { form: form({ removeImage: 'true' }) });
    assert.equal(r2.status, 200); assert.equal(r2.data.imageUrl, null);
    assert.equal((await pubEvents()).find((e) => e.title === 'Live music').imageUrl, null);
    assert.equal((await anon.get(imgA)).status, 404);
    assert.equal(uploads().length, before.length - 1);
  });
  test('E5 events ordering: by eventAt then startsAt; events without eventAt last', async () => {
    const a = await mkEvent({ title: 'Z-late', enabled: 'true', eventAt: '2026-08-01T10:00' });
    const b = await mkEvent({ title: 'A-early', enabled: 'true', eventAt: '2026-07-01T10:00' });
    const c = await mkEvent({ title: 'No date', enabled: 'true' });
    const t = await titles();
    assert.ok(t.indexOf('A-early') < t.indexOf('Z-late') && t.indexOf('Z-late') < t.indexOf('No date'), t.join());
    for (const e of [a, b, c]) await admin.del(`/api/admin/events/${e.id}`);
  });

  test('E6 expiring event: visible before expiresAt; boundary 11:59:59Z visible, 12:00:00Z hidden; no admin action; still listed in admin as expired; image 404', async () => {
    evExp = await mkEvent({ title: 'Expiring', enabled: 'true', expiresAt: '2026-06-15T15:00' }, png([200, 200, 0])); // 15:00 Sofia = 12:00Z
    const imgUrl = (await pubEvents()).find((e) => e.title === 'Expiring').imageUrl;
    const file = imgUrl.split('/').pop();
    assert.ok((await titles()).includes('Expiring'));
    await restartAt('2026-06-15T11:59:59Z');
    assert.ok((await titles()).includes('Expiring'), 'still visible 1s before expiry');
    assert.equal((await anon.get(imgUrl)).status, 200);
    await restartAt('2026-06-15T12:00:00Z');
    assert.ok(!(await titles()).includes('Expiring'), 'hidden at the expiry instant');
    assert.equal((await anon.get(imgUrl)).status, 404, 'image of expired event not public');
    const adminEv = (await admin.get('/api/admin/events')).data.events.find((e) => e.id === evExp.id);
    assert.ok(adminEv, 'expired event remains listed in admin'); assert.equal(adminEv.status, 'expired'); assert.equal(adminEv.enabled, true);
    assert.equal((await admin.get('/api/admin/dashboard')).data.events.expired, 1);
    assert.equal((await admin.get(`/api/admin/media/${file}`)).status, 200);
    // re-enabling toggle does not resurrect an expired event
    await admin.patch(`/api/admin/events/${evExp.id}/enabled`, { json: { enabled: true } });
    assert.ok(!(await titles()).includes('Expiring'));
    // extending expiresAt brings it back
    const r = await admin.put(`/api/admin/events/${evExp.id}`, { form: form({ expiresAt: '2026-06-16T15:00' }) });
    assert.equal(r.data.status, 'active');
    assert.ok((await titles()).includes('Expiring'));
  });
  test('E7 future event: hidden before startsAt (also its image), appears exactly at startsAt', async () => {
    // now = 12:00Z = 15:00 Sofia. Start 18:00 Sofia = 15:00Z
    evFut = await mkEvent({ title: 'Future', enabled: 'true', startsAt: '2026-06-15T18:00' }, png([0, 200, 200]));
    assert.equal(evFut.status, 'scheduled');
    assert.ok(!(await titles()).includes('Future'));
    const url = evFut.imageUrl.replace('/api/admin/media/', '/media/');
    assert.equal((await anon.get(url)).status, 404, 'future event image not public');
    assert.equal((await admin.get('/api/admin/dashboard')).data.events.scheduled, 1);
    await restartAt('2026-06-15T14:59:59Z');
    assert.ok(!(await titles()).includes('Future'), '1s before start');
    await restartAt('2026-06-15T15:00:00Z');
    assert.ok((await titles()).includes('Future'), 'visible at start instant');
    assert.equal((await anon.get(url)).status, 200);
    assert.equal((await admin.get('/api/admin/events')).data.events.find((e) => e.id === evFut.id).status, 'active');
  });
  test('E8 winter time (UTC+2): startsAt 09:00 Sofia on 2026-12-01 = 07:00Z', async () => {
    const e = await mkEvent({ title: 'Winter', enabled: 'true', startsAt: '2026-12-01T09:00', expiresAt: '2026-12-01T18:00' });
    await restartAt('2026-12-01T06:59:59Z'); assert.ok(!(await titles()).includes('Winter'));
    await restartAt('2026-12-01T07:00:00Z'); assert.ok((await titles()).includes('Winter'));
    await restartAt('2026-12-01T15:59:59Z'); assert.ok((await titles()).includes('Winter'));
    await restartAt('2026-12-01T16:00:00Z'); assert.ok(!(await titles()).includes('Winter'));
    await admin.del(`/api/admin/events/${e.id}`);
  });
  test('E9 disabled stays hidden regardless of window; disabled+future+expired states are exact', async () => {
    await restartAt('2026-06-15T15:00:00Z');
    const e = await mkEvent({ title: 'Off', enabled: 'false', startsAt: '2026-06-01T10:00', expiresAt: '2026-07-01T10:00' });
    assert.equal(e.status, 'disabled'); assert.ok(!(await titles()).includes('Off'));
    await admin.del(`/api/admin/events/${e.id}`);
  });
  test('E10 delete removes event and image file; /media 404; deleting unknown id => 404', async () => {
    const e = await mkEvent({ title: 'Del', enabled: 'true' }, png([1, 2, 3]));
    const n = uploads().length;
    const url = e.imageUrl.replace('/api/admin/media/', '/media/');
    assert.equal((await anon.get(url)).status, 200);
    assert.equal((await admin.del(`/api/admin/events/${e.id}`)).status, 204);
    assert.equal(uploads().length, n - 1);
    assert.equal((await anon.get(url)).status, 404);
    assert.equal((await admin.del(`/api/admin/events/${e.id}`)).status, 404);
  });
  test('E11 same image never shared: two events never reference one file (delete of one does not break other)', async () => {
    const a = await mkEvent({ title: 'A', enabled: 'true' }, png([9, 9, 9]));
    const b = await mkEvent({ title: 'B', enabled: 'true' }, png([9, 9, 9]));
    assert.notEqual(a.imageUrl, b.imageUrl);
    await admin.del(`/api/admin/events/${a.id}`);
    assert.equal((await anon.get(b.imageUrl.replace('/api/admin/media/', '/media/'))).status, 200);
    await admin.del(`/api/admin/events/${b.id}`);
  });

  // ================= DAILY MENU =================
  // Reset clock to base
  const dm = (date, published, file, name, type, extra = {}) => admin.post('/api/admin/daily-menus', { form: form({ date, published, ...extra }, { field: 'file', buf: file, name, type }) });
  const today = async () => (await anon.get('/api/public/daily-menu')).data;
  let d15; let d16; let d14;
  test('D1 uploads work for pdf, jpg, png, webp (create unpublished, correct kind/mime/size)', async () => {
    await restartAt(T0);
    const base = uploads().length; // event images from E-tests still on disk
    const cases = [['2026-06-01', PDF, 'menu.pdf', 'application/pdf', 'pdf'], ['2026-06-02', JPG, 'menu.jpg', 'image/jpeg', 'image'],
      ['2026-06-03', png([5, 5, 5]), 'menu.png', 'image/png', 'image'], ['2026-06-04', WEBP, 'menu.webp', 'image/webp', 'image']];
    for (const [date, buf, name, type, kind] of cases) {
      const r = await dm(date, 'false', buf, name, type);
      assert.equal(r.status, 201, `${name}: ${r.text()}`);
      assert.equal(r.data.kind, kind); assert.equal(r.data.mimeType, type); assert.equal(r.data.sizeBytes, buf.length); assert.equal(r.data.published, false); assert.equal(r.data.originalName, name);
      const raw = await admin.get(r.data.fileUrl);
      assert.equal(raw.status, 200); assert.equal(raw.headers.get('content-type'), type); assert.ok(raw.buf.equals(buf), 'bytes identical');
    }
    assert.equal((await admin.get('/api/admin/daily-menus')).data.menus.length, 4);
    for (const m of (await admin.get('/api/admin/daily-menus')).data.menus) await admin.del(`/api/admin/daily-menus/${m.id}`);
    assert.equal(uploads().length, base, 'deleting leaves no daily-menu files on disk');
  });
  test('D2 today (Sofia) published menu is visible with correct assigned date; /media serves it; unpublished today is NOT shown', async () => {
    const r = await dm('2026-06-15', 'false', png([1, 1, 1]), 'today.png', 'image/png'); d15 = r.data;
    let t = await today(); assert.equal(t.today, '2026-06-15'); assert.equal(t.menu, null, 'unpublished => no menu');
    assert.equal((await anon.get(d15.fileUrl.replace('/api/admin/media/', '/media/'))).status, 404, 'unpublished /media 404');
    const p = await admin.patch(`/api/admin/daily-menus/${d15.id}/published`, { json: { published: true } });
    assert.equal(p.data.published, true);
    t = await today(); assert.equal(t.menu.date, '2026-06-15'); assert.equal(t.menu.kind, 'image'); assert.equal(t.menu.mimeType, 'image/png');
    const m = await anon.get(t.menu.fileUrl); assert.equal(m.status, 200); assert.equal(m.headers.get('content-type'), 'image/png');
    await admin.patch(`/api/admin/daily-menus/${d15.id}/published`, { json: { published: false } });
    assert.equal((await today()).menu, null, 'unpublish hides at once');
    assert.equal((await anon.get(t.menu.fileUrl)).status, 404);
    await admin.patch(`/api/admin/daily-menus/${d15.id}/published`, { json: { published: true } });
  });
  test('D3 tomorrow\'s published menu does not appear early; /media 404; dashboard lists it as tomorrow', async () => {
    const r = await dm('2026-06-16', 'true', PDF, 'tomorrow.pdf', 'application/pdf'); d16 = r.data;
    const t = await today(); assert.equal(t.menu.date, '2026-06-15', 'only today shown');
    assert.equal((await anon.get(d16.fileUrl.replace('/api/admin/media/', '/media/'))).status, 404);
    const dash = (await admin.get('/api/admin/dashboard')).data;
    assert.equal(dash.dailyMenu.tomorrow.id, d16.id); assert.equal(dash.dailyMenu.today.id, d15.id);
    // the UTC date is already 06-15 21:30Z but Sofia is 06-16 00:30 -> must flip on SOFIA midnight, not UTC
    await restartAt('2026-06-15T20:59:59Z');
    assert.equal((await today()).today, '2026-06-15'); assert.equal((await today()).menu.date, '2026-06-15', '23:59:59 Sofia still the 15th');
    assert.equal((await anon.get(d16.fileUrl.replace('/api/admin/media/', '/media/'))).status, 404);
    await restartAt('2026-06-15T21:00:00Z');
    const t2 = await today();
    assert.equal(t2.today, '2026-06-16', 'Sofia midnight (00:00 UTC+3) = 21:00Z');
    assert.equal(t2.menu.date, '2026-06-16');
    assert.equal(t2.menu.kind, 'pdf');
    assert.equal((await anon.get(t2.menu.fileUrl)).status, 200);
  });
  test('D4 yesterday\'s published menu is not presented as today\'s; its /media 404 after midnight', async () => {
    // d15 is still published but now yesterday
    assert.equal((await today()).menu.date, '2026-06-16');
    assert.equal((await anon.get(d15.fileUrl.replace('/api/admin/media/', '/media/'))).status, 404);
    await admin.patch(`/api/admin/daily-menus/${d16.id}/published`, { json: { published: false } });
    const t = await today();
    assert.equal(t.menu, null, 'no menu today (only yesterday exists) => "no menu today" state');
    assert.equal(t.today, '2026-06-16');
    // admin still sees yesterday's menu
    assert.ok((await admin.get('/api/admin/daily-menus')).data.menus.some((m) => m.id === d15.id));
    await admin.patch(`/api/admin/daily-menus/${d16.id}/published`, { json: { published: true } });
  });
  test('D5 winter midnight: 2026-12-01 Sofia day starts at 22:00Z the day before (UTC+2)', async () => {
    const a = await dm('2026-12-02', 'true', png([3, 3, 3]), 'dec2.png', 'image/png');
    await restartAt('2026-12-01T21:59:59Z'); assert.equal((await today()).today, '2026-12-01'); assert.equal((await today()).menu, null);
    await restartAt('2026-12-01T22:00:00Z'); assert.equal((await today()).today, '2026-12-02'); assert.equal((await today()).menu.date, '2026-12-02');
    await admin.del(`/api/admin/daily-menus/${a.data.id}`);
    // DST switch day 2026-10-25 (clocks back at 04:00 Sofia): day still ends at Sofia midnight = 21:00Z on 10-25
    const b = await dm('2026-10-26', 'true', png([4, 4, 4]), 'oct26.png', 'image/png');
    await restartAt('2026-10-25T21:59:59Z'); assert.equal((await today()).menu, null, 'Oct 25 23:59:59 Sofia (UTC+2 after fallback)');
    await restartAt('2026-10-25T22:00:00Z'); assert.equal((await today()).menu?.date, '2026-10-26');
    await admin.del(`/api/admin/daily-menus/${b.data.id}`);
  });
  test('D6 replacing a file updates public content; old /media URL stops working; old file deleted; 409 without replace', async () => {
    await restartAt(T0);
    const before = uploads().length;
    const old = (await today()).menu.fileUrl;
    const dup = await dm('2026-06-15', 'true', png([50, 60, 70]), 'dup.png', 'image/png');
    assert.equal(dup.status, 409); assert.equal(dup.data.error, 'date_exists'); assert.equal(dup.data.existingId, d15.id);
    assert.equal(uploads().length, before, '409 leaves no orphan');
    const rep = await dm('2026-06-15', 'true', WEBP, 'replacement.webp', 'image/webp', { replace: 'true' });
    assert.equal(rep.status, 200, rep.text()); assert.equal(rep.data.id, d15.id); assert.equal(rep.data.mimeType, 'image/webp');
    const t = await today();
    assert.notEqual(t.menu.fileUrl, old); assert.equal(t.menu.mimeType, 'image/webp');
    assert.equal((await anon.get(t.menu.fileUrl)).status, 200);
    assert.equal((await anon.get(old)).status, 404, 'old media URL dead');
    assert.equal(uploads().length, before, 'old file removed from disk');
    // PUT with file
    const put = await admin.put(`/api/admin/daily-menus/${d15.id}`, { form: form({}, { field: 'file', buf: PDF, name: 'p.pdf', type: 'application/pdf' }) });
    assert.equal(put.status, 200); assert.equal(put.data.kind, 'pdf');
    assert.equal((await anon.get(t.menu.fileUrl)).status, 404);
    assert.equal((await today()).menu.kind, 'pdf');
    assert.equal(uploads().length, before);
  });
  test('D7 date edit: move menu to another date (conflict => 409), invalid dates => 400; moving today->tomorrow hides it', async () => {
    const other = await dm('2026-06-20', 'true', png([7, 7, 7]), 'o.png', 'image/png');
    assert.equal((await admin.put(`/api/admin/daily-menus/${other.data.id}`, { form: form({ date: '2026-06-15' }) })).status, 409);
    for (const bad of ['2026-02-30', '15-06-2026', '2026-6-1', 'abc', '']) {
      const r = await dm(bad, 'true', PDF, 'x.pdf', 'application/pdf'); assert.equal(r.status, 400, bad); assert.ok(r.data.fields.date);
    }
    const mv = await admin.put(`/api/admin/daily-menus/${other.data.id}`, { form: form({ date: '2026-06-15', published: 'true' }) });
    assert.equal(mv.status, 409);
    const mv2 = await admin.put(`/api/admin/daily-menus/${d15.id}`, { form: form({ date: '2026-06-17' }) });
    assert.equal(mv2.status, 200); assert.equal(mv2.data.date, '2026-06-17');
    assert.equal((await today()).menu, null, 'moved to the future => not shown today');
    await admin.put(`/api/admin/daily-menus/${d15.id}`, { form: form({ date: '2026-06-15' }) });
    assert.ok((await today()).menu);
    await admin.del(`/api/admin/daily-menus/${other.data.id}`);
  });
  test('D8 delete: today\'s live menu delete => 204, public shows no menu, file gone', async () => {
    const n = uploads().length;
    const url = (await today()).menu.fileUrl;
    assert.equal((await admin.del(`/api/admin/daily-menus/${d15.id}`)).status, 204);
    assert.equal((await today()).menu, null);
    assert.equal((await anon.get(url)).status, 404);
    assert.ok(uploads().length < n);
  });
  test('D9 past-dated menus can be created and stay hidden; /media 404', async () => {
    const r = await dm('2026-06-14', 'true', PDF, 'old.pdf', 'application/pdf'); d14 = r.data;
    assert.equal((await today()).menu, null);
    assert.equal((await anon.get(r.data.fileUrl.replace('/api/admin/media/', '/media/'))).status, 404);
    await admin.del(`/api/admin/daily-menus/${d14.id}`);
  });
  test('D10 /media unknown/never-existing names => 404; valid-looking random name => 404', async () => {
    for (const n of ['0123456789abcdef0123456789abcdef.png', 'x.png', '0123456789abcdef0123456789abcdef.exe', '0123456789abcdef0123456789abcdef.html']) {
      assert.equal((await anon.get('/media/' + n)).status, 404, n);
    }
  });
});

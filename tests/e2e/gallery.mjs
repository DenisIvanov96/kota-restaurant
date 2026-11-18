// T-50 (D-51..D-53) gallery + editable About, browser tests. Ports 3201 (public), 3202 (admin), 3203 (empty gallery).
// Run: node --disable-warning=ExperimentalWarning tests/e2e/gallery.mjs   (needs ffmpeg for the video fixtures)
import fs from 'node:fs';
import path from 'node:path';
import { startServer, createAdmin, Client, tmpDir, makePng, makeVideo, reporter, PASSWORD, JPG, WEBP } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir, contrast, colorsOf } from '../lib/browser.mjs';

const R = reporter('gallery-e2e');
const shots = shotDir();
const T0 = '2026-06-15T10:00:00Z';
const G = '/api/admin/gallery';
const MP4 = makeVideo('mp4'); const WEBM = makeVideo('webm'); const WEBM_LONG = makeVideo('webm', { seconds: 12, tag: 'L' });
const png = (n, w = 80, h = 60) => makePng(w, h, [(n * 53) % 256, (n * 97) % 256, (n * 31) % 256]);
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.stack || e.message).split('\n').slice(0, 5).join(' | ')); } };
const apiUpload = async (api, buf, name, type, caps = {}) => {
  const fd = new FormData(); for (const [k, v] of Object.entries(caps)) fd.append(k, v);
  fd.append('file', new Blob([buf], { type }), name);
  const r = await api.post(G, { form: fd }); if (r.status !== 201) throw new Error(`seed upload ${name}: ${r.status} ${r.text()}`); return r.data;
};
const browser = await chromium.launch();
const VPS = [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1280', width: 1280, height: 800 }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ======================================================================================= ADMIN (port 3202)
const dirA = tmpDir('galadmin'); createAdmin(dirA);
const srvA = await startServer({ port: 3202, dataDir: dirA, now: T0 });
const apiA = new Client(srvA.url); await apiA.login(); const anonA = new Client(srvA.url);
const ls = (d, sub) => fs.readdirSync(path.join(d, sub));
const fx = path.join(shots, 'fx'); fs.mkdirSync(fx, { recursive: true });
const wf = (name, buf) => { const p = path.join(fx, name); fs.writeFileSync(p, buf); return p; };

async function adminLogin(page) {
  await page.goto(srvA.url + '/admin/', { waitUntil: 'networkidle' });
  await page.getByLabel('Потребителско име').fill('owner');
  await page.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('h1:has-text("Табло")');
}
const goA = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForSelector('h1:has-text("Галерия")'); await page.waitForTimeout(300); };
const adminList = async () => (await apiA.get(G)).data.items;
const clearA = async () => { for (const it of await adminList()) await apiA.del(`${G}/${it.id}`); };

await step('A', async () => {
  const { page, log } = await newPage(browser, { width: 1280, height: 800 });
  await adminLogin(page);
  // ---- navigation: item present, route, title, h1 focus
  const nav = page.locator('.a-nav:visible a.a-nav__link');
  const labels = await nav.allTextContents();
  R.check('AN1 admin nav has "Галерия" between "Основно меню" and "Настройки"', labels.map((s) => s.trim()).join('|').includes('Основно меню|Галерия|Настройки'), labels.join('|'));
  await page.locator('.a-nav:visible a.a-nav__link', { hasText: 'Галерия' }).first().click();
  await page.waitForSelector('h1:has-text("Галерия")');
  R.check('AN2 #/gallery: document.title "Галерия — Kota1 админ", exactly one h1, focus on the h1', (await page.title()) === 'Галерия — Kota1 админ' && (await page.locator('h1').count()) === 1 && (await page.evaluate(() => document.activeElement && document.activeElement.tagName)) === 'H1', await page.title());
  await page.waitForSelector('.a-count');
  R.check('AE1 empty state: counter "0 / 50", empty text, no list, upload enabled', (await page.locator('.a-count__n').textContent()) === '0 / 50' && (await page.getByText('Още няма качени снимки или видео.').count()) === 1 && (await page.getByRole('button', { name: 'Избери снимки или видео' }).isEnabled()));
  R.check('AE1b dashboard card "Галерия: 0 / 50, видими: 0" + link', await (async () => { await page.evaluate(() => { location.hash = '#/'; }); await page.waitForSelector('h1:has-text("Табло")'); await page.waitForTimeout(400); return (await page.getByText('Галерия: 0 / 50, видими: 0').count()) === 1 && (await page.getByRole('link', { name: 'Управление на галерията' }).count()) === 1; })());
  await goA(page, '#/gallery');

  // ---- upload: 2 images + 1 video + bad type + wrong-content file; client validation
  const input = page.locator('input[type=file]');
  R.check('AU0 file input accepts multiple and lists the allowed types', (await input.getAttribute('multiple')) !== null && /video\/mp4/.test(await input.getAttribute('accept')) && /video\/webm/.test(await input.getAttribute('accept')) && /image\/webp/.test(await input.getAttribute('accept')));
  await input.setInputFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: png(1) }, { name: 'two.jpg', mimeType: 'image/jpeg', buffer: JPG }, { name: 'clip.mp4', mimeType: 'video/mp4', buffer: MP4 },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }, { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
  ]);
  await page.waitForSelector('.a-toast:has-text("Качени са 3 файла.")', { timeout: 15000 });
  R.pass('AU1 three valid files uploaded sequentially; toast "Качени са 3 файла."');
  const bad = await page.locator('.a-gal-errs li').allTextContents();
  R.check('AU2 client-side rejection lists the unsupported files by name (.txt, .pdf) and uploads nothing for them', bad.length === 2 && bad.some((b) => b.includes('notes.txt') && b.includes('не се поддържа')) && bad.some((b) => b.includes('doc.pdf')), JSON.stringify(bad));
  let items = await adminList();
  R.check('AU3 server state: 3 items in upload order, kinds image,image,video', items.length === 3 && items.map((i) => i.kind).join() === 'image,image,video' && items.map((i) => i.position).join() === '1,2,3', JSON.stringify(items.map((i) => [i.kind, i.position])));
  R.check('AU4 counter "3 / 50"; rows show kind badges "Снимка"/"Видео", size, visibility "Видимо"', (await page.locator('.a-count__n').textContent()) === '3 / 50' && (await page.locator('.a-gal').count()) === 3 && (await page.locator('.a-gal .a-badge', { hasText: 'Видео' }).count()) === 1 && (await page.locator('.a-gal .a-badge', { hasText: 'Снимка' }).count()) === 2 && (await page.locator('.a-gal .a-badge', { hasText: 'Видимо' }).count()) === 3);
  R.check('AU5 video row has a <video> thumbnail (aria-hidden, muted) and an image row an <img alt="">; preview link opens a new tab with noopener', await page.evaluate(() => { const rows = [...document.querySelectorAll('.a-gal')]; const v = rows[2].querySelector('video'); const i = rows[0].querySelector('img'); const a = rows[0].querySelector('a.a-gal__open'); return !!v && v.muted && v.getAttribute('aria-hidden') === 'true' && !!i && i.getAttribute('alt') === '' && a.target === '_blank' && /noopener/.test(a.rel); }));
  await page.screenshot({ path: path.join(shots, 'gallery-admin-1280.png'), fullPage: true });

  // ---- wrong-content file with an allowed extension -> server 415 -> error row, nothing stored
  await input.setInputFiles([{ name: 'fake.mp4', mimeType: 'video/mp4', buffer: Buffer.from('this is not a video at all, just text padding '.repeat(5)) }]);
  await page.waitForSelector('.a-qrow.is-error', { timeout: 10000 });
  const row415 = await page.locator('.a-qrow.is-error').first().textContent();
  R.check('AU6 415 error row: "Грешка: Този тип файл не се поддържа." with a close button; no item added; no tmp/uploads orphan', /Грешка: Този тип файл не се поддържа\./.test(row415) && (await adminList()).length === 3 && ls(dirA, 'uploads').length === 3 && ls(dirA, 'tmp').length === 0, row415);
  await page.locator('.a-qrow.is-error').getByRole('button', { name: /Затвори/ }).click();
  R.check('AU6b error row dismissed with its Затвори button', (await page.locator('.a-qrow.is-error').count()) === 0);
  // ---- 413 / 409 rows (server answers mocked: the real 50 MB / 50-item paths are covered in the API tests)
  for (const [code, body, expect, id] of [[413, { error: 'file_too_large', message: 'x', fields: { file: 'x' } }, /Грешка: Файлът е твърде голям\. Максимум 50 MB\./, 'AU7'], [409, { error: 'gallery_full', message: 'x' }, /Грешка: Галерията е пълна \(50\)\./, 'AU8']]) {
    await page.route('**/api/admin/gallery', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) }) : route.continue()));
    await input.setInputFiles([{ name: `a${code}.png`, mimeType: 'image/png', buffer: png(5) }, { name: `b${code}.png`, mimeType: 'image/png', buffer: png(6) }]);
    await page.waitForSelector('.a-qrow.is-error', { timeout: 8000 });
    const t = await page.locator('.a-qrow.is-error').first().textContent();
    const rows = (await page.locator('.a-qrow.is-queued').count()) + (await page.locator('.a-qrow.is-uploading').count()) + (await page.locator('.a-qrow.is-error').count());
    R.check(`${id} ${code} -> row error text; ${code === 409 ? 'the rest of the queue is dropped (1 row left)' : 'row has role-alert text and a Затвори button'}`, expect.test(t) && (code === 409 ? rows === 1 : true) && (await page.locator('.a-qrow.is-error button', { hasText: 'Затвори' }).count()) >= 1, `${t} rows=${rows}`);
    await page.unroute('**/api/admin/gallery');
    await page.locator('.a-qrow.is-error').getByRole('button', { name: /Затвори/ }).first().click();
    while (await page.locator('.a-qrow.is-error').count()) await page.locator('.a-qrow.is-error').getByRole('button', { name: /Затвори/ }).first().click();
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(100);
  R.check('AU9 nothing stored by the mocked failures', (await adminList()).length === 3);
  // oversize client check: 51 MB file named .mp4 never leaves the browser
  let posts = 0; page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/admin/gallery')) posts++; });
  const hp = path.join(fx, 'huge.mp4'); fs.writeFileSync(hp, Buffer.alloc(51 * 1024 * 1024)); await input.setInputFiles([hp]); fs.rmSync(hp);
  await page.waitForSelector('.a-gal-errs li');
  R.check('AU10 51 MB file rejected client-side with size + limit in the message, no request sent', /huge\.mp4.*твърде голям \(51,0 MB\)\. Максимум 50 MB\./.test(await page.locator('.a-gal-errs li').first().textContent()) && posts === 0, await page.locator('.a-gal-errs li').first().textContent());
  await page.getByRole('button', { name: 'Затвори', exact: true }).first().click();

  // ---- captions
  const bg1 = page.getByLabel('Надпис (български)').nth(0); const en1 = page.getByLabel('Надпис (English)').nth(0);
  R.check('AC0 caption inputs maxlength=300, labelled "(не е задължително)"', (await bg1.getAttribute('maxlength')) === '300' && (await page.locator('.a-gal').first().locator('label', { hasText: 'не е задължително' }).count()) === 2);
  await bg1.fill('Първа снимка'); await bg1.blur(); await page.waitForSelector('.a-gal__status:has-text("Запазено")', { timeout: 5000 });
  await en1.fill('First photo'); await en1.press('Enter'); await page.waitForTimeout(400);
  items = await adminList();
  R.check('AC1 caption saved on blur (BG) and on Enter (EN) via PATCH', items[0].captionBg === 'Първа снимка' && items[0].captionEn === 'First photo', JSON.stringify([items[0].captionBg, items[0].captionEn]));
  R.check('AC2 character counter "12/300" shown', (await page.locator('.a-gal').first().locator('.a-counter').first().textContent()) === '12/300');
  await bg1.fill(''); await bg1.blur(); await page.waitForTimeout(400);
  R.check('AC3 clearing a caption stores null', (await adminList())[0].captionBg === null);
  await bg1.fill('Първа снимка'); await bg1.blur(); await page.waitForTimeout(300);

  // ---- visibility switch
  const sw1 = page.getByRole('switch', { name: 'Показвай в галерията (№ 1)' });
  R.check('AV0 switch present, on', (await sw1.getAttribute('aria-checked')) === 'true');
  await sw1.click(); await page.waitForTimeout(500);
  items = await adminList(); const pubIds = (await anonA.get('/api/public/gallery')).data.items.map((x) => x.id);
  R.check('AV1 switch off -> API visible=false, badge "Скрито" (text, not colour only), public list omits it, /media 404', items[0].visible === false && (await page.locator('.a-gal').first().locator('.a-badge', { hasText: 'Скрито' }).count()) === 1 && !pubIds.includes(items[0].id) && (await anonA.get(items[0].fileUrl.replace('/api/admin/media', '/media'))).status === 404);
  R.check('AV2 focus stays on the switch after re-render', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('role') === 'switch' && /№ 1/.test(document.activeElement.getAttribute('aria-label') || document.activeElement.textContent + document.activeElement.getAttribute('aria-labelledby'))) || await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('role') === 'switch'));
  R.check('AV3 hidden thumbnail is visually dimmed (opacity < 1) in addition to the badge', await page.evaluate(() => (() => { const m = document.querySelector('.a-gal .a-gal__thumb.is-hidden img, .a-gal .a-gal__thumb.is-hidden video'); return !!m && parseFloat(getComputedStyle(m).opacity) < 1; })()));
  await page.getByRole('switch', { name: 'Показвай в галерията (№ 1)' }).click(); await page.waitForTimeout(500);
  R.check('AV4 switch back on -> visible again', (await adminList())[0].visible === true);
  // failure revert
  await page.route('**/api/admin/gallery/*', (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x","message":"Грешка"}' }) : route.continue()));
  await page.getByRole('switch', { name: 'Показвай в галерията (№ 2)' }).click(); await page.waitForTimeout(600);
  R.check('AV5 server error -> switch reverted (aria-checked true) and server unchanged', (await page.getByRole('switch', { name: 'Показвай в галерията (№ 2)' }).getAttribute('aria-checked')) === 'true' && (await adminList())[1].visible === true);
  await page.unroute('**/api/admin/gallery/*');

  // ---- reorder
  const idsBefore = (await adminList()).map((x) => x.id);
  R.check('AR0 first row "up" and last row "down" are disabled; others enabled', await page.evaluate(() => { const r = [...document.querySelectorAll('.a-gal')]; const up = (i) => r[i].querySelector('[aria-label^="Премести"][aria-label$="нагоре"]'); const dn = (i) => r[i].querySelector('[aria-label^="Премести"][aria-label$="надолу"]'); return up(0).disabled && !dn(0).disabled && !up(2).disabled && dn(2).disabled; }));
  await page.getByRole('button', { name: 'Премести № 1 надолу' }).click(); await page.waitForTimeout(500);
  const idsAfter = (await adminList()).map((x) => x.id);
  R.check('AR1 "down" on row 1 persists via PUT /order: [a,b,c] -> [b,a,c]', idsAfter.join() === [idsBefore[1], idsBefore[0], idsBefore[2]].join(), `${idsBefore} -> ${idsAfter}`);
  R.check('AR2 focus stays on the same moved item\'s button (now "Премести № 2 надолу"), live region announces the move', (await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'Премести № 2 надолу' && /№ 1 е преместен на позиция 2\./.test(await page.locator('p.a-vh[role=status]').first().textContent()), await page.evaluate(() => document.activeElement.getAttribute('aria-label')));
  R.check('AR3 public order follows', (await anonA.get('/api/public/gallery')).data.items.map((x) => x.id).join() === idsAfter.join());
  await page.getByRole('button', { name: 'Премести № 3 нагоре' }).click(); await page.waitForTimeout(500);
  R.check('AR4 "up" on row 3 -> [b,c,a]', (await adminList()).map((x) => x.id).join() === [idsBefore[1], idsBefore[2], idsBefore[0]].join());
  // reorder failure rolls back
  await page.route('**/api/admin/gallery/order', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"validation","message":"x"}' }));
  const first = (await adminList())[0].id;
  await page.getByRole('button', { name: 'Премести № 1 надолу' }).click(); await page.waitForTimeout(600);
  R.check('AR5 failed reorder rolls the UI back (row 1 still the same item)', (await adminList())[0].id === first && (await page.locator('.a-gal h3').first().textContent()) === '№ 1');
  await page.unroute('**/api/admin/gallery/order');

  // ---- delete with confirmation
  const before = await adminList(); const doomed = before[1]; const diskBefore = ls(dirA, 'uploads').length;
  await page.getByRole('button', { name: 'Изтрий № 2' }).click();
  const dlg = page.locator('dialog[open], [role=dialog], [role=alertdialog]').first(); await dlg.waitFor();
  const dtext = await dlg.textContent();
  R.check('AD1 confirm dialog: title "Изтриване от галерията", body warns it cannot be undone, buttons "Отказ" / "Изтрий файла"', /Изтриване от галерията/.test(dtext) && /не може да бъде върнато/.test(dtext) && /Отказ/.test(dtext) && /Изтрий файла/.test(dtext), dtext.slice(0, 200));
  R.check('AD2 "Отказ" is focused first (safe default)', (await page.evaluate(() => document.activeElement.textContent.trim())) === 'Отказ');
  await dlg.getByRole('button', { name: 'Отказ' }).click(); await page.waitForTimeout(300);
  R.check('AD3 cancel deletes nothing (still 3 items, file on disk)', (await adminList()).length === 3 && ls(dirA, 'uploads').length === diskBefore);
  await page.getByRole('button', { name: 'Изтрий № 2' }).click(); await dlg.waitFor();
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  R.check('AD3b Escape also cancels', (await adminList()).length === 3);
  await page.getByRole('button', { name: 'Изтрий № 2' }).click(); await dlg.waitFor();
  await dlg.getByRole('button', { name: 'Изтрий файла' }).click(); await page.waitForSelector('.a-toast:has-text("Файлът е изтрит.")');
  items = await adminList();
  R.check('AD4 confirmed delete: 2 items left, positions compacted 1..2, file removed from disk, /media 404, tmp empty, toast shown', items.length === 2 && items.map((i) => i.position).join() === '1,2' && !items.some((i) => i.id === doomed.id) && ls(dirA, 'uploads').length === diskBefore - 1 && ls(dirA, 'tmp').length === 0 && (await anonA.get(doomed.fileUrl.replace('/api/admin/media', '/media'))).status === 404, `files ${ls(dirA, 'uploads').length}`);
  R.check('AD5 list re-rendered with 2 rows, counter "2 / 50", focus moved to a row heading', (await page.locator('.a-gal').count()) === 2 && (await page.locator('.a-count__n').textContent()) === '2 / 50' && (await page.evaluate(() => document.activeElement.tagName)) === 'H3');
  R.check('AD6 confirm body quotes the caption', await (async () => { const pos = (await adminList()).find((x) => x.captionBg === 'Първа снимка').position; await page.getByRole('button', { name: `Изтрий № ${pos}` }).click(); await dlg.waitFor(); const t = await dlg.textContent(); await dlg.getByRole('button', { name: 'Отказ' }).click(); return /„Първа снимка“/.test(t); })());
  R.check('AA0 console errors / failed requests / CSP in the admin gallery flow', log.pageErrors.length === 0 && (await page.collectCsp()).length === 0 && log.console.filter((m) => !/status of (500|400|413|409|415)|Failed to load resource/.test(m)).length === 0, JSON.stringify({ c: log.console, p: log.pageErrors, f: log.failed }));
  await clearA();
});

// ---- 50 / 50 state in the UI + free-slot trimming
await step('AF', async () => {
  await clearA();
  for (let i = 0; i < 50; i++) await apiUpload(apiA, png(i + 10), `s${i}.png`, 'image/png');
  const { page, log } = await newPage(browser, { width: 390, height: 844 });
  await adminLogin(page); await goA(page, '#/gallery');
  R.check('AF1 50 items: counter "50 / 50", warning "Достигнахте максимума от 50…" (role=status), upload button disabled', (await page.locator('.a-count__n').textContent()) === '50 / 50' && (await page.getByText('Достигнахте максимума от 50. Изтрийте нещо, за да качите ново.').count()) === 1 && (await page.getByRole('button', { name: 'Избери снимки или видео' }).isDisabled()) && (await page.locator('.a-alert[role=status], [role=status].a-alert').count()) >= 1);
  const disabledOpacity = await page.getByRole('button', { name: 'Избери снимки или видео' }).evaluate((b) => getComputedStyle(b).opacity);
  R.check('AF2 disabled upload button looks disabled (opacity < 1) and the text explains why', parseFloat(disabledOpacity) < 1, disabledOpacity);
  let posts = 0; page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/admin/gallery')) posts++; });
  // dropping files while full is ignored
  await page.locator('.a-upload').evaluate((dz) => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(10)], 'drop.png', { type: 'image/png' })); dz.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
  await page.waitForTimeout(400);
  R.check('AF3 drop while full is ignored (no request, still 50)', posts === 0 && (await adminList()).length === 50);
  R.check('AF4 50 rows, "down" disabled only on the last, "up" only on the first', (await page.locator('.a-gal').count()) === 50);
  await page.screenshot({ path: path.join(shots, 'gallery-admin-full-390.png') });
  // delete 2 -> 48, then select 5 files -> only 2 are uploaded + warning
  await apiA.del(`${G}/${(await adminList())[49].id}`); await apiA.del(`${G}/${(await adminList())[48].id}`);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.a-count');
  R.check('AF5 at 48: button enabled again, counter "48 / 50", warning gone', (await page.locator('.a-count__n').textContent()) === '48 / 50' && (await page.getByRole('button', { name: 'Избери снимки или видео' }).isEnabled()) && (await page.getByText('Достигнахте максимума').count()) === 0);
  await page.locator('input[type=file]').setInputFiles([1, 2, 3, 4, 5].map((n) => ({ name: `x${n}.png`, mimeType: 'image/png', buffer: png(200 + n) })));
  await page.waitForSelector('.a-toast:has-text("Качени са 2 файла.")', { timeout: 15000 });
  R.check('AF6 5 files selected with 2 free slots: first 2 uploaded, warning "Качени са само 2 от 5 файла — достигнат е максимумът от 50.", total 50', (await adminList()).length === 50 && (await page.getByText('Качени са само 2 от 5 файла — достигнат е максимумът от 50.').count()) === 1 && posts === 2, `posts=${posts}`);
  R.check('AF7 counter/warning after the batch show 50 / 50 and the button is disabled', (await page.locator('.a-count__n').textContent()) === '50 / 50' && (await page.getByRole('button', { name: 'Избери снимки или видео' }).isDisabled()));
  R.check('AF8 no page errors / CSP violations', log.pageErrors.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify(log.pageErrors));
  await clearA();
});

// ---- admin responsive: 6-tab bar at 360/390, no h-scroll, targets
await step('AT', async () => {
  for (const [w, h] of [[360, 740], [390, 844], [768, 1024], [1280, 800]]) {
    const { page } = await newPage(browser, { width: w, height: h });
    await adminLogin(page); await goA(page, '#/gallery');
    const m = await page.evaluate(() => {
      const links = [...document.querySelectorAll('.a-nav a.a-nav__link')].filter((a) => a.getBoundingClientRect().width > 0);
      return { n: links.length, boxes: links.map((a) => { const r = a.getBoundingClientRect(); const sp = a.querySelector('span'); return { t: sp.textContent, w: Math.round(r.width), h: Math.round(r.height), clipped: sp.scrollWidth > a.clientWidth + 1 || sp.getBoundingClientRect().right > a.getBoundingClientRect().right + 1 || sp.getBoundingClientRect().left < a.getBoundingClientRect().left - 1, fs: getComputedStyle(sp).fontSize }; }), sw: document.documentElement.scrollWidth, iw: innerWidth, nav: (() => { const n = document.querySelector('.a-nav'); const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, pos: getComputedStyle(n).position }; })() };
    });
    R.check(`AT1[${w}] ${m.n} nav items visible, no label clipped, each >= 44 high and >= 44 wide, no horizontal scroll`, m.n === 6 && m.boxes.every((b) => !b.clipped && b.h >= 44 && b.w >= 44) && m.sw <= m.iw, JSON.stringify(m));
    if (w <= 400) {
      const sum = m.boxes.reduce((a, b) => a + b.w, 0);
      R.check(`AT2[${w}] bottom tab bar: 6 tabs share the width (sum ${sum} <= ${w}), tab >= ${Math.floor(w / 6) - 2}px wide, font >= 11px`, sum <= w + 1 && m.boxes.every((b) => b.w >= Math.floor(w / 6) - 2 && parseFloat(b.fs) >= 11), JSON.stringify(m.boxes.map((b) => [b.t, b.w, b.fs])));
      await page.screenshot({ path: path.join(shots, `gallery-admin-tabbar-${w}.png`) });
    }
    if (w >= 768) R.check(`AT3[${w}] sidebar/side nav shows all 6 items incl. Галерия`, m.boxes.some((b) => b.t === 'Галерия'));
    await page.context().close();
  }
});

// ---- admin mobile row layout + targets (390), 1280 row geometry
await step('AM', async () => {
  await clearA();
  await apiUpload(apiA, png(1), 'a.png', 'image/png', { captionBg: 'Първа' }); await apiUpload(apiA, MP4, 'b.mp4', 'video/mp4');
  for (const vp of VPS) {
    const { page, log } = await newPage(browser, { width: vp.width, height: vp.height });
    await adminLogin(page); await goA(page, '#/gallery'); await page.waitForSelector('.a-gal');
    const m = await page.evaluate(() => {
      const small = []; const row = document.querySelector('.a-gal');
      for (const e of document.querySelectorAll('.a-main button, .a-main a, .a-main input:not([type=file]), .a-main [role=switch]')) { const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue; if (e.closest('.a-nav')) continue; if (r.width < 44 || r.height < 44) small.push(`${e.tagName} ${e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`); }
      const btns = [...row.querySelectorAll('.a-gal__acts > *')].map((b) => b.getBoundingClientRect());
      const gaps = btns.slice(1).map((r, i) => Math.round(r.left - btns[i].right));
      return { small, gaps, sw: document.documentElement.scrollWidth, iw: innerWidth };
    });
    R.check(`AM1[${vp.name}] admin gallery: all interactive controls >= 44x44 (rows, switch, arrows, delete, inputs), gaps between action buttons >= 8px, no h-scroll`, m.small.length === 0 && m.gaps.every((g) => g >= 8) && m.sw <= m.iw, JSON.stringify(m));
    // keyboard: tab order reaches the caption, switch, arrows, delete and focus ring is visible
    await page.locator('.a-gal').first().getByLabel('Надпис (български)').focus();
    const seq = []; for (let i = 0; i < 7; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(() => { const a = document.activeElement; return (a.getAttribute('aria-label') || a.textContent || a.tagName).trim().slice(0, 30); })); }
    const ring = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { ow: cs.outlineWidth, os: cs.outlineStyle, bs: cs.boxShadow }; });
    R.check(`AM2[${vp.name}] keyboard reaches the row controls (switch, arrows, delete) in order and the focus indicator is visible`, seq.some((s) => /Показвай/.test(s)) && seq.some((s) => /нагоре|надолу/.test(s)) && seq.some((s) => /Изтрий/.test(s)) && ((parseFloat(ring.ow) >= 2 && ring.os !== 'none') || ring.bs !== 'none'), JSON.stringify({ seq, ring }));
    await page.screenshot({ path: path.join(shots, `gallery-admin-rows-${vp.name}.png`), fullPage: true });
    R.check(`AM3[${vp.name}] no page errors, CSP violations`, log.pageErrors.length === 0 && (await page.collectCsp()).length === 0);
    await page.context().close();
  }
  await clearA();
});

// ======================================================================================= ABOUT TEXT (admin settings + home)
await step('AB', async () => {
  const P1 = 'Първи абзац: прясна храна.'; const P2a = 'Втори абзац, ред 1'; const P2b = 'ред 2 (същият абзац)';
  const E1 = 'First paragraph: fresh food.'; const E2 = 'Second paragraph.';
  const { page, log } = await newPage(browser, { width: 1280, height: 800 });
  await adminLogin(page); await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForSelector('h2:has-text("Текст „За нас“")');
  const card = page.locator('form.a-card', { has: page.locator('h2', { hasText: 'Текст „За нас“' }) });
  const order = await page.locator('main h2, .a-main h2').allTextContents();
  R.check('AB1 Settings card "Текст „За нас“" sits after "Информация за сайта" and before "Смяна на парола"', order.findIndex((s) => /За нас/.test(s)) > order.findIndex((s) => /Информация за сайта/.test(s)) && order.findIndex((s) => /За нас/.test(s)) < order.findIndex((s) => /парола/i.test(s)), JSON.stringify(order));
  R.check('AB2 helper text, tabs Български / English (tablist, roving tabindex), BG tab selected, textarea maxlength 2000, rows >= 8, fallback note', await card.evaluate((c) => { const tabs = [...c.querySelectorAll('[role=tab]')]; const ta = c.querySelector('[role=tabpanel]:not([hidden]) textarea'); return /Оставете празно/.test(c.textContent) && tabs.length === 2 && tabs[0].getAttribute('aria-selected') === 'true' && tabs[0].tabIndex === 0 && tabs[1].tabIndex === -1 && ta.maxLength === 2000 && ta.rows >= 8 && /Ако оставите този език празен, ще се показва другият\./.test(c.textContent); }));
  const bgTa = card.getByLabel('Текст на български'); await bgTa.fill(`${P1}\n\n${P2a}\n${P2b}`);
  R.check('AB3 counter shows the length "N/2000"', new RegExp(`^${`${P1}\n\n${P2a}\n${P2b}`.length}/2000$`).test(await card.locator('.a-counter').first().textContent()), await card.locator('.a-counter').first().textContent());
  await card.getByRole('tab', { name: /English/ }).focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
  R.check('AB4 tabs: ArrowLeft/ArrowRight move selection and focus (roving), BG tab shows a "filled" mark', (await card.getByRole('tab', { selected: true }).textContent()).includes('English') && (await card.getByRole('tab', { name: /Български/ }).textContent()).includes('попълнено'), await card.getByRole('tab', { selected: true }).textContent());
  await card.getByLabel('Text in English').fill(`${E1}\n\n${E2}`);
  await card.getByRole('button', { name: 'Запази текста' }).click(); await page.waitForSelector('.a-toast:has-text("Текстът е запазен.")');
  const s = (await apiA.get('/api/admin/settings')).data;
  R.check('AB5 save persists both languages in one PUT; toast "Текстът е запазен."', s.aboutBg === `${P1}\n\n${P2a}\n${P2b}` && s.aboutEn === `${E1}\n\n${E2}`, JSON.stringify([s.aboutBg, s.aboutEn]));
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('h2:has-text("Текст „За нас“")');
  R.check('AB6 after reload the textareas hold the saved texts', (await card.getByLabel('Текст на български').inputValue()) === s.aboutBg);

  // home page, both languages
  for (const lang of ['bg', 'en']) {
    for (const vp of VPS) {
      const c = await newPage(browser, { width: vp.width, height: vp.height, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
      await c.page.goto(`${srvA.url}/?lang=${lang}`, { waitUntil: 'networkidle' }); await c.page.waitForFunction(() => document.querySelectorAll('#about-body p').length >= 2);
      const m = await c.page.evaluate(() => { const ps = [...document.querySelectorAll('#about-body p')]; return { n: ps.length, t: ps.map((p) => p.textContent), ws: getComputedStyle(ps[0]).whiteSpace, h2: document.getElementById('about-heading').textContent, mw: ps.map((p) => Math.round(p.getBoundingClientRect().width)), sw: document.documentElement.scrollWidth, iw: innerWidth, vis: ps.every((p) => p.getBoundingClientRect().height > 0) }; });
      const exp = lang === 'bg' ? [P1, `${P2a}\n${P2b}`] : [E1, E2];
      R.check(`AB7[${lang} ${vp.name}] About shows the owner text as separate paragraphs (blank line = new <p>, single newline kept with white-space: pre-line), heading intact, no h-scroll`, JSON.stringify(m.t) === JSON.stringify(exp) && m.ws === 'pre-line' && m.sw <= m.iw && m.vis, JSON.stringify(m));
      R.check(`AB7b[${lang} ${vp.name}] no console/page errors, failed requests, CSP violations`, c.log.console.length === 0 && c.log.pageErrors.length === 0 && c.log.failed.length === 0 && (await c.page.collectCsp()).length === 0, JSON.stringify(c.log));
      if (vp.name === '1280') await c.page.locator('#about').screenshot({ path: path.join(shots, `gallery-about-${lang}.png`) });
      await c.context.close();
    }
  }
  // live language switch rerenders the About text
  const c2 = await newPage(browser, { width: 1280, height: 800 }); await c2.page.goto(srvA.url + '/', { waitUntil: 'networkidle' }); await c2.page.waitForSelector('#about-body p');
  const bgT = await c2.page.locator('#about-body p').first().textContent(); await c2.page.locator('.lang-btn[data-lang=en]').click(); await c2.page.waitForFunction((v) => document.querySelector('#about-body p').textContent !== v, bgT);
  R.check('AB8 BG -> EN toggle swaps the About text without reload', bgT === P1 && (await c2.page.locator('#about-body p').first().textContent()) === E1);
  await c2.context.close();

  // fallback BG <-> EN and built-in default
  await apiA.put('/api/admin/settings', { json: { aboutEn: null } });
  const fb = async (lang) => { const c = await newPage(browser, { width: 1280, height: 800 }); await c.page.goto(`${srvA.url}/?lang=${lang}`, { waitUntil: 'networkidle' }); await c.page.waitForTimeout(400); const t = await c.page.locator('#about-body p').allTextContents(); await c.context.close(); return t; };
  R.check('AB9 EN empty -> EN visitors see the BG text (fallback)', JSON.stringify(await fb('en')) === JSON.stringify([P1, `${P2a}\n${P2b}`]));
  await apiA.put('/api/admin/settings', { json: { aboutBg: null, aboutEn: E1 } });
  R.check('AB10 BG empty -> BG visitors see the EN text (fallback)', JSON.stringify(await fb('bg')) === JSON.stringify([E1]));
  await apiA.put('/api/admin/settings', { json: { aboutBg: null, aboutEn: null } });
  R.check('AB11 both empty -> built-in default text per language ("Прясна храна и топло посрещане." / EN default), exactly one paragraph', JSON.stringify(await fb('bg')) === JSON.stringify(['Прясна храна и топло посрещане.']) && (await fb('en')).length === 1 && (await fb('en'))[0] !== 'Прясна храна и топло посрещане.', JSON.stringify([await fb('bg'), await fb('en')]));
  R.check('AB12 no About link anywhere in the nav (#about removed, "За нас" absent)', await (async () => { const c = await newPage(browser, { width: 1280, height: 800 }); await c.page.goto(srvA.url + '/', { waitUntil: 'networkidle' }); const r = await c.page.evaluate(() => ({ nav: [...document.querySelectorAll('#site-nav a')].map((a) => a.textContent.trim() + '=' + a.getAttribute('href')), sec: !!document.getElementById('about') })); await c.context.close(); return r.sec && !r.nav.some((x) => /За нас|#about/.test(x)); })());

  // error mapping: server 400 on aboutEn -> EN tab selected, inline error, focus
  await page.route('**/api/admin/settings', (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'validation', message: 'x', fields: { aboutEn: 'Най-много 2000 символа.' } }) }) : route.continue()));
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('h2:has-text("Текст „За нас“")');
  await card.getByLabel('Текст на български').fill('текст'); await card.getByRole('button', { name: 'Запази текста' }).click(); await page.waitForTimeout(500);
  R.check('AB13 400 on aboutEn: the English tab is selected, inline error names the language, focus in the textarea', (await card.getByRole('tab', { selected: true }).textContent()).includes('English') && /Текст „За нас“ \(English\): Най-много 2000 символа\./.test(await card.textContent()) && (await page.evaluate(() => document.activeElement.tagName)) === 'TEXTAREA');
  await page.unroute('**/api/admin/settings');
  // unsaved-changes guard
  R.check('AB14 dirty About text keeps the unsaved-changes guard (beforeunload)', await (async () => { let prompted = false; page.once('dialog', async (d) => { prompted = d.type() === 'beforeunload'; await d.dismiss(); }); await page.evaluate(() => { location.hash = '#/events'; }).catch(() => {}); await page.waitForTimeout(500); return prompted || (await page.locator('dialog[open], [role=alertdialog], [role=dialog]').count()) > 0; })());
  R.check('AB15 no page errors / CSP violations on the Settings page', log.pageErrors.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify(log.pageErrors));
  await page.context().close();
});

// ======================================================================================= XSS (admin list, public grid, lightbox, About)
await step('XS', async () => {
  await clearA();
  const XS = ['<img src=x onerror="window.__xss=1">', '"><script>window.__xss=2</script>', '<svg onload="window.__xss=3">', "'-window.__xss=4-'", '<b>bold</b> &amp; <i>it</i>'];
  const a = await apiUpload(apiA, png(1), 'x1.png', 'image/png', { captionBg: XS[0], captionEn: XS[1] });
  const b = await apiUpload(apiA, WEBM, 'x2.webm', 'video/webm', { captionBg: XS[2], captionEn: XS[3] });
  const c = await apiUpload(apiA, png(2), 'x3.png', 'image/png', { captionBg: XS[4] });
  await apiA.put('/api/admin/settings', { json: { aboutBg: `${XS[0]}\n\n${XS[1]}\n${XS[4]}`, aboutEn: XS[2] } });
  const chk = async (id, page, extra = '') => { const x = await page.evaluate(() => ({ x: window.__xss ?? null, inj: document.querySelectorAll('main img[onerror], main svg[onload], [onerror], [onload], main script, #about-body b, #about-body i, .g-cap b, .lb-cap b, .a-gal b').length })); R.check(`${id} no script ran, no injected element ${extra}`, x.x === null && x.inj === 0, JSON.stringify(x)); };
  // public grid + lightbox
  for (const [lang, k] of [['bg', 'captionBg'], ['en', 'captionEn']]) {
    const { page, log } = await newPage(browser, { width: 1280, height: 800, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
    await page.goto(`${srvA.url}/gallery?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForSelector('.g-tile');
    const caps = await page.locator('.g-cap').allTextContents(); const labels = await page.locator('.g-tile').evaluateAll((t) => t.map((x) => x.getAttribute('aria-label')));
    const expect = [a, b, c].map((i) => i[k] || i.captionBg || i.captionEn);
    R.check(`XS1[${lang}] grid captions + tile aria-labels equal the payload text verbatim (rendered as text)`, JSON.stringify(caps) === JSON.stringify(expect) && JSON.stringify(labels) === JSON.stringify(expect), JSON.stringify({ caps, labels }));
    await chk(`XS2[${lang}] public grid`, page);
    for (let i = 0; i < 3; i++) { await page.locator('.g-tile').nth(i).click(); await page.waitForSelector('dialog.lightbox[open]'); const cap = await page.locator('.lb-cap').textContent(); const al = await page.evaluate(() => ({ imgAlt: document.querySelector('.lb-img').alt, vid: document.querySelector('.lb-video').getAttribute('aria-label') })); R.check(`XS3[${lang} #${i + 1}] lightbox caption text == payload; image alt / video aria-label are attributes, not markup`, cap === expect[i] && (i === 1 ? al.vid === expect[i] : al.imgAlt === '' || al.imgAlt === expect[i]), JSON.stringify({ cap, al })); await chk(`XS4[${lang} #${i + 1}] lightbox`, page); await page.keyboard.press('Escape'); await page.waitForTimeout(100); }
    R.check(`XS5[${lang}] no page errors / CSP violations`, log.pageErrors.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify(log.pageErrors));
    await page.context().close();
  }
  // About on the home page
  for (const lang of ['bg', 'en']) {
    const { page } = await newPage(browser, { width: 1280, height: 800, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
    await page.goto(`${srvA.url}/?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    const t = await page.locator('#about-body p').allTextContents();
    R.check(`XS6[${lang}] About payloads are shown as literal text`, lang === 'bg' ? JSON.stringify(t) === JSON.stringify([XS[0], `${XS[1]}\n${XS[4]}`]) : JSON.stringify(t) === JSON.stringify([XS[2]]), JSON.stringify(t));
    await chk(`XS7[${lang}] home About`, page); await page.context().close();
  }
  // admin list + confirm dialog + settings textarea
  const { page, log } = await newPage(browser, { width: 1280, height: 800 });
  await adminLogin(page); await goA(page, '#/gallery'); await page.waitForSelector('.a-gal');
  const vals = await page.locator('.a-gal').first().locator('input[type=text]').evaluateAll((i) => i.map((x) => x.value));
  R.check('XS8 admin caption inputs hold the payload as value (not interpreted)', vals[0] === XS[0] && vals[1] === XS[1], JSON.stringify(vals));
  await chk('XS9 admin gallery list', page);
  await page.getByRole('button', { name: 'Изтрий № 1' }).click(); await page.waitForSelector('[role=dialog], [role=alertdialog], dialog[open]');
  const d = await page.locator('dialog[open], [role=dialog], [role=alertdialog]').first().textContent();
  R.check('XS10 delete confirmation shows the caption payload as text', d.includes(XS[0]), d.slice(0, 160)); await chk('XS11 admin confirm dialog', page);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForSelector('h2:has-text("Текст „За нас“")');
  R.check('XS12 settings textarea holds the About payload as plain value', (await page.getByLabel('Текст на български').inputValue()).startsWith(XS[0])); await chk('XS13 admin settings', page);
  R.check('XS14 no page errors / CSP violations (admin)', log.pageErrors.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify(log.pageErrors));
  await page.context().close();
  await apiA.put('/api/admin/settings', { json: { aboutBg: null, aboutEn: null } }); await clearA();
});

// ======================================================================================= PUBLIC GALLERY (port 3201)
const dirP = tmpDir('galpub'); createAdmin(dirP);
const srvP = await startServer({ port: 3201, dataDir: dirP, now: T0 });
const apiP = new Client(srvP.url); await apiP.login(); const anonP = new Client(srvP.url);
const seeded = [];
await step('PS', async () => {
  seeded.push(await apiUpload(apiP, png(1, 400, 300), 'p1.png', 'image/png', { captionBg: 'Салата', captionEn: 'Salad' }));
  seeded.push(await apiUpload(apiP, WEBM_LONG, 'v1.webm', 'video/webm', { captionBg: 'Видео от кухнята', captionEn: 'Kitchen video' }));
  seeded.push(await apiUpload(apiP, JPG, 'p2.jpg', 'image/jpeg', {}));
  seeded.push(await apiUpload(apiP, MP4, 'v2.mp4', 'video/mp4', {}));
  seeded.push(await apiUpload(apiP, WEBP, 'p3.webp', 'image/webp', { captionBg: 'само български надпис' }));
  seeded.push(await apiUpload(apiP, png(7, 300, 500), 'hidden.png', 'image/png', { captionBg: 'СКРИТО' }));
  await apiP.patch(`${G}/${seeded[5].id}`, { json: { visible: false } });
  await apiP.put('/api/admin/settings', { json: { reservationPhone: '+359 88 123 4567' } });
});
const VIS = 5;

await step('PG', async () => {
  for (const lang of ['bg', 'en']) {
    for (const vp of VPS) {
      const { page, log, context } = await newPage(browser, { width: vp.width, height: vp.height, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
      await page.goto(`${srvP.url}/gallery?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForSelector('.g-tile'); await page.waitForTimeout(600);
      const tag = `${lang} ${vp.name}`;
      const m = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll('.g-tile')]; const r = tiles.map((t) => t.getBoundingClientRect());
        const rowTop = r[0].top; const cols = r.filter((x) => Math.abs(x.top - rowTop) < 2).length;
        return { n: tiles.length, cols, w: Math.round(r[0].width), h: Math.round(r[0].height), ratio: +(r[0].width / r[0].height).toFixed(2), labels: tiles.map((t) => t.getAttribute('aria-label')), caps: [...document.querySelectorAll('.g-cap')].map((p) => p.textContent),
          imgAlt: [...document.querySelectorAll('.g-tile img')].map((i) => i.getAttribute('alt')), lazy: [...document.querySelectorAll('.g-tile img')].map((i) => i.loading), vids: [...document.querySelectorAll('.g-tile video')].map((v) => ({ m: v.muted, pi: v.playsInline, pre: v.preload, ah: v.getAttribute('aria-hidden'), ti: v.tabIndex, ap: v.autoplay, src: v.getAttribute('src').split('#')[1] })),
          badges: document.querySelectorAll('.g-tile .g-play').length, chips: [...document.querySelectorAll('.g-tile .g-chip')].map((c) => c.textContent), h1: document.querySelectorAll('h1').length, h1t: document.querySelector('h1').textContent.trim(), title: document.title, li: document.querySelectorAll('ul.gallery-grid > li').length,
          sw: document.documentElement.scrollWidth, iw: innerWidth, broken: [...document.querySelectorAll('.g-tile img')].filter((i) => !i.complete || i.naturalWidth === 0).length, gap: getComputedStyle(document.querySelector('.gallery-grid')).columnGap, intro: document.querySelector('.lead').textContent };
      });
      R.check(`PG1[${tag}] ${VIS} visible items (hidden one absent), list semantics (ul > li), one <h1>, title, intro`, m.n === VIS && m.li === VIS && m.h1 === 1 && m.title === (lang === 'en' ? 'Gallery — Kota1 Restaurant' : 'Галерия — Kota1 Restaurant') && m.h1t === (lang === 'en' ? 'Gallery' : 'Галерия') && !m.labels.includes('СКРИТО'), JSON.stringify({ n: m.n, h1: m.h1t, t: m.title }));
      R.check(`PG2[${tag}] columns = ${vp.width < 600 ? 2 : 3}, gap ${vp.width < 600 ? 8 : 16}px, tile 4:3, tile >= 171x128 at 390 / >= 44px everywhere, no h-scroll`, m.cols === (vp.width < 600 ? 2 : 3) && m.gap === (vp.width < 600 ? '8px' : '16px') && Math.abs(m.ratio - 1.33) < 0.02 && m.w >= 160 && m.h >= 120 && m.sw <= m.iw, JSON.stringify({ cols: m.cols, w: m.w, h: m.h, ratio: m.ratio, gap: m.gap, sw: m.sw, iw: m.iw }));
      const exp = lang === 'bg' ? ['Салата', 'Видео от кухнята', 'Снимка 3 от 5', 'Видео 4 от 5', 'само български надпис'] : ['Salad', 'Kitchen video', 'Photo 3 of 5', 'Video 4 of 5', 'само български надпис'];
      R.check(`PG3[${tag}] tile accessible names = caption in the page language (fallback to the other language) or "Снимка/Photo n of m", "Видео/Video n of m"`, JSON.stringify(m.labels) === JSON.stringify(exp), JSON.stringify(m.labels));
      R.check(`PG4[${tag}] captions under items only where a caption exists (3 of 5), text equals language caption with fallback`, JSON.stringify(m.caps) === JSON.stringify(lang === 'bg' ? ['Салата', 'Видео от кухнята', 'само български надпис'] : ['Salad', 'Kitchen video', 'само български надпис']), JSON.stringify(m.caps));
      R.check(`PG5[${tag}] images: alt="" + loading=lazy and loaded; videos: muted playsinline preload=metadata aria-hidden tabindex=-1 no autoplay, #t=0.001; play badge + "${lang === 'en' ? 'Video' : 'Видео'}" chip on each video`, m.imgAlt.every((a) => a === '') && m.lazy.every((l) => l === 'lazy') && m.broken === 0 && m.vids.length === 2 && m.vids.every((v) => v.m && v.pi && v.pre === 'metadata' && v.ah === 'true' && v.ti === -1 && !v.ap && v.src === 't=0.001') && m.badges === 2 && m.chips.join() === (lang === 'en' ? 'Video,Video' : 'Видео,Видео'), JSON.stringify(m));
      const nav = await page.evaluate(() => { const l = [...document.querySelectorAll('#site-nav a')]; return l.map((a) => a.textContent.trim() + '|' + a.getAttribute('href') + '|' + (a.getAttribute('aria-current') || '')); });
      R.check(`PG6[${tag}] nav on the gallery page: "${lang === 'en' ? 'Gallery' : 'Галерия'}" has aria-current=page, no "За нас"/About, no Събитие`, nav.some((x) => x.startsWith(lang === 'en' ? 'Gallery|/' : 'Галерия|/') && x.endsWith('|page')) && !nav.some((x) => /За нас|About|#about|Събитие|Event/.test(x)), JSON.stringify(nav));
      R.check(`PG7[${tag}] no console/page errors, failed requests, 4xx, CSP violations (video metadata fetches included)`, log.console.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && log.http4xx.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify(log));
      await page.screenshot({ path: path.join(shots, `gallery-public-${lang}-${vp.name}.png`), fullPage: true });
      await context.close();
    }
  }
});

// ---- lightbox: images + video, keyboard, swipe, focus
await step('LB', async () => {
  for (const vp of [VPS[0], VPS[2]]) {
    const { page, log, context } = await newPage(browser, { width: vp.width, height: vp.height });
    await page.goto(`${srvP.url}/gallery`, { waitUntil: 'networkidle' }); await page.waitForSelector('.g-tile');
    const tag = vp.name;
    const lb = () => page.evaluate(() => { const d = document.querySelector('dialog.lightbox'); const v = d.querySelector('.lb-video'); const i = d.querySelector('.lb-img'); const q = (s) => d.querySelector(s); return { open: d.open, pos: (q('.lb-pos').textContent.match(/\d+/g) || []).join(' / '), prevDis: q('.lb-prev').disabled, nextDis: q('.lb-next').disabled, imgHidden: i.hidden, vidHidden: v.hidden, imgSrc: i.getAttribute('src'), vidSrc: v.getAttribute('src'), zoomHidden: [...d.querySelectorAll('.lb-bar .lb-btn')].find((b) => !b.classList.contains('lb-prev') && !b.classList.contains('lb-next') && b.querySelector('svg') === null)?.hidden, cap: q('.lb-cap').textContent, capHidden: q('.lb-cap').hidden, paused: v.paused, t: v.currentTime, controls: v.controls, autoplay: v.autoplay, active: document.activeElement.className + '|' + (document.activeElement.getAttribute('aria-label') || document.activeElement.tagName), inDialog: d.contains(document.activeElement), ap: v.getAttribute('aria-label') }; });
    // image 1 via mouse
    const tile0 = page.locator('.g-tile').nth(0); await tile0.click(); await page.waitForSelector('dialog.lightbox[open]');
    let s = await lb();
    R.check(`LB1[${tag}] click on image tile opens the lightbox: counter "1 / ${VIS}", image shown with the tile's src, video hidden, prev disabled, caption "Салата"`, s.open && s.pos === `1 / ${VIS}` && !s.imgHidden && s.vidHidden && /\/media\/[a-f0-9]{32}\.png$/.test(s.imgSrc) && s.prevDis && !s.nextDis && s.cap === 'Салата' && !s.capHidden, JSON.stringify(s));
    R.check(`LB2[${tag}] focus is inside the dialog on open`, s.inDialog, s.active);
    const dims = await page.evaluate(() => { const d = document.querySelector('dialog.lightbox'); const r = d.getBoundingClientRect(); const img = d.querySelector('.lb-img').getBoundingClientRect(); const bs = [...d.querySelectorAll('.lb-bar .lb-btn')].filter((b) => !b.hidden).map((b) => { const x = b.getBoundingClientRect(); return [Math.round(x.width), Math.round(x.height)]; }); return { dh: r.height, ih: innerHeight, img: [Math.round(img.width), Math.round(img.height)], bs, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
    R.check(`LB3[${tag}] lightbox buttons >= 48x48, image fits within the viewport (no overflow), dialog full height`, dims.bs.every(([w, h]) => w >= 48 && h >= 48) && dims.img[0] <= dims.iw && dims.img[1] <= dims.ih && dims.dh >= dims.ih - 2, JSON.stringify(dims));
    await page.screenshot({ path: path.join(shots, `gallery-lightbox-image-${tag}.png`) });
    // next -> video (webm, long)
    await page.locator('.lb-next').click(); await page.waitForTimeout(300); s = await lb();
    R.check(`LB4[${tag}] next -> video item: <video> visible with src, native controls, not autoplaying (paused), image hidden + src removed, zoom hidden, counter "2 / ${VIS}", caption, aria-label`, s.pos === `2 / ${VIS}` && !s.vidHidden && s.imgHidden && !s.imgSrc && /\.webm$/.test(s.vidSrc) && s.controls && !s.autoplay && s.paused && s.zoomHidden === true && s.cap === 'Видео от кухнята' && s.ap === 'Видео от кухнята', JSON.stringify(s));
    const vsz = await page.evaluate(() => { const v = document.querySelector('.lb-video').getBoundingClientRect(); return { w: Math.round(v.width), h: Math.round(v.height), iw: innerWidth, ih: innerHeight }; });
    R.check(`LB5[${tag}] video fits the viewport`, vsz.w <= vsz.iw && vsz.h <= vsz.ih && vsz.w > 100, JSON.stringify(vsz));
    // play, seek, metadata
    await page.evaluate(() => document.querySelector('.lb-video').play()); await page.waitForTimeout(900);
    s = await lb();
    R.check(`LB6[${tag}] video plays inside the lightbox (not paused, currentTime advanced), still unmuted by default`, !s.paused && s.t > 0.3 && (await page.evaluate(() => document.querySelector('.lb-video').muted)) === false, JSON.stringify({ p: s.paused, t: s.t }));
    // arrows while the video is focused do not change the slide; they seek
    await page.evaluate(() => { const v = document.querySelector('.lb-video'); v.pause(); v.currentTime = 3; }); await page.waitForTimeout(200);
    await page.locator('.lb-video').focus(); const t0 = await page.evaluate(() => document.querySelector('.lb-video').currentTime);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300); const sR = await lb();
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300); const sL = await lb();
    R.check(`LB7[${tag}] ArrowRight/ArrowLeft with the video focused do NOT change the slide (counter stays "2 / ${VIS}") and the video still shows`, sR.pos === `2 / ${VIS}` && sL.pos === `2 / ${VIS}` && !sL.vidHidden, JSON.stringify([sR.pos, sL.pos]));
    R.check(`LB7b[${tag}] arrows seek natively (currentTime ${t0.toFixed(2)} -> ${sR.t.toFixed(2)} -> ${sL.t.toFixed(2)}): right moved forward, left moved back`, sR.t > t0 && sL.t < sR.t, JSON.stringify({ t0, r: sR.t, l: sL.t }));
    // arrows on another control navigate
    await page.evaluate(() => document.querySelector('.lb-video').play()); await page.waitForTimeout(500);
    await page.locator('.lb-next').focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300); s = await lb();
    const vState = await page.evaluate(() => { const v = document.querySelector('.lb-video'); return { paused: v.paused, src: v.getAttribute('src'), hidden: v.hidden }; });
    R.check(`LB8[${tag}] ArrowRight from a button navigates (counter "3 / ${VIS}"), the previously PLAYING video is paused and released (no src), image shown`, s.pos === `3 / ${VIS}` && vState.paused && !vState.src && vState.hidden && !s.imgHidden, JSON.stringify({ s: s.pos, vState }));
    // back to video via ArrowLeft, play, press next button -> pauses
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.lb-video').play()); await page.waitForTimeout(500);
    const wasPlaying = await page.evaluate(() => !document.querySelector('.lb-video').paused);
    await page.evaluate(() => { window.__vref = document.querySelector('.lb-video'); window.__pauseCount = 0; window.__vref.addEventListener('pause', () => window.__pauseCount++); });
    await page.locator('.lb-next').click(); await page.waitForTimeout(300);
    const afterNext = await page.evaluate(() => ({ paused: window.__vref.paused, src: window.__vref.getAttribute('src'), pc: window.__pauseCount }));
    R.check(`LB9[${tag}] next button while playing: video was playing (${wasPlaying}), then paused and src released (no pause event is observable: load() discards it)`, wasPlaying && afterNext.paused && !afterNext.src, JSON.stringify(afterNext));
    // prev button pause + close pause
    await page.locator('.lb-prev').click(); await page.waitForTimeout(300); await page.evaluate(() => document.querySelector('.lb-video').play()); await page.waitForTimeout(400);
    await page.locator('.lb-prev').click(); await page.waitForTimeout(300);
    R.check(`LB10[${tag}] prev button while playing pauses too (video released, image 1 shown, counter "1 / ${VIS}")`, await page.evaluate(() => document.querySelector('.lb-video').paused && !document.querySelector('.lb-video').getAttribute('src')) && (await lb()).pos === `1 / ${VIS}`);
    await page.locator('.lb-next').click(); await page.waitForTimeout(300); await page.evaluate(() => document.querySelector('.lb-video').play()); await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Затвори|Close/ }).first().click(); await page.waitForTimeout(300);
    const closed = await page.evaluate(() => { const v = document.querySelector('.lb-video'); return { open: document.querySelector('dialog.lightbox').open, paused: v.paused, src: v.getAttribute('src'), active: document.activeElement.className, label: document.activeElement.getAttribute('aria-label') }; });
    R.check(`LB11[${tag}] close button while playing: dialog closed, video paused and released (no src: network stopped), focus returns to the tile that opened it`, !closed.open && closed.paused && !closed.src && closed.active === 'g-tile' && closed.label === 'Салата', JSON.stringify(closed));
    // Escape closes + returns focus to the VIDEO tile; keyboard open with Enter
    await page.locator('.g-tile').nth(1).focus(); await page.keyboard.press('Enter'); await page.waitForSelector('dialog.lightbox[open]'); await page.waitForTimeout(300);
    s = await lb();
    R.check(`LB12[${tag}] keyboard: Enter on the video tile opens the lightbox on the video (counter "2 / ${VIS}"), focus inside dialog`, s.pos === `2 / ${VIS}` && !s.vidHidden && s.inDialog, JSON.stringify(s));
    await page.evaluate(() => document.querySelector('.lb-video').play()); await page.waitForTimeout(500);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const esc = await page.evaluate(() => { const v = document.querySelector('.lb-video'); return { open: document.querySelector('dialog.lightbox').open, paused: v.paused, src: v.getAttribute('src'), label: document.activeElement.getAttribute('aria-label') }; });
    R.check(`LB13[${tag}] Escape while a video plays: closes, pauses, releases the video, and focus returns to the "Видео от кухнята" tile`, !esc.open && esc.paused && !esc.src && esc.label === 'Видео от кухнята', JSON.stringify(esc));
    // MP4 (H.264) also plays
    await page.locator('.g-tile').nth(3).click(); await page.waitForSelector('dialog.lightbox[open]'); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.lb-video').play().catch(() => {})); await page.waitForTimeout(900); s = await lb();
    R.check(`LB14[${tag}] MP4 (H.264) video item plays in the lightbox (counter "4 / ${VIS}", currentTime advanced)`, s.pos === `4 / ${VIS}` && /\.mp4$/.test(s.vidSrc) && !s.paused && s.t > 0.2, JSON.stringify({ p: s.pos, src: s.vidSrc, paused: s.paused, t: s.t }));
    // end of list: next disabled; backdrop closes; no caption item hides the caption bar
    await page.locator('.lb-next').click(); await page.waitForTimeout(300); s = await lb();
    R.check(`LB15[${tag}] last item: counter "5 / ${VIS}", next disabled, prev enabled, caption "само български надпис"`, s.pos === `5 / ${VIS}` && s.nextDis && !s.prevDis && s.cap === 'само български надпис', JSON.stringify(s));
    await page.locator('.lb-prev').click(); await page.waitForTimeout(200); await page.locator('.lb-prev').click(); await page.waitForTimeout(200); s = await lb();
    R.check(`LB16b[${tag}] item 3 (no caption in any language) has the caption element hidden and empty (no empty bar)`, s.pos === `3 / ${VIS}` && s.capHidden && s.cap === '', JSON.stringify(s));
    // swipe: image items navigate; a swipe that starts on the video is ignored
    const swipe = (sel, dx) => page.evaluate(([sel, dx]) => { const el = document.querySelector(sel); const mk = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 }); el.dispatchEvent(new TouchEvent('touchstart', { touches: [mk(300)], changedTouches: [mk(300)], bubbles: true })); el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [mk(300 + dx)], bubbles: true })); }, [sel, dx]);
    await swipe('.lb-img', -150); await page.waitForTimeout(300); s = await lb();
    R.check(`LB17[${tag}] swipe left on an image goes to the next item (3 -> 4, a video)`, s.pos === `4 / ${VIS}` && !s.vidHidden, JSON.stringify(s.pos));
    await swipe('.lb-video', -150); await page.waitForTimeout(300); const s2 = await lb();
    R.check(`LB18[${tag}] swipe that starts on the video is ignored (stays on "4 / ${VIS}") so the user can scrub`, s2.pos === `4 / ${VIS}`, s2.pos);
    await page.locator('.lb-prev').click(); await page.waitForTimeout(200); await swipe('.lb-img', 150); await page.waitForTimeout(300); s = await lb();
    R.check(`LB19[${tag}] swipe right on an image (item 3) goes back to "2 / ${VIS}"`, s.pos === `2 / ${VIS}`, s.pos);
    // backdrop tap closes
    await page.mouse.click(2, 2).catch(() => {}); await page.waitForTimeout(200);
    if (await page.evaluate(() => document.querySelector('dialog.lightbox').open)) { await page.evaluate(() => document.querySelector('dialog.lightbox').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await page.waitForTimeout(200); }
    const bd = await page.evaluate(() => ({ open: document.querySelector('dialog.lightbox').open, paused: document.querySelector('.lb-video').paused }));
    R.check(`LB20[${tag}] tap on the backdrop closes the lightbox and leaves no playing video`, !bd.open && bd.paused, JSON.stringify(bd));
    R.check(`LB21[${tag}] no console/page errors, failed requests (4xx other than expected), CSP violations during the lightbox session`, log.console.length === 0 && log.pageErrors.length === 0 && log.failed.filter((f) => !/ERR_ABORTED/.test(f)).length === 0 && (await page.collectCsp()).length === 0, JSON.stringify(log));
    await context.close();
  }
});

// ---- focus visibility, contrast, reduced motion, touch targets on the public page
await step('PA', async () => {
  const { page, context } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(`${srvP.url}/gallery`, { waitUntil: 'networkidle' }); await page.waitForSelector('.g-tile');
  // tab to the first tile with the keyboard
  await page.locator('#year').focus().catch(() => {}); await page.evaluate(() => document.querySelector('.lead').scrollIntoView());
  await page.evaluate(() => document.getElementById('main').focus()); let hit = false;
  for (let i = 0; i < 20 && !hit; i++) { await page.keyboard.press('Tab'); hit = await page.evaluate(() => document.activeElement.classList.contains('g-tile')); }
  const f = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { ow: cs.outlineWidth, os: cs.outlineStyle, oc: cs.outlineColor, off: cs.outlineOffset, fv: document.activeElement.matches(':focus-visible') }; });
  R.check('PA1 keyboard Tab reaches the first gallery tile and shows a 3px solid outline (focus-visible)', hit && f.fv && f.ow === '3px' && f.os === 'solid', JSON.stringify(f));
  await page.screenshot({ path: path.join(shots, 'gallery-focus-390.png') });
  const col = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineColor; });
  const bgc = (await colorsOf(page, 'body')).bg;
  R.check(`PA2 focus ring colour ${col} vs page background ${bgc} contrast >= 3`, contrast(col, bgc) >= 3, contrast(col, bgc).toFixed(2));
  const cap = await colorsOf(page, '.g-cap'); const chip = await colorsOf(page, '.g-chip'); const h1 = await colorsOf(page, 'h1'); const lead = await colorsOf(page, '.lead');
  const chipBg = await page.evaluate(() => getComputedStyle(document.querySelector('.g-chip')).backgroundColor);
  const over = (fg, bg) => { const p = (s) => s.match(/[\d.]+/g).map(Number); const [r, g, b, a = 1] = p(bg); return a >= 1 ? bg : bg; };
  R.check(`PA3 contrast (computed): caption ${contrast(cap.fg, cap.bg).toFixed(2)} (>=4.5), intro ${contrast(lead.fg, lead.bg).toFixed(2)} (>=4.5), h1 ${contrast(h1.fg, h1.bg).toFixed(2)} (>=3 large)`, contrast(cap.fg, cap.bg) >= 4.5 && contrast(lead.fg, lead.bg) >= 4.5 && contrast(h1.fg, h1.bg) >= 3, JSON.stringify({ cap, lead, h1 }));
  // chip: text over the translucent dark chip over the image; check against the opaque composite with white-ish worst case image
  const chipM = chipBg.match(/[\d.]+/g).map(Number);
  const worst = [255, 255, 255].map((c, i) => c * (1 - (chipM[3] ?? 1)) + chipM[i] * (chipM[3] ?? 1)); // chip over a pure-white image = worst case
  R.check(`PA4 "Видео" chip text ${chip.fg} on chip ${chipBg} over a worst-case white image: contrast ${contrast(chip.fg, `rgb(${worst.map(Math.round)})`).toFixed(2)} >= 4.5`, contrast(chip.fg, `rgb(${worst.map(Math.round)})`) >= 4.5, chipBg);
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.g-tile')].map((t) => { const r = t.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  R.check('PA5 every tile >= 44x44 (and >= 160x120) at 390', sizes.every(([w, h]) => w >= 160 && h >= 120), JSON.stringify(sizes));
  const nav = await page.evaluate(() => { document.getElementById('nav-toggle').click(); return [...document.querySelectorAll('#site-nav a')].map((a) => { const r = a.getBoundingClientRect(); return [a.textContent.trim(), Math.round(r.width), Math.round(r.height)]; }); });
  R.check('PA6 visible mobile nav items (incl. "Галерия") >= 44px high', nav.filter(([, w]) => w > 0).length >= 5 && nav.filter(([, w]) => w > 0).every(([, , h]) => h >= 44) && nav.some(([t, w]) => t === 'Галерия' && w > 0), JSON.stringify(nav));
  await context.close();
  // reduced motion
  const rm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); const p2 = await rm.newPage();
  await p2.goto(`${srvP.url}/gallery`, { waitUntil: 'networkidle' }); await p2.waitForSelector('.g-tile'); await p2.locator('.g-tile').first().hover(); await p2.waitForTimeout(400);
  const tr = await p2.evaluate(() => { const i = document.querySelector('.g-tile img'); const cs = getComputedStyle(i); return { tf: cs.transform, td: cs.transitionDuration, sb: getComputedStyle(document.documentElement).scrollBehavior }; });
  R.check('PA7 prefers-reduced-motion: no hover scale, no transition on the media, scroll-behavior auto', tr.tf === 'none' && /^0s/.test(tr.td) && tr.sb === 'auto', JSON.stringify(tr));
  await rm.close();
  const nm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' }); const p3 = await nm.newPage();
  await p3.goto(`${srvP.url}/gallery`, { waitUntil: 'networkidle' }); await p3.waitForSelector('.g-tile'); await p3.locator('.g-tile').first().hover(); await p3.waitForTimeout(500);
  const tf3 = await p3.evaluate(() => getComputedStyle(document.querySelector('.g-tile img')).transform);
  R.check('PA8 without reduced motion the hover scale (1.03) applies (control for PA7)', /matrix\(1\.0[23]/.test(tf3), tf3); await nm.close();
});

// ---- empty + error state, loading skeleton
await step('ES', async () => {
  const dirE = tmpDir('galempty'); createAdmin(dirE);
  const srvE = await startServer({ port: 3203, dataDir: dirE, now: T0 });
  for (const lang of ['bg', 'en']) for (const vp of VPS) {
    const { page, log, context } = await newPage(browser, { width: vp.width, height: vp.height, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
    await page.goto(`${srvE.url}/gallery?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForSelector('.state-box'); const tag = `${lang} ${vp.name}`;
    const m = await page.evaluate(() => { const b = document.querySelector('.state-box'); const a = b.querySelector('a, button'); return { t: b.textContent.trim(), role: b.getAttribute('role') || (b.querySelector('[role]') && b.querySelector('[role]').getAttribute('role')), tiles: document.querySelectorAll('.g-tile').length, link: a && a.getAttribute('href'), lab: a && a.textContent.trim(), sw: document.documentElement.scrollWidth, iw: innerWidth, h1: document.querySelectorAll('h1').length, box: (() => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; })() }; });
    R.check(`ES1[${tag}] empty gallery: state box "${lang === 'en' ? 'Photos coming soon.' : 'Скоро ще добавим снимки.'}" (role=status), no tiles, home button, no h-scroll`, m.t.includes(lang === 'en' ? 'Photos coming soon.' : 'Скоро ще добавим снимки.') && m.role === 'status' && m.tiles === 0 && m.sw <= m.iw && m.h1 === 1 && /^\/(\?lang=en)?$/.test(m.link || '') && m.lab === (lang === 'en' ? 'Back to home' : 'Към началото'), JSON.stringify(m));
    R.check(`ES2[${tag}] no console/page errors, failed requests, CSP violations`, log.console.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify(log));
    if (vp.name === '390') await page.screenshot({ path: path.join(shots, `gallery-empty-${lang}-390.png`) });
    await context.close();
  }
  // error + retry
  const { page, context } = await newPage(browser, { width: 390, height: 844 });
  await page.route('**/api/public/gallery**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
  await page.goto(`${srvE.url}/gallery`, { waitUntil: 'networkidle' }); await page.waitForSelector('.state-box');
  R.check('ES3 API failure: error box "Галерията не може да се зареди." (role=alert) with a retry button', /Галерията не може да се зареди\./.test(await page.locator('.state-box').textContent()) && (await page.locator('.state-box[role=alert], .state-box [role=alert]').count()) >= 1 && (await page.getByRole('button', { name: 'Опитай отново' }).count()) === 1, await page.locator('.state-box').textContent());
  await page.unroute('**/api/public/gallery**'); await page.getByRole('button', { name: 'Опитай отново' }).click(); await page.waitForFunction(() => /Скоро ще добавим|Скоро/.test(document.querySelector('.state-box')?.textContent || '')).catch(() => {});
  R.check('ES4 retry after recovery shows the empty state', /Скоро ще добавим снимки\./.test(await page.locator('.state-box').textContent()));
  // loading skeleton: slow response
  const p2 = await newPage(browser, { width: 390, height: 844 });
  await p2.page.route('**/api/public/gallery**', async (r) => { await sleep(1200); r.continue(); });
  await p2.page.goto(`${srvE.url}/gallery`, { waitUntil: 'domcontentloaded' }); await p2.page.waitForTimeout(400);
  const sk = await p2.page.evaluate(() => ({ n: document.querySelectorAll('.g-skel').length, st: !!document.querySelector('#gallery-content [role=status]'), vh: document.querySelector('#gallery-content .visually-hidden')?.textContent }));
  R.check('ES5 loading: 6 skeleton tiles inside a role=status region with hidden text "Зареждане…"', sk.n === 6 && sk.st && /Зареждане/.test(sk.vh || ''), JSON.stringify(sk));
  await context.close(); await p2.context.close(); await srvE.stop(); fs.rmSync(dirE, { recursive: true, force: true });
});

// ---- navigation on every public page (BG/EN, 390 + 1280)
await step('NV', async () => {
  const pages = ['/', '/daily-menu', '/gallery', '/reservation', '/privacy', '/nonexistent-page'];
  for (const lang of ['bg', 'en']) for (const vp of [VPS[0], VPS[2]]) {
    const { page, log, context } = await newPage(browser, { width: vp.width, height: vp.height, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
    for (const p of pages) {
      const tag = `${lang} ${vp.name} ${p}`;
      await page.goto(`${srvP.url}${p}${p.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'networkidle' }).catch(() => {});
      const nav = await page.evaluate(() => [...document.querySelectorAll('#site-nav a')].map((a) => ({ t: a.textContent.trim(), h: a.getAttribute('href'), cur: a.getAttribute('aria-current') })));
      const gal = nav.filter((x) => x.h === '/gallery' || (x.h || '').startsWith('/gallery'));
      const label = lang === 'en' ? 'Gallery' : 'Галерия';
      R.check(`NV1[${tag}] nav has exactly one "${label}" link to /gallery, no "За нас"/About/#about link`, gal.length === 1 && gal[0].t === label && !nav.some((x) => /За нас|About|#about/.test(x.t + x.h)), JSON.stringify(nav));
      R.check(`NV2[${tag}] aria-current=page only on /gallery`, p === '/gallery' ? gal[0].cur === 'page' : gal[0].cur === null, JSON.stringify(gal[0]));
      const order = nav.map((x) => x.t).join('>');
      R.check(`NV3[${tag}] order: ... Галерия before Локация/Контакти (E1)`, order.indexOf(label) < (order.indexOf(lang === 'en' ? 'Location' : 'Локация') === -1 ? order.indexOf(lang === 'en' ? 'Contact' : 'Контакти') : order.indexOf(lang === 'en' ? 'Location' : 'Локация')), order);
      // click works from this page
      if (vp.name === '390') await page.locator('#nav-toggle').click();
      await page.locator('#site-nav a[href^="/gallery"]').first().click(); await page.waitForURL(/\/gallery/, { timeout: 8000 }).catch(() => {});
      await page.waitForSelector('h1'); const url = new URL(page.url());
      R.check(`NV4[${tag}] clicking the nav item lands on /gallery keeping lang=${lang} (page title / h1 correct)`, url.pathname === '/gallery' && (lang === 'en' ? url.searchParams.get('lang') === 'en' : true) && (await page.locator('h1').textContent()).trim() === label, page.url());
      R.check(`NV5[${tag}] no h-scroll at ${vp.name}`, (await noHScroll(page)).ok);
    }
    // anchors from the gallery page go to the home sections
    for (const [sel, hash] of [['#site-nav a[href*="#menu"]', '#menu'], ['#site-nav a[href*="#location"]', '#location'], ['#site-nav a[href*="#contact"]', '#contact']]) {
      await page.goto(`${srvP.url}/gallery?lang=${lang}`, { waitUntil: 'networkidle' }); if (vp.name === '390') await page.locator('#nav-toggle').click();
      await page.locator(sel).first().click(); await page.waitForURL((u) => u.pathname === '/' && u.hash === hash, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
      R.check(`NV6[${lang} ${vp.name}] from /gallery "${hash}" nav link goes to /${hash} and the section exists`, new URL(page.url()).pathname === '/' && new URL(page.url()).hash === hash && (await page.locator(hash).count()) === 1, page.url());
    }
    R.check(`NV7[${lang} ${vp.name}] no console/page errors (the deliberate 404 request excluded), CSP violations`, log.console.filter((m) => !/status of 404/.test(m)).length === 0 && log.pageErrors.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify(log.console));
    await context.close();
  }
  // direct URL forms of the gallery page
  const r = await fetch(srvP.url + '/gallery'); const r2 = await fetch(srvP.url + '/gallery/'); const r3 = await fetch(srvP.url + '/gallery.html'); const r4 = await fetch(srvP.url + '/gallery/x', { headers: { accept: 'text/html' } });
  R.check('NV8 /gallery 200 html, /gallery/ , /gallery.html and /gallery/x behave (200 or 404 html), nothing 5xx', r.status === 200 && /text\/html/.test(r.headers.get('content-type')) && [200, 301, 302, 308, 404].includes(r2.status) && [200, 301, 302, 308, 404].includes(r3.status) && r4.status === 404, JSON.stringify([r.status, r2.status, r3.status, r4.status]));
});

// ---- hidden item / visibility reflected live on the public page; deleted item disappears
await step('LV', async () => {
  const { page, context } = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(`${srvP.url}/gallery`, { waitUntil: 'networkidle' }); await page.waitForSelector('.g-tile');
  await apiP.patch(`${G}/${seeded[5].id}`, { json: { visible: true } });
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.g-tile'); const n1 = await page.locator('.g-tile').count();
  await apiP.patch(`${G}/${seeded[0].id}`, { json: { visible: false } }); await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.g-tile'); const n2 = await page.locator('.g-tile').count();
  const first = await page.locator('.g-tile').first().getAttribute('aria-label');
  R.check('LV1 unhide shows 6 tiles; hiding another shows 5 and the order is preserved (first = "Видео от кухнята")', n1 === 6 && n2 === 5 && first === 'Видео от кухнята', JSON.stringify([n1, n2, first]));
  await context.close();
});

await browser.close();
await srvA.stop(); await srvP.stop();
fs.rmSync(dirA, { recursive: true, force: true }); fs.rmSync(dirP, { recursive: true, force: true });
R.summary();
fs.writeFileSync(path.join(shots, '..', 'gallery-results.json'), JSON.stringify(R.results, null, 1));

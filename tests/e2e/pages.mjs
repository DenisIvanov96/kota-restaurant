// T-43 (D-44..D-48) browser level: multi-page regular menu end to end (admin page manager -> public), lightbox gallery,
// (T-46 / D-49: downloads are admin-only: public site has none; admin ZIP + per-page links). Ports 3201 (main) and 3202 (structured/daily).
// Run: node --disable-warning=ExperimentalWarning tests/e2e/pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PDF, PASSWORD, reporter, SCRATCH } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir, contrast, colorsOf } from '../lib/browser.mjs';

const R = reporter('pages-e2e');
const T0 = '2026-06-15T10:00:00Z';
const shots = shotDir();
const dir = tmpDir('pagesui'); createAdmin(dir);
const srv = await startServer({ port: 3201, dataDir: dir, now: T0 });
const base = srv.url;
const api = new Client(base); await api.login();
const anon = new Client(base);
const browser = await chromium.launch();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.stack || e.message).split('\n').slice(0, 5).join(' | ')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = (name, mimeType, buffer) => ({ name, mimeType, buffer });
// page i has a unique red level so order can be read from pixels; size is portrait like a menu page
const colour = (i) => [20 + i * 17, 90, 160];
const pagePng = (i, w = 600, h = 800) => makePng(w, h, colour(i));
const pixel = (page, sel, nth = 0) => page.locator(sel).nth(nth).evaluate((img) => new Promise((res) => {
  const go = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); res([...x.getImageData(5, 5, 1, 1).data]); };
  if (img.complete && img.naturalWidth) go(); else img.addEventListener('load', go);
}));
const idxOf = (px) => Math.round((px[0] - 20) / 17);
const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(350); };
async function login(page) {
  await page.goto(base + '/admin/', { waitUntil: 'networkidle' });
  await page.getByLabel('Потребителско име').fill('owner');
  await page.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('h1:has-text("Табло")');
}
const clickLang = (page, l) => page.locator(`.lang-btn[data-lang="${l}"]`).click();

// structured menu first (needed to switch back and for the print test)
await api.put('/api/admin/menu/draft', { json: { categories: [{ name: 'Салати', nameEn: 'Salads', items: [{ name: 'Шопска', nameEn: 'Shopska', description: 'домати, краставици', priceCents: 650, available: true }] }, { name: 'Основни', nameEn: 'Mains', items: [{ name: 'Кебапче', nameEn: 'Kebapche', description: '', priceCents: 250, available: true }] }] } });
await api.post('/api/admin/menu/publish');

const ctxA = await newPage(browser, { width: 1280, height: 900, acceptDownloads: true });
const admin = ctxA.page; const alog = ctxA.log;
await login(admin);
const ptabs = admin.locator('[aria-label="Език на страниците"] [role=tab]');
const pageInput = admin.locator('.a-upload--pages input[type=file]');
const rows = () => admin.locator('.a-pagerow');
const names = async (lang) => (await api.get('/api/admin/menu')).data.pages[lang].items.map((x) => x.originalName);

// ===================================================================================== 1. admin: select 10 files at once
await step('A1', async () => {
  await go(admin, '#/menu'); await admin.waitForSelector('.a-dish');
  await tab(admin, 'Файл').click();
  // 16 files in one go -> refused client-side (limit 15, D-62), nothing uploaded
  const eleven = Array.from({ length: 16 }, (_, i) => file(`x${i + 1}.png`, 'image/png', pagePng(i, 40, 50)));
  const reqs = [];
  admin.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/admin/menu/pages')) reqs.push(r); });
  await pageInput.setInputFiles(eleven); await admin.waitForTimeout(500);
  const msg = await admin.locator('.a-upload__err').innerText();
  R.check('A1a selecting 16 files at once is refused with a visible message ("още най-много 15"); no upload request was sent; list stays empty', /16 файла/.test(msg) && /най-много 15/.test(msg) && reqs.length === 0 && (await rows().count()) === 0 && (await names('bg')).length === 0, msg);

  // 10 files at once -> uploaded one by one. Throttle the uplink so the progress bars are observable.
  const cdp = await admin.context().newCDPSession(admin);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 300 * 1024 });
  const ten = Array.from({ length: 10 }, (_, i) => file(`p${String(i + 1).padStart(2, '0')}.png`, 'image/png', pagePng(i, 300, 400)));
  const t = []; const fin = [];
  admin.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/admin/menu/pages')) t.push({ s: Date.now(), r }); });
  admin.on('requestfinished', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/admin/menu/pages')) fin.push(Date.now()); });
  reqs.length = 0;
  await pageInput.setInputFiles(ten);
  let sawProgress = false; let sawQueued = false; let maxConcurrent = 0;
  for (let i = 0; i < 400; i++) {
    const st = await admin.evaluate(() => ({ prog: document.querySelectorAll('.a-qrow progress').length, queued: [...document.querySelectorAll('.a-qrow.is-queued')].length, up: document.querySelectorAll('.a-qrow.is-uploading').length, rows: document.querySelectorAll('.a-pagerow').length }));
    if (st.prog > 0) sawProgress = true; if (st.queued > 0) sawQueued = true; maxConcurrent = Math.max(maxConcurrent, st.up);
    if (st.rows === 10 && st.up === 0 && st.queued === 0) break;
    await sleep(100);
  }
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await admin.waitForTimeout(400);
  const overlap = t.some((x, i) => i > 0 && x.s < fin[i - 1] - 5);
  R.check('A1b 10 files selected at once -> 10 sequential POST /menu/pages (no overlap), a progress bar was shown while uploading, queued rows were listed, never >1 upload at a time', t.length === 10 && !overlap && sawProgress && sawQueued && maxConcurrent <= 1, JSON.stringify({ n: t.length, overlap, sawProgress, sawQueued, maxConcurrent }));
  const nm = await names('bg');
  R.check('A1c the 10 pages exist in the selected order p01..p10 (positions 1..10), counter "10 от 15 страници", list shows "Страница 1".."Страница 10"', nm.join() === ten.map((x) => x.name).join() && (await admin.locator('.a-pagecount').innerText()).includes('10 от 15') && (await rows().count()) === 10 && (await rows().nth(9).innerText()).includes('Страница 10'), nm.join());
  // fill up to the limit of 15 through the API, then check the UI at 15 / 15 and that a 16th cannot be added
  for (let i = 0; i < 5; i++) await api.post('/api/admin/menu/pages', { form: form({ lang: 'bg' }, { field: 'file', buf: pagePng(30 + i, 40, 50), name: `fill${i + 1}.png`, type: 'image/png' }) });
  await admin.reload({ waitUntil: 'networkidle' }); await admin.waitForSelector('#tab-file'); await tab(admin, 'Файл').click(); await admin.waitForSelector('.a-pagerow'); await admin.waitForTimeout(400);
  R.check('A1d at 15 pages "Добави страници" is disabled, counter "15 от 15", and it says the maximum (15) is reached', (await admin.getByRole('button', { name: 'Добави страници' }).isDisabled()) && /максимумът от 15/.test(await admin.locator('.a-upload--pages').innerText()) && (await admin.locator('.a-pagecount').innerText()).includes('15 от 15'), await admin.locator('.a-pagecount').innerText());
  reqs.length = 0;
  await pageInput.setInputFiles([file('sixteenth.png', 'image/png', pagePng(1, 40, 50))]); await admin.waitForTimeout(500);
  R.check('A1e a 16th page cannot be added through the UI (message "Достигнат е максимумът от 15", no request); the API also answers 409 too_many_pages', /Достигнат е максимумът от 15/.test(await admin.locator('.a-upload__err').innerText()) && reqs.length === 0 && (await api.post('/api/admin/menu/pages', { form: form({ lang: 'bg' }, { field: 'file', buf: makePng(10, 10), name: 'e.png', type: 'image/png' }) })).data.error === 'too_many_pages');
  for (const it of (await api.get('/api/admin/menu')).data.pages.bg.items.filter((x) => /^fill\d\.png$/.test(x.originalName))) await api.del(`/api/admin/menu/pages/${it.id}`);
  await admin.reload({ waitUntil: 'networkidle' }); await admin.waitForSelector('#tab-file'); await tab(admin, 'Файл').click(); await admin.waitForSelector('.a-pagerow'); await admin.waitForTimeout(400); // back to the 10 pages the rest of the suite uses
  await admin.screenshot({ path: path.join(shots, 'pages-admin-10.png'), fullPage: true });
});

// ===================================================================================== 2. admin: reorder, delete
await step('A2', async () => {
  // move p03 up twice -> p03,p01,p02 ... ; keyboard focus stays on the moved row's button
  await admin.getByRole('button', { name: 'Премести страница 3 нагоре' }).click(); await admin.waitForTimeout(700);
  await admin.getByRole('button', { name: 'Премести страница 2 нагоре' }).click(); await admin.waitForTimeout(700);
  const nm = await names('bg');
  R.check('A2a "нагоре" x2 on page 3: API order p03,p01,p02,p04..p10 and the list in the UI follows', nm.slice(0, 4).join() === 'p03.png,p01.png,p02.png,p04.png' && (await rows().first().innerText()).includes('p03.png') && /преместена на позиция 1 от 10/.test(await admin.locator('#pages-live').innerText()), nm.join());
  await admin.getByRole('button', { name: 'Премести страница 1 надолу' }).click(); await admin.waitForTimeout(700);
  const nm2 = await names('bg');
  R.check('A2b "надолу" on page 1: p01,p03,p02,...; first row has "нагоре" disabled, last row "надолу" disabled', nm2.slice(0, 3).join() === 'p01.png,p03.png,p02.png' && (await admin.getByRole('button', { name: 'Премести страница 1 нагоре' }).isDisabled()) && (await admin.getByRole('button', { name: 'Премести страница 10 надолу' }).isDisabled()));
  await admin.getByRole('button', { name: 'Премести страница 3 нагоре' }).click(); await admin.waitForTimeout(700); // back to p01,p02,p03...
  R.check('A2c restore: p01,p02,p03,...,p10', (await names('bg')).join() === Array.from({ length: 10 }, (_, i) => `p${String(i + 1).padStart(2, '0')}.png`).join());
  // delete page 4 with confirmation (cancel first)
  await admin.getByRole('button', { name: 'Изтрий страница 4' }).click(); await admin.waitForSelector('dialog[open]');
  await admin.locator('dialog[open]').getByRole('button', { name: /Отказ|Откажи|Затвори/ }).first().click().catch(() => admin.keyboard.press('Escape')); await admin.waitForTimeout(300);
  R.check('A2d cancelling the delete confirmation keeps the page (10 pages)', (await names('bg')).length === 10);
  await admin.getByRole('button', { name: 'Изтрий страница 4' }).click(); await admin.waitForSelector('dialog[open]');
  await admin.locator('dialog[open]').getByRole('button', { name: 'Изтрий страницата' }).click(); await admin.waitForTimeout(800);
  const nm3 = await names('bg');
  R.check('A2e confirmed delete of page 4 (p04): 9 pages left, positions renumbered 1..9 ("Страница 9" exists, "Страница 10" gone), counter "9 от 15", Добави страници enabled again', nm3.length === 9 && !nm3.includes('p04.png') && (await rows().count()) === 9 && !(await admin.locator('.a-pageslist, .a-pages').innerText()).includes('Страница 10') && (await admin.locator('.a-pagecount').innerText()).includes('9 от 15') && !(await admin.getByRole('button', { name: 'Добави страници' }).isDisabled()), nm3.join());
  const pos = (await api.get('/api/admin/menu')).data.pages.bg.items.map((x) => x.position);
  R.check('A2f API positions are contiguous 1..9', pos.join() === '1,2,3,4,5,6,7,8,9', pos.join());
  // a PDF as page 10 (mixed gallery) via the UI
  await pageInput.setInputFiles([file('p10-menu.pdf', 'application/pdf', PDF)]); await admin.waitForFunction(() => document.querySelectorAll('.a-pagerow').length === 10); await admin.waitForTimeout(300);
  R.check('A2g a PDF page can be added (kind pdf, tile thumbnail) as page 10', (await api.get('/api/admin/menu')).data.pages.bg.items[9].kind === 'pdf');
});

// ===================================================================================== 3. publish per language, public view
let bgUrls = [];
await step('P0', async () => {
  const before = (await api.get('/api/admin/menu')).data.pages.bg.items;
  bgUrls = before.map((x) => x.fileUrl.replace('/api/admin', ''));
  const pubNow = (await anon.get('/api/public/menu')).data;
  R.check('P0a not published: public menu is structured, no pages; every page /media is 404 for the public (also when published but mode=structured)', pubNow.mode === 'structured' && pubNow.file === null && (await Promise.all(bgUrls.map((u) => anon.get(u)))).every((r) => r.status === 404));
  await admin.getByRole('switch', { name: /Публикувани — Български страници/ }).click(); await admin.waitForTimeout(700);
  R.check('P0b publish switch ON (BG): API flag true; "Тези страници са публикувани" warning appears; still structured mode => pages 404', (await api.get('/api/admin/menu')).data.pages.bg.published === true && /се вижда веднага/.test(await admin.locator('main').innerText()) && (await anon.get(bgUrls[0])).status === 404);
  await admin.getByRole('radio', { name: /Файл/ }).check({ force: true }).catch(async () => { await admin.locator('label.a-radio:has-text("Файл")').click(); });
  await admin.waitForSelector('dialog[open]'); await admin.locator('dialog[open]').getByRole('button', { name: 'Покажи на сайта' }).click(); await admin.waitForTimeout(800);
  R.check('P0c mode switched to file via the UI; all 10 BG page URLs are now public (200), in the same order', (await api.get('/api/admin/menu')).data.mode === 'file' && (await Promise.all(bgUrls.map((u) => anon.get(u)))).every((r) => r.status === 200));
  // EN: one page, unpublished
  await ptabs.nth(1).click(); await admin.waitForTimeout(200);
  await pageInput.setInputFiles([file('en1.png', 'image/png', pagePng(12, 300, 400))]); await admin.waitForSelector('.a-pagerow'); await admin.waitForTimeout(500);
  const en = (await api.get('/api/admin/menu')).data.pages.en;
  const enUrl = en.items[0].fileUrl.replace('/api/admin', '');
  R.check('P0d an unpublished EN page is uploaded; its /media is 404 for the public while BG is live; EN visitors get the BG set (fallback)', en.items.length === 1 && en.published === false && (await anon.get(enUrl)).status === 404 && (await anon.get('/api/public/menu?lang=en')).data.file.lang === 'bg');
});

const pub = await newPage(browser, { width: 390, height: 844, acceptDownloads: true });
const page = pub.page;
await step('P1', async () => {
  // D-63: the home menu is a one-page-at-a-time slider; walk through all 10 pages with the "next" button
  await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForSelector('.menu-slider');
  const cnt = () => page.locator('.menu-slider-count').innerText();
  const nextB = page.getByRole('button', { name: 'Следваща страница' }).first();
  R.check('P1a slider (D-63): ONE page visible at a time (1 .menu-slide, 1 img), counter "Страница 1 от 10", prev disabled, next enabled; no legacy .menu-pages list', (await page.locator('.menu-slide').count()) === 1 && (await page.locator('.menu-slide img').count()) === 1 && (await cnt()) === 'Страница 1 от 10' && (await page.locator('.slider-prev').isDisabled()) && (await nextB.isEnabled()) && (await page.locator('.menu-pages, .menu-page-cap').count()) === 0);
  const order = []; const counters = []; const alts = []; const zooms = [];
  for (let i = 0; i < 9; i++) {
    await page.waitForFunction(() => { const im = document.querySelector('.menu-slide img'); return im && im.complete && im.naturalWidth > 0; });
    order.push(idxOf(await pixel(page, '.menu-slide img'))); counters.push(await cnt()); alts.push(await page.locator('.menu-slide img').getAttribute('alt')); zooms.push(await page.locator('.menu-slide .zoom-btn').getAttribute('aria-label'));
    await nextB.click(); await page.waitForTimeout(80);
  }
  R.check('P1b the 9 image pages come in admin order (colours 0,1,2,4,5,6,7,8,9), counter "Страница N от 10" for N=1..9, counter is aria-live=polite', order.join() === [0, 1, 2, 4, 5, 6, 7, 8, 9].join() && counters.every((c, i) => c === `Страница ${i + 1} от 10`) && (await page.locator('.menu-slider-count').getAttribute('aria-live')) === 'polite', JSON.stringify({ order, counters }));
  R.check('P1c image pages have alt "Меню — страница N" and the zoom button is labelled "Увеличи страница N от 10"', alts.every((x, i) => x === `Меню — страница ${i + 1}`) && zooms.every((x, i) => x === `Увеличи страница ${i + 1} от 10`), JSON.stringify({ alts, zooms }));
  R.check('P1d page 10 is the PDF card with exactly one link "Отвори меню (PDF)" (new tab, noopener), NO "Изтегли"/download attribute (D-49); counter "Страница 10 от 10"; next disabled, prev enabled', (await cnt()) === 'Страница 10 от 10' && (await page.locator('.menu-slide .pdf-card a[target=_blank][rel~=noopener]').count()) === 1 && (await page.locator('.menu-slide a').count()) === 1 && (await page.locator('.menu-slide a').first().textContent()).includes('Отвори меню (PDF)') && !(await page.locator('.menu-slide').textContent()).includes('Изтегли') && (await page.locator('.menu-slide [download]').count()) === 0 && (await page.locator('.slider-next').isDisabled()) && (await page.locator('.slider-prev').isEnabled()));
  R.check('P1e no horizontal scroll at 390 and no console/page errors', (await noHScroll(page)).ok && pub.log.console.length === 0 && pub.log.pageErrors.length === 0, JSON.stringify(pub.log.console));
  while (await page.locator('.slider-prev').isEnabled()) await page.locator('.slider-prev').click();
  await page.locator('#menu').screenshot({ path: path.join(shots, 'pages-public-390.png') });
});

// ===================================================================================== 4. lightbox
await step('L1', async () => {
  const dlg = page.locator('dialog.lightbox');
  const first = page.locator('.menu-slide .zoom-btn').first();
  await first.scrollIntoViewIfNeeded(); await first.click(); await page.waitForSelector('dialog.lightbox[open]');
  const pos = () => dlg.locator('.lb-pos').innerText();
  const px = () => dlg.locator('.lb-img').evaluate((img) => new Promise((res) => { const go = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); res([...x.getImageData(5, 5, 1, 1).data]); }; if (img.complete && img.naturalWidth) go(); else img.addEventListener('load', go); }));
  R.check('L1a opening page 1 shows "Страница 1 от 10"; Предишна disabled, Следваща enabled; both nav buttons visible', (await pos()) === 'Страница 1 от 10' && (await dlg.getByRole('button', { name: 'Предишна страница' }).isDisabled()) && (await dlg.getByRole('button', { name: 'Следваща страница' }).isEnabled()));
  await dlg.getByRole('button', { name: 'Следваща страница' }).click(); await page.waitForTimeout(250);
  R.check('L1b "Следваща" moves to page 2: caption "Страница 2 от 10", image colour index 1, alt "Меню — страница 2"', (await pos()) === 'Страница 2 от 10' && idxOf(await px()) === 1 && (await dlg.locator('.lb-img').getAttribute('alt')) === 'Меню — страница 2');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
  R.check('L1c ArrowRight -> page 3 (colour 2)', (await pos()) === 'Страница 3 от 10' && idxOf(await px()) === 2);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
  R.check('L1d the PDF is skipped in the gallery but numbering uses the real page numbers: next after page 3 is page 5 (the deleted p04 is gone, so colour 4), caption "Страница 4 от 10"', /^Страница 4 от 10$/.test(await pos()) && idxOf(await px()) === 4, await pos());
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(250);
  R.check('L1e ArrowLeft -> back to page 3', (await pos()) === 'Страница 3 от 10' && idxOf(await px()) === 2);
  for (let i = 0; i < 12; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60); }
  R.check('L1f at the last image page (9 of 10; page 10 is the PDF) "Следваща" is disabled and ArrowRight does not go further', (await pos()) === 'Страница 9 от 10' && (await dlg.getByRole('button', { name: 'Следваща страница' }).isDisabled()), await pos());
  await dlg.getByRole('button', { name: 'Предишна страница' }).click(); await page.waitForTimeout(200);
  R.check('L1g "Предишна" click goes back to page 8', (await pos()) === 'Страница 8 от 10');
  // swipe on the image (touch events)
  const swipe = (dx) => dlg.locator('.lb-scroll').evaluate((el, d) => {
    const mk = (type, x) => { const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: 200 }); el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true })); };
    mk('touchstart', 200); mk('touchend', 200 + d);
  }, dx);
  await swipe(-120); await page.waitForTimeout(250);
  R.check('L1h swipe left (touch) -> next page ("Страница 9 от 10"); swipe right -> previous again', (await pos()) === 'Страница 9 от 10');
  await swipe(120); await page.waitForTimeout(250);
  R.check('L1i swipe right -> "Страница 8 от 10"', (await pos()) === 'Страница 8 от 10');
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  R.check('L1j Escape closes the lightbox and focus returns to the zoom button that opened it', !(await dlg.evaluate((d) => d.open)) && (await page.evaluate(() => document.activeElement.className)).includes('zoom-btn'));
  // open page 5 directly: gallery starts at that page
  for (let i = 0; i < 4; i++) await page.locator('.slider-next').click(); // slider to page 5
  await page.locator('.menu-slide .zoom-btn').click(); await page.waitForSelector('dialog.lightbox[open]');
  R.check('L1k the lightbox opens at the slider\'s CURRENT page (page 5 = "Страница 5 от 10", colour 5) and both nav buttons are enabled', (await pos()) === 'Страница 5 от 10' && idxOf(await px()) === 5 && (await dlg.getByRole('button', { name: 'Предишна страница' }).isEnabled()) && (await dlg.getByRole('button', { name: 'Следваща страница' }).isEnabled()), await pos());
  await page.keyboard.press('Escape');
  // EN labels
  await clickLang(page, 'en'); await page.waitForTimeout(600);
  R.check('L1l EN visitor: set falls back to BG pages; counter "Page 1 of 10"; zoom label "Enlarge page 1 of 10"; no "Download" text or download attribute (D-49)', (await page.locator('.menu-slider-count').innerText()) === 'Page 1 of 10' && (await page.locator('.menu-slide .zoom-btn').first().getAttribute('aria-label')) === 'Enlarge page 1 of 10' && !/Download/i.test(await page.locator('#menu').innerText()) && (await page.locator('[download]').count()) === 0);
  await page.locator('.menu-slide .zoom-btn').first().click(); await page.waitForSelector('dialog.lightbox[open]');
  R.check('L1m EN lightbox: "Page 1 of 10", buttons "Previous page" / "Next page"', (await pos()) === 'Page 1 of 10' && (await dlg.getByRole('button', { name: 'Next page' }).count()) === 1 && (await dlg.getByRole('button', { name: 'Previous page' }).count()) === 1);
  await page.keyboard.press('Escape'); await clickLang(page, 'bg'); await page.waitForTimeout(400);
});

// ===================================================================================== 4b. accessibility of the new public + admin UI
await step('AX', async () => {
  await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForSelector('.menu-slider');
  const pairs = {};
  for (let i = 0; i < 9; i++) await page.locator('.slider-next').click(); // PDF page
  for (const sel of ['.menu-slider-count', '.menu-slide .pdf-card p', '.menu-slide .btn', '.slider-btn:not(:disabled)']) {
    const c = await colorsOf(page, sel); pairs[sel] = { ...c, ratio: Math.round(contrast(c.fg, c.bg) * 100) / 100 };
  }
  const bad = Object.entries(pairs).filter(([, v]) => v.ratio < 4.5);
  R.check('AX1 computed colour contrast >= 4.5:1 for the slider counter, PDF card text, its open button and the enabled slider arrow (icon colour vs its background)', bad.length === 0, JSON.stringify(pairs));
  // keyboard: the first zoom button is focusable with a visible focus outline (no download-all link any more)
  while (await page.locator('.slider-prev').isEnabled()) await page.locator('.slider-prev').click();
  await page.locator('.menu-slider').focus(); await page.keyboard.press('Tab'); // keyboard modality: wrapper -> (disabled prev skipped) -> zoom button
  const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { w: cs.outlineWidth, s: cs.outlineStyle, sh: cs.boxShadow }; });
  R.check('AX2 the zoom button reached with Tab inside the slider has a visible focus indicator', (await page.evaluate(() => document.activeElement.classList.contains('zoom-btn'))) && (ring.s !== 'none' && parseFloat(ring.w) >= 2) || ring.sh !== 'none', JSON.stringify(ring));
  R.check('AX3 D-49: no focusable element precedes the first zoom button inside the slider at page 1 (prev is disabled, no download bar)', await page.evaluate(() => { const f = document.querySelector('.menu-slide .zoom-btn'); return [...document.querySelectorAll('.menu-slider a, .menu-slider button:not(:disabled)')].find((e) => e.offsetParent !== null) === f; }));
  await page.keyboard.press('Enter'); await page.waitForSelector('dialog.lightbox[open]');
  const lb = await page.evaluate(() => { const d = document.querySelector('dialog.lightbox'); const b = [...d.querySelectorAll('button')].filter((x) => !x.hidden); return { name: d.getAttribute('aria-label'), focusInside: d.contains(document.activeElement), buttons: b.map((x) => x.getAttribute('aria-label') || x.textContent.trim()) }; });
  R.check('AX4 keyboard Enter opens the lightbox: dialog has an accessible name, focus is inside, visible controls all have names (Предишна/Следваща/Увеличи/Затвори)', lb.name && lb.focusInside && lb.buttons.every(Boolean) && lb.buttons.some((x) => /Следваща/.test(x)) && lb.buttons.some((x) => /Затвори/.test(x)), JSON.stringify(lb));
  const lbc = await colorsOf(page, 'dialog.lightbox .lb-pos');
  R.check('AX5 lightbox position text "Страница N от M" is an aria-live status and has contrast >= 4.5:1', (await page.locator('dialog.lightbox .lb-pos').getAttribute('role')) === 'status' && contrast(lbc.fg, lbc.bg) >= 4.5, JSON.stringify(lbc));
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  R.check('AX6 focus stays trapped in the open lightbox while tabbing', await page.evaluate(() => document.querySelector('dialog.lightbox').contains(document.activeElement)));
  await page.keyboard.press('Escape');
  // admin page manager: heading order, labelled controls, keyboard operation of the arrows
  await admin.bringToFront(); await go(admin, '#/menu'); await admin.waitForSelector('#tab-file'); await tab(admin, 'Файл').click(); await admin.waitForSelector('.a-pagerow'); await ptabs.nth(0).click(); await admin.waitForTimeout(300);
  const hs = await admin.evaluate(() => [...document.querySelectorAll('main h1, main h2, main h3, main h4')].filter((h) => h.offsetParent !== null).map((h) => +h.tagName[1]));
  let ok = true; for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) ok = false;
  const unnamed = await admin.evaluate(() => [...document.querySelectorAll('main button, main a, main input:not([aria-hidden=true]), main [role=switch]')].filter((e) => e.offsetParent !== null && !(e.getAttribute('aria-label') || e.textContent.trim() || e.getAttribute('title') || (e.labels && e.labels.length))).map((e) => e.outerHTML.slice(0, 120)));
  R.check('AX7 admin page manager: heading levels never skip downwards by more than one, every visible control has an accessible name', ok && unnamed.length === 0, JSON.stringify({ hs, unnamed }));
  await admin.getByRole('button', { name: 'Премести страница 2 надолу' }).focus(); await admin.keyboard.press('Enter'); await admin.waitForTimeout(900);
  const focused = await admin.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.textContent);
  R.check('AX8 moving a page with the keyboard (Enter on "надолу") keeps focus on a move button of the moved page (focus not lost to <body>)', /Премести страница \d+ (нагоре|надолу)/.test(focused || ''), focused);
  await admin.getByRole('button', { name: 'Премести страница 3 нагоре' }).click(); await admin.waitForTimeout(800); // restore order
});

// ===================================================================================== 5. EN / BG fallback with real EN set
await step('F1', async () => {
  await admin.bringToFront(); await ptabs.nth(1).click(); await admin.waitForTimeout(200);
  await admin.getByRole('switch', { name: /Публикувани — English pages/ }).click(); await admin.waitForTimeout(700);
  const en = (await anon.get('/api/public/menu?lang=en')).data.file;
  R.check('F1a EN set published: EN visitors get lang=en with 1 page; BG visitors still 10 pages', en.lang === 'en' && en.pages.length === 1 && (await anon.get('/api/public/menu?lang=bg')).data.file.pages.length === 10);
  await clickLang(page, 'en'); await page.waitForTimeout(800);
  const caps = await page.locator('.menu-slider-count').allInnerTexts();
  R.check('F1b public page switched to EN without reload shows exactly the EN page as a single card (no arrows, no counter "Page 1 of 1"; no download link, D-49)', (await page.locator('.menu-slide').count()) === 1 && (await page.locator('.menu-slider-row, .slider-btn').count()) === 0 && idxOf(await pixel(page, '.menu-slide img')) === 12 && caps.length === 0 && (await page.locator('.menu-dl-btn, [download]').count()) === 0, JSON.stringify(caps));
  await clickLang(page, 'bg'); await page.waitForTimeout(800);
  R.check('F1c back to БГ: the 10-page slider again (counter "Страница 1 от 10")', (await page.locator('.menu-slider-count').innerText()) === 'Страница 1 от 10');
  // unpublish BG while EN stays live -> BG visitors fall back to the EN page
  await ptabs.nth(0).click(); await admin.waitForTimeout(200);
  await admin.getByRole('switch', { name: /Публикувани — Български страници/ }).click(); await admin.waitForTimeout(700);
  R.check('F1d BG unpublished (EN live): API flag false; BG visitor now gets the EN page; BG pages /media are 404 again', (await api.get('/api/admin/menu')).data.pages.bg.published === false && (await anon.get('/api/public/menu?lang=bg')).data.file.lang === 'en' && (await Promise.all(bgUrls.map((u) => anon.get(u)))).every((r) => r.status === 404));
  // unpublish EN too -> blocked while it is the only live language
  await ptabs.nth(1).click(); await admin.waitForTimeout(200);
  await admin.getByRole('switch', { name: /Публикувани — English pages/ }).click(); await admin.waitForTimeout(700);
  R.check('F1e unpublishing the only live language in file mode is refused with a visible message; flag stays on', /Не може да скриете/.test(await admin.locator('main').innerText()) && (await api.get('/api/admin/menu')).data.pages.en.published === true);
  await ptabs.nth(0).click(); await admin.waitForTimeout(200);
  await admin.getByRole('switch', { name: /Публикувани — Български страници/ }).click(); await admin.waitForTimeout(700);
  R.check('F1f BG published again: both live', (await api.get('/api/admin/menu')).data.pages.bg.published === true);
});

// ===================================================================================== 6. downloads (D-49: admin only)
await step('D1', async () => {
  await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForSelector('.menu-slider');
  const pubTxt = await page.locator('main').innerText();
  R.check('D1a public BG, 10 pages: no "Изтегли…"/"Download" text, no .menu-dl-btn/.menu-page-dl, no element with a download attribute anywhere on the page', !/Изтегли|Download/i.test(pubTxt) && (await page.locator('.menu-dl-btn, .menu-page-dl, .menu-print-bar').count()) === 0 && (await page.locator('[download]').count()) === 0 && !(await page.content()).includes('/api/public/menu/download'));
  const g = await anon.get('/api/public/menu/download?lang=bg'); const h = await anon.req('HEAD', '/api/public/menu/download?lang=bg');
  R.check('D1b public endpoint is gone: GET and HEAD /api/public/menu/download?lang=bg -> 404 (also with a live file menu)', g.status === 404 && h.status === 404, `${g.status} ${h.status}`);
  // admin ZIP through the browser
  await admin.bringToFront(); await go(admin, '#/menu'); await admin.reload({ waitUntil: 'networkidle' }); await admin.waitForSelector('#tab-file'); await tab(admin, 'Файл').click(); await admin.waitForSelector('.a-pagerow'); await ptabs.nth(0).click(); await admin.waitForTimeout(300);
  const dlBg = admin.locator('a[href="/api/admin/menu/pages/download?lang=bg"]');
  R.check('D1c admin BG tab: exactly one "Изтегли менюто (ZIP)" link to /api/admin/menu/pages/download?lang=bg, visible text "Изтегли менюто (ZIP)", accessible name mentions it', (await dlBg.count()) === 1 && (await dlBg.innerText()).includes('Изтегли менюто (ZIP)') && /Изтегли менюто \(ZIP\)/.test(await dlBg.getAttribute('aria-label')), await dlBg.getAttribute('aria-label'));
  const [d] = await Promise.all([admin.waitForEvent('download'), dlBg.click()]);
  const zp = path.join(SCRATCH, `pages-dl-${process.pid}.zip`); await d.saveAs(zp);
  const t = spawnSync('unzip', ['-t', zp], { encoding: 'utf8' }); const l = spawnSync('unzip', ['-Z1', zp], { encoding: 'utf8' });
  const entries = l.stdout.trim().split('\n');
  const want = Array.from({ length: 10 }, (_, i) => `kota1-menu-bg-page-${String(i + 1).padStart(2, '0')}.${i === 9 ? 'pdf' : 'png'}`);
  R.check('D1d clicking it downloads "kota1-menu-bg.zip"; `unzip -t` passes; 10 entries named kota1-menu-bg-page-01..10 in page order (png x9, pdf last)', d.suggestedFilename() === 'kota1-menu-bg.zip' && t.status === 0 && /No errors detected/.test(t.stdout) && entries.join() === want.join(), `${d.suggestedFilename()} ${t.stdout.slice(-80)} ${entries.join()}`);
  const items = (await api.get('/api/admin/menu')).data.pages.bg.items;
  const e1 = spawnSync('unzip', ['-p', zp, 'kota1-menu-bg-page-01.png'], { maxBuffer: 1 << 26 });
  R.check('D1e ZIP entry page-01 is byte-identical to admin page 1 file; entry 10 (PDF) identical to page 10', Buffer.compare(e1.stdout, (await api.get(items[0].fileUrl)).buf) === 0 && Buffer.compare(spawnSync('unzip', ['-p', zp, 'kota1-menu-bg-page-10.pdf'], { maxBuffer: 1 << 26 }).stdout, (await api.get(items[9].fileUrl)).buf) === 0);
  fs.rmSync(zp, { force: true });
  // per-page "Изтегли" link
  const pl = admin.getByRole('link', { name: 'Изтегли страница 2', exact: true });
  R.check('D1f per-page "Изтегли" link: one per page (10), has a download attribute, href = the admin media URL of that page', (await admin.locator('.a-pagerow a[download]').count()) === 10 && (await pl.getAttribute('download')) !== null && (await pl.getAttribute('href')) === items[1].fileUrl, `${await pl.getAttribute('href')} ${items[1].fileUrl}`);
  const [d2] = await Promise.all([admin.waitForEvent('download'), pl.click()]);
  const pp = path.join(SCRATCH, `pages-dl2-${process.pid}`); await d2.saveAs(pp);
  R.check('D1g "Изтегли страница 2" downloads that single page file (bytes equal page 2; not page 1 or 3)', Buffer.compare(fs.readFileSync(pp), (await api.get(items[1].fileUrl)).buf) === 0 && Buffer.compare(fs.readFileSync(pp), (await api.get(items[0].fileUrl)).buf) !== 0 && Buffer.compare(fs.readFileSync(pp), (await api.get(items[2].fileUrl)).buf) !== 0, d2.suggestedFilename());
  fs.rmSync(pp, { force: true });
  // EN tab: add a second EN page via API, reload, ZIP named en with the 2 EN pages (EN set is live and has 1 + 1 pages)
  await api.post('/api/admin/menu/pages', { form: form({ lang: 'en' }, { field: 'file', buf: pagePng(13, 300, 400), name: 'en2.png', type: 'image/png' }) });
  await admin.reload({ waitUntil: 'networkidle' }); await admin.waitForSelector('#tab-file'); await tab(admin, 'Файл').click(); await admin.waitForSelector('.a-pagerow'); await ptabs.nth(1).click(); await admin.waitForTimeout(300);
  const dlEn = admin.locator('a[href="/api/admin/menu/pages/download?lang=en"]');
  R.check('D1h EN tab shows its own ZIP link (lang=en) and no BG link', (await dlEn.count()) === 1 && (await admin.locator('a[href="/api/admin/menu/pages/download?lang=bg"]').count()) === 0);
  const [d3] = await Promise.all([admin.waitForEvent('download'), dlEn.click()]);
  const zp3 = path.join(SCRATCH, `pages-dl3-${process.pid}.zip`); await d3.saveAs(zp3);
  const l3 = spawnSync('unzip', ['-Z1', zp3], { encoding: 'utf8' }).stdout.trim().split('\n');
  R.check('D1i EN ZIP: "kota1-menu-en.zip" with kota1-menu-en-page-01.png, -02.png; unzip -t passes', d3.suggestedFilename() === 'kota1-menu-en.zip' && l3.join() === 'kota1-menu-en-page-01.png,kota1-menu-en-page-02.png' && spawnSync('unzip', ['-t', zp3]).status === 0, `${d3.suggestedFilename()} ${l3.join()}`);
  fs.rmSync(zp3, { force: true });
  // the admin download works in structured mode too (not tied to the public mode) and for UNPUBLISHED pages
  await api.put('/api/admin/menu/mode', { json: { mode: 'structured' } });
  const r2 = await api.get('/api/admin/menu/pages/download?lang=bg');
  R.check('D1j admin ZIP is independent of the public mode: structured mode still 200 application/zip', r2.status === 200 && r2.headers.get('content-type') === 'application/zip', String(r2.status));
  await api.put('/api/admin/menu/mode', { json: { mode: 'file' } });
  R.check('D1k anonymous request to the admin ZIP endpoint is refused (401 unauthorized)', (await anon.get('/api/admin/menu/pages/download?lang=bg')).status === 401);
});

// ===================================================================================== 7. responsive + accessibility of the pages UI
await step('V1', async () => {
  for (const vp of [{ n: 390, w: 390, h: 844 }, { n: 768, w: 768, h: 1024 }, { n: 1280, w: 1280, h: 800 }]) {
    const c = await newPage(browser, { width: vp.w, height: vp.h });
    await c.page.goto(base + '/', { waitUntil: 'networkidle' }); await c.page.waitForSelector('.menu-slider'); await c.page.waitForTimeout(500);
    const h1 = await c.page.locator('h1').count(); const imgsNoAlt = await c.page.locator('.menu-slider img:not([alt]), .menu-slider img[alt=""]').count();
    const btns = await c.page.locator('.menu-slider .zoom-btn, .menu-slider .slider-btn').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    R.check(`V1[${vp.n}] public menu slider: no h-scroll, no console/page errors, no failed requests, one h1, every image has alt, zoom/arrow targets >= 44px`, (await noHScroll(c.page)).ok && c.log.console.length === 0 && c.log.pageErrors.length === 0 && c.log.failed.length === 0 && h1 === 1 && imgsNoAlt === 0 && btns.every(([w, h]) => h >= 44 && w >= 44), JSON.stringify({ log: c.log.console, f: c.log.failed, btns: btns.filter(([w, h]) => h < 44 || w < 44) }));
    await c.context.close();
    const a = await newPage(browser, { width: vp.w, height: vp.h });
    await login(a.page); await go(a.page, '#/menu'); await a.page.waitForSelector('#tab-file'); await tab(a.page, 'Файл').click(); await a.page.waitForSelector('.a-pagerow'); await a.page.waitForTimeout(400);
    const hs = await noHScroll(a.page);
    const small = await a.page.locator('.a-pagerow button, .a-pagerow a, .a-actions a, .a-upload--pages button, [role=switch]').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label') || e.textContent.trim(), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
    R.check(`V2[${vp.n}] admin page manager with 10 of 15 pages: no h-scroll, no console errors (beyond intended 4xx), controls >= 44x44`, hs.ok && a.log.pageErrors.length === 0 && small.length === 0, JSON.stringify({ hs, small, p: a.log.pageErrors }));
    if (vp.n === 390) await a.page.screenshot({ path: path.join(shots, 'pages-admin-390.png'), fullPage: true });
    await a.context.close();
  }
});

await step('A-LOG', async () => {
  const bad = alog.console.filter((m) => !/status of (401|400|409|413|415|404)/.test(m));
  R.check('LOG-A admin session: no page errors / unexpected console errors / CSP violations', alog.pageErrors.length === 0 && bad.length === 0 && (await admin.collectCsp()).length === 0, JSON.stringify({ p: alog.pageErrors, c: bad }));
});
await ctxA.context.close(); await pub.context.close();
await srv.stop();

// ===================================================================================== 8. structured menu (D-49: no print/download button), daily menu, admin ZIP absent with 0 pages (fresh server, port 3202)
const dir2 = tmpDir('pagesprint'); createAdmin(dir2);
const srv2 = await startServer({ port: 3202, dataDir: dir2, now: T0 });
await step('PR', async () => {
  const a2 = new Client(srv2.url); await a2.login();
  await a2.put('/api/admin/menu/draft', { json: { categories: [{ name: 'Салати', nameEn: 'Salads', items: [{ name: 'Шопска салата', nameEn: 'Shopska', description: 'домати', priceCents: 650, available: true }, { name: 'Таратор', nameEn: 'Tarator', description: '', priceCents: 500, available: false }] }, { name: 'Основни', nameEn: 'Mains', items: [{ name: 'Кебапче', nameEn: 'Kebapche', description: '', priceCents: 250, available: true }] }] } });
  await a2.post('/api/admin/menu/publish');
  await a2.put('/api/admin/settings', { json: { address: 'ул. Тест 1', reservationPhone: '+359 2 123 4567' } });
  const c = await newPage(browser, { width: 390, height: 844 });
  const p = c.page;
  await p.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await p.goto(srv2.url + '/', { waitUntil: 'networkidle' }); await p.waitForSelector('.cat');
  const mt = await p.locator('#menu').innerText();
  R.check('PR1 structured mode (D-49): no button/link "Изтегли / Принтирай", no .menu-print-bar/.menu-dl-btn/.print-title, no print button, no [download]; categories and dishes still shown', (await p.getByRole('button', { name: /Принтирай|Print/ }).count()) === 0 && (await p.locator('.menu-print-bar, .menu-dl-btn, .print-title, [download]').count()) === 0 && !/Изтегли|Принтирай/.test(mt) && (await p.locator('#menu button').count()) === 0 && /Шопска салата/.test(mt) && /Кебапче/.test(mt), mt.slice(0, 200));
  R.check('PR2 the first control in #menu is the category nav (nothing precedes it), the page never calls window.print()', (await p.evaluate(() => window.__prints)) === 0);
  await p.emulateMedia({ media: 'print' });
  const txt = await p.evaluate(() => { const shown = (sel) => [...document.querySelectorAll(sel)].some((e) => { const cs = getComputedStyle(e); return cs.display !== 'none' && e.getBoundingClientRect().height > 0; }); return { sections: [...document.querySelectorAll('main > section')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.id), header: shown('.site-header'), footer: shown('.site-footer'), cats: shown('.cat') }; });
  R.check('PR3 @media print stylesheet kept (harmless, D-49): print emulation shows only #menu, no header/footer', txt.sections.join() === 'menu' && !txt.header && !txt.footer && txt.cats, JSON.stringify(txt));
  await p.emulateMedia({ media: 'screen' });
  await p.goto(srv2.url + '/?lang=en', { waitUntil: 'networkidle' }); await p.waitForSelector('.cat');
  R.check('PR4 EN: no "Download / Print" button', (await p.getByRole('button', { name: /Download|Print/ }).count()) === 0 && !/Download|Print/.test(await p.locator('#menu').innerText()));
  R.check('PR5 no console errors / page errors on the structured page', c.log.console.length === 0 && c.log.pageErrors.length === 0, JSON.stringify(c.log.console));
  await c.context.close();
});
// daily menu UI (D-45/D-44/D-49): wizard note, no "past menus" toggle; image daily menu has open + zoom but NO download; PDF open link without download attribute
await step('DM', async () => {
  const a2 = new Client(srv2.url); await a2.login();
  const c = await newPage(browser, { width: 1280, height: 900 });
  const p = c.page;
  await p.goto(srv2.url + '/admin/', { waitUntil: 'networkidle' });
  await p.getByLabel('Потребителско име').fill('owner'); await p.getByLabel('Парола', { exact: true }).fill(PASSWORD); await p.getByRole('button', { name: 'Вход' }).click(); await p.waitForSelector('h1:has-text("Табло")');
  await go(p, '#/daily-menu'); await p.waitForTimeout(700);
  const txt = await p.locator('main').innerText();
  R.check('DM1 daily-menu wizard states "Менютата от минали дни се изтриват автоматично" and the list has no "Покажи минали менюта" toggle', /Менютата от минали дни се изтриват автоматично/.test(txt) && !/Покажи минали менюта/.test(txt), txt.slice(0, 300));
  // admin: 0 pages in both languages -> no "Изтегли менюто (ZIP)" link
  await go(p, '#/menu'); await p.waitForSelector('#tab-file'); await tab(p, 'Файл').click(); await p.waitForTimeout(400);
  const pt = p.locator('[aria-label="Език на страниците"] [role=tab]');
  const zipLinks = async () => p.locator('a[href*="/pages/download"]').count();
  const bg0 = await zipLinks(); await pt.nth(1).click(); await p.waitForTimeout(300); const en0 = await zipLinks();
  R.check('DM0 admin page manager with 0 pages (BG and EN): no "Изтегли менюто (ZIP)" link and no per-page links; direct endpoint answers 404 not_found', bg0 === 0 && en0 === 0 && (await p.getByText('Изтегли менюто (ZIP)').count()) === 0 && (await a2.get('/api/admin/menu/pages/download?lang=bg')).status === 404 && (await a2.get('/api/admin/menu/pages/download?lang=en')).data.error === 'not_found');
  await a2.post('/api/admin/menu/pages', { form: form({ lang: 'bg' }, { field: 'file', buf: makePng(30, 40, [9, 9, 9]), name: 'z.png', type: 'image/png' }) });
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForSelector('#tab-file'); await tab(p, 'Файл').click(); await p.waitForSelector('.a-pagerow'); await pt.nth(0).click(); await p.waitForTimeout(300);
  R.check('DM0b after the first BG page is added the BG ZIP link appears (and EN still has none)', (await zipLinks()) === 1 && (await (async () => { await pt.nth(1).click(); await p.waitForTimeout(300); return zipLinks(); })()) === 0);
  // a past-dated menu created via API is gone from the admin list and from the page after the next upload
  const mk = (date, buf, name, type) => { const fd = new FormData(); fd.append('date', date); fd.append('published', 'true'); fd.append('file', new Blob([buf], { type }), name); return a2.post('/api/admin/daily-menus', { form: fd }); };
  const dmk = await mk('2026-06-15', makePng(30, 40, [1, 2, 3]), 'today.png', 'image/png');
  assert_ok(dmk.status === 201);
  for (const lng of ['bg', 'en']) {
    await p.goto(srv2.url + `/daily-menu?lang=${lng}`, { waitUntil: 'networkidle' }); await p.waitForSelector('.viewer');
    const vt = await p.locator('.viewer-actions').textContent();
    const open = p.locator('.viewer-actions a');
    R.check(`DM2[${lng}] public daily image menu (D-49): one "open in new tab" link (/media/, noopener), NO download link/attribute/text on the page, zoom button present`, (await open.count()) === 1 && (await open.getAttribute('href')).startsWith('/media/') && (await open.getAttribute('target')) === '_blank' && /noopener/.test(await open.getAttribute('rel')) && !/Изтегли|Download/i.test(await p.locator('#daily-view').innerText()) && (await p.locator('[download]').count()) === 0 && (await p.locator('.viewer .zoom-btn').count()) === 1, vt);
    await p.locator('.viewer .zoom-btn').click(); await p.waitForSelector('dialog.lightbox[open]');
    const lbOk = await p.evaluate(() => { const d = document.querySelector('dialog.lightbox'); return d.open && !!d.querySelector('.lb-img') && d.contains(document.activeElement); });
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    R.check(`DM3[${lng}] daily menu lightbox still opens (image visible, focus inside) and Escape closes it`, lbOk && !(await p.evaluate(() => document.querySelector('dialog.lightbox').open)));
  }
  // daily PDF: replace today's menu with a PDF
  const dpdf = await a2.put(`/api/admin/daily-menus/${dmk.data.id}`, { form: form({ date: '2026-06-15', published: 'true' }, { field: 'file', buf: PDF, name: 'd.pdf', type: 'application/pdf' }) });
  assert_ok(dpdf.status < 300);
  for (const lng of ['bg', 'en']) {
    await p.goto(srv2.url + `/daily-menu?lang=${lng}`, { waitUntil: 'networkidle' }); await p.waitForSelector('.viewer');
    const open = p.locator('.viewer a');
    const href = await open.first().getAttribute('href');
    const resp = await a2.get(href);
    R.check(`DM4[${lng}] public daily PDF: exactly one open link ("${lng === 'bg' ? 'Отвори PDF' : 'Open PDF'}", new tab, noopener), no download attribute/text; the link still opens the PDF (200 application/pdf)`, (await open.count()) === 1 && (await open.first().textContent()).includes(lng === 'bg' ? 'Отвори PDF' : 'Open PDF') && (await open.first().getAttribute('target')) === '_blank' && /noopener/.test(await open.first().getAttribute('rel')) && (await p.locator('[download]').count()) === 0 && !/Изтегли|Download/i.test(await p.locator('#daily-view').innerText()) && resp.status === 200 && /application\/pdf/.test(resp.headers.get('content-type')), `${href} ${resp.status} ${resp.headers.get('content-type')}`);
  }
  const dmBad = c.log.console.filter((m) => !/status of 401 \(Unauthorized\) @ \S+\/api\/admin\/me$/.test(m)); // the admin login screen probes /me
  R.check('DM5 no console/page errors on daily pages (only the expected 401 of the admin login probe)', dmBad.length === 0 && c.log.pageErrors.length === 0, JSON.stringify(c.log.console));
  await c.context.close();
});
function assert_ok(v) { if (!v) throw new Error('precondition failed'); }
await srv2.stop();

await browser.close();
for (const d of [dir, dir2]) fs.rmSync(d, { recursive: true, force: true });
R.summary();
fs.writeFileSync(path.join(SCRATCH, 'pages-e2e-results.json'), JSON.stringify(R.results, null, 1));

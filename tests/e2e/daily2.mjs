// T-62 (D-62) browser tests against the REAL backend (no mocks): daily menu with a second page per language.
//  - admin wizard with 2 files per language, edit (add / replace / remove second page), "2 стр." rows, XSS on file names
//  - public /daily-menu with 1 image, 2 images, image + PDF (and PDF + image), BG and EN, at 390 and 1280, lightbox counter
// Port 3201. Clock: 2026-06-15T10:00:00Z (Sofia 13:00, "today" = 2026-06-15).
// Run: node --disable-warning=ExperimentalWarning tests/e2e/daily2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { startServer, createAdmin, Client, tmpDir, makePng, PDF, PASSWORD, reporter } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir, colorsOf, contrast } from '../lib/browser.mjs';

const R = reporter('daily2-e2e');
const shots = shotDir();
const T0 = '2026-06-15T10:00:00Z';
const TODAY = '2026-06-15'; const TOMORROW = '2026-06-16';
const dir = tmpDir('daily2ui'); createAdmin(dir);
const srv = await startServer({ port: 3201, dataDir: dir, now: T0 });
const base = srv.url;
const api = new Client(base); await api.login(); const anon = new Client(base);
const browser = await chromium.launch();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.stack || e.message).split('\n').slice(0, 5).join(' | ')); } };
const D = '/api/admin/daily-menus';
const up = () => fs.readdirSync(path.join(dir, 'uploads'));
// each page has its own colour (index -> red level) so order is readable from pixels
const colour = (i) => [20 + i * 40, 90, 160];
const pg = (i, w = 600, h = 800) => makePng(w, h, colour(i));
const idxOf = (px) => Math.round((px[0] - 20) / 40);
const F = (name, buf, mimeType = 'image/png') => ({ name, mimeType, buffer: buf });
const mp = (fields, files = []) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, String(v)); for (const x of files) fd.append(x.field, new Blob([x.buf], { type: x.type }), x.name); return fd; };
const wipe = async () => { for (const m of (await api.get(D)).data.menus) await api.del(`${D}/${m.id}`); };
const mk = async (date, published, files) => { const r = await api.post(D, { form: mp({ date, published }, files) }); if (r.status !== 201) throw new Error(`seed ${r.status} ${r.text()}`); return r.data; };
const A = (field, i, name, buf, type = 'image/png') => ({ field, buf: buf || pg(i), name: name || `${field}-${i}.png`, type });
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(350); };
async function login(page) {
  await page.goto(base + '/admin/', { waitUntil: 'networkidle' });
  await page.getByLabel('Потребителско име').fill('owner');
  await page.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('h1:has-text("Табло")');
}
const pixel = (page, sel, nth = 0) => page.locator(sel).nth(nth).evaluate((img) => new Promise((res) => {
  const go2 = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); res([...x.getImageData(5, 5, 1, 1).data]); };
  if (img.complete && img.naturalWidth) go2(); else img.addEventListener('load', go2);
}));

// ============================================================================ ADMIN (1280)
const ctxA = await newPage(browser, { width: 1280, height: 900 });
const admin = ctxA.page; const alog = ctxA.log;
await login(admin);

await step('AD1', async () => {
  await go(admin, '#/daily-menu'); await admin.waitForSelector('h3:has-text("Избери файлове")');
  const inputs = admin.locator('.a-step input[type=file]');
  R.check('AD1a step 1 initially shows only the two first-page inputs and no "Втора страница" slot (a second page needs a first one)', (await inputs.count()) === 2 && (await admin.getByText('Втора страница (по избор)').count()) === 0);
  const bgSec = admin.locator('section.a-fileslang[lang=bg]'); const enSec = admin.locator('section.a-fileslang[lang=en]');
  await bgSec.locator('input[type=file]').first().setInputFiles(F('bg-1.png', pg(0)));
  R.check('AD1b choosing a Bulgarian first page reveals the BG second slot "Втора страница (по избор)" (not the EN one)', (await bgSec.getByText('Втора страница (по избор)').count()) === 1 && (await enSec.getByText('Втора страница (по избор)').count()) === 0 && (await bgSec.locator('input[type=file]').count()) === 2);
  await bgSec.locator('input[type=file]').nth(1).setInputFiles(F('bg-2.png', pg(1)));
  await enSec.locator('input[type=file]').first().setInputFiles(F('en-1.png', pg(2)));
  await enSec.locator('input[type=file]').nth(1).setInputFiles(F('en-2.png', pg(3)));
  R.check('AD1c both language blocks hold 2 files with previews/names (bg-1, bg-2, en-1, en-2 visible)', (await admin.locator('.a-step').innerText()).includes('bg-2.png') && (await admin.locator('.a-step').innerText()).includes('en-2.png'));
  await admin.screenshot({ path: path.join(shots, 'daily2-admin-wizard.png'), fullPage: true });
  await admin.getByRole('button', { name: 'Напред' }).click(); await admin.getByRole('button', { name: 'Напред' }).click();
  const s3 = await admin.locator('.a-step').innerText();
  R.check('AD1d review lists all 4 files (BG, BG 2-ра страница, English, English 2-ра страница) in order', /Български файл: bg-1\.png/.test(s3) && /Български файл, 2-ра страница: bg-2\.png/.test(s3) && /English файл: en-1\.png/.test(s3) && /English файл, 2-ра страница: en-2\.png/.test(s3) && s3.indexOf('bg-2.png') < s3.indexOf('en-1.png'), s3.slice(0, 300).replace(/\n/g, '|'));
  await admin.getByRole('button', { name: 'Напред' }).click();
  await admin.getByRole('button', { name: 'Публикувай', exact: true }).click();
  await admin.waitForSelector('text=е публикувано'); await admin.waitForTimeout(400);
  const m = (await api.get(D)).data.menus[0];
  R.check('AD1e published via the wizard: API item has BG first+second and EN first+second with the right names, in order, as multipart file/file2/fileEn/fileEn2', m && m.date === TODAY && m.published && m.originalName === 'bg-1.png' && m.file2?.originalName === 'bg-2.png' && m.originalNameEn === 'en-1.png' && m.fileEn2?.originalName === 'en-2.png', JSON.stringify([m?.originalName, m?.file2?.originalName, m?.originalNameEn, m?.fileEn2?.originalName]));
  R.check('AD1f 4 files on disk and all four are served publicly today (media 200 x4)', up().length === 4 && (await Promise.all([m.fileUrl, m.file2.fileUrl, m.fileEnUrl, m.fileEn2.fileUrl].map((u) => anon.get(u.replace('/api/admin/media', '/media'))))).every((r) => r.status === 200));
  const row = await admin.locator('article.a-menu').first().innerText();
  R.check('AD1g the list row shows "2 стр." for BG and for EN, and the preview links "БГ стр. 2" / "EN стр. 2" (noopener, accessible names)', (row.match(/2 стр\./g) || []).length === 2 && (await admin.locator('article.a-menu a[aria-label="Преглед на втората страница (български)"][rel~=noopener][target=_blank]').count()) === 1 && (await admin.locator('article.a-menu a[aria-label="Преглед на втората страница (английски)"][rel~=noopener]').count()) === 1, row.replace(/\n/g, '|'));
  await admin.screenshot({ path: path.join(shots, 'daily2-admin-list.png'), fullPage: true });
});

await step('AD2', async () => {
  // wizard with a first page but NO second: no "2 стр." and no file2/fileEn2; removing the first page hides/clears the second slot
  await wipe();
  await go(admin, '#/'); await go(admin, '#/daily-menu'); await admin.waitForSelector('h3:has-text("Избери файлове")');
  const bgSec = admin.locator('section.a-fileslang[lang=bg]');
  await bgSec.locator('input[type=file]').first().setInputFiles(F('only-1.png', pg(0)));
  await bgSec.locator('input[type=file]').nth(1).setInputFiles(F('only-2.png', pg(1)));
  const clearBtn = bgSec.getByRole('button', { name: /Премахни|Изчисти|Махни/ });
  const nBtn = await clearBtn.count();
  R.check('AD2a the BG block has remove controls for the files (first + second)', nBtn >= 2, String(nBtn));
  await clearBtn.first().click(); await admin.waitForTimeout(300);
  const inputsAfter = await admin.locator('.a-step input[type=file]').count();
  R.check('AD2b removing the first page also drops the second page (slot disappears), Next is disabled again, and BOTH language blocks still offer a file chooser (2 inputs: BG and EN first page)', (await bgSec.getByText('Втора страница (по избор)').count()) === 0 && (await admin.getByRole('button', { name: 'Напред' }).isDisabled()) && inputsAfter === 2, `file inputs left in the wizard: ${inputsAfter} (BG block text: ${JSON.stringify(await bgSec.innerText())})`);
  if (inputsAfter !== 2) { await admin.screenshot({ path: path.join(shots, 'daily2-BUG-wizard-no-uploaders.png') }); await admin.reload({ waitUntil: 'networkidle' }); await admin.waitForSelector('h3:has-text("Избери файлове")'); } // recover so that the remaining checks can run
  await bgSec.locator('input[type=file]').first().setInputFiles(F('solo.png', pg(0)));
  await admin.getByRole('button', { name: 'Напред' }).click(); await admin.getByRole('button', { name: 'Напред' }).click(); await admin.getByRole('button', { name: 'Напред' }).click();
  await admin.getByRole('button', { name: 'Публикувай', exact: true }).click(); await admin.waitForSelector('text=е публикувано'); await admin.waitForTimeout(300);
  const m = (await api.get(D)).data.menus[0];
  R.check('AD2c a one-page menu: file2 and fileEn2 stay null, only 1 file on disk (the dropped second file was never uploaded), row has no "2 стр."', m.file2 === null && m.fileEn2 === null && up().length === 1 && !(await admin.locator('article.a-menu').first().innerText()).includes('2 стр.'), `up=${up().length}`);
});

await step('AD3', async () => {
  try {
  await wipe();
  const m0 = await mk(TOMORROW, 'false', [A('file', 0, 'b1.png'), A('fileEn', 1, 'e1.png')]);
  await admin.reload({ waitUntil: 'networkidle' }); await admin.waitForSelector('article.a-menu');
  const row = () => admin.locator('article.a-menu').filter({ hasText: '16 юни' });
  const openEdit = async () => { await row().getByRole('button', { name: 'Редактирай' }).click(); await admin.waitForSelector('dialog[open] h2:has-text("Редактиране на меню")'); return admin.locator('dialog[open]'); };
  const boxes = (d) => ({ bg: d.locator('.a-form > .a-field').nth(1), en: d.locator('.a-form > .a-field').nth(2) });
  const cur = async () => (await api.get(D)).data.menus.find((x) => x.id === m0.id);
  let d = await openEdit(); let b = boxes(d);
  R.check('AD3a edit dialog: each language with a first page offers an optional "Втора страница (по избор)" slot (own file input)', (await b.bg.getByText('Втора страница (по избор)').count()) === 1 && (await b.en.getByText('Втора страница (по избор)').count()) === 1 && (await b.bg.locator('input[type=file]').count()) === 2 && (await b.en.locator('input[type=file]').count()) === 2);
  await b.bg.locator('input[type=file]').nth(1).setInputFiles(F('b2.png', pg(2)));
  await b.en.locator('input[type=file]').nth(1).setInputFiles(F('e2.png', pg(3)));
  await d.getByRole('button', { name: 'Запази' }).click(); await admin.waitForSelector('.a-toast:has-text("Менюто е обновено.")'); await admin.waitForTimeout(400);
  let m = await cur();
  R.check('AD3b adding second pages in edit: PUT stores file2 "b2.png" and fileEn2 "e2.png"; first pages unchanged; 4 files on disk; row shows "2 стр." twice', m.file2?.originalName === 'b2.png' && m.fileEn2?.originalName === 'e2.png' && m.originalName === 'b1.png' && m.originalNameEn === 'e1.png' && up().length === 4 && ((await row().innerText()).match(/2 стр\./g) || []).length === 2, JSON.stringify([m.file2?.originalName, m.fileEn2?.originalName, up().length]));
  // replace the BG second page
  const oldName = path.basename(m.file2.fileUrl);
  d = await openEdit(); b = boxes(d);
  R.check('AD3c reopened: the dialog names the current second pages ("Текуща 2-ра страница: b2.png") and offers "Премахни втората страница" per language', (await b.bg.innerText()).includes('Текуща 2-ра страница: b2.png') && (await b.en.innerText()).includes('Текуща 2-ра страница: e2.png') && (await b.bg.getByRole('button', { name: 'Премахни втората страница' }).count()) === 1);
  await b.bg.locator('input[type=file]').nth(1).setInputFiles(F('b2-new.png', pg(4)));
  await d.getByRole('button', { name: 'Запази' }).click(); await admin.waitForSelector('.a-toast:has-text("Менюто е обновено.")'); await admin.waitForTimeout(400);
  m = await cur();
  R.check('AD3d replacing the BG second page: name b2-new.png, old file deleted from disk, still 4 files', m.file2?.originalName === 'b2-new.png' && !up().includes(oldName) && up().length === 4, `up=${up().length}`);
  // remove only the BG second page
  d = await openEdit(); b = boxes(d);
  await b.bg.getByRole('button', { name: 'Премахни втората страница' }).click();
  R.check('AD3e "Премахни втората страница" shows the info "Втората страница ще бъде премахната при запазване." and an undo button; the EN second page is untouched', (await b.bg.getByText('Втората страница ще бъде премахната при запазване.').count()) === 1 && (await b.bg.getByRole('button', { name: 'Върни втората страница' }).count()) === 1 && (await b.en.getByRole('button', { name: 'Премахни втората страница' }).count()) === 1);
  await d.getByRole('button', { name: 'Запази' }).click(); await admin.waitForSelector('.a-toast:has-text("Менюто е обновено.")'); await admin.waitForTimeout(400);
  m = await cur();
  R.check('AD3f after saving: file2 null, fileEn2 kept, 3 files on disk, row shows "2 стр." once', m.file2 === null && m.fileEn2?.originalName === 'e2.png' && up().length === 3 && ((await row().innerText()).match(/2 стр\./g) || []).length === 1, `up=${up().length}`);
  // undo works (no change sent)
  d = await openEdit(); b = boxes(d);
  await b.en.getByRole('button', { name: 'Премахни втората страница' }).click(); await b.en.getByRole('button', { name: 'Върни втората страница' }).click();
  R.check('AD3g undo restores the "Премахни втората страница" button', (await b.en.getByRole('button', { name: 'Премахни втората страница' }).count()) === 1);
  // remove the EN FIRST page while an EN second page exists: the UI removes both (server rule: no second without first)
  R.check('AD3h0 the EN "remove first page" button keeps its pre-D-62 wording "Премахни английския файл" (same as the existing langs.mjs ED1/ED2 expectations)', (await b.en.getByRole('button', { name: 'Премахни английския файл' }).count()) === 1, JSON.stringify(await b.en.getByRole('button').allInnerTexts()));
  await b.en.getByRole('button', { name: /^Премахни английск/ }).click();
  await d.getByRole('button', { name: 'Запази' }).click(); await admin.waitForSelector('.a-toast:has-text("Менюто е обновено.")'); await admin.waitForTimeout(400);
  m = await cur();
  R.check('AD3h removing the English first page also removes its second page (no server 400); only the BG first page remains on disk', m.fileEnUrl === null && m.fileEn2 === null && m.originalName === 'b1.png' && up().length === 1, `up=${up().length} ${JSON.stringify([m.fileEnUrl, m.fileEn2])}`);
  // server-side rejection is shown in the dialog: spoofed second file
  d = await openEdit(); b = boxes(d);
  await b.bg.locator('input[type=file]').nth(1).setInputFiles(F('evil.png', Buffer.from('<html><script>alert(1)</script></html>')));
  await d.getByRole('button', { name: 'Запази' }).click(); await admin.waitForTimeout(900);
  const dt = await b.bg.innerText();
  R.check('AD3i a spoofed second page (HTML named .png) is rejected by the server (415) and the error is shown at that slot; the dialog stays open; nothing stored', /Позволени са само PDF, JPG, PNG и WebP файлове\./.test(dt) && (await admin.locator('dialog[open]').count()) === 1 && (await cur()).file2 === null && up().length === 1, dt.replace(/\n/g, '|').slice(0, 300));
  await d.getByRole('button', { name: /Отказ|Затвори/ }).first().click().catch(() => admin.keyboard.press('Escape')); await admin.waitForTimeout(300);
  await admin.screenshot({ path: path.join(shots, 'daily2-admin-edit.png'), fullPage: true });
  } finally { while (await admin.locator('dialog[open]').count()) { await admin.keyboard.press('Escape'); await admin.waitForTimeout(250); } }
});

await step('AD4', async () => {
  // XSS: names are text everywhere in the admin. Client-side raw markup name in the wizard (Playwright allows any file name), server-stored entity-looking name in the dialog.
  await wipe();
  while (await admin.locator('dialog[open]').count()) { await admin.keyboard.press('Escape'); await admin.waitForTimeout(250); }
  await admin.evaluate(() => { window.__x = 0; });
  await go(admin, '#/'); await go(admin, '#/daily-menu'); await admin.waitForSelector('h3:has-text("Избери файлове")');
  const raw = '<img src=x onerror=window.__x=1>.png';
  const bgSec = admin.locator('section.a-fileslang[lang=bg]');
  await bgSec.locator('input[type=file]').first().setInputFiles(F('ok.png', pg(0)));
  await bgSec.locator('input[type=file]').nth(1).setInputFiles(F(raw, pg(1)));
  await admin.waitForTimeout(300);
  const step1 = await admin.locator('.a-step').innerText();
  R.check('AD4a the raw markup file name appears as literal text in the wizard (no <img> element created, no handler ran)', step1.includes(raw) && (await admin.locator('.a-step img[src="x"]').count()) === 0 && !(await admin.evaluate(() => window.__x)), step1.slice(0, 200));
  await admin.getByRole('button', { name: 'Напред' }).click(); await admin.getByRole('button', { name: 'Напред' }).click();
  const s3 = await admin.locator('.a-step').innerText();
  R.check('AD4b the review step shows it as text too', s3.includes(raw) && (await admin.locator('.a-step img[src="x"]').count()) === 0 && !(await admin.evaluate(() => window.__x)));
  await admin.getByRole('button', { name: 'Напред' }).click(); await admin.getByRole('button', { name: 'Публикувай', exact: true }).click(); await admin.waitForSelector('text=е публикувано'); await admin.waitForTimeout(400);
  const m = (await api.get(D)).data.menus[0];
  R.check('AD4c server stores the sanitised name (< > replaced) for the second file', m.file2.originalName === '_img src=x onerror=window.__x=1_.png', m.file2.originalName);
  await wipe();
  const ent = "&lt;img src=x onerror=window.__x=1&gt;'x.png";
  const m2 = await mk(TOMORROW, 'false', [A('file', 0, 'ok.png'), { field: 'file2', buf: pg(1), name: ent, type: 'image/png' }]);
  await admin.reload({ waitUntil: 'networkidle' }); await admin.waitForSelector('article.a-menu');
  await admin.locator('article.a-menu').first().getByRole('button', { name: 'Редактирай' }).click(); await admin.waitForSelector('dialog[open] h2:has-text("Редактиране на меню")');
  const dt = await admin.locator('dialog[open]').innerText();
  const trunc = await admin.locator('article.a-menu').first().innerHTML();
  R.check('AD4d the entity-looking second-file name is shown literally in the edit dialog ("&lt;img ..." text, not decoded to a tag); no injected <img src=x>; no handler ran', dt.includes(ent) && (await admin.locator('dialog[open] img[src="x"], article.a-menu img[src="x"]').count()) === 0 && !(await admin.evaluate(() => window.__x)) && !trunc.includes('<img src="x"'), dt.slice(0, 300));
  await admin.keyboard.press('Escape'); await admin.waitForTimeout(300);
  void m2;
});

R.check('AD-LOG admin: no page errors, no CSP violations, no failed requests, no unexpected console errors', alog.pageErrors.length === 0 && (await admin.collectCsp()).length === 0 && alog.failed.length === 0 && alog.console.filter((m) => !/status of (401|400|409|413|415|404)/.test(m)).length === 0, JSON.stringify({ p: alog.pageErrors, f: alog.failed, c: alog.console }));

// ============================================================================ PUBLIC /daily-menu
const SC = {
  one: { label: '1 image (BG only)', files: () => [A('file', 0, 'solo.png')], n: 1, pdf: [] },
  two: { label: '2 images BG + 2 images EN', files: () => [A('file', 0, 'b1.png'), A('file2', 1, 'b2.png'), A('fileEn', 2, 'e1.png'), A('fileEn2', 3, 'e2.png')], n: 2, pdf: [] },
  imgPdf: { label: 'image + PDF (both languages)', files: () => [A('file', 0, 'b1.png'), A('file2', 0, 'b2.pdf', PDF, 'application/pdf'), A('fileEn', 2, 'e1.png'), A('fileEn2', 0, 'e2.pdf', PDF, 'application/pdf')], n: 2, pdf: [1] },
  pdfImg: { label: 'PDF + image (BG only; EN falls back to the BG pages)', files: () => [A('file', 0, 'b1.pdf', PDF, 'application/pdf'), A('file2', 1, 'b2.png')], n: 2, pdf: [0] },
};
const EXPECT_IDX = { one: { bg: [0], en: [0] }, two: { bg: [0, 1], en: [2, 3] }, imgPdf: { bg: [0], en: [2] }, pdfImg: { bg: [1], en: [1] } };

for (const [key, sc] of Object.entries(SC)) {
  await wipe(); await mk(TODAY, 'true', sc.files());
  for (const lang of ['bg', 'en']) {
    for (const vp of [{ n: 390, w: 390, h: 844 }, { n: 1280, w: 1280, h: 800 }]) {
      const id = `${key}/${lang}/${vp.n}`;
      await step(`PUB-${id}`, async () => {
        const c = await newPage(browser, { width: vp.w, height: vp.h });
        const p = c.page;
        await p.goto(`${base}/daily-menu?lang=${lang}`, { waitUntil: 'networkidle' });
        await p.waitForSelector('#daily-view .paper, #daily-view .daily-pages', { timeout: 10000 });
        await p.waitForTimeout(300);
        const L = lang === 'bg' ? { cap: (n, m) => `Страница ${n} от ${m}` } : { cap: (n, m) => `Page ${n} of ${m}` };
        const caps = await p.locator('.daily-page-cap').allInnerTexts();
        const nImgs = await p.locator('#daily-view img').count();
        const nPdf = await p.locator('#daily-view .pdf-card, #daily-view object, #daily-view embed, #daily-view iframe').count();
        const links = await p.locator('#daily-view a[target=_blank]').evaluateAll((as) => as.map((a) => ({ rel: a.rel, href: a.getAttribute('href') })));
        const expectImgs = sc.n - sc.pdf.length;
        const capsOk = sc.n === 1 ? caps.length === 0 : caps.length === sc.n && caps.every((t, i) => t === L.cap(i + 1, sc.n));
        // the order of the images is the order of the pages (colour per page)
        const idxs = []; for (let i = 0; i < nImgs; i++) idxs.push(idxOf(await pixel(p, '#daily-view .paper img, #daily-view img', i)));
        const expIdx = EXPECT_IDX[key][lang];
        R.check(`PUB1[${id}] ${sc.label}: ${expectImgs} image(s) in page order (colours ${expIdx.join(',')}), captions ${sc.n === 1 ? 'absent (single file looks as before)' : '"' + L.cap(1, sc.n) + '"…'}, ${sc.pdf.length} PDF`, nImgs === expectImgs && idxs.join() === expIdx.join() && capsOk, JSON.stringify({ nImgs, idxs, caps }));
        if (sc.pdf.length) {
          const pdfLinkOk = links.length >= sc.pdf.length && links.every((l) => /noopener/.test(l.rel)) && links.some((l) => /\.pdf$/.test(l.href || ''));
          R.check(`PUB2[${id}] the PDF page has its own open link (new tab, noopener), no download attribute`, pdfLinkOk && (await p.locator('#daily-view [download]').count()) === 0, JSON.stringify(links));
        }
        const imgAlts = await p.locator('#daily-view img').evaluateAll((is) => is.map((i) => i.alt));
        R.check(`PUB3[${id}] every image has an alt (page-specific when 2 pages: "… - ${L.cap(1, 2)}")`, imgAlts.every(Boolean) && (sc.n === 1 || imgAlts.every((a) => / - (Страница|Page) \d+ (от|of) \d+$/.test(a))), JSON.stringify(imgAlts));
        if (key === 'two') {
          const cc = await colorsOf(p, '.daily-page-cap'); const ratio = contrast(cc.fg, cc.bg);
          R.check(`PUB6[${id}] page caption "${L.cap(1, 2)}" has computed contrast >= 4.5:1 (${ratio.toFixed(2)}), one <h1> on the page`, ratio >= 4.5 && (await p.locator('h1').count()) === 1, JSON.stringify(cc));
        }
        // lightbox on the first image
        if (expectImgs >= 1) {
          await p.locator('#daily-view .zoom-btn').first().click(); await p.waitForSelector('dialog.lightbox[open]');
          const pos = () => p.locator('dialog.lightbox .lb-pos').innerText();
          const lbPx = () => p.locator('dialog.lightbox .lb-img').evaluate((img) => new Promise((res) => { const g = () => { const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); res([...x.getImageData(2, 2, 1, 1).data]); }; if (img.complete && img.naturalWidth) g(); else img.addEventListener('load', g); }));
          const firstNum = key === 'pdfImg' ? 2 : 1; // pdfImg: the only image is page 2 of 2
          if (sc.n === 1) {
            R.check(`PUB4[${id}] single file: the lightbox opens without a page counter and without prev/next buttons`, !(await p.locator('dialog.lightbox .lb-pos').isVisible()) && !(await p.locator('dialog.lightbox .lb-btn[aria-label*="Следваща"], dialog.lightbox .lb-btn[aria-label*="Next"]').isVisible()));
          } else if (key === 'two') {
            const p1 = await pos(); const detail = [p1];
            let ok = p1 === L.cap(1, 2);
            await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250);
            const p2 = await pos(); detail.push(p2);
            ok = ok && p2 === L.cap(2, 2) && idxOf(await lbPx()) === expIdx[1];
            await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150);
            ok = ok && (await pos()) === L.cap(2, 2) && (await p.locator('dialog.lightbox .lb-btn[aria-label*="Следваща"], dialog.lightbox .lb-btn[aria-label*="Next"]').isDisabled()); // no wrap past the last page, next disabled
            R.check(`PUB4[${id}] lightbox counter "${L.cap(1, 2)}" -> ArrowRight -> "${L.cap(2, 2)}" (2nd image), no wrap at the end, next disabled`, ok, JSON.stringify(detail));
            await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(250);
            R.check(`PUB4b[${id}] keyboard only: ArrowLeft from the last page goes back to "${L.cap(1, 2)}" (focus must not be lost when "Next" becomes disabled)`, (await pos()) === L.cap(1, 2) && idxOf(await lbPx()) === expIdx[0], `pos=${await pos()} active=${await p.evaluate(() => document.activeElement.tagName)}`);
          } else {
            // image + PDF: the gallery holds ONE image, so the lightbox has no counter/prev/next; the page caption above the image carries "Страница N от 2"
            R.check(`PUB4[${id}] ${sc.label}: single-image lightbox opens (no counter, no prev/next); the on-page caption "${L.cap(firstNum, 2)}" belongs to that image`, !(await p.locator('dialog.lightbox .lb-pos').isVisible()) && (await p.locator('dialog.lightbox .lb-img').isVisible()) && (await p.locator('#daily-view .paper').filter({ has: p.locator('img') }).locator('xpath=preceding-sibling::p[1] | ../p[1]').first().innerText().catch(() => '')) .includes(L.cap(firstNum, 2)));
          }
          await p.keyboard.press('Escape'); await p.waitForTimeout(200);
        }
        R.check(`PUB5[${id}] no horizontal scroll, no console/page errors, no failed requests, no CSP violations`, (await noHScroll(p)).ok && c.log.console.length === 0 && c.log.pageErrors.length === 0 && c.log.failed.length === 0 && (await p.collectCsp()).length === 0, JSON.stringify({ hs: await noHScroll(p), c: c.log.console, f: c.log.failed }));
        if (key === 'two' || key === 'imgPdf') await p.screenshot({ path: path.join(shots, `daily2-public-${key}-${lang}-${vp.n}.png`), fullPage: true });
        await c.context.close();
      });
    }
  }
}

await wipe();
R.summary();
await browser.close(); await srv.stop(); fs.rmSync(dir, { recursive: true, force: true });

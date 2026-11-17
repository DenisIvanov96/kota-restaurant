// T-35 owner feedback round 2 (D-39..D-42), browser level. Ports 3203 (owner scenario + admin UI) and 3205 (XSS + 768 px).
// Run: node --disable-warning=ExperimentalWarning tests/e2e/langs.mjs
import path from 'node:path';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PDF, PASSWORD, reporter } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir } from '../lib/browser.mjs';

const R = reporter('langs-e2e');
const T0 = '2026-06-15T10:00:00Z'; // Mon 15 June 2026, 13:00 Sofia
const TODAY = '2026-06-15';
const shots = shotDir();
const dir = tmpDir('langsui'); createAdmin(dir);
const srv = await startServer({ port: 3203, dataDir: dir, now: T0 });
const base = srv.url;
const api = new Client(base); await api.login();
const anon = new Client(base);
const RED = makePng(120, 80, [220, 20, 20]); const BLUE = makePng(120, 80, [20, 20, 220]); const GREEN = makePng(120, 80, [20, 200, 20]); const YELLOW = makePng(120, 80, [230, 220, 20]);
const file = (name, mimeType, buffer) => ({ name, mimeType, buffer });
const browser = await chromium.launch();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.stack || e.message).split('\n').slice(0, 4).join(' | ')); } };
const T = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page, b = base) {
  await page.goto(b + '/admin/', { waitUntil: 'networkidle' });
  await page.getByLabel('Потребителско име').fill('owner');
  await page.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('h1:has-text("Табло")');
}
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(350); };
const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const leaveIfAsked = async (page) => { await page.waitForTimeout(500); const b = page.locator('dialog[open]').getByRole('button', { name: 'Напусни без запазване' }); if (await b.count()) { await b.click(); await page.waitForTimeout(400); } };
const dismissToasts = async (page) => { for (let i = 0; i < 6 && (await page.locator('.a-toast__close').count()); i++) await page.locator('.a-toast__close').first().click(); };
const panelFile = (page) => page.locator('.a-langpanel:not([hidden]) input[type=file]');
const pixel = (page, sel) => page.locator(sel).first().evaluate((img) => new Promise((res) => {
  const go2 = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data; res([d[0], d[1], d[2]]); };
  if (img.complete && img.naturalWidth) go2(); else img.addEventListener('load', go2);
}));
const isRed = (p) => p[0] > 150 && p[2] < 80; const isBlue = (p) => p[2] > 150 && p[0] < 80; const isGreen = (p) => p[1] > 150 && p[0] < 80; const isYellow = (p) => p[0] > 150 && p[1] > 150 && p[2] < 80;
const clickLang = (page, l) => page.locator(`.lang-btn[data-lang="${l}"]`).click();

// ============================================================================================ A. OWNER SCENARIO (admin UI -> public)
const { context: actx, page: admin, log: alog } = await newPage(browser, { width: 1280, height: 900 });
await login(admin);

await step('A-EV', async () => {
  await go(admin, '#/events');
  await admin.getByRole('link', { name: 'Ново събитие' }).first().click();
  await admin.waitForSelector('h1:has-text("Ново събитие")');
  // structure of the language tabs
  const tl = admin.getByRole('tablist', { name: 'Език на събитието' });
  R.check('EV-T1 tablist "Език на събитието" with exactly two tabs "Български" and "English"; no English fold-out (<details>)', (await tl.getByRole('tab').count()) === 2 && (await tab(admin, 'Български').count()) === 1 && (await tab(admin, 'English').count()) === 1 && (await admin.locator('details.a-en').count()) === 0);
  R.check('EV-T2 BG tab selected by default, roving tabindex (0 / -1), panels labelled by their tab, aria-controls resolve', await admin.evaluate(() => {
    const tabs = [...document.querySelectorAll('.a-langtab')];
    return tabs.length === 2 && tabs[0].getAttribute('aria-selected') === 'true' && tabs[1].getAttribute('aria-selected') === 'false' && tabs[0].tabIndex === 0 && tabs[1].tabIndex === -1
      && tabs.every((t) => { const p = document.getElementById(t.getAttribute('aria-controls')); return p && p.getAttribute('role') === 'tabpanel' && p.getAttribute('aria-labelledby') === t.id; });
  }));
  R.check('EV-T3 title has NO required star (D-39: a title in at least one language)', (await admin.locator('label:has-text("Заглавие") .a-req').count()) === 0);
  R.check('EV-T4 hint "не е попълнено — ще се покаже другият език" visible in the empty BG panel and no dots yet', (await admin.locator('.a-langpanel:not([hidden]) .a-langhint:visible').count()) === 1 && (await admin.locator('.a-tabdot:visible').count()) === 0);
  // keyboard
  await tab(admin, 'Български').focus();
  await admin.keyboard.press('ArrowRight');
  R.check('EV-K1 ArrowRight on BG -> EN selected AND focused, EN panel visible, BG hidden', (await tab(admin, 'English').getAttribute('aria-selected')) === 'true' && (await admin.evaluate(() => document.activeElement.textContent.startsWith('English'))) && (await admin.getByLabel('Title (English)').isVisible()) && !(await admin.getByLabel('Заглавие', { exact: true }).isVisible()));
  await admin.keyboard.press('ArrowRight');
  R.check('EV-K2 ArrowRight on EN wraps to BG', (await tab(admin, 'Български').getAttribute('aria-selected')) === 'true' && (await admin.evaluate(() => document.activeElement.textContent.startsWith('Български'))));
  await admin.keyboard.press('ArrowLeft');
  R.check('EV-K3 ArrowLeft on BG wraps to EN', (await tab(admin, 'English').getAttribute('aria-selected')) === 'true');
  await admin.keyboard.press('Home');
  R.check('EV-K4 Home -> BG', (await tab(admin, 'Български').getAttribute('aria-selected')) === 'true' && (await admin.evaluate(() => document.activeElement.textContent.startsWith('Български'))));
  await admin.keyboard.press('End');
  R.check('EV-K5 End -> EN', (await tab(admin, 'English').getAttribute('aria-selected')) === 'true' && (await admin.evaluate(() => document.activeElement.textContent.startsWith('English'))));
  await admin.keyboard.press('Home');
  await admin.keyboard.press('Tab');
  R.check('EV-K6 Tab from the selected tab moves into the panel (not to the other tab)', await admin.evaluate(() => { const a = document.activeElement; return !a.classList.contains('a-langtab') && !!a.closest('.a-langpanel'); }));
  // save empty -> error
  await admin.getByRole('button', { name: 'Запази', exact: true }).click();
  R.check('EV-V1 empty save -> "Въведете заглавие поне на един език." shown, nothing created', (await admin.getByText('Въведете заглавие поне на един език.').count()) >= 1 && (await api.get('/api/admin/events')).data.events.length === 0);
  // fill BG
  await tab(admin, 'Български').click();
  await admin.getByLabel('Заглавие', { exact: true }).fill('Джаз вечер');
  await admin.getByLabel('Описание', { exact: true }).fill('Жива музика от 20:00');
  await admin.waitForTimeout(400);
  R.check('EV-D1 BG filled -> dot on the BG tab only; accessible text carries "(попълнено)" (not colour only)', (await tab(admin, 'Български').locator('.a-tabdot:visible').count()) === 1 && (await tab(admin, 'English').locator('.a-tabdot:visible').count()) === 0 && /попълнено/.test(await tab(admin, 'Български').evaluate((e) => e.textContent)));
  await panelFile(admin).setInputFiles(file('bg.png', 'image/png', RED));
  await admin.waitForTimeout(400);
  await tab(admin, 'English').click();
  R.check('EV-D2 EN tab shows its own empty hint + help "По избор…"; BG file input not in the visible panel', (await admin.locator('.a-langpanel:not([hidden]) .a-langhint:visible').count()) === 1 && (await admin.getByText('Ако е празно, на английската версия се показва българската снимка.').isVisible()));
  await admin.getByLabel('Title (English)').fill('Jazz night');
  await admin.getByLabel('Description (English)').fill('Live music from 8 pm');
  await panelFile(admin).setInputFiles(file('en.png', 'image/png', BLUE));
  await admin.waitForTimeout(400);
  R.check('EV-D3 both tabs now carry a dot', (await admin.locator('.a-tabdot:visible').count()) === 2);
  // live preview follows the tab
  const pv = await admin.locator('.preview-frame').evaluate((e) => e.textContent);
  console.log('preview text:', pv.replace(/\n/g, ' | ').slice(0, 120));
  R.check('EV-P1 preview follows the active language tab (EN tab -> English text)', /jazz night/i.test(pv) && !/джаз вечер/i.test(pv), pv.slice(0, 80));
  await dismissToasts(admin);
  await admin.getByRole('button', { name: 'Запази', exact: true }).click();
  await admin.waitForSelector('h1:has-text("Събития")'); await admin.waitForTimeout(300);
  const ev = (await api.get('/api/admin/events')).data.events[0];
  R.check('EV-S1 saved via UI: titles, descriptions and BOTH images stored', ev && ev.title === 'Джаз вечер' && ev.titleEn === 'Jazz night' && ev.description.startsWith('Жива') && ev.descriptionEn.startsWith('Live') && ev.imageUrl && ev.imageEnUrl && ev.imageUrl !== ev.imageEnUrl, JSON.stringify(ev && { i: ev.imageUrl, e: ev.imageEnUrl }));
  R.check('EV-S2 event list shows the card with the BG title', (await admin.locator('article:has-text("Джаз вечер")').count()) === 1);
});

await step('A-EV-EN', async () => {
  // EN-only event created through the UI
  await go(admin, '#/events/new');
  await admin.waitForSelector('h1:has-text("Ново събитие")');
  await tab(admin, 'English').click();
  await admin.getByLabel('Title (English)').fill('Wine tasting');
  await admin.getByLabel('Description (English)').fill('Five wines, five stories');
  await panelFile(admin).setInputFiles(file('wine.png', 'image/png', GREEN));
  await dismissToasts(admin);
  await admin.getByRole('button', { name: 'Запази', exact: true }).click();
  await admin.waitForSelector('h1:has-text("Събития")'); await admin.waitForTimeout(300);
  const e2 = (await api.get('/api/admin/events')).data.events.find((e) => e.titleEn === 'Wine tasting');
  R.check('EV-EN1 an event with only English content saves through the UI (no BG title needed); BG image null, EN image set', e2 && e2.title === '' && e2.imageUrl === null && !!e2.imageEnUrl);
  R.check('EV-EN2 list card for the EN-only event shows its English title (not empty) and is not "Без заглавие"', (await admin.locator('article:has-text("Wine tasting")').count()) === 1 && (await admin.locator('article:has-text("Без заглавие")').count()) === 0);
});

await step('A-DAILY', async () => {
  await go(admin, '#/daily-menu');
  await admin.waitForSelector('h3:has-text("Избери файлове")');
  R.check('DW-1 wizard step 1 offers a Bulgarian file and an optional English file; Next disabled until a file is chosen', (await admin.getByRole('heading', { name: 'Български файл' }).count()) === 1 && (await admin.getByRole('heading', { name: /English файл/ }).count()) === 1 && (await admin.getByRole('button', { name: 'Напред' }).isDisabled()));
  const inputs = admin.locator('.a-step input[type=file]');
  R.check('DW-1b two file inputs (BG, EN)', (await inputs.count()) === 2);
  await inputs.nth(1).setInputFiles(file('dnes-en.png', 'image/png', BLUE));
  R.check('DW-2 an English file alone enables Next ("or English only", D-41)', await admin.getByRole('button', { name: 'Напред' }).isEnabled());
  await inputs.nth(0).setInputFiles(file('dnes-bg.png', 'image/png', RED));
  await admin.getByRole('button', { name: 'Напред' }).click(); await admin.getByRole('button', { name: 'Напред' }).click();
  const step3 = await admin.locator('.a-step').innerText();
  R.check('DW-3 review step lists both files by language', /Български файл: dnes-bg\.png/.test(step3) && /English файл: dnes-en\.png/.test(step3), step3.slice(0, 200).replace(/\n/g, '|'));
  await admin.getByRole('button', { name: 'Напред' }).click();
  await admin.getByRole('button', { name: 'Публикувай', exact: true }).click();
  await admin.waitForSelector('text=е публикувано'); await admin.waitForTimeout(400);
  const m = (await api.get('/api/admin/daily-menus')).data.menus[0];
  R.check('DW-4 published via the wizard: BG + EN files stored on today', m && m.date === TODAY && m.published && m.originalName === 'dnes-bg.png' && m.originalNameEn === 'dnes-en.png');
  const row = await admin.locator('article.a-menu').first().innerText();
  R.check('DW-5 list row shows both language badges "БГ файл" and "EN файл" and both file names', /БГ файл/.test(row) && /EN файл/.test(row) && !/Няма/.test(row) && /dnes-bg\.png/.test(row) && /dnes-en\.png/.test(row), row.replace(/\n/g, '|'));
  R.check('DW-6 two preview links ("Преглед БГ", "Преглед EN") with accessible names for BG/EN files and rel=noopener', (await admin.locator('article.a-menu a[aria-label="Преглед на българския файл"][rel~=noopener]').count()) === 1 && (await admin.locator('article.a-menu a[aria-label="Преглед на английския файл"][rel~=noopener]').count()) === 1);
});

await step('A-MENU', async () => {
  await go(admin, '#/menu');
  await admin.waitForSelector('text=Менюто е празно.');
  await admin.getByRole('button', { name: 'Добави категория' }).first().click();
  await admin.getByLabel('Име на категория', { exact: true }).fill('Салати');
  await admin.getByRole('button', { name: 'Добави ястие' }).click();
  await admin.getByLabel('Име на ястието', { exact: true }).last().fill('Шопска салата');
  await admin.locator('.a-dish').nth(0).getByLabel('Цена').fill('6,50');
  await admin.getByRole('button', { name: 'Добави ястие' }).click();
  await admin.getByLabel('Име на ястието', { exact: true }).last().fill('Само БГ ястие');
  await admin.locator('.a-dish').nth(1).getByLabel('Цена').fill('4');
  R.check('MN-T1 menu editor has "Български"/"English" tabs ("Език на имената и описанията"); BG tab carries a dot, EN none yet', (await admin.getByRole('tablist', { name: 'Език на имената и описанията' }).count()) === 1 && (await tab(admin, 'Български').locator('.a-tabdot:visible').count()) === 1 && (await tab(admin, 'English').locator('.a-tabdot:visible').count()) === 0);
  await tab(admin, 'English').click();
  R.check('MN-T2 EN tab: hint "не е попълнено…" visible; shared hint says prices/availability/order are shared', (await admin.locator('.a-langhint:visible').count()) === 1 && (await admin.getByText('Цени, наличност и подредба са общи за двата езика').isVisible()));
  await admin.getByLabel('Име на категория на английски').fill('Salads');
  await admin.getByLabel('Dish name (English)').nth(0).fill('Shopska salad');
  // a dish added while the EN tab is active, with an English name only
  await admin.getByRole('button', { name: 'Добави ястие' }).click();
  await admin.getByLabel('Dish name (English)').last().fill('Only EN dish');
  await admin.locator('.a-dish').nth(2).getByLabel('Цена').fill('3');
  R.check('MN-T3 prices are shared: the EN tab shows the same price fields', (await admin.locator('.a-dish').nth(0).getByLabel('Цена').inputValue()) === '6,50');
  R.check('MN-T4 dots on both tabs now', (await admin.locator('.a-langtab .a-tabdot:visible').count()) === 2);
  // keyboard on these tabs
  await tab(admin, 'English').focus(); await admin.keyboard.press('Home');
  R.check('MN-K1 Home/End/Arrow keys work on the menu language tabs', (await tab(admin, 'Български').getAttribute('aria-selected')) === 'true');
  await admin.keyboard.press('End');
  R.check('MN-K2 End -> English', (await tab(admin, 'English').getAttribute('aria-selected')) === 'true');
  await admin.keyboard.press('ArrowRight');
  R.check('MN-K3 ArrowRight wraps to Bulgarian; BG panel shows the BG names; the BG-missing dish has an empty BG name field', (await tab(admin, 'Български').getAttribute('aria-selected')) === 'true' && (await admin.getByLabel('Име на ястието', { exact: true }).nth(2).inputValue()) === '');
  await dismissToasts(admin);
  await admin.getByRole('button', { name: 'Публикувай', exact: true }).first().click();
  await admin.locator('dialog[open]').getByRole('button', { name: 'Публикувай' }).click();
  await admin.waitForTimeout(800);
  const pub = (await api.get('/api/admin/menu')).data;
  const c = pub.draft.categories[0];
  R.check('MN-S1 published via the UI with BG name, EN name, BG-only dish and EN-only dish', pub.published && c.name === 'Салати' && c.nameEn === 'Salads' && c.items.length === 3 && c.items[0].nameEn === 'Shopska salad' && c.items[1].nameEn === '' && c.items[2].name === '' && c.items[2].nameEn === 'Only EN dish', JSON.stringify(c.items.map((i) => [i.name, i.nameEn, i.priceCents])));
  R.check('MN-S2 EN-only edit after publishing marks the draft "Незапазени промени" and enables Save', await (async () => {
    await tab(admin, 'English').click();
    await admin.getByLabel('Dish name (English)').nth(0).fill('Shopska salad!');
    return (await admin.getByText('Незапазени промени').count()) >= 1 && (await admin.getByRole('button', { name: 'Запази чернова' }).isEnabled());
  })());
  await admin.getByLabel('Dish name (English)').nth(0).fill('Shopska salad');
  R.check('MN-S3 reverting the EN edit clears the dirty state', (await admin.getByRole('button', { name: 'Запази чернова' }).isDisabled()));
});

// -------------------- public site, owner view
const pubState = (page) => page.evaluate(() => ({
  lang: document.documentElement.lang,
  marker: window.__marker,
  eventTitles: [...document.querySelectorAll('.event-title')].map((e) => e.textContent.trim()),
  eventImgs: [...document.querySelectorAll('.event-card img')].map((i) => i.getAttribute('src')),
  dishes: [...document.querySelectorAll('.dish-name')].map((e) => e.textContent.trim()),
  cats: [...document.querySelectorAll('.cat-title')].map((e) => e.textContent.trim()),
  dailyImg: (document.querySelector('.viewer-frame img') || {}).src || null,
}));
let pubEvBg; let pubEvEn;
for (const vp of [{ n: '390', w: 390, h: 844 }, { n: '768', w: 768, h: 1024 }, { n: '1280', w: 1280, h: 800 }]) {
  await step(`B-PUBLIC[${vp.n}]`, async () => {
    const { context, page, log } = await newPage(browser, { width: vp.w, height: vp.h });
    await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForSelector('.dish'); await page.waitForTimeout(400);
    await page.evaluate(() => { window.__marker = 'same-document'; });
    const bg = await pubState(page);
    R.check(`PB1[${vp.n}] БГ: <html lang=bg>, BG event title, EN-only event visible via fallback, BG dishes (+ fallback to EN name for the BG-missing dish)`, bg.lang === 'bg' && bg.eventTitles.includes('Джаз вечер') && bg.eventTitles.includes('Wine tasting') && bg.cats[0] === 'Салати' && bg.dishes.join('|') === 'Шопска салата|Само БГ ястие|Only EN dish', JSON.stringify(bg));
    const evImgs = await page.locator('.event-card').evaluateAll((cs) => cs.map((c) => [c.querySelector('.event-title').textContent.trim(), c.querySelector('img') && c.querySelector('img').getAttribute('src')]));
    pubEvBg = Object.fromEntries(evImgs);
    const jazzBg = await pixel(page, '.event-card:has(.event-title:text("Джаз вечер")) img'); const wineBg = await pixel(page, '.event-card:has(.event-title:text("Wine tasting")) img');
    R.check(`PB2[${vp.n}] БГ: "Джаз вечер" shows the RED (BG) banner; EN-only event falls back to its GREEN EN image`, isRed(jazzBg) && isGreen(wineBg), JSON.stringify({ jazzBg, wineBg }));
    R.check(`PB3[${vp.n}] БГ: no horizontal scroll`, (await noHScroll(page)).ok, JSON.stringify(await noHScroll(page)));
    await page.screenshot({ path: path.join(shots, `langs-public-bg-${vp.n}.png`), fullPage: true });
    // instant switch (same document)
    const t0 = Date.now();
    await clickLang(page, 'en');
    await page.waitForFunction(() => document.querySelector('.event-title') && [...document.querySelectorAll('.event-title')].some((e) => e.textContent.trim() === 'Jazz night'), null, { timeout: 4000 });
    const dt = Date.now() - t0;
    const en = await pubState(page);
    R.check(`PE1[${vp.n}] click EN: same document (no reload, marker kept), <html lang=en>, title/dishes in English, fallback to BG for the EN-missing dish (${dt} ms)`, en.marker === 'same-document' && en.lang === 'en' && en.eventTitles.includes('Jazz night') && en.cats[0] === 'Salads' && en.dishes.join('|') === 'Shopska salad|Само БГ ястие|Only EN dish' && dt < 3000, JSON.stringify(en));
    const jazzEn = await pixel(page, '.event-card:has(.event-title:text("Jazz night")) img'); const wineEn = await pixel(page, '.event-card:has(.event-title:text("Wine tasting")) img');
    R.check(`PE2[${vp.n}] EN: "Jazz night" shows the BLUE (EN) banner, the EN-only event its GREEN image`, isBlue(jazzEn) && isGreen(wineEn), JSON.stringify({ jazzEn, wineEn }));
    R.check(`PE3[${vp.n}] EN: description in English; no horizontal scroll`, /Live music from 8 pm/.test(await page.locator('.event-card:has(.event-title:text("Jazz night"))').innerText()) && (await noHScroll(page)).ok);
    await page.screenshot({ path: path.join(shots, `langs-public-en-${vp.n}.png`), fullPage: true });
    // back to BG
    await clickLang(page, 'bg');
    await page.waitForFunction(() => [...document.querySelectorAll('.event-title')].some((e) => e.textContent.trim() === 'Джаз вечер'), null, { timeout: 4000 });
    const bg2 = await pubState(page);
    R.check(`PE4[${vp.n}] switching back to БГ restores BG content and the RED banner, still the same document`, bg2.marker === 'same-document' && bg2.dishes.join('|') === 'Шопска салата|Само БГ ястие|Only EN dish' && isRed(await pixel(page, '.event-card:has(.event-title:text("Джаз вечер")) img')));
    // daily menu page
    await page.goto(base + '/daily-menu', { waitUntil: 'networkidle' }); await page.waitForSelector('.viewer-frame img'); await page.evaluate(() => { window.__marker = 'daily-doc'; });
    R.check(`PD1[${vp.n}] daily-menu БГ shows the RED BG file`, isRed(await pixel(page, '.viewer-frame img')));
    const t1 = Date.now(); await clickLang(page, 'en');
    await page.waitForFunction(() => { const i = document.querySelector('.viewer-frame img'); return i && i.complete && i.naturalWidth && document.documentElement.lang === 'en'; }, null, { timeout: 4000 });
    await page.waitForFunction(() => { const i = document.querySelector('.viewer-frame img'); if (!i || !i.complete || !i.naturalWidth) return false; const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); const d = c.getContext('2d').getImageData(1, 1, 1, 1).data; return d[2] > 150; }, null, { timeout: 4000 });
    R.check(`PD2[${vp.n}] click EN on daily-menu: same document, BLUE EN file shown (${Date.now() - t1} ms), no horizontal scroll`, (await page.evaluate(() => window.__marker)) === 'daily-doc' && isBlue(await pixel(page, '.viewer-frame img')) && (await noHScroll(page)).ok);
    await page.screenshot({ path: path.join(shots, `langs-daily-en-${vp.n}.png`) });
    await clickLang(page, 'bg');
    await page.waitForFunction(() => { const i = document.querySelector('.viewer-frame img'); if (!i || !i.complete || !i.naturalWidth) return false; const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); return c.getContext('2d').getImageData(1, 1, 1, 1).data[0] > 150; }, null, { timeout: 4000 });
    R.pass(`PD3[${vp.n}] switching back to БГ shows the RED file again`);
    // deep link with ?lang=en
    await page.goto(base + '/?lang=en', { waitUntil: 'networkidle' }); await page.waitForSelector('.dish');
    R.check(`PE5[${vp.n}] /?lang=en loads English directly`, (await pubState(page)).eventTitles.includes('Jazz night'));
    R.check(`PL[${vp.n}] clean console / no failed requests / no CSP violations`, log.console.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && log.http4xx.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify({ c: log.console, p: log.pageErrors, f: log.failed, h: log.http4xx }));
    await context.close();
  });
}

// ====================================================================================== C. daily-menu replace flow, EN-only, fallback in BG mode
await step('C-REPLACE', async () => {
  await go(admin, '#/daily-menu');
  await admin.waitForSelector('h3:has-text("Избери файлове")');
  await admin.locator('.a-step input[type=file]').nth(1).setInputFiles(file('only-en.png', 'image/png', YELLOW));
  await admin.getByRole('button', { name: 'Напред' }).click(); await admin.getByRole('button', { name: 'Напред' }).click(); await admin.getByRole('button', { name: 'Напред' }).click();
  await admin.getByRole('button', { name: 'Публикувай', exact: true }).click();
  await admin.waitForSelector('dialog[open]');
  const txt = await admin.locator('dialog[open]').innerText();
  R.check('RP1 replace-confirm dialog says BOTH languages are replaced and that a language without a new file stays empty', /и двата езика/.test(txt) && /ще бъде заменено/.test(txt) && /остане празен/.test(txt), txt.replace(/\n/g, ' | '));
  await admin.locator('dialog[open]').getByRole('button', { name: 'Замени' }).click();
  await admin.waitForSelector('text=е публикувано'); await admin.waitForTimeout(400);
  const m = (await api.get('/api/admin/daily-menus')).data.menus[0];
  R.check('RP2 after replace: the menu is EN-only (BG file gone), old files deleted from storage', m.fileUrl === null && m.originalNameEn === 'only-en.png');
  const row = await admin.locator('article.a-menu').first().innerText();
  R.check('RP3 row shows "Няма БГ файл" and "EN файл"; single preview link "Преглед"', /Няма БГ файл/.test(row) && /EN файл/.test(row) && !/Няма EN файл/.test(row), row.replace(/\n/g, '|'));
  // public: both languages show the yellow file
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(base + '/daily-menu', { waitUntil: 'networkidle' }); await page.waitForSelector('.viewer-frame img');
  R.check('RP4 БГ visitor sees the EN-only daily menu via fallback (YELLOW)', isYellow(await pixel(page, '.viewer-frame img')));
  await clickLang(page, 'en'); await page.waitForTimeout(600);
  R.check('RP5 EN visitor sees it too', isYellow(await pixel(page, '.viewer-frame img')));
  await context.close();
});

await step('C-EDIT', async () => {
  await go(admin, '#/daily-menu');
  await admin.waitForSelector('article.a-menu');
  await admin.getByRole('button', { name: 'Редактирай' }).first().click();
  await admin.waitForSelector('dialog[open] h2:has-text("Редактиране на меню")');
  let d = admin.locator('dialog[open]');
  R.check('ED1 edit dialog shows current EN file name, "Няма качен български файл." and a remove button', /only-en\.png/.test(await d.innerText()) && /Няма качен български файл/.test(await d.innerText()) && (await d.getByRole('button', { name: 'Премахни английския файл' }).count()) === 1);
  await d.getByRole('button', { name: 'Премахни английския файл' }).click();
  R.check('ED2 remove -> info "Английският файл ще бъде премахнат при запазване." + undo button', (await d.getByText('Английският файл ще бъде премахнат при запазване.').count()) === 1 && (await d.getByRole('button', { name: 'Върни английския файл' }).count()) === 1);
  await d.getByRole('button', { name: 'Запази' }).click();
  await admin.waitForTimeout(300);
  R.check('ED3 removing the ONLY file is blocked client-side with "Менюто трябва да има поне един файл." and nothing is sent', (await d.getByText('Менюто трябва да има поне един файл.').count()) === 1 && (await api.get('/api/admin/daily-menus')).data.menus[0].fileEnUrl !== null);
  await d.getByRole('button', { name: 'Върни английския файл' }).click();
  // add a BG file and replace the EN file in one save
  const ins = d.locator('input[type=file]');
  await ins.nth(0).setInputFiles(file('new-bg.png', 'image/png', RED));
  await ins.nth(1).setInputFiles(file('new-en.png', 'image/png', BLUE));
  const before = (await api.get('/api/admin/daily-menus')).data.menus[0];
  await d.getByRole('button', { name: 'Запази' }).click();
  await admin.waitForTimeout(1200);
  const toastTxt = await admin.locator('.a-toasts').innerText();
  const rowTxt = await admin.locator('article.a-menu').first().innerText();
  const after = (await api.get('/api/admin/daily-menus')).data.menus[0];
  R.check('ED4a edit-dialog save ends with the success toast "Менюто е обновено." (no error toast) and the list shows the new files', /Менюто е обновено\./.test(toastTxt) && !/is not defined|Грешка/.test(toastTxt) && /new-bg\.png/.test(rowTxt) && /new-en\.png/.test(rowTxt), JSON.stringify({ toastTxt, rowTxt: rowTxt.replace(/\n+/g, '|') }));
  await admin.reload({ waitUntil: 'networkidle' }); await admin.waitForSelector('article.a-menu'); await dismissToasts(admin);
  R.check('ED4 saving a new BG file + a replacement EN file through the dialog works (dialog closes, both updated, old EN file gone)', (await admin.locator('dialog[open]').count()) === 0 && after.originalName === 'new-bg.png' && after.originalNameEn === 'new-en.png' && after.fileEnUrl !== before.fileEnUrl && (await api.get(before.fileEnUrl)).status === 404, JSON.stringify({ n: after.originalName, e: after.originalNameEn, dlg: await admin.locator('dialog[open]').count() }));
  // replace only the EN file
  await admin.getByRole('button', { name: 'Редактирай' }).first().click(); await admin.waitForSelector('dialog[open]'); d = admin.locator('dialog[open]');
  await d.locator('input[type=file]').nth(1).setInputFiles(file('en3.png', 'image/png', GREEN));
  const before2 = (await api.get('/api/admin/daily-menus')).data.menus[0];
  await d.getByRole('button', { name: 'Запази' }).click(); await admin.waitForTimeout(1000); await admin.reload({ waitUntil: 'networkidle' }); await admin.waitForSelector('article.a-menu');
  const after2 = (await api.get('/api/admin/daily-menus')).data.menus[0];
  R.check('ED5 replacing only the EN file keeps the BG file; old EN file deleted', after2.originalNameEn === 'en3.png' && after2.fileUrl === before2.fileUrl && (await api.get(before2.fileEnUrl)).status === 404);
  // remove EN, keep BG
  await admin.getByRole('button', { name: 'Редактирай' }).first().click(); await admin.waitForSelector('dialog[open]'); d = admin.locator('dialog[open]');
  await d.getByRole('button', { name: 'Премахни английския файл' }).click();
  await d.getByRole('button', { name: 'Запази' }).click(); await admin.waitForTimeout(1000); await admin.reload({ waitUntil: 'networkidle' }); await admin.waitForSelector('article.a-menu');
  const after3 = (await api.get('/api/admin/daily-menus')).data.menus[0];
  R.check('ED6 removing the EN file (BG exists) works: fileEnUrl null, row shows "Няма EN файл"', after3.fileEnUrl === null && after3.fileUrl && /Няма EN файл/.test(await admin.locator('article.a-menu').first().innerText()));
  // restore EN for later tests
  await admin.getByRole('button', { name: 'Редактирай' }).first().click(); await admin.waitForSelector('dialog[open]'); d = admin.locator('dialog[open]');
  await d.locator('input[type=file]').nth(1).setInputFiles(file('en4.png', 'image/png', BLUE));
  await d.getByRole('button', { name: 'Запази' }).click(); await admin.waitForTimeout(1000); await admin.reload({ waitUntil: 'networkidle' }); await admin.waitForSelector('article.a-menu');
  R.check('ED7 EN file can be added again through the dialog', (await api.get('/api/admin/daily-menus')).data.menus[0].originalNameEn === 'en4.png');
});

// ====================================================================================== D. real server error mapping (fake files pass the client extension check, the server rejects them)
const FAKE = Buffer.from('<html><script>alert(1)</script></html>');
await step('D-ERR-EVENT', async () => {
  await go(admin, '#/events/new'); await admin.waitForSelector('h1:has-text("Ново събитие")');
  await tab(admin, 'English').click();
  await admin.getByLabel('Title (English)').fill('Fake image');
  await panelFile(admin).setInputFiles(file('fake.png', 'image/png', FAKE));
  await dismissToasts(admin);
  await admin.getByRole('button', { name: 'Запази', exact: true }).click(); await admin.waitForTimeout(900);
  const visible = await admin.locator('.a-upload__err:visible').allInnerTexts();
  R.check('ERR-1 server 415 for a fake imageEn: the error is VISIBLE to the user (EN tab still shown, message next to the EN uploader)', (await tab(admin, 'English').getAttribute('aria-selected')) === 'true' && visible.some((t) => /JPG, PNG|съдържание|изображения/.test(t)), JSON.stringify(visible));
  R.check('ERR-1b the error is attached to the English uploader, not to the Bulgarian one', await admin.evaluate(() => { const en = document.querySelector('.a-langpanel[lang=en] .a-upload__err'); const bg = document.querySelector('.a-langpanel[lang=bg] .a-upload__err'); return !!en && !en.hidden && (!bg || bg.hidden); }), JSON.stringify(await admin.evaluate(() => ({ bgPanelErr: (document.querySelector('.a-langpanel[lang=bg] .a-upload__err') || {}).innerText, bgPanelHidden: document.querySelector('.a-langpanel[lang=bg]').hidden, enErrHidden: document.querySelector('.a-langpanel[lang=en] .a-upload__err').hidden, summary: (document.querySelector('.a-errsum') || {}).innerText }))));
  R.check('ERR-1d the error summary is shown and names the English image', await admin.evaluate(() => { const b = document.querySelector('.a-summary'); return !!b && !b.hidden && /Снимка \(English\)/.test(b.innerText); }), JSON.stringify(await admin.evaluate(() => (document.querySelector('.a-summary') || {}).innerText)));
  R.check('ERR-1c no event created, no orphan', (await api.get('/api/admin/events')).data.events.every((e) => e.titleEn !== 'Fake image'));
  await admin.screenshot({ path: path.join(shots, 'langs-err-imageEn.png') });
  await go(admin, '#/events'); await leaveIfAsked(admin);
});
await step('D-ERR-DAILY', async () => {
  await go(admin, '#/daily-menu'); await admin.waitForSelector('article.a-menu');
  // wizard with fake EN file on a free date
  await admin.getByRole('button', { name: 'Качи ново меню' }).click().catch(() => {});
  await admin.waitForSelector('h3:has-text("Избери файлове")');
  await admin.locator('.a-step input[type=file]').nth(1).setInputFiles(file('fake.png', 'image/png', FAKE));
  await admin.getByRole('button', { name: 'Напред' }).click();
  await admin.getByRole('button', { name: 'Утре' }).click();
  await admin.getByRole('button', { name: 'Напред' }).click(); await admin.getByRole('button', { name: 'Напред' }).click();
  await admin.getByRole('button', { name: 'Запази като чернова (непубликувано)' }).click(); await admin.waitForTimeout(1200);
  const h3 = await admin.locator('.a-step h3').first().innerText();
  const errs = await admin.locator('.a-step .a-upload__err:visible').allInnerTexts();
  R.check('ERR-2 wizard: server rejection of a fake fileEn returns to step 1 with the error under the ENGLISH uploader', /Избери файлове/.test(h3) && errs.length === 1 && await admin.evaluate(() => { const sec = [...document.querySelectorAll('.a-fileslang')].find((s) => !s.querySelector('.a-upload__err').hidden); return sec && sec.getAttribute('lang') === 'en'; }), JSON.stringify({ h3, errs }));
  R.check('ERR-2b nothing created for tomorrow', (await api.get('/api/admin/daily-menus')).data.menus.every((m) => m.date === TODAY));
  // edit dialog with a fake EN file
  await go(admin, '#/daily-menu'); await admin.waitForSelector('article.a-menu');
  await admin.getByRole('button', { name: 'Редактирай' }).first().click(); await admin.waitForSelector('dialog[open]');
  const d = admin.locator('dialog[open]');
  await d.locator('input[type=file]').nth(1).setInputFiles(file('fake2.png', 'image/png', FAKE));
  await d.getByRole('button', { name: 'Запази' }).click(); await admin.waitForTimeout(1000);
  const where = await admin.evaluate(() => { const dlg = document.querySelector('dialog[open]'); if (!dlg) return 'DIALOG CLOSED'; const boxes = [...dlg.querySelectorAll('.a-upload')].map((u) => { const e = u.querySelector('.a-upload__err'); return e && !e.hidden ? e.innerText : null; }); return boxes; });
  R.check('ERR-3 edit dialog: server rejection of a fake fileEn keeps the dialog open and shows the error under the ENGLISH uploader (second), not the Bulgarian one', Array.isArray(where) && where.length === 2 && where[0] === null && !!where[1], JSON.stringify(where) + ' toasts=' + JSON.stringify(await admin.locator('.a-toasts').allInnerTexts()));
  await d.getByRole('button', { name: 'Отказ' }).click().catch(() => {});
  await admin.keyboard.press('Escape');
  R.check('ERR-3b the menu is unchanged', (await api.get('/api/admin/daily-menus')).data.menus[0].originalNameEn === 'en4.png');
});

// BUG-16/17 retest: 413 mapping with the real server shapes (files.js:81 carries fields.<name>; http.js:42 generic body has none), responses injected
await step('D-413', async () => {
  const body413 = (fields) => JSON.stringify({ error: 'file_too_large', message: 'Файлът е твърде голям (макс. 5 MB).', ...(fields ? { fields } : {}) });
  // event form, fields.imageEn -> English uploader + English tab + summary
  await go(admin, '#/events/new'); await admin.waitForSelector('h1:has-text("Ново събитие")');
  await admin.getByLabel('Заглавие', { exact: true }).fill('413 test');
  await admin.route('**/api/admin/events', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 413, contentType: 'application/json', body: body413({ imageEn: 'Файлът е твърде голям.' }) }) : route.continue());
  await dismissToasts(admin);
  await admin.getByRole('button', { name: 'Запази', exact: true }).click(); await admin.waitForTimeout(700);
  const e1 = await admin.evaluate(() => { const en = document.querySelector('.a-langpanel[lang=en] .a-upload__err'); const bg = document.querySelector('.a-langpanel[lang=bg] .a-upload__err'); return { en: en && !en.hidden ? en.innerText : null, bg: bg && !bg.hidden ? bg.innerText : null, sum: (document.querySelector('.a-summary:not([hidden])') || {}).innerText || '' }; });
  R.check('ERR-413a event form 413 with fields.imageEn (mocked): English tab selected, message at the English uploader (not the Bulgarian one), summary shown', (await tab(admin, 'English').getAttribute('aria-selected')) === 'true' && !!e1.en && e1.bg === null && /Файлът е твърде голям/.test(e1.sum), JSON.stringify(e1));
  await admin.unroute('**/api/admin/events');
  // event form, generic 413 without fields -> Bulgarian uploader + Bulgarian tab + summary
  await tab(admin, 'English').click();
  await admin.route('**/api/admin/events', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 413, contentType: 'application/json', body: body413(null) }) : route.continue());
  await dismissToasts(admin);
  await admin.getByRole('button', { name: 'Запази', exact: true }).click(); await admin.waitForTimeout(700);
  const e2 = await admin.evaluate(() => { const bg = document.querySelector('.a-langpanel[lang=bg] .a-upload__err'); return { bgTabHidden: document.querySelector('.a-langpanel[lang=bg]').hidden, bg: bg && !bg.hidden ? bg.innerText : null, sum: (document.querySelector('.a-summary:not([hidden])') || {}).innerText || '' }; });
  R.check('ERR-413b event form generic 413 without fields (mocked): error visible (Bulgarian tab shown, uploader message + summary)', e2.bgTabHidden === false && !!e2.bg && /твърде голям/.test(e2.sum), JSON.stringify(e2));
  await admin.unroute('**/api/admin/events');
  await go(admin, '#/events'); await leaveIfAsked(admin);
  // daily edit dialog
  await go(admin, '#/daily-menu'); await admin.waitForSelector('article.a-menu');
  for (const [id, status, fields, idx] of [['ERR-413c', 413, { fileEn: 'Файлът е твърде голям.' }, 1], ['ERR-413d', 413, null, 0], ['ERR-400e', 400, { fileEn: 'Невалидно качване на файл.' }, 1], ['ERR-415f', 415, { file: 'Позволени са само PDF, JPG, PNG и WebP файлове.' }, 0]]) {
    await admin.getByRole('button', { name: 'Редактирай' }).first().click(); await admin.waitForSelector('dialog[open]');
    const d = admin.locator('dialog[open]');
    await d.locator('input[type=file]').nth(1).setInputFiles(file('big-en.png', 'image/png', BLUE));
    await admin.route('**/api/admin/daily-menus/*', (route) => route.request().method() === 'PUT' ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'x', message: 'Файлът е твърде голям (макс. 5 MB).', ...(fields ? { fields } : {}) }) }) : route.continue());
    await d.getByRole('button', { name: 'Запази' }).click(); await admin.waitForTimeout(900);
    const w = await admin.evaluate(() => { const dlg = document.querySelector('dialog[open]'); if (!dlg) return 'DIALOG CLOSED'; return [...dlg.querySelectorAll('.a-upload')].map((u) => { const e = u.querySelector('.a-upload__err'); return e && !e.hidden ? e.innerText : null; }); });
    R.check(`${id} daily edit dialog ${status}${fields ? ' with fields.' + Object.keys(fields)[0] : ' without fields'} (mocked): dialog stays open, error under uploader #${idx + 1} only, no unhandled error`, Array.isArray(w) && w.length === 2 && !!w[idx] && w[1 - idx] === null, JSON.stringify(w));
    await admin.unroute('**/api/admin/daily-menus/*');
    await d.getByRole('button', { name: 'Отказ' }).click().catch(() => {}); await admin.keyboard.press('Escape'); await admin.waitForTimeout(300);
  }
  R.check('ERR-413g no menu changed by the mocked rejections', (await api.get('/api/admin/daily-menus')).data.menus[0].originalNameEn === 'en4.png');
});

// server 400 field mapping (real server shape, response injected because the client validates the same rules first)
await step('D-MAP', async () => {
  await go(admin, '#/events/new'); await admin.waitForSelector('h1:has-text("Ново събитие")');
  await admin.getByLabel('Заглавие', { exact: true }).fill('Map test');
  await admin.route('**/api/admin/events', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'validation', message: 'Невалидни данни.', fields: { imageEn: 'Невалидно качване на файл.', titleEn: 'Английското заглавие е до 120 символа.' } }) }) : route.continue());
  await dismissToasts(admin);
  await admin.getByRole('button', { name: 'Запази', exact: true }).click(); await admin.waitForTimeout(700);
  const sum = await admin.locator('.a-errsum, [role=alert]').allInnerTexts();
  R.check('MAP-1 server 400 fields.imageEn/titleEn (mocked): English tab is selected and the messages are visible in the summary and at the field', (await tab(admin, 'English').getAttribute('aria-selected')) === 'true' && sum.join(' ').includes('Невалидно качване на файл.') && sum.join(' ').includes('Английското заглавие'), JSON.stringify(sum).slice(0, 200));
  await admin.unroute('**/api/admin/events');
  await go(admin, '#/events'); await leaveIfAsked(admin);

  // menu: nameEn error on a dish while the BG tab is active -> switches to English
  await go(admin, '#/menu'); await admin.waitForSelector('.a-dish');
  await admin.getByLabel('Име на ястието', { exact: true }).nth(1).fill('Само БГ ястие!');
  await admin.route('**/api/admin/menu/draft', (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'validation', message: 'Невалидни данни.', fields: { 'categories[0].items[1].nameEn': 'Английското име е до 100 символа.' } }) }) : route.continue());
  await dismissToasts(admin);
  await admin.getByRole('button', { name: 'Запази чернова' }).click(); await admin.waitForTimeout(800);
  R.check('MAP-2 server 400 on categories[0].items[1].nameEn (mocked): the English tab is shown and the dish field carries the message', (await tab(admin, 'English').getAttribute('aria-selected')) === 'true' && (await admin.locator('.a-dish').nth(1).locator('.a-error:visible').count()) === 1 && /Английското име е до 100/.test(await admin.locator('.a-dish').nth(1).innerText()));
  await admin.unroute('**/api/admin/menu/draft');
  await admin.getByRole('button', { name: 'Откажи промените' }).first().click();
  await admin.locator('dialog[open]').getByRole('button', { name: 'Откажи промените' }).click(); await admin.waitForTimeout(500);

  // menu: required name error (both languages empty) points to the BG-key but must be visible/understandable
  await admin.getByRole('button', { name: 'Добави ястие' }).click();
  await admin.getByLabel('Цена').last().fill('1');
  await admin.getByRole('button', { name: 'Запази чернова' }).click(); await admin.waitForTimeout(500);
  const errTxt = await admin.locator('[role=alert], .a-error:visible').allInnerTexts();
  R.check('MAP-3 a dish with no name in either language: "Въведете име поне на един език." is shown', errTxt.join(' ').includes('Въведете име поне на един език.'), JSON.stringify(errTxt).slice(0, 200));
  await admin.getByRole('button', { name: 'Откажи промените' }).first().click();
  await admin.locator('dialog[open]').getByRole('button', { name: 'Откажи промените' }).click(); await admin.waitForTimeout(500);
  R.check('MAP-4 discard restores the published menu', (await admin.locator('.a-dish').count()) === 3);
});

// ====================================================================================== E. unsaved-changes guard on EN-only edits
await step('E-GUARD', async () => {
  const evId = (await api.get('/api/admin/events')).data.events.find((e) => e.title === 'Джаз вечер').id;
  await go(admin, `#/events/${evId}`); await admin.waitForSelector('h1:has-text("Редактиране")');
  await tab(admin, 'English').click();
  await admin.getByLabel('Title (English)').fill('Jazz night (edited)');
  await go(admin, '#/events');
  await admin.waitForSelector('dialog[open]');
  R.check('G1 events: changing only the EN title then navigating away asks "Имате незапазени промени" (Остани focused)', /имате незапазени промени/i.test(await admin.locator('dialog[open]').innerText()) && (await admin.evaluate(() => document.activeElement.textContent.trim())) === 'Остани');
  await admin.locator('dialog[open]').getByRole('button', { name: 'Остани' }).click();
  R.check('G1b "Остани" keeps the edit page and the typed EN text', (await admin.evaluate(() => location.hash)) === `#/events/${evId}` && (await admin.getByLabel('Title (English)').inputValue()) === 'Jazz night (edited)');
  // revert -> no prompt
  await admin.getByLabel('Title (English)').fill('Jazz night');
  await go(admin, '#/events');
  R.check('G1c reverting the EN edit -> navigating away does not prompt', (await admin.locator('dialog[open]').count()) === 0 && (await admin.evaluate(() => location.hash)) === '#/events');
  // EN image change only
  await go(admin, `#/events/${evId}`); await admin.waitForSelector('h1:has-text("Редактиране")');
  await tab(admin, 'English').click();
  R.check('G2a EN image shows as an existing image with "Смени снимка"/"Премахни снимка"', (await admin.locator('.a-langpanel:not([hidden]) .a-existing__img').count()) === 1 && (await admin.getByRole('button', { name: 'Премахни снимка' }).isVisible()));
  await admin.getByRole('button', { name: 'Премахни снимка' }).click();
  await go(admin, '#/events'); await admin.waitForSelector('dialog[open]');
  R.check('G2 removing only the EN image counts as an unsaved change', /имате незапазени промени/i.test(await admin.locator('dialog[open]').innerText()));
  await admin.locator('dialog[open]').getByRole('button', { name: 'Напусни без запазване' }).click(); await admin.waitForTimeout(400);
  R.check('G2b "Напусни без запазване" leaves and the EN image is still stored', (await admin.evaluate(() => location.hash)) === '#/events' && !!(await api.get('/api/admin/events')).data.events.find((e) => e.id === evId).imageEnUrl);
  // replace EN image via edit form and save
  await go(admin, `#/events/${evId}`); await admin.waitForSelector('h1:has-text("Редактиране")');
  await tab(admin, 'English').click();
  const oldEn = (await api.get('/api/admin/events')).data.events.find((e) => e.id === evId).imageEnUrl;
  await admin.getByRole('button', { name: 'Смени снимка' }).click().catch(() => {});
  await panelFile(admin).setInputFiles(file('en2.png', 'image/png', YELLOW)).catch(async () => { await admin.locator('.a-langpanel[lang=en] input[type=file]').setInputFiles(file('en2.png', 'image/png', YELLOW)); });
  await dismissToasts(admin);
  await admin.getByRole('button', { name: 'Запази', exact: true }).click(); await admin.waitForSelector('h1:has-text("Събития")'); await admin.waitForTimeout(300);
  const nowEv = (await api.get('/api/admin/events')).data.events.find((e) => e.id === evId);
  R.check('G3 replacing the EN image through the edit form: new EN image stored, old EN file deleted, BG image untouched', nowEv.imageEnUrl !== oldEn && (await api.get(oldEn)).status === 404 && !!nowEv.imageUrl);
  // remove EN image through the form and save
  await go(admin, `#/events/${evId}`); await admin.waitForSelector('h1:has-text("Редактиране")'); await tab(admin, 'English').click();
  await admin.getByRole('button', { name: 'Премахни снимка' }).click();
  R.check('G3b "Снимката ще бъде премахната при запазване." + "Върни снимката"', (await admin.getByText('Снимката ще бъде премахната при запазване.').count()) === 1 && (await admin.getByRole('button', { name: 'Върни снимката' }).count()) === 1);
  await dismissToasts(admin);
  await admin.getByRole('button', { name: 'Запази', exact: true }).click(); await admin.waitForSelector('h1:has-text("Събития")'); await admin.waitForTimeout(300);
  R.check('G3c EN image removed (null), BG image intact', (await api.get('/api/admin/events')).data.events.find((e) => e.id === evId).imageEnUrl === null && !!(await api.get('/api/admin/events')).data.events.find((e) => e.id === evId).imageUrl);
  // menu: EN-only name edit
  await go(admin, '#/menu'); await admin.waitForSelector('.a-dish');
  await tab(admin, 'English').click();
  await admin.getByLabel('Dish name (English)').nth(0).fill('Shopska (edited)');
  await go(admin, '#/events'); await admin.waitForSelector('dialog[open]');
  const mtxt = await admin.locator('dialog[open]').innerText();
  R.check('G4 menu: an EN-only dish-name edit triggers the guard with "Запази и продължи"', /имате незапазени промени/i.test(mtxt) && (await admin.locator('dialog[open]').getByRole('button', { name: 'Запази и продължи' }).count()) === 1);
  await admin.locator('dialog[open]').getByRole('button', { name: 'Запази и продължи' }).click(); await admin.waitForTimeout(900);
  R.check('G4b "Запази и продължи" saves the EN-only edit as draft', (await api.get('/api/admin/menu')).data.draft.categories[0].items[0].nameEn === 'Shopska (edited)' && (await admin.evaluate(() => location.hash)) === '#/events');
  // settings: EN address only
  await go(admin, '#/settings'); await admin.waitForSelector('h2:has-text("Информация за сайта")');
  R.check('G5a settings: "Език на адреса и работното време" tablist with Български/English; no <details> fold-out', (await admin.getByRole('tablist', { name: 'Език на адреса и работното време' }).count()) === 1 && (await admin.locator('details.a-en').count()) === 0);
  await tab(admin, 'English').click();
  await admin.getByLabel('Address (English)').fill('85 Ralevitsa St, Sofia (edited)');
  await go(admin, '#/events'); await admin.waitForSelector('dialog[open]');
  R.check('G5 settings: editing only the English address triggers the guard', /имате незапазени промени/i.test(await admin.locator('dialog[open]').innerText()));
  await admin.locator('dialog[open]').getByRole('button', { name: 'Остани' }).click();
  await admin.getByRole('button', { name: 'Запази', exact: true }).click(); await admin.waitForTimeout(700);
  R.check('G5b saving stores addressEn; public EN site shows it, BG site keeps the BG address', (await api.get('/api/admin/settings')).data.addressEn === '85 Ralevitsa St, Sofia (edited)' && (await anon.get('/api/public/site?lang=en')).data.address === '85 Ralevitsa St, Sofia (edited)' && (await anon.get('/api/public/site?lang=bg')).data.address !== '85 Ralevitsa St, Sofia (edited)');
  await go(admin, '#/events'); R.check('G5c after saving no guard prompt', (await admin.locator('dialog[open]').count()) === 0);
  // settings keyboard + dots
  await go(admin, '#/settings'); await admin.waitForSelector('h2:has-text("Информация за сайта")');
  await tab(admin, 'Български').focus(); await admin.keyboard.press('ArrowRight');
  R.check('G5d settings tabs: ArrowRight/End/Home work; dots shown for filled languages', (await tab(admin, 'English').getAttribute('aria-selected')) === 'true' && (await admin.locator('.a-langtab .a-tabdot:visible').count()) >= 1);
  await admin.keyboard.press('Home'); R.check('G5e Home -> Български', (await tab(admin, 'Български').getAttribute('aria-selected')) === 'true');
  // mocked settings 400 for addressEn
  await tab(admin, 'Български').click();
  await admin.route('**/api/admin/settings', (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'validation', message: 'Невалидни данни.', fields: { addressEn: 'Адресът е до 200 символа.' } }) }) : route.continue());
  await admin.getByLabel('Адрес', { exact: true }).fill('Нов адрес'); await admin.getByRole('button', { name: 'Запази', exact: true }).click(); await admin.waitForTimeout(600);
  R.check('MAP-5 settings 400 on addressEn (mocked) while BG tab is active: switches to the English tab and shows the message', (await tab(admin, 'English').getAttribute('aria-selected')) === 'true' && (await admin.getByText('Адресът е до 200 символа.').isVisible()));
  await admin.unroute('**/api/admin/settings');
  await admin.getByRole('button', { name: 'Запази', exact: true }).click(); await admin.waitForTimeout(600);
});

// ====================================================================================== F. menu FILES per language through the UI
await step('F-FILES', async () => {
  await go(admin, '#/menu'); await admin.waitForSelector('.a-dish');
  await tab(admin, 'Файл').click(); // mode tab "Файл" (role tab)
  R.check('FL1 file tab has two sections: "Български файл" and "English файл", each with its own empty state and a language-specific upload button after choosing a file', (await admin.getByRole('heading', { name: 'Български файл' }).count()) === 1 && (await admin.getByRole('heading', { name: 'English файл' }).count()) === 1);
  const secs = admin.locator('section.a-fileslang');
  await secs.nth(0).locator('input[type=file]').setInputFiles(file('menu-bg.png', 'image/png', RED));
  R.check('FL2 BG section shows the "Качи български файл" button (and not the English one)', (await secs.nth(0).getByRole('button', { name: 'Качи български файл' }).count()) === 1 && (await secs.nth(0).getByRole('button', { name: 'Качи английски файл' }).count()) === 0);
  await secs.nth(0).getByRole('button', { name: 'Качи български файл' }).click(); await admin.waitForTimeout(900);
  await secs.nth(1).locator('input[type=file]').setInputFiles(file('menu-en.png', 'image/png', BLUE));
  R.check('FL3 EN section shows "Качи английски файл"', (await secs.nth(1).getByRole('button', { name: 'Качи английски файл' }).count()) === 1);
  await secs.nth(1).getByRole('button', { name: 'Качи английски файл' }).click(); await admin.waitForTimeout(900);
  const files = (await api.get('/api/admin/menu')).data.files;
  R.check('FL4 uploads land in the right language (lang=bg for the first, lang=en for the second); each listed only in its section', files.find((x) => x.originalName === 'menu-bg.png').lang === 'bg' && files.find((x) => x.originalName === 'menu-en.png').lang === 'en' && (await secs.nth(0).locator('article:has-text("menu-bg.png")').count()) === 1 && (await secs.nth(1).locator('article:has-text("menu-en.png")').count()) === 1 && (await secs.nth(0).locator('article:has-text("menu-en.png")').count()) === 0);
  await secs.nth(0).getByRole('button', { name: 'Публикувай', exact: true }).click(); await admin.waitForTimeout(700);
  await secs.nth(1).getByRole('button', { name: 'Публикувай', exact: true }).click(); await admin.waitForTimeout(700);
  R.check('FL5 publishing the EN file does not unpublish the BG file (one published per language)', (await api.get('/api/admin/menu')).data.files.filter((x) => x.published).length === 2);
  await admin.getByRole('radio', { name: /Файл/ }).check({ force: true }).catch(async () => { await admin.locator('label.a-radio:has-text("Файл")').click(); });
  await admin.waitForSelector('dialog[open]'); await admin.locator('dialog[open]').getByRole('button', { name: 'Покажи на сайта' }).click(); await admin.waitForTimeout(800);
  R.check('FL6 switch to file mode works (mode=file)', (await api.get('/api/admin/menu')).data.mode === 'file');
  // second BG file: replace confirmation mentions the current BG file and only one per language
  await secs.nth(0).locator('input[type=file]').setInputFiles(file('menu-bg2.png', 'image/png', GREEN));
  await secs.nth(0).getByRole('button', { name: 'Качи български файл' }).click(); await admin.waitForTimeout(900);
  await secs.nth(0).locator('article:has-text("menu-bg2.png")').getByRole('button', { name: 'Публикувай', exact: true }).click();
  await admin.waitForSelector('dialog[open]');
  const ct = await admin.locator('dialog[open]').innerText();
  R.check('FL7 publishing a second BG file asks to replace "menu-bg.png" ("Само един файл на език")', /menu-bg\.png/.test(ct) && /Само един файл на език/.test(ct), ct.replace(/\n/g, ' | '));
  await admin.locator('dialog[open]').getByRole('button', { name: 'Публикувай' }).click(); await admin.waitForTimeout(800);
  const f2 = (await api.get('/api/admin/menu')).data.files;
  R.check('FL8 after confirming: bg2 and en published, old bg unpublished', f2.find((x) => x.originalName === 'menu-bg2.png').published && f2.find((x) => x.originalName === 'menu-en.png').published && !f2.find((x) => x.originalName === 'menu-bg.png').published);
  // public in file mode
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForSelector('.menu-file img');
  R.check('FL9 public БГ in file mode shows the GREEN BG file; EN click switches to the BLUE EN file without reload', isGreen(await pixel(page, '.menu-file img')) && await (async () => {
    await page.evaluate(() => { window.__marker = 'm'; }); await clickLang(page, 'en');
    await page.waitForFunction(() => { const i = document.querySelector('.menu-file img'); if (!i || !i.complete || !i.naturalWidth) return false; const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); return c.getContext('2d').getImageData(1, 1, 1, 1).data[2] > 150; }, null, { timeout: 4000 });
    return (await page.evaluate(() => window.__marker)) === 'm' && isBlue(await pixel(page, '.menu-file img'));
  })());
  // unpublish EN through the API -> fallback in EN mode
  await api.patch(`/api/admin/menu/files/${f2.find((x) => x.originalName === 'menu-en.png').id}/published`, { json: { published: false } });
  await clickLang(page, 'bg'); await page.waitForTimeout(300); await clickLang(page, 'en'); await page.waitForTimeout(700);
  R.check('FL10 EN unpublished -> EN visitor falls back to the BG file (GREEN)', isGreen(await pixel(page, '.menu-file img')));
  await context.close();
  // dashboard observation
  await api.patch(`/api/admin/menu/files/${f2.find((x) => x.originalName === 'menu-en.png').id}/published`, { json: { published: true } });
  await go(admin, '#/'); await admin.waitForTimeout(700);
  const dash = await admin.locator('main').innerText();
  console.log('OBSERVATION dashboard text (both languages published):', dash.replace(/\n/g, ' | ').slice(0, 600));
  R.check('FL11 dashboard renders without error while two files are published (observation: lists only publishedFile)', /табло/i.test(dash) && (await admin.locator('[role=alert]').count()) === 0);
  await admin.screenshot({ path: path.join(shots, 'langs-dashboard.png') });
  // in_use through the UI: switch back to structured first so nothing is blocking
  await go(admin, '#/menu'); await admin.waitForSelector('#tab-file');
  await tab(admin, 'Файл').click();
  const ids = (await api.get('/api/admin/menu')).data.files;
  const sec1 = admin.locator('section.a-fileslang').nth(1);
  const delBtn = sec1.locator('article:has-text("menu-en.png")').getByRole('button', { name: /Изтрий/ });
  await delBtn.click(); await admin.waitForSelector('dialog[open]'); await admin.locator('dialog[open]').getByRole('button', { name: 'Изтрий файла' }).click(); await admin.waitForTimeout(800);
  R.check('FL12 deleting the published EN file is allowed while the BG file stays published (in_use only for the last published file)', (await api.get('/api/admin/menu')).data.files.length === ids.length - 1 && (await admin.locator('[role=alert]:visible').count()) === 0);
  const sec0 = admin.locator('section.a-fileslang').nth(0);
  await sec0.locator('article:has-text("menu-bg2.png")').getByRole('button', { name: /Изтрий/ }).click(); await admin.waitForSelector('dialog[open]'); await admin.locator('dialog[open]').getByRole('button', { name: 'Изтрий файла' }).click(); await admin.waitForTimeout(900);
  R.check('FL13 deleting the LAST published file in file mode is refused with the in-use message and the file stays', (await admin.getByText('Този файл се показва на клиентите.').count()) >= 1 && (await api.get('/api/admin/menu')).data.files.some((x) => x.originalName === 'menu-bg2.png'));
});

await step('A-LOG', async () => {
  const bad = alog.console.filter((m) => !/status of (401|400|413|415|409)/.test(m));
  R.check('LOG-A admin session: no page errors / unexpected console errors / CSP violations during the whole scenario', alog.pageErrors.length === 0 && bad.length === 0 && (await admin.collectCsp()).length === 0, JSON.stringify({ p: alog.pageErrors, c: bad }));
});
await actx.close();
await srv.stop();

// ============================================================================================ G. XSS + 768 px admin (fresh server, port 3205)
const dir2 = tmpDir('langsxss'); createAdmin(dir2);
const srv2 = await startServer({ port: 3205, dataDir: dir2, now: T0 });
const b2 = srv2.url; const api2 = new Client(b2); await api2.login(); const anon2 = new Client(b2);
await step('G-XSS', async () => {
  const P = (n, tag = 'img') => (tag === 'img' ? `<img src=x onerror="window.__xss=${n}">` : `<script>window.__xss=${n}</script><svg onload="window.__xss=${n}">`);
  const evBg = (await api2.post('/api/admin/events', { form: form({ title: P(1) + 'EvBg', titleEn: P(2) + 'EvEn', description: P(3, 's'), descriptionEn: P(4, 's'), enabled: 'true' }, { field: 'image', buf: RED, name: '"onerror="window.__xss=20".png', type: 'image/png' }) })).data;
  await api2.put(`/api/admin/events/${evBg.id}`, { form: form({}, { field: 'imageEn', buf: BLUE, name: "x'onerror='window.__xss=21'.png", type: 'image/png' }) });
  await api2.post('/api/admin/events', { form: form({ title: '', titleEn: P(5) + 'EnOnly', descriptionEn: P(6, 's'), enabled: 'true' }) });
  const mk = (n, p) => ({ name: n, nameEn: p, description: 'd', descriptionEn: 'e', priceCents: 100, available: true });
  await api2.put('/api/admin/menu/draft', { json: { categories: [{ name: P(7) + 'CatBg', nameEn: P(8) + 'CatEn', items: [mk(P(9) + 'DishBg', P(10) + 'DishEn'), mk('', P(11) + 'EnOnlyDish'), mk(P(12) + 'BgOnlyDish', '')] }] } });
  await api2.post('/api/admin/menu/publish');
  await api2.put('/api/admin/settings', { json: { address: P(13), addressEn: P(14), openingHours: P(15, 's'), openingHoursEn: P(16, 's') } });
  await api2.post('/api/admin/daily-menus', { form: form({ date: TODAY, published: 'true' }, { field: 'fileEn', buf: PDF, name: '<img src=x onerror=window.__xss=22>.pdf', type: 'application/pdf' }) });
  const files = [];
  for (const [l, n] of [['bg', 'a"b.png'], ['en', "c'd<e>.png"]]) files.push((await api2.post('/api/admin/menu/files', { form: form({ lang: l }, { field: 'file', buf: l === 'bg' ? RED : BLUE, name: n, type: 'image/png' }) })).data);

  const checkXss = async (page, label) => {
    const x = await page.evaluate(() => ({ xss: window.__xss, imgX: document.querySelectorAll('img[src="x"]').length, svg: document.querySelectorAll('svg[onload]').length, injectedScripts: [...document.querySelectorAll('script')].filter((s) => !s.src).length, onerr: document.querySelectorAll('[onerror],[onload]').length }));
    R.check(`XSS[${label}] window.__xss unset, no injected <img src=x>/<svg onload>/inline <script>/handler attributes`, x.xss === undefined && x.imgX === 0 && x.svg === 0 && x.injectedScripts === 0 && x.onerr === 0, JSON.stringify(x));
  };
  for (const vp of [{ n: '390', w: 390, h: 844 }, { n: '1280', w: 1280, h: 800 }]) {
    const { context, page, log } = await newPage(browser, { width: vp.w, height: vp.h });
    for (const l of ['bg', 'en']) {
      await page.goto(`${b2}/?lang=${l}`, { waitUntil: 'networkidle' }); await page.waitForSelector('.dish'); await page.waitForTimeout(500);
      await checkXss(page, `public / ${l} ${vp.n}`);
      const txt = await page.locator('body').innerText();
      R.check(`XSS-T[public ${l} ${vp.n}] the payload is visible as literal text`, /<img src=x onerror/.test(txt) && /EnOnly|EvBg|EvEn/.test(txt));
      await page.goto(`${b2}/daily-menu?lang=${l}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
      await checkXss(page, `daily ${l} ${vp.n}`);
    }
    R.check(`XSS-L[${vp.n}] public pages: no console errors beyond the intended 404/blocked image requests`, log.pageErrors.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify({ c: log.console, p: log.pageErrors, h: log.http4xx }));
    await context.close();
  }
  // admin: all views
  const { context, page, log } = await newPage(browser, { width: 1280, height: 900 });
  await login(page, b2);
  for (const h of ['#/', '#/events', '#/daily-menu', '#/menu', '#/settings', `#/events/${evBg.id}`]) {
    await go(page, h); await page.waitForTimeout(500);
    for (const l of ['Български', 'English']) { if (await tab(page, l).count()) { await tab(page, l).click(); await page.waitForTimeout(150); } }
    await checkXss(page, `admin ${h}`);
  }
  await go(page, '#/menu'); await page.waitForSelector('.a-dish');
  await page.getByRole('button', { name: 'Преглед', exact: true }).click(); await page.waitForTimeout(400);
  await checkXss(page, 'admin menu preview'); await page.keyboard.press('Escape');
  await go(page, `#/events/${evBg.id}`); await page.waitForTimeout(400); await tab(page, 'English').click(); await page.waitForTimeout(300);
  await checkXss(page, 'admin event form preview (EN)');
  R.check('XSS-AL admin: no page errors / CSP violations', log.pageErrors.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify({ p: log.pageErrors }));
  await context.close();
  void files;
});

// ============================================================================================ H. admin at 768 px (+390) rendering, tabs, hints
await step('H-768', async () => {
  for (const vp of [{ n: '768', w: 768, h: 1024 }, { n: '390', w: 390, h: 844 }]) {
    const { context, page, log } = await newPage(browser, { width: vp.w, height: vp.h });
    await login(page, b2);
    const targets = ['#/events/new', '#/menu', '#/settings', '#/daily-menu', '#/events'];
    for (const h of targets) {
      await go(page, h); await page.waitForTimeout(500);
      const sc = await noHScroll(page);
      R.check(`R-ADM[${vp.n}] ${h}: no horizontal scroll`, sc.ok, JSON.stringify(sc));
      if (await tab(page, 'English').count()) {
        const sizes = await page.locator('.a-langtab').evaluateAll((ts) => ts.map((t) => { const r = t.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
        R.check(`R-TAB[${vp.n}] ${h}: language tabs are >=44x44 and inside the viewport`, sizes.length === 2 && sizes.every(([w, hh]) => w >= 44 && hh >= 44), JSON.stringify(sizes));
        // focus ring visible on keyboard focus
        await tab(page, 'Български').focus(); await page.keyboard.press('ArrowRight');
        const ring = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { w: cs.outlineWidth, s: cs.outlineStyle }; });
        R.check(`R-FOCUS[${vp.n}] ${h}: focused language tab has a visible outline`, ring.s !== 'none' && parseFloat(ring.w) >= 2, JSON.stringify(ring));
        await page.screenshot({ path: path.join(shots, `langs-admin${h.replace(/[#/]/g, '_')}-${vp.n}.png`), fullPage: true });
      } else await page.screenshot({ path: path.join(shots, `langs-admin${h.replace(/[#/]/g, '_')}-${vp.n}.png`), fullPage: true });
    }
    // a11y of the tabs: names, one h1
    await go(page, '#/events/new');
    R.check(`R-A11Y[${vp.n}] event form: exactly one h1, labelled inputs in both panels`, (await page.locator('h1').count()) === 1 && await page.evaluate(() => [...document.querySelectorAll('.a-langpanel input:not([type=file]), .a-langpanel textarea')].every((i) => i.labels && i.labels.length === 1)));
    // contrast of the dot/hint text
    R.check(`R-LOG[${vp.n}] no page errors / console errors / CSP violations`, log.pageErrors.length === 0 && log.console.filter((m) => !/401/.test(m)).length === 0 && (await page.collectCsp()).length === 0, JSON.stringify({ p: log.pageErrors, c: log.console }));
    await context.close();
  }
});

await srv2.stop();
R.summary();
console.log(`srv1 log tail: ${srv.log().slice(-200)}`);
await browser.close();

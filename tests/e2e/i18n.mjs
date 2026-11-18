// БГ / EN: public site switch (T-15) and admin English fields (T-16) + BUG-5/6/7 retests. Ports 3209 (main) and 3208 (empty-menu state).
// Run: node tests/e2e/i18n.mjs
import path from 'node:path';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PDF, PASSWORD, reporter, sleep } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir } from '../lib/browser.mjs';

const R = reporter('i18n-e2e');
const T0 = '2026-06-15T10:00:00Z'; // Monday 15 June 2026, 13:00 Sofia
const dir = tmpDir('i18nui'); createAdmin(dir);
const srv = await startServer({ port: 3209, dataDir: dir, now: T0 });
const base = srv.url;
const admin = new Client(base); await admin.login();
const anon = new Client(base);
const shots = shotDir();
const PNG = makePng(600, 400, [200, 120, 40]);
const XSS_T = '<img src=x onerror="window.__xss=1">EvilTitle';
const XSS_D = '<script>window.__xss=2</script><b>not bold</b>\nsecond line';
const XSS_DISH = '<svg onload=window.__xss=3>DishEvil</svg>';
const XSS_CAT = '<img src=x onerror=window.__xss=6>Mains';
const XSS_ADDR = '<img src=x onerror="window.__xss=4">AddrEvil';
const XSS_HRS = '<script>window.__xss=7</script>HoursEvil';
const mk = (n, p, extra = {}) => ({ name: n, description: '', priceCents: p, available: true, ...extra });

// ---------- seed (English for everything except the deliberate BG-only fallbacks) ----------
await admin.put('/api/admin/settings', { json: { reservationPhone: '+359 88 123 4567', address: 'ул. Витоша 1, София', addressEn: 'Vitosha St 1, Sofia', openingHours: 'Пн-Нд 10:00-22:00', openingHoursEn: '', currencySymbol: '€' } });
const e1 = (await admin.post('/api/admin/events', { form: form({ title: 'Джаз вечер', titleEn: 'Jazz night', description: 'Жива музика', descriptionEn: 'Live music', enabled: 'true', eventAt: '2026-06-20T20:00' }, { field: 'image', buf: PNG, name: 'e.png', type: 'image/png' }) })).data;
const e2 = (await admin.post('/api/admin/events', { form: form({ title: 'Събитие две', titleEn: XSS_T, description: 'Опис', descriptionEn: XSS_D, enabled: 'true', eventAt: '2026-06-21T19:30' }) })).data;
await admin.put('/api/admin/menu/draft', { json: { categories: [
  { name: 'Салати', nameEn: 'Salads', items: [mk('Шопска салата', 650, { nameEn: 'Shopska salad', description: 'домати, сирене', descriptionEn: 'tomatoes, cheese' }), mk('Ястие', 500, { nameEn: XSS_DISH, descriptionEn: '<script>window.__xss=5</script>x' }), mk('Само БГ', 400, { description: 'само български' })] },
  { name: 'Основни', nameEn: XSS_CAT, items: [mk('Печено', 125000, { nameEn: 'Roast', descriptionEn: 'slow cooked', description: 'бавно' }), mk('Изчерпано', 900, { nameEn: 'Sold out', available: false }), mk('Безплатно', 0, { nameEn: 'Free' })] },
  { name: 'Десерти', items: [mk('Баклава', 450)] },
] } });
await admin.post('/api/admin/menu/publish');
const dm = (await admin.post('/api/admin/daily-menus', { form: form({ date: '2026-06-15', published: 'true' }, { field: 'file', buf: PNG, name: 'dnes.png', type: 'image/png' }) })).data;
const ALLOWED_BG = ['Амора Джелато ЕООД', 'Десерти', 'Баклава', 'Само БГ', 'само български', 'Пн-Нд 10:00-22:00'];

const browser = await chromium.launch();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.message).split('\n').slice(0, 3).join(' ')); } };
const settle = async (page, ms = 350) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms); };
const clickLang = async (page, l) => { await page.locator(`.lang-btn[data-lang="${l}"]`).click(); };
const lang = (page) => page.getAttribute('html', 'lang');
const search = (page) => page.evaluate(() => location.search);
const cleanLog = async (page, log) => log.console.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && log.http4xx.length === 0 && (await page.collectCsp()).length === 0;
const logEv = async (page, log) => JSON.stringify({ c: log.console, p: log.pageErrors, f: log.failed, h: log.http4xx, csp: await page.collectCsp() });
// text nodes joined (CSS text-transform must not matter, as in public.mjs)
const bodyText = (page) => page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const n = w.currentNode; const p = n.parentElement; if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName)) continue; const v = n.nodeValue.replace(/\s+/g, ' ').trim(); if (v) out.push(v); } return out.join('\n'); });

/** Every Cyrillic string in text nodes and in aria-label/alt/title/placeholder + document title + meta description. */
const cyrillic = (page) => page.evaluate(() => {
  const re = /[Ѐ-ӿ]/; const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; const p = n.parentElement; if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName)) continue; if (re.test(n.nodeValue)) out.push({ k: 'text', v: n.nodeValue.trim(), cls: p.className }); }
  for (const el of document.querySelectorAll('*')) for (const a of ['aria-label', 'alt', 'title', 'placeholder']) { const v = el.getAttribute(a); if (v && re.test(v)) out.push({ k: a, v, cls: String(el.className) }); }
  if (re.test(document.title)) out.push({ k: 'title', v: document.title });
  const m = document.querySelector('meta[name="description"]'); if (m && re.test(m.content)) out.push({ k: 'meta', v: m.content });
  return out.filter((o) => !(o.cls && /lang-btn/.test(o.cls)));
});
const uiCyrillic = async (page, allowed = ALLOWED_BG) => (await cyrillic(page)).filter((o) => !allowed.some((a) => o.v.includes(a)));

const VPS = [{ name: '360', width: 360, height: 740 }, { name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1280', width: 1280, height: 800 }];

// ===================================================================== PUBLIC: per viewport
for (const vp of VPS) {
  await step(`PV[${vp.name}]`, async () => {
    const { context, page, log } = await newPage(browser, { width: vp.width, height: vp.height });
    const tag = vp.name;
    for (const p of ['/', '/daily-menu']) {
      await page.goto(base + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
      const boxes = await page.locator('.lang-btn').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return { l: b.dataset.lang, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, vis: cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 }; }));
      R.check(`SW1[${tag}] ${p}: both language buttons visible, inside the viewport, >=44x44 CSS px`, boxes.length === 2 && boxes.every((b) => b.vis && b.inView && b.w >= 44 && b.h >= 44), JSON.stringify(boxes));
      R.check(`SW2[${tag}] ${p}: BG pressed by default, <html lang=bg>, buttons carry lang attr`, (await lang(page)) === 'bg' && (await page.locator('.lang-btn[data-lang=bg]').getAttribute('aria-pressed')) === 'true' && (await page.locator('.lang-btn[data-lang=en]').getAttribute('aria-pressed')) === 'false' && (await page.locator('.lang-btn[data-lang=en]').getAttribute('lang')) === 'en');
    }
    // index round trip
    await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForSelector('.dish'); await page.waitForTimeout(300);
    const bg0 = await bodyText(page);
    R.check(`HS1[${tag}] / BG: no horizontal scroll`, (await noHScroll(page)).ok);
    await clickLang(page, 'en'); await settle(page);
    const en = await bodyText(page);
    R.check(`HS2[${tag}] / EN: no horizontal scroll`, (await noHScroll(page)).ok, JSON.stringify(await noHScroll(page)));
    R.check(`RT1[${tag}] / BG->EN: UI strings english (nav, hero, headings, contact labels), content english`, ['Menu', 'Daily Specials', 'Reservation', 'Location', 'About', 'Contact', 'Opening hours', 'Jazz night', 'Live music', 'Salads', 'Shopska salad', 'Vitosha St 1, Sofia', 'Skip to content', 'For reservations:'].every((s) => en.includes(s)) && en.includes('Fresh food'), en.slice(0, 300).replace(/\n/g, '|'));
    R.check(`RT2[${tag}] / EN: <html lang=en>, title, meta description, aria-pressed, URL ?lang=en, localStorage`, (await lang(page)) === 'en' && (await page.title()) === 'Kota1 Restaurant' && /fresh food and a warm welcome/i.test(await page.locator('meta[name=description]').getAttribute('content')) && (await page.locator('.lang-btn[data-lang=en]').getAttribute('aria-pressed')) === 'true' && (await search(page)) === '?lang=en' && (await page.evaluate(() => localStorage.getItem('kota_lang'))) === 'en', JSON.stringify({ t: await page.title(), s: await search(page) }));
    const cy = await uiCyrillic(page);
    R.check(`CY1[${tag}] / EN: no Cyrillic UI strings (text, aria-label, alt, title, meta) outside the deliberate BG-fallback content`, cy.length === 0, JSON.stringify(cy));
    await clickLang(page, 'bg'); await settle(page);
    const bg1 = await bodyText(page);
    R.check(`RT3[${tag}] / EN->BG: page text identical to the initial BG render, lang=bg, no ?lang param, title/meta BG`, bg1 === bg0 && (await lang(page)) === 'bg' && (await search(page)) === '' && /прясна храна/.test(await page.locator('meta[name=description]').getAttribute('content')), bg0 === bg1 ? '' : `diff: ${[...bg0.split('\n')].filter((l, i) => l !== bg1.split('\n')[i]).slice(0, 3).join('|')} vs ${bg1.split('\n').filter((l, i) => l !== bg0.split('\n')[i]).slice(0, 3).join('|')}`);
    R.check(`HS3[${tag}] / BG after round trip: no horizontal scroll`, (await noHScroll(page)).ok);
    // daily menu round trip
    await page.goto(base + '/daily-menu', { waitUntil: 'networkidle' }); await page.waitForSelector('.viewer img'); await page.waitForTimeout(300);
    const d0 = await bodyText(page);
    await clickLang(page, 'en'); await settle(page);
    const d1 = await bodyText(page);
    R.check(`DM1[${tag}] /daily-menu BG->EN: english h1, tag, date "Monday, 15 June 2026", buttons; <html lang=en>; title`, /Daily Specials/.test(await page.locator('h1').textContent()) && d1.includes('Monday, 15 June 2026') && d1.includes('Today only') && d1.includes('Open in new tab') && d1.includes('Tap to enlarge') && (await lang(page)) === 'en' && (await page.title()).startsWith('Daily Specials'), d1.replace(/\n/g, '|').slice(0, 300));
    R.check(`DM2[${tag}] /daily-menu EN: image alt english, no Cyrillic UI strings, no h-scroll`, (await page.locator('.viewer img').getAttribute('alt')) === 'Daily menu for Monday, 15 June 2026' && (await uiCyrillic(page, [])).length === 0 && (await noHScroll(page)).ok, JSON.stringify(await cyrillic(page)));
    await clickLang(page, 'bg'); await settle(page);
    R.check(`DM3[${tag}] /daily-menu EN->BG: identical to initial BG render`, (await bodyText(page)) === d0 && (await lang(page)) === 'bg' && (await search(page)) === '');
    R.check(`LOG[${tag}] public pages, all switches: no console errors / page errors / CSP violations / failed or 4xx requests`, await cleanLog(page, log), await logEv(page, log));
    if (vp.name === '390' || vp.name === '1280') { await page.goto(base + '/?lang=en', { waitUntil: 'networkidle' }); await page.waitForSelector('.dish'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(shots, `i18n-index-en-${tag}.png`), fullPage: true }); }
    await context.close();
  });
}

// ===================================================================== PUBLIC: scenarios (390)
await step('PS', async () => {
  const { context, page, log } = await newPage(browser, { width: 390, height: 844 });
  // deep links + formatting
  await page.goto(base + '/?lang=en', { waitUntil: 'networkidle' }); await page.waitForSelector('.dish');
  R.check('DL1 /?lang=en deep link: EN on first paint after load (html lang, h2 "Menu", contact "Phone"), storage set', (await lang(page)) === 'en' && (await page.locator('#menu-heading').textContent()) === 'Menu' && (await bodyText(page)).includes('Phone') && (await page.evaluate(() => localStorage.getItem('kota_lang'))) === 'en');
  const t = await bodyText(page);
  R.check('FMT1 EN price "€6.50", "€1,250.00" (thousands), no price for 0 cents; BG format later', /€6\.50/.test(t) && /€1,250\.00/.test(t) && !/€0\.00/.test(t) && !/6,50/.test(t), (t.match(/€[\d,.]+/g) || []).join(' '));
  R.check('FMT2 EN event date "Saturday, 20 June 2026, 20:00"', t.includes('Saturday, 20 June 2026, 20:00') && t.includes('Sunday, 21 June 2026, 19:30'), (t.match(/\w+day, [^\n]*/g) || []).join('|'));
  R.check('FMT3 EN: unavailable tag "Unavailable"; event heading "Events"; event tag "Event"; category nav aria-label "Categories"', t.includes('Unavailable') && (await page.locator('#event-heading').textContent()) === 'Events' && (await page.locator('.event-tag').first().textContent()).toLowerCase() === 'event' && (await page.locator('.cat-nav').getAttribute('aria-label')) === 'Categories');
  R.check('FB1 EN per-field fallback: BG-only dish/category/hours stay Bulgarian, English siblings english', t.includes('Само БГ') && t.includes('Десерти') && t.includes('Пн-Нд 10:00-22:00') && t.includes('Vitosha St 1, Sofia') && t.includes('Roast') && t.includes('Mains'));
  R.check('ZOOM1 EN event image button aria-label "Enlarge image: Jazz night", alt "Jazz night"', (await page.locator('.zoom-btn').first().getAttribute('aria-label')) === 'Enlarge image: Jazz night' && (await page.locator('.zoom-btn img').first().getAttribute('alt')) === 'Jazz night');
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  const internal = hrefs.filter((h) => h === '/' || h.startsWith('/#') || h.startsWith('/daily-menu') || h.startsWith('/?'));
  R.check('LK1 EN: every internal page link (/, /#x, /daily-menu) carries lang=en; tel:/external untouched', internal.length >= 8 && internal.every((h) => /[?&]lang=en/.test(h)) && hrefs.some((h) => h.startsWith('tel:') && !h.includes('lang')), JSON.stringify(internal));
  await page.getByRole('link', { name: 'Daily Specials' }).last().click().catch(() => {});
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(300);
  R.check('PERS1 EN: nav link to /daily-menu keeps EN (URL ?lang=en, page english)', page.url().includes('/daily-menu?lang=en') && (await lang(page)) === 'en' && /Daily Specials/.test(await page.locator('h1').textContent()), page.url());
  // storage persistence, URL without param
  await page.goto(base + '/daily-menu', { waitUntil: 'networkidle' });
  R.check('PERS2 EN chosen earlier, open /daily-menu with no param: stays EN (localStorage), URL normalised to ?lang=en', (await lang(page)) === 'en' && (await search(page)) === '?lang=en', await search(page));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  R.check('PERS3 same for /', (await lang(page)) === 'en' && (await search(page)) === '?lang=en');
  // URL beats storage
  await page.goto(base + '/?lang=bg', { waitUntil: 'networkidle' }); await page.waitForSelector('.dish');
  R.check('URL1 storage=en but ?lang=bg => BG page, storage updated to bg', (await lang(page)) === 'bg' && (await page.locator('#menu-heading').textContent()) === 'Меню' && (await page.evaluate(() => localStorage.getItem('kota_lang'))) === 'bg');
  await page.goto(base + '/daily-menu?lang=en', { waitUntil: 'networkidle' });
  R.check('URL2 storage=bg but /daily-menu?lang=en => EN', (await lang(page)) === 'en' && /Daily Specials/.test(await page.locator('h1').textContent()));
  await page.goto(base + '/?lang=fr', { waitUntil: 'networkidle' }); await page.waitForSelector('.dish');
  R.check('URL3 invalid ?lang=fr ignored: falls back to stored language (en), content loads, no 400 request', (await lang(page)) === 'en' && log.http4xx.length === 0 && (await page.locator('.dish').count()) > 0, JSON.stringify({ l: await lang(page), h: log.http4xx }));
  await page.goto(base + '/?lang=EN%3Cscript%3E', { waitUntil: 'networkidle' });
  R.check('URL4 malicious ?lang value is not reflected and does not break the page', (await page.locator('.dish').count()) > 0 && !(await bodyText(page)).includes('EN<script>') && (await page.evaluate(() => window.__xss)) === undefined);
  // BG formatting
  await page.goto(base + '/?lang=bg', { waitUntil: 'networkidle' }); await page.waitForSelector('.dish');
  const tb = await bodyText(page);
  R.check('FMT4 BG price "6,50 €" and date "събота, 20 юни 2026, 20:00"; no mixed English labels in BG mode (h1/h2/nav/buttons have no Latin letters)', /6,50\s€/.test(tb) && /1\s?250,00\s€/.test(tb) && tb.includes('събота, 20 юни 2026, 20:00') && (await page.locator('h2, .btn, .site-nav a, .hero .tagline').allTextContents()).every((s) => !/[A-Za-z]/.test(s)), (await page.locator('h2, .btn, .site-nav a').allTextContents()).join('|'));
  R.check('LOG-PS no console/CSP/failed requests during scenarios', await cleanLog(page, log), await logEv(page, log));
  await context.close();
});

// localStorage blocked
await step('LS', async () => {
  const { context, page, log } = await newPage(browser, { width: 390, height: 844 });
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } }); });
  await page.goto(base + '/?lang=en', { waitUntil: 'networkidle' }); await page.waitForSelector('.dish');
  R.check('LS1 localStorage access throws: /?lang=en still renders EN with content', (await lang(page)) === 'en' && (await page.locator('#menu-heading').textContent()) === 'Menu' && (await page.locator('.event-title').first().textContent()) === 'Jazz night');
  await clickLang(page, 'bg'); await settle(page);
  R.check('LS2 switch EN->BG works without storage (content + URL)', (await lang(page)) === 'bg' && (await page.locator('.event-title').first().textContent()) === 'Джаз вечер' && (await search(page)) === '');
  await clickLang(page, 'en'); await settle(page);
  R.check('LS3 switch BG->EN works without storage; nav link keeps ?lang=en', (await lang(page)) === 'en' && (await page.locator('.nav-daily a').getAttribute('href')).includes('lang=en'));
  await page.goto(base + '/daily-menu?lang=en', { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
  R.check('LS4 /daily-menu?lang=en works without storage', (await lang(page)) === 'en' && /Daily Specials/.test(await page.locator('h1').textContent()));
  R.check('LS5 no page errors / console errors with storage blocked', await cleanLog(page, log), await logEv(page, log));
  await context.close();
  // Storage that throws on setItem only (quota / private mode)
  const c2 = await newPage(browser, { width: 390, height: 844 });
  await c2.page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await c2.page.goto(base + '/?lang=en', { waitUntil: 'networkidle' }); await c2.page.waitForSelector('.dish');
  await clickLang(c2.page, 'bg'); await settle(c2.page);
  R.check('LS6 setItem throws (quota): switching still works, no page errors', (await lang(c2.page)) === 'bg' && c2.log.pageErrors.length === 0, JSON.stringify(c2.log.pageErrors));
  await c2.context.close();
});

// XSS in English fields
await step('XSS', async () => {
  const { context, page, log } = await newPage(browser, { width: 390, height: 844 });
  await admin.put('/api/admin/settings', { json: { addressEn: XSS_ADDR, openingHoursEn: XSS_HRS } });
  await page.goto(base + '/?lang=en', { waitUntil: 'networkidle' }); await page.waitForSelector('.dish'); await page.waitForTimeout(500);
  const xss = await page.evaluate(() => window.__xss);
  const titles = await page.locator('.event-title').allTextContents();
  const descs = await page.locator('.event-desc').allTextContents();
  const t = await bodyText(page);
  R.check('XSS1 EN mode: En payloads (event title/desc, category, dish name/desc, address, hours) did not execute (window.__xss undefined)', xss === undefined, `window.__xss=${xss}`);
  R.check('XSS2 EN event title/description shown as literal text', titles.includes(XSS_T) && descs.some((d) => d.includes('<script>window.__xss=2</script><b>not bold</b>')), JSON.stringify({ titles, descs }));
  R.check('XSS3 EN dish/category/address/hours payloads literal text (visible as typed)', t.includes(XSS_DISH) && t.includes(XSS_CAT) && t.includes(XSS_ADDR) && t.includes(XSS_HRS) && t.includes('<script>window.__xss=5</script>x'));
  const inj = await page.locator('img[src="x"], svg[onload], .event-desc b, .event-card script, #menu-content script, #location script, #location img, #contact script, #contact img, .dish svg, .cat-title img').count();
  R.check('XSS4 EN: no injected <img src=x>/<svg onload>/<script>/<b> elements in the DOM', inj === 0, String(inj));
  R.check('XSS5 EN XSS run: no CSP violation events and no page errors', (await page.collectCsp()).length === 0 && log.pageErrors.length === 0, await logEv(page, log));
  await clickLang(page, 'bg'); await settle(page); await clickLang(page, 'en'); await settle(page);
  R.check('XSS6 after BG->EN switch (re-render) still nothing executed', (await page.evaluate(() => window.__xss)) === undefined);
  await page.goto(base + '/?lang=bg', { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
  R.check('XSS7 BG mode never shows the En payloads', !(await bodyText(page)).includes('EvilTitle') && (await page.evaluate(() => window.__xss)) === undefined);
  await admin.put('/api/admin/settings', { json: { addressEn: 'Vitosha St 1, Sofia', openingHoursEn: '' } });
  await context.close();
});

// file-mode regular menu (image + PDF), lightbox, no-menu-today, errors
await step('FILES', async () => {
  const { context, page, log } = await newPage(browser, { width: 390, height: 844 });
  // lightbox on daily menu image
  await page.goto(base + '/daily-menu?lang=en', { waitUntil: 'networkidle' }); await page.waitForSelector('.viewer img');
  await page.locator('.viewer button').first().click();
  await page.waitForSelector('dialog.lightbox[open]');
  const lb = await page.evaluate(() => { const d = document.querySelector('dialog.lightbox'); return { aria: d.getAttribute('aria-label'), btns: [...d.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || '') + '/' + b.textContent.trim()), alt: d.querySelector('img').alt }; });
  R.check('LB1 EN lightbox: dialog aria-label "Enlarged image", "Zoom in", close "Close", image alt english', lb.aria === 'Enlarged image' && lb.btns.some((b) => b.endsWith('/Zoom in')) && lb.btns.some((b) => b.startsWith('Close')) && /Daily menu for Monday/.test(lb.alt), JSON.stringify(lb));
  await page.locator('dialog.lightbox .lb-btn:not(.lb-prev):not(.lb-next)').first().click();
  R.check('LB2 EN lightbox zoom toggles to "Zoom out"', (await page.locator('dialog.lightbox .lb-btn:not(.lb-prev):not(.lb-next)').first().textContent()) === 'Zoom out');
  R.check('LB3 EN lightbox: no Cyrillic in dialog', (await page.evaluate(() => /[Ѐ-ӿ]/.test(document.querySelector('dialog.lightbox').outerHTML.replace(/src="[^"]*"/g, '')))) === false);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await clickLang(page, 'bg'); await settle(page);
  await page.locator('.viewer button').first().click(); await page.waitForSelector('dialog.lightbox[open]');
  const lb2 = await page.evaluate(() => { const d = document.querySelector('dialog.lightbox'); return { aria: d.getAttribute('aria-label'), z: d.querySelector('.lb-btn:not(.lb-prev):not(.lb-next)').textContent.trim() }; });
  R.check('LB4 switch to BG, reopen lightbox: labels Bulgarian again ("Увеличена снимка", "Увеличи")', lb2.aria === 'Увеличена снимка' && lb2.z === 'Увеличи', JSON.stringify(lb2));
  await page.keyboard.press('Escape');
  // regular menu: file mode image
  const f = (await admin.post('/api/admin/menu/pages', { form: form({ lang: 'bg' }, { field: 'file', buf: makePng(800, 1100, [90, 90, 160]), name: 'menu.png', type: 'image/png' }) })).data;
  await admin.put('/api/admin/menu/pages/published', { json: { lang: 'bg', published: true } });
  await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } });
  await page.goto(base + '/?lang=en', { waitUntil: 'networkidle' }); await page.waitForSelector('.menu-slide img'); await page.waitForTimeout(300);
  const mt = await page.locator('#menu-content').textContent();
  const zl = await page.locator('.menu-slide .zoom-btn').getAttribute('aria-label');
  R.check('FM1 EN file-mode image page (served from the BG set by fallback): alt "Menu — page 1", zoom label "Enlarge page 1 of 1"; D-49: NO "Download menu" / "Download page 1" / download attribute; no Cyrillic UI', (await page.locator('.menu-slide img').getAttribute('alt')) === 'Menu — page 1' && zl === 'Enlarge page 1 of 1' && !/Download/i.test(mt) && (await page.locator('a[download]').count()) === 0 && (await uiCyrillic(page)).length === 0, JSON.stringify({ mt, zl, c: await cyrillic(page) }));
  await clickLang(page, 'bg'); await settle(page);
  R.check('FM2 file-mode image page EN->BG: no "Изтегли…" text (D-49), alt "Меню — страница 1", zoom "Увеличи страница 1 от 1"', !(await page.locator('#menu-content').textContent()).includes('Изтегли') && (await page.locator('a[download]').count()) === 0 && (await page.locator('.menu-slide img').getAttribute('alt')) === 'Меню — страница 1' && (await page.locator('.menu-slide .zoom-btn').getAttribute('aria-label')) === 'Увеличи страница 1 от 1');
  // PDF as the only page (add the PDF, then delete the image page)
  const pdf = (await admin.post('/api/admin/menu/pages', { form: form({ lang: 'bg' }, { field: 'file', buf: PDF, name: 'menu.pdf', type: 'application/pdf' }) })).data;
  await admin.del(`/api/admin/menu/pages/${f.id}`);
  await page.goto(base + '/?lang=en', { waitUntil: 'networkidle' }); await page.waitForSelector('.menu-slide .pdf-card'); await page.waitForTimeout(300);
  const pt = await page.locator('#menu-content').textContent();
  R.check('FM3 EN file-mode PDF page (390): card "PDF — page 1", "Open menu (PDF)", NO "Download" (D-49), no download attribute; no Cyrillic; links target=_blank rel=noopener', pt.includes('PDF — page 1') && pt.includes('Open menu (PDF)') && !/Download/i.test(pt) && (await page.locator('a[download]').count()) === 0 && (await page.locator('.menu-slide .pdf-card a[target=_blank]').evaluateAll((as) => as.length > 0 && as.every((a) => /noopener/.test(a.rel)))) && (await uiCyrillic(page)).length === 0, JSON.stringify({ pt, c: await cyrillic(page) }));
  await clickLang(page, 'bg'); await settle(page);
  R.check('FM4 PDF page EN->BG: "PDF — страница 1", "Отвори меню (PDF)"', (await page.locator('#menu-content').textContent()).includes('PDF — страница 1') && (await page.locator('#menu-content').textContent()).includes('Отвори меню (PDF)'));
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(base + '/?lang=en', { waitUntil: 'networkidle' }); await page.waitForSelector('.menu-slide .pdf-card'); await page.waitForTimeout(300);
  R.check('FM5 EN PDF page at 1280: no Cyrillic UI, no h-scroll', (await uiCyrillic(page)).length === 0 && (await noHScroll(page)).ok, JSON.stringify(await cyrillic(page)));
  void pdf;
  await page.setViewportSize({ width: 390, height: 844 });
  // daily PDF
  await admin.patch(`/api/admin/daily-menus/${dm.id}/published`, { json: { published: false } });
  const dpdf = (await admin.put(`/api/admin/daily-menus/${dm.id}`, { form: form({ date: '2026-06-15', published: 'true' }, { field: 'file', buf: PDF, name: 'd.pdf', type: 'application/pdf' }) })); // replaces today's menu
  await page.goto(base + '/daily-menu?lang=en', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  const dt = await page.locator('#daily-view').textContent();
  R.check('DP1 EN daily PDF: "The menu is a PDF file.", "Open PDF", NO "Download PDF" and no download attribute (D-49); no Cyrillic', dpdf.status < 300 && dt.includes('The menu is a PDF file.') && dt.includes('Open PDF') && !/Download/i.test(dt) && (await page.locator('a[download]').count()) === 0 && (await uiCyrillic(page, [])).length === 0, JSON.stringify({ s: dpdf.status, dt, c: await cyrillic(page) }));
  // no daily menu today
  await admin.patch(`/api/admin/daily-menus/${dm.id}/published`, { json: { published: false } });
  await page.goto(base + '/daily-menu?lang=en', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  const nt = await page.locator('#daily-view').textContent();
  const toMenu = await page.getByRole('link', { name: 'To the regular menu' }).getAttribute('href');
  R.check('NM1 EN no-menu-today: "No daily menu for today.", body, "To the regular menu" -> /?lang=en#menu, "Call us"; date line english; no Cyrillic', nt.includes('No daily menu for today.') && nt.includes('Check back later') && toMenu === '/?lang=en#menu' && nt.includes('Call us') && /^Monday, 15 June 2026$/.test((await page.locator('#daily-date').textContent()).trim()) && (await uiCyrillic(page, [])).length === 0, JSON.stringify({ nt, toMenu, c: await cyrillic(page) }));
  await clickLang(page, 'bg'); await settle(page);
  R.check('NM2 no-menu-today EN->BG: "Няма обедно меню за днес.", link /#menu without lang, date "Понеделник, 15 юни 2026"', (await page.locator('#daily-view').textContent()).includes('Няма обедно меню за днес.') && (await page.getByRole('link', { name: 'Към основното меню' }).getAttribute('href')) === '/#menu' && (await page.locator('#daily-date').textContent()).trim() === 'Понеделник, 15 юни 2026');
  await clickLang(page, 'en'); await settle(page);
  R.check('NM3 no-menu-today BG->EN re-translates in place', (await page.locator('#daily-view').textContent()).includes('No daily menu for today.'));
  R.check('NM-LOG no console/CSP/failed requests in file/lightbox/no-menu scenarios', await cleanLog(page, log), await logEv(page, log));
  await page.screenshot({ path: path.join(shots, 'i18n-nomenu-en-390.png') });
  // error state
  await admin.put('/api/admin/menu/mode', { json: { mode: 'structured' } });
  await page.route('**/api/public/menu*', (r) => r.abort());
  await page.goto(base + '/?lang=en', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  const et = await page.locator('#menu-content').textContent();
  R.check('ER1 EN menu load error: "The menu could not be loaded.", "Check your connection and try again.", "Try again"', et.includes('The menu could not be loaded.') && et.includes('Check your connection and try again.') && et.includes('Try again'), et);
  await page.unroute('**/api/public/menu*');
  await page.getByRole('button', { name: 'Try again' }).click(); await settle(page, 500);
  R.check('ER2 retry in EN loads the English menu', (await page.locator('.cat-title').first().textContent()) === 'Salads', await page.locator('#menu-content').textContent());
  await context.close();
  // restore daily menu for later tests
  await admin.patch(`/api/admin/daily-menus/${dm.id}/published`, { json: { published: true } });
});

// empty regular menu state (fresh server, nothing published)
await step('EMPTY', async () => {
  const d2 = tmpDir('i18nempty'); createAdmin(d2);
  const s2 = await startServer({ port: 3208, dataDir: d2, now: T0 });
  try {
    const { context, page, log } = await newPage(browser, { width: 390, height: 844 });
    await page.goto(s2.url + '/?lang=en', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    const t = await page.locator('#menu-content').textContent();
    R.check('EM1 EN empty regular menu: "Menu coming soon." + "See the daily menu"; contact/top bar hidden when no site data; no Cyrillic', t.includes('Menu coming soon.') && t.includes('See the daily menu') && (await uiCyrillic(page, [])).length === 0, JSON.stringify({ t: t.replace(/\n/g, '|'), c: await cyrillic(page) }));
    R.check('EM2 EN link "See the daily menu" -> /daily-menu?lang=en', (await page.getByRole('link', { name: 'See the daily menu' }).getAttribute('href')) === '/daily-menu?lang=en');
    await clickLang(page, 'bg'); await settle(page);
    R.check('EM3 empty state EN->BG: "Менюто скоро ще бъде публикувано."', (await page.locator('#menu-content').textContent()).includes('Менюто скоро ще бъде публикувано.'));
    R.check('EM-LOG no console/CSP errors', await cleanLog(page, log), await logEv(page, log));
    await context.close();
  } finally { await s2.stop(); }
});

// ===================================================================== RACE: rapid toggling with delayed responses
async function raceIndex(id, { start, delay, clicks, final }) {
  await step(id, async () => {
    const { context, page } = await newPage(browser, { width: 390, height: 844 });
    await page.goto(base + `/?lang=${start}`, { waitUntil: 'networkidle' }); await page.waitForSelector('.dish');
    await page.route(new RegExp(`/api/public/(events|menu|site)\\?lang=${delay}`), async (r) => { await sleep(1500); await r.continue().catch(() => {}); });
    for (const c of clicks) { await clickLang(page, c); await page.waitForTimeout(120); }
    await page.waitForTimeout(4000); await page.waitForLoadState('networkidle').catch(() => {});
    const st = await page.evaluate(() => ({
      html: document.documentElement.lang, ev: [...document.querySelectorAll('.event-title')].map((n) => n.textContent), evh: document.getElementById('event-heading')?.textContent,
      cats: [...document.querySelectorAll('.cat-title')].map((n) => n.textContent), addr: [...document.querySelectorAll('#location-list dd')].map((n) => (n.querySelector('.address-text') || n).textContent), hdr: document.getElementById('menu-heading').textContent, pressed: document.querySelector('.lang-btn[aria-pressed=true]').dataset.lang,
      price: document.querySelector('.dish-price')?.textContent, url: location.search, nEvSections: document.querySelectorAll('#event').length,
    }));
    const wantEn = final === 'en';
    const ok = st.html === final && st.pressed === final && st.ev[0] === (wantEn ? 'Jazz night' : 'Джаз вечер') && st.cats[0] === (wantEn ? 'Salads' : 'Салати') && st.addr.some((a) => a === (wantEn ? 'Vitosha St 1, Sofia' : 'ул. Витоша 1, София')) && st.hdr === (wantEn ? 'Menu' : 'Меню') && st.evh === (wantEn ? 'Events' : 'Събития') && st.nEvSections === 1 && st.url === (wantEn ? '?lang=en' : '');
    R.check(`${id} index: start ${start}, ${delay.toUpperCase()} responses delayed 1.5 s, clicks ${clicks.join('>')} => FINAL content must be ${final.toUpperCase()}`, ok, JSON.stringify(st));
    if (!ok) await page.screenshot({ path: path.join(shots, `i18n-${id}.png`), fullPage: false });
    await context.close();
  });
}
async function raceDaily(id, { start, delay, clicks, final }) {
  await step(id, async () => {
    const { context, page } = await newPage(browser, { width: 390, height: 844 });
    await page.goto(base + `/daily-menu?lang=${start}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
    await page.route(new RegExp(`/api/public/(daily-menu|site)\\?lang=${delay}`), async (r) => { await sleep(1500); await r.continue().catch(() => {}); });
    for (const c of clicks) { await clickLang(page, c); await page.waitForTimeout(120); }
    await page.waitForTimeout(4000);
    const st = await page.evaluate(() => ({ html: document.documentElement.lang, date: document.getElementById('daily-date').textContent, view: document.getElementById('daily-view').textContent, tag: document.getElementById('daily-tag').textContent, pressed: document.querySelector('.lang-btn[aria-pressed=true]').dataset.lang }));
    const wantEn = final === 'en';
    const ok = st.html === final && st.pressed === final && st.date.trim().startsWith(wantEn ? 'Monday' : 'Понеделник') && (wantEn ? !/[Ѐ-ӿ]/.test(st.view) : /[Ѐ-ӿ]/.test(st.view) || true);
    R.check(`${id} daily-menu: start ${start}, ${delay.toUpperCase()} delayed 1.5 s, clicks ${clicks.join('>')} => FINAL ${final.toUpperCase()}`, ok, JSON.stringify(st));
    await context.close();
  });
}
await raceIndex('RACE1', { start: 'bg', delay: 'bg', clicks: ['en', 'bg', 'en'], final: 'en' });
await raceIndex('RACE2', { start: 'bg', delay: 'en', clicks: ['en', 'bg'], final: 'bg' });
await raceIndex('RACE3', { start: 'en', delay: 'en', clicks: ['bg', 'en', 'bg'], final: 'bg' });
await raceIndex('RACE4', { start: 'bg', delay: 'bg', clicks: ['en'], final: 'en' }); // control: no stale response possible (BG is not requested after EN click)
await raceDaily('RACE5', { start: 'bg', delay: 'bg', clicks: ['en', 'bg', 'en'], final: 'en' });
await raceDaily('RACE6', { start: 'bg', delay: 'en', clicks: ['en', 'bg'], final: 'bg' });

// ===================================================================== ADMIN
async function loginA(page) {
  await page.goto(base + '/admin/', { waitUntil: 'networkidle' });
  await page.getByLabel('Потребителско име').fill('owner');
  await page.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('h1:has-text("Табло")');
}
const goA = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(350); };
const dismiss = async (page) => { for (let i = 0; i < 5 && (await page.locator('.a-toast__close').count()); i++) await page.locator('.a-toast__close').first().click(); };
const ADM_VPS = [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1280', width: 1280, height: 800 }];

// T-35: since D-39/T-34 the admin English fields live in "Български" / "English" tabs (no <details> fold-out); the flows below are the same, driven through the tabs.
const tabA = (page, n) => page.getByRole('tab', { name: new RegExp(`^${n}`) });
for (const vp of ADM_VPS) {
  await step(`AE[${vp.name}]`, async () => {
    const tag = vp.name; const uniq = `${tag}`;
    const { context, page, log } = await newPage(browser, { width: vp.width, height: vp.height });
    await loginA(page);
    // ---- event round trip, keyboard use of the language tabs
    await goA(page, '#/events/new'); await page.waitForSelector('h1:has-text("Ново събитие")');
    R.check(`AEV0[${tag}] event form: "Български"/"English" tabs present, BG selected, English panel hidden while empty, no <details> fold-out`, (await tabA(page, 'English').count()) === 1 && (await tabA(page, 'Български').getAttribute('aria-selected')) === 'true' && (await tabA(page, 'English').getAttribute('aria-selected')) === 'false' && !(await page.getByLabel('Title (English)').isVisible()) && (await page.locator('details.a-en').count()) === 0);
    await page.locator('input.a-input').first().fill(`Събитие ${uniq}`);
    await page.locator('textarea').first().fill(`Описание ${uniq}`);
    await tabA(page, 'Български').focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
    R.check(`AEV1[${tag}] keyboard: ArrowRight focuses and selects the English tab and shows a visible focus indicator`, await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return a.getAttribute('aria-selected') === 'true' && a.textContent.startsWith('English') && (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none' || cs.boxShadow !== 'none'); }));
    await page.keyboard.press('Home'); await page.keyboard.press('End'); await page.waitForTimeout(100);
    R.check(`AEV2[${tag}] keyboard: Home -> Български, End -> English (also ArrowLeft wraps)`, (await tabA(page, 'English').getAttribute('aria-selected')) === 'true' && await (async () => { await page.keyboard.press('Home'); const a = (await tabA(page, 'Български').getAttribute('aria-selected')) === 'true'; await page.keyboard.press('ArrowLeft'); return a && (await tabA(page, 'English').getAttribute('aria-selected')) === 'true'; })());
    await page.keyboard.press('Tab'); await page.waitForTimeout(80);
    R.check(`AEV3[${tag}] Tab from the English tab moves into the first English field ("Title (English)")`, await page.evaluate(() => { const a = document.activeElement; return !!a.labels && a.labels[0] && a.labels[0].textContent.startsWith('Title (English)'); }), await page.evaluate(() => document.activeElement.outerHTML.slice(0, 120)));
    // ---- preview toggle БГ|EN (BG first)
    await tabA(page, 'Български').click(); await page.waitForTimeout(250);
    const seg = page.locator('.a-previewcard .a-seg[aria-label="Език на прегледа"]');
    R.check(`AEV4[${tag}] event preview: БГ|EN toggle present, БГ pressed by default and shows the Bulgarian title`, (await seg.count()) === 1 && (await seg.getByRole('button', { name: 'Преглед на български' }).getAttribute('aria-pressed')) === 'true' && (await page.locator('.a-previewcard .event-title').textContent()) === `Събитие ${uniq}`);
    await tabA(page, 'English').click();
    await page.getByLabel('Title (English)').fill(`Event ${uniq}`);
    await page.getByLabel('Description (English)').fill(`Description ${uniq}\nline two`); await page.waitForTimeout(300);
    R.check(`AEV5[${tag}] event preview follows the English tab: English title + description shown, EN pressed`, (await page.locator('.a-previewcard .event-title').textContent()) === `Event ${uniq}` && (await page.locator('.a-previewcard .event-desc').textContent()).includes(`Description ${uniq}`) && (await seg.getByRole('button', { name: 'Преглед на английски' }).getAttribute('aria-pressed')) === 'true');
    await page.getByLabel('Title (English)').fill(''); await page.waitForTimeout(350);
    R.check(`AEV6[${tag}] event preview EN with empty English title: falls back to the Bulgarian title; description stays English`, (await page.locator('.a-previewcard .event-title').textContent()) === `Събитие ${uniq}` && (await page.locator('.a-previewcard .event-desc').textContent()).includes(`Description ${uniq}`));
    await page.getByLabel('Title (English)').fill(`Event ${uniq}`); await page.waitForTimeout(300);
    const pvT = await page.locator('.a-previewcard .event-card').textContent();
    R.check(`AEV6b[${tag}] event preview EN: UI strings of the card (tag, price/date formats) are English too (admin resolves lang=bg, preview reuses public renderer)`, !/Събитие\b/.test(pvT.replace(`Събитие ${uniq}`, '')) , pvT.replace(/\n/g, '|'));
    await page.screenshot({ path: path.join(shots, `i18n-admin-event-preview-en-${tag}.png`) });
    await page.getByRole('button', { name: 'Запази', exact: true }).click(); await page.waitForSelector('h1:has-text("Събития")'); await page.waitForTimeout(300);
    const saved = (await admin.get('/api/admin/events')).data.events.find((e) => e.title === `Събитие ${uniq}`);
    R.check(`AEV7[${tag}] event saved via UI: titleEn / descriptionEn (with line break) stored`, !!saved && saved.titleEn === `Event ${uniq}` && saved.descriptionEn === `Description ${uniq}\nline two`, JSON.stringify(saved && [saved.titleEn, saved.descriptionEn]));
    const pubEn = ((await anon.get('/api/public/events?lang=en')).data.events || []).find((e) => e.id === (saved && saved.id));
    R.check(`AEV8[${tag}] ... and public lang=en returns them (bg returns Bulgarian)`, pubEn && pubEn.title === `Event ${uniq}` && ((await anon.get('/api/public/events?lang=bg')).data.events.find((e) => e.id === saved.id).title === `Събитие ${uniq}`));
    // ---- reopen: prefilled
    await page.locator('article', { hasText: `Събитие ${uniq}` }).getByRole('link', { name: 'Редактирай' }).click();
    await page.waitForSelector('h1:has-text("Редактиране на събитие")'); await page.waitForTimeout(300);
    await tabA(page, 'English').click();
    R.check(`AEV9[${tag}] edit form: English tab carries a dot and is prefilled (round trip)`, (await tabA(page, 'English').locator('.a-tabdot:visible').count()) === 1 && (await page.getByLabel('Title (English)').inputValue()) === `Event ${uniq}` && (await page.getByLabel('Description (English)').inputValue()) === `Description ${uniq}\nline two`);
    R.check(`AEV9b[${tag}] no unsaved-changes guard on an untouched form`, await (async () => { await goA(page, '#/events'); return (await page.locator('dialog[open]').count()) === 0 && (await page.locator('h1:has-text("Събития")').count()) === 1; })());
    // ---- unsaved guard on EN-only edit
    await page.locator('article', { hasText: `Събитие ${uniq}` }).getByRole('link', { name: 'Редактирай' }).click();
    await page.waitForSelector('h1:has-text("Редактиране на събитие")'); await page.waitForTimeout(300);
    await tabA(page, 'English').click();
    await page.getByLabel('Title (English)').fill(`Event ${uniq} changed`);
    await goA(page, '#/events'); await page.waitForTimeout(250);
    const dlg = (await page.locator('dialog[open]').count()) ? await page.locator('dialog[open]').textContent() : '';
    R.check(`AEV10[${tag}] English-only edit then navigate away => "Имате незапазени промени" guard opens`, dlg.toLowerCase().includes('имате незапазени промени'), dlg);
    if (dlg) { await page.getByRole('button', { name: 'Остани' }).click(); await page.waitForTimeout(200); }
    R.check(`AEV11[${tag}] "Остани" keeps the form with the edited English value`, (await page.getByLabel('Title (English)').inputValue()) === `Event ${uniq} changed`);
    // ---- server 400 on En fields while the Bulgarian tab is showing
    await tabA(page, 'Български').click();
    await page.route('**/api/admin/events/*', (r) => r.request().method() === 'PUT' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'validation', message: 'Невалидни данни.', fields: { titleEn: 'СЪРВЪР-ГРЕШКА-ТИТЛА-EN', descriptionEn: 'СЪРВЪР-ГРЕШКА-ОПИС-EN' } }) }) : r.continue());
    await dismiss(page);
    await page.getByRole('button', { name: 'Запази', exact: true }).click(); await page.waitForTimeout(500);
    const mainTxt = await page.locator('main').textContent();
    const inl = await page.locator('.a-langpanel[lang=en] .a-error:visible').allTextContents();
    R.check(`AEV12[${tag}] server 400 on titleEn/descriptionEn: the English tab is selected automatically, inline errors visible in its panel and listed in the error summary`, (await tabA(page, 'English').getAttribute('aria-selected')) === 'true' && inl.join('|').includes('СЪРВЪР-ГРЕШКА-ТИТЛА-EN') && inl.join('|').includes('СЪРВЪР-ГРЕШКА-ОПИС-EN') && (await page.locator('[role=alert]:has-text("СЪРВЪР-ГРЕШКА-ТИТЛА-EN")').count()) >= 1, JSON.stringify({ inl, mainTxt: mainTxt.slice(0, 200) }));
    R.check(`AEV13[${tag}] the invalid English input is marked aria-invalid`, (await page.getByLabel('Title (English)').getAttribute('aria-invalid')) === 'true');
    await page.screenshot({ path: path.join(shots, `i18n-admin-event-400-${tag}.png`), fullPage: true });
    await page.unroute('**/api/admin/events/*');
    await page.getByRole('button', { name: 'Запази', exact: true }).click(); await page.waitForSelector('h1:has-text("Събития")'); await page.waitForTimeout(300);
    R.check(`AEV14[${tag}] after the mocked error is removed the same form saves (English edit persisted)`, (await admin.get('/api/admin/events')).data.events.find((e) => e.id === saved.id).titleEn === `Event ${uniq} changed`);

    // ---- menu: category + dish round trip
    await admin.put('/api/admin/menu/draft', { json: { categories: [] } });
    await goA(page, '#/menu'); await page.waitForSelector('h1:has-text("Основно меню")');
    await page.getByRole('button', { name: 'Добави категория' }).first().click();
    await page.locator('.a-cat__name input, input.a-input').first().fill(`Супи ${uniq}`);
    await page.getByRole('button', { name: 'Добави ястие' }).click();
    await page.getByLabel('Име на ястието').first().fill(`Чорба ${uniq}`);
    await page.getByLabel('Цена').first().fill('4,5');
    R.check(`AMN0[${tag}] menu: "Български"/"English" tabs (no per-item <details>); English fields are hidden while the BG tab shows`, (await tabA(page, 'English').count()) === 1 && (await page.locator('details.a-en').count()) === 0 && (await page.getByLabel('Dish name (English)').count()) === 0);
    await tabA(page, 'Български').focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
    R.check(`AMN1[${tag}] keyboard (ArrowRight) switches the whole editor (category + dish) to English`, (await tabA(page, 'English').getAttribute('aria-selected')) === 'true' && (await page.getByLabel('Име на категория на английски').count()) === 1 && (await page.getByLabel('Dish name (English)').count()) === 1);
    await page.getByLabel('Име на категория на английски').fill(`Soups ${uniq}`);
    await page.getByLabel('Dish name (English)').first().fill(`Soup ${uniq}`);
    await page.getByLabel('Description (English)').first().fill(`Hot soup ${uniq}`);
    R.check(`AMN2[${tag}] English dish inputs have an accessible label ("Dish name (English)", "Description (English)")`, (await page.getByLabel('Dish name (English)').first().evaluate((i) => i.labels.length)) === 1 && (await page.getByLabel('Description (English)').first().evaluate((i) => i.labels.length)) === 1);
    await page.getByRole('button', { name: 'Запази чернова' }).click(); await page.waitForTimeout(700);
    let d = (await admin.get('/api/admin/menu')).data;
    R.check(`AMN3[${tag}] draft saved with nameEn (category), nameEn + descriptionEn (dish); public not changed yet`, d.draft.categories[0].nameEn === `Soups ${uniq}` && d.draft.categories[0].items[0].nameEn === `Soup ${uniq}` && d.draft.categories[0].items[0].descriptionEn === `Hot soup ${uniq}` && (await anon.get('/api/public/menu?lang=en')).data.structured.categories[0].name !== `Soups ${uniq}`, JSON.stringify(d.draft.categories));
    await page.getByRole('button', { name: 'Публикувай', exact: true }).first().click(); await page.waitForSelector('dialog[open]'); await page.locator('dialog[open]').getByRole('button', { name: 'Публикувай' }).click(); await page.waitForTimeout(700);
    const pm = (await anon.get('/api/public/menu?lang=en')).data.structured.categories[0];
    R.check(`AMN4[${tag}] publish => public lang=en shows the English category/dish/description`, pm.name === `Soups ${uniq}` && pm.items[0].name === `Soup ${uniq}` && pm.items[0].description === `Hot soup ${uniq}`);
    // reload: round trip prefilled
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('h1:has-text("Основно меню")'); await page.waitForTimeout(400);
    await tabA(page, 'English').click();
    R.check(`AMN5[${tag}] after reload the English tab carries a dot and is prefilled`, (await tabA(page, 'English').locator('.a-tabdot:visible').count()) === 1 && (await page.getByLabel('Име на категория на английски').inputValue()) === `Soups ${uniq}` && (await page.getByLabel('Dish name (English)').first().inputValue()) === `Soup ${uniq}`);
    // En-only edit: dirty flag, guard
    await page.getByLabel('Description (English)').first().fill(`Hot soup ${uniq} v2`);
    R.check(`AMN6[${tag}] English-only edit shows "Незапазени промени" and enables "Запази чернова"`, (await page.getByText('Незапазени промени').first().isVisible()) && (await page.getByRole('button', { name: 'Запази чернова' }).isEnabled()));
    await goA(page, '#/settings'); await page.waitForTimeout(250);
    const dlg2 = (await page.locator('dialog[open]').count()) ? await page.locator('dialog[open]').textContent() : '';
    R.check(`AMN7[${tag}] English-only dish edit then navigate => unsaved-changes guard`, dlg2.toLowerCase().includes('имате незапазени промени'), dlg2);
    if (dlg2) await page.getByRole('button', { name: 'Остани' }).click();
    await page.waitForTimeout(200);
    // preview modal EN
    await page.getByRole('button', { name: 'Преглед', exact: true }).click(); await page.waitForSelector('dialog[open]');
    const pseg = page.locator('dialog[open] .a-seg[aria-label="Език на прегледа"]');
    await pseg.getByRole('button', { name: 'Преглед на английски' }).click(); await page.waitForTimeout(250);
    const pt = await page.locator('dialog[open] .preview-frame').textContent();
    R.check(`AMN8[${tag}] menu preview modal EN: English category + dish name + description (incl. the unsaved v2 text)`, pt.includes(`Soups ${uniq}`) && pt.includes(`Soup ${uniq}`) && pt.includes(`Hot soup ${uniq} v2`), pt.replace(/\n/g, '|'));
    R.check(`AMN8b[${tag}] menu preview modal EN: price in English format "€4.50" (preview renders EN UI conventions)`, /€4\.50/.test(pt), pt.replace(/\n/g, '|'));
    await pseg.getByRole('button', { name: 'Преглед на български' }).click(); await page.waitForTimeout(200);
    R.check(`AMN9[${tag}] menu preview modal BG: Bulgarian names again`, (await page.locator('dialog[open] .preview-frame').textContent()).includes(`Чорба ${uniq}`));
    await page.screenshot({ path: path.join(shots, `i18n-admin-menu-preview-${tag}.png`) });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    // server 400 on category/dish English fields (mocked response in the real server's shape) while the BG tab is shown
    await tabA(page, 'Български').click();
    await page.route('**/api/admin/menu/draft', (r) => r.request().method() === 'PUT' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'validation', message: 'Невалидни данни.', fields: { 'categories[0].nameEn': 'СЪРВЪР-КАТ-EN', 'categories[0].items[0].descriptionEn': 'СЪРВЪР-ЯСТИЕ-EN' } }) }) : r.continue());
    await page.getByRole('button', { name: 'Запази чернова' }).click(); await page.waitForTimeout(700);
    const mtxt = await page.locator('.a-cat .a-error:visible').allTextContents();
    R.check(`AMN10[${tag}] menu server 400 on category/dish English fields: English tab selected, inline errors visible (${mtxt.length})`, (await tabA(page, 'English').getAttribute('aria-selected')) === 'true' && mtxt.join('|').includes('СЪРВЪР-КАТ-EN') && mtxt.join('|').includes('СЪРВЪР-ЯСТИЕ-EN'), JSON.stringify(mtxt));
    await page.unroute('**/api/admin/menu/draft');
    await page.getByRole('button', { name: 'Запази чернова' }).click(); await page.waitForTimeout(700);
    await dismiss(page);

    // ---- settings round trip
    await goA(page, '#/settings'); await page.waitForSelector('h1:has-text("Настройки")'); await page.waitForTimeout(300);
    R.check(`AST0[${tag}] settings: English tab holds address + opening hours`, (await tabA(page, 'English').count()) === 1 && await (async () => { await tabA(page, 'English').click(); return (await page.getByLabel('Address (English)').isVisible()) && (await page.getByLabel('Opening hours (English)').isVisible()); })());
    await page.getByLabel('Address (English)').fill(`${uniq} Test Street 5`);
    await page.getByLabel('Opening hours (English)').fill('Mon-Sun 10:00-22:00\nKitchen closes at 21:30');
    await page.getByRole('button', { name: 'Запази', exact: true }).first().click(); await page.waitForTimeout(700);
    const st = (await admin.get('/api/admin/settings')).data;
    R.check(`AST1[${tag}] settings saved via UI: addressEn, openingHoursEn (multi-line)`, st.addressEn === `${uniq} Test Street 5` && st.openingHoursEn === 'Mon-Sun 10:00-22:00\nKitchen closes at 21:30', JSON.stringify(st));
    const ps = (await anon.get('/api/public/site?lang=en')).data;
    R.check(`AST2[${tag}] public site lang=en shows them; bg keeps Bulgarian address`, ps.address === `${uniq} Test Street 5` && ps.openingHours.startsWith('Mon-Sun') && (await anon.get('/api/public/site?lang=bg')).data.address !== `${uniq} Test Street 5`);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('h1:has-text("Настройки")'); await page.waitForTimeout(300);
    await tabA(page, 'English').click();
    R.check(`AST3[${tag}] reload: English tab carries a dot, values prefilled`, (await tabA(page, 'English').locator('.a-tabdot:visible').count()) === 1 && (await page.getByLabel('Address (English)').inputValue()) === `${uniq} Test Street 5`);
    await page.getByLabel('Address (English)').fill(`${uniq} Test Street 6`);
    await goA(page, '#/menu'); await page.waitForTimeout(250);
    const dlg3 = (await page.locator('dialog[open]').count()) ? await page.locator('dialog[open]').textContent() : '';
    R.check(`AST4[${tag}] English-only settings edit then navigate => unsaved-changes guard`, dlg3.toLowerCase().includes('имате незапазени промени'), dlg3);
    if (dlg3) await page.getByRole('button', { name: 'Остани' }).click();
    await page.waitForTimeout(150);
    await tabA(page, 'Български').click();
    await page.route('**/api/admin/settings', (r) => r.request().method() === 'PUT' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'validation', message: 'Невалидни данни.', fields: { addressEn: 'СЪРВЪР-АДРЕС-EN', openingHoursEn: 'СЪРВЪР-ЧАСОВЕ-EN' } }) }) : r.continue());
    await page.getByRole('button', { name: 'Запази', exact: true }).first().click(); await page.waitForTimeout(600);
    const stx = await page.locator('.a-langpanel[lang=en] .a-error:visible').allTextContents();
    R.check(`AST5[${tag}] settings server 400 on addressEn/openingHoursEn: English tab selected, inline errors visible`, (await tabA(page, 'English').getAttribute('aria-selected')) === 'true' && stx.join('|').includes('СЪРВЪР-АДРЕС-EN') && stx.join('|').includes('СЪРВЪР-ЧАСОВЕ-EN'), JSON.stringify(stx));
    await page.unroute('**/api/admin/settings');
    await page.getByRole('button', { name: 'Запази', exact: true }).first().click(); await page.waitForTimeout(600); await dismiss(page);

    // ---- layout with the English tab selected, admin stays Bulgarian
    for (const h of ['#/events/new', '#/menu', '#/settings']) {
      await goA(page, h); await page.waitForTimeout(300);
      if (await tabA(page, 'English').count()) await tabA(page, 'English').click();
      const hs = await noHScroll(page);
      R.check(`AL[${tag}] admin ${h} with the English tab selected: no horizontal scroll`, hs.ok, JSON.stringify(hs));
    }
    R.check(`AE-LOG[${tag}] admin English flows: no unexpected console/page errors or CSP violations (mocked 400s excluded)`, log.pageErrors.length === 0 && (await page.collectCsp()).length === 0 && log.console.filter((m) => !/status of (400|401)/.test(m)).length === 0 && log.failed.length === 0, await logEv(page, log));
    await context.close();
  });
}

// admin stays Bulgarian even with ?lang=en and kota_lang=en in storage
await step('ADM-BG', async () => {
  const { context, page } = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(base + '/?lang=en', { waitUntil: 'networkidle' });
  await page.goto(base + '/admin/?lang=en', { waitUntil: 'networkidle' });
  R.check('ADM1 admin with ?lang=en and kota_lang=en in storage stays Bulgarian (html lang=bg, login labels BG)', (await lang(page)) === 'bg' && (await page.getByLabel('Потребителско име').count()) === 1);
  await loginA(page);
  await goA(page, '#/events/new');
  R.check('ADM2 admin event form after login: Bulgarian UI, html lang=bg', (await lang(page)) === 'bg' && (await page.locator('h1').textContent()) === 'Ново събитие');
  await context.close();
});

// BUG-5 retest at three widths: toast vs Save button geometry, with 1 and 3 stacked persistent error toasts
for (const vp of ADM_VPS) {
  await step(`TOAST[${vp.name}]`, async () => {
    const { context, page } = await newPage(browser, { width: vp.width, height: vp.height });
    await loginA(page);
    const id = (await admin.get('/api/admin/events')).data.events[0].id;
    await goA(page, `#/events/${id}`); await page.waitForSelector('h1:has-text("Редактиране на събитие")'); await page.waitForTimeout(300);
    for (const n of [1, 3]) {
      await page.evaluate(() => { document.querySelector('.a-toasts')?.replaceChildren(); });
      await page.evaluate((k) => import('/admin/js/ui.js').then((m) => { for (let i = 0; i < k; i++) m.toast('Тестова грешка ' + (i + 1), { type: 'err' }); }), n);
      await page.waitForTimeout(250);
      const g = await page.evaluate(() => {
        const save = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Запази'); const sr = save.getBoundingClientRect();
        const hit = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
        const trs = [...document.querySelectorAll('.a-toast')].map((t) => t.getBoundingClientRect());
        const inter = trs.some((r) => r.left < sr.right && r.right > sr.left && r.top < sr.bottom && r.bottom > sr.top);
        return { save: [Math.round(sr.left), Math.round(sr.top), Math.round(sr.right), Math.round(sr.bottom)], toasts: trs.map((r) => [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]), hit: hit && (hit.closest('.a-toast') ? 'toast' : hit.closest('button') === save ? 'save' : hit.className), intersects: inter, bottomMost: Math.max(...trs.map((r) => r.bottom)) };
      });
      R.check(`TOAST-OVERLAP[${vp.name}] (BUG-5) ${n} persistent error toast(s): Save centre is hit-testable and the toast rectangles do not intersect the Save button`, g.hit === 'save' && !g.intersects, JSON.stringify(g));
    }
    await context.close();
  });
}

R.summary();
await browser.close();
await srv.stop();

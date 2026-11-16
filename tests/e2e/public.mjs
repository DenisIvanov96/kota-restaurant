// Public site end-to-end (Playwright) against a real server. Port 3201. Run: node tests/e2e/public.mjs
import fs from 'node:fs';
import path from 'node:path';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PDF, WEBP, reporter, SCRATCH } from '../lib/harness.mjs';
import { chromium, VIEWPORTS, newPage, noHScroll, shotDir } from '../lib/browser.mjs';

const R = reporter('public-e2e');
const PORT = 3201;
const T0 = '2026-06-15T10:00:00Z'; // 13:00 Sofia, Monday 15 June 2026
const dir = tmpDir('pubui'); createAdmin(dir);
let srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
let admin = new Client(srv.url); await admin.login();
const shots = shotDir();
const PNG = makePng(600, 400, [200, 120, 40]);
const XSS_TITLE = '<img src=x onerror="window.__xss=1">Evil';
const XSS_DESC = '<script>window.__xss=2</script><b>not bold</b>\nsecond line';
const XSS_DISH = '<svg onload=window.__xss=3>Dish</svg>';

async function restartAt(iso) { await srv.stop(); srv = await startServer({ port: PORT, dataDir: dir, now: iso }); admin = new Client(srv.url); await admin.login(); }
const ev = (f, img) => admin.post('/api/admin/events', { form: form(f, img && { field: 'image', buf: img, name: 'e.png', type: 'image/png' }) });
const dmenu = (date, pub, buf, name, type, extra) => admin.post('/api/admin/daily-menus', { form: form({ date, published: pub, ...extra }, { field: 'file', buf, name, type }) });

// ---------- seed ----------
await admin.put('/api/admin/settings', { json: { reservationPhone: '+359 88 123 4567', address: 'ул. Витоша 1, София', openingHours: 'Пн-Нд 10:00-22:00', currencySymbol: '€' } });
const e1 = (await ev({ title: 'Джаз вечер', description: 'Жива музика\nВход свободен', enabled: 'true', eventAt: '2026-06-20T20:00' }, PNG)).data;
const e2 = (await ev({ title: XSS_TITLE, description: XSS_DESC, enabled: 'true', eventAt: '2026-06-21T19:30' })).data;
const mk = (n, p, extra = {}) => ({ name: n, description: '', priceCents: p, available: true, ...extra });
await admin.put('/api/admin/menu/draft', { json: { categories: [
  { name: 'Салати', items: [mk('Шопска салата', 650, { description: 'домати, краставици, сирене' }), mk(XSS_DISH, 500), mk('Овчарска', 720)] },
  { name: 'Основни', items: Array.from({ length: 12 }, (_, i) => mk(`Ястие ${i + 1}`, 1000 + i * 50)).concat([mk('Изчерпано', 900, { available: false })]) },
  { name: 'Десерти', items: [mk('Баклава', 400), mk('Палачинка', 0)] },
] } });
await admin.post('/api/admin/menu/publish');
const dm = (await dmenu('2026-06-15', 'true', PNG, 'dnes.png', 'image/png')).data;

const browser = await chromium.launch();
const base = srv.url;

async function visit(page, p) { await page.goto(base + p, { waitUntil: 'networkidle' }); }
const txt = (page, sel) => page.locator(sel).allTextContents(); // textContent: CSS text-transform must not matter

// ---------- per viewport: rendering ----------
for (const vp of VIEWPORTS) {
  for (const tz of ['Europe/Sofia']) {
    const { context, page, log } = await newPage(browser, { width: vp.width, height: vp.height, timezoneId: tz });
    const tag = `${vp.name}`;
    // index
    await visit(page, '/');
    await page.waitForSelector('.event-card'); await page.waitForSelector('.dish');
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    R.check(`R1[${tag}] index: no console errors / page errors / CSP violations / failed requests`,
      log.console.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && (await page.collectCsp()).length === 0 && log.http4xx.length === 0,
      JSON.stringify({ c: log.console, p: log.pageErrors, f: log.failed, csp: await page.collectCsp(), h: log.http4xx }));
    const hs = await noHScroll(page); R.check(`R2[${tag}] index: no horizontal scroll`, hs.ok, JSON.stringify(hs));
    R.check(`R3[${tag}] index: one h1, lang=bg`, (await page.locator('h1').count()) === 1 && (await page.getAttribute('html', 'lang')) === 'bg');
    const xss = await page.evaluate(() => window.__xss);
    R.check(`X1[${tag}] index: XSS payloads (event title/desc, dish name) did not execute`, xss === undefined, `window.__xss=${xss}`);
    const titles = await txt(page, '.event-title');
    R.check(`X2[${tag}] index: XSS event title rendered as literal text, no injected <img src=x>/<script>/<b> in DOM`,
      titles.some((t) => t === XSS_TITLE) && (await page.locator('img[src="x"], .event-desc b, .event-card script, .dish svg').count()) === 0, JSON.stringify(titles));
    const desc = await txt(page, '.event-desc');
    R.check(`X3[${tag}] index: description is text, newline preserved by CSS`, desc.some((d) => d.includes('<script>window.__xss=2</script><b>not bold</b>')) && (await page.locator('.event-desc').first().evaluate((e) => getComputedStyle(e).whiteSpace)) === 'pre-line');
    R.check(`E1[${tag}] event banner: title, formatted Sofia date (without browser tz) and loaded image`,
      (await txt(page, '.event-card')).join('|').includes('Джаз вечер') && (await txt(page, '.event-date')).join('|').includes('събота, 20 юни 2026, 20:00') &&
      (await page.locator('.event-card img').first().evaluate((i) => i.naturalWidth)) > 0, (await txt(page, '.event-date')).join('|'));
    R.check(`M1[${tag}] structured menu: categories, price format "6,50 €", unavailable tag, zero price hidden`,
      (await page.locator('.cat').count()) === 3 && (await txt(page, '.dish-price')).some((p) => /^6,50\s€$/.test(p.replace(/ /g, ' '))) &&
      (await page.locator('.tag-unavail').count()) === 1 && (await page.locator('.dish:has-text("Палачинка") .dish-price').count()) === 0,
      (await txt(page, '.dish-price')).slice(0, 4).join(','));
    const tel = await page.getAttribute('#top-phone', 'href');
    R.check(`C1[${tag}] phone: top bar + contact tel: link well-formed`, tel === 'tel:+359881234567' && (await page.getAttribute('#contact-call', 'href')) === 'tel:+359881234567', tel);
    R.check(`C2[${tag}] address + hours rendered`, (await page.locator('#contact').innerText()).includes('ул. Витоша 1') && (await page.locator('#contact').innerText()).includes('10:00-22:00'));
    // all internal anchors resolve
    const anchors = await page.$$eval('a[href^="#"], a[href^="/#"]', (as) => as.map((a) => a.getAttribute('href')));
    const missing = [];
    for (const h of anchors) { const id = h.replace(/^\/?#/, ''); if (id && !(await page.locator(`[id="${id}"]`).count())) missing.push(h); }
    R.check(`N1[${tag}] every in-page anchor has a target`, missing.length === 0, missing.join());
    const ext = await page.$$eval('a[target=_blank]', (as) => as.filter((a) => !/noopener/.test(a.rel)).length);
    R.check(`S1[${tag}] target=_blank links have rel=noopener`, ext === 0);
    await page.screenshot({ path: path.join(shots, `public-index-${tag}.png`), fullPage: true });

    // sticky header: does it cover anchor targets / content when REALLY scrolling?
    const hdr = await page.locator('.site-header').evaluate((h) => ({ pos: getComputedStyle(h).position, h: h.getBoundingClientRect().height }));
    for (const id of ['menu', 'event', 'about', 'contact']) {
      await page.goto(`${base}/#${id}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const top = await page.locator(`#${id} h2`).first().evaluate((e) => e.getBoundingClientRect().top);
      const hb = await page.locator('.site-header').evaluate((h) => h.getBoundingClientRect().bottom);
      const bar = await page.locator('.top-bar').evaluate((h) => { const r = h.getBoundingClientRect(); return { pos: getComputedStyle(h).position, bottom: r.bottom }; }).catch(() => null);
      R.check(`H1[${tag}] #${id} heading is below the sticky header after anchor jump (header ${hdr.pos} ${Math.round(hdr.h)}px)`, top >= hb - 1, `h2.top=${Math.round(top)} header.bottom=${Math.round(hb)}`);
    }
    // category chips: jump to category must not hide title under header + chips
    if ((await page.locator('.cat-nav a').count()) >= 2) {
      await visit(page, '/'); await page.locator('.cat-nav a').nth(2).click(); await page.waitForTimeout(600);
      const info = await page.evaluate(() => {
        const t = document.querySelectorAll('.cat-title')[2].getBoundingClientRect().top;
        const covers = [...document.querySelectorAll('.site-header,.cat-nav,.top-bar')].filter((e) => ['sticky', 'fixed'].includes(getComputedStyle(e).position)).map((e) => e.getBoundingClientRect().bottom);
        return { t, maxBottom: Math.max(0, ...covers) };
      });
      R.check(`H2[${tag}] category title not covered by sticky header/chip bar after chip click`, info.t >= info.maxBottom - 1, JSON.stringify(info));
    }
    // daily menu
    await visit(page, '/daily-menu');
    await page.waitForSelector('.viewer');
    R.check(`R1d[${tag}] /daily-menu: no console/page/CSP/failed-request errors`, log.console.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify({ c: log.console, p: log.pageErrors, f: log.failed }));
    R.check(`R2d[${tag}] /daily-menu: no horizontal scroll`, (await noHScroll(page)).ok);
    R.check(`D1[${tag}] daily date = assigned date "Понеделник, 15 юни 2026" + today tag + image loaded + alt`,
      (await page.locator('#daily-date').innerText()) === 'Понеделник, 15 юни 2026' && (await page.locator('#daily-tag').isVisible()) &&
      (await page.locator('.viewer img').evaluate((i) => i.naturalWidth)) > 0 && (await page.locator('.viewer img').getAttribute('alt')) === 'Обедно меню за понеделник, 15 юни 2026',
      await page.locator('#daily-date').innerText());
    R.check(`R3d[${tag}] /daily-menu: one h1`, (await page.locator('h1').count()) === 1);
    const top = await page.locator('h1').evaluate((e) => e.getBoundingClientRect().top); const hb = await page.locator('.site-header').evaluate((h) => h.getBoundingClientRect().bottom);
    R.check(`H3[${tag}] /daily-menu h1 not under header at load`, top >= hb - 1, `${top} vs ${hb}`);
    await page.screenshot({ path: path.join(shots, `public-daily-${tag}.png`), fullPage: true });
    // lightbox: click image opens dialog, Esc closes, focus returns
    await page.locator('.viewer .zoom-btn').click();
    const open = await page.locator('dialog[open]').count();
    await page.keyboard.press('Escape');
    R.check(`A1[${tag}] daily image lightbox opens and closes with Esc, focus returns to trigger`, open === 1 && (await page.locator('dialog[open]').count()) === 0 && (await page.evaluate(() => document.activeElement?.className)) === 'zoom-btn');
    await context.close();
  }
}

// ---------- public updates without reload of server ----------
{
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  await visit(page, '/');
  R.check('U1 event visible on rendered page', (await txt(page, '.event-title')).some((t) => t.includes('Джаз')));
  await admin.patch(`/api/admin/events/${e1.id}/enabled`, { json: { enabled: false } });
  await admin.patch(`/api/admin/events/${e2.id}/enabled`, { json: { enabled: false } });
  await visit(page, '/');
  R.check('U2 after DISABLE (no restart) event + banner + nav link gone from rendered page', (await page.locator('.event-card').count()) === 0 && (await page.locator('#event').count()) === 0 && !(await page.locator('#nav-event').isVisible()));
  await admin.patch(`/api/admin/events/${e1.id}/enabled`, { json: { enabled: true } });
  await admin.put(`/api/admin/events/${e1.id}`, { form: form({ title: 'Нов заглавие', description: 'Нов текст' }, { field: 'image', buf: makePng(300, 200, [0, 100, 250]), name: 'n.png', type: 'image/png' }) });
  await visit(page, '/');
  const src = await page.locator('.event-card img').first().getAttribute('src');
  R.check('U3 after enable + edit title/description/image: public page shows new content and new image loads', (await txt(page, '.event-title')).includes('Нов заглавие') && (await txt(page, '.event-desc')).includes('Нов текст') && (await page.locator('.event-card img').first().evaluate((i) => i.naturalWidth)) === 300, src);
  await admin.put(`/api/admin/events/${e1.id}`, { form: form({ removeImage: 'true' }) });
  await visit(page, '/');
  R.check('U4 removeImage => card renders without image', (await page.locator('.event-card img').count()) === 0 && (await page.locator('.event-card').count()) === 1);
  // no-event + no-menu states
  await admin.patch(`/api/admin/events/${e1.id}/enabled`, { json: { enabled: false } });
  await admin.put('/api/admin/settings', { json: { reservationPhone: '', address: '', openingHours: '' } });
  await visit(page, '/');
  R.check('U5 empty site info removes top bar, contact section and nav item (no empty shells)', (await page.locator('#top-bar').count()) === 0 && (await page.locator('#contact').count()) === 0 && (await page.locator('#nav-contact').count()) === 0);
  await context.close();
}

// ---------- daily menu states ----------
{
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  await admin.patch(`/api/admin/daily-menus/${dm.id}/published`, { json: { published: false } });
  await visit(page, '/daily-menu');
  R.check('D2 unpublished today => "Няма обедно меню за днес." message, no image/viewer, date still today', (await page.locator('.state-box').innerText()).includes('Няма обедно меню за днес') && (await page.locator('.viewer').count()) === 0 && (await page.locator('#daily-date').innerText()) === 'Понеделник, 15 юни 2026');
  await page.screenshot({ path: path.join(shots, 'public-daily-empty-390.png'), fullPage: true });
  await admin.patch(`/api/admin/daily-menus/${dm.id}/published`, { json: { published: true } });
  // tomorrow + PDF
  const tmr = (await dmenu('2026-06-16', 'true', PDF, 'utre.pdf', 'application/pdf')).data;
  await visit(page, '/daily-menu');
  R.check('D3 tomorrow published does NOT show early (today image still shown, no pdf card)', (await page.locator('.viewer-image').count()) === 1 && (await page.locator('.viewer-pdf').count()) === 0 && (await page.locator('#daily-date').innerText()) === 'Понеделник, 15 юни 2026');
  // replace today's file
  const old = await page.locator('.viewer img').getAttribute('src');
  await dmenu('2026-06-15', 'true', makePng(500, 500, [0, 150, 0]), 'zamen.png', 'image/png', { replace: 'true' });
  await visit(page, '/daily-menu');
  const nu = await page.locator('.viewer img').getAttribute('src');
  const oldStatus = (await fetch(base + old)).status;
  R.check('D4 replaced file: page shows new image (500px), old /media URL is 404', nu !== old && (await page.locator('.viewer img').evaluate((i) => i.naturalWidth)) === 500 && oldStatus === 404, `old=${oldStatus}`);
  await context.close();

  // ---- time travel: Sofia midnight, with a New York browser and a browser clock set far away ----
  await restartAt('2026-06-15T21:30:00Z'); // Sofia: 16 June 00:30 (Tuesday); New York: 15 June 17:30
  for (const tz of ['Europe/Sofia', 'America/New_York']) {
    const c2 = await newPage(browser, { width: 390, height: 844, timezoneId: tz });
    await c2.page.clock.setFixedTime(new Date('2030-01-01T00:00:00Z')); // browser clock is deliberately wrong
    await c2.page.goto(srv.url + '/daily-menu', { waitUntil: 'networkidle' });
    await c2.page.waitForSelector('.viewer');
    const date = await c2.page.locator('#daily-date').innerText();
    R.check(`T1[${tz}] after Sofia midnight page shows tomorrow's menu (Вторник, 16 юни 2026), PDF card, independent of browser tz/clock`, date === 'Вторник, 16 юни 2026' && (await c2.page.locator('.viewer-pdf').count()) === 1, date);
    await c2.page.screenshot({ path: path.join(shots, `public-daily-midnight-${tz.replace('/', '_')}.png`) });
    const link = c2.page.locator('.viewer-actions a').first();
    R.check(`T2[${tz}] PDF link opens in new tab with rel=noopener and points at /media`, (await link.getAttribute('target')) === '_blank' && /noopener/.test(await link.getAttribute('rel')) && /^\/media\/[a-f0-9]{32}\.pdf$/.test(await link.getAttribute('href')));
    await c2.context.close();
  }
  // yesterday's menu (15th) is not shown as today's once the 16th has none
  await admin.patch(`/api/admin/daily-menus/${tmr.id}/published`, { json: { published: false } });
  const c3 = await newPage(browser, { width: 390, height: 844, timezoneId: 'America/New_York' });
  await c3.page.goto(srv.url + '/daily-menu', { waitUntil: 'networkidle' });
  R.check('T3 yesterday\'s published menu is not presented as today\'s => no-menu message with date 16 юни', (await c3.page.locator('.state-box').innerText()).includes('Няма обедно меню') && (await c3.page.locator('#daily-date').innerText()) === 'Вторник, 16 юни 2026');
  await c3.context.close();
}

// ---------- event expiry / future on rendered page ----------
{
  await restartAt('2026-06-15T10:00:00Z');
  const exp = (await ev({ title: 'Изтича', enabled: 'true', expiresAt: '2026-06-15T15:00' })).data;
  const fut = (await ev({ title: 'Бъдещо', enabled: 'true', startsAt: '2026-06-15T18:00' })).data;
  const { context, page } = await newPage(browser, { width: 1280, height: 800, timezoneId: 'America/New_York' });
  await visit(page, '/');
  let t = await txt(page, '.event-title');
  R.check('V1 [10:00Z] expiring event visible, future event not yet', t.includes('Изтича') && !t.includes('Бъдещо'), t.join());
  await restartAt('2026-06-15T13:00:00Z'); // 16:00 Sofia: expired; future still not (starts 18:00 = 15:00Z)
  await visit(page, '/'); t = await txt(page, '.event-title');
  R.check('V2 [13:00Z] expired event auto-disappeared from rendered page (no admin action); future not yet', !t.includes('Изтича') && !t.includes('Бъдещо'), t.join());
  await restartAt('2026-06-15T15:00:00Z');
  await visit(page, '/'); t = await txt(page, '.event-title');
  R.check('V3 [15:00Z] future event appears on rendered page once its start time passes', t.includes('Бъдещо'), t.join());
  void exp; void fut;
  await context.close();
}

// ---------- file-mode menu + PDF menu ----------
{
  const { context, page, log } = await newPage(browser, { width: 390, height: 844 });
  const f = (await admin.post('/api/admin/menu/files', { form: form({}, { field: 'file', buf: makePng(800, 1100, [90, 90, 160]), name: 'menu.png', type: 'image/png' }) })).data;
  await admin.patch(`/api/admin/menu/files/${f.id}/published`, { json: { published: true } });
  await visit(page, '/');
  R.check('F0 file uploaded+published but mode still structured => structured menu shown', (await page.locator('.cat').count()) === 3 && (await page.locator('.menu-file').count()) === 0);
  await admin.put('/api/admin/menu/mode', { json: { mode: 'file' } });
  await visit(page, '/');
  R.check('F1 mode=file: image menu shown, structured categories gone (only one version public); alt text', (await page.locator('.menu-file img').count()) === 1 && (await page.locator('.cat').count()) === 0 && (await page.locator('.menu-file img').getAttribute('alt')) === 'Основно меню' && (await page.locator('.menu-file img').evaluate((i) => i.naturalWidth)) === 800);
  const pdf = (await admin.post('/api/admin/menu/files', { form: form({}, { field: 'file', buf: PDF, name: 'menu.pdf', type: 'application/pdf' }) })).data;
  await admin.patch(`/api/admin/menu/files/${pdf.id}/published`, { json: { published: true } });
  await visit(page, '/');
  R.check('F2 PDF menu: open/download links, card fallback visible at 390 (embed not rendered in headless)', (await page.locator('.viewer-pdf').count()) === 1 && (await page.locator('.viewer-pdf a[target=_blank]').count()) === 1 && (await page.locator('.pdf-card').isVisible()));
  R.check('F3 file-mode page: no console errors', log.console.length === 0 && log.pageErrors.length === 0, JSON.stringify(log.console));
  await admin.put('/api/admin/menu/mode', { json: { mode: 'structured' } });
  await context.close();
}

await browser.close();
await srv.stop();
fs.rmSync(dir, { recursive: true, force: true });
R.summary();
fs.writeFileSync(path.join(SCRATCH, 'public-e2e-results.json'), JSON.stringify(R.results, null, 1));

// Accessibility sample: keyboard focus visibility, contrast from computed styles, headings, dialog Esc. Port 3203.
import fs from 'node:fs';
import path from 'node:path';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PASSWORD, reporter, SCRATCH } from '../lib/harness.mjs';
import { chromium, newPage, contrast, colorsOf, shotDir } from '../lib/browser.mjs';

const R = reporter('a11y');
const dir = tmpDir('a11y'); createAdmin(dir);
const srv = await startServer({ port: 3203, dataDir: dir, now: '2026-06-15T10:00:00Z' });
const api = new Client(srv.url); await api.login();
await api.put('/api/admin/settings', { json: { reservationPhone: '+359 88 1', address: 'Sofia', openingHours: '10-22' } });
await api.post('/api/admin/events', { form: form({ title: 'Event', description: 'Desc', enabled: 'true', eventAt: '2026-06-20T20:00' }, { field: 'image', buf: makePng(50, 30), name: 'a.png', type: 'image/png' }) });
await api.put('/api/admin/menu/draft', { json: { categories: [{ name: 'Cat', items: [{ name: 'Dish', description: 'desc', priceCents: 500, available: true }, { name: 'Gone', description: '', priceCents: 100, available: false }] }, { name: 'Cat2', items: [{ name: 'D2', description: '', priceCents: 100, available: true }] }] } });
await api.post('/api/admin/menu/publish');
const browser = await chromium.launch();
const shots = shotDir();

/** Tab through the page and report focused elements that have no visible indicator. */
async function focusAudit(page, max = 40) {
  const bad = []; const seen = new Set();
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const e = document.activeElement; if (!e || e === document.body) return null;
      const cs = getComputedStyle(e);
      const sw = e.closest('.a-switch') || e;
      const cs2 = getComputedStyle(sw);
      const track = e.querySelector && e.querySelector('.a-switch__track'); const ts = track ? getComputedStyle(track) : null;
      const vis = (c) => (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || (c.boxShadow && c.boxShadow !== 'none');
      const rect = e.getBoundingClientRect();
      // T-35: position is part of the identity (the daily-menu wizard now has two identical "Избери файл" buttons: BG and EN)
      const tag = `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${(e.className || '').toString().split(' ')[0]}|${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 25)}@${Math.round(rect.x)},${Math.round(rect.y)}`;
      return { tag, visible: vis(cs) || vis(cs2) || (ts && vis(ts)), w: rect.width, h: rect.height };
    });
    if (!r) continue;
    if (seen.has(r.tag)) break; seen.add(r.tag);
    if (!r.visible) bad.push(r.tag);
  }
  return { count: seen.size, bad };
}

// ---- public: focus, headings, nav toggle keyboard
{
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(srv.url + '/', { waitUntil: 'networkidle' });
  const fa = await focusAudit(page, 30);
  R.check('A1 public index (390): every keyboard-focused control has a visible focus indicator', fa.bad.length === 0 && fa.count > 5, `${fa.count} stops, bad=${fa.bad.join('; ')}`);
  const heads = await page.$$eval('h1,h2,h3,h4', (e) => e.map((x) => +x.tagName[1]));
  let ok = heads[0] === 1; for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i - 1] > 1) ok = false;
  R.check('A2 public index heading order has no skipped levels', ok, heads.join(''));
  const imgs = await page.$$eval('img', (i) => i.filter((x) => x.getAttribute('alt') === null).length);
  R.check('A3 all public images have alt', imgs === 0);
  await page.locator('#nav-toggle').focus(); await page.keyboard.press('Enter');
  const open = await page.getAttribute('#nav-toggle', 'aria-expanded'); await page.keyboard.press('Escape');
  R.check('A4 mobile nav toggle: Enter opens (aria-expanded=true), Esc closes and returns focus', open === 'true' && (await page.getAttribute('#nav-toggle', 'aria-expanded')) === 'false' && (await page.evaluate(() => document.activeElement.id)) === 'nav-toggle');
  R.check('A5 skip link is first tab stop and targets #main', (await (async () => { await page.goto(srv.url + '/'); await page.keyboard.press('Tab'); return page.evaluate(() => document.activeElement.getAttribute('href')); })()) === '#main');
  // contrast (public, dark theme)
  await page.goto(srv.url + '/', { waitUntil: 'networkidle' });
  const pairs = [['body text', 'body'], ['section h2', '#menu-heading'], ['dish name', '.dish-name'], ['dish price', '.dish-price'], ['dish desc', '.dish-desc'], ['event date', '.event-date'], ['event desc', '.event-desc'], ['event tag', '.event-tag'], ['top bar link', '#top-phone'], ['contact dt', '.contact-item dt'], ['footer', '.site-footer p'], ['btn primary', '.btn-special'], ['tag unavail', '.tag-unavail'], ['cat chip', '.cat-nav a'], ['tagline', '.tagline'], ['lead', '.lead']];
  for (const [name, sel] of pairs) {
    if (!(await page.locator(sel).count())) { R.results.push({ id: `K[public] ${name}`, status: 'NOT RUN', evidence: 'element absent' }); console.log(`NOT RUN contrast public ${name}`); continue; }
    const c = await colorsOf(page, sel); const ratio = contrast(c.fg, c.bg);
    const large = parseFloat(c.size) >= 24 || (parseFloat(c.size) >= 18.66 && +c.weight >= 700);
    R.check(`K[public] ${name}: ${ratio.toFixed(2)}:1 (${c.fg} on ${c.bg}, ${c.size}/${c.weight}) needs ${large ? 3 : 4.5}`, ratio >= (large ? 3 : 4.5));
  }
  await context.close();
}
// ---- daily page contrast ----
{
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(srv.url + '/daily-menu', { waitUntil: 'networkidle' });
  for (const [name, sel] of [['daily date', '#daily-date'], ['state title', '.state-title'], ['eyebrow h1', 'h1'], ['state-box text', '.state-box p:nth-of-type(2)']]) {
    if (!(await page.locator(sel).count())) continue;
    const c = await colorsOf(page, sel); const ratio = contrast(c.fg, c.bg); R.check(`K[daily] ${name}: ${ratio.toFixed(2)}:1 (${c.fg} on ${c.bg}, ${c.size})`, ratio >= 4.5 || (ratio >= 3 && parseFloat(c.size) >= 24));
  }
  await context.close();
}
// ---- admin ----
{
  const { context, page } = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(srv.url + '/admin/', { waitUntil: 'networkidle' });
  await page.getByLabel('Потребителско име').fill('owner'); await page.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  const lc = await colorsOf(page, 'button[type=submit]'); R.check(`K[admin] login button ${contrast(lc.fg, lc.bg).toFixed(2)}:1`, contrast(lc.fg, lc.bg) >= 4.5, `${lc.fg} on ${lc.bg}`);
  await page.getByRole('button', { name: 'Вход' }).click(); await page.waitForSelector('.a-nav');
  for (const hash of ['#/events', '#/menu', '#/daily-menu', '#/settings', '#/']) {
    await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(500);
    const fa = await focusAudit(page, 45);
    R.check(`A6 admin ${hash} (1280): focus indicator visible on all ${fa.count} tab stops`, fa.bad.length === 0 && fa.count > 3, `bad=${fa.bad.join('; ')}`);
  }
  await page.evaluate(() => { location.hash = '#/events'; }); await page.waitForSelector('article');
  for (const [name, sel] of [['badge active', '.a-badge'], ['help text', '.a-help'], ['event title', '.a-event__title'], ['primary btn', '.a-btn--primary'], ['secondary btn', '.a-btn--secondary'], ['ghost-danger', '.a-btn--ghost-danger'], ['switch text', '.a-switch__text'], ['nav link', '.a-nav__link'], ['seg btn', '.a-seg__btn']]) {
    if (!(await page.locator(sel).count())) continue;
    const c = await colorsOf(page, sel); const ratio = contrast(c.fg, c.bg);
    R.check(`K[admin] ${name}: ${ratio.toFixed(2)}:1 (${c.fg} on ${c.bg}, ${c.size}/${c.weight})`, ratio >= 4.5 || (ratio >= 3 && parseFloat(c.size) >= 18.66 && +c.weight >= 700));
  }
  const bad = await page.$$eval('button, a.a-btn, [role=switch]', (els) => els.filter((e) => e.offsetParent && (e.getBoundingClientRect().height < 40)).map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 25) + ':' + Math.round(e.getBoundingClientRect().height)));
  R.check('A7 admin events page: interactive controls >= 40px tall (design says 48)', bad.length === 0, bad.join(', '));
  // labelled form controls + html lang + title
  R.check('A8 admin html lang=bg and non-empty <title>', (await page.getAttribute('html', 'lang')) === 'bg' && (await page.title()).length > 3, await page.title());
  // dialog Esc on menu preview
  await page.evaluate(() => { location.hash = '#/menu'; }); await page.waitForSelector('.a-cat');
  await page.getByRole('button', { name: 'Преглед' }).first().click(); await page.waitForSelector('dialog[open]');
  await page.keyboard.press('Escape');
  R.check('A9 menu preview dialog closes with Esc', (await page.locator('dialog[open]').count()) === 0);
  // 200% zoom-equivalent: viewport 640 wide ~ 200% of 1280; text-size scaling via font-size is out of scope
  await page.setViewportSize({ width: 320, height: 640 });
  for (const hash of ['#/events/new', '#/menu', '#/daily-menu', '#/settings']) { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(400); const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); R.check(`A10 admin ${hash} at 320px (reflow / 400% zoom equivalent): no horizontal scroll`, w[0] <= w[1], w.join('/')); }
  await page.goto(srv.url + '/', { waitUntil: 'networkidle' }); { const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); R.check('A10b public index at 320px: no horizontal scroll', w[0] <= w[1], w.join('/')); }
  await context.close();
}
await browser.close(); await srv.stop(); fs.rmSync(dir, { recursive: true, force: true });
R.summary(); fs.writeFileSync(path.join(SCRATCH, 'a11y-results.json'), JSON.stringify(R.results, null, 1));

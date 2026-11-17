// T-51 BUG-22 retest: header nav at 768-959 px must fit (no horizontal scroll, EN/BG switch inside the viewport), BG/EN, with and without an enabled event;
// 960/1280 must be unchanged versus the pre-fix commit (set BASE_DIR to an extracted `git archive cdcd451` tree with node_modules symlinked; skipped when unset);
// same-page nav clicks must still smooth-scroll and land below the bar; BUG-21 admin "Виж на сайта" link lands on the About heading below the bar.
// Ports 3201 (no event), 3202 (event), 3203 (baseline, event), 3204 (admin). Run: node --disable-warning=ExperimentalWarning tests/e2e/bug22.mjs
import { startServer, createAdmin, Client, tmpDir, reporter, form, makePng, PASSWORD } from '../lib/harness.mjs';
import { chromium, newPage } from '../lib/browser.mjs';

const R = reporter('bug22');
const settings = { reservationPhone: '+359 88 123 4567', address: 'ул. Витоша 1, София', addressEn: '1 Vitosha St, Sofia', openingHours: 'Пн-Нд 10:00-22:00' };
async function boot(name, port, withEvent, env) {
  const dir = tmpDir(name); createAdmin(dir);
  const srv = await startServer({ port, dataDir: dir, now: '2026-06-15T10:00:00Z', env });
  const api = new Client(srv.url); await api.login();
  await api.put('/api/admin/settings', { json: settings });
  if (withEvent) await api.post('/api/admin/events', { form: form({ title: 'Събитие', description: 'Описание', titleEn: 'Event', descriptionEn: 'Desc', enabled: 'true', eventAt: '2026-06-20T20:00' }, { field: 'image', buf: makePng(50, 30), name: 'a.png', type: 'image/png' }) });
  return srv;
}
const srvNo = await boot('b22-no', 3201, false);
const srvEv = await boot('b22-ev', 3202, true);
const browser = await chromium.launch();
const probe = (page) => page.evaluate(() => {
  const lang = document.querySelector('.lang-switch'); const en = document.querySelector('.lang-btn[data-lang="en"]'); const hd = document.querySelector('header');
  const nav = [...document.querySelectorAll('#site-nav li')].filter((l) => !l.hidden && getComputedStyle(l).display !== 'none');
  const a = document.querySelector('#site-nav a'); const cs = getComputedStyle(a); const ul = getComputedStyle(document.querySelector('#site-nav ul'));
  const r = (n) => n.getBoundingClientRect();
  return { sw: document.documentElement.scrollWidth, iw: innerWidth, enR: Math.round(r(en).right * 10) / 10, langR: Math.round(r(lang).right * 10) / 10, hdH: Math.round(r(hd).height), items: nav.length, navTog: getComputedStyle(document.getElementById('nav-toggle')).display, fs: cs.fontSize, ls: cs.letterSpacing, gap: ul.columnGap, rects: nav.map((l) => { const b = r(l); return [Math.round(b.left), Math.round(b.width)].join(':'); }).join(',') };
});
const lbl = (e) => `${e ? 'event' : 'no-event'}`;
for (const [srv, ev] of [[srvNo, false], [srvEv, true]]) for (const lang of ['bg', 'en']) for (const w of [768, 800, 850, 900, 959]) {
  const { context, page } = await newPage(browser, { width: w, height: 1024, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
  await page.goto(`${srv.url}/${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  const p = await probe(page);
  R.check(`B22[${lang} ${w} ${lbl(ev)}] no horizontal scroll (sw ${p.sw} <= ${p.iw}), EN button right ${p.enR} <= ${p.iw}, desktop nav shown`, p.sw <= p.iw && p.enR <= p.iw && p.navTog === 'none' && (!ev || p.items >= 7), JSON.stringify(p));
  await context.close();
}
// other pages that share the header (BG, worst case = longest labels), 768 and 959
for (const pg of ['/gallery', '/daily-menu', '/reservation', '/privacy']) for (const w of [768, 959]) {
  const { context, page } = await newPage(browser, { width: w, height: 1024 });
  await page.goto(srvEv.url + pg, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
  const p = await probe(page);
  R.check(`B22p[bg ${w} ${pg}] no horizontal scroll, EN button inside`, p.sw <= p.iw && p.enR <= p.iw, JSON.stringify(p));
  await context.close();
}
// nav hits keyboard/touch size? at least: each nav link stays one line (header height unchanged across items) and links do not overlap
for (const lang of ['bg', 'en']) for (const w of [768, 959]) {
  const { context, page } = await newPage(browser, { width: w, height: 1024, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
  await page.goto(`${srvEv.url}/${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
  const o = await page.evaluate(() => { const rs = [...document.querySelectorAll('#site-nav li:not([hidden]) a')].map((a) => a.getBoundingClientRect()); let ov = 0; for (let i = 1; i < rs.length; i++) if (rs[i].left < rs[i - 1].right - 0.5) ov++; const lines = [...document.querySelectorAll('#site-nav li:not([hidden]) a')].map((a) => Math.round(a.getBoundingClientRect().height)); const lsw = document.querySelector('.lang-switch').getBoundingClientRect(); const last = rs[rs.length - 1]; return { ov, heights: lines.join(','), gapToLang: Math.round(lsw.left - last.right) }; });
  R.check(`B22o[${lang} ${w}] nav links do not overlap each other or the language switch`, o.ov === 0 && o.gapToLang >= 0, JSON.stringify(o));
  await context.close();
}

// 960 / 1280 unchanged against the pre-fix tree
if (process.env.BASE_DIR) {
  const baseDir = tmpDir('b22-base'); createAdmin(baseDir, 'owner', PASSWORD);
  const bsrv = await startServer({ port: 3203, dataDir: baseDir, now: '2026-06-15T10:00:00Z', env: {}, cwd: process.env.BASE_DIR });
  globalThis.__bsrv = bsrv;
  const bapi = new Client(bsrv.url); await bapi.login(); await bapi.put('/api/admin/settings', { json: settings });
  await bapi.post('/api/admin/events', { form: form({ title: 'Събитие', description: 'Описание', titleEn: 'Event', descriptionEn: 'Desc', enabled: 'true', eventAt: '2026-06-20T20:00' }, { field: 'image', buf: makePng(50, 30), name: 'a.png', type: 'image/png' }) });
  for (const lang of ['bg', 'en']) for (const w of [960, 1024, 1280]) {
    const run = async (srv) => { const { context, page } = await newPage(browser, { width: w, height: 800, locale: lang === 'en' ? 'en-US' : 'bg-BG' }); await page.goto(`${srv.url}/${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(400); const p = await probe(page); await context.close(); return p; };
    const a = await run(srvEv), b = await run(bsrv);
    R.check(`B22u[${lang} ${w}] header identical to pre-fix cdcd451 (font ${a.fs}, spacing ${a.ls}, gap ${a.gap}, link boxes, header h ${a.hdH}) and no h-scroll`, JSON.stringify(a) === JSON.stringify(b) && a.sw <= a.iw, JSON.stringify({ now: a, base: b }));
  }
  // and the pre-fix tree really had the defect at 768 BG + event (proves the comparison tree/probe is meaningful)
  { const { context, page } = await newPage(browser, { width: 768, height: 1024 }); await page.goto(bsrv.url + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(400); const p = await probe(page); await context.close(); R.check(`B22b[baseline cdcd451 768 bg event] reproduces the defect (probe sanity): sw ${p.sw} > ${p.iw}`, p.sw > p.iw, JSON.stringify(p)); }
} else R.check('B22u skipped: BASE_DIR not set', true, 'NOT RUN');

// same-page nav clicks still smooth-scroll and land below the bar (1280, 900, 768; BG/EN; with event)
for (const w of [1280, 900, 768]) for (const lang of ['bg', 'en']) {
  const { context, page } = await newPage(browser, { width: w, height: 800, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
  await page.goto(`${srvEv.url}/${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  for (const id of ['location', 'contact', 'event', 'menu']) {
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await page.waitForTimeout(150);
    const before = await page.evaluate(() => scrollY);
    await page.locator(`#site-nav a[href*="#${id}"]`).first().click();
    await page.waitForTimeout(90); const mid = await page.evaluate(() => scrollY);
    await page.waitForTimeout(1200);
    const m = await page.evaluate((id) => ({ h2: Math.round(document.querySelector(`#${id} h2`).getBoundingClientRect().top), bar: document.getElementById('top-bar').getBoundingClientRect().bottom, sy: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight, hash: location.hash, inView: document.querySelector(`#${id} h2`).getBoundingClientRect().top < innerHeight }), id);
    const smooth = mid > before && mid < m.sy - 5;
    R.check(`B22s[${lang} ${w} #${id}] same-page click smooth-scrolls (before ${before}, +90ms ${Math.round(mid)}, final ${m.sy}) and lands heading below the bar (${m.h2} >= ${m.bar})`, m.hash === `#${id}` && m.h2 >= m.bar - 1 && m.inView && (smooth || m.sy < 150 || id === 'menu' && m.sy < 150), JSON.stringify({ ...m, before, mid }));
  }
  await context.close();
}

// BUG-21: the admin "Виж на сайта" link (opens /#about in a new tab)
const srvAd = await boot('b22-ad', 3204, false);
for (const [w, h] of [[1280, 800], [768, 1024], [390, 844]]) {
  const { context, page } = await newPage(browser, { width: w, height: h });
  await page.goto(srvAd.url + '/admin/', { waitUntil: 'networkidle' });
  await page.getByLabel('Потребителско име').fill('owner'); await page.getByLabel('Парола', { exact: true }).fill(PASSWORD); await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('h1:has-text("Табло")');
  await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForSelector('h2:has-text("Текст „За нас“")');
  const link = page.getByRole('link', { name: /Виж на сайта/ });
  const [pop] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await pop.waitForLoadState('networkidle'); await pop.waitForTimeout(1800);
  const m = await pop.evaluate(() => ({ url: location.pathname + location.hash, h2: Math.round(document.querySelector('#about h2').getBoundingClientRect().top), bar: document.getElementById('top-bar').getBoundingClientRect().bottom, sy: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight, ih: innerHeight }));
  R.check(`B21a[${w}x${h}] admin "Виж на сайта" opens /#about with the heading below the bar (${m.h2} >= ${m.bar}, < ${m.ih})`, m.url === '/#about' && m.h2 >= m.bar - 1 && m.h2 < m.ih, JSON.stringify(m));
  await context.close();
}
await browser.close(); await srvNo.stop(); await srvEv.stop(); await srvAd.stop();
if (globalThis.__bsrv) await globalThis.__bsrv.stop();
R.summary();

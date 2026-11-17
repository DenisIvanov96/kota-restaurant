// T-50 BUG-19 retest: nav "Меню", "Локация", "Контакти" must land with the section heading below the sticky top bar.
// Content = the BUG-19 repro (phone, address, hours, no events), 390/768/1280 (+ extra heights), BG/EN, both on first load and after a language toggle.
// Port 3201. Run: node --disable-warning=ExperimentalWarning tests/e2e/bug19.mjs
import fs from 'node:fs';
import { startServer, createAdmin, Client, tmpDir, reporter } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll } from '../lib/browser.mjs';

const R = reporter('bug19');
const dir = tmpDir('bug19'); createAdmin(dir);
const srv = await startServer({ port: 3201, dataDir: dir, now: '2026-06-15T10:00:00Z' });
const api = new Client(srv.url); await api.login();
await api.put('/api/admin/settings', { json: { reservationPhone: '+359 88 123 4567', address: 'ул. Витоша 1, София', addressEn: '1 Vitosha St, Sofia', openingHours: 'Пн-Нд 10:00-22:00' } });
const browser = await chromium.launch();
const SECTIONS = [['menu', 'Меню', 'Menu', '#menu-heading, #menu h2'], ['location', 'Локация', 'Location', '#location h2'], ['contact', 'Контакти', 'Contact', '#contact h2']];
const sizes = [[390, 844], [768, 1024], [1280, 800], [390, 700], [390, 900], [360, 740], [414, 896], [820, 1180]];
for (const [w, h] of sizes) for (const lang of ['bg', 'en']) for (const [id, bgL, enL, hsel] of SECTIONS) {
  const { context, page } = await newPage(browser, { width: w, height: h, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
  try {
    await page.goto(`${srv.url}/${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300); // BG = plain '/' as a real visitor (a '?lang=bg' URL makes the '/#x' nav links a cross-document navigation)
    if (w < 700) await page.locator('#nav-toggle').click();
    await page.locator(`#site-nav a[href*="#${id}"]`).click(); await page.waitForTimeout(700);
    const tp = await page.evaluate(([hsel, id]) => { const t = document.querySelector(hsel).getBoundingClientRect().top; const sec = document.getElementById(id).getBoundingClientRect().top; return { h2: Math.round(t * 10) / 10, sec: Math.round(sec * 10) / 10, bar: document.getElementById('top-bar').getBoundingClientRect().bottom, hash: location.hash, sy: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight, inView: t < innerHeight }; }, [hsel, id]);
    R.check(`B19[${lang} ${w}x${h}] nav "${lang === 'en' ? enL : bgL}" -> heading below the sticky bar (top ${tp.h2} >= bar ${tp.bar})`, tp.hash === `#${id}` && tp.h2 >= tp.bar - 1 && tp.inView, JSON.stringify(tp));
    R.check(`B19h[${lang} ${w}x${h} ${id}] no horizontal scroll`, (await noHScroll(page)).ok);
  } catch (e) { R.fail(`B19[${lang} ${w}x${h} ${id}]`, String(e.message).split('\n')[0]); }
  await context.close();
}

// ---- BUG-21 (found in T-50): the same links followed from another page, and direct loads of /#section (default smooth scrolling)
const meas = (page, id) => page.evaluate((id) => ({ h2: Math.round(document.querySelector(`#${id} h2`).getBoundingClientRect().top), bar: document.getElementById('top-bar').getBoundingClientRect().bottom, sy: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight }), id);
for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) {
  for (const lang of ['bg', 'en']) for (const from of ['/gallery', '/daily-menu', '/reservation', '/privacy']) for (const id of ['menu', 'location', 'contact']) {
    const { context, page } = await newPage(browser, { width: w, height: h, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
    try {
      await page.goto(`${srv.url}${from}${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
      if (w < 700) await page.locator('#nav-toggle').click();
      await page.locator(`#site-nav a[href*="#${id}"]`).first().click(); await page.waitForURL((u) => u.pathname === '/'); await page.waitForTimeout(1500);
      const m = await meas(page, id);
      R.check(`B21x[${lang} ${w}x${h}] from ${from} nav -> #${id}: heading visible below the bar (top ${m.h2} >= ${m.bar}, < ${h})`, m.h2 >= m.bar - 1 && m.h2 < h, JSON.stringify(m));
    } catch (e) { R.fail(`B21x[${lang} ${w}x${h} ${from} ${id}]`, String(e.message).split('\n')[0]); }
    await context.close();
  }
  for (const id of ['menu', 'about', 'location', 'contact']) for (const lang of ['bg', 'en']) {
    const { context, page } = await newPage(browser, { width: w, height: h, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
    await page.goto(`${srv.url}/${lang === 'en' ? '?lang=en' : ''}#${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const m = await meas(page, id);
    R.check(`B21d[${lang} ${w}x${h}] direct load /#${id}: heading visible below the bar (top ${m.h2} >= ${m.bar}, < ${h})`, m.h2 >= m.bar - 1 && m.h2 < h, JSON.stringify(m));
    await context.close();
  }
}
// page does not gain a large blank gap at the bottom on desktop (scroll room is only added when needed)
for (const [w, h] of [[1280, 800], [390, 844]]) {
  const { context, page } = await newPage(browser, { width: w, height: h });
  await page.goto(srv.url + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  const pb = await page.evaluate(() => ({ pb: document.getElementById('main').style.paddingBottom, f: Math.round(document.querySelector('footer').getBoundingClientRect().bottom + scrollY), sh: document.documentElement.scrollHeight }));
  R.check(`B19p[${w}x${h}] report main bottom padding added for scroll room: "${pb.pb || 0}" (page height ${pb.sh})`, pb.sh >= pb.f - 2);
  await context.close();
}
await browser.close(); await srv.stop(); fs.rmSync(dir, { recursive: true, force: true });
R.summary();

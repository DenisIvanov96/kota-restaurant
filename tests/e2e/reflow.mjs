// Header reflow at 320/340/360 (BUG-9, WCAG 1.4.10) on / and /daily-menu in BG and EN, plus render lang override (BUG-10). Port 3205.
import { startServer, createAdmin, tmpDir, reporter } from '../lib/harness.mjs';
import { chromium, newPage } from '../lib/browser.mjs';

const R = reporter('reflow');
const dir = tmpDir('reflow'); createAdmin(dir);
const srv = await startServer({ port: 3205, dataDir: dir, now: '2026-06-15T10:00:00Z' });
const browser = await chromium.launch();
const ORDER = ['a.logo', 'a.btn-special-sm', '.lang-btn[data-lang=bg]', '.lang-btn[data-lang=en]', 'button.nav-toggle'];

try {
  for (const route of ['/', '/daily-menu']) for (const lang of ['bg', 'en']) for (const w of [320, 340, 360]) {
    const id = `${route}?lang=${lang} @${w}`;
    const { context, page, log } = await newPage(browser, { width: w, height: 640 });
    await page.goto(`${srv.url}${route}?lang=${lang}`, { waitUntil: 'networkidle' });
    const sc = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    R.check(`RF-scroll ${id}: no horizontal scroll`, sc[0] <= sc[1], sc.join('/'));
    const m = await page.evaluate((sels) => sels.map((s) => {
      const e = document.querySelector('.site-header ' + s); if (!e) return { s, missing: true };
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      return { s, l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0, inView: r.left >= 0 && r.right <= innerWidth, hit: !!top && (e === top || e.contains(top)) };
    }), ORDER);
    const bad = m.filter((x) => x.missing || !x.shown || !x.inView || !x.hit);
    R.check(`RF-visible ${id}: all 5 header controls rendered, inside viewport, hit-testable`, bad.length === 0, JSON.stringify(m.map((x) => `${x.s.split('.').pop()}:${x.l}-${x.r}@y${x.t}`)));
    const small = m.filter((x) => x.h < 44 || (x.s !== 'a.logo' && x.w < 44));
    R.check(`RF-target44 ${id}: each header control >=44 CSS px (height; width for icon/lang buttons)`, small.length === 0, JSON.stringify(m.map((x) => `${x.s.split('.').pop()}:${x.w}x${x.h}`)));
    // focus order
    await page.evaluate(() => document.body.focus());
    const seq = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(() => { const e = document.activeElement; return e.matches('a.skip-link') ? 'skip-link' : e.matches('a.logo') ? 'logo' : e.matches('a.btn-special-sm') ? 'pill' : e.dataset?.lang ? e.dataset.lang : e.matches('button.nav-toggle') ? 'toggle' : (e.className || e.tagName); })); }
    R.check(`RF-focus ${id}: tab order skip-link > logo > pill > БГ > EN > hamburger`, seq.join('>') === 'skip-link>logo>pill>bg>en>toggle', seq.join('>'));
    // visual order: row-major positions follow DOM order
    const after = (a, b) => b.l >= a.r - 1 || b.t >= a.t + a.h - 1; // next control is to the right on the same row, or on a lower row
    R.check(`RF-visual-order ${id}: visual reading order (same row left-to-right, then next row) equals DOM order`, m.every((x, i) => i === 0 || after(m[i - 1], x)), m.map((x) => `${x.l}-${x.r}@y${x.t}`).join(' '));
    // menu opens without overflow
    await page.locator('button.nav-toggle').click();
    const sc2 = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.getElementById('nav-toggle').getAttribute('aria-expanded'), [...document.querySelectorAll('#site-nav a')].filter((a) => a.offsetParent).map((a) => a.textContent.trim()).join('/')]);
    R.check(`RF-navopen ${id}: nav opens (aria-expanded=true, links visible) and no horizontal scroll`, sc2[0] <= sc2[1] && sc2[2] === 'true' && sc2[3].split('/').length >= 2, sc2.join(' '));
    R.check(`RF-console ${id}: no console/page errors or failed requests`, !log.console.length && !log.pageErrors.length && !log.failed.length, JSON.stringify([log.console, log.pageErrors, log.failed]));
    await context.close();
  }
  // BUG-10: shared renderers take an explicit language independent of the page language (page = bg)
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(`${srv.url}/?lang=bg`, { waitUntil: 'networkidle' });
  const out = await page.evaluate(async () => {
    const r = await import('/js/render.js');
    const ev = (l) => { const c = r.renderEventCard({ title: 'T', description: 'D', eventAt: '2026-06-20T20:00' }, l); return c.textContent; };
    const dish = (l) => r.renderDish({ name: 'N', description: '', priceCents: 450, available: false }, '€', l).textContent;
    const menu = (l) => r.renderStructuredMenu({ categories: [{ id: 'a', name: 'A', items: [] }, { id: 'b', name: 'B', items: [] }] }, '€', 'x-', l).nav.getAttribute('aria-label');
    return { htmlLang: document.documentElement.lang, evEn: ev('en'), evBg: ev('bg'), evDef: ev(), dishEn: dish('en'), dishBg: dish('bg'), menuEn: menu('en'), menuBg: menu('bg') };
  });
  R.check('RL1 renderEventCard(...,"en") on a BG page: English tag, English date, no Bulgarian', /Event/.test(out.evEn) && /Saturday, 20 June 2026, 20:00/.test(out.evEn) && !/[А-Яа-я]/.test(out.evEn), JSON.stringify(out));
  R.check('RL2 renderEventCard(...,"bg") and default (page lang bg): Bulgarian date/tag', /20 юни 2026, 20:00/.test(out.evBg) && out.evBg === out.evDef && /Събитие/.test(out.evBg), out.evBg);
  R.check('RL3 renderDish(...,"en"): "€4.50" + English unavailable tag; "bg": "4,50 €"', out.dishEn.includes('€4.50') && !/[А-Яа-я]/.test(out.dishEn) && /4,50\s€/.test(out.dishBg), `${out.dishEn} | ${out.dishBg}`);
  R.check('RL4 renderStructuredMenu(...,"en") category nav aria-label is English, "bg" Bulgarian', !/[А-Яа-я]/.test(out.menuEn) && /[А-Яа-я]/.test(out.menuBg), `${out.menuEn} | ${out.menuBg}`);
  await context.close();
} finally { await browser.close(); await srv.stop(); R.summary(); }

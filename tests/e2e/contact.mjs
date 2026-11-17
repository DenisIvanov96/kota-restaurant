// T-46 (D-50) Contacts: "Социални мрежи" / "Social media" item with the Instagram icon beside the phone; no icon in the
// reservation-button row; footer icon unchanged. 390/768/1280, BG+EN, phone set/unset, IG URL configured/default/invalid.
// Port 3201. Run: node --disable-warning=ExperimentalWarning tests/e2e/contact.mjs
import fs from 'node:fs';
import path from 'node:path';
import { startServer, createAdmin, Client, tmpDir, reporter, SCRATCH } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir, contrast, colorsOf, VIEWPORTS } from '../lib/browser.mjs';

const R = reporter('contact-e2e');
const shots = shotDir();
const dir = tmpDir('contact'); createAdmin(dir);
const srv = await startServer({ port: 3201, dataDir: dir, now: '2026-06-15T10:00:00Z' });
const api = new Client(srv.url); await api.login();
const IG = 'https://www.instagram.com/kota1_restaurant/';
const PHONE = '+359 88 123 4567';
const DEFAULT_IG = 'https://www.instagram.com/';
const set = (o) => api.put('/api/admin/settings', { json: o });
const browser = await chromium.launch();
const VPS = [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1280', width: 1280, height: 800 }];
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.stack || e.message).split('\n').slice(0, 5).join(' | ')); } };

const probe = (page) => page.evaluate(() => {
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
  const soc = document.getElementById('contact-social'); const ph = document.getElementById('contact-phone-item');
  const ig = soc && soc.querySelector('a.ig-link'); const row = document.querySelector('#contact .contact-actions'); const call = document.getElementById('contact-call');
  const kids = [...document.getElementById('contact-list').children];
  return {
    socText: soc ? soc.querySelector('dt').textContent.trim() : null,
    socVisible: !!soc && soc.getBoundingClientRect().height > 0,
    dlHidden: getComputedStyle(document.getElementById('contact-list')).display === 'none',
    ig: ig && { href: ig.getAttribute('href'), abs: ig.href, aria: ig.getAttribute('aria-label'), rel: ig.getAttribute('rel'), target: ig.getAttribute('target'), svgHidden: ig.querySelector('svg').getAttribute('aria-hidden'), hasText: ig.textContent.trim() },
    igBox: box(ig), socBox: box(soc), phBox: box(ph), phoneItems: document.querySelectorAll('#contact-phone-item').length, socItems: document.querySelectorAll('#contact-social').length,
    order: kids.map((k) => k.id), phoneText: ph ? ph.textContent : null, phoneHref: ph ? ph.querySelector('a').getAttribute('href') : null,
    rowIcons: row ? row.querySelectorAll('.ig-link, svg, a[href*=instagram]').length : -1, rowChildren: row ? [...row.children].map((c) => c.id || c.className) : [], callHidden: call ? call.hidden : null,
    footer: [...document.querySelectorAll('footer a.ig-link')].map((a) => ({ href: a.getAttribute('href'), aria: a.getAttribute('aria-label'), rel: a.getAttribute('rel'), target: a.getAttribute('target') })),
    allIg: [...document.querySelectorAll('a.ig-link')].map((a) => (a.closest('footer') ? 'footer' : a.closest('#contact') ? 'contact' : 'other')),
    h1: document.querySelectorAll('h1').length, htmlLang: document.documentElement.lang,
  };
});

// ---- configured phone + Instagram URL ----
await set({ reservationPhone: PHONE, instagramUrl: IG, address: 'ул. Тест 1' });
for (const lang of ['bg', 'en']) {
  for (const vp of VPS) {
    await step(`C[${lang} ${vp.name}]`, async () => {
      const c = await newPage(browser, { width: vp.width, height: vp.height, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
      const { page, log, context } = c;
      await page.goto(`${srv.url}/?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForSelector('#contact-phone-item'); await page.waitForTimeout(300);
      const s = await probe(page);
      const tag = `${lang} ${vp.name}`;
      R.check(`SOC1[${tag}] Contacts has exactly one "${lang === 'en' ? 'Social media' : 'Социални мрежи'}" item, visible, and the dl is displayed`, s.socItems === 1 && s.socText === (lang === 'en' ? 'Social media' : 'Социални мрежи') && s.socVisible && !s.dlHidden, JSON.stringify({ t: s.socText, n: s.socItems, v: s.socVisible }));
      R.check(`SOC2[${tag}] icon link: aria-label "Instagram", target=_blank rel contains noopener, href = configured URL, svg aria-hidden, no visible text`, s.ig && s.ig.aria === 'Instagram' && s.ig.target === '_blank' && /noopener/.test(s.ig.rel) && s.ig.abs === IG && s.ig.svgHidden === 'true' && s.ig.hasText === '', JSON.stringify(s.ig));
      R.check(`SOC3[${tag}] phone item first, then social item (DOM order), phone label/number/tel: link intact`, s.order.join() === 'contact-phone-item,contact-social' && s.phoneText.includes(PHONE) && s.phoneHref === 'tel:+359881234567' && s.phoneText.includes(lang === 'en' ? 'Phone' : 'Телефон'), JSON.stringify({ o: s.order, p: s.phoneText, h: s.phoneHref }));
      const sameRow = Math.abs(s.socBox.t - s.phBox.t) < 8; const below = s.socBox.t >= s.phBox.b - 1 && Math.abs(s.socBox.l - s.phBox.l) < 2;
      if (vp.width >= 768) R.check(`SOC4[${tag}] icon item is BESIDE the phone (same row, to its right)`, sameRow && s.socBox.l >= s.phBox.r - 1, JSON.stringify({ ph: s.phBox, soc: s.socBox }));
      else R.check(`SOC4[${tag}] at 390 the item WRAPS BELOW the phone (same left edge, starts below it)`, below && !sameRow, JSON.stringify({ ph: s.phBox, soc: s.socBox }));
      R.check(`SOC5[${tag}] reservation-button row has NO Instagram icon/svg/link and contains only the call button`, s.rowIcons === 0 && s.rowChildren.join() === 'contact-call' && s.callHidden === false, JSON.stringify({ n: s.rowIcons, kids: s.rowChildren }));
      R.check(`SOC6[${tag}] Instagram icons on the page: exactly one in #contact and one in the footer; footer icon unchanged (aria Instagram, noopener, _blank, configured URL)`, s.allIg.sort().join() === 'contact,footer' && s.footer.length === 1 && s.footer[0].aria === 'Instagram' && s.footer[0].target === '_blank' && /noopener/.test(s.footer[0].rel) && s.footer[0].href === IG, JSON.stringify({ all: s.allIg, f: s.footer }));
      R.check(`SOC7[${tag}] no horizontal scroll; one h1; icon target >= 44x44`, (await noHScroll(page)).ok && s.h1 === 1 && s.igBox.w >= 44 && s.igBox.h >= 44, JSON.stringify({ h: await noHScroll(page), box: s.igBox }));
      // contrast (computed): label text >= 4.5, phone link >= 4.5, icon (graphical object) >= 3
      const dt = await colorsOf(page, '#contact-social dt'); const pl = await colorsOf(page, '#contact-phone-item a'); const ic = await colorsOf(page, '#contact-social a.ig-link');
      const cr = { dt: contrast(dt.fg, dt.bg), phone: contrast(pl.fg, pl.bg), icon: contrast(ic.fg, ic.bg) };
      R.check(`SOC8[${tag}] computed contrast: "Социални мрежи" label >= 4.5, phone link >= 4.5, Instagram icon >= 3 (non-text)`, cr.dt >= 4.5 && cr.phone >= 4.5 && cr.icon >= 3, JSON.stringify({ cr, dt, pl, ic }));
      // keyboard: focus visible on the icon, Tab order phone -> icon -> call button
      await page.focus('#contact-phone-item a'); await page.keyboard.press('Tab');
      const f = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { id: a.className, cls: a.classList.contains('ig-link'), inContact: !!a.closest('#contact-social'), o: cs.outlineStyle, w: parseFloat(cs.outlineWidth), sh: cs.boxShadow }; });
      R.check(`SOC9[${tag}] keyboard: Tab from the phone link lands on the Instagram icon, which shows a visible focus indicator`, f.cls && f.inContact && ((f.o !== 'none' && f.w >= 2) || f.sh !== 'none'), JSON.stringify(f));
      await page.keyboard.press('Tab');
      R.check(`SOC10[${tag}] next Tab stop is the reservation button (#contact-call)`, (await page.evaluate(() => document.activeElement.id)) === 'contact-call');
      // click opens Instagram in a new tab (network stubbed - no external traffic)
      await context.route('https://www.instagram.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>ig</title>' }));
      const [pop] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), page.locator('#contact-social a.ig-link').click()]);
      R.check(`SOC11[${tag}] clicking the icon opens ${IG} in a new tab; opener is not exposed (noopener)`, !!pop && pop.url() === IG && (await pop.evaluate(() => window.opener)) === null, pop ? pop.url() : 'no popup');
      if (pop) await pop.close();
      R.check(`SOC12[${tag}] no console errors / page errors / failed requests / CSP violations`, log.console.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify({ c: log.console, f: log.failed }));
      await page.screenshot({ path: path.join(shots, `contact-${lang}-${vp.name}.png`) }).catch(() => {});
      await page.locator('#contact').screenshot({ path: path.join(shots, `contact-section-${lang}-${vp.name}.png`) });
      await context.close();
    });
  }
}

// ---- language switch in place: no duplicated phone item, labels switch ----
await step('SW', async () => {
  const { page, context, log } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(srv.url + '/', { waitUntil: 'networkidle' }); await page.waitForSelector('#contact-phone-item');
  for (let i = 0; i < 6; i++) { await page.locator(`.lang-btn[data-lang="${i % 2 ? 'bg' : 'en'}"]`).click(); await page.waitForTimeout(80); }
  await page.waitForTimeout(600);
  let s = await probe(page);
  R.check('SW1 after 6 rapid BG<->EN toggles (ends BG): exactly one phone item, one social item, labels Bulgarian, order phone,social, 1 icon in #contact', s.phoneItems === 1 && s.socItems === 1 && s.socText === 'Социални мрежи' && s.order.join() === 'contact-phone-item,contact-social' && s.allIg.filter((x) => x === 'contact').length === 1 && s.phoneText.includes('Телефон'), JSON.stringify({ p: s.phoneItems, s: s.socItems, t: s.socText, o: s.order }));
  await page.locator('.lang-btn[data-lang="en"]').click(); await page.waitForTimeout(500); s = await probe(page);
  R.check('SW2 BG->EN without reload: "Social media" + "Phone", still one of each, icon href kept', s.socText === 'Social media' && s.phoneText.includes('Phone') && s.phoneItems === 1 && s.ig.abs === IG, JSON.stringify(s.socText));
  R.check('SW3 no console/page errors during toggling', log.console.length === 0 && log.pageErrors.length === 0, JSON.stringify(log.console));
  await context.close();
});

// ---- no phone: social item stays, call button hidden, dl visible ----
await step('NP', async () => {
  await set({ reservationPhone: '' });
  for (const vp of VPS) for (const lang of ['bg', 'en']) {
    const { page, context, log } = await newPage(browser, { width: vp.width, height: vp.height });
    await page.goto(`${srv.url}/?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForSelector('#contact-social'); await page.waitForTimeout(300);
    const s = await probe(page);
    R.check(`NP1[${lang} ${vp.name}] no phone: no phone item, social item still shown with icon (href configured), call button hidden, row has no icon, no h-scroll`, s.phoneItems === 0 && s.socVisible && !s.dlHidden && s.ig.abs === IG && s.callHidden === true && s.rowIcons === 0 && (await noHScroll(page)).ok && log.console.length === 0, JSON.stringify({ p: s.phoneItems, v: s.socVisible, ig: s.ig && s.ig.abs, call: s.callHidden }));
    await context.close();
  }
});

// ---- Instagram URL variants ----
await step('IGV', async () => {
  await set({ reservationPhone: PHONE });
  const cases = [['empty -> default instagram.com', '', DEFAULT_IG], ['javascript: rejected by the server or falls back', 'javascript:alert(1)', null], ['non-instagram https host falls back', 'https://evil.example/x', null], ['http (not https) falls back', 'http://www.instagram.com/x/', null]];
  for (const [label, val, want] of cases) {
    const r = await set({ instagramUrl: val });
    const { page, context } = await newPage(browser, { width: 390, height: 844 });
    await page.goto(srv.url + '/', { waitUntil: 'networkidle' }); await page.waitForSelector('#contact-social'); const s = await probe(page);
    const hrefs = [s.ig.abs, ...s.footer.map((f) => f.href)];
    R.check(`IGV[${label}] settings API ${r.status}; every Instagram icon (contact + footer) links to ${want || DEFAULT_IG + ' (never the bad value)'}`, hrefs.every((h) => h === DEFAULT_IG) && (want === null ? !/evil|javascript|http:\/\/www/.test(hrefs.join()) : true), JSON.stringify({ st: r.status, hrefs }));
    await context.close();
  }
  await set({ instagramUrl: IG });
});

await browser.close(); await srv.stop();
fs.rmSync(dir, { recursive: true, force: true });
R.summary();
fs.writeFileSync(path.join(SCRATCH, 'contact-e2e-results.json'), JSON.stringify(R.results, null, 1));

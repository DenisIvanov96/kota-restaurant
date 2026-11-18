// T-59: quick check for D-59 (map pin), D-60 (About interior photo) and D-61 (company line with VAT) on the home page.
// Run: node tests/e2e/about-photo.mjs   (port 3209)
import { startServer, createAdmin, tmpDir, reporter } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir } from '../lib/browser.mjs';
import path from 'node:path';

const R = reporter('about-photo');
const shots = shotDir();
const dir = tmpDir('about-photo'); createAdmin(dir);
const srv = await startServer({ port: 3209, dataDir: dir, now: '2026-06-15T10:00:00Z' });
const browser = await chromium.launch();
const MAP = 'https://maps.app.goo.gl/EQuhsMqma6TcmRqs9';
const VAT = { bg: 'ИН по ДДС: BG207469415', en: 'VAT No.: BG207469415' };
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.message).split('\n').slice(0, 3).join(' ')); } };

for (const w of [390, 768, 1280]) for (const lang of ['bg', 'en']) {
  const id = `${lang} ${w}`; const h = w === 390 ? 844 : w === 768 ? 1024 : 800;
  await step(`AP[${id}]`, async () => {
    const { context, page, log } = await newPage(browser, { width: w, height: h });
    await page.goto(srv.url + '/' + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' });
    await page.locator('#about .about-photo').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const i = document.querySelector('#about .about-photo img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(250);
    const d = await page.evaluate(() => {
      const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top + scrollY, b: r.bottom + scrollY, w: r.width, h: r.height }; };
      const img = document.querySelector('#about .about-photo img'); const c = document.querySelector('#about .about-text .about-company');
      const cb = c && box(c); const ib = box(img); const cs = c && getComputedStyle(c);
      const overlap = c ? !(cb.r <= ib.l + 0.5 || cb.l >= ib.r - 0.5 || cb.b <= ib.t + 0.5 || cb.t >= ib.b - 0.5) : null;
      return { text: c?.textContent.trim(), cb, ib, overlap, vis: !!c && cb.h > 0 && cs.visibility !== 'hidden' && cs.display !== 'none', nw: img.naturalWidth, alt: img.getAttribute('alt'), src: img.currentSrc, cols: getComputedStyle(document.querySelector('.about-grid')).gridTemplateColumns };
    });
    R.check(`AP1[${id}] company line visible inside .about-text with VAT "${VAT[lang]}"; no overlap with the photo (company ${Math.round(d.cb?.t)}-${Math.round(d.cb?.b)}, photo ${Math.round(d.ib.t)}-${Math.round(d.ib.b)}; cols ${d.cols})`, d.vis && d.text.includes(VAT[lang]) && d.overlap === false && d.cb.l >= 0 && d.cb.r <= w, JSON.stringify(d));
    R.check(`AP2[${id}] interior img loaded (naturalWidth ${d.nw} > 0, ${d.src.split('/').pop()}) and has a non-empty alt in ${lang.toUpperCase()}: "${d.alt}"`, d.nw > 0 && /\/images\/interior-\d+\.webp$/.test(d.src) && !!d.alt && d.alt.trim().length > 5 && (lang === 'en' ? !/[Ѐ-ӿ]/.test(d.alt) : /[Ѐ-ӿ]/.test(d.alt)), d.alt);
    const nh = await noHScroll(page);
    R.check(`AP3[${id}] no horizontal scroll (${nh.sw}/${nh.iw})`, nh.ok);
    const m = await page.evaluate(() => [...document.querySelectorAll('a.map-link')].map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })));
    R.check(`AP4[${id}] map link -> ${MAP}, target=_blank, rel contains noopener`, m.length === 1 && m[0].href === MAP && m[0].target === '_blank' && m[0].rel.split(/\s+/).includes('noopener'), JSON.stringify(m));
    const csp = await page.collectCsp();
    R.check(`AP5[${id}] no console/page errors, failed requests or CSP violations`, log.console.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && csp.length === 0, JSON.stringify([log.console, log.pageErrors, log.failed, csp]));
    await page.locator('#about').screenshot({ path: path.join(shots, `about-photo-${lang}-${w}.png`) });
    await context.close();
  });
}
await browser.close(); await srv.stop?.();
R.summary();

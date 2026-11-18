// T-57 verification of T-56 / D-57: real floor plan (tables 102-115), company line on home About, privacy controller line.
// Run: node tests/e2e/plan.mjs   (port 3208)
import { startServer, createAdmin, tmpDir, reporter } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir } from '../lib/browser.mjs';
import path from 'node:path';

const R = reporter('plan');
const shots = shotDir();
const dir = tmpDir('plan'); createAdmin(dir);
const srv = await startServer({ port: 3208, dataDir: dir, now: '2026-06-15T10:00:00Z' });
const browser = await chromium.launch();
const NUMS = Array.from({ length: 14 }, (_, i) => String(102 + i));
const COMPANY = { bg: 'Амора Джелато ЕООД · ЕИК: 207469415 · Седалище: ул. Сребърна 2-Б, София', en: 'Амора Джелато ЕООД (Amora Dzhelato EOOD) · Company ID (EIK): 207469415 · Registered office: 2-B Srebarna St, Sofia' };
const CONTROLLER = { bg: 'Администратор на данните: Амора Джелато ЕООД, ЕИК: 207469415, седалище: ул. Сребърна 2-Б, София.', en: 'Data controller: Амора Джелато ЕООД (Amora Dzhelato EOOD), Company ID (EIK): 207469415, registered office: 2-B Srebarna St, Sofia.' };
const LEGEND = { bg: ['Квадратна маса', 'Дълга маса', 'Бар', 'Вход'], en: ['Square table', 'Long table', 'Bar', 'Entrance'] };
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.message).split('\n').slice(0, 3).join(' ')); } };
const clean = async (page, log) => log.console.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && (await page.collectCsp()).length === 0;

for (const w of [390, 768, 1280]) for (const lang of ['bg', 'en']) {
  const id = `${lang} ${w}`; const h = w === 390 ? 844 : w === 768 ? 1024 : 800;
  await step(`PL[${id}]`, async () => {
    const { context, page, log } = await newPage(browser, { width: w, height: h });
    await page.goto(srv.url + '/reservation' + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const svg = document.getElementById('plan-svg'); const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
      const tbls = [...svg.querySelectorAll('g.tbl')].map((g) => ({ n: g.querySelector('text').textContent.trim(), rect: box(g.querySelector('rect')), txt: box(g.querySelector('text')) }));
      const door = box(svg.querySelector('.plan-door')); const bar = box(svg.querySelector('.plan-bar')); const floor = box(svg.querySelector('.plan-floor'));
      return { tbls, door, bar, floor, others: svg.querySelectorAll('circle, .plan-window, ellipse').length, shapes: [...svg.children].filter((c) => /^(rect|circle|path)$/.test(c.tagName)).length,
        legend: [...document.querySelectorAll('#plan-legend li')].map((l) => l.textContent.trim()), list: [...document.querySelectorAll('#plan-tables li')].length, note: document.querySelector('.plan-note').textContent.trim(), svgR: svg.getBoundingClientRect().right };
    });
    // PL1 numbers inside their rects, only 14 tables
    const inside = m.tbls.every((t) => t.txt.l >= t.rect.l - 0.5 && t.txt.r <= t.rect.r + 0.5 && t.txt.t >= t.rect.t - 0.5 && t.txt.b <= t.rect.b + 0.5);
    R.check(`PL1[${id}] exactly 14 tables numbered 102..115, each number's text box lies inside its own rect; no round tables/windows`, m.tbls.map((t) => t.n).join() === NUMS.join() && inside && m.others === 0, JSON.stringify(m.tbls.filter((t) => !(t.txt.l >= t.rect.l - 0.5 && t.txt.r <= t.rect.r + 0.5 && t.txt.t >= t.rect.t - 0.5 && t.txt.b <= t.rect.b + 0.5)).map((t) => t.n)));
    // PL2 entrance on the left wall between 110 and 113 vertically
    const t = (n) => m.tbls.find((x) => x.n === n).rect;
    R.check(`PL2[${id}] entrance on the left wall (door.left within 6px of floor.left), vertically between table 110 (bottom ${Math.round(t('110').b)}) and 113 (top ${Math.round(t('113').t)}): door ${Math.round(m.door.t)}-${Math.round(m.door.b)}`,
      Math.abs(m.door.l - m.floor.l) <= 6 + w / 100 && m.door.cy > t('110').b && m.door.cy < t('113').t && m.door.t >= t('110').t && m.door.b <= t('113').b, JSON.stringify([m.door, m.floor.l]));
    // PL3 bar below 114, along the bottom
    R.check(`PL3[${id}] bar is below table 114 (bar.top ${Math.round(m.bar.t)} >= 114.bottom ${Math.round(t('114').b)}) and below every table, near the floor's bottom edge`, m.bar.t >= t('114').b - 0.5 && m.tbls.every((x) => x.rect.b <= m.bar.t + 0.5) && m.floor.b - m.bar.b < 30 * (m.floor.r - m.floor.l) / 440 && (m.bar.r - m.bar.l) > 0.8 * (m.floor.r - m.floor.l), JSON.stringify([m.bar, m.floor.b]));
    // PL4 legend / a11y list / caption
    R.check(`PL4[${id}] legend has 4 items (${LEGEND[lang].join('/')}); a11y list #plan-tables has 14 items; caption text`, JSON.stringify(m.legend) === JSON.stringify(LEGEND[lang]) && m.list === 14 && m.note === (lang === 'en' ? 'Mention the table number when you book by phone.' : 'Посочете номера на масата, когато резервирате по телефона.') && !/Примерна|Sample/.test(m.note), JSON.stringify([m.legend, m.list, m.note]));
    const nh = await noHScroll(page);
    R.check(`PL5[${id}] /reservation: no horizontal scroll (${nh.sw}/${nh.iw}), plan inside viewport, no console/page errors, failed requests or CSP violations`, nh.ok && m.svgR <= w && (await clean(page, log)), JSON.stringify(log.console.concat(log.pageErrors, log.failed, await page.collectCsp())));
    await page.screenshot({ path: path.join(shots, `plan-${lang}-${w}.png`), fullPage: true });
    await context.close();
  });

  await step(`HOME[${id}]`, async () => {
    const { context, page, log } = await newPage(browser, { width: w, height: h });
    await page.goto(srv.url + '/' + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
    const c = await page.evaluate(() => { const e = document.querySelector('#about .about-company'); const r = e.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(e).lineHeight); const sec = document.getElementById('about'); return { text: e.textContent.trim(), n: document.querySelectorAll('.about-company').length, inAbout: !!e, l: r.left, r: r.right, h: r.height, lh, disp: getComputedStyle(e).display, sw: document.documentElement.scrollWidth, iw: innerWidth, secHidden: sec.hidden, ow: getComputedStyle(e).overflowWrap }; });
    R.check(`CO1[${id}] home #about shows the fixed company line (${lang.toUpperCase()}) exactly once`, c.text === COMPANY[lang] && c.n === 1, c.text);
    const lines = Math.round(c.h / c.lh);
    R.check(`CO2[${id}] company line is inside the viewport (${Math.round(c.l)}-${Math.round(c.r)} of ${w}), no horizontal scroll (${c.sw}/${c.iw}), ${lines} line(s)${w === 390 ? ', wraps onto >= 2 lines at 390' : ''}`, c.l >= 0 && c.r <= w && c.sw <= c.iw && (w !== 390 || lines >= 2), JSON.stringify(c));
    R.check(`CO3[${id}] home: no console/page errors, failed requests or CSP violations`, await clean(page, log), JSON.stringify(log.console.concat(log.pageErrors, log.failed, await page.collectCsp())));
    if (w === 390) await page.locator('#about').screenshot({ path: path.join(shots, `plan-about-${lang}-390.png`) });
    await context.close();
  });

  await step(`PRIV[${id}]`, async () => {
    const { context, page, log } = await newPage(browser, { width: w, height: h });
    await page.goto(srv.url + '/privacy' + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
    const p = await page.evaluate(() => ({ text: document.querySelector('main').innerText, who: [...document.querySelectorAll('main p')].map((e) => e.textContent.trim()), ph: (document.querySelector('main').innerText.match(/\[[^\]]+\]/g) || []) }));
    R.check(`PV1[${id}] privacy controller line is the company details; no "[Юридическо лице" / "Legal entity" placeholder left`, p.who.includes(CONTROLLER[lang]) && !/\[Юридическо лице|Legal entity/.test(p.text), JSON.stringify(p.who.filter((x) => /Администратор|controller/.test(x))));
    R.check(`PV2[${id}] other placeholders unchanged ([N] and hosting provider still present: ${p.ph.join(' ')})`, /\[N\]/.test(p.text) && (lang === 'en' ? /\[Hosting provider\]/.test(p.text) : /\[Хостинг доставчик\]/.test(p.text)), JSON.stringify(p.ph));
    const nh = await noHScroll(page);
    R.check(`PV3[${id}] privacy: no horizontal scroll, no console/CSP errors`, nh.ok && (await clean(page, log)), JSON.stringify([nh, log.console, log.pageErrors, log.failed]));
    await context.close();
  });
}
await browser.close(); await srv.stop?.();
R.summary();

// T-68 (D-54): geometry of the aligned floor plan. Run: node tests/e2e/plan-grid.mjs  (port 3209)
import { startServer, createAdmin, tmpDir, reporter } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir } from '../lib/browser.mjs';
import path from 'node:path';
const R = reporter('plan-grid'); const shots = shotDir();
const dir = tmpDir('plangrid'); createAdmin(dir);
const srv = await startServer({ port: 3209, dataDir: dir, now: '2026-06-15T10:00:00Z' });
const browser = await chromium.launch();
for (const w of [390, 768, 1280]) {
  const { context, page, log } = await newPage(browser, { width: w, height: w === 390 ? 844 : w === 768 ? 1024 : 800 });
  await page.goto(srv.url + '/reservation', { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
  const m = await page.evaluate(() => {
    const svg = document.getElementById('plan-svg'); const bb = (e) => { const b = e.getBBox(); return { l: b.x, r: b.x + b.width, t: b.y, b: b.y + b.height }; };
    return {
      t: [...svg.querySelectorAll('g.tbl')].map((g) => ({ n: g.querySelector('text').textContent.trim(), r: bb(g.querySelector('rect')), x: bb(g.querySelector('text')), sw: parseFloat(getComputedStyle(g.querySelector('rect')).strokeWidth) || 0, ta: getComputedStyle(g.querySelector('text')).textAnchor, db: getComputedStyle(g.querySelector('text')).dominantBaseline })),
      floor: bb(svg.querySelector('.plan-floor')), bar: bb(svg.querySelector('.plan-bar')), door: bb(svg.querySelector('.plan-door')), swing: bb(svg.querySelector('.plan-swing')), label: bb(svg.querySelector('[data-i18n="res.entrance"]')),
      vis: (() => { const r = svg.getBoundingClientRect(); return r.width > 100 && r.height > 100 && getComputedStyle(svg).visibility !== 'hidden'; })(),
    };
  });
  const ov = (a, b, g = 0) => a.l < b.r + g && b.l < a.r + g && a.t < b.b + g && b.t < a.b + g;
  const pairs = []; for (let i = 0; i < m.t.length; i++) for (let j = i + 1; j < m.t.length; j++) if (ov(m.t[i].r, m.t[j].r)) pairs.push(m.t[i].n + '/' + m.t[j].n);
  R.check(`G1[${w}] no two tables overlap`, pairs.length === 0, pairs.join());
  const gap = []; for (let i = 0; i < m.t.length; i++) for (let j = i + 1; j < m.t.length; j++) if (ov(m.t[i].r, m.t[j].r, 6)) gap.push(m.t[i].n + '/' + m.t[j].n);
  R.check(`G1b[${w}] no two tables closer than 6 SVG units`, gap.length === 0, gap.join());
  const inF = m.t.filter((t) => !(t.r.l >= m.floor.l && t.r.r <= m.floor.r && t.r.t >= m.floor.t && t.r.b <= m.bar.t - 6));
  R.check(`G2[${w}] every table inside floor and >=6 units above bar`, inF.length === 0, inF.map((t) => t.n).join());
  const dl = m.t.filter((t) => ov(t.r, m.door) || ov(t.r, m.swing) || ov(t.r, m.label));
  R.check(`G3[${w}] no table overlaps door, swing arc or "Вход" label (bboxes)`, dl.length === 0, JSON.stringify([dl.map((t) => t.n), m.door, m.swing, m.label]));
  const bad = m.t.filter((t) => Math.abs((t.x.l + t.x.r) / 2 - (t.r.l + t.r.r) / 2) > 1 || Math.abs((t.x.t + t.x.b) / 2 - (t.r.t + t.r.b) / 2) > 2.5);
  R.check(`G4[${w}] number labels centred in rects (bbox centre within 1 / 2.5 units)`, bad.length === 0, JSON.stringify(bad.map((t) => [t.n, (t.x.l + t.x.r) / 2 - (t.r.l + t.r.r) / 2, (t.x.t + t.x.b) / 2 - (t.r.t + t.r.b) / 2])));
  const sq = ['104', '113', '114', '115']; const sh = m.t.every((t) => { const sqr = Math.abs((t.r.r - t.r.l) - (t.r.b - t.r.t)) < 1; return sq.includes(t.n) ? sqr : !sqr; });
  R.check(`G5[${w}] square: 104,113,114,115; others long`, sh);
  const cx = (n) => { const t = m.t.find((x) => x.n === n).r; return (t.l + t.r) / 2; }; const cy = (n) => { const t = m.t.find((x) => x.n === n).r; return (t.t + t.b) / 2; };
  const L = ['112', '111', '110'], M = ['106', '107', '108', '109'], Rt = ['105', '104', '103', '102'];
  const ordered = (a) => a.every((n, i) => i === 0 || cy(a[i - 1]) < cy(n));
  R.check(`G6[${w}] 3 columns, top-down order L 112,111,110 + 113,114; M 106-109 + 115; R 105..102`, ordered([...L, '113', '114']) && ordered(M) && ordered(Rt) && Math.max(cx('112'), cx('113'), cx('114')) < Math.min(...M.map(cx), cx('115')) && Math.max(...M.map(cx), cx('115')) < Math.min(...Rt.map(cx)) && cy('113') < cy('115') + 5 && cy('115') < cy('114'), '');
  const nh = await noHScroll(page);
  R.check(`G7[${w}] plan visible, no h-scroll (${nh.sw}/${nh.iw}), no console errors`, m.vis && nh.ok && log.console.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0, '');
  if (w === 1280) console.log(JSON.stringify(m.t.map((t) => [t.n, t.sw])), JSON.stringify([m.door, m.swing, m.label]));
  await page.locator('#plan-svg').screenshot({ path: path.join(shots, `plan-grid-${w}.png`) }); await context.close();
}
await browser.close(); await srv.stop?.(); R.summary();

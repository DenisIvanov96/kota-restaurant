// Design-fix verification D1..D11 (T-13). Port 3204. Run: node tests/e2e/design.mjs
import path from 'node:path';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PASSWORD, reporter } from '../lib/harness.mjs';
import { chromium, newPage, shotDir } from '../lib/browser.mjs';

const R = reporter('design-e2e');
const dir = tmpDir('design'); createAdmin(dir);
const srv = await startServer({ port: 3204, dataDir: dir, now: '2026-06-15T10:00:00Z' });
const base = srv.url; const api = new Client(base); await api.login();
const shots = shotDir();
const png = (w, h) => ({ field: 'image', buf: makePng(w, h, [30, 120, 160]), type: 'image/png', name: 'p.png' });
await api.post('/api/admin/events', { form: form({ title: 'Изтекло събитие с доста дълго заглавие за проверка на колоните', description: 'Опис', enabled: 'true', expiresAt: '2026-06-01T10:00' }, png(400, 250)) });
await api.post('/api/admin/events', { form: form({ title: 'Активно събитие', description: 'Жива музика', enabled: 'true', eventAt: '2026-06-20T20:00' }, png(400, 250)) });
await api.post('/api/admin/events', { form: form({ title: 'Второ активно', enabled: 'true' }) });
const cats = [['Салати', 6], ['Супи', 2], ['Основни ястия', 8], ['Десерти', 3], ['Напитки', 5]].map(([name, n]) => ({ name, items: Array.from({ length: n }, (_, i) => ({ name: `${name} ястие ${i + 1}`, description: 'Описание на ястието', priceCents: 500 + i * 50, available: true })) }));
await api.put('/api/admin/menu/draft', { json: { categories: cats } });
await api.post('/api/admin/menu/publish');

const browser = await chromium.launch();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.message).split('\n').slice(0, 3).join(' ')); } };
async function login(page) {
  await page.goto(base + '/admin/', { waitUntil: 'networkidle' });
  await page.getByLabel('Потребителско име').fill('owner');
  await page.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('h1:has-text("Табло")');
}
const go = async (page, h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(500); };

// D1
await step('D1', async () => {
  for (const [w, h] of [[768, 1024], [1024, 768], [1280, 800]]) {
    const { page, context } = await newPage(browser, { width: w, height: h }); await login(page); await go(page, '#/events');
    const m = await page.evaluate(() => { const a = [...document.querySelectorAll('article')].find((x) => x.textContent.includes('Изтекло събитие')); const t = a.querySelector('.a-event__title'); const b = a.querySelector('.a-badge'); const lh = parseFloat(getComputedStyle(b).lineHeight) || 20; const r = t.getBoundingClientRect(); return { titleW: r.width | 0, titleH: r.height | 0, badgeH: b.getBoundingClientRect().height | 0, badgeLH: lh, badgeW: b.getBoundingClientRect().width | 0, art: a.getBoundingClientRect().width | 0, overflow: document.documentElement.scrollWidth > innerWidth }; });
    R.check(`D1[${w}x${h}] expired row: title column >=200px wide, <=2 lines, badge on one line, no h-scroll`, m.titleW >= 200 && m.titleH <= 2 * 28 && m.badgeH < m.badgeLH * 1.9 && !m.overflow, JSON.stringify(m));
    await page.screenshot({ path: path.join(shots, `design-D1-${w}.png`) }); await context.close();
  }
});
// D2, D5, D8(admin), D9, D10
let N;
const A = await newPage(browser, { width: 1280, height: 800 }); await login(A.page);
await step('D2', async () => {
  const p = A.page; await go(p, '#/events/new'); await p.waitForSelector('.preview-frame');
  await p.locator('input.a-input').first().fill('Преглед'); await p.locator('textarea').first().fill('Опис');
  await p.locator('input[type=file]').first().setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: makePng(400, 250) }); await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Телефон' }).click(); await p.waitForTimeout(300);
  const ph = await p.evaluate(() => { const f = document.querySelector('.preview-frame'); const c = f.querySelector('.event-card'); return { frameW: f.getBoundingClientRect().width | 0, cols: getComputedStyle(c).gridTemplateColumns.split(' ').length, vw: innerWidth }; });
  R.check('D2a "Телефон" preview at 1280 viewport: frame <=390px and event card is single column', ph.frameW <= 392 && ph.cols === 1, JSON.stringify(ph));
  await p.getByRole('button', { name: 'Компютър' }).click(); await p.waitForTimeout(300);
  const dk = await p.evaluate(() => { const f = document.querySelector('.preview-frame'); const c = f.querySelector('.event-card'); const sc = f.closest('.preview-scroll'); return { frameW: f.getBoundingClientRect().width | 0, cols: getComputedStyle(c).gridTemplateColumns.split(' ').length, scrollable: sc.scrollWidth > sc.clientWidth, cardW: c.getBoundingClientRect().width | 0 }; });
  R.check('D2b "Компютър" preview is not squeezed: frame 960px wide (scrolls horizontally if needed), event card two columns', dk.frameW >= 900 && dk.cols === 2, JSON.stringify(dk));
  await p.screenshot({ path: path.join(shots, 'design-D2-desktop-preview.png'), fullPage: true });
  // D10 spacing above "Включено"
  const sp = await p.evaluate(() => { const l = [...document.querySelectorAll('.a-label')].find((x) => x.textContent.trim() === 'Включено'); const prev = document.querySelector('.a-tznote'); return { gap: (l.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) | 0 }; });
  const mb = await p.evaluate(() => getComputedStyle(document.querySelector('.a-tznote')).marginBottom);
  R.check('D10 >=16px between "Всички часове са по българско време." and "Включено"', sp.gap >= 16, JSON.stringify({ ...sp, tznoteMarginBottom: mb }));
  // menu preview dialog
  N = await newPage(browser, { width: 1280, height: 800 }); await login(N.page); const q = N.page; await go(q, '#/menu'); await q.waitForSelector('.a-cat');
  await q.getByRole('button', { name: /Преглед/ }).first().click(); await q.waitForSelector('dialog[open] .preview-frame');
  await q.locator('dialog[open]').getByRole('button', { name: 'Телефон' }).click().catch(() => {}); await q.waitForTimeout(300);
  const mm = await q.evaluate(() => { const f = document.querySelector('dialog[open] .preview-frame'); const m = f.querySelector('.menu-cats'); const cs = getComputedStyle(m); const tops = [...m.querySelectorAll('.cat')].map((c) => c.getBoundingClientRect().left | 0); return { frameW: f.getBoundingClientRect().width | 0, colCount: cs.columnCount, distinctX: new Set(tops).size }; });
  R.check('D2c menu "Телефон" preview at 1280: single column (column-count auto/1, categories share one x)', mm.frameW <= 392 && (mm.colCount === 'auto' || mm.colCount === '1') && mm.distinctX === 1, JSON.stringify(mm));
  await q.keyboard.press('Escape');
});
await step('D9', async () => {
  await N.page.evaluate(() => { location.hash = '#/'; }); await N.page.waitForSelector('.a-dash-card'); const AP = N.page;
  const d = await AP.evaluate(() => { const ul = document.querySelector('.a-dash-card ul.a-titles'); if (!ul) return null; const li = ul.querySelector('li'); return { n: ul.querySelectorAll('li').length, ls: getComputedStyle(ul).listStyleType, strong: !!ul.querySelector('strong'), pl: parseFloat(getComputedStyle(ul).paddingLeft) }; });
  R.check('D9 dashboard active event titles rendered as a bulleted list (not bold run-together text)', !!d && d.n >= 2 && d.ls === 'disc' && d.pl > 0 && !d.strong, JSON.stringify(d));
  await AP.screenshot({ path: path.join(shots, 'design-D9-dashboard.png'), fullPage: true });
});
await A.context.close(); await N?.context.close();

// D5 + D8 admin + D6 admin + D3 admin at 390
const M = await newPage(browser, { width: 390, height: 844 }); await login(M.page);
await step('D5', async () => {
  const p = M.page; await go(p, '#/events/new'); await p.waitForSelector('.a-actionbar');
  const b = await p.evaluate(() => { const bar = document.querySelector('.a-actionbar'); const bs = [...bar.querySelectorAll('button,a')].map((x) => x.getBoundingClientRect()); return { h: bar.getBoundingClientRect().height | 0, n: bs.length, tops: [...new Set(bs.map((r) => r.top | 0))], pct: Math.round(bar.getBoundingClientRect().height / innerHeight * 100) }; });
  R.check('D5 mobile action bar: all buttons on one row, bar <=80px tall', b.tops.length === 1 && b.n >= 2 && b.h <= 80, JSON.stringify(b));
});
await step('D6a', async () => {
  const h = await M.page.evaluate(() => document.querySelector('.a-topbar__logo').getBoundingClientRect().height);
  R.check('D6a admin logo link >=44px high', h >= 44, String(h));
});
await step('D8a', async () => {
  const p = M.page; const out = [];
  for (const sel of ['.a-topbar__logo', '.a-logout-top']) {
    await p.focus(sel); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); const r = await p.evaluate((s) => { const e = document.querySelector(s); const cs = getComputedStyle(e); const ow = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset); const r = e.getBoundingClientRect(); const bar = document.querySelector('.a-topbar').getBoundingClientRect(); let clip = false; for (let a = e.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a); if (/(hidden|clip|auto|scroll)/.test(o.overflow + o.overflowX + o.overflowY)) { const ar = a.getBoundingClientRect(); if (r.top - ow < ar.top || r.bottom + ow > ar.bottom || r.left - ow < ar.left || r.right + ow > ar.right) clip = true; } } return { style: cs.outlineStyle, ow, ringTop: r.top - ow, ringBottom: r.bottom + ow, barTop: bar.top, barBottom: bar.bottom, ringLeft: r.left - ow, ringRight: r.right + ow, vw: innerWidth, clip }; }, sel);
    r.ok = r.style !== 'none' && r.ow >= 3 && r.ringTop >= r.barTop && r.ringBottom <= r.barBottom && r.ringLeft >= 0 && r.ringRight <= r.vw && !r.clip; out.push([sel, r]);
  }
  R.check('D8a admin top bar: focus ring (outline+offset) of logo and "Изход" lies inside the bar/viewport and no overflow ancestor clips it', out.every(([, r]) => r.ok), JSON.stringify(out));
  await p.screenshot({ path: path.join(shots, 'design-D8-admin-topbar.png'), clip: { x: 0, y: 0, width: 390, height: 70 } });
});
await step('D3a', async () => {
  const f = await M.page.evaluate(() => ({ ff: getComputedStyle(document.body).fontFamily, loaded: document.fonts.check('16px "Source Sans 3"'), fonts: [...document.fonts].map((x) => x.family + ':' + x.status) }));
  R.check('D3a admin body font-family starts with "Source Sans 3" (computed)', /^"?Source Sans 3"?/.test(f.ff), JSON.stringify(f));
  console.log('INFO D3a font loaded from Google Fonts (reachable?):', f.loaded);
});
await M.context.close();

// public checks
for (const [w, h] of [[390, 844], [1280, 800]]) {
  const { page, context } = await newPage(browser, { width: w, height: h }); await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForSelector('.cat');
  await step(`PUB${w}`, async () => {
    const f = await page.evaluate(() => ({ ff: getComputedStyle(document.body).fontFamily, loaded: document.fonts.check('16px "Source Sans 3"') }));
    R.check(`D3b[${w}] public body font-family starts with "Source Sans 3"`, /^"?Source Sans 3"?/.test(f.ff), JSON.stringify(f));
    const lg = await page.evaluate(() => document.querySelector('.logo').getBoundingClientRect().height);
    R.check(`D6b[${w}] public logo link >=44px high`, lg >= 44, String(lg));
    const en = await page.evaluate(() => [...document.querySelectorAll('.btn .en, .btn-special .en')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
    R.check(`D7[${w}] every ".btn .en" font-size >=12px (${en.length} found)`, en.length > 0 ? en.every((x) => x >= 12) : true, JSON.stringify(en));
    // D8 public header focus ring
    const out = [];
    for (const sel of ['.logo', '.nav-daily a', '.nav-toggle']) {
      if (!(await page.locator(sel).first().isVisible().catch(() => false))) continue;
      await page.locator(sel).first().focus();
      out.push([sel, await page.evaluate((s) => { const e = document.querySelector(s); const cs = getComputedStyle(e); const ow = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset); const r = e.getBoundingClientRect(); let clip = false; for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) { const o = getComputedStyle(a); if (/(hidden|clip|auto|scroll)/.test(o.overflow + o.overflowX + o.overflowY)) { const ar = a.getBoundingClientRect(); if (r.top - ow < ar.top || r.bottom + ow > ar.bottom || r.left - ow < ar.left || r.right + ow > ar.right) clip = true; } } return { style: cs.outlineStyle, ow, top: r.top - ow, left: r.left - ow, right: r.right + ow, vw: innerWidth, clip }; }, sel)]);
    }
    R.check(`D8b[${w}] public header focus rings (${out.map((o) => o[0]).join(', ')}) not clipped (top>=0, inside viewport, no clipping ancestor)`, out.length > 0 && out.every(([, r]) => r.style !== 'none' && r.ow >= 2 && r.top >= 0 && r.left >= 0 && r.right <= r.vw && !r.clip), JSON.stringify(out));
    await page.screenshot({ path: path.join(shots, `design-D8-public-${w}.png`), clip: { x: 0, y: 0, width: w, height: 90 } });
    if (w === 1280) {
      const has = await page.locator('.menu-cats').count();
      const col = has ? await page.evaluate(() => { const m = document.querySelector('.menu-cats'); const cats = [...m.querySelectorAll('.cat')]; return { colCount: getComputedStyle(m).columnCount, split: cats.filter((c) => c.getClientRects().length > 1).length, mixed: cats.filter((c) => { const t = c.querySelector('.cat-title').getBoundingClientRect().left; return [...c.querySelectorAll('li, .dish, article')].some((x) => Math.abs(x.getBoundingClientRect().left - t) > 40); }).length, n: cats.length }; }) : null;
      R.check('D4 public menu at 1280: two columns and no category split across columns (title and all dishes share the column)', !!col && col.colCount === '2' && col.split === 0 && col.mixed === 0 && col.n === 5, JSON.stringify(col));
      await page.screenshot({ path: path.join(shots, 'design-D4-menu-1280.png'), fullPage: true });
    }
  });
  await context.close();
}
// D11 no-menu state (daily menu page, nothing published today)
await step('D11', async () => {
  const { page, context } = await newPage(browser, { width: 390, height: 844 }); await page.goto(base + '/daily-menu', { waitUntil: 'networkidle' }); await page.waitForSelector('.state-title');
  const c = await page.evaluate(() => { const t = document.querySelector('.state-title'); const probe = document.createElement('span'); probe.style.color = 'var(--text)'; document.body.append(probe); return { title: getComputedStyle(t).color, text: getComputedStyle(probe).color, txt: t.textContent.trim().slice(0, 40) }; });
  R.check('D11 no-menu title colour equals var(--text)', c.title === c.text, JSON.stringify(c));
  await page.screenshot({ path: path.join(shots, 'design-D11-390.png') }); await context.close();
});
await browser.close(); await srv.stop();
R.summary();

// T-66 (D-64 b/c/d) browser tests against the REAL backend: top bar "За резервации и поръчки" on all 6 public pages (with/without phone,
// JS-less fallback), /reservation (h1/title/meta, orders block, table note, call button), daily-menu "Актуално до 16:00 ч." note.
// Port 3204. Run: node --disable-warning=ExperimentalWarning tests/e2e/d64-pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { startServer, createAdmin, Client, tmpDir, makePng, form, reporter, ROOT } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir, contrast, colorsOf } from '../lib/browser.mjs';

const R = reporter('d64-pages-e2e');
const shots = shotDir();
const T0 = '2026-06-15T10:00:00Z'; // 13:00 Europe/Sofia, 2026-06-15
const PHONE = '+359 88 123 4567'; const TEL = 'tel:+359881234567';
const dir = tmpDir('d64'); createAdmin(dir);
const srv = await startServer({ port: 3204, dataDir: dir, now: T0 });
const base = srv.url;
const api = new Client(base); await api.login();
const setSettings = (o) => api.put('/api/admin/settings', { json: o });
const browser = await chromium.launch();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.stack || e.message).split('\n').slice(0, 5).join(' | ')); } };
const VPS = [{ n: 390, w: 390, h: 844 }, { n: 768, w: 768, h: 1024 }, { n: 1280, w: 1280, h: 800 }];
const PAGES = [['index', '/'], ['daily', '/daily-menu'], ['gallery', '/gallery'], ['reservation', '/reservation'], ['privacy', '/privacy'], ['404', '/no-such-page-xyz']];
const T = { bg: { label: 'За резервации и поръчки:', res: 'Резервации и поръчки' }, en: { label: 'For reservations & orders:', res: 'Reservations & orders' } };

// ---------------------------------------------------------------- static source check
for (const f of ['index', 'daily-menu', 'gallery', 'reservation', 'privacy', '404']) {
  const src = fs.readFileSync(path.join(ROOT, 'public', f + '.html'), 'utf8');
  const m = /<div class="top-bar"[^>]*>([\s\S]*?)<\/div>/.exec(src);
  R.check(`TBS[${f}.html] static top-bar fallback text is the D-64 text (label "За резервации и поръчки:", link "Резервации и поръчки"), no old text left`, !!m && m[1].includes('hidden>За резервации и поръчки:</span>') && m[1].includes('>Резервации и поръчки</a>') && !/За резервации:|>Резервации</.test(m[1]), m && m[1]);
}
await setSettings({ reservationPhone: '' });

// ---------------------------------------------------------------- JS-less fallback
for (const [name, route] of PAGES) await step(`NOJS-${name}`, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(base + route, { waitUntil: 'load' });
  const d = await page.evaluate(() => ({ a: document.getElementById('top-phone').textContent.trim(), href: document.getElementById('top-phone').getAttribute('href'), lblHidden: document.getElementById('top-label').hidden, barR: document.getElementById('top-bar').getBoundingClientRect().right, aR: document.getElementById('top-phone').getBoundingClientRect().right, iw: innerWidth })); // (document h-scroll without JS is a pre-existing header/hamburger matter at 390 px, not part of D-64)
  R.check(`NOJS[${name}] without JS the top bar shows the link "Резервации и поръчки" -> /reservation, label hidden, bar and link inside the viewport`, d.a === 'Резервации и поръчки' && d.href === '/reservation' && d.lblHidden && d.barR <= d.iw && d.aR <= d.iw, JSON.stringify(d));
  await context.close();
});

// ---------------------------------------------------------------- top bar at 390 (and 768/1280), with and without phone
for (const withPhone of [false, true]) {
  await setSettings({ reservationPhone: withPhone ? PHONE : '' });
  for (const lang of ['bg', 'en']) for (const vp of VPS) for (const [name, route] of PAGES) await step(`TB-${withPhone}-${lang}-${vp.n}-${name}`, async () => {
    const c = await newPage(browser, { width: vp.w, height: vp.h }); const p = c.page; const id = `${withPhone ? 'phone' : 'nophone'} ${lang} ${vp.n} ${name}`;
    await p.goto(base + route + `?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(150);
    const d = await p.evaluate(() => {
      const bar = document.getElementById('top-bar'); const a = document.getElementById('top-phone'); const lb = document.getElementById('top-label');
      const br = bar.getBoundingClientRect(); const ar = a.getBoundingClientRect(); const lr = lb.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(a).lineHeight) || parseFloat(getComputedStyle(a).fontSize) * 1.5;
      return { barH: Math.round(br.height), barR: Math.round(br.right), aR: Math.round(ar.right), aL: Math.round(ar.left), aH: Math.round(ar.height), lblVis: getComputedStyle(lb).display !== 'none', lblT: lb.textContent.trim(), lblR: Math.round(lr.right), lblL: Math.round(lr.left), lblH: Math.round(lr.height), aT: a.textContent.trim(), href: a.getAttribute('href'), lh: Math.round(lh), sw: document.documentElement.scrollWidth, iw: innerWidth, oneLine: !getComputedStyle(lb).display.includes('none') ? Math.abs((lr.top + lr.height / 2) - (ar.top + ar.height / 2)) < 6 : true };
    });
    const textOk = withPhone ? d.lblVis && d.lblT === T[lang].label && d.aT === PHONE && d.href === TEL : !d.lblVis && d.aT === T[lang].res && d.href.startsWith('/reservation');
    R.check(`TB[${id}] text ${withPhone ? `"${T[lang].label} ${PHONE}"` : `"${T[lang].res}"`}, inside viewport (label ${d.lblL}-${d.lblR}, link ${d.aL}-${d.aR} of ${vp.w}), bar <= 52 px (${d.barH}), link >= 44 px (${d.aH}), no h-scroll, label+link on one line (${d.oneLine})`, textOk && d.barR <= vp.w && d.aR <= vp.w && d.aL >= 0 && d.lblL >= 0 && d.barH <= 52 && d.aH >= 44 && d.sw <= d.iw && d.oneLine, JSON.stringify(d));
    if (vp.n === 390 && lang === 'bg' && name === 'index') await p.screenshot({ path: path.join(shots, `d64-topbar-${withPhone ? 'phone' : 'nophone'}-390.png`), clip: { x: 0, y: 0, width: 390, height: 80 } });
    await c.context.close();
  });
}
await setSettings({ reservationPhone: PHONE, address: 'ул. Ралевица 85, София', addressEn: '85 Ralevitsa St, Sofia' });

// ---------------------------------------------------------------- /reservation
const RS = {
  bg: { h1: 'Резервации и поръчки', title: 'Резервации и поръчки — Kota1 Restaurant', meta: 'Резервации и поръчки в Kota1 Restaurant по телефона. Поръчки за вкъщи или офис, схема на залата и адрес.', ordH: 'Поръчки за вкъщи или офис', ord: ['10% отстъпка за всички поръчки за вкъщи, които се вземат на място от ресторанта.', 'Безплатна доставка до 3 км от ресторанта.', 'За адреси на повече от 3 км се начислява такса за доставка според разстоянието.'], note2: 'За по-големи групи можем да пренаредим масите — кажете ни при резервацията.', call: 'Обадете се' },
  en: { h1: 'Reservations & orders', title: 'Reservations & orders — Kota1 Restaurant', meta: 'Reservations and orders at Kota1 Restaurant by phone. Orders for home or office, floor plan and address.', ordH: 'Orders for home or office', ord: ['10% off all take-away orders collected at the restaurant.', 'Free delivery within 3 km of the restaurant.', 'Deliveries beyond 3 km have a delivery charge that depends on the distance.'], note2: 'For larger groups we can rearrange the tables — just let us know when you book.', call: 'Call us' },
};
for (const lang of ['bg', 'en']) for (const vp of VPS) await step(`RES-${lang}-${vp.n}`, async () => {
  await setSettings({ reservationPhone: PHONE });
  const c = await newPage(browser, { width: vp.w, height: vp.h }); const p = c.page; const id = `${lang}/${vp.n}`; const S = RS[lang];
  const resp = await p.goto(base + '/reservation' + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }); await p.waitForTimeout(250);
  const m = await p.evaluate(() => ({ h1n: document.querySelectorAll('h1').length, h1: document.querySelector('h1').textContent.trim(), title: document.title, meta: document.querySelector('meta[name=description]').content, leadN: document.querySelectorAll('.page-band .lead, [data-i18n="res.lead"]').length, callHN: document.querySelectorAll('#res-call-heading, [data-i18n="res.call.h"], .res-call h2').length, callSecLabelled: document.querySelector('.res-call').hasAttribute('aria-labelledby'), heads: [...document.querySelectorAll('h1,h2,h3')].map((e) => e.tagName[1] + ':' + e.textContent.trim()), lang: document.documentElement.lang }));
  R.check(`RP1[${id}] HTTP 200, one h1 "${S.h1}", title "${S.title}", meta description, NO lead paragraph, NO call-section h2, html lang=${lang}`, resp.status() === 200 && m.h1n === 1 && m.h1 === S.h1 && m.title === S.title && m.meta === S.meta && m.leadN === 0 && m.callHN === 0 && !m.callSecLabelled && m.lang === lang, JSON.stringify(m));
  const lv = m.heads.map((h) => +h[0]);
  R.check(`RP2[${id}] heading order without skipped levels, order: h1 -> orders h2 "${S.ordH}", plan h2 (${m.heads.join(' | ')})`, lv.every((l, i) => (i === 0 ? l === 1 : l - lv[i - 1] <= 1)) && m.heads[0] === '1:' + S.h1 && m.heads[1] === '2:' + S.ordH && m.heads.filter((h) => h[0] === '2').length >= 2 && !m.heads.some((h) => /по телефона|by phone/i.test(h)), m.heads.join(' | '));
  const o = await p.evaluate(() => { const ul = document.querySelector('.res-orders-list'); const lis = [...ul.querySelectorAll('li')]; return { n: lis.length, t: lis.map((l) => l.textContent.trim()), inSection: !!ul.closest('section.res-orders'), vis: lis.every((l) => l.getBoundingClientRect().height > 0), r: Math.max(...lis.map((l) => l.getBoundingClientRect().right)), all: document.querySelector('.res-orders').innerText }; });
  R.check(`RP3[${id}] orders block: exactly 3 bullets with the D-64 texts (10% take-away, free delivery within 3 km, charge beyond 3 km), all visible, inside viewport`, o.n === 3 && JSON.stringify(o.t) === JSON.stringify(S.ord) && o.inSection && o.vis && o.r <= vp.w, JSON.stringify(o));
  R.check(`RP4[${id}] no prices/amounts in the orders block (no number with лв/BGN/EUR/€/евро/lv, no decimals; only "10%" and "3 км/km")`, !/\d+([.,]\d+)?\s*(лв|BGN|EUR|€|евро|lv|euro)/i.test(o.all) && !/[€$]/.test(o.all) && (o.all.match(/\d+(?:[.,]\d+)?/g) || []).join() === '10,3,3', o.all.replace(/\n/g, ' / '));
  const nt = await p.evaluate(() => { const n = [...document.querySelectorAll('.plan-note')].map((e) => ({ tag: e.tagName, t: e.textContent.trim(), h: e.getBoundingClientRect().height, r: e.getBoundingClientRect().right })); return n; });
  R.check(`RP5[${id}] floor-plan notes: original caption + the table-rearrange note "${S.note2.slice(0, 28)}…" visible, inside viewport`, nt.length === 2 && nt[1].t === S.note2 && nt.every((x) => x.h > 0 && x.r <= vp.w), JSON.stringify(nt));
  const call = await p.evaluate(() => { const a = document.getElementById('res-call'); const r = a.getBoundingClientRect(); return { hidden: a.hidden, href: a.getAttribute('href'), txt: a.querySelector('span').textContent.trim(), num: document.getElementById('res-call-number').textContent.trim(), h: r.height, right: r.right, noteHidden: document.getElementById('res-nophone').hidden || getComputedStyle(document.getElementById('res-nophone')).display === 'none' }; });
  R.check(`RP6[${id}] call button "${S.call}" + "${PHONE}" -> ${TEL}, >= 44 px, inside viewport, no-phone note hidden`, !call.hidden && call.href === TEL && call.txt === S.call && call.num === PHONE && call.h >= 44 && call.right <= vp.w && call.noteHidden, JSON.stringify(call));
  const col = await colorsOf(p, '.res-orders-list li'); const ratio = contrast(col.fg, col.bg);
  R.check(`RP7[${id}] orders list text contrast >= 4.5:1 (${ratio.toFixed(2)})`, ratio >= 4.5, JSON.stringify(col));
  const nh = await noHScroll(p);
  R.check(`RP8[${id}] no h-scroll (${nh.sw}/${nh.iw}), no console/page errors, failed requests, CSP violations`, nh.ok && c.log.console.length === 0 && c.log.pageErrors.length === 0 && c.log.failed.length === 0 && (await p.collectCsp()).length === 0, JSON.stringify({ c: c.log.console, e: c.log.pageErrors, f: c.log.failed }));
  await p.screenshot({ path: path.join(shots, `d64-reservation-${lang}-${vp.n}.png`), fullPage: true });
  await c.context.close();
});
// no phone: call button hidden, note shown, orders block still there
await step('RES-nophone', async () => {
  await setSettings({ reservationPhone: '' });
  for (const lang of ['bg', 'en']) {
    const c = await newPage(browser, { width: 390, height: 844 }); const p = c.page;
    await p.goto(base + '/reservation' + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }); await p.waitForTimeout(200);
    const d = await p.evaluate(() => ({ callHidden: document.getElementById('res-call').hidden, note: getComputedStyle(document.getElementById('res-nophone')).display !== 'none', li: document.querySelectorAll('.res-orders-list li').length, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    R.check(`RP9[${lang}] no phone: call button hidden, note shown, orders block + 3 bullets still shown, no h-scroll`, d.callHidden && d.note && d.li === 3 && d.sw <= d.iw, JSON.stringify(d));
    await c.context.close();
  }
  await setSettings({ reservationPhone: PHONE });
});
await step('RES-switch', async () => {
  const c = await newPage(browser, { width: 390, height: 844 }); const p = c.page;
  await p.goto(base + '/reservation', { waitUntil: 'networkidle' });
  await p.locator('.lang-btn[data-lang=en]').click(); await p.waitForTimeout(400);
  const en = await p.evaluate(() => ({ h1: document.querySelector('h1').textContent.trim(), li: [...document.querySelectorAll('.res-orders-list li')].map((l) => l.textContent.trim()), n2: document.querySelectorAll('.plan-note')[1].textContent.trim(), title: document.title, call: document.querySelector('#res-call span').textContent.trim() }));
  R.check('RP10 BG->EN switch on /reservation re-translates h1, title, orders bullets, table note and call button', en.h1 === RS.en.h1 && JSON.stringify(en.li) === JSON.stringify(RS.en.ord) && en.n2 === RS.en.note2 && en.title === RS.en.title && en.call === RS.en.call, JSON.stringify(en));
  await c.context.close();
});
{ // OG / twitter meta of the raw HTML
  const b = await (await fetch(base + '/reservation')).text();
  const meta = (attr, name) => { const m = new RegExp(`<meta[^>]+${attr}="${name}"[^>]*content="([^"]*)"`, 'i').exec(b); return m ? m[1] : null; };
  R.check('RP11 raw /reservation HTML: <title>, description, og:title/description, twitter:title/description all carry the D-64 text', b.includes('<title>Резервации и поръчки — Kota1 Restaurant</title>') && meta('name', 'description') === RS.bg.meta && meta('property', 'og:title') === RS.bg.title && meta('property', 'og:description') === RS.bg.meta && meta('name', 'twitter:title') === RS.bg.title && meta('name', 'twitter:description') === RS.bg.meta, [meta('name', 'description'), meta('property', 'og:title')].join(' | '));
}

// ---------------------------------------------------------------- daily menu note
const D = '/api/admin/daily-menus';
const wipe = async () => { for (const m of (await api.get(D)).data.menus) await api.del(`${D}/${m.id}`); };
const mk = async (date, published) => { const r = await api.post(D, { form: form({ date, published }, { field: 'file', buf: makePng(300, 400), name: 'd.png', type: 'image/png' }) }); if (r.status !== 201) throw new Error(`seed ${r.status} ${r.text()}`); return r.data; };
const UNTIL = { bg: 'Актуално до 16:00 ч.', en: 'Available until 4:00 pm' };
const untilState = (p) => p.evaluate(() => { const u = document.getElementById('daily-until'); const r = u.getBoundingClientRect(); return { hidden: u.hidden, disp: getComputedStyle(u).display, txt: u.textContent.trim(), h: r.height, left: r.left, right: r.right, tag: document.getElementById('daily-tag').hidden, inView: !!document.querySelector('#daily-view img') }; });
await wipe(); await mk('2026-06-15', 'true');
for (const lang of ['bg', 'en']) for (const vp of VPS) await step(`DAILY-${lang}-${vp.n}`, async () => {
  const c = await newPage(browser, { width: vp.w, height: vp.h }); const p = c.page; const id = `${lang}/${vp.n}`;
  await p.goto(`${base}/daily-menu?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForSelector('#daily-view img'); await p.waitForTimeout(200);
  const u = await untilState(p);
  R.check(`DL1[${id}] published menu for today: "${UNTIL[lang]}" visible (not hidden, display ${u.disp}), inside viewport (${Math.round(u.left)}-${Math.round(u.right)}), "today only" tag also shown`, !u.hidden && u.disp !== 'none' && u.txt === UNTIL[lang] && u.h > 0 && u.left >= 0 && u.right <= vp.w && u.tag === false && u.inView, JSON.stringify(u));
  const col = await colorsOf(p, '#daily-until'); const ratio = contrast(col.fg, col.bg);
  R.check(`DL2[${id}] note contrast >= 4.5:1 (${ratio.toFixed(2)}), one h1`, ratio >= 4.5 && (await p.locator('h1').count()) === 1, JSON.stringify(col));
  if (vp.n === 390) {
    await p.locator(`.lang-btn[data-lang=${lang === 'bg' ? 'en' : 'bg'}]`).click(); await p.waitForTimeout(600);
    const u2 = await untilState(p); const other = lang === 'bg' ? 'en' : 'bg';
    R.check(`DL3[${id}] language switch keeps the note visible and translated ("${UNTIL[other]}")`, !u2.hidden && u2.txt === UNTIL[other] && u2.inView, JSON.stringify(u2));
  }
  const nh = await noHScroll(p);
  R.check(`DL4[${id}] no h-scroll, no console/page errors, failed requests, CSP violations`, nh.ok && c.log.console.length === 0 && c.log.pageErrors.length === 0 && c.log.failed.length === 0 && (await p.collectCsp()).length === 0, JSON.stringify({ c: c.log.console, e: c.log.pageErrors, f: c.log.failed }));
  await p.screenshot({ path: path.join(shots, `d64-daily-${lang}-${vp.n}.png`), fullPage: true });
  await c.context.close();
});
// loading state: slow API -> note hidden while loading, shown afterwards
await step('DAILY-loading', async () => {
  const c = await newPage(browser, { width: 390, height: 844 }); const p = c.page;
  await p.route('**/api/public/daily-menu*', async (r) => { await new Promise((x) => setTimeout(x, 1200)); await r.continue(); });
  await p.goto(`${base}/daily-menu`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(500);
  const during = await untilState(p);
  await p.waitForSelector('#daily-view img', { timeout: 8000 }); const after = await untilState(p);
  R.check('DL5 while the menu is loading the note is hidden (no flash); once the menu is shown it is visible', (during.hidden || during.disp === 'none') && !after.hidden && after.txt === UNTIL.bg, JSON.stringify({ during, after }));
  await c.context.close();
});
// no menu states: nothing for today (menu dated other day / unpublished) and API error
await wipe(); await mk('2026-06-14', 'true');
for (const lang of ['bg', 'en']) for (const vp of [VPS[0], VPS[2]]) await step(`DAILY-none-${lang}-${vp.n}`, async () => {
  const c = await newPage(browser, { width: vp.w, height: vp.h }); const p = c.page;
  await p.goto(`${base}/daily-menu?lang=${lang}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(400);
  const u = await untilState(p);
  R.check(`DL6[${lang}/${vp.n}] no menu for today: note hidden (hidden attr + not rendered), tag hidden, no menu image`, u.hidden && u.disp === 'none' && !u.inView && u.tag === true, JSON.stringify(u));
  await p.screenshot({ path: path.join(shots, `d64-daily-none-${lang}-${vp.n}.png`), fullPage: true });
  await c.context.close();
});
await wipe(); await mk('2026-06-15', 'false');
await step('DAILY-unpublished', async () => {
  const c = await newPage(browser, { width: 390, height: 844 }); const p = c.page;
  await p.goto(`${base}/daily-menu`, { waitUntil: 'networkidle' }); await p.waitForTimeout(400);
  const u = await untilState(p);
  R.check('DL7 today\'s menu exists but unpublished: no-menu state, note hidden', u.hidden && u.disp === 'none' && !u.inView, JSON.stringify(u));
  await c.context.close();
});
await wipe(); await mk('2026-06-15', 'true');
await step('DAILY-error', async () => {
  const c = await newPage(browser, { width: 390, height: 844 }); const p = c.page;
  await p.route('**/api/public/daily-menu*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server_error"}' }));
  await p.goto(`${base}/daily-menu`, { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  const u = await untilState(p);
  R.check('DL8 API error state: note hidden', u.hidden && u.disp === 'none' && !u.inView, JSON.stringify(u));
  await c.context.close();
});

await browser.close(); await srv.stop();
R.summary();

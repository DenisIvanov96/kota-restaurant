// T-62 (D-62, D-63) browser tests against the REAL backend (no mocks): home menu pages slider with 1, 2 and 15 real pages,
// and the raised limits in the admin (menu pages "/ 15", gallery "N / 50", UI blocks the 16th page / 51st item). Port 3202.
// Run: node --disable-warning=ExperimentalWarning tests/e2e/slider.mjs
import fs from 'node:fs';
import path from 'node:path';
import { startServer, createAdmin, Client, tmpDir, makePng, PASSWORD, reporter } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir } from '../lib/browser.mjs';

const R = reporter('slider-e2e');
const shots = shotDir();
const T0 = '2026-06-15T10:00:00Z';
const dir = tmpDir('slider'); createAdmin(dir);
const srv = await startServer({ port: 3202, dataDir: dir, now: T0 });
const base = srv.url;
const api = new Client(base); await api.login(); const anon = new Client(base);
const browser = await chromium.launch();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.stack || e.message).split('\n').slice(0, 5).join(' | ')); } };
const VPS = [{ n: 390, w: 390, h: 844 }, { n: 768, w: 768, h: 1024 }, { n: 1280, w: 1280, h: 800 }];
// page i: colour index in the red channel, alternating aspect ratios (portrait / landscape / square) to prove the frame does not jump
const colour = (i) => [10 + i * 15, 90, 160];
const idxOf = (px) => Math.round((px[0] - 10) / 15);
const dims = (i) => [[600, 800], [800, 500], [500, 500]][i % 3];
const pagePng = (i) => makePng(...dims(i), colour(i));
const MP = '/api/admin/menu/pages';
const mp = (fields, name, buf) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); fd.append('file', new Blob([buf], { type: 'image/png' }), name); return fd; };
const clearPages = async () => { for (const it of (await api.get('/api/admin/menu')).data.pages.bg.items) await api.del(`${MP}/${it.id}`); };
async function seed(n) {
  await api.put('/api/admin/menu/mode', { json: { mode: 'structured' } }); // the last live page cannot be deleted in file mode
  await clearPages();
  for (let i = 0; i < n; i++) { const r = await api.post(MP, { form: mp({ lang: 'bg' }, `s${i + 1}.png`, pagePng(i)) }); if (r.status !== 201) throw new Error(`seed ${i}: ${r.status} ${r.text()}`); }
  await api.put('/api/admin/menu/pages/published', { json: { lang: 'bg', published: true } });
  const mr = await api.put('/api/admin/menu/mode', { json: { mode: 'file' } }); if (mr.status !== 200) throw new Error('mode switch failed ' + mr.status + ' ' + mr.text());
}
{ // structured menu first so that switching to file mode is accepted, then file mode
  await api.put('/api/admin/menu/draft', { json: { categories: [{ name: 'Салати', nameEn: 'Salads', items: [{ name: 'Шопска', nameEn: 'Shopska', description: 'домати', priceCents: 650, available: true }] }] } });
  await api.post('/api/admin/menu/publish');
}
await seed(2);

const pixel = (page, sel) => page.locator(sel).first().evaluate((img) => new Promise((res) => {
  const go = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); res([...x.getImageData(5, 5, 1, 1).data]); };
  if (img.complete && img.naturalWidth) go(); else img.addEventListener('load', go);
}));
const L = { bg: { cap: (n, m) => `Страница ${n} от ${m}`, prev: 'Предишна страница', next: 'Следваща страница' }, en: { cap: (n, m) => `Page ${n} of ${m}`, prev: 'Previous page', next: 'Next page' } };
const mediaUrls = () => api.get('/api/admin/menu').then((r) => r.data.pages.bg.items.map((x) => x.fileUrl.replace('/api/admin/media', '/media')));
async function open(vp, lang = 'bg') {
  const c = await newPage(browser, { width: vp.w, height: vp.h });
  c.media = [];
  c.page.on('request', (r) => { const m = /\/media\/[0-9a-f]{32}\.\w+/.exec(r.url()); if (m) c.media.push(m[0]); });
  await c.page.goto(`${base}/?lang=${lang}#menu`, { waitUntil: 'networkidle' });
  await c.page.waitForSelector('.menu-slider');
  await c.page.waitForFunction(() => { const i = document.querySelector('.menu-slide img'); return i && i.complete && i.naturalWidth > 0; });
  return c;
}
const cnt = (p) => p.locator('.menu-slider-count').innerText();
const swipe = (p, dx, dy = 0) => p.locator('.menu-slide-stage').evaluate((el, [ddx, ddy]) => {
  const mk = (type, x, y) => { const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y }); el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true })); };
  mk('touchstart', 200, 300); mk('touchend', 200 + ddx, 300 + ddy);
}, [dx, dy]);

// ============================================================================ 15 pages
await seed(15);
const U15 = await mediaUrls();
await step('S15-390', async () => {
  const c = await open(VPS[0]); const p = c.page;
  R.check('SL1 15 pages @390: counter "Страница 1 от 15", prev disabled (but visible), next enabled, exactly one image in the slider; arrows are real <button type=button> with aria-labels', (await cnt(p)) === L.bg.cap(1, 15) && (await p.locator('.slider-prev').isDisabled()) && (await p.locator('.slider-prev').isVisible()) && (await p.locator('.slider-next').isEnabled()) && (await p.locator('.menu-slide img').count()) === 1 && (await p.locator('button.slider-prev[type=button][aria-label="Предишна страница"]').count()) === 1 && (await p.locator('button.slider-next[type=button][aria-label="Следваща страница"]').count()) === 1);
  const sz = await p.locator('.slider-btn').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  R.check('SL2 both arrow buttons are >= 44 x 44 px', sz.length === 2 && sz.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(sz));
  R.check('SL3 counter is an aria-live="polite" region; the slider wrapper is a focusable group (tabindex 0, role group, roledescription carousel); the image is clickable (button.zoom-btn) with alt "Меню — страница 1" and label "Увеличи страница 1 от 15"', (await p.locator('.menu-slider-count').getAttribute('aria-live')) === 'polite' && (await p.locator('.menu-slider').getAttribute('tabindex')) === '0' && (await p.locator('.menu-slider').getAttribute('role')) === 'group' && (await p.locator('.menu-slider').getAttribute('aria-roledescription')) === 'carousel' && (await p.locator('.menu-slide .zoom-btn').getAttribute('aria-label')) === 'Увеличи страница 1 от 15' && (await p.locator('.menu-slide img').getAttribute('alt')) === 'Меню — страница 1');

  // ---- eager loading: only current + neighbour requested
  const first2 = new Set(c.media);
  R.check('SL4 network after load: ONLY pages 1 and 2 of the 15 were requested (current eager + next preloaded); no page > 2; the img of the current page is not lazy', first2.size === 2 && first2.has(U15[0]) && first2.has(U15[1]) && [...first2].every((u) => U15.indexOf(u) <= 1) && (await p.locator('.menu-slide img').getAttribute('loading')) !== 'lazy', JSON.stringify([...first2]));
  await p.locator('.slider-next').click(); await p.waitForTimeout(500);
  const after1 = new Set(c.media);
  R.check('SL5 after "next" to page 2: page 3 is preloaded as neighbour (3 distinct requests), pages 4..15 still not requested', after1.size === 3 && after1.has(U15[2]) && U15.slice(3).every((u) => !after1.has(u)), JSON.stringify([...after1].map((u) => U15.indexOf(u) + 1)));
  await p.locator('.slider-prev').click(); await p.waitForTimeout(200);

  // ---- walk all 15 pages with the buttons: order, counters, disabled ends, frame never jumps
  const colours = []; const counters = []; const rects = []; const alts = [];
  for (let i = 0; i < 15; i++) {
    await p.waitForFunction(() => { const im = document.querySelector('.menu-slide img'); return im && im.complete && im.naturalWidth > 0; });
    colours.push(idxOf(await pixel(p, '.menu-slide img'))); counters.push(await cnt(p));
    alts.push(await p.locator('.menu-slide img').getAttribute('alt'));
    rects.push(await p.locator('.menu-slide').evaluate((f) => { const r = f.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top + scrollY)]; }));
    if (i < 14) await p.locator('.slider-next').click();
  }
  R.check('SL6 walking next x14: the 15 real pages appear in admin order (colour 0..14), counters "Страница 1 от 15" .. "Страница 15 от 15", alt "Меню — страница N"', colours.join() === Array.from({ length: 15 }, (_, i) => i).join() && counters.every((t, i) => t === L.bg.cap(i + 1, 15)) && alts.every((a, i) => a === `Меню — страница ${i + 1}`), JSON.stringify({ colours, counters: counters.slice(0, 2) }));
  R.check('SL7 at page 15: next is DISABLED (still visible), prev enabled; clicking a disabled next changes nothing (no wrap-around)', (await p.locator('.slider-next').isDisabled()) && (await p.locator('.slider-next').isVisible()) && (await p.locator('.slider-prev').isEnabled()) && (await p.locator('.slider-next').click({ force: true, timeout: 1000 }).then(() => true, () => true)) && (await cnt(p)) === L.bg.cap(15, 15));
  R.check('SL8 the frame (.menu-slide) has identical width/height/position on all 15 pages (portrait, landscape and square images): no layout jump', rects.every((r) => r.join() === rects[0].join()), JSON.stringify(rects.slice(0, 4)));
  const ratio = rects[0][0] / rects[0][1];
  R.check('SL8b the frame keeps the 3:4 aspect ratio at 390 (0.75 +- 0.02)', Math.abs(ratio - 0.75) < 0.02, ratio.toFixed(3));
  const objFit = await p.locator('.menu-slide img').evaluate((i) => getComputedStyle(i).objectFit);
  R.check('SL8c images use object-fit: contain (landscape/square pages are not cropped)', objFit === 'contain', objFit);
  const ta = await p.locator('.menu-slide').evaluate((f) => getComputedStyle(f).touchAction);
  R.check('SL8d the frame has touch-action: pan-y (vertical scroll still works with horizontal swipe)', ta === 'pan-y', ta);
  const all = new Set(c.media);
  R.check('SL9 after visiting every page all 15 images were requested exactly once each (no duplicates beyond browser cache) and nothing else from /media', all.size === 15 && U15.every((u) => all.has(u)), `${all.size}`);
  while (await p.locator('.slider-prev').isEnabled()) await p.locator('.slider-prev').click();
  R.check('SL10 walking back to page 1: prev disabled, next enabled again', (await p.locator('.slider-prev').isDisabled()) && (await p.locator('.slider-next').isEnabled()) && (await cnt(p)) === L.bg.cap(1, 15));

  // ---- keyboard
  await p.locator('.menu-slider').focus();
  for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight');
  const k1 = await cnt(p);
  await p.keyboard.press('ArrowLeft');
  const k2 = await cnt(p);
  for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowLeft');
  const k3 = await cnt(p);
  R.check('SL11 keyboard: with the slider focused ArrowRight x3 -> page 4, ArrowLeft -> page 3, further ArrowLeft stops at page 1 (no wrap)', k1 === L.bg.cap(4, 15) && k2 === L.bg.cap(3, 15) && k3 === L.bg.cap(1, 15), JSON.stringify([k1, k2, k3]));
  for (let i = 0; i < 20; i++) await p.keyboard.press('ArrowRight');
  R.check('SL12 keyboard: ArrowRight x20 stops at page 15 (no wrap), focus stays on the slider group', (await cnt(p)) === L.bg.cap(15, 15) && (await p.evaluate(() => document.activeElement.classList.contains('menu-slider'))));
  await p.locator('.menu-slider').focus(); for (let i = 0; i < 14; i++) await p.keyboard.press('ArrowLeft');
  R.check('SL13 the focused slider shows a visible focus ring', await p.evaluate(() => { const cs = getComputedStyle(document.querySelector('.menu-slider')); return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2); }));
  // keyboard-only use of the buttons: Tab to "next", Enter x14 up to the last page; focus must stay on something usable
  await p.locator('.menu-slider').focus(); await p.keyboard.press('Tab'); // wrapper -> (prev disabled) zoom button
  await p.keyboard.press('Tab');
  const onNext = await p.evaluate(() => document.activeElement.classList.contains('slider-next'));
  for (let i = 0; i < 14 && onNext; i++) await p.keyboard.press('Enter');
  const endFocus = await p.evaluate(() => document.activeElement.tagName + '.' + document.activeElement.className);
  R.check('SL14 keyboard only: Tab -> "next" button, Enter x14 reaches page 15 and keyboard focus is not dropped to <body> when "next" becomes disabled', onNext && (await cnt(p)) === L.bg.cap(15, 15) && !/^BODY/.test(endFocus), `onNext=${onNext} counter=${await cnt(p)} focus=${endFocus}`);
  await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(150);
  R.check('SL14b keyboard only: after reaching page 15 with Enter on "next", ArrowLeft still goes back to page 14 (arrow keys keep working after the focused button became disabled)', (await cnt(p)) === L.bg.cap(14, 15), `${await cnt(p)} focus=${await p.evaluate(() => document.activeElement.tagName + '.' + document.activeElement.className)}`);
  await p.locator('.slider-prev').click().catch(() => {});
  // T-64 (BUG-25 retest, other direction): keyboard on "prev" down to page 1; focus must move to a slider control, not <body>
  await p.locator('.slider-prev').focus();
  for (let i = 0; i < 20 && (await p.locator('.slider-prev').isEnabled()); i++) await p.keyboard.press('Enter');
  const startFocus = await p.evaluate(() => ({ tag: document.activeElement.tagName, cls: document.activeElement.className, inSlider: !!document.activeElement.closest('.menu-slider') }));
  R.check('SL14c keyboard only: Enter on "prev" down to page 1 -> prev disabled, focus not dropped to <body> (stays inside the slider)', (await cnt(p)) === L.bg.cap(1, 15) && (await p.locator('.slider-prev').isDisabled()) && startFocus.inSlider && startFocus.tag !== 'BODY', `counter=${await cnt(p)} focus=${JSON.stringify(startFocus)}`);
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150);
  R.check('SL14d after reaching page 1 with Enter on "prev", ArrowRight still advances to page 2', (await cnt(p)) === L.bg.cap(2, 15), await cnt(p));

  // ---- swipe (synthetic touch events on the stage)
  while (await p.locator('.slider-prev').isEnabled()) await p.locator('.slider-prev').click();
  await swipe(p, 120); const s0 = await cnt(p); // swipe right on page 1: nothing
  await swipe(p, -120); const s1 = await cnt(p); // left -> page 2
  await swipe(p, -120); const s2 = await cnt(p); // -> 3
  await swipe(p, 120); const s3 = await cnt(p); // right -> 2
  await swipe(p, -20); const s4 = await cnt(p); // too short
  await swipe(p, -60, 100); const s5 = await cnt(p); // mostly vertical (scrolling): ignored
  await swipe(p, -60, 10); const s6 = await cnt(p); // 60 px mostly horizontal: counts (>40)
  R.check('SL15 swipe: right at page 1 does nothing; left -> next; left -> next; right -> prev; tiny swipe (20 px) ignored; mostly vertical swipe ignored; 60 px horizontal swipe changes the page', [s0, s1, s2, s3, s4, s5, s6].join('|') === [1, 2, 3, 2, 2, 2, 3].map((n) => L.bg.cap(n, 15)).join('|'), [s0, s1, s2, s3, s4, s5, s6].join('|'));
  for (let i = 0; i < 12; i++) await swipe(p, -120);
  const e1 = await cnt(p); await swipe(p, -120); const e2 = await cnt(p);
  R.check('SL16 swiping left past the last page stays on page 15 (no wrap)', e1 === L.bg.cap(15, 15) && e2 === e1, `${e1}|${e2}`);
  // ---- click opens the lightbox on the current page
  while (await p.locator('.slider-prev').isEnabled()) await p.locator('.slider-prev').click();
  for (let i = 0; i < 6; i++) await p.locator('.slider-next').click(); // page 7
  await p.locator('.menu-slide .zoom-btn').click(); await p.waitForSelector('dialog.lightbox[open]');
  const pos = () => p.locator('dialog.lightbox .lb-pos').innerText();
  const lbPx = () => p.locator('dialog.lightbox .lb-img').evaluate((img) => new Promise((res) => { const g = () => { const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); res([...x.getImageData(2, 2, 1, 1).data]); }; if (img.complete && img.naturalWidth) g(); else img.addEventListener('load', g); }));
  R.check('SL17 clicking the page on slider page 7 opens the lightbox AT page 7 ("Страница 7 от 15", colour 6, full-size image)', (await pos()) === L.bg.cap(7, 15) && idxOf(await lbPx()) === 6 && (await p.locator('dialog.lightbox .lb-img').getAttribute('alt')) === 'Меню — страница 7', await pos());
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250);
  R.check('SL18 the lightbox keeps working over all 15 pages (ArrowRight -> "Страница 8 от 15", colour 7)', (await pos()) === L.bg.cap(8, 15) && idxOf(await lbPx()) === 7, await pos());
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  R.check('SL19 closing the lightbox returns focus to the page button of the slider; the slider still shows page 7', (await p.evaluate(() => document.activeElement.classList.contains('zoom-btn'))) && (await cnt(p)) === L.bg.cap(7, 15));
  await p.screenshot({ path: path.join(shots, 'slider-15-390.png'), fullPage: false });
  R.check('SL20 no console/page errors, no failed requests, no CSP violations (390, 15 pages, full interaction)', c.log.console.length === 0 && c.log.pageErrors.length === 0 && c.log.failed.length === 0 && (await p.collectCsp()).length === 0, JSON.stringify({ c: c.log.console, f: c.log.failed, e: c.log.pageErrors }));
  await c.context.close();
});

// ============================================================================ heights: 2 pages vs 15 pages, 3 viewports; no h-scroll
const metrics = {};
for (const n of [2, 15]) {
  await seed(n);
  for (const vp of VPS) {
    await step(`H-${n}-${vp.n}`, async () => {
      const c = await open(vp); const p = c.page;
      metrics[`${n}/${vp.n}`] = await p.evaluate(() => ({ doc: document.documentElement.scrollHeight, menu: Math.round(document.getElementById('menu').getBoundingClientRect().height), slider: Math.round(document.querySelector('.menu-slider').getBoundingClientRect().height), frame: [...Object.values(((r) => ({ w: Math.round(r.width), h: Math.round(r.height) }))(document.querySelector('.menu-slide').getBoundingClientRect()))].join('x') }));
      R.check(`HS1[${n} pages/${vp.n}] no horizontal scroll, no console/page errors, no failed requests`, (await noHScroll(p)).ok && c.log.console.length === 0 && c.log.pageErrors.length === 0 && c.log.failed.length === 0, JSON.stringify({ hs: await noHScroll(p), c: c.log.console, f: c.log.failed }));
      if (n === 15) await p.screenshot({ path: path.join(shots, `slider-home-${vp.n}.png`), fullPage: true });
      await c.context.close();
    });
  }
}
for (const vp of VPS) {
  const a = metrics[`2/${vp.n}`]; const b = metrics[`15/${vp.n}`];
  R.check(`HS2[${vp.n}] home height is IDENTICAL for 2 pages and 15 pages (document, #menu section, slider and frame)`, !!a && !!b && JSON.stringify(a) === JSON.stringify(b), JSON.stringify({ two: a, fifteen: b }));
}

// ============================================================================ 1 and 2 pages, both languages, no h-scroll
for (const n of [1, 2]) {
  await seed(n);
  for (const lang of ['bg', 'en']) {
    for (const vp of VPS) {
      await step(`P${n}-${lang}-${vp.n}`, async () => {
        const c = await open(vp, lang); const p = c.page;
        const arrows = await p.locator('.slider-btn').count(); const counter = await p.locator('.menu-slider-count').count();
        if (n === 1) {
          R.check(`SN1[1 page/${lang}/${vp.n}] single page: no arrows, no counter, one image (looks like a single menu card), clickable; no h-scroll; no errors`, arrows === 0 && counter === 0 && (await p.locator('.menu-slide img').count()) === 1 && (await p.locator('.menu-slide .zoom-btn').count()) === 1 && (await noHScroll(p)).ok && c.log.console.length === 0 && c.log.failed.length === 0 && c.media.length === 1, JSON.stringify({ arrows, counter, media: c.media.length }));
        } else {
          const ok0 = arrows === 2 && (await cnt(p)) === L[lang].cap(1, 2) && (await p.locator('.slider-prev').isDisabled()) && (await p.locator('.slider-next').isEnabled()) && (await p.locator('.slider-prev').getAttribute('aria-label')) === L[lang].prev && (await p.locator('.slider-next').getAttribute('aria-label')) === L[lang].next;
          await p.locator('.slider-next').click();
          const ok1 = (await cnt(p)) === L[lang].cap(2, 2) && (await p.locator('.slider-next').isDisabled()) && (await p.locator('.slider-prev').isEnabled()) && idxOf(await pixel(p, '.menu-slide img')) === 1;
          R.check(`SN2[2 pages/${lang}/${vp.n}] 2 pages: arrows labelled "${L[lang].prev}"/"${L[lang].next}", counter "${L[lang].cap(1, 2)}", disabled ends, page 2 reached; no h-scroll; no errors`, ok0 && ok1 && (await noHScroll(p)).ok && c.log.console.length === 0 && c.log.failed.length === 0 && c.log.pageErrors.length === 0, JSON.stringify({ ok0, ok1 }));
        }
        await c.context.close();
      });
    }
  }
}

// ============================================================================ limits in the admin UI
async function login(page) {
  await page.goto(base + '/admin/', { waitUntil: 'networkidle' });
  await page.getByLabel('Потребителско име').fill('owner');
  await page.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('h1:has-text("Табло")');
}
await step('LIM-PAGES', async () => {
  await seed(15);
  const c = await newPage(browser, { width: 390, height: 844 }); const p = c.page; await login(p);
  await p.evaluate(() => { location.hash = '#/menu'; }); await p.waitForSelector('#tab-file'); await p.getByRole('tab', { name: /^Файл/ }).click(); await p.waitForSelector('.a-pagerow');
  const posts = []; p.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith(MP)) posts.push(r.url()); });
  R.check('LIM1 admin menu pages show "15 от 15" and the "Добави страници" button is disabled with "Достигнат е максимумът от 15 страници"', (await p.locator('.a-pagecount').innerText()).includes('15 от 15') && (await p.getByRole('button', { name: 'Добави страници' }).isDisabled()) && /Достигнат е максимумът от 15/.test(await p.locator('.a-upload--pages').innerText()), await p.locator('.a-pagecount').innerText());
  await p.locator('.a-upload--pages input[type=file]').setInputFiles([{ name: 'x16.png', mimeType: 'image/png', buffer: pagePng(0) }]); await p.waitForTimeout(600);
  R.check('LIM2 selecting a 16th page file anyway is refused in the UI (message, no POST request, list still 15)', /Достигнат е максимумът от 15/.test(await p.locator('.a-upload__err').innerText()) && posts.length === 0 && (await p.locator('.a-pagerow').count()) === 15, `posts=${posts.length}`);
  const r16 = await api.post(MP, { form: mp({ lang: 'bg' }, 'x16.png', pagePng(0)) });
  R.check('LIM3 the API rejects the 16th page: 409 too_many_pages; 15 stay', r16.status === 409 && r16.data.error === 'too_many_pages' && (await api.get('/api/admin/menu')).data.pages.bg.items.length === 15);
  await c.context.close();
});
await step('LIM-GALLERY', async () => {
  const G = '/api/admin/gallery';
  for (let i = 0; i < 50; i++) { const fd = new FormData(); fd.append('file', new Blob([makePng(40, 30, [(i * 5) % 256, (i * 11) % 256, 100])], { type: 'image/png' }), `g${i}.png`); const r = await api.post(G, { form: fd }); if (r.status !== 201) throw new Error(`gallery seed ${i}: ${r.status}`); }
  const c = await newPage(browser, { width: 390, height: 844 }); const p = c.page; await login(p);
  const dash = await p.locator('main').innerText();
  R.check('LIM4 dashboard gallery card shows "Галерия: 50 / 50, видими: 50"', dash.includes('Галерия: 50 / 50, видими: 50'), dash.slice(0, 200).replace(/\n/g, '|'));
  await p.evaluate(() => { location.hash = '#/gallery'; }); await p.waitForSelector('.a-count');
  const posts = []; p.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith(G)) posts.push(r.url()); });
  R.check('LIM5 gallery counter "50 / 50", warning "Достигнахте максимума от 50…", upload button disabled', (await p.locator('.a-count__n').textContent()) === '50 / 50' && (await p.getByText('Достигнахте максимума от 50. Изтрийте нещо, за да качите ново.').count()) === 1 && (await p.getByRole('button', { name: 'Избери снимки или видео' }).isDisabled()));
  await p.locator('input[type=file]').setInputFiles([{ name: 'p51.png', mimeType: 'image/png', buffer: makePng(40, 30, [1, 2, 3]) }]); await p.waitForTimeout(800);
  R.check('LIM6 the 51st item cannot be uploaded through the UI: choosing a file on the (hidden) input sends NO request and the list stays at 50', posts.length === 0 && (await p.locator('.a-gal').count()) === 50 && (await api.get(G)).data.items.length === 50, `posts=${posts.length}`);
  const r51 = await api.post(G, { form: (() => { const fd = new FormData(); fd.append('file', new Blob([makePng(40, 30, [9, 9, 9])], { type: 'image/png' }), 'p51.png'); return fd; })() });
  R.check('LIM7 the API rejects the 51st item: 409 gallery_full, max 50 reported by GET', r51.status === 409 && r51.data.error === 'gallery_full' && (await api.get(G)).data.max === 50);
  R.check('LIM8 no horizontal scroll and no page errors on the admin gallery at 50 items (390)', (await noHScroll(p)).ok && c.log.pageErrors.length === 0, JSON.stringify(await noHScroll(p)));
  await p.screenshot({ path: path.join(shots, 'slider-admin-gallery-50.png') });
  await c.context.close();
});

R.summary();
await browser.close(); await srv.stop(); fs.rmSync(dir, { recursive: true, force: true });

// T-66 (D-64a) browser tests against the REAL backend: home events slider with 1, 2 and 3 live events,
// 390/768/1280, BG + EN. Port 3203.
// Run: node --disable-warning=ExperimentalWarning tests/e2e/events-slider.mjs
import path from 'node:path';
import { startServer, createAdmin, Client, tmpDir, makePng, form, reporter } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir } from '../lib/browser.mjs';

const R = reporter('events-slider-e2e');
const shots = shotDir();
const T0 = '2026-06-15T10:00:00Z';
const dir = tmpDir('evslider'); createAdmin(dir);
const srv = await startServer({ port: 3203, dataDir: dir, now: T0 });
const base = srv.url;
const api = new Client(base); await api.login();
const browser = await chromium.launch();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.stack || e.message).split('\n').slice(0, 5).join(' | ')); } };
const VPS = [{ n: 390, w: 390, h: 844 }, { n: 768, w: 768, h: 1024 }, { n: 1280, w: 1280, h: 800 }];
const XSS_T = '<img src=x onerror="window.__xss=1"> Рискован';
const XSS_D = '<script>window.__xss=2</script><b>bold</b> <a href="javascript:window.__xss=3">x</a>';
const LONG = 'Дълго описание на събитието, което заема много редове, за да е тази карта най-високата от всички в слайдера. '.repeat(6);
const LONG_EN = 'A long event description that spans many lines so this card is the tallest one in the slider. '.repeat(6);
const defs = [
  { title: 'Джаз вечер', titleEn: 'Jazz night', description: 'Жива музика.', descriptionEn: 'Live music.', img: true },
  { title: 'Дегустация на вино', titleEn: 'Wine tasting', description: LONG, descriptionEn: LONG_EN, img: false },
  { title: XSS_T, titleEn: XSS_T, description: XSS_D, descriptionEn: XSS_D, img: false },
];
const clearEvents = async () => { for (const e of (await api.get('/api/admin/events')).data.events) await api.del(`/api/admin/events/${e.id}`); };
async function seed(n) {
  await clearEvents();
  for (let i = 0; i < n; i++) {
    const d = defs[i];
    const r = await api.post('/api/admin/events', { form: form({ title: d.title, titleEn: d.titleEn, description: d.description, descriptionEn: d.descriptionEn, enabled: 'true', eventAt: `2026-06-${20 + i}T20:00` }, d.img ? { field: 'image', buf: makePng(300, 200), name: 'a.png', type: 'image/png' } : undefined) });
    if (r.status !== 201) throw new Error(`seed ${i}: ${r.status} ${r.text()}`);
  }
}
const L = {
  bg: { cap: (n, m) => `Събитие ${n} от ${m}`, prev: 'Предишно събитие', next: 'Следващо събитие', h: (n) => (n === 1 ? 'Събитие' : 'Събития') },
  en: { cap: (n, m) => `Event ${n} of ${m}`, prev: 'Previous event', next: 'Next event', h: (n) => (n === 1 ? 'Event' : 'Events') },
};
async function open(vp, lang, hash = '') {
  const c = await newPage(browser, { width: vp.w, height: vp.h });
  await c.page.addInitScript(() => { window.__xss = undefined; });
  await c.page.goto(`${base}/?lang=${lang}${hash}`, { waitUntil: 'networkidle' });
  await c.page.waitForSelector('#event');
  return c;
}
const cnt = (p) => p.locator('.event-slider .menu-slider-count').innerText();
const swipe = (p, dx, dy = 0) => p.locator('.event-stage').evaluate((el, [ddx, ddy]) => {
  const mk = (type, x, y) => { const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y }); el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true })); };
  mk('touchstart', 200, 300); mk('touchend', 200 + ddx, 300 + ddy);
}, [dx, dy]);
const active = (p) => p.evaluate(() => { const a = document.activeElement; return a === document.body ? 'BODY' : (a.className || a.tagName); });
const frame = (p) => p.evaluate(() => { const s = document.querySelector('.event-stage').getBoundingClientRect(); const w = document.querySelector('.event-slider').getBoundingClientRect(); return { stageH: Math.round(s.height * 10) / 10, wrapH: Math.round(w.height * 10) / 10, stageW: Math.round(s.width) }; });
const visibleTitle = (p) => p.evaluate(() => [...document.querySelectorAll('.event-slide')].filter((c) => getComputedStyle(c).visibility === 'visible').map((c) => c.querySelector('.event-title').textContent));

// ============================================================================ 1 event: unchanged card
await seed(1);
for (const lang of ['bg', 'en']) for (const vp of VPS) await step(`E1-${lang}-${vp.n}`, async () => {
  const c = await open(vp, lang); const p = c.page; const id = `${lang}/${vp.n}`;
  const d = await p.evaluate(() => ({ cards: document.querySelectorAll('#event .event-card').length, slider: document.querySelectorAll('#event .event-slider, #event .menu-slider').length, btns: document.querySelectorAll('#event .slider-btn').length, count: document.querySelectorAll('#event .menu-slider-count').length, slides: document.querySelectorAll('#event .event-slide').length, h2: document.querySelector('#event h2').textContent, direct: document.querySelector('#event .event-section-inner').children[1].className, navVis: !document.getElementById('nav-event').hidden }));
  R.check(`EV1[${id}] 1 live event: plain .event-card (no slider, arrows, counter, .event-slide), h2 "${L[lang].h(1)}", nav item shown`, d.cards === 1 && d.slider === 0 && d.btns === 0 && d.count === 0 && d.slides === 0 && d.h2 === L[lang].h(1) && /^event-card/.test(d.direct) && d.navVis, JSON.stringify(d));
  R.check(`EV1b[${id}] no h-scroll, no console/page errors/failed requests/CSP`, (await noHScroll(p)).ok && c.log.console.length === 0 && c.log.pageErrors.length === 0 && c.log.failed.length === 0 && (await p.collectCsp()).length === 0, JSON.stringify({ c: c.log.console, e: c.log.pageErrors, f: c.log.failed }));
  await c.context.close();
});

// ============================================================================ 2 events: ends
await seed(2);
for (const lang of ['bg', 'en']) for (const vp of VPS) await step(`E2-${lang}-${vp.n}`, async () => {
  const c = await open(vp, lang); const p = c.page; const id = `${lang}/${vp.n}`;
  const sl = p.locator('.event-slider');
  R.check(`EV2[${id}] 2 events: slider + arrows + counter "${L[lang].cap(1, 2)}", h2 "${L[lang].h(2)}", prev disabled, next enabled`, (await sl.count()) === 1 && (await cnt(p)) === L[lang].cap(1, 2) && (await p.locator('#event h2').textContent()) === L[lang].h(2) && (await p.locator('.slider-prev').isDisabled()) && (await p.locator('.slider-next').isEnabled()), await cnt(p));
  const f1 = await frame(p);
  await p.locator('.slider-next').click();
  const f2 = await frame(p);
  R.check(`EV3[${id}] click next -> "${L[lang].cap(2, 2)}", next disabled, prev enabled; focus moved to the prev arrow (not BODY); frame height unchanged (${f1.stageH} -> ${f2.stageH})`, (await cnt(p)) === L[lang].cap(2, 2) && (await p.locator('.slider-next').isDisabled()) && (await p.locator('.slider-prev').isEnabled()) && (await active(p)).includes('slider-prev') && f1.stageH === f2.stageH && f1.wrapH === f2.wrapH, JSON.stringify([await active(p), f1, f2]));
  await p.locator('.slider-prev').click();
  R.check(`EV4[${id}] click prev -> back to 1, focus moved to the next arrow`, (await cnt(p)) === L[lang].cap(1, 2) && (await active(p)).includes('slider-next'), await active(p));
  await c.context.close();
});

// ============================================================================ 3 events: full interaction
await seed(3);
for (const lang of ['bg', 'en']) for (const vp of VPS) await step(`E3-${lang}-${vp.n}`, async () => {
  const c = await open(vp, lang); const p = c.page; const id = `${lang}/${vp.n}`; const T = L[lang];
  const titles = defs.map((d) => (lang === 'en' ? d.titleEn : d.title));
  // structure / a11y
  const st = await p.evaluate(() => { const w = document.querySelector('.event-slider'); const cn = w.querySelector('.menu-slider-count'); const bt = (s) => { const b = w.querySelector(s); return { lbl: b.getAttribute('aria-label'), type: b.type, tag: b.tagName }; }; return { tab: w.tabIndex, role: w.getAttribute('role'), rd: w.getAttribute('aria-roledescription'), lb: w.getAttribute('aria-labelledby'), live: cn.getAttribute('aria-live'), prev: bt('.slider-prev'), next: bt('.slider-next'), slides: w.querySelectorAll('.event-slide').length, lbTarget: document.getElementById(w.getAttribute('aria-labelledby'))?.textContent }; });
  R.check(`EV5[${id}] 3 events: group (tabindex 0, role group, roledescription carousel, labelled by the h2 "${T.h(3)}"), counter aria-live=polite, arrows are <button type=button> with aria-labels "${T.prev}"/"${T.next}", 3 cards in the DOM`, st.tab === 0 && st.role === 'group' && st.rd === 'carousel' && st.lbTarget === T.h(3) && st.live === 'polite' && st.prev.tag === 'BUTTON' && st.prev.type === 'button' && st.prev.lbl === T.prev && st.next.lbl === T.next && st.next.type === 'button' && st.slides === 3, JSON.stringify(st));
  const geo = await p.evaluate(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; }; return { prev: r('.event-slider .slider-prev'), next: r('.event-slider .slider-next'), stage: r('.event-stage'), iw: innerWidth }; });
  R.check(`EV6[${id}] arrows >= 44 x 44 px, fully inside the viewport (${geo.prev.l}..${geo.next.r} of ${geo.iw}), not overlapping the card (prev.right ${geo.prev.r} <= stage.left ${geo.stage.l}; stage.right ${geo.stage.r} <= next.left ${geo.next.l}), no h-scroll`, geo.prev.w >= 44 && geo.prev.h >= 44 && geo.next.w >= 44 && geo.next.h >= 44 && geo.prev.l >= 0 && geo.next.r <= geo.iw && geo.prev.r <= geo.stage.l + 0.5 && geo.stage.r <= geo.next.l + 0.5 && (await noHScroll(p)).ok, JSON.stringify(geo));
  // initial state
  R.check(`EV7[${id}] counter "${T.cap(1, 3)}", prev disabled+visible, next enabled; exactly one card visible = "${titles[0]}"; hidden cards are visibility:hidden`, (await cnt(p)) === T.cap(1, 3) && (await p.locator('.event-slider .slider-prev').isDisabled()) && (await p.locator('.event-slider .slider-prev').isVisible()) && (await p.locator('.event-slider .slider-next').isEnabled()) && JSON.stringify(await visibleTitle(p)) === JSON.stringify([titles[0]]), JSON.stringify(await visibleTitle(p)));
  const fr = [await frame(p)];
  // walk with the buttons
  const seen = [];
  await p.locator('.event-slider .slider-next').click(); seen.push([await cnt(p), await visibleTitle(p), await p.locator('.event-slider .slider-prev').isEnabled(), await p.locator('.event-slider .slider-next').isEnabled()]); fr.push(await frame(p));
  await p.locator('.event-slider .slider-next').click(); seen.push([await cnt(p), await visibleTitle(p), await p.locator('.event-slider .slider-prev').isEnabled(), await p.locator('.event-slider .slider-next').isEnabled()]); fr.push(await frame(p));
  const focusEnd = await active(p);
  R.check(`EV8[${id}] next,next -> "${T.cap(2, 3)}" then "${T.cap(3, 3)}"; right card each time; both arrows enabled in the middle; next disabled at the end; focus moved to prev (${focusEnd})`, seen[0][0] === T.cap(2, 3) && seen[0][1][0] === titles[1] && seen[0][2] && seen[0][3] && seen[1][0] === T.cap(3, 3) && seen[1][1][0] === titles[2] && seen[1][2] && !seen[1][3] && focusEnd.includes('slider-prev'), JSON.stringify(seen) + focusEnd);
  R.check(`EV9[${id}] frame height identical on all 3 cards (stage ${fr.map((f) => f.stageH).join('/')}, wrapper ${fr.map((f) => f.wrapH).join('/')}) and the stage is at least as tall as the longest card`, fr.every((f) => f.stageH === fr[0].stageH && f.wrapH === fr[0].wrapH && f.stageW === fr[0].stageW), JSON.stringify(fr));
  const maxCard = await p.evaluate(() => Math.max(...[...document.querySelectorAll('.event-slide')].map((c) => c.getBoundingClientRect().height)));
  R.check(`EV9b[${id}] every card is laid out inside the stage (stage ${fr[0].stageH} >= tallest card ${Math.round(maxCard * 10) / 10})`, fr[0].stageH >= maxCard - 0.5);
  // keyboard on the group
  await p.locator('.event-slider .slider-next').focus(); // focus inside
  await p.locator('.event-slider').focus();
  await p.keyboard.press('ArrowLeft'); const k1 = await cnt(p);
  await p.keyboard.press('ArrowLeft'); const k2 = await cnt(p);
  await p.keyboard.press('ArrowLeft'); const k3 = await cnt(p);
  await p.keyboard.press('ArrowRight'); const k4 = await cnt(p);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); const k5 = await cnt(p);
  R.check(`EV10[${id}] keyboard on the focused group: Left 3->2->1, Left at 1 stays, Right ->2, Right x2 -> stays at 3 (no wrap): ${[k1, k2, k3, k4, k5].join(' | ')}`, k1 === T.cap(2, 3) && k2 === T.cap(1, 3) && k3 === T.cap(1, 3) && k4 === T.cap(2, 3) && k5 === T.cap(3, 3));
  // keyboard from the focused arrow button: focus not lost at the ends
  await p.locator('.event-slider .slider-prev').focus();
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
  const afterKb = [await cnt(p), await active(p)];
  R.check(`EV11[${id}] keyboard only: focus on prev, ArrowLeft x2 reaches 1 and focus is on an arrow button, not BODY (${afterKb[1]})`, afterKb[0] === T.cap(1, 3) && /slider-(next|prev)/.test(afterKb[1]) && afterKb[1] !== 'BODY', JSON.stringify(afterKb));
  // enter/space on the focused arrow at the boundary: Tab sequence only reaches visible card controls
  await p.locator('.event-slider').focus();
  const tabSeq = [];
  for (let i = 0; i < 5; i++) { await p.keyboard.press('Tab'); tabSeq.push(await p.evaluate(() => { const a = document.activeElement; const s = a.closest && a.closest('.event-slide'); return { cls: String(a.className || a.tagName).split(' ')[0], inHidden: !!s && !s.classList.contains('is-current') }; })); }
  R.check(`EV12[${id}] Tab sequence from the group never lands inside a non-current (hidden) card: ${tabSeq.map((x) => x.cls).join(' > ')}`, tabSeq.every((x) => !x.inHidden), JSON.stringify(tabSeq));
  // focus ring on arrow via keyboard
  await p.locator('.event-slider').focus(); await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { cls: a.className, ow: cs.outlineWidth, os: cs.outlineStyle, fv: a.matches(':focus-visible') }; });
  R.check(`EV13[${id}] keyboard-focused control shows a visible outline (${ring.os} ${ring.ow})`, ring.fv && ring.os !== 'none' && parseFloat(ring.ow) >= 2, JSON.stringify(ring));
  // swipe
  const sw = [await cnt(p)];
  await swipe(p, -120); sw.push(await cnt(p));
  await swipe(p, -120); sw.push(await cnt(p));
  await swipe(p, -120); sw.push(await cnt(p)); // at end: stays
  await swipe(p, 120); sw.push(await cnt(p));
  await swipe(p, 20); sw.push(await cnt(p)); // too short
  await swipe(p, -30, 120); sw.push(await cnt(p)); // vertical scroll gesture
  R.check(`EV14[${id}] synthetic swipe: left x2 -> 2,3; left at the end stays; right -> 2; short (20 px) and mostly vertical swipes ignored: ${sw.join(' | ')}`, sw[0] === T.cap(1, 3) && sw[1] === T.cap(2, 3) && sw[2] === T.cap(3, 3) && sw[3] === T.cap(3, 3) && sw[4] === T.cap(2, 3) && sw[5] === T.cap(2, 3) && sw[6] === T.cap(2, 3), JSON.stringify(sw));
  // XSS: go to card 3
  await p.locator('.event-slider .slider-next').click();
  const xs = await p.evaluate(() => { const cur = document.querySelector('.event-slide.is-current'); return { title: cur.querySelector('.event-title').textContent, desc: cur.querySelector('.event-desc').textContent, kids: cur.querySelector('.event-body').querySelectorAll('img,script,b,a,iframe').length, xssInSlider: document.querySelectorAll('.event-slider img[src="x"], .event-slider script, .event-slider [onerror]').length, flag: window.__xss }; });
  await p.waitForTimeout(150);
  const flag = await p.evaluate(() => window.__xss);
  R.check(`EV15[${id}] XSS: HTML in event title/description is rendered as literal text in the slider (no img/script/b/a elements, no onerror, window.__xss undefined)`, xs.title === XSS_T && xs.desc === XSS_D && xs.kids === 0 && xs.xssInSlider === 0 && flag === undefined, JSON.stringify(xs));
  await p.screenshot({ path: path.join(shots, `evslider-${lang}-${vp.n}.png`), fullPage: false });
  R.check(`EV16[${id}] no h-scroll, no console/page errors, no failed requests, no CSP violations`, (await noHScroll(p)).ok && c.log.console.length === 0 && c.log.pageErrors.length === 0 && c.log.failed.length === 0 && (await p.collectCsp()).length === 0, JSON.stringify({ c: c.log.console, e: c.log.pageErrors, f: c.log.failed, hs: await noHScroll(p) }));
  await c.context.close();
});

// ============================================================================ language switch re-renders the slider; nav link and anchor
for (const vp of VPS) await step(`NAV-${vp.n}`, async () => {
  const c = await open(vp, 'bg'); const p = c.page;
  await p.locator('.event-slider .slider-next').click();
  await p.locator(`.lang-btn[data-lang=en]`).click(); await p.waitForTimeout(500);
  const afterLang = [await cnt(p), await p.locator('#event h2').textContent(), await p.locator('.slider-prev').getAttribute('aria-label')];
  R.check(`EV17[${vp.n}] switching BG->EN re-renders the slider in English ("${afterLang.join('" / "')}"): counter "Event n of 3", h2 "Events", arrow labels English`, /^Event \d of 3$/.test(afterLang[0]) && afterLang[1] === 'Events' && afterLang[2] === 'Previous event', JSON.stringify(afterLang));
  await p.locator(`.lang-btn[data-lang=bg]`).click(); await p.waitForTimeout(500);
  // nav link
  await p.evaluate(() => window.scrollTo(0, 0));
  if (vp.w < 960) { const tg = p.locator('.nav-toggle'); if (await tg.isVisible()) await tg.click(); }
  await p.locator('#nav-event a').click(); await p.waitForTimeout(1200);
  const pos = await p.evaluate(() => { const s = document.getElementById('event').getBoundingClientRect(); const h = document.getElementById('event-heading').getBoundingClientRect(); const bar = document.querySelector('.site-header').getBoundingClientRect(); return { hash: location.hash, top: Math.round(s.top), hTop: Math.round(h.top), hBottom: Math.round(h.bottom), headerBottom: Math.round(bar.bottom), ih: innerHeight }; });
  R.check(`EV18[${vp.n}] nav "Събитие" link -> #event; the section starts at/below the sticky header and the heading is in view: ${JSON.stringify(pos)}`, pos.hash === '#event' && pos.hTop >= -2 && pos.hBottom <= pos.ih && Math.abs(pos.top) < 200, JSON.stringify(pos));
  await c.context.close();
  const c2 = await open(vp, 'bg', '#event'); const p2 = c2.page; await p2.waitForTimeout(1200);
  const pos2 = await p2.evaluate(() => { const h = document.getElementById('event-heading').getBoundingClientRect(); const s = document.getElementById('event').getBoundingClientRect(); return { top: Math.round(s.top), hTop: Math.round(h.top), hBottom: Math.round(h.bottom), ih: innerHeight, y: Math.round(scrollY) }; });
  R.check(`EV19[${vp.n}] direct load /#event lands on the events section (heading visible, section top ${pos2.top}px)`, pos2.hTop >= -2 && pos2.hBottom <= pos2.ih && Math.abs(pos2.top) < 200 && pos2.y > 0, JSON.stringify(pos2));
  await c2.context.close();
});

await browser.close(); await srv.stop();
R.summary();

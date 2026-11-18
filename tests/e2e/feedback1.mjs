// T-29 owner feedback round 1 (D-34..D-38), public side: sticky reservation top bar, /reservation page, Location section,
// Instagram links (placeholder / configured / lookalike + XSS). Ports 3204 (main), 3206 (fresh DB), 3207 (SITE_URL set).
// Run: node tests/e2e/feedback1.mjs
import fs from 'node:fs';
import path from 'node:path';
import { startServer, createAdmin, Client, tmpDir, reporter } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir, contrast } from '../lib/browser.mjs';

const R = reporter('feedback1');
const T0 = '2026-06-15T10:00:00Z';
const PHONE = '+359 88 123 4567';
const TEL = 'tel:+359881234567';
const ADDR_BG = 'ул. Витоша 1, София';
const ADDR_EN = '1 Vitosha St, Sofia';
const DEF_BG = 'ул. Ралевица 85, София';
const DEF_EN = '85 Ralevitsa St, Sofia';
const MAP = 'https://maps.app.goo.gl/EQuhsMqma6TcmRqs9'; // fixed pin (D-59)
const IG_DEFAULT = 'https://www.instagram.com/';
const shots = shotDir();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.message).split('\n').slice(0, 3).join(' ')); } };
const browser = await chromium.launch();

// ---------------------------------------------------------------- server A (settings changed during the run)
const dirA = tmpDir('fb1a'); createAdmin(dirA);
const srvA = await startServer({ port: 3204, dataDir: dirA, now: T0 });
const base = srvA.url;
const admin = new Client(base); await admin.login();
const anon = new Client(base);
const setSettings = (o) => admin.put('/api/admin/settings', { json: o });
await setSettings({ reservationPhone: PHONE, address: ADDR_BG, addressEn: ADDR_EN, openingHours: 'Пн-Нд 10:00-22:00', openingHoursEn: 'Mon-Sun 10:00-22:00' });

const dirC = tmpDir('fb1c'); createAdmin(dirC);
const srvC = await startServer({ port: 3207, dataDir: dirC, now: T0, env: { SITE_URL: 'https://kota1.example' } });

const VPS = [320, 390, 768, 1280].map((w) => ({ w, h: w < 700 ? 800 : w < 1000 ? 1024 : 800 }));
const ROUTES = [['/', 'index'], ['/daily-menu', 'daily'], ['/reservation', 'reservation'], ['/privacy', 'privacy'], ['/no-such-page-qa', '404']];
// the browser reports the intentional 404 document load of /no-such-page-qa as a console error; that single URL is expected
const clean = async (page, log) => log.console.filter((m) => !/status of 404 .*\/no-such-page-qa/.test(m)).length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && (await page.collectCsp()).length === 0;

// ================================================================ TB: sticky top bar
for (const withPhone of [true, false]) {
  await setSettings({ reservationPhone: withPhone ? PHONE : '' });
  const st = withPhone ? 'phone' : 'nophone';
  for (const vp of VPS) {
    for (const lang of ['bg', 'en']) {
      await step(`TB[${st} ${lang} ${vp.w}]`, async () => {
        const { context, page, log } = await newPage(browser, { width: vp.w, height: vp.h });
        for (const [route, name] of ROUTES) {
          const id = `${st} ${lang} ${vp.w} ${name}`;
          const resp = await page.goto(base + route + (route.includes('?') ? '&' : '?') + `lang=${lang}`, { waitUntil: 'networkidle' });
          await page.waitForTimeout(150);
          if (name === '404') R.check(`TB0[${id}] unknown page answers HTTP 404 with the HTML 404 page`, resp.status() === 404 && (await page.locator('body[data-page=notfound]').count()) === 1, String(resp.status()));
          const d = await page.evaluate(() => {
            const bar = document.getElementById('top-bar'); const a = document.getElementById('top-phone'); const label = document.getElementById('top-label');
            const r = bar.getBoundingClientRect(); const ar = a.getBoundingClientRect(); const cs = getComputedStyle(bar);
            return { n: document.querySelectorAll('#top-bar').length, pos: cs.position, topCss: cs.top, display: cs.display, top: r.top, h: r.height, right: r.right, left: r.left,
              first: document.body.children[1] === bar || document.body.children[0] === bar, label: label.hidden ? '' : label.textContent.trim(), labelDisp: getComputedStyle(label).display,
              txt: a.textContent.trim(), href: a.getAttribute('href'), ah: ar.height, aw: ar.width, ar: ar.right, al: ar.left, scrollable: document.documentElement.scrollHeight > innerHeight + 50 };
          });
          const expLabel = lang === 'en' ? 'For reservations & orders:' : 'За резервации и поръчки:'; // D-64
          if (withPhone) R.check(`TB1[${id}] bar shown: "${expLabel} ${PHONE}" with a tel: link`, d.n === 1 && d.display !== 'none' && d.label === expLabel && d.txt === PHONE && d.href === TEL, JSON.stringify(d));
          else {
            const u = new URL(d.href, base);
            R.check(`TB1[${id}] no phone: bar still shown, text "${lang === 'en' ? 'Reservations & orders' : 'Резервации и поръчки'}" linking to /reservation (lang kept), label hidden`, d.n === 1 && d.display !== 'none' && d.txt === (lang === 'en' ? 'Reservations & orders' : 'Резервации и поръчки') && u.pathname === '/reservation' && (lang === 'en' ? u.searchParams.get('lang') === 'en' : !u.searchParams.get('lang')) && d.labelDisp === 'none', JSON.stringify(d));
          }
          R.check(`TB2[${id}] bar is sticky (position ${d.pos}, top ${d.topCss}), at y=0 on load, inside the viewport (${Math.round(d.left)}-${Math.round(d.right)} of ${vp.w}), link target >= 44 px tall, bar height <= 52 px (the --topbar-h that offsets the sticky category chips)`, d.pos === 'sticky' && d.topCss === '0px' && d.top === 0 && d.h <= 52.5 && d.left >= 0 && d.right <= vp.w && d.ar <= vp.w && d.al >= 0 && d.ah >= 44, JSON.stringify(d));
          R.check(`TB3[${id}] top bar is the first element after the skip link (above the header)`, d.first);
          // scroll: stays at the top, nothing paints over it
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForTimeout(120);
          const s = await page.evaluate(() => { const bar = document.getElementById('top-bar'); const r = bar.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { top: r.top, y: window.scrollY, hit: !!hit && bar.contains(hit) }; });
          R.check(`TB4[${id}] after scrolling to the bottom (scrollY ${Math.round(s.y)}${d.scrollable ? '' : ', page too short to scroll'}) the bar is still at top 0 and on top of the content`, s.top === 0 && s.hit, JSON.stringify(s));
          await page.evaluate(() => window.scrollTo(0, 0));
          const nh = await noHScroll(page);
          R.check(`TB5[${id}] no horizontal scroll`, nh.ok, `${nh.sw}/${nh.iw}`);
          R.check(`TB6[${id}] no console/page errors, failed requests or CSP violations`, await clean(page, log), JSON.stringify(log.console.concat(log.pageErrors, log.failed)).slice(0, 200));
          if (name === 'index' && !withPhone && vp.w === 390) await page.screenshot({ path: path.join(shots, `fb1-topbar-nophone-${lang}.png`) });
          if (name === 'index' && withPhone && vp.w === 320) await page.screenshot({ path: path.join(shots, `fb1-topbar-phone-${lang}-320.png`) });
        }
        await context.close();
      });
    }
  }
}

// anchors are not hidden behind the sticky bar; language switch updates the bar
await setSettings({ reservationPhone: PHONE });
for (const vp of VPS) await step(`TBA[${vp.w}]`, async () => {
  const { context, page } = await newPage(browser, { width: vp.w, height: vp.h });
  for (const id of ['menu', 'about', 'location', 'contact']) {
    await page.goto(base + `/#${id}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
    const m = await page.evaluate((i) => ({ h2: document.querySelector(`#${i} h2`).getBoundingClientRect().top, bar: document.getElementById('top-bar').getBoundingClientRect().bottom }), id);
    R.check(`TBA1[${vp.w}] /#${id}: section heading is below the sticky top bar after the anchor jump (h2.top ${Math.round(m.h2)} >= bar.bottom ${Math.round(m.bar)})`, m.h2 >= m.bar - 1, JSON.stringify(m));
  }
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.locator('.lang-btn[data-lang=en]').click(); await page.waitForTimeout(400);
  R.check(`TBA2[${vp.w}] BG->EN on the page re-renders the bar ("For reservations & orders:") and keeps the tel link`, (await page.locator('#top-label').innerText()) === 'For reservations & orders:' && (await page.getAttribute('#top-phone', 'href')) === TEL);
  await setSettings({ reservationPhone: '' });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const rd = () => page.evaluate(() => ({ t: document.getElementById('top-phone').textContent, h: document.getElementById('top-phone').getAttribute('href'), l: getComputedStyle(document.getElementById('top-label')).display }));
  await page.locator('.lang-btn[data-lang=en]').click(); await page.waitForTimeout(400);
  const n1 = await rd();
  await page.locator('.lang-btn[data-lang=bg]').click(); await page.waitForTimeout(400);
  const n2 = await rd();
  R.check(`TBA3[${vp.w}] no phone: language switch BG->EN->BG re-translates the bar ("Reservations & orders" -> "Резервации и поръчки") and keeps the /reservation link (lang param follows), label stays hidden, no tel link`, n1.t === 'Reservations & orders' && /^\/reservation\?lang=en$/.test(n1.h) && n2.t === 'Резервации и поръчки' && n2.h === '/reservation' && n1.l === 'none' && n2.l === 'none' && (await page.locator('a[href^="tel:"]:not([hidden])').count()) === 0, JSON.stringify([n1, n2]));
  await setSettings({ reservationPhone: PHONE });
  await context.close();
});

// ================================================================ RES: reservation page
const cyrIn = (s) => /[А-Яа-яЁё]/.test(s);
for (const vp of [390, 768, 1280].map((w) => ({ w, h: w < 700 ? 844 : w < 1000 ? 1024 : 800 }))) {
  for (const lang of ['bg', 'en']) await step(`RES[${lang} ${vp.w}]`, async () => {
    const en = lang === 'en'; const id = `${lang} ${vp.w}`;
    const { context, page, log } = await newPage(browser, { width: vp.w, height: vp.h });
    const reqs = []; context.on('request', (r) => reqs.push(r.url()));
    await setSettings({ reservationPhone: PHONE, address: ADDR_BG, addressEn: ADDR_EN, openingHours: 'Пн-Нд 10:00-22:00', openingHoursEn: 'Mon-Sun 10:00-22:00' });
    const resp = await page.goto(base + '/reservation' + (en ? '?lang=en' : ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
    R.check(`RES1[${id}] /reservation: HTTP 200 text/html, one h1 "${en ? 'Reservations & orders' : 'Резервации и поръчки'}", html lang=${lang}, title`, resp.status() === 200 && /text\/html/.test(resp.headers()['content-type'] || '') && (await page.locator('h1').count()) === 1 && (await page.locator('h1').innerText()).toLowerCase() === (en ? 'reservations & orders' : 'резервации и поръчки') && (await page.getAttribute('html', 'lang')) === lang && (await page.title()) === (en ? 'Reservations & orders — Kota1 Restaurant' : 'Резервации и поръчки — Kota1 Restaurant'), `${resp.status()} ${await page.title()}`);
    // heading order
    const hs = await page.$$eval('h1,h2,h3', (e) => e.map((x) => +x.tagName[1]));
    R.check(`RES2[${id}] heading order has no skipped levels`, hs.every((l, i) => i === 0 ? l === 1 : l - hs[i - 1] <= 1), hs.join(''));
    // floor plan
    const svg = await page.evaluate(() => {
      const s = document.getElementById('plan-svg'); const lb = (s.getAttribute('aria-labelledby') || '').split(/\s+/).map((i) => document.getElementById(i));
      const tbls = [...s.querySelectorAll('g.tbl')].map((g) => { const sh = g.querySelector('circle, rect'); return { n: g.querySelector('text').textContent.trim(), shape: sh.tagName === 'circle' ? 'round' : (Math.max(+sh.getAttribute('width'), +sh.getAttribute('height')) / Math.min(+sh.getAttribute('width'), +sh.getAttribute('height')) < 1.15 ? 'square' : 'long') }; });
      const list = [...document.querySelectorAll('#plan-tables li')].map((li) => li.textContent.trim());
      const lr = document.getElementById('plan-tables').getBoundingClientRect(); const sr = s.getBoundingClientRect();
      return { role: s.getAttribute('role'), focusable: s.getAttribute('focusable'), titles: lb.map((e) => e && e.tagName + ':' + e.textContent.trim()), tbls, list, listW: lr.width, listH: lr.height, svgW: sr.width, svgH: sr.height, svgR: sr.right,
        legend: [...document.querySelectorAll('#plan-legend li')].map((l) => l.textContent.trim()), note: document.querySelector('.plan-note').textContent.trim(), labels: [...s.querySelectorAll('.plan-label')].map((t) => t.textContent.trim()),
        interactive: s.querySelectorAll('a, button, [tabindex], [onclick]').length, windows: s.querySelectorAll('.plan-window').length, door: s.querySelectorAll('.plan-door').length, bar: s.querySelectorAll('.plan-bar').length, shapes: { round: 0 } };
    });
    R.check(`RES3[${id}] floor plan SVG: role=img with aria-labelledby -> <title> + <desc> (non-empty, ${en ? 'English' : 'Bulgarian'}), not focusable, no interactive children`, svg.role === 'img' && svg.titles.length === 2 && svg.titles[0].startsWith('title:') && svg.titles[1].startsWith('desc:') && svg.titles.every((t) => t && t.length > 12) && svg.focusable === 'false' && svg.interactive === 0 && (en ? !svg.titles.some(cyrIn) : true), JSON.stringify(svg.titles));
    const NUMS = Array.from({ length: 14 }, (_, i) => String(102 + i));
    R.check(`RES4[${id}] plan has 14 numbered tables 102..115 (square/long only, no round), one entrance, one bar, no windows`, svg.tbls.length === 14 && svg.tbls.map((t) => t.n).join() === NUMS.join() && svg.tbls.every((t) => t.shape !== 'round') && svg.door === 1 && svg.windows === 0 && svg.bar === 1 && svg.labels.length === 2, JSON.stringify(svg.tbls.map((t) => t.n + t.shape[0])));
    const re = en ? /^Table (\d+), (square|long)$/ : /^Маса (\d+), (квадратна|дълга)$/;
    const kind = { square: ['square', 'квадратна'], long: ['long', 'дълга'] };
    const nOk = svg.list.length === 14 && svg.list.every((t, i) => { const m = re.exec(t); return m && +m[1] === +svg.tbls[i].n; });
    R.check(`RES5[${id}] hidden text alternative: list of 14 tables, each item matches the SVG table number (102..115)`, nOk, svg.list.join(' | '));
    const shOk = svg.list.every((t, i) => { const m = re.exec(t); return m && m[2] === kind[svg.tbls[i].shape][en ? 0 : 1]; });
    R.check(`RES5b[${id}] hidden list shape word (square/long) agrees with the drawn shape (aspect < 1.15 = square)`, shOk, svg.list.map((t, i) => t.split(', ')[1] === kind[svg.tbls[i].shape][en ? 0 : 1] ? '' : `${svg.tbls[i].n}: list "${t.split(', ')[1]}" vs drawn ${svg.tbls[i].shape}`).filter(Boolean).join('; '));
    R.check(`RES6[${id}] table list is visually hidden (1x1 clip) yet in the DOM/accessibility tree (not display:none); plan fits the viewport (svg ${Math.round(svg.svgW)}x${Math.round(svg.svgH)})`, svg.listW <= 2 && svg.listH <= 2 && (await page.locator('#plan-tables').evaluate((e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden')) && svg.svgR <= vp.w && svg.svgW > 200, `${svg.listW}x${svg.listH}`);
    R.check(`RES7[${id}] legend has 4 entries (square/long/bar/entrance); caption shown; labels ${svg.labels.join('/')}`, svg.legend.length === 4 && svg.note === (en ? 'Mention the table number when you book by phone.' : 'Посочете номера на масата, когато резервирате по телефона.') && svg.labels.slice().sort().join() === (en ? ['Bar', 'Entrance'] : ['Бар', 'Вход']).join(), JSON.stringify([svg.legend, svg.note]));
    // contrast of plan text (computed fills)
    const cc = await page.evaluate(() => { const g = (el, p) => getComputedStyle(el)[p]; const t = document.querySelector('.plan-svg .tbl text'); const sh = document.querySelector('.plan-svg .tbl circle, .plan-svg .tbl rect'); const lab = document.querySelector('.plan-svg .plan-label'); const bar = document.querySelector('.plan-svg .plan-bar'); return { num: [g(t, 'fill'), g(sh, 'fill')], lab: [g(lab, 'fill'), g(bar, 'fill')], floor: [g(lab, 'fill'), getComputedStyle(document.querySelector('.plan-floor')).fill] }; });
    R.check(`RES8[${id}] contrast: table number ${cc.num[0]} on ${cc.num[1]} = ${contrast(...cc.num).toFixed(2)}, bar label ${contrast(...cc.lab).toFixed(2)}, entrance label ${contrast(...cc.floor).toFixed(2)} (all >= 4.5)`, [cc.num, cc.lab, cc.floor].every((p) => contrast(...p) >= 4.5), JSON.stringify(cc));
    // call button
    const call = await page.evaluate(() => { const a = document.getElementById('res-call'); const r = a.getBoundingClientRect(); return { hidden: a.hidden, vis: r.width > 0, href: a.getAttribute('href'), text: a.textContent.replace(/\s+/g, ' ').trim(), h: r.height, w: r.width, right: r.right, note: document.getElementById('res-nophone').hidden }; });
    R.check(`RES9[${id}] phone set: big call button "${en ? 'Call us' : 'Обадете се'} ${PHONE}" -> ${TEL}, >= 44 px, inside viewport; no-phone note hidden`, !call.hidden && call.vis && call.href === TEL && call.text === (en ? 'Call us' : 'Обадете се') + PHONE && call.h >= 44 && call.right <= vp.w && call.note === true, JSON.stringify(call));
    // location
    const loc = await page.evaluate(() => { const a = document.querySelector('#location-list a.map-link'); return { addr: document.querySelector('#location-list .address-text')?.textContent, href: a?.getAttribute('href'), target: a?.target, rel: a?.rel, hours: document.querySelector('#location-list dd.hours')?.textContent, h2: document.getElementById('res-loc-heading').textContent, n: document.querySelectorAll('a.map-link').length }; });
    R.check(`RES10[${id}] location: address "${en ? ADDR_EN : ADDR_BG}", opening hours, ONE map link to the fixed Google Maps pin, target=_blank rel=noopener noreferrer`, loc.addr === (en ? ADDR_EN : ADDR_BG) && loc.href === MAP && loc.target === '_blank' && /noopener/.test(loc.rel) && /noreferrer/.test(loc.rel) && loc.n === 1 && loc.hours === (en ? 'Mon-Sun 10:00-22:00' : 'Пн-Нд 10:00-22:00') && loc.h2 === (en ? 'Location' : 'Локация'), JSON.stringify(loc));
    const ext = reqs.filter((u) => new URL(u).origin !== base);
    R.check(`RES11[${id}] no third-party request while loading the page (no map embed, no fonts CDN)`, ext.length === 0, ext.join(' '));
    R.check(`RES12[${id}] no console/page errors, failed requests or CSP violations; no horizontal scroll`, (await clean(page, log)) && (await noHScroll(page)).ok, JSON.stringify(log.console.concat(log.pageErrors, log.failed)));
    if (en) R.check(`RES13[${id}] English page has no Cyrillic in visible text, aria-labels, title/desc (except the owner's BG data fields)`, !cyrIn((await page.evaluate(() => document.body.innerText.replace(/БГ/g, '') + [...document.querySelectorAll('[aria-label],title,desc')].map((e) => e.getAttribute('aria-label') || e.textContent).join(' '))).replace(ADDR_BG, '')), '');
    // links in hero/nav of the other pages go here
    await page.screenshot({ path: path.join(shots, `fb1-reservation-${lang}-${vp.w}.png`), fullPage: true });
    // keyboard: all focus stops visible and none inside the SVG
    await page.evaluate(() => document.body.focus());
    const stops = [];
    for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); const st = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { insideSvg: !!e.closest('svg'), tag: e.tagName, vis: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 || cs.boxShadow !== 'none' }; }); if (st.tag === 'BODY') break; stops.push(st); }
    R.check(`RES14[${id}] keyboard: ${stops.length} Tab stops through the page (skip link ... footer), none inside the SVG, every focused control shows a focus indicator`, stops.length >= 8 && stops.every((s) => !s.insideSvg && s.vis), JSON.stringify(stops.filter((s) => s.insideSvg || !s.vis)));
    await context.close();
  });
}

// no phone state on the reservation page
for (const lang of ['bg', 'en']) await step(`RESN[${lang}]`, async () => {
  await setSettings({ reservationPhone: '' });
  const { context, page, log } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(base + '/reservation?lang=' + lang, { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
  const d = await page.evaluate(() => ({ callHidden: document.getElementById('res-call').hidden, callVis: document.getElementById('res-call').getBoundingClientRect().width > 0, note: document.getElementById('res-nophone').textContent.trim(), noteVis: document.getElementById('res-nophone').getBoundingClientRect().width > 0, tel: document.querySelectorAll('a[href^="tel:"]:not([hidden])').length, plan: !!document.getElementById('plan-svg') && document.querySelectorAll('#plan-tables li').length, map: document.querySelectorAll('a.map-link').length }));
  R.check(`RESN1[${lang}] no phone: call button hidden, note "${lang === 'en' ? 'The reservation phone number will be added soon.' : 'Телефонът за резервации ще бъде добавен скоро.'}" visible, no visible tel: link anywhere (the hidden contact-call/res-call anchors keep an empty "tel:" href), plan + location still shown`, d.callHidden && !d.callVis && d.noteVis && d.note === (lang === 'en' ? 'The reservation phone number will be added soon.' : 'Телефонът за резервации ще бъде добавен скоро.') && d.tel === 0 && d.plan === 14 && d.map === 1, JSON.stringify(d));
  R.check(`RESN2[${lang}] no console errors`, await clean(page, log));
  await page.screenshot({ path: path.join(shots, `fb1-reservation-nophone-${lang}.png`), fullPage: true });
  await context.close();
  await setSettings({ reservationPhone: PHONE });
});

// reservation button/link in hero + nav everywhere; map: nav "Локация"/"Location" link
for (const lang of ['bg', 'en']) for (const vp of [390, 1280]) await step(`NAV[${lang} ${vp}]`, async () => {
  const { context, page } = await newPage(browser, { width: vp, height: 844 });
  for (const [route, name] of ROUTES) {
    await page.goto(base + route + `?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(200);
    if (vp < 700) await page.locator('#nav-toggle').click();
    const nav = await page.evaluate(() => { const a = document.querySelector('.nav-reservation a'); const l = document.querySelector('#site-nav a[href*="#location"]'); const r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), text: a.textContent.trim(), vis: r.width > 0 && r.height > 0, h: r.height, loc: l && l.getAttribute('href'), locText: l && l.textContent.trim() }; });
    R.check(`NAV1[${lang} ${vp} ${name}] nav has visible "${lang === 'en' ? 'Reservation' : 'Резервация'}" link (>= 44 px) -> /reservation${lang === 'en' ? '?lang=en' : ''} and a "${lang === 'en' ? 'Location' : 'Локация'}" link to /#location`, nav.vis && nav.h >= 44 && nav.text === (lang === 'en' ? 'Reservation' : 'Резервация') && nav.href === '/reservation' + (lang === 'en' ? '?lang=en' : '') && nav.locText === (lang === 'en' ? 'Location' : 'Локация') && nav.loc.startsWith('/') && nav.loc.includes('#location'), JSON.stringify(nav));
  }
  await page.goto(base + `/?lang=${lang}`, { waitUntil: 'networkidle' });
  const hero = await page.evaluate(() => { const a = document.getElementById('hero-book'); const r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), t: a.textContent.trim(), h: r.height }; });
  R.check(`NAV2[${lang} ${vp}] hero button "${lang === 'en' ? 'Reservation' : 'Резервация'}" -> /reservation, >= 44 px`, hero.t === (lang === 'en' ? 'Reservation' : 'Резервация') && hero.href === '/reservation' + (lang === 'en' ? '?lang=en' : '') && hero.h >= 44, JSON.stringify(hero));
  await Promise.all([page.waitForURL(/\/reservation/), page.locator('#hero-book').click()]);
  R.check(`NAV3[${lang} ${vp}] clicking the hero button opens the reservation page in ${lang.toUpperCase()}`, (await page.getAttribute('html', 'lang')) === lang && (await page.locator('#plan-svg').count()) === 1);
  await context.close();
});

// ================================================================ IG: instagram links
const IGPAGES = ['/', '/daily-menu', '/reservation', '/privacy', '/no-such-page-qa'];
const igState = (page) => page.evaluate(() => [...document.querySelectorAll('a.ig-link')].map((a) => { const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return { href: a.getAttribute('href'), abs: a.href, target: a.target, rel: a.rel, name: a.getAttribute('aria-label'), w: r.width, h: r.height, svgHidden: a.querySelector('svg')?.getAttribute('aria-hidden'), where: a.closest('footer') ? 'footer' : a.closest('#contact') ? 'contact' : 'other', color: cs.color, vis: r.width > 0, parent: a.parentElement.className }; }));
const bgOf = (page, sel) => page.locator(sel).first().evaluate((el) => { let n = el; while (n) { const c = getComputedStyle(n).backgroundColor; const m = c.match(/[\d.]+/g).map(Number); if ((m[3] ?? 1) > 0) return c; n = n.parentElement; } return 'rgb(255, 255, 255)'; });
await setSettings({ instagramUrl: '' });
for (const vp of [390, 768, 1280]) for (const lang of ['bg', 'en']) await step(`IG1[${lang} ${vp}]`, async () => {
  const { context, page, log } = await newPage(browser, { width: vp, height: 844 });
  const reqs = []; context.on('request', (r) => reqs.push(r.url()));
  for (const route of IGPAGES) {
    await page.goto(base + route + `?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(200);
    const igs = await igState(page);
    const where = igs.map((i) => i.where).sort().join();
    R.check(`IG1[${lang} ${vp} ${route}] placeholder (setting empty): ${route === '/' ? 'icon in contact AND footer' : 'icon in footer'}, all link to ${IG_DEFAULT}, accessible name "Instagram", target=_blank rel noopener+noreferrer, >= 44x44, svg aria-hidden`,
      where === (route === '/' ? 'contact,footer' : 'footer') && igs.every((i) => i.href === IG_DEFAULT && i.name === 'Instagram' && i.target === '_blank' && /noopener/.test(i.rel) && /noreferrer/.test(i.rel) && i.w >= 44 && i.h >= 44 && i.svgHidden === 'true' && i.vis), JSON.stringify(igs.map((i) => [i.where, i.href, Math.round(i.w), Math.round(i.h)])));
  }
  const ig = (await igState(page))[0];
  await page.goto(base + `/?lang=${lang}`, { waitUntil: 'networkidle' });
  for (const sel of ['#contact a.ig-link', 'footer a.ig-link']) { const fg = (await igState(page)).find((i) => sel.includes(i.where)).color; const bg = await bgOf(page, sel); R.check(`IG2[${lang} ${vp}] ${sel} icon contrast ${fg} on ${bg} = ${contrast(fg, bg).toFixed(2)} (>= 3 for UI graphics)`, contrast(fg, bg) >= 3); }
  // keyboard focus visible
  await page.focus('#contact a.ig-link'); const fo = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { o: cs.outlineStyle, w: parseFloat(cs.outlineWidth), shadow: cs.boxShadow }; });
  R.check(`IG3[${lang} ${vp}] contact icon shows a visible keyboard focus indicator`, (fo.o !== 'none' && fo.w >= 2) || fo.shadow !== 'none', JSON.stringify(fo));
  R.check(`IG4[${lang} ${vp}] page load makes no request to instagram.com (link only, no embed/script); no console errors`, reqs.every((u) => new URL(u).origin === base) && (await clean(page, log)), reqs.filter((u) => new URL(u).origin !== base).join());
  // click opens a NEW tab, current page stays, noopener
  await context.route('https://www.instagram.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'stub' }));
  const [pop] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), page.locator('footer a.ig-link').click()]);
  if (pop) await pop.waitForLoadState().catch(() => {});
  R.check(`IG5[${lang} ${vp}] click on the footer icon opens https://www.instagram.com/ in a new tab; opener not exposed; page stays`, !!pop && pop.url() === IG_DEFAULT && page.url().startsWith(base + '/') && (await pop.evaluate(() => window.opener === null)), pop && pop.url());
  if (vp === 390 && lang === 'bg') await page.screenshot({ path: path.join(shots, 'fb1-instagram-390.png'), fullPage: true });
  await context.close();
});

// configured profile reaches every icon on every page
const IG_SET = 'https://www.instagram.com/kota1.restaurant/';
await step('IG6', async () => {
  const r = await setSettings({ instagramUrl: IG_SET });
  R.check('IG6a admin saves instagramUrl; GET /api/public/site returns it (bg and en); admin GET returns it', r.status === 200 && r.data.instagramUrl === IG_SET && (await anon.get('/api/public/site')).data.instagramUrl === IG_SET && (await anon.get('/api/public/site?lang=en')).data.instagramUrl === IG_SET && (await admin.get('/api/admin/settings')).data.instagramUrl === IG_SET, JSON.stringify(r.data));
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  for (const route of IGPAGES) for (const lang of ['bg', 'en']) {
    await page.goto(base + route + `?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(150);
    const igs = await igState(page);
    R.check(`IG6b[${route} ${lang}] configured profile on every icon (${igs.length}), still target=_blank rel=noopener noreferrer`, igs.length >= 1 && igs.every((i) => i.href === IG_SET && i.target === '_blank' && /noopener/.test(i.rel)), JSON.stringify(igs.map((i) => i.href)));
  }
  // clearing it returns to the placeholder without a restart
  await setSettings({ instagramUrl: '' });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  R.check('IG6c clearing the setting -> icons point to the placeholder again', (await igState(page)).every((i) => i.href === IG_DEFAULT));
  await context.close();
});

// server-side validation matrix (live server)
await step('IG7', async () => {
  await setSettings({ instagramUrl: IG_SET });
  const OK = ['https://www.instagram.com/kota1/', 'https://instagram.com/kota1', 'https://www.instagram.com/', 'https://instagram.com', 'https://WWW.INSTAGRAM.COM/Kota1', 'https://www.instagram.com/kota1/?hl=bg', 'https://www.instagram.com/' + 'a'.repeat(200 - 26), ''];
  for (const v of OK) { const r = await setSettings({ instagramUrl: v }); R.check(`IG7a accepted: ${JSON.stringify(v).slice(0, 60)} (len ${v.length})`, r.status === 200 && r.data.instagramUrl === v, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`); }
  await setSettings({ instagramUrl: IG_SET });
  const BAD = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://www.instagram.com/x', 'http://instagram.com/x', '//www.instagram.com/x', 'instagram.com/x', 'www.instagram.com/x', '@kota1',
    'https://instagram.com.evil.com/x', 'https://www.instagram.com.evil.com/', 'https://evil.com/www.instagram.com/', 'https://evil.com/?u=https://www.instagram.com/', 'https://evil.com#www.instagram.com', 'https://www.instagram.com@evil.com/', 'https://user@www.instagram.com/', 'https://user:pw@www.instagram.com/',
    'https://www.instagram.com:8443/x', 'https://www.instagram.com\\@evil.com/', 'https://www.instagram.com\\.evil.com/', 'https://evil.com\\.instagram.com/', 'https://notinstagram.com/', 'https://xinstagram.com/', 'https://m.instagram.com/x', 'https://l.instagram.com/x', 'https://www.instagram.com.:80/', 'https://instagram.com./x',
    'https://www.instagram.com/x y', 'https://www.instagram.com/x\ny', 'https://www.instagram.com/x\ty', ' https://www.instagram.com/x y', 'https://www.instagram.com/' + 'a'.repeat(200 - 25), 'https://www.instagram.com/' + 'a'.repeat(400), 'ftp://www.instagram.com/x', 'https://', 'https://www.instagram.com%2f@evil.com/', 'https://www.instagram.com%00.evil.com/'];
  const rows = [];
  for (const v of BAD) {
    const r = await setSettings({ instagramUrl: v });
    const after = (await anon.get('/api/public/site')).data.instagramUrl;
    const ok = r.status === 400 && r.data && r.data.fields && typeof r.data.fields.instagramUrl === 'string' && r.data.fields.instagramUrl.length > 5 && after === IG_SET;
    if (!ok) rows.push(`${JSON.stringify(v).slice(0, 50)} -> ${r.status} ${JSON.stringify(r.data).slice(0, 80)} stored=${after.slice(0, 40)}`);
  }
  R.check(`IG7b ${BAD.length} lookalike / javascript: / data: / http / userinfo / port / backslash / whitespace / over-length values are rejected with 400 fields.instagramUrl and the stored value is unchanged`, rows.length === 0, rows.join(' || '));
  // note: leading/trailing whitespace is trimmed by normText, so ' https://www.instagram.com/x' alone is valid and is NOT in the list above
  const t = await setSettings({ instagramUrl: '  https://www.instagram.com/trim  ' });
  R.check('IG7c surrounding whitespace is trimmed, value stored without it', t.status === 200 && t.data.instagramUrl === 'https://www.instagram.com/trim', JSON.stringify(t.data.instagramUrl));
  // types
  const typed = [];
  for (const v of [123, true, ['https://www.instagram.com/x'], { u: 1 }, null]) { const r = await setSettings({ instagramUrl: v }); const after = (await anon.get('/api/public/site')).data.instagramUrl; if (r.status >= 500 || (r.status === 200 && typeof after !== 'string')) typed.push(`${JSON.stringify(v)} -> ${r.status}`); if (r.status === 200 && after !== 'https://www.instagram.com/trim' && v !== null) typed.push(`${JSON.stringify(v)} -> stored ${JSON.stringify(after)}`); }
  R.check('IG7d non-string instagramUrl (number, boolean, array, object, null) never causes 5xx and never stores a non-string', typed.length === 0, typed.join(' | '));
  // auth / CSRF / origin
  await setSettings({ instagramUrl: IG_SET });
  const evil = { instagramUrl: 'https://www.instagram.com/hacked/' };
  const a1 = await anon.put('/api/admin/settings', { json: evil });
  const a2 = await admin.put('/api/admin/settings', { json: evil, csrf: false });
  const a3 = await admin.put('/api/admin/settings', { json: evil, origin: 'https://evil.example' });
  R.check('IG7e PUT instagramUrl needs a session (401), the CSRF header (403) and a same-origin Origin (403); stored value unchanged', a1.status === 401 && a2.status === 403 && a3.status === 403 && (await anon.get('/api/public/site')).data.instagramUrl === IG_SET, `${a1.status}/${a2.status}/${a3.status}`);
  R.check('IG7f public site JSON exposes instagramUrl only as a string and no new admin-only keys (about added by T-47/D-52 and email by T-52, public by design)', Object.keys((await anon.get('/api/public/site')).data).sort().join() === 'about,address,currencySymbol,email,instagramUrl,lang,openingHours,reservationPhone');
  R.check('IG7g validation message is Bulgarian and does not echo the submitted value', (await setSettings({ instagramUrl: 'https://evil.com/<img src=x onerror=1>' })).text().includes('instagram.com') && !(await setSettings({ instagramUrl: 'https://evil.com/ZZQQ9' })).text().includes('ZZQQ9'));
  await setSettings({ instagramUrl: '' });
});

// XSS / unsafe href: values accepted by the server cannot make a non-instagram href; defence in depth when the API returns garbage
await step('IGX', async () => {
  const PAY = ['https://www.instagram.com/x"><img/src=x/onerror=window.__xss=1>', "https://www.instagram.com/x'onmouseover='window.__xss=2", 'https://www.instagram.com/x?next=https://evil.example/&a=<script>window.__xss=3</script>', 'https://www.instagram.com/x#"onfocus="window.__xss=4"'];
  for (const p of PAY) {
    const r = await setSettings({ instagramUrl: p });
    if (r.status !== 200) { R.pass(`IGX1 payload ${JSON.stringify(p).slice(0, 40)} rejected by the server (${r.status})`); continue; }
    const { context, page, log } = await newPage(browser, { width: 390, height: 844 });
    await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(200);
    const igs = await igState(page);
    const hosts = igs.map((i) => { try { const u = new URL(i.abs); return u.protocol + '//' + u.hostname; } catch { return 'invalid'; } });
    const inj = await page.evaluate(() => ({ x: window.__xss, el: document.querySelectorAll('img[src="x"], [onerror], [onmouseover], [onfocus], footer script, #contact script').length }));
    R.check(`IGX1 accepted payload ${JSON.stringify(p).slice(0, 40)}: every icon stays on https://(www.)instagram.com, no script ran, no injected element/attribute`, hosts.every((h) => /^https:\/\/(www\.)?instagram\.com$/.test(h)) && inj.x === undefined && inj.el === 0 && (await page.collectCsp()).length === 0, JSON.stringify({ hosts, inj }));
    await context.close();
  }
  await setSettings({ instagramUrl: '' });
  // API (hand-edited DB / compromised admin / future bug) returns hostile values: renderer must fall back to the placeholder
  const HOSTILE = ['javascript:alert(1)', 'https://evil.example/', 'https://www.instagram.com.evil.example/', 'http://www.instagram.com/x', 'data:text/html,x', 'https://user@www.instagram.com/', '//evil.example', 12345, ['x'], { a: 1 }];
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  for (const v of HOSTILE) {
    await page.route('**/api/public/site*', async (route) => { const res = await route.fetch(); const j = await res.json(); j.instagramUrl = v; await route.fulfill({ response: res, json: j }); });
    await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(200);
    const igs = await igState(page);
    // user@ form: URL parser keeps hostname www.instagram.com; the link still goes to instagram.com (userinfo is not exploitable), but must not be evil
    const okHost = igs.every((i) => { try { const u = new URL(i.abs); return u.protocol === 'https:' && /^(www\.)?instagram\.com$/.test(u.hostname); } catch { return false; } });
    R.check(`IGX2 hostile API value ${JSON.stringify(v)}: icons never point outside https://(www.)instagram.com (${igs.map((i) => i.href).join(' , ')})`, igs.length === 2 && okHost, igs.map((i) => i.href).join());
    await page.unroute('**/api/public/site*');
  }
  await context.close();
});

// ================================================================ LOC: location section
await step('LOC', async () => {
  await setSettings({ reservationPhone: PHONE, address: ADDR_BG, addressEn: ADDR_EN, openingHours: 'Пн-Нд 10:00-22:00', openingHoursEn: '', instagramUrl: '' });
  for (const vp of [390, 768, 1280]) for (const lang of ['bg', 'en']) {
    const en = lang === 'en';
    const { context, page, log } = await newPage(browser, { width: vp, height: 844 });
    await page.goto(base + `/?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
    const d = await page.evaluate(() => { const s = document.getElementById('location'); const r = s.getBoundingClientRect(); const order = [...document.querySelectorAll('main > section')].map((x) => x.id || x.className.split(' ')[0]); return { vis: r.height > 0 && !s.hidden, h2: s.querySelector('h2').textContent, addr: s.querySelector('.address-text')?.textContent, hours: s.querySelector('dd.hours')?.textContent, maps: s.querySelectorAll('a.map-link').length, labelled: s.getAttribute('aria-labelledby'), order, contactDl: document.getElementById('contact-list').hidden, contactTxt: document.getElementById('contact').innerText }; });
    R.check(`LOC1[${lang} ${vp}] Location section visible: "${en ? 'Location' : 'Локация'}", address "${en ? ADDR_EN : ADDR_BG}", one map link, hours ${en ? '(EN hours empty -> BG fallback)' : ''} ${d.hours}`, d.vis && d.h2 === (en ? 'Location' : 'Локация') && d.addr === (en ? ADDR_EN : ADDR_BG) && d.maps === 1 && d.hours === 'Пн-Нд 10:00-22:00' && d.labelled === 'location-heading', JSON.stringify(d));
    R.check(`LOC2[${lang} ${vp}] Contact keeps phone + Instagram and no longer shows address/hours`, d.contactTxt.includes(PHONE) && !d.contactTxt.includes(ADDR_BG) && !d.contactTxt.includes('10:00') && (await page.locator('#contact a.ig-link').count()) === 1 && (await page.locator('#contact-call').isVisible()));
    // nav item goes to the section
    if (vp < 700) await page.locator('#nav-toggle').click();
    await page.locator('#site-nav a[href*="#location"]').click(); await page.waitForTimeout(600);
    const tp = await page.evaluate(() => ({ t: document.querySelector('#location h2').getBoundingClientRect().top, bar: document.getElementById('top-bar').getBoundingClientRect().bottom, hash: location.hash }));
    R.check(`LOC3[${lang} ${vp}] nav "${en ? 'Location' : 'Локация'}" scrolls to #location with the heading visible below the sticky bar`, tp.hash === '#location' && tp.t >= tp.bar - 1 && tp.t < 844, JSON.stringify(tp));
    R.check(`LOC4[${lang} ${vp}] no console errors, no horizontal scroll`, (await clean(page, log)) && (await noHScroll(page)).ok);
    if (vp === 390) await page.screenshot({ path: path.join(shots, `fb1-location-${lang}.png`), fullPage: true });
    await context.close();
  }
});

// ---------------------------------------------------------------- server C: SITE_URL set -> OG meta of /reservation
await step('OG', async () => {
  const meta = (html, attr, name) => { const m = new RegExp(`<meta[^>]+${attr}="${name}"[^>]*content="([^"]*)"`, 'i').exec(html); return m ? m[1] : null; };
  for (const [label, url, site] of [['SITE_URL set', srvC.url, 'https://kota1.example'], ['SITE_URL unset', base, '']]) {
    const r = await fetch(url + '/reservation', { headers: { accept: 'text/html' } }); const b = await r.text();
    const o = { title: meta(b, 'property', 'og:title'), desc: meta(b, 'property', 'og:description'), type: meta(b, 'property', 'og:type'), url: meta(b, 'property', 'og:url'), img: meta(b, 'property', 'og:image'), loc: meta(b, 'property', 'og:locale'), alt: meta(b, 'property', 'og:locale:alternate'), card: meta(b, 'name', 'twitter:card'), timg: meta(b, 'name', 'twitter:image'), w: meta(b, 'property', 'og:image:width'), h: meta(b, 'property', 'og:image:height') };
    R.check(`OG1 /reservation (${label}): HTTP 200, og:title/description/type, og:url ${site}/reservation, og:image + twitter:image ${site}/images/og-image.png (1200x630), locale bg_BG + en_GB, twitter:card, no leftover __SITE_URL__ token`,
      r.status === 200 && /text\/html/.test(r.headers.get('content-type')) && r.headers.get('cache-control') === 'no-cache' && o.title === 'Резервации и поръчки — Kota1 Restaurant' && o.desc.length > 20 && o.type === 'website' && o.url === site + '/reservation' && o.img === site + '/images/og-image.png' && o.timg === o.img && o.w === '1200' && o.h === '630' && o.loc === 'bg_BG' && o.alt === 'en_GB' && o.card === 'summary_large_image' && !b.includes('__SITE_URL__'), JSON.stringify(o));
  }
  const img = await fetch(srvC.url + '/images/og-image.png'); R.check('OG2 og-image.png resolves (200 image/png)', img.status === 200 && /image\/png/.test(img.headers.get('content-type')));
  const hx = await fetch(srvC.url + '/reservation', { method: 'HEAD', headers: { accept: 'text/html' } }); R.check('OG3 HEAD /reservation 200 (+ /reservation?lang=en, /reservation/ do not 500)', hx.status === 200 && (await fetch(srvC.url + '/reservation?lang=en')).status === 200 && (await fetch(srvC.url + '/reservation/', { redirect: 'manual' })).status < 500);
  const post = await fetch(srvC.url + '/reservation', { method: 'POST' }); R.check('OG4 POST /reservation is not served as a page (404/405, no 200)', post.status !== 200, String(post.status));
});
await srvC.stop();

await srvA.stop();
await srvC.stop();

// ---------------------------------------------------------------- server B: fresh DB (migration 003 default address)
const dirB = tmpDir('fb1b'); createAdmin(dirB);
const srvB = await startServer({ port: 3206, dataDir: dirB, now: T0 });
await step('FRESH', async () => {
  const bAnon = new Client(srvB.url); const bAdmin = new Client(srvB.url); await bAdmin.login();
  const bg = (await bAnon.get('/api/public/site')).data; const en = (await bAnon.get('/api/public/site?lang=en')).data; const as = (await bAdmin.get('/api/admin/settings')).data;
  R.check('FRESH1 fresh DB (migration 003): public site returns the default address in BG and EN; instagramUrl ""; phone ""', bg.address === DEF_BG && en.address === DEF_EN && bg.instagramUrl === '' && bg.reservationPhone === '', JSON.stringify([bg, en]));
  R.check('FRESH2 admin settings on a fresh DB: address + addressEn hold the defaults (editable), instagramUrl ""', as.address === DEF_BG && as.addressEn === DEF_EN && as.instagramUrl === '', JSON.stringify(as));
  for (const lang of ['bg', 'en']) for (const vp of [390, 1280]) {
    const { context, page, log } = await newPage(browser, { width: vp, height: 844 });
    await page.goto(srvB.url + `/?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
    const d = await page.evaluate(() => ({ vis: document.getElementById('location').getBoundingClientRect().height > 0, addr: document.querySelector('#location .address-text')?.textContent, href: document.querySelector('#location a.map-link')?.getAttribute('href'), hours: document.querySelectorAll('#location dd.hours').length, bar: document.getElementById('top-phone').textContent.trim(), barHref: document.getElementById('top-phone').getAttribute('href'), contact: document.getElementById('contact').getBoundingClientRect().height > 0, call: document.getElementById('contact-call').hidden, ig: document.querySelectorAll('a.ig-link').length, navLoc: !!document.querySelector('#site-nav a[href*="#location"]') }));
    const a = lang === 'en' ? DEF_EN : DEF_BG;
    R.check(`FRESH3[${lang} ${vp}] untouched DB: Location visible with default "${a}" + map link; no hours row; bar = Резервации и поръчки link; Contact shows Instagram and the always-visible reservation button (D-58); nav has Location`, d.vis && d.addr === a && d.href === MAP && d.hours === 0 && d.bar === (lang === 'en' ? 'Reservations & orders' : 'Резервации и поръчки') && d.barHref.startsWith('/reservation') && d.contact && d.call === false && d.ig === 2 && d.navLoc, JSON.stringify(d));
    R.check(`FRESH4[${lang} ${vp}] clean console`, await clean(page, log));
    await context.close();
  }
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(srvB.url + '/reservation', { waitUntil: 'networkidle' }); await page.waitForTimeout(200);
  R.check('FRESH5 /reservation on a fresh DB: no-phone note, plan, default address + map link', (await page.locator('#res-nophone').isVisible()) && (await page.locator('#plan-tables li').count()) === 14 && (await page.locator('#location-list .address-text').textContent()) === DEF_BG);
  await context.close();
  // owner saves an EMPTY address afterwards: the page keeps showing the default (never an empty section)
  await bAdmin.put('/api/admin/settings', { json: { address: '', addressEn: '' } });
  const c2 = await newPage(browser, { width: 390, height: 844 });
  await c2.page.goto(srvB.url + '/?lang=en', { waitUntil: 'networkidle' }); await c2.page.waitForTimeout(200);
  R.check('FRESH6 owner clears address in admin: Location still shows the default address (EN), restart keeps it empty in the DB (migration is not re-applied)', (await c2.page.locator('#location .address-text').textContent()) === DEF_EN);
  await c2.context.close();
});
await srvB.stop();
// restart: migration 003 must not re-seed over a stored value or re-fill a cleared one more than once; data kept
{
  const srvB2 = await startServer({ port: 3206, dataDir: dirB, now: T0 });
  const s = (await new Client(srvB2.url).get('/api/public/site')).data;
  R.check('FRESH7 after restart the cleared address stays "" in the API (migration 003 is recorded as applied and not re-run)', s.address === '', JSON.stringify(s.address));
  await srvB2.stop();
}

await browser.close();
R.summary();
fs.writeFileSync(path.join(shots, 'feedback1-results.json'), JSON.stringify(R.results, null, 1));

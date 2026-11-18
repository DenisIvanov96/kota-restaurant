// T-54 (D-55) contact email: seed value, mailto item order, privacy page, long address reflow, admin edit/invalid/clear,
// API + DB-injection XSS, keyboard focus and contrast. Real server + real API, no mocks. Port 3201 (fresh DB, so the migration-008 seed is visible).
// Run: node --disable-warning=ExperimentalWarning tests/e2e/email.mjs
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, createAdmin, Client, tmpDir, reporter, SCRATCH, PASSWORD } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir, contrast, colorsOf } from '../lib/browser.mjs';

const R = reporter('email-e2e');
const shots = shotDir();
const dir = tmpDir('email'); createAdmin(dir);
let srv = await startServer({ port: 3201, dataDir: dir, now: '2026-06-15T10:00:00Z' });
const api = new Client(srv.url); await api.login();
const anon = new Client(srv.url);
const SEED = 'example@gmail.com';
const PHONE = '+359 88 123 4567';
const IG = 'https://www.instagram.com/kota1_restaurant/';
const set = (o) => api.put('/api/admin/settings', { json: o });
const site = async (lang = 'bg') => (await anon.get(`/api/public/site?lang=${lang}`)).data;
const dbWrite = (value) => { const d = new DatabaseSync(path.join(dir, 'kota.db')); try { d.prepare("INSERT INTO settings(key, value) VALUES ('contact_email', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value); } finally { d.close(); } };
const dbRead = () => { const d = new DatabaseSync(path.join(dir, 'kota.db')); try { return d.prepare("SELECT value FROM settings WHERE key = 'contact_email'").get()?.value; } finally { d.close(); } };
const browser = await chromium.launch();
const VPS = [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1280', width: 1280, height: 800 }];
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.stack || e.message).split('\n').slice(0, 5).join(' | ')); } };
const L = { bg: { label: 'Имейл', phone: 'Телефон', social: 'Социални мрежи' }, en: { label: 'Email', phone: 'Phone', social: 'Social media' } };

const homeProbe = (page) => page.evaluate(() => {
  const kids = [...document.getElementById('contact-list').children];
  const it = document.getElementById('contact-email-item');
  const a = it && it.querySelector('a');
  const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  return {
    order: kids.map((k) => k.id), count: document.querySelectorAll('#contact-email-item').length,
    dt: it ? it.querySelector('dt').textContent.trim() : null, text: a ? a.textContent : null, href: a ? a.getAttribute('href') : null,
    boxes: kids.filter((k) => k.getBoundingClientRect().height > 0).map((k) => ({ id: k.id, ...rect(k) })), aRect: a ? rect(a) : null, iw: window.innerWidth,
    injected: document.querySelectorAll('#contact img, #contact script, #contact iframe, #contact [onerror], #contact [onclick]').length, xss: window.__xss,
  };
});
const privProbe = (page) => page.evaluate(() => {
  const p = document.getElementById('privacy-contact'); const as = [...p.querySelectorAll('a')];
  return {
    text: p.textContent, hrefs: as.map((a) => a.getAttribute('href')), aText: as.map((a) => a.textContent),
    injected: p.querySelectorAll('img, script, iframe, [onerror], [onclick]').length, xss: window.__xss,
    aRect: as.map((a) => { const r = a.getBoundingClientRect(); return { l: r.left, r: r.right }; }), iw: window.innerWidth,
  };
});
const visit = async (vp, url, lang, opts = {}) => {
  const c = await newPage(browser, { width: vp.width, height: vp.height, locale: lang === 'en' ? 'en-US' : 'bg-BG' });
  await c.page.goto(`${srv.url}${url}${url.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'networkidle' });
  if (!opts.noWait) await c.page.waitForTimeout(300);
  return c;
};
const clean = async (c) => c.log.console.length === 0 && c.log.pageErrors.length === 0 && c.log.failed.length === 0 && (await c.page.collectCsp()).length === 0;

// ============ A. migration seed + API contract (before anything is saved) ============
await step('A', async () => {
  R.check('A1 fresh DB: DB row, admin contactEmail and public site.email are the seed example@gmail.com', dbRead() === SEED && (await api.get('/api/admin/settings')).data.contactEmail === SEED && (await site()).email === SEED && (await site('en')).email === SEED);
  const r = await set({ reservationPhone: PHONE, instagramUrl: IG, address: 'ул. Тест 1' });
  R.check('A2 PUT without the contactEmail key leaves it unchanged (seed kept)', r.status === 200 && r.data.contactEmail === SEED && (await site()).email === SEED, JSON.stringify(r.data));
});

// ============ B. seed shown on home and privacy, BG/EN, 390/1280 ============
for (const lang of ['bg', 'en']) for (const vp of [VPS[0], VPS[2]]) {
  await step(`B[${lang} ${vp.name}]`, async () => {
    const tag = `${lang} ${vp.name}`;
    let c = await visit(vp, '/', lang); await c.page.waitForSelector('#contact-email-item');
    const h = await homeProbe(c.page);
    R.check(`B1[${tag}] home: one "${L[lang].label}" item showing the seed, href exactly mailto:${SEED}`, h.count === 1 && h.dt === L[lang].label && h.text === SEED && h.href === `mailto:${SEED}`, JSON.stringify(h));
    R.check(`B2[${tag}] home: item order is phone, email, social`, h.order.join() === 'contact-phone-item,contact-email-item,contact-social', h.order.join());
    const bx = h.boxes; const noOverlap = bx.every((a, i) => bx.every((b, j) => i >= j || a.r <= b.l + 1 || b.r <= a.l + 1 || a.b <= b.t + 1 || b.b <= a.t + 1));
    R.check(`B3[${tag}] home: items do not overlap and stay inside the viewport; no horizontal scroll; no console/page/request/CSP errors`, noOverlap && bx.every((b) => b.l >= -1 && b.r <= h.iw + 1) && (await noHScroll(c.page)).ok && (await clean(c)), JSON.stringify({ bx, h: await noHScroll(c.page), log: c.log }));
    await c.page.locator('#contact').screenshot({ path: path.join(shots, `email-home-${lang}-${vp.name}.png`) });
    await c.context.close();
    c = await visit(vp, '/privacy', lang);
    const p = await privProbe(c.page);
    const ti = p.text.indexOf(`${L[lang].phone}:`), te = p.text.indexOf(`${L[lang].label}:`), ta = p.text.indexOf(lang === 'en' ? 'Address:' : 'Адрес:');
    R.check(`B4[${tag}] privacy #privacy-contact: "${L[lang].label}: ${SEED}" with a mailto link, order phone, email, address`, p.hrefs.includes(`mailto:${SEED}`) && p.aText.includes(SEED) && ti >= 0 && ti < te && te < ta, JSON.stringify(p));
    R.check(`B5[${tag}] privacy: no horizontal scroll, no errors`, (await noHScroll(c.page)).ok && (await clean(c)), JSON.stringify({ h: await noHScroll(c.page), log: c.log }));
    await c.context.close();
  });
}
await step('B6', async () => { // in-place language switch must not duplicate or lose the item
  const c = await newPage(browser, { width: 390, height: 844 });
  await c.page.goto(srv.url + '/', { waitUntil: 'networkidle' }); await c.page.waitForSelector('#contact-email-item');
  for (let i = 0; i < 5; i++) { await c.page.locator(`.lang-btn[data-lang="${i % 2 ? 'bg' : 'en'}"]`).click(); await c.page.waitForTimeout(80); }
  await c.page.waitForTimeout(600);
  const h = await homeProbe(c.page);
  R.check('B6 after 5 rapid BG<->EN toggles (ends EN): one email item, label "Email", order phone,email,social, href intact', h.count === 1 && h.dt === 'Email' && h.order.join() === 'contact-phone-item,contact-email-item,contact-social' && h.href === `mailto:${SEED}` && c.log.pageErrors.length === 0, JSON.stringify(h));
  await c.context.close();
});

// ============ C. long address, 390/768/1280, BG/EN, home + privacy ============
await step('C', async () => {
  const LONG = 'l'.repeat(150) + '@' + 'm'.repeat(100) + '.bg'; // 254 chars, the maximum, no break opportunities
  const r = await set({ contactEmail: LONG });
  R.check('C0 254-char address accepted by the API', r.status === 200 && r.data.contactEmail === LONG && LONG.length === 254, `${r.status} len=${LONG.length}`);
  for (const lang of ['bg', 'en']) for (const vp of VPS) {
    let c = await visit(vp, '/', lang); await c.page.waitForSelector('#contact-email-item');
    const h = await homeProbe(c.page); const sh = await noHScroll(c.page);
    R.check(`C1[${lang} ${vp.name}] home, 254-char email: no horizontal scroll, link inside viewport, items do not overlap`, sh.ok && h.aRect.l >= -1 && h.aRect.r <= h.iw + 1 && h.text === LONG && h.boxes.every((a, i) => h.boxes.every((b, j) => i >= j || a.r <= b.l + 1 || b.r <= a.l + 1 || a.b <= b.t + 1 || b.b <= a.t + 1)), JSON.stringify({ sh, aRect: h.aRect, boxes: h.boxes }));
    await c.page.locator('#contact').screenshot({ path: path.join(shots, `email-long-home-${lang}-${vp.name}.png`) });
    await c.context.close();
    c = await visit(vp, '/privacy', lang);
    const p = await privProbe(c.page); const sp = await noHScroll(c.page);
    R.check(`C2[${lang} ${vp.name}] privacy, 254-char email: no horizontal scroll, link inside viewport`, sp.ok && p.aRect.every((a) => a.l >= -1 && a.r <= p.iw + 1) && p.hrefs.includes('mailto:' + LONG), JSON.stringify({ sp, aRect: p.aRect }));
    await c.page.screenshot({ path: path.join(shots, `email-long-privacy-${lang}-${vp.name}.png`) });
    await c.context.close();
  }
  await set({ contactEmail: SEED });
});

// ============ D. admin edit (UI) ============
const settingsPage = async () => {
  const c = await newPage(browser, { width: 390, height: 844 });
  const pg = c.page;
  await pg.goto(srv.url + '/admin/', { waitUntil: 'networkidle' });
  await pg.getByLabel('Потребителско име').fill('owner'); await pg.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await pg.getByRole('button', { name: 'Вход' }).click(); await pg.waitForSelector('h1:has-text("Табло")');
  await pg.goto(srv.url + '/admin/#/settings'); await pg.waitForSelector('h1:has-text("Настройки")');
  return c;
};
const dismissToasts = (pg) => pg.evaluate(() => document.querySelectorAll('.a-toasts button').forEach((b) => b.click()));
await step('D', async () => {
  const c = await settingsPage(); const pg = c.page;
  const f = pg.getByLabel('Имейл', { exact: true });
  const meta = await f.evaluate((e) => ({ type: e.type, ac: e.autocomplete, max: e.maxLength, val: e.value, inputmode: e.inputMode }));
  R.check('D1 admin Настройки has a labelled "Имейл" field (type=email, autocomplete off, maxlength 254) showing the saved value', meta.type === 'email' && meta.ac === 'off' && meta.max === 254 && meta.val === SEED, JSON.stringify(meta));
  R.check('D1b settings page at 390: no horizontal scroll', (await noHScroll(pg)).ok);
  await f.fill('  info@kota-test.bg  '); await pg.getByRole('button', { name: 'Запази', exact: true }).click(); await pg.waitForTimeout(700);
  R.check('D2 real save via UI: admin API and public site (BG+EN) updated without restart, value trimmed', (await api.get('/api/admin/settings')).data.contactEmail === 'info@kota-test.bg' && (await site()).email === 'info@kota-test.bg' && (await site('en')).email === 'info@kota-test.bg', JSON.stringify(await site()));
  const hc = await visit(VPS[0], '/', 'bg'); const hp = await homeProbe(hc.page); await hc.context.close();
  const pc = await visit(VPS[0], '/privacy', 'en'); const pp = await privProbe(pc.page); await pc.context.close();
  R.check('D3 home and privacy now show info@kota-test.bg with the new mailto href', hp.text === 'info@kota-test.bg' && hp.href === 'mailto:info@kota-test.bg' && pp.hrefs.includes('mailto:info@kota-test.bg'), JSON.stringify({ hp: hp.href, pp: pp.hrefs }));
  // invalid: client-side
  await dismissToasts(pg);
  await f.fill('not-an-email'); await pg.getByRole('button', { name: 'Запази', exact: true }).click(); await pg.waitForTimeout(500);
  const err = await pg.evaluate(() => { const i = document.querySelector('input[type=email]'); const e = document.getElementById(i.getAttribute('aria-describedby').split(' ')[0]); return { invalid: i.getAttribute('aria-invalid'), shown: !e.hidden, text: e.textContent.trim(), focused: document.activeElement === i, firstDesc: e.className }; });
  R.check('D4 invalid address: inline error visible under the field (aria-invalid, described-by, focus on the field) and nothing saved', err.shown && err.invalid === 'true' && err.focused && err.text.length > 5 && (await site()).email === 'info@kota-test.bg' && (await api.get('/api/admin/settings')).data.contactEmail === 'info@kota-test.bg', JSON.stringify(err));
  await pg.screenshot({ path: path.join(shots, 'email-admin-invalid-390.png') });
  // invalid: only the server rejects it (client regex is looser) -> fields.contactEmail mapped inline
  await dismissToasts(pg);
  await f.fill('a..b@kota.bg'); await pg.getByRole('button', { name: 'Запази', exact: true }).click(); await pg.waitForTimeout(700);
  const err2 = await pg.evaluate(() => { const i = document.querySelector('input[type=email]'); const e = document.getElementById(i.getAttribute('aria-describedby').split(' ')[0]); return { invalid: i.getAttribute('aria-invalid'), shown: !e.hidden, text: e.textContent.trim() }; });
  R.check('D5 address that passes the client regex but fails the server (a..b@kota.bg): server fields.contactEmail shown inline, nothing saved', err2.shown && err2.invalid === 'true' && (await site()).email === 'info@kota-test.bg', JSON.stringify(err2));
  // typing a corrected value and saving clears the error
  await dismissToasts(pg);
  await f.fill('ok@kota-test.bg'); await pg.getByRole('button', { name: 'Запази', exact: true }).click(); await pg.waitForTimeout(700);
  R.check('D6 corrected value saves and the inline error disappears', (await site()).email === 'ok@kota-test.bg' && (await pg.locator('input[type=email][aria-invalid=true]').count()) === 0);
  // clear
  await dismissToasts(pg);
  await f.fill(''); await pg.getByRole('button', { name: 'Запази', exact: true }).click(); await pg.waitForTimeout(700);
  const a = (await api.get('/api/admin/settings')).data;
  R.check('D7 clearing the field: admin contactEmail null, public site.email null (BG+EN), DB value empty', a.contactEmail === null && (await site()).email === null && (await site('en')).email === null && dbRead() === '', JSON.stringify({ a: a.contactEmail, db: dbRead() }));
  R.check('D8 admin page: no console/page errors during the flow', c.log.pageErrors.length === 0 && c.log.console.filter((m) => !/40[019]|422/.test(m)).length === 0, JSON.stringify(c.log.console.concat(c.log.pageErrors)));
  await c.context.close();
  for (const lang of ['bg', 'en']) {
    const hc2 = await visit(VPS[0], '/', lang); const h = await homeProbe(hc2.page); const ok = await clean(hc2); await hc2.context.close();
    R.check(`D9[${lang}] cleared: home has no email item (order phone,social), no mailto anywhere in Contacts`, h.count === 0 && h.order.join() === 'contact-phone-item,contact-social' && (await (async () => { const cc = await visit(VPS[0], '/', lang); const n = await cc.page.locator('#contact a[href^="mailto:"]').count(); await cc.context.close(); return n; })()) === 0 && ok, JSON.stringify(h.order));
    const pc2 = await visit(VPS[0], '/privacy', lang); const p = await privProbe(pc2.page); await pc2.context.close();
    R.check(`D10[${lang}] cleared: privacy contact shows phone and address but no email label/mailto`, p.hrefs.every((x) => !x.startsWith('mailto:')) && !p.text.includes(L[lang].label + ':') && p.text.includes(PHONE), JSON.stringify(p));
  }
  // restart: the cleared value must not be re-seeded by migration 008 (INSERT OR IGNORE)
  await srv.stop(); srv = await startServer({ port: 3201, dataDir: dir, now: '2026-06-15T10:00:00Z' });
  const s2 = await (await fetch(srv.url + '/api/public/site')).json();
  R.check('D11 after server restart the cleared email stays null (not re-seeded)', s2.email === null && dbRead() === '', JSON.stringify(s2.email));
  await api.login(); await anon.get('/');
});

// ============ E. XSS: API rejects, DB injection renders as text ============
await step('E', async () => {
  await set({ contactEmail: 'safe@kota-test.bg' });
  const bad = ['<script>alert(1)</script>@x.bg', '"><img src=x onerror=alert(1)>@x.bg', 'a@b.bg"><script>alert(1)</script>', 'javascript:alert(1)', 'a@b.bg\r\nBcc: x@y.bg', 'a b@c.bg', 'a@@b.bg', 'a@b', '@b.bg', 'a@.bg', '\u0000a@b.bg', 'a'.repeat(250) + '@b.bg', "o'rly@b.bg;DROP TABLE settings", 5, [], {}, true];
  const res = [];
  for (const v of bad) { const r = await set({ contactEmail: v }); res.push([JSON.stringify(v).slice(0, 40), r.status, !!r.data?.fields?.contactEmail]); }
  R.check(`E1 ${bad.length} XSS/injection/malformed values: every PUT is 400 with fields.contactEmail`, res.every(([, s, f]) => s === 400 && f), JSON.stringify(res.filter(([, s, f]) => !(s === 400 && f))));
  R.check('E2 after all rejected PUTs the stored/public value is unchanged', (await site()).email === 'safe@kota-test.bg' && dbRead() === 'safe@kota-test.bg');
  R.check('E3 mass-assignment: the snake_case alias contact_email is ignored', (await set({ contact_email: 'alias@x.bg' })).status === 200 && (await site()).email === 'safe@kota-test.bg');
  const nr = await set({ contactEmail: null });
  R.check('E3b contactEmail:null clears it (200, public null); whitespace-only also clears', nr.status === 200 && (await site()).email === null && (await set({ contactEmail: 'safe@kota-test.bg' })).status === 200 && (await set({ contactEmail: '   ' })).status === 200 && (await site()).email === null);
  await set({ contactEmail: 'safe@kota-test.bg' });
  // direct DB injection -> renders as inert text on home and privacy
  const payloads = ['<img src=x onerror="window.__xss=1">@x.bg', '"><script>window.__xss=1</script>', 'x@y.bg" onmouseover="window.__xss=1" x="', "javascript:window.__xss=1", '<b>bold</b>&amp;@x.bg'];
  for (const [i, pl] of payloads.entries()) {
    dbWrite(pl);
    R.check(`E4[${i}] DB-injected value is served verbatim by the public API as a JSON string`, (await site()).email === pl, JSON.stringify((await site()).email));
    for (const lang of ['bg', 'en']) {
      const vp = i % 2 ? VPS[2] : VPS[0];
      let cc = await visit(vp, '/', lang); const h = await homeProbe(cc.page); const e1 = cc.log.pageErrors.length;
      R.check(`E5[${i} ${lang}] home: payload shown as text, link text == payload, href == "mailto:"+payload, no injected elements, no script ran`, h.text === pl && h.href === 'mailto:' + pl && h.injected === 0 && h.xss === undefined && e1 === 0, JSON.stringify({ h: h.href, inj: h.injected, x: h.xss }));
      await cc.context.close();
      cc = await visit(vp, '/privacy', lang); const p = await privProbe(cc.page);
      R.check(`E6[${i} ${lang}] privacy: payload shown as text, only the expected mailto anchor, no injected elements, no script ran`, p.text.includes(pl) && p.hrefs.filter((x) => x.startsWith('mailto:')).join() === 'mailto:' + pl && p.injected === 0 && p.xss === undefined, JSON.stringify({ hrefs: p.hrefs, inj: p.injected, x: p.xss }));
      await cc.context.close();
    }
  }
  // the admin field shows an injected value as plain input text too
  const c = await settingsPage();
  const v = await c.page.getByLabel('Имейл', { exact: true }).inputValue(); const x = await c.page.evaluate(() => window.__xss);
  R.check('E7 admin settings field shows the injected value as input text; no script ran', v === payloads[payloads.length - 1] && x === undefined && (await c.page.locator('.a-card img, .a-card script').count()) === 0, v);
  await c.context.close();
  await set({ contactEmail: 'info@kota-test.bg' });
  R.check('E8 value restored through the API for the following checks', dbRead() === 'info@kota-test.bg');
});

// ============ F. keyboard focus + contrast of the new link and label ============
for (const vp of [VPS[0], VPS[2]]) {
  await step(`F[${vp.name}]`, async () => {
    for (const lang of ['bg', 'en']) {
      const c = await visit(vp, '/', lang); const pg = c.page; await pg.waitForSelector('#contact-email-item');
      await pg.focus('#contact-phone-item a'); await pg.keyboard.press('Tab');
      const f1 = await pg.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { inEmail: !!a.closest('#contact-email-item'), href: a.getAttribute('href'), o: cs.outlineStyle, w: parseFloat(cs.outlineWidth), oc: cs.outlineColor, sh: cs.boxShadow }; });
      const bgc = (await colorsOf(pg, '#contact-email-item a')).bg;
      R.check(`F1[${lang} ${vp.name}] Tab from the phone link lands on the email link, which shows a visible focus indicator (outline >= 2px or shadow)`, f1.inEmail && f1.href === 'mailto:info@kota-test.bg' && ((f1.o !== 'none' && f1.w >= 2) || f1.sh !== 'none'), JSON.stringify(f1));
      if (f1.o !== 'none') R.check(`F2[${lang} ${vp.name}] focus outline colour contrast against the section background >= 3 (non-text)`, contrast(f1.oc, bgc) >= 3, `${f1.oc} on ${bgc} = ${contrast(f1.oc, bgc).toFixed(2)}`);
      await pg.keyboard.press('Tab'); const f2 = await pg.evaluate(() => !!document.activeElement.closest('#contact-social'));
      await pg.keyboard.press('Tab'); const f3 = await pg.evaluate(() => document.activeElement.id);
      R.check(`F3[${lang} ${vp.name}] tab order continues email -> social icon -> reservation button`, f2 && f3 === 'contact-call', `${f2} ${f3}`);
      const link = await colorsOf(pg, '#contact-email-item a'); const dt = await colorsOf(pg, '#contact-email-item dt');
      const box = await pg.locator('#contact-email-item a').boundingBox();
      R.check(`F4[${lang} ${vp.name}] contrast (computed): email link ${contrast(link.fg, link.bg).toFixed(2)} and label ${contrast(dt.fg, dt.bg).toFixed(2)} both >= 4.5; link target height >= 44`, contrast(link.fg, link.bg) >= 4.5 && contrast(dt.fg, dt.bg) >= 4.5 && box.height >= 44, JSON.stringify({ link, dt, box }));
      await c.context.close();
    }
    const c = await visit(vp, '/privacy', 'bg'); const pg = c.page;
    const link = await colorsOf(pg, '#privacy-contact a[href^="mailto:"]'); const box = await pg.locator('#privacy-contact a[href^="mailto:"]').boundingBox();
    await pg.focus('#privacy-contact a[href^="mailto:"]');
    const f = await pg.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { o: cs.outlineStyle, w: parseFloat(cs.outlineWidth), sh: cs.boxShadow }; });
    R.check(`F5[${vp.name}] privacy: email link contrast ${contrast(link.fg, link.bg).toFixed(2)} >= 4.5, target height >= 44, visible focus indicator`, contrast(link.fg, link.bg) >= 4.5 && box.height >= 44 && ((f.o !== 'none' && f.w >= 2) || f.sh !== 'none'), JSON.stringify({ link, box, f }));
    await c.context.close();
  });
}

await browser.close(); await srv.stop();
fs.rmSync(dir, { recursive: true, force: true });
R.summary();
fs.writeFileSync(path.join(SCRATCH, 'email-e2e-results.json'), JSON.stringify(R.results, null, 1));

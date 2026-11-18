// T-64 lightbox focus containment (BUG-25 retest): Tab / Shift+Tab never leave the lightbox dialog, focus survives "next"/"prev"
// becoming disabled, Escape closes and returns focus to the opener. Home menu slider (3 pages) and /daily-menu (2 images). 390 and 1280. Port 3203.
// Run: node --disable-warning=ExperimentalWarning tests/e2e/lightbox-focus.mjs
import fs from 'node:fs';
import { startServer, createAdmin, Client, tmpDir, makePng, PASSWORD, reporter } from '../lib/harness.mjs';
import { chromium, newPage } from '../lib/browser.mjs';

const R = reporter('lightbox-focus-e2e');
const T0 = '2026-06-15T10:00:00Z';
const dir = tmpDir('lbfocus'); createAdmin(dir);
const srv = await startServer({ port: 3203, dataDir: dir, now: T0 });
const base = srv.url;
const api = new Client(base); await api.login();
const browser = await chromium.launch();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.stack || e.message).split('\n').slice(0, 5).join(' | ')); } };
const png = (i) => makePng(600, 800, [20 + i * 40, 90, 160]);
const MP = '/api/admin/menu/pages';
const form = (fields, files) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); for (const [f, n, b] of files) fd.append(f, new Blob([b], { type: 'image/png' }), n); return fd; };

await api.put('/api/admin/menu/draft', { json: { categories: [{ name: 'Салати', nameEn: 'Salads', items: [{ name: 'Шопска', nameEn: 'Shopska', description: 'домати', priceCents: 650, available: true }] }] } });
await api.post('/api/admin/menu/publish');
await api.put('/api/admin/menu/mode', { json: { mode: 'structured' } });
for (let i = 0; i < 3; i++) { const r = await api.post(MP, { form: form({ lang: 'bg' }, [['file', `s${i}.png`, png(i)]]) }); if (r.status !== 201) throw new Error('seed ' + r.status); }
await api.put('/api/admin/menu/pages/published', { json: { lang: 'bg', published: true } });
{ const r = await api.put('/api/admin/menu/mode', { json: { mode: 'file' } }); if (r.status !== 200) throw new Error('mode ' + r.status); }
{ const r = await api.post('/api/admin/daily-menus', { form: form({ date: '2026-06-15', published: 'true' }, [['file', 'b1.png', png(0)], ['file2', 'b2.png', png(1)]]) }); if (r.status !== 201) throw new Error('daily ' + r.status + r.text()); }

const where = (p) => p.evaluate(() => { const a = document.activeElement; const d = document.querySelector('dialog.lightbox[open]'); return { tag: a.tagName, cls: String(a.className).slice(0, 40), label: a.getAttribute('aria-label') || '', inDlg: !!d && d.contains(a) }; });
const POS = 'dialog.lightbox .lb-pos';

for (const vp of [{ n: 390, w: 390, h: 844 }, { n: 1280, w: 1280, h: 800 }]) {
  for (const src of [{ k: 'home', url: '/#menu', open: '.menu-slider .zoom-btn', pages: 3 }, { k: 'daily', url: '/daily-menu', open: '#daily-view .zoom-btn', pages: 2 }]) {
    await step(`LB-${src.k}-${vp.n}`, async () => {
      const id = `${src.k}/${vp.n}`;
      const c = await newPage(browser, { width: vp.w, height: vp.h }); const p = c.page;
      await p.goto(base + src.url, { waitUntil: 'networkidle' }); await p.waitForSelector(src.open); await p.waitForTimeout(300);
      const opener = p.locator(src.open).first();
      await opener.focus();
      await p.keyboard.press('Enter'); await p.waitForSelector('dialog.lightbox[open]');
      const w0 = await where(p);
      R.check(`LB1[${id}] opening the lightbox with Enter from the page button moves focus into the dialog`, w0.inDlg, JSON.stringify(w0));
      // Tab containment. The lightbox is a native modal <dialog> (no JS trap): Tab may hand focus to the browser UI (document.activeElement === <body>)
      // but must never land on a page element outside the dialog, and must re-enter the dialog afterwards.
      const walk = async (key, n) => { const trail = []; let leak = null; let reenter = 0; let prevBody = false;
        for (let i = 0; i < n; i++) { await p.keyboard.press(key); const w = await where(p); trail.push(w.inDlg ? `D:${w.label || w.cls}` : w.tag === 'BODY' ? 'BODY' : `LEAK:${w.tag}.${w.cls}`);
          if (!w.inDlg && w.tag !== 'BODY') { leak = { i, ...w }; break; } if (prevBody && w.inDlg) reenter++; prevBody = w.tag === 'BODY'; }
        return { leak, reenter, trail }; };
      const f = await walk('Tab', 14);
      R.check(`LB2[${id}] 14 x Tab: focus never lands on a page element outside the dialog (only dialog controls or the browser-UI hand-off <body>) and re-enters the dialog after the hand-off`, !f.leak && (f.trail.every((t) => t.startsWith('D:')) || f.reenter >= 1), f.trail.join(' > '));
      const b = await walk('Shift+Tab', 14);
      R.check(`LB3[${id}] 14 x Shift+Tab: same containment backwards`, !b.leak && (b.trail.every((t) => t.startsWith('D:')) || b.reenter >= 1), b.trail.join(' > '));
      await p.evaluate(() => document.querySelector('dialog.lightbox .lb-close, dialog.lightbox .lb-btn')?.focus());
      // keyboard-only: operate the "next" button until it is disabled, then "prev" back to page 1
      const nextB = p.locator('dialog.lightbox .lb-btn').filter({ has: p.locator('xpath=.') }).locator('xpath=self::*[contains(@aria-label,"Следваща") or contains(@aria-label,"Next")]');
      const prevB = p.locator('dialog.lightbox .lb-btn[aria-label*="Предишна"], dialog.lightbox .lb-btn[aria-label*="Previous"]');
      const nB = p.locator('dialog.lightbox .lb-btn[aria-label*="Следваща"], dialog.lightbox .lb-btn[aria-label*="Next"]');
      void nextB;
      await nB.focus();
      for (let i = 0; i < src.pages + 1 && (await nB.isEnabled()); i++) { await p.keyboard.press('Enter'); await p.waitForTimeout(120); }
      const wEnd = await where(p);
      R.check(`LB4[${id}] Enter on "next" up to the last page: next disabled, focus stays inside the dialog (not <body>)`, (await nB.isDisabled()) && wEnd.inDlg && wEnd.tag !== 'BODY', `${await p.locator(POS).innerText()} ${JSON.stringify(wEnd)}`);
      const f2 = await walk('Tab', 6);
      R.check(`LB5[${id}] Tab after the last page: no page element reached (dialog controls / <body> hand-off only)`, !f2.leak, f2.trail.join(' > '));
      await p.evaluate(() => document.querySelector('dialog.lightbox .lb-btn')?.focus());
      await prevB.focus();
      for (let i = 0; i < src.pages + 1 && (await prevB.isEnabled()); i++) { await p.keyboard.press('Enter'); await p.waitForTimeout(120); }
      const wStart = await where(p);
      R.check(`LB6[${id}] Enter on "prev" back to page 1: prev disabled, focus stays inside the dialog (not <body>)`, (await prevB.isDisabled()) && wStart.inDlg && wStart.tag !== 'BODY', `${await p.locator(POS).innerText()} ${JSON.stringify(wStart)}`);
      await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150);
      R.check(`LB7[${id}] arrow keys still work after focus was moved off a disabled button (ArrowRight -> page 2)`, /2/.test((await p.locator(POS).innerText()).split(/\D+/).filter(Boolean)[0] || ''), await p.locator(POS).innerText());
      // Escape closes and focus returns to an opener (the page's zoom button)
      await p.keyboard.press('Escape'); await p.waitForTimeout(250);
      const after = await p.evaluate(() => { const a = document.activeElement; return { open: !!document.querySelector('dialog.lightbox[open]'), tag: a.tagName, cls: String(a.className), inZoom: !!a.closest('.zoom-btn') || a.classList.contains('zoom-btn') }; });
      R.check(`LB8[${id}] Escape closes the dialog and focus returns to the page's zoom button (not <body>)`, !after.open && after.inZoom, JSON.stringify(after));
      // mouse close via the X button also restores focus
      await p.locator(src.open).first().click(); await p.waitForSelector('dialog.lightbox[open]');
      await p.locator('dialog.lightbox .lb-close, dialog.lightbox [aria-label*="Затвори"], dialog.lightbox [aria-label*="Close"]').first().click(); await p.waitForTimeout(250);
      const after2 = await p.evaluate(() => ({ open: !!document.querySelector('dialog.lightbox[open]'), tag: document.activeElement.tagName, inZoom: !!document.activeElement.closest('.zoom-btn') }));
      R.check(`LB9[${id}] closing with the close button also returns focus to the zoom button`, !after2.open && after2.inZoom, JSON.stringify(after2));
      R.check(`LB10[${id}] no page errors, no failed requests, no console errors`, c.log.pageErrors.length === 0 && c.log.failed.length === 0 && c.log.console.length === 0, JSON.stringify([c.log.pageErrors, c.log.failed, c.log.console]));
      await c.context.close();
    });
  }
}
R.summary();
await browser.close(); await srv.stop(); fs.rmSync(dir, { recursive: true, force: true });

// Playwright helpers. Playwright is pre-installed globally (not an npm dependency of the project).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { SCRATCH } from './harness.mjs';
const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

export const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 800 },
];
export const shotDir = () => { const d = path.join(SCRATCH, 'shots'); fs.mkdirSync(d, { recursive: true }); return d; };

// Google Fonts is unreachable in the sandbox; those failures are environmental, not product defects.
const ENV_NOISE = /fonts\.(googleapis|gstatic)\.com/;

/** New context + page with collectors for console errors, page errors, failed requests and CSP violations. */
export async function newPage(browser, { width = 390, height = 844, timezoneId = 'Europe/Sofia', locale = 'bg-BG', baseURL, acceptDownloads = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, timezoneId, locale, baseURL, acceptDownloads });
  const page = await context.newPage();
  const log = { console: [], pageErrors: [], failed: [], csp: [], http4xx: [], envNoise: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text(); const u = m.location()?.url || '';
    (ENV_NOISE.test(t) || ENV_NOISE.test(u) ? log.envNoise : log.console).push(`${t} @ ${u}`);
  });
  page.on('pageerror', (e) => log.pageErrors.push(String(e)));
  page.on('requestfailed', (r) => { const u = r.url(); (ENV_NOISE.test(u) ? log.envNoise : log.failed).push(`${r.method()} ${u} ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !ENV_NOISE.test(r.url())) log.http4xx.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  page.__log = log;
  page.collectCsp = async () => page.evaluate(() => window.__csp || []).catch(() => []);
  return { context, page, log };
}

export const noHScroll = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, ok: document.documentElement.scrollWidth <= window.innerWidth }));

/** WCAG relative luminance contrast of two rgb() strings. */
export function contrast(a, b) {
  const p = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const lum = ([r, g, bl]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); };
  const [l1, l2] = [lum(p(a)), lum(p(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Computed text colour and the effective (first non-transparent ancestor) background of an element. */
export function colorsOf(page, selector) {
  return page.locator(selector).first().evaluate((el) => {
    const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] }; };
    let bg = null; let n = el;
    let acc = { r: 0, g: 0, b: 0 }; const layers = [];
    while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0) { layers.push(c); if (c.a >= 1) break; } n = n.parentElement; }
    // composite layers from the bottom
    let base = layers.length && layers[layers.length - 1].a >= 1 ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 };
    acc = { ...base };
    for (const l of layers.reverse()) acc = { r: l.r * l.a + acc.r * (1 - l.a), g: l.g * l.a + acc.g * (1 - l.a), b: l.b * l.a + acc.b * (1 - l.a) };
    const fg = getComputedStyle(el).color;
    return { fg, bg: `rgb(${Math.round(acc.r)}, ${Math.round(acc.g)}, ${Math.round(acc.b)})`, size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight };
  });
}

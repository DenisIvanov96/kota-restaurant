// T-25 launch polish (D-29..D-33): self-hosted fonts / no third-party requests, CSP, HTML 404, SITE_URL, OG meta, favicons,
// privacy page, footer link, map link (+ injection). Ports 3201 (main), 3202 (SITE_URL set), 3203 (invalid SITE_URL starts).
// Run: node tests/e2e/launch.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer, createAdmin, Client, tmpDir, reporter, ROOT, sleep } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, colorsOf, contrast, shotDir } from '../lib/browser.mjs';

const R = reporter('launch');
const T0 = '2026-06-15T10:00:00Z';
const ADDR_BG = 'ул. Ралевица 85, София';
const ADDR_EN = 'Ralevitsa St 85, Sofia';
const MAP_URL = 'https://maps.app.goo.gl/EQuhsMqma6TcmRqs9'; // fixed pin (D-59)
const dir = tmpDir('launch'); createAdmin(dir);
const srv = await startServer({ port: 3201, dataDir: dir, now: T0 });
const base = srv.url;
const admin = new Client(base); await admin.login();
const anon = new Client(base);
const shots = shotDir();
const setSettings = (o) => admin.put('/api/admin/settings', { json: { reservationPhone: '+359 88 123 4567', address: ADDR_BG, addressEn: ADDR_EN, openingHours: 'Пн-Нд 10:00-22:00', openingHoursEn: 'Mon-Sun 10:00-22:00', currencySymbol: '€', ...o } });
const rs = await setSettings({}); if (rs.status !== 200) throw new Error('settings ' + rs.status + rs.text());
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.message).split('\n').slice(0, 3).join(' ')); } };
const HTML = { accept: 'text/html,application/xhtml+xml' };
const get = (p, headers = {}) => fetch(base + p, { headers, redirect: 'manual' }).then(async (r) => ({ status: r.status, h: r.headers, body: Buffer.from(await r.arrayBuffer()) }));
const txt = (r) => r.body.toString('utf8');
const meta = (html, attr, name) => { const m = new RegExp(`<meta[^>]+${attr}="${name}"[^>]*content="([^"]*)"`, 'i').exec(html); return m ? m[1] : null; };
const linkTags = (html) => [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => ({ rel: /rel="([^"]*)"/.exec(m[0])?.[1], href: /href="([^"]*)"/.exec(m[0])?.[1], type: /type="([^"]*)"/.exec(m[0])?.[1], sizes: /sizes="([^"]*)"/.exec(m[0])?.[1] }));
const pngSize = (b) => (b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null);

const PAGES = [['/', 'index'], ['/daily-menu', 'daily'], ['/privacy', 'privacy']];
const FONT_FILES = ['oswald', 'source-sans-3'].flatMap((f) => ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext'].map((s) => `${f}-${s}.woff2`));

// ============================================================ A. fonts + CSP (HTTP)
await step('FONT', async () => {
  for (const f of FONT_FILES) {
    const r = await get('/fonts/' + f);
    R.check(`FONT1 /fonts/${f}: 200, font/woff2, Cache-Control "public, max-age=2592000", wOF2 magic`, r.status === 200 && /font\/woff2/.test(r.h.get('content-type') || '') && r.h.get('cache-control') === 'public, max-age=2592000' && r.body.slice(0, 4).toString() === 'wOF2', `${r.status} ${r.h.get('content-type')} ${r.h.get('cache-control')}`);
  }
  const h = await fetch(base + '/fonts/oswald-latin.woff2', { method: 'HEAD' });
  R.check('FONT2 HEAD font: 200 + same Cache-Control', h.status === 200 && h.headers.get('cache-control') === 'public, max-age=2592000');
  const ofl = await get('/fonts/OFL.txt');
  R.check('FONT3 /fonts/OFL.txt (licence) served 200', ofl.status === 200 && /SIL OPEN FONT LICENSE/i.test(txt(ofl)), String(ofl.status));
  const css = await get('/css/fonts.css'); const st = await get('/css/style.css');
  R.check('FONT4 non-font assets keep Cache-Control no-cache (css/fonts.css, css/style.css, /js/i18n.js)', css.h.get('cache-control') === 'no-cache' && st.h.get('cache-control') === 'no-cache' && (await get('/js/i18n.js')).h.get('cache-control') === 'no-cache', `${css.h.get('cache-control')}`);
  R.check('FONT5 no reference to fonts.googleapis/gstatic anywhere in public/ (git grep)', (() => { try { const o = require_gitgrep('fonts\\.(googleapis|gstatic)\\.com', 'public'); return o === ''; } catch { return false; } })());
  const dirRes = await get('/fonts/', HTML);
  R.check('FONT6 /fonts/ directory listing not exposed (404)', dirRes.status === 404, String(dirRes.status));
});
function require_gitgrep(pattern, where) {
  return Buffer.from(spawnSyncOut('git', ['grep', '-nIiE', pattern, '--', where])).toString().trim();
}
import { spawnSync } from 'node:child_process';
function spawnSyncOut(cmd, args) { const r = spawnSync(cmd, args, { cwd: ROOT }); return r.stdout || ''; }

await step('CSP', async () => {
  const wanted = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
  for (const [p, hd] of [['/', HTML], ['/daily-menu', HTML], ['/privacy', HTML], ['/no-such-page', HTML], ['/admin/', HTML], ['/api/public/site', {}], ['/fonts/oswald-latin.woff2', {}], ['/css/style.css', {}], ['/no-such-json', {}]]) {
    const r = await get(p, hd); const csp = r.h.get('content-security-policy') || '';
    const d = Object.fromEntries(csp.split(';').map((s) => s.trim()).filter(Boolean).map((s) => { const [k, ...v] = s.split(/\s+/); return [k, v.join(' ')]; }));
    R.check(`CSP1 ${p}: header has font-src exactly 'self', style-src exactly 'self', script-src 'self', no googleapis/gstatic`, d['font-src'] === "'self'" && d['style-src'] === "'self'" && d['script-src'] === "'self'" && !/google|gstatic|unsafe/.test(csp), csp);
  }
  const r = await get('/', HTML);
  R.check('CSP2 exact full policy string on /', (r.h.get('content-security-policy') || '') === wanted, r.h.get('content-security-policy'));
  const html = ['/', '/daily-menu', '/privacy', '/reservation', '/no-such-page', '/admin/'];
  for (const p of html) { const b = txt(await get(p, HTML)); R.check(`CSP3 ${p}: no inline <style>/<script> body, no style="" attributes, no external stylesheet/script/font link (the only allowed external href is the https://(www.)instagram.com/ icon link, D-36)`, !/<style\b/i.test(b) && !/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(b) && !/\sstyle="/i.test(b) && !/(href|src)="https?:\/\/(?!(?:www\.)?instagram\.com\/")/i.test(b.replace(/xmlns="[^"]*"/g, '')), ''); }
});

// ============================================================ B. HTML / JSON 404
await step('NF', async () => {
  const r = await get('/no-such-page', HTML); const b = txt(r);
  R.check('NF1 GET /no-such-page (Accept text/html): 404, text/html, 404.html body', r.status === 404 && /text\/html/.test(r.h.get('content-type')) && b === fs.readFileSync(path.join(ROOT, 'public/404.html'), 'utf8').replace(/__SITE_URL__/g, ''), `${r.status} ${r.h.get('content-type')}`);
  R.check('NF2 404 page is noindex and no-cache', /<meta name="robots" content="noindex/.test(b) && r.h.get('cache-control') === 'no-cache', r.h.get('cache-control'));
  const h = await fetch(base + '/no-such-page', { method: 'HEAD', headers: HTML });
  R.check('NF3 HEAD /no-such-page html: 404 + text/html', h.status === 404 && /text\/html/.test(h.headers.get('content-type')));
  for (const p of ['/a/b/c', '/foo.html', '/admin/nope', '/fonts/nope.woff2', '/privacy/x', '/js/nope.js', '/PRIVACY']) { const x = await get(p, HTML); R.check(`NF4 ${p} (html): 404 + branded page`, x.status === 404 && /data-page="notfound"/.test(txt(x)), String(x.status)); }
  const j = await get('/api/nope', HTML);
  R.check('NF5 /api/nope even with Accept text/html: JSON 404 {error:not_found}', j.status === 404 && /json/.test(j.h.get('content-type')) && JSON.parse(txt(j)).error === 'not_found', txt(j));
  const j2 = await get('/api/nope'); R.check('NF6 /api/nope (no Accept): JSON 404', j2.status === 404 && /json/.test(j2.h.get('content-type')));
  const m = await get('/media/nope', HTML); R.check('NF7 /media/nope with Accept text/html: JSON (not HTML) 404', m.status === 404 && /json/.test(m.h.get('content-type')), `${m.status} ${m.h.get('content-type')}`);
  for (const [meth, p] of [['POST', '/no-such-page'], ['PUT', '/privacy'], ['DELETE', '/nope'], ['PATCH', '/x'], ['POST', '/api/nope'], ['POST', '/']]) {
    const x = await fetch(base + p, { method: meth, headers: { accept: 'text/html', 'content-type': 'application/json' }, body: '{}' });
    const t = await x.text(); R.check(`NF8 ${meth} ${p} with Accept text/html: JSON error, not HTML (status ${x.status})`, /json/.test(x.headers.get('content-type') || '') && !/<html/i.test(t) && x.status >= 400, t.slice(0, 80));
  }
  for (const a of ['application/json', '*/*', 'image/png', '']) { const x = await get('/no-such-page', a ? { accept: a } : {}); R.check(`NF9 GET /no-such-page Accept "${a}": JSON 404`, x.status === 404 && /json/.test(x.h.get('content-type')) && !/<html/i.test(txt(x))); }
  // traversal / hidden files never leak (html or otherwise)
  for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/.env', '/.git/config', '/fonts/..%2f..%2f..%2fpackage.json', '/..%5c..%5cpackage.json', '/%00', '/server/src/app.js', '/index.html%00.png', '/%2e%2e%2fserver%2fsrc%2fapp.js']) {
    const x = await get(p, HTML); const t = txt(x);
    R.check(`NF10 traversal/hidden ${p}: no source/secret content (status ${x.status})`, !/"name": "kota-restaurant"|createApp|\[core\]/.test(t) && x.status !== 500, `${x.status}`);
  }
  const bad = await get('/%E0%A4%A', HTML); R.check('NF11 malformed percent-encoding: no 500', bad.status < 500, String(bad.status));
  const priv = await get('/privacy.html'); const idx = await get('/index.html'); const adm = await get('/admin');
  R.check('NF12 /privacy.html 200, /index.html 200, /admin redirects (3xx) to /admin/, /admin/ 200 no-cache', priv.status === 200 && idx.status === 200 && adm.status >= 301 && adm.status <= 308 && (await get('/admin/')).status === 200 && (await get('/admin/')).h.get('cache-control') === 'no-cache', `${adm.status} ${adm.h.get('location')}`);
  const fav = await get('/favicon.ico', { accept: 'image/avif,image/webp,*/*' }); R.check('NF13 INFO /favicon.ico (not provided): 404 JSON, no crash', fav.status === 404, String(fav.status));
});

// ============================================================ C. SITE_URL
await step('SU', async () => {
  const none = {}; const tokenRe = /__SITE_URL__/;
  const routes = ['/', '/index.html', '/daily-menu', '/daily-menu.html', '/privacy', '/privacy.html', '/no-such-page', '/404.html', '/admin/', '/admin/index.html'];
  for (const p of routes) { const r = await get(p, HTML); const t = txt(r); R.check(`SU1 unset: ${p} token never served, no "undefined"/"null" in og:url`, !tokenRe.test(t) && !/content="(undefined|null)/.test(t), `${r.status}`); }
  for (const [p] of PAGES) { const t = txt(await get(p, HTML)); const u = meta(t, 'property', 'og:url'); const i = meta(t, 'property', 'og:image'); R.check(`SU2 unset: ${p} og:url="${u}" og:image="${i}" (token replaced by '')`, u === (p === '/' ? '/' : p) && i === '/images/og-image.png' && meta(t, 'name', 'twitter:image') === '/images/og-image.png'); }
  // with SITE_URL
  const d2 = tmpDir('launch-su'); createAdmin(d2);
  const s2 = await startServer({ port: 3202, dataDir: d2, now: T0, env: { SITE_URL: 'https://kota.example.com/' } }); // trailing slash must be normalised away
  try {
    const b2 = s2.url; const g2 = async (p, h = HTML) => { const r = await fetch(b2 + p, { headers: h }); return { status: r.status, h: r.headers, t: await r.text() }; };
    for (const [p] of PAGES) {
      const r = await g2(p); const url = 'https://kota.example.com' + (p === '/' ? '/' : p);
      R.check(`SU3 SITE_URL set: ${p} og:url=${url}, og:image + twitter:image absolute, no "//" doubling`, meta(r.t, 'property', 'og:url') === url && meta(r.t, 'property', 'og:image') === 'https://kota.example.com/images/og-image.png' && meta(r.t, 'name', 'twitter:image') === 'https://kota.example.com/images/og-image.png' && !tokenRe.test(r.t), `${meta(r.t, 'property', 'og:url')} | ${meta(r.t, 'property', 'og:image')}`);
    }
    const nf = await g2('/no-such-page');
    R.check('SU4 SITE_URL set: 404 page 404 status, no token left (404.html carries no og:url by design)', nf.status === 404 && !tokenRe.test(nf.t), `${nf.status} og:url=${meta(nf.t, 'property', 'og:url')}`);
    for (const p of ['/admin/', '/index.html', '/privacy.html', '/daily-menu.html', '/404.html']) R.check(`SU5 SITE_URL set: ${p} token not served`, !tokenRe.test((await g2(p)).t));
    const httpGet = (u, headers) => new Promise((res, rej) => http.get(u, { headers }, (r) => { r.resume(); r.on('end', () => res({ status: r.statusCode, h: r.headers })); }).on('error', rej));
    const e1 = await httpGet(b2 + '/privacy', HTML); const e2 = await httpGet(b2 + '/privacy', { ...HTML, 'if-none-match': e1.h.etag || 'x' });
    R.check('SU6 HTML Cache-Control no-cache, strong ETag revalidation (304) works on the replaced body', e1.h['cache-control'] === 'no-cache' && !!e1.h.etag && e2.status === 304, `${e1.h.etag} -> ${e2.status}`);
    const h = await fetch(b2 + '/', { method: 'HEAD' }); R.check('SU7 HEAD / 200 with text/html', h.status === 200 && /text\/html/.test(h.headers.get('content-type')));
    const img = await fetch(b2 + '/images/og-image.png'); R.check('SU8 og:image path resolves on server (200 image/png)', img.status === 200 && img.headers.get('content-type') === 'image/png');
  } finally { await s2.stop(); }
  // SITE_URL with path and risky characters: server must emit escaped, attribute-safe output
  const d3 = tmpDir('launch-su2'); createAdmin(d3);
  const s3 = await startServer({ port: 3202, dataDir: d3, now: T0, env: { SITE_URL: "https://kota.example.com/a\"><script>window.__x=1</script>'b" } }).catch((e) => ({ err: e }));
  if (s3.err) R.pass('SU9 SITE_URL containing quote/angle brackets rejected at start or normalised', String(s3.err.message).slice(0, 100));
  else { try { const t = await (await fetch(s3.url + '/', { headers: HTML })).text(); R.check('SU9 SITE_URL with " > < \' : output has no raw script/attribute breakout', !/<script>window\.__x/.test(t) && !/og:url" content="[^"]*"><script/.test(t), meta(t, 'property', 'og:url')); } finally { await s3.stop(); } }
  // invalid values: must refuse to start (non-zero exit, nothing listening)
  for (const v of ['not a url', 'kota.example.com', 'ftp://kota.example.com', 'javascript:alert(1)', 'https://user:pw@kota.example.com', 'https://kota.example.com/?a=1', 'https://kota.example.com/#x', 'https://']) {
    const d = tmpDir('launch-bad');
    const res = await new Promise((resolve) => {
      const c = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/src/server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3203', DATA_DIR: d, SITE_URL: v, KOTA_NOW: '', NODE_ENV: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = ''; c.stdout.on('data', (x) => { log += x; }); c.stderr.on('data', (x) => { log += x; });
      const to = setTimeout(() => { c.kill('SIGKILL'); resolve({ code: 'timeout(still running)', log }); }, 5000);
      c.on('exit', (code) => { clearTimeout(to); resolve({ code, log }); });
    });
    R.check(`SU10 SITE_URL=${JSON.stringify(v)} -> server refuses to start (exit != 0, clear message, no listen)`, typeof res.code === 'number' && res.code !== 0 && /SITE_URL/.test(res.log) && !/listening/.test(res.log), `exit=${res.code} ${res.log.trim().slice(0, 120)}`);
  }
  // empty / whitespace behave as unset
  for (const v of ['', '   ']) {
    const d = tmpDir('launch-empty'); createAdmin(d);
    const s = await startServer({ port: 3203, dataDir: d, now: T0, env: { SITE_URL: v } }).catch((e) => ({ err: e }));
    if (s.err) R.fail(`SU11 SITE_URL=${JSON.stringify(v)} should start as unset`, String(s.err.message).slice(0, 100));
    else { try { const t = await (await fetch(s.url + '/', { headers: HTML })).text(); R.check(`SU11 SITE_URL=${JSON.stringify(v)} treated as unset (og:url "/")`, meta(t, 'property', 'og:url') === '/' && !tokenRe.test(t)); } finally { await s.stop(); } }
  }
  R.check('SU12 only the 4 meta pages (index, daily-menu, privacy, reservation) carry the token in source (git grep)', (() => { const o = require_gitgrep('__SITE_URL__', 'public').split('\n').map((l) => l.split(':')[0]); return [...new Set(o)].sort().join(',') === 'public/daily-menu.html,public/index.html,public/privacy.html,public/reservation.html'; })());
});

// ============================================================ D. OG / Twitter meta, image, favicons
await step('OG', async () => {
  const seen = {};
  for (const [p, name] of PAGES) {
    const t = txt(await get(p, HTML)); seen[p] = t;
    const og = (n) => meta(t, 'property', n); const tw = (n) => meta(t, 'name', n);
    const title = og('og:title'); const desc = og('og:description');
    const docTitle = /<title>([^<]*)<\/title>/.exec(t)?.[1]; const mdesc = meta(t, 'name', 'description');
    R.check(`OG1 ${p}: og:title/description present, title<=70, desc 40..300, match <title>/meta description`, !!title && !!desc && title.length <= 70 && desc.length >= 40 && desc.length <= 300 && (p === '/' ? docTitle.includes(title) : title === docTitle) && desc === mdesc, `${title} | ${desc?.length}`);
    R.check(`OG2 ${p}: og:type (${p === '/' ? 'restaurant' : 'website'}), site_name, locale bg_BG + alternate en_GB, image 1200x630 declared`, og('og:type') === (p === '/' ? 'restaurant' : 'website') && og('og:site_name') === 'Kota1 Restaurant' && og('og:locale') === 'bg_BG' && og('og:locale:alternate') === 'en_GB' && og('og:image:width') === '1200' && og('og:image:height') === '630');
    R.check(`OG3 ${p}: twitter:card summary_large_image + title/description/image`, tw('twitter:card') === 'summary_large_image' && tw('twitter:title') === title && tw('twitter:description') === desc && !!tw('twitter:image'));
    R.check(`OG4 ${p}: html lang set, no duplicate og:title/og:image tags`, /<html lang="bg"/.test(t) && (t.match(/property="og:title"/g) || []).length === 1 && (t.match(/property="og:image"/g) || []).length === 1);
  }
  const img = await get('/images/og-image.png'); const sz = pngSize(img.body);
  R.check('OG5 /images/og-image.png: 200 image/png, real PNG 1200x630, < 600 kB', img.status === 200 && img.h.get('content-type') === 'image/png' && sz && sz[0] === 1200 && sz[1] === 630 && img.body.length < 600 * 1024, `${img.status} ${sz} ${img.body.length}B`);
  const fv = { '/favicon.svg': ['image/svg+xml'], '/favicon-32.png': ['image/png', [32, 32]], '/apple-touch-icon.png': ['image/png', [180, 180]] };
  for (const [p, [ct, dims]] of Object.entries(fv)) {
    const r = await get(p); const ok = r.status === 200 && (r.h.get('content-type') || '').startsWith(ct);
    const dimOk = dims ? (() => { const s = pngSize(r.body); return s && s[0] === dims[0] && s[1] === dims[1]; })() : (/^<svg|<\?xml/.test(txt(r).trim()) && !/<script|onload|href="http/.test(txt(r)));
    R.check(`FAV1 ${p}: 200, ${ct}${dims ? ' ' + dims.join('x') : ', valid SVG without script/external refs'}`, ok && dimOk, `${r.status} ${r.h.get('content-type')}`);
  }
  for (const p of ['/', '/daily-menu', '/privacy', '/no-such-page', '/admin/']) {
    const t = txt(await get(p, HTML)); const L = linkTags(t);
    const need = [['icon', '/favicon.svg', 'image/svg+xml'], ['icon', '/favicon-32.png', 'image/png'], ['apple-touch-icon', '/apple-touch-icon.png']];
    const okAll = need.every(([rel, href, type]) => L.some((l) => l.rel === rel && l.href === href && (!type || l.type === type)));
    let resolves = true; for (const [, href] of need) resolves = resolves && (await get(href)).status === 200;
    R.check(`FAV2 ${p}: links rel=icon svg + png32 + apple-touch-icon, all resolve 200`, okAll && resolves, JSON.stringify(L.filter((l) => /icon/.test(l.rel))));
  }
});

// ============================================================ E. Browser
const browser = await chromium.launch();
const VPS = [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1280', width: 1280, height: 800 }];
const cleanEv = async (page, log, allow404 = false) => {
  const csp = await page.collectCsp();
  const h4 = log.http4xx.filter((x) => !(allow404 && x.startsWith('404 ') && /no-such-page/.test(x)) && !/^401 .*\/api\/admin\/me$/.test(x));
  const cons = log.console.filter((x) => !(allow404 && /status of 404.*no-such-page/.test(x)) && !/status of 401.*\/api\/admin\/me/.test(x));
  return { ok: cons.length === 0 && log.pageErrors.length === 0 && log.failed.length === 0 && h4.length === 0 && csp.length === 0 && log.envNoise.length === 0, ev: JSON.stringify({ c: cons, p: log.pageErrors, f: log.failed, h: h4, csp, env: log.envNoise }) };
};
const isLocal = (u) => /^(data:|blob:|about:)/.test(u) || u.startsWith(base + '/');

// --- E1: no third-party requests, fonts, CSP, scroll on 5 pages x 2 langs x 3 viewports
const E1 = [['/', 'home'], ['/daily-menu', 'daily'], ['/privacy', 'privacy'], ['/no-such-page', '404'], ['/admin/', 'admin']];
for (const vp of VPS) for (const [route, tag] of E1) for (const lang of ['bg', 'en']) {
  await step(`E1[${tag} ${lang} ${vp.name}]`, async () => {
    const { context, page, log } = await newPage(browser, { width: vp.width, height: vp.height, baseURL: base });
    const reqs = []; const fontResp = [];
    context.on('request', (r) => reqs.push(r.url()));
    page.on('response', (r) => { if (/\/fonts\/.*\.woff2/.test(r.url())) fontResp.push({ u: r.url(), s: r.status(), cc: r.headers()['cache-control'], ct: r.headers()['content-type'] }); });
    if (tag === 'admin') await page.addInitScript((l) => { try { localStorage.setItem('kota_lang', l); } catch { /* */ } }, lang);
    const resp = await page.goto(base + route + (tag === 'admin' ? '' : `?lang=${lang}`), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400);
    const ext = reqs.filter((u) => !isLocal(u));
    R.check(`E1a[${tag} ${lang} ${vp.name}] zero requests to non-localhost hosts (${reqs.length} requests)`, ext.length === 0, ext.join(' ') || reqs.join(' ').slice(0, 200));
    const hdr = resp.headers();
    R.check(`E1b[${tag} ${lang} ${vp.name}] status ${tag === '404' ? 404 : 200}, CSP header present with font-src 'self' + style-src 'self', no violations event`, resp.status() === (tag === '404' ? 404 : 200) && /font-src 'self';/.test(hdr['content-security-policy'] || '') && /style-src 'self';/.test(hdr['content-security-policy'] || '') && (await page.collectCsp()).length === 0, `${resp.status()} ${await page.collectCsp()}`);
    const ce = await cleanEv(page, log, tag === '404'); R.check(`E1c[${tag} ${lang} ${vp.name}] no console/page errors, failed requests, 4xx (other than the 404 doc), CSP violations, env noise`, ce.ok, ce.ev);
    const nh = await noHScroll(page); R.check(`E1d[${tag} ${lang} ${vp.name}] no horizontal scroll`, nh.ok, `${nh.sw}/${nh.iw}`);
    const wantFace = lang === 'bg' ? 'cyrillic' : 'latin';
    const faces = await page.evaluate(() => [...document.fonts].map((f) => ({ fam: f.family.replace(/"/g, ''), st: f.status, ur: f.unicodeRange })));
    const loaded = faces.filter((f) => f.st === 'loaded');
    const hasCyr = loaded.some((f) => /U\+0?400-45F/i.test(f.ur)); const hasLat = loaded.some((f) => /U\+0?-FF/i.test(f.ur));
    R.check(`E1e[${tag} ${lang} ${vp.name}] ${faces.length} @font-face registered (8 expected); ${wantFace} face loaded (Oswald + Source Sans 3; admin login screen: Source Sans 3 only); no face in error state`, faces.length === 8 && faces.every((f) => f.st !== 'error') && (wantFace === 'cyrillic' ? hasCyr : hasLat) && (tag === 'admin' ? ['Source Sans 3'] : ['Oswald', 'Source Sans 3']).every((fam) => loaded.some((f) => f.fam === fam && (wantFace === 'cyrillic' ? /U\+0?400-45F/i.test(f.ur) : /U\+0?-FF/i.test(f.ur)))), JSON.stringify(loaded.map((f) => f.fam + ':' + f.ur.slice(0, 18))));
    const bad = fontResp.filter((f) => f.s !== 200 || f.cc !== 'public, max-age=2592000' || !/woff2/.test(f.ct));
    R.check(`E1f[${tag} ${lang} ${vp.name}] font requests: ${fontResp.length} fetched from /fonts, all 200 + max-age=2592000`, fontResp.length >= 2 && bad.length === 0, JSON.stringify(fontResp.map((f) => f.u.split('/').pop() + ':' + f.s)));
    if (vp.name === '1280' || vp.name === '390') {
      // the rendered glyphs use the self-hosted faces (CDP platform fonts), not a system fallback
      const cdp = await context.newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
      const doc = await cdp.send('DOM.getDocument'); const out = [];
      for (const sel of tag === 'admin' ? ['h1', 'label'] : ['h1', '.lead, main p']) {
        const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel }); if (!q.nodeId) continue;
        const f = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: q.nodeId }); out.push(sel + '=' + f.fonts.map((x) => `${x.familyName}${x.isCustomFont ? '(custom)' : '(SYSTEM)'}`).join('+'));
      }
      R.check(`E1g[${tag} ${lang} ${vp.name}] rendered text uses self-hosted faces (CDP getPlatformFontsForNode)`, out.length > 0 && out.every((o) => !/SYSTEM/.test(o)) && out.some((o) => /custom/.test(o)), out.join(' ; '));
    }
    if (!(await cleanEv(page, log, tag === '404')).ok || ext.length) await page.screenshot({ path: path.join(shots, `launch-E1-${tag}-${lang}-${vp.name}.png`) });
    await context.close();
  });
}

// --- E2: 404 page behaviour
for (const vp of VPS) for (const lang of ['bg', 'en']) {
  await step(`E2[${lang} ${vp.name}]`, async () => {
    const { context, page, log } = await newPage(browser, { width: vp.width, height: vp.height });
    const resp = await page.goto(base + `/no-such-page?lang=${lang}`, { waitUntil: 'networkidle' });
    const L = lang === 'en' ? { h1: 'Page not found', home: 'Back to home', daily: 'Daily Specials', priv: 'Privacy' } : { h1: 'Страницата не е намерена', home: 'Към началото', daily: 'Обедно меню', priv: 'Поверителност' };
    const st = await page.evaluate(() => ({ h1: [...document.querySelectorAll('h1')].map((n) => n.textContent), html: document.documentElement.lang, title: document.title, robots: document.querySelector('meta[name=robots]')?.content, homeHref: document.querySelector('.hero-actions a.btn:not(.btn-special)')?.getAttribute('href'), dailyHref: document.querySelector('.hero-actions a.btn-special')?.getAttribute('href'), footer: document.querySelector('.footer-link')?.textContent, footerHref: document.querySelector('.footer-link')?.getAttribute('href'), mainFocusable: document.getElementById('main')?.tabIndex }));
    R.check(`E2a[${lang} ${vp.name}] 404 status, one h1 "${L.h1}", lang=${lang}, noindex, footer "${L.priv}"`, resp.status() === 404 && st.h1.length === 1 && st.h1[0] === L.h1 && st.html === lang && /noindex/.test(st.robots) && st.footer === L.priv, JSON.stringify(st));
    R.check(`E2b[${lang} ${vp.name}] action links keep language (home/daily/footer hrefs carry ?lang=en in EN, plain in BG)`, lang === 'en' ? (st.homeHref === '/?lang=en' && st.dailyHref === '/daily-menu?lang=en' && st.footerHref === '/privacy?lang=en') : (st.homeHref === '/' && st.dailyHref === '/daily-menu' && st.footerHref === '/privacy'), JSON.stringify([st.homeHref, st.dailyHref, st.footerHref]));
    // toggling language on the 404 page
    const other = lang === 'en' ? 'bg' : 'en'; await page.locator(`.lang-btn[data-lang="${other}"]`).click(); await page.waitForTimeout(300);
    const h1b = await page.locator('h1').textContent();
    R.check(`E2c[${lang} ${vp.name}] language switch on 404 page swaps h1 to ${other.toUpperCase()}`, h1b === (other === 'en' ? 'Page not found' : 'Страницата не е намерена'), h1b);
    await page.locator(`.lang-btn[data-lang="${lang}"]`).click(); await page.waitForTimeout(300);
    // links work
    await Promise.all([page.waitForURL(/\/(\?lang=en)?$/), page.locator('.hero-actions a.btn:not(.btn-special)').click()]);
    const r1 = await page.evaluate(() => ({ p: location.pathname, s: location.search, h: !!document.getElementById('menu-heading') }));
    R.check(`E2d[${lang} ${vp.name}] "${L.home}" opens the home page (${lang === 'en' ? '?lang=en kept' : 'no lang param'})`, r1.p === '/' && r1.s === (lang === 'en' ? '?lang=en' : '') && r1.h, JSON.stringify(r1));
    await page.goto(base + `/no-such-page?lang=${lang}`, { waitUntil: 'networkidle' });
    await Promise.all([page.waitForURL(/daily-menu/), page.locator('.hero-actions a.btn-special').click()]);
    R.check(`E2e[${lang} ${vp.name}] "${L.daily}" opens /daily-menu`, (await page.evaluate(() => location.pathname)) === '/daily-menu' && (await page.evaluate(() => location.search)) === (lang === 'en' ? '?lang=en' : ''));
    await page.goto(base + `/no-such-page?lang=${lang}`, { waitUntil: 'networkidle' });
    await Promise.all([page.waitForURL(/privacy/), page.locator('.footer-link').click()]);
    R.check(`E2f[${lang} ${vp.name}] footer link opens /privacy keeping language`, (await page.evaluate(() => location.pathname + location.search)) === (lang === 'en' ? '/privacy?lang=en' : '/privacy'));
    await page.goto(base + `/no-such-page?lang=${lang}`, { waitUntil: 'networkidle' });
    await Promise.all([page.waitForURL(/\/$|\?lang=en$|#menu/), page.locator('.logo').click()]);
    R.check(`E2g[${lang} ${vp.name}] logo link goes home`, (await page.evaluate(() => location.pathname)) === '/');
    R.check(`E2h[${lang} ${vp.name}] no console errors (other than the intentional 404 document load) / CSP violations during 404 flows`, log.console.filter((x) => !/status of 404.*no-such-page/.test(x)).length === 0 && log.pageErrors.length === 0 && (await page.collectCsp()).length === 0 && log.failed.length === 0 && log.envNoise.length === 0, JSON.stringify(log));
    await context.close();
  });
}

// --- E3: privacy page + footer link on every public page
for (const vp of VPS) for (const lang of ['bg', 'en']) {
  await step(`E3[${lang} ${vp.name}]`, async () => {
    const { context, page, log } = await newPage(browser, { width: vp.width, height: vp.height });
    await page.goto(base + `/privacy?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ h1: [...document.querySelectorAll('h1')].map((n) => n.textContent), h2: [...document.querySelectorAll('h2')].map((n) => n.textContent), title: document.title, desc: document.querySelector('meta[name=description]')?.content, html: document.documentElement.lang, text: document.querySelector('main').innerText, contact: document.getElementById('privacy-contact').innerHTML, tel: document.querySelector('#privacy-contact a')?.getAttribute('href'), pressed: document.querySelector('.lang-btn[aria-pressed=true]').dataset.lang }));
    const en = lang === 'en';
    R.check(`E3a[${lang} ${vp.name}] /privacy: one h1 "${en ? 'Privacy' : 'Поверителност'}", 5 h2 sections, title/lang/meta in ${lang.toUpperCase()}`, st.h1.length === 1 && st.h1[0] === (en ? 'Privacy' : 'Поверителност') && st.h2.length === 5 && st.html === lang && st.pressed === lang && st.title === (en ? 'Privacy — Kota1 Restaurant' : 'Поверителност — Kota1 Restaurant') && st.desc.length > 40 && (en ? !/[Ѐ-ӿ]/.test(st.desc) : true), JSON.stringify([st.h1, st.h2, st.title]));
    const ph = (st.text.match(/\[[^\]]+\]/g) || []);
    R.check(`E3b[${lang} ${vp.name}] no bracket placeholders left (D-61: no [N] / [Хостинг / [Hosting / [Юридическо; contact fallback not shown because phone+address are set) - found ${ph.length}`, ph.length === 0 && !/\[N\]|\[Хостинг|\[Hosting|\[Юридическо/.test(st.text) && st.text.includes(en ? 'kept for 14 days' : 'Пазят се 14 дни') && st.text.includes(en ? 'SuperHosting.BG (Bulgaria)' : 'SuperHosting.BG (България)') && st.text.includes('BG207469415'), JSON.stringify(ph));
    const cyr = en ? st.text.split('\n').filter((l) => /[Ѐ-ӿ]/.test(l)).filter((l) => !/Амора Джелато ЕООД|Комисия за защита/.test(l)) : [];
    R.check(`E3c[${lang} ${vp.name}] EN page has no untranslated Cyrillic (other than the bilingual placeholder / authority name)`, cyr.length === 0, JSON.stringify(cyr));
    R.check(`E3d[${lang} ${vp.name}] contact block shows phone as well-formed tel: link and the address`, st.tel === 'tel:+359881234567' && st.contact.includes(en ? ADDR_EN : ADDR_BG), JSON.stringify([st.tel, st.contact.slice(0, 200)]));
    R.check(`E3e[${lang} ${vp.name}] claims match behaviour: page says no visitor cookies; document.cookie empty, localStorage only the language key`, await page.evaluate(() => document.cookie === '' && Object.keys(localStorage).length <= 1), await page.evaluate(() => JSON.stringify(Object.keys(localStorage))));
    const nh = await noHScroll(page); R.check(`E3f[${lang} ${vp.name}] no horizontal scroll`, nh.ok, `${nh.sw}/${nh.iw}`);
    const ce = await cleanEv(page, log); R.check(`E3g[${lang} ${vp.name}] clean console/network/CSP`, ce.ok, ce.ev);
    // switch language on the page
    const other = en ? 'bg' : 'en'; await page.locator(`.lang-btn[data-lang="${other}"]`).click(); await page.waitForTimeout(300);
    R.check(`E3h[${lang} ${vp.name}] language switch re-renders h1 to ${other.toUpperCase()} and contact block label`, (await page.locator('h1').textContent()) === (other === 'en' ? 'Privacy' : 'Поверителност') && (await page.locator('#privacy-contact').innerHTML()).includes(other === 'en' ? ADDR_EN : ADDR_BG));
    // contrast + target size of footer link and h2 / body text
    await page.goto(base + `/privacy?lang=${lang}`, { waitUntil: 'networkidle' });
    for (const sel of ['.footer-link', '.prose p', '.prose li', '#privacy-contact a']) { const c = await colorsOf(page, sel); const cr = contrast(c.fg, c.bg); R.check(`E3i[${lang} ${vp.name}] contrast ${sel} ${c.fg} on ${c.bg} = ${cr.toFixed(2)} (>= 4.5)`, cr >= 4.5); }
    const fb = await page.locator('.footer-link').boundingBox(); R.check(`E3j[${lang} ${vp.name}] footer link target >= 44 px high (${fb.height})`, fb.height >= 44);
    await context.close();
  });
}
for (const vp of VPS) await step(`E4[${vp.name}]`, async () => {
  // footer link on every public page: href keeps ?lang, follows a language switch, click works
  for (const route of ['/', '/daily-menu', '/privacy', '/no-such-page']) for (const lang of ['bg', 'en']) {
    const { context, page } = await newPage(browser, { width: vp.width, height: vp.height });
    await page.goto(base + route + `?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
    const n = await page.locator('footer a.footer-link').count(); const h = await page.locator('footer a.footer-link').first().getAttribute('href');
    const label = await page.locator('footer a.footer-link').first().textContent();
    R.check(`E4a[${vp.name}] ${route}?lang=${lang}: exactly 1 footer privacy link, href ${lang === 'en' ? '/privacy?lang=en' : '/privacy'}, label ${lang === 'en' ? 'Privacy' : 'Поверителност'}`, n === 1 && h === (lang === 'en' ? '/privacy?lang=en' : '/privacy') && label === (lang === 'en' ? 'Privacy' : 'Поверителност'), `${n} ${h} ${label}`);
    const other = lang === 'en' ? 'bg' : 'en'; await page.locator(`.lang-btn[data-lang="${other}"]`).click(); await page.waitForTimeout(400);
    const h2 = await page.locator('footer a.footer-link').first().getAttribute('href');
    R.check(`E4b[${vp.name}] ${route}: after switching ${lang}->${other} the footer href is ${other === 'en' ? '/privacy?lang=en' : '/privacy'}`, h2 === (other === 'en' ? '/privacy?lang=en' : '/privacy'), h2);
    await Promise.all([page.waitForURL(/\/privacy/), page.locator('footer a.footer-link').first().click()]);
    await page.waitForLoadState('networkidle');
    R.check(`E4c[${vp.name}] ${route}: click -> /privacy in ${other.toUpperCase()}`, (await page.locator('h1').textContent()) === (other === 'en' ? 'Privacy' : 'Поверителност') && (await page.getAttribute('html', 'lang')) === other, page.url());
    await context.close();
  }
});

// --- E5: map link
async function mapState(page) {
  return page.evaluate(() => {
    const dd = [...document.querySelectorAll('#location-list dd')]; const a = document.querySelector('#location-list a.map-link');
    return { n: document.querySelectorAll('a.map-link').length, href: a?.getAttribute('href') ?? null, abs: a?.href ?? null, target: a?.target, rel: a?.rel, text: a?.textContent.replace(/\s+/g, ' ').trim(), name: a?.innerText, addrText: document.querySelector('.address-text')?.textContent ?? null, imgs: document.querySelectorAll('#location img, #location script, #location iframe').length, xss: window.__xss, contactHidden: document.getElementById('location').hidden || document.getElementById('contact').hidden, dds: dd.length, svg: !!a?.querySelector('svg[aria-hidden="true"]'), iframe: document.querySelectorAll('iframe').length };
  });
}
for (const vp of VPS) for (const lang of ['bg', 'en']) {
  await step(`E5[${lang} ${vp.name}]`, async () => {
    await setSettings({});
    const { context, page, log } = await newPage(browser, { width: vp.width, height: vp.height });
    const reqs = []; context.on('request', (r) => reqs.push(r.url()));
    await page.goto(base + `/?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
    const st = await mapState(page); const en = lang === 'en';
    R.check(`E5a[${lang} ${vp.name}] one map link; href is exactly the fixed Google Maps pin`, st.n === 1 && st.href === MAP_URL, `${st.href}`);
    const u = new URL(st.abs);
    R.check(`E5b[${lang} ${vp.name}] parsed: https, maps.app.goo.gl, no credentials`, u.protocol === 'https:' && u.hostname === 'maps.app.goo.gl' && !u.username);
    R.check(`E5c[${lang} ${vp.name}] target=_blank, rel has noopener + noreferrer`, st.target === '_blank' && /\bnoopener\b/.test(st.rel) && /\bnoreferrer\b/.test(st.rel), st.rel);
    R.check(`E5d[${lang} ${vp.name}] accessible name says it opens in a new tab ("${en ? 'View on map (opens in a new tab)' : 'Виж на картата (отваря се в нов раздел)'}"), icon aria-hidden`, st.text === (en ? 'View on map (opens in a new tab)' : 'Виж на картата (отваря се в нов раздел)') && st.svg, st.text);
    R.check(`E5e[${lang} ${vp.name}] address text node intact ("${en ? ADDR_EN : ADDR_BG}"), no iframe/embedded map`, st.addrText === (en ? ADDR_EN : ADDR_BG) && st.iframe === 0, JSON.stringify(st.addrText));
    const reqExt = reqs.filter((x) => !isLocal(x)); R.check(`E5f[${lang} ${vp.name}] page load makes no request to Google / third parties`, reqExt.length === 0, reqExt.join(' '));
    const box = await page.locator('a.map-link').boundingBox(); R.check(`E5g[${lang} ${vp.name}] map link target height >= 44 px (${box.height})`, box.height >= 44);
    const c = await colorsOf(page, 'a.map-link'); const cr = contrast(c.fg, c.bg); R.check(`E5h[${lang} ${vp.name}] map link contrast ${c.fg} on ${c.bg} = ${cr.toFixed(2)} (>= 4.5)`, cr >= 4.5);
    const nh = await noHScroll(page); R.check(`E5i[${lang} ${vp.name}] no horizontal scroll with map link`, nh.ok, `${nh.sw}/${nh.iw}`);
    // keyboard focus visible
    await page.locator('a.map-link').scrollIntoViewIfNeeded(); await page.evaluate(() => document.body.focus());
    let focused = false; for (let i = 0; i < 80 && !focused; i++) { await page.keyboard.press('Tab'); focused = await page.evaluate(() => document.activeElement?.classList.contains('map-link')); }
    const fo = focused ? await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { o: cs.outlineStyle, w: parseFloat(cs.outlineWidth), col: cs.outlineColor, shadow: cs.boxShadow }; }) : null;
    R.check(`E5j[${lang} ${vp.name}] map link reachable by Tab and shows a visible focus indicator`, !!fo && ((fo.o !== 'none' && fo.w >= 2) || fo.shadow !== 'none'), JSON.stringify(fo));
    // click opens a new tab to Google, current page stays (Google itself is intercepted: no real external request is made)
    await context.route('https://maps.app.goo.gl/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>maps stub</title>' }));
    const [pop] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }), page.locator('a.map-link').click()]);
    await pop.waitForLoadState().catch(() => {});
    R.check(`E5k[${lang} ${vp.name}] click opens a NEW tab at the pin URL; original page stays; popup cannot reach opener (noopener)`, pop.url() === MAP_URL && page.url().startsWith(base) && (await pop.evaluate(() => window.opener === null)), pop.url());
    await pop.close();
    R.check(`E5l[${lang} ${vp.name}] clean console/CSP during map flow`, log.console.length === 0 && log.pageErrors.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify(log.console));
    // language switch updates link without reload
    const other = en ? 'bg' : 'en'; await page.locator(`.lang-btn[data-lang="${other}"]`).click(); await page.waitForTimeout(600);
    const st2 = await mapState(page); R.check(`E5m[${lang} ${vp.name}] language switch to ${other.toUpperCase()}: one map link, same pin href, label translated`, st2.n === 1 && st2.href === MAP_URL && st2.text.startsWith(other === 'en' ? 'View on map' : 'Виж на картата'), `${st2.href} ${st2.text}`);
    await context.close();
  });
}

// hidden when address empty (and hours/phone remain)
await step('E6', async () => {
  for (const vp of VPS) for (const lang of ['bg', 'en']) {
    for (const [label, over] of [['address empty', { address: '', addressEn: '' }], ['address whitespace', { address: '   ', addressEn: '   ' }]]) {
      const r = await setSettings(over); if (r.status !== 200) { R.pass(`E6a[${label} ${lang} ${vp.name}] server rejects/normalises whitespace address (status ${r.status})`); continue; }
      const { context, page, log } = await newPage(browser, { width: vp.width, height: vp.height });
      await page.goto(base + `/?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
      const st = await mapState(page);
      // D-37 (intended change): the Location section is always visible; an empty/blank address falls back to the default address (and its map link)
      const defAddr = lang === 'en' ? '85 Ralevitsa St, Sofia' : 'ул. Ралевица 85, София';
      R.check(`E6a[${label} ${lang} ${vp.name}] empty address => default address "${defAddr}" + exactly one map link (fixed pin); hours row still shown; Location/Contact visible`, st.n === 1 && st.addrText === defAddr && st.href === MAP_URL && st.dds >= 2 && st.contactHidden === false, JSON.stringify({ n: st.n, a: st.addrText, h: st.href, dds: st.dds, ch: st.contactHidden }));
      R.check(`E6b[${label} ${lang} ${vp.name}] no console errors`, log.console.length === 0 && log.pageErrors.length === 0);
      await context.close();
    }
  }
  // EN address empty but BG set: EN falls back to BG address (map link follows the displayed text)
  await setSettings({ addressEn: '' });
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(base + '/?lang=en', { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
  const st = await mapState(page);
  R.check('E6c EN with empty addressEn: address shown and map link is the fixed pin', st.n === 0 || (st.addrText && st.href === MAP_URL), JSON.stringify([st.addrText, st.href]));
  await context.close();
  // privacy: no phone, no address -> unset message
  await setSettings({ address: '', addressEn: '', reservationPhone: '', contactEmail: '' }); // D-55: the migration-008 seed email would otherwise suppress the placeholder
  const c2 = await newPage(browser, { width: 390, height: 844 });
  await c2.page.goto(base + '/privacy', { waitUntil: 'networkidle' }); await c2.page.waitForTimeout(250);
  R.check('E6d privacy contact placeholder shown when phone+address+email unset (BG)', (await c2.page.locator('#privacy-contact').textContent()).includes('[Телефон и адрес на ресторанта'), await c2.page.locator('#privacy-contact').textContent());
  await c2.page.goto(base + '/privacy?lang=en', { waitUntil: 'networkidle' }); await c2.page.waitForTimeout(250);
  R.check('E6e privacy contact placeholder shown when unset (EN)', (await c2.page.locator('#privacy-contact').textContent()).includes('[Restaurant phone and address'));
  await c2.context.close();
  await setSettings({});
});

// --- E7: injection through the address
const PAYLOADS = ['"><img src=x onerror=window.__xss=1>', 'javascript:alert(1)', "'><script>window.__xss=2</script>", 'https://evil.example/phish', '//evil.example', 'x&api=2&query=evil', 'a#frag', 'a?b=c', '</a><a href="https://evil.example">pwn</a>', '%0d%0aX', 'Ралевица\n85 ‮', '" onmouseover="window.__xss=3" x="'];
for (const vp of VPS) await step(`E7[${vp.name}]`, async () => {
  for (const lang of ['bg', 'en']) for (const [i, pl] of PAYLOADS.entries()) {
    const r = await setSettings(lang === 'bg' ? { address: pl } : { addressEn: pl, address: ADDR_BG });
    if (r.status !== 200) { R.pass(`E7a[${lang} ${vp.name}] payload #${i} rejected by server validation (${r.status})`); continue; }
    const { context, page, log } = await newPage(browser, { width: vp.width, height: vp.height });
    const popups = []; context.on('page', (p) => popups.push(p));
    await context.route('https://maps.app.goo.gl/**', (r2) => r2.fulfill({ status: 200, contentType: 'text/html', body: 'stub' }));
    await page.goto(base + `/?lang=${lang}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
    const st = await mapState(page); const shown = (lang === 'bg' ? pl : pl).trim();
    const u = st.abs ? new URL(st.abs) : null;
    const lookOk = st.n === 1 && u && st.href === MAP_URL && st.target === '_blank' && /noopener/.test(st.rel);
    R.check(`E7b[${lang} ${vp.name}] payload ${JSON.stringify(pl).slice(0, 40)}: link stays the fixed pin URL (address cannot alter it)`, lookOk, `${st.href}`);
    const inj = await page.evaluate(() => ({ xss: window.__xss, imgs: document.querySelectorAll('#location img, #location script, #location iframe, #location [onerror], #location [onmouseover]').length, anchors: [...document.querySelectorAll('#location a, #contact a')].map((a) => a.getAttribute('href')), pwn: document.querySelectorAll('main a:not(.map-link)[href*="evil"]').length }));
    R.check(`E7c[${lang} ${vp.name}] payload ${JSON.stringify(pl).slice(0, 40)}: no script ran, no injected elements/attributes, address shown as inert text, no other anchors to evil host`, inj.xss === undefined && inj.imgs === 0 && inj.pwn === 0 && (st.addrText || '').replace(/\s+/g, ' ').trim() === shown.replace(/\s+/g, ' ').trim(), JSON.stringify({ inj, t: st.addrText }));
    // hover + click, make sure no navigation of the current page and popup is Google
    await page.locator('a.map-link').hover();
    const [pop] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }).catch(() => null), page.locator('a.map-link').click()]);
    if (pop) await pop.waitForLoadState().catch(() => {});
    R.check(`E7d[${lang} ${vp.name}] payload ${JSON.stringify(pl).slice(0, 40)}: click opens only the maps pin tab; current page unchanged; still no script run`, !!pop && new URL(pop.url()).hostname === 'maps.app.goo.gl' && page.url().startsWith(base + '/') && (await page.evaluate(() => window.__xss)) === undefined, pop?.url());
    if (lang === 'en' && vp.name === '390' && i < 2) { // same payload on the privacy page (plain text node) and the public API
      await page.goto(base + '/privacy?lang=en', { waitUntil: 'networkidle' }); await page.waitForTimeout(250);
      const pv = await page.evaluate(() => ({ x: window.__xss, n: document.querySelectorAll('#privacy-contact img, #privacy-contact script, #privacy-contact a:not([href^=tel])[href*="evil"]').length, t: document.getElementById('privacy-contact').textContent }));
      R.check(`E7e privacy contact renders payload ${JSON.stringify(pl).slice(0, 30)} as text, nothing executes`, pv.x === undefined && pv.n === 0 && pv.t.includes(shown), JSON.stringify(pv).slice(0, 150));
    }
    const ce = log.console.length === 0 && log.pageErrors.length === 0; R.check(`E7f[${lang} ${vp.name}] payload #${i}: no page errors`, ce, JSON.stringify(log.console.concat(log.pageErrors)).slice(0, 160));
    await context.close();
  }
  await setSettings({});
});

await browser.close();
await srv.stop();
R.summary();
fs.writeFileSync(path.join(shots, 'launch-results.json'), JSON.stringify(R.results, null, 1));

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, parseSiteUrl } from '../src/app.js';
import { startApp } from './helpers.js';

const HTML = { Accept: 'text/html,application/xhtml+xml' };

function fixture({ with404 = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kota-pub-'));
  fs.mkdirSync(path.join(dir, 'fonts'));
  fs.mkdirSync(path.join(dir, 'admin'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<link rel="canonical" href="__SITE_URL__/"><p>home __SITE_URL__</p>');
  fs.writeFileSync(path.join(dir, 'privacy.html'), '<meta content="__SITE_URL__/privacy">');
  fs.writeFileSync(path.join(dir, 'admin', 'index.html'), '<base href="__SITE_URL__/admin/">');
  fs.writeFileSync(path.join(dir, 'style.css'), '/* __SITE_URL__ */ body{}');
  fs.writeFileSync(path.join(dir, 'fonts', 'a.woff2'), 'wOF2');
  if (with404) fs.writeFileSync(path.join(dir, '404.html'), '<h1>Not found</h1><a href="__SITE_URL__/">home</a>');
  return dir;
}

async function withApp(opts, fn) {
  const publicDir = fixture(opts);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kota-test-'));
  const app = createApp({ dataDir, publicDir, siteUrl: opts?.siteUrl });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    app.closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(publicDir, { recursive: true, force: true });
  }
}

test('CSP: self-hosted styles and fonts only, rest unchanged', async () => {
  const s = await startApp();
  try {
    for (const url of ['/', '/api/public/site', '/nope']) {
      const csp = (await fetch(s.base + url)).headers.get('content-security-policy');
      assert.equal(csp, "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
      assert.doesNotMatch(csp, /google|gstatic/);
    }
  } finally { await s.close(); }
});

test('404: HTML for browser navigation, JSON for api/media/non-HTML Accept', async () => {
  await withApp({}, async (base) => {
    let r = await fetch(base + '/nope', { headers: HTML });
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.match(r.headers.get('content-security-policy'), /style-src 'self'; font-src 'self'/);
    assert.equal(await r.text(), '<h1>Not found</h1><a href="/">home</a>');

    r = await fetch(base + '/nope/deeper.png', { headers: HTML });
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /text\/html/);

    r = await fetch(base + '/nope', { method: 'HEAD', headers: HTML });
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /text\/html/);

    for (const [url, headers] of [['/api/x', HTML], ['/api', HTML], ['/api/public/nope', HTML], ['/media/x', HTML], ['/media/123', HTML], ['/nope', { Accept: 'application/json' }], ['/nope', {}], ['/nope', { Accept: '*/*' }]]) {
      r = await fetch(base + url, { headers });
      assert.equal(r.status, 404, url);
      assert.match(r.headers.get('content-type'), /application\/json/, url);
      assert.equal((await r.json()).error?.code ?? 'not_found', 'not_found');
    }
    r = await fetch(base + '/nope', { method: 'POST', headers: HTML });
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /application\/json/);
  });
});

test('404: falls back to JSON when public/404.html does not exist', async () => {
  await withApp({ with404: false }, async (base) => {
    const r = await fetch(base + '/nope', { headers: HTML });
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /application\/json/);
  });
});

test('SITE_URL: token replaced in all html (pages, admin, 404), trailing slash stripped', async () => {
  await withApp({ siteUrl: 'https://kota1.bg/' }, async (base) => {
    for (const [url, expected] of [
      ['/', '<link rel="canonical" href="https://kota1.bg/"><p>home https://kota1.bg</p>'],
      ['/index.html', '<link rel="canonical" href="https://kota1.bg/"><p>home https://kota1.bg</p>'],
      ['/privacy', '<meta content="https://kota1.bg/privacy">'],
      ['/privacy.html', '<meta content="https://kota1.bg/privacy">'],
      ['/admin/', '<base href="https://kota1.bg/admin/">'],
    ]) {
      const r = await fetch(base + url);
      assert.equal(r.status, 200, url);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.equal(r.headers.get('cache-control'), 'no-cache');
      assert.equal(await r.text(), expected, url);
    }
    const nf = await fetch(base + '/nope', { headers: HTML });
    assert.equal(await nf.text(), '<h1>Not found</h1><a href="https://kota1.bg/">home</a>');
    // non-HTML files are untouched
    assert.equal(await (await fetch(base + '/style.css')).text(), '/* __SITE_URL__ */ body{}');
    // admin without trailing slash still redirects
    const red = await fetch(base + '/admin', { redirect: 'manual' });
    assert.equal(red.status, 301);
  });
});

test('SITE_URL: unset -> token replaced with empty string; ETag matches replaced body and revalidates', async () => {
  await withApp({}, async (base) => {
    const r = await fetch(base + '/');
    assert.equal(await r.text(), '<link rel="canonical" href="/"><p>home </p>');
    const etag = r.headers.get('etag');
    assert.ok(etag);
    const r2 = await fetch(base + '/', { headers: { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' } });
    assert.equal(r2.status, 304);
    assert.equal(r2.headers.get('cache-control'), 'no-cache');
    const head = await fetch(base + '/privacy', { method: 'HEAD' });
    assert.equal(head.status, 200);
  });
  await withApp({ siteUrl: '' }, async (base) => {
    assert.equal(await (await fetch(base + '/privacy')).text(), '<meta content="/privacy">');
  });
});

test('SITE_URL: validation', () => {
  assert.equal(parseSiteUrl(undefined), '');
  assert.equal(parseSiteUrl(''), '');
  assert.equal(parseSiteUrl('https://kota1.bg'), 'https://kota1.bg');
  assert.equal(parseSiteUrl('https://kota1.bg///'), 'https://kota1.bg');
  assert.equal(parseSiteUrl('http://localhost:3000/'), 'http://localhost:3000');
  for (const bad of ['kota1.bg', 'ftp://kota1.bg', 'javascript:alert(1)', '/relative', 'https://', 'https://u:p@kota1.bg', 'https://kota1.bg/?x=1', 'https://kota1.bg/#a', 'not a url']) {
    assert.throws(() => parseSiteUrl(bad), /SITE_URL/, bad);
  }
  assert.throws(() => createApp({ dataDir: os.tmpdir(), siteUrl: 'nope' }), /SITE_URL/);
});

test('SITE_URL: value is HTML-escaped when injected', async () => {
  await withApp({ siteUrl: "https://kota1.bg/a'b" }, async (base) => {
    assert.match(await (await fetch(base + '/privacy')).text(), /https:\/\/kota1\.bg\/a(&#39;|%27)b\/privacy/);
  });
});

test('server refuses to start with an invalid SITE_URL', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, SITE_URL: 'kota1.bg', PORT: '0', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'kota-boot-')) }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SITE_URL must be an absolute http\(s\) URL/);
});

test('fonts get a 30-day cache; other static files stay no-cache', async () => {
  await withApp({}, async (base) => {
    assert.equal((await fetch(base + '/fonts/a.woff2')).headers.get('cache-control'), 'public, max-age=2592000');
    assert.equal((await fetch(base + '/style.css')).headers.get('cache-control'), 'no-cache');
  });
});

test('real public dir: /privacy and /daily-menu resolve to their html files when present', async () => {
  const s = await startApp();
  try {
    for (const [url, file] of [['/daily-menu', 'daily-menu.html'], ['/privacy', 'privacy.html'], ['/', 'index.html'], ['/admin/', 'admin/index.html']]) {
      const exists = fs.existsSync(path.join(import.meta.dirname, '..', '..', 'public', file));
      const r = await fetch(s.base + url);
      assert.equal(r.status, exists ? 200 : 404, url);
      if (exists) assert.doesNotMatch(await r.text(), /__SITE_URL__/, url);
    }
  } finally { await s.close(); }
});

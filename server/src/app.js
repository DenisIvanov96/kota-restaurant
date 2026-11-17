import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createFiles } from './files.js';
import { errorHandler, HttpError } from './http.js';
import { publicApi, mediaRoute } from './routes/public.js';
import { adminApi } from './routes/admin/index.js';

const DEFAULT_PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";

export const CSP_VALUE = CSP;
const SITE_URL_TOKEN = /__SITE_URL__/g;

/**
 * Validate the SITE_URL setting: absolute http(s) URL without credentials/query/hash.
 * Returns the normalised value without a trailing slash, or '' when unset/empty. Throws on invalid input.
 */
export function parseSiteUrl(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return '';
  let u;
  try { u = new URL(String(raw).trim()); } catch { u = null; }
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname
      || u.username || u.password || u.search || u.hash) {
    throw new Error('SITE_URL must be an absolute http(s) URL such as https://kota1.bg (no credentials, query or fragment)');
  }
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

const escapeAttr = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const underPrefix = (p, prefix) => p === prefix || p.startsWith(prefix + '/');

/**
 * Express app factory.
 * @param {{dataDir: string, now?: () => number|Date, cookieSecure?: boolean, trustProxy?: any, siteUrl?: string, publicDir?: string}} opts
 * siteUrl replaces the `__SITE_URL__` token in served .html files ('' when unset); publicDir is a test hook.
 * The returned app has `app.closeDb()` and `app.locals.db`.
 */
export function createApp({ dataDir, now = () => Date.now(), cookieSecure = false, trustProxy = false, siteUrl, publicDir = DEFAULT_PUBLIC_DIR } = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  const PUBLIC_DIR = publicDir;
  const site = escapeAttr(parseSiteUrl(siteUrl));
  const nowMs = () => { const v = now(); return v instanceof Date ? v.getTime() : Number(v); };
  const db = openDb(dataDir);
  const files = createFiles({ db, dataDir, nowMs });
  files.sweepOrphans().catch((e) => console.error('Orphan sweep failed:', e && e.message));
  const ctx = { db, nowMs, files, config: { cookieSecure } };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.set('etag', 'strong');

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    if (req.path === '/admin' || req.path.startsWith('/admin/') || req.path.startsWith('/api/admin')) {
      res.set('X-Robots-Tag', 'noindex');
    }
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/public', publicApi(ctx));
  app.use('/api/admin', adminApi(ctx));
  app.use('/api', (req, res, next) => next(new HttpError(404, 'not_found', 'Не е намерено.')));
  app.use('/media', mediaRoute(ctx));

  const sendHtml = (res, file, status = 200) => {
    // Body is built per request, so Express computes the strong ETag on the replaced content.
    const body = fs.readFileSync(file, 'utf8').replace(SITE_URL_TOKEN, () => site);
    res.status(status).set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8' }).send(body);
  };

  // HTML pages (/, /daily-menu, /privacy, /admin/, explicit .html): token replacement, then no-cache.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.includes('\0') || rel.includes('\\') || rel.split('/').some((seg) => seg.startsWith('.'))) return next();
    const abs = path.join(PUBLIC_DIR, rel);
    if (abs !== PUBLIC_DIR && !abs.startsWith(PUBLIC_DIR + path.sep)) return next();
    let file = null;
    if (rel.endsWith('/')) file = path.join(abs, 'index.html');
    else if (isDir(abs)) return next(); // express.static redirects /admin -> /admin/
    else if (rel.endsWith('.html')) file = abs;
    else if (!path.extname(rel) || !isFile(abs)) file = abs + '.html';
    if (!file || !isFile(file)) return next();
    sendHtml(res, file);
  });

  app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    index: 'index.html',
    dotfiles: 'ignore',
    setHeaders: (res, filePath) => {
      const inFonts = filePath.startsWith(path.join(PUBLIC_DIR, 'fonts') + path.sep);
      res.set('Cache-Control', inFonts ? 'public, max-age=2592000' : 'no-cache');
    },
  }));

  // Browser navigation to an unknown path: branded HTML 404 (when public/404.html exists); everything else JSON.
  app.use((req, res, next) => {
    const notFoundPage = path.join(PUBLIC_DIR, '404.html');
    if ((req.method === 'GET' || req.method === 'HEAD') && !underPrefix(req.path, '/api') && !underPrefix(req.path, '/media')
        && String(req.headers.accept || '').toLowerCase().includes('text/html') && isFile(notFoundPage)) {
      return sendHtml(res, notFoundPage, 404);
    }
    next(new HttpError(404, 'not_found', 'Не е намерено.'));
  });
  app.use(errorHandler);

  app.locals.db = db;
  app.closeDb = () => { try { db.close(); } catch { /* already closed */ } };
  return app;
}

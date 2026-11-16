import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createFiles } from './files.js';
import { errorHandler, HttpError } from './http.js';
import { publicApi, mediaRoute } from './routes/public.js';
import { adminApi } from './routes/admin/index.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";

/**
 * Express app factory.
 * @param {{dataDir: string, now?: () => number|Date, cookieSecure?: boolean, trustProxy?: any}} opts
 * The returned app has `app.closeDb()` and `app.locals.db`.
 */
export function createApp({ dataDir, now = () => Date.now(), cookieSecure = false, trustProxy = false } = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  const nowMs = () => { const v = now(); return v instanceof Date ? v.getTime() : Number(v); };
  const db = openDb(dataDir);
  const files = createFiles({ db, dataDir, nowMs });
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

  app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    index: 'index.html',
    dotfiles: 'ignore',
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  }));
  app.use((req, res, next) => next(new HttpError(404, 'not_found', 'Не е намерено.')));
  app.use(errorHandler);

  app.locals.db = db;
  app.closeDb = () => { try { db.close(); } catch { /* already closed */ } };
  return app;
}

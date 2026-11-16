import express from 'express';
import { getSetting, siteSettings, publicSiteSettings, resolveCategories, pick, LANGS, latestSnapshot, publicFileInfo, fileUrlPublic, today, loc } from '../store.js';
import { kindOf, STORED_NAME_RE } from '../files.js';
import { isPubliclyVisible } from '../store.js';
import { HttpError, validationError } from '../http.js';

export function publicApi({ db, nowMs }) {
  const r = express.Router();

  // ?lang=bg|en (default bg); anything else is a 400.
  r.use((req, res, next) => {
    const q = req.query.lang;
    if (q === undefined) req.lang = 'bg';
    else if (typeof q === 'string' && LANGS.includes(q)) req.lang = q;
    else return next(validationError({ lang: 'Допустими стойности: bg, en.' }));
    return next();
  });

  r.get('/site', (req, res) => res.json({ lang: req.lang, ...publicSiteSettings(db, req.lang) }));

  r.get('/events', (req, res) => {
    const now = nowMs();
    const rows = db.prepare(`SELECT e.*, f.stored_name FROM events e LEFT JOIN files f ON f.id = e.image_file_id
      WHERE e.enabled = 1 AND (e.starts_at IS NULL OR e.starts_at <= ?) AND (e.expires_at IS NULL OR e.expires_at > ?)
      ORDER BY e.event_at IS NULL, e.event_at, e.starts_at IS NULL, e.starts_at, e.id`).all(now, now);
    res.json({
      lang: req.lang,
      events: rows.map((e) => ({
        id: e.id, title: pick(req.lang, e.title, e.title_en), description: pick(req.lang, e.description, e.description_en),
        imageUrl: e.stored_name ? fileUrlPublic(e.stored_name) : null,
        eventAt: loc(e.event_at),
      })),
    });
  });

  r.get('/daily-menu', (req, res) => {
    const t = today(nowMs());
    const row = db.prepare(`SELECT d.*, f.stored_name, f.mime_type FROM daily_menus d JOIN files f ON f.id = d.file_id
      WHERE d.menu_date = ? AND d.published = 1`).get(t);
    res.json({
      lang: req.lang,
      today: t,
      menu: row ? { date: row.menu_date, fileUrl: fileUrlPublic(row.stored_name), mimeType: row.mime_type, kind: kindOf(row.mime_type), updatedAt: loc(row.updated_at) } : null,
    });
  });

  r.get('/menu', (req, res) => {
    const mode = getSetting(db, 'menu_mode') === 'file' ? 'file' : 'structured';
    const out = { lang: req.lang, mode, currencySymbol: siteSettings(db).currencySymbol, structured: null, file: null };
    if (mode === 'structured') {
      const snap = latestSnapshot(db);
      if (snap) out.structured = { publishedAt: loc(snap.publishedAt), categories: resolveCategories(snap.categories, req.lang) };
    } else {
      const row = db.prepare(`SELECT m.created_at, f.stored_name, f.mime_type FROM menu_files m JOIN files f ON f.id = m.file_id
        WHERE m.published = 1 LIMIT 1`).get();
      if (row) out.file = publicFileInfo(row, row.created_at);
    }
    res.json(out);
  });
  return r;
}

export function mediaRoute({ db, nowMs, files }) {
  const r = express.Router();
  r.get('/:storedName', (req, res, next) => {
    const name = req.params.storedName;
    if (!STORED_NAME_RE.test(name) || !isPubliclyVisible(db, name, nowMs())) {
      return next(new HttpError(404, 'not_found', 'Не е намерено.'));
    }
    const row = db.prepare('SELECT * FROM files WHERE stored_name = ?').get(name);
    return files.send(res, row, next);
  });
  return r;
}

import express from 'express';
import { getSetting, siteSettings, publicSiteSettings, resolveCategories, pick, pickAny, LANGS, latestSnapshot, publicMenuPages, galleryRows, fileUrlPublic, today, loc } from '../store.js';
import { kindOf, STORED_NAME_RE } from '../files.js';
import { isPubliclyVisible } from '../store.js';
import { HttpError, validationError } from '../http.js';

export function publicApi({ db, nowMs, files }) {
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

  r.get('/gallery', (req, res) => {
    res.json({
      items: galleryRows(db).filter((g) => g.visible).map((g) => ({
        id: g.id, kind: g.kind, mime: g.mime_type, url: fileUrlPublic(g.stored_name), caption: pickAny(req.lang, g.caption_bg, g.caption_en),
      })),
    });
  });

  r.get('/events', (req, res) => {
    const now = nowMs();
    const rows = db.prepare(`SELECT e.*, f.stored_name, fe.stored_name AS stored_name_en FROM events e
      LEFT JOIN files f ON f.id = e.image_file_id LEFT JOIN files fe ON fe.id = e.image_en_file_id
      WHERE e.enabled = 1 AND (e.starts_at IS NULL OR e.starts_at <= ?) AND (e.expires_at IS NULL OR e.expires_at > ?)
      ORDER BY e.event_at IS NULL, e.event_at, e.starts_at IS NULL, e.starts_at, e.id`).all(now, now);
    res.json({
      lang: req.lang,
      events: rows.map((e) => ({
        id: e.id, title: pick(req.lang, e.title, e.title_en), description: pick(req.lang, e.description, e.description_en),
        imageUrl: ((n) => (n ? fileUrlPublic(n) : null))(pickAny(req.lang, e.stored_name, e.stored_name_en)),
        eventAt: loc(e.event_at),
      })),
    });
  });

  r.get('/daily-menu', (req, res) => {
    const t = today(nowMs());
    const d = db.prepare('SELECT * FROM daily_menus WHERE menu_date = ? AND published = 1').get(t);
    // The language is chosen per menu (requested one if it has a first file, else the other), then both of ITS pages are used: no mixing.
    let pages = [];
    if (d) {
      const [first, second] = req.lang === 'en' ? [[d.file_en_id, d.file2_en_id], [d.file_id, d.file2_id]] : [[d.file_id, d.file2_id], [d.file_en_id, d.file2_en_id]];
      pages = (first[0] ? first : second).filter(Boolean);
    }
    const rows = pages.map((fid) => db.prepare('SELECT stored_name, mime_type FROM files WHERE id = ?').get(fid)).filter(Boolean);
    const toFile = (f) => ({ fileUrl: fileUrlPublic(f.stored_name), mimeType: f.mime_type, kind: kindOf(f.mime_type) });
    res.json({
      lang: req.lang,
      today: t,
      menu: rows.length ? { date: d.menu_date, ...toFile(rows[0]), files: rows.map(toFile), updatedAt: loc(d.updated_at) } : null,
    });
  });

  r.get('/menu', (req, res) => {
    const mode = getSetting(db, 'menu_mode') === 'file' ? 'file' : 'structured';
    const out = { lang: req.lang, mode, currencySymbol: siteSettings(db).currencySymbol, structured: null, file: null };
    if (mode === 'structured') {
      const snap = latestSnapshot(db);
      if (snap) out.structured = { publishedAt: loc(snap.publishedAt), categories: resolveCategories(snap.categories, req.lang) };
    } else {
      out.file = publicMenuPages(db, req.lang);
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

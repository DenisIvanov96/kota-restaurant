// Gallery admin API (D-51): up to MAX_GALLERY_ITEMS ordered photos/videos; mirrors the /menu/pages style.
import express from 'express';
import { GALLERY_TYPES, kindOf } from '../../files.js';
import { tx } from '../../db.js';
import { loc, fileUrlAdmin, galleryRows, MAX_GALLERY_ITEMS } from '../../store.js';
import { HttpError, validationError, notFound, parseId, normText, has } from '../../http.js';

const CAPTION_MAX = 300;

export function galleryRoutes({ db, nowMs, files }) {
  const r = express.Router();
  const upload = files.uploadSingle('file');

  const itemObj = (g) => ({
    id: g.id, kind: g.kind, mime: g.mime_type, size: g.size_bytes, fileUrl: fileUrlAdmin(g.stored_name),
    captionBg: g.caption_bg, captionEn: g.caption_en, visible: !!g.visible, position: g.position, createdAt: loc(g.created_at),
  });
  const listObj = () => ({ max: MAX_GALLERY_ITEMS, items: galleryRows(db).map(itemObj) });
  const rowById = (id) => galleryRows(db).find((x) => x.id === id);
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM gallery_items').get().n;
  const full = () => new HttpError(409, 'gallery_full', `Най-много ${MAX_GALLERY_ITEMS} файла в галерията.`);

  /** Caption value: string (trimmed, <= 300) or null/'' -> null. Collects errors into `errors`. */
  const caption = (v, key, errors) => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') { errors[key] = 'Невалидна стойност.'; return null; }
    const t = normText(v);
    if (t.length > CAPTION_MAX) { errors[key] = `Най-много ${CAPTION_MAX} символа.`; return null; }
    return t === '' ? null : t;
  };

  r.get('/', (req, res) => res.json(listObj()));

  r.post('/', upload, async (req, res) => {
    if (!req.uploads.file) throw validationError({ file: 'Изберете файл.' });
    const errors = {};
    const capBg = caption(req.body.captionBg, 'captionBg', errors);
    const capEn = caption(req.body.captionEn, 'captionEn', errors);
    if (Object.keys(errors).length) throw validationError(errors);
    if (count() >= MAX_GALLERY_ITEMS) throw full();
    const id = await files.withUpload(req.uploads.file, GALLERY_TYPES, 'file', (staged) => tx(db, () => {
      if (count() >= MAX_GALLERY_ITEMS) throw full(); // race-safe: the check and the insert share one transaction
      const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM gallery_items').get().p;
      const fid = files.insertRow(staged);
      const now = nowMs();
      return Number(db.prepare(`INSERT INTO gallery_items(file_id, kind, caption_bg, caption_en, visible, position, created_at, updated_at)
        VALUES (?,?,?,?,1,?,?,?)`).run(fid, kindOf(staged.mime), capBg, capEn, pos, now, now).lastInsertRowid);
    }));
    res.status(201).json(itemObj(rowById(id)));
  });

  r.put('/order', (req, res) => {
    const ids = (req.body || {}).ids;
    const cur = galleryRows(db).map((x) => x.id);
    const ok = Array.isArray(ids) && ids.length === cur.length && ids.every((x) => Number.isInteger(x))
      && new Set(ids).size === ids.length && ids.every((x) => cur.includes(x));
    if (!ok) throw validationError({ ids: 'Очаква се пълен списък с идентификаторите на файловете в галерията, без повторения.' });
    tx(db, () => {
      const now = nowMs();
      ids.forEach((id, i) => db.prepare('UPDATE gallery_items SET position = ?, updated_at = ? WHERE id = ?').run(i + 1, now, id));
    });
    res.json(listObj());
  });

  r.patch('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!rowById(id)) throw notFound('Файлът не е намерен.');
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const errors = {};
    const set = {};
    if (has(b, 'captionBg')) set.caption_bg = caption(b.captionBg, 'captionBg', errors);
    if (has(b, 'captionEn')) set.caption_en = caption(b.captionEn, 'captionEn', errors);
    if (has(b, 'visible')) {
      const v = typeof b.visible === 'boolean' ? b.visible : undefined;
      if (v === undefined) errors.visible = 'Стойност true или false.'; else set.visible = v ? 1 : 0;
    }
    if (!Object.keys(set).length && !Object.keys(errors).length) throw validationError({ body: 'Подайте captionBg, captionEn или visible.' });
    if (Object.keys(errors).length) throw validationError(errors);
    const cols = Object.keys(set);
    db.prepare(`UPDATE gallery_items SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...cols.map((c) => set[c]), nowMs(), id);
    res.json(itemObj(rowById(id)));
  });

  r.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const ex = rowById(id);
    if (!ex) throw notFound('Файлът не е намерен.');
    const old = tx(db, () => {
      db.prepare('DELETE FROM gallery_items WHERE id = ?').run(id);
      db.prepare('SELECT id FROM gallery_items ORDER BY position, id').all()
        .forEach((x, i) => db.prepare('UPDATE gallery_items SET position = ? WHERE id = ?').run(i + 1, x.id));
      return files.deleteRow(ex.file_id);
    });
    await files.unlink(old);
    res.status(204).end();
  });

  return r;
}

import express from 'express';
import { DOC_TYPES, kindOf } from '../../files.js';
import { tx } from '../../db.js';
import { purgePastDailyMenus } from '../../cleanup.js';
import { fileUrlAdmin, loc, today } from '../../store.js';
import { isValidDate } from '../../time.js';
import { HttpError, validationError, notFound, parseBool, parseId, has } from '../../http.js';

export function dailyMenuRoutes({ db, nowMs, files }) {
  const r = express.Router();
  const upload = files.uploadFields(['file', 'fileEn']);
  const cleanup = (exceptId) => purgePastDailyMenus({ db, files, nowMs }, exceptId);
  const SELECT = `SELECT d.*, f.stored_name, f.mime_type, f.original_name, f.size_bytes,
      fe.stored_name AS stored_name_en, fe.mime_type AS mime_type_en, fe.original_name AS original_name_en, fe.size_bytes AS size_bytes_en
    FROM daily_menus d LEFT JOIN files f ON f.id = d.file_id LEFT JOIN files fe ON fe.id = d.file_en_id`;
  // fileUrl & co. are null for an English-only menu (no Bulgarian file).
  const toObj = (d) => ({
    id: d.id, date: d.menu_date,
    fileUrl: d.stored_name ? fileUrlAdmin(d.stored_name) : null, mimeType: d.mime_type ?? null, kind: d.mime_type ? kindOf(d.mime_type) : null,
    originalName: d.original_name ?? null, sizeBytes: d.size_bytes ?? null,
    fileEnUrl: d.stored_name_en ? fileUrlAdmin(d.stored_name_en) : null, mimeTypeEn: d.mime_type_en ?? null,
    kindEn: d.mime_type_en ? kindOf(d.mime_type_en) : null, originalNameEn: d.original_name_en ?? null, sizeBytesEn: d.size_bytes_en ?? null,
    published: !!d.published,
    createdAt: loc(d.created_at), updatedAt: loc(d.updated_at),
  });
  const byId = (id) => db.prepare(`${SELECT} WHERE d.id = ?`).get(id);
  const dateTaken = (date, exceptId = 0) => db.prepare('SELECT id FROM daily_menus WHERE menu_date = ? AND id <> ?').get(date, exceptId);
  const conflict = (existingId) => new HttpError(409, 'date_exists', 'За тази дата вече има дневно меню.', { existingId });

  const withUploads = (req, fn) => files.withUpload(req.uploads.file, DOC_TYPES, 'file',
    (sBg) => files.withUpload(req.uploads.fileEn, DOC_TYPES, 'fileEn', (sEn) => fn(sBg, sEn)));

  r.get('/', (req, res) => {
    // today + upcoming only; past dates are deleted automatically (D-45)
    const t = today(nowMs());
    res.json({ today: t, menus: db.prepare(`${SELECT} WHERE d.menu_date >= ? ORDER BY d.menu_date DESC`).all(t).map(toObj) });
  });

  r.post('/', upload, async (req, res) => {
    const b = req.body;
    const fields = {};
    if (!has(b, 'date') || !isValidDate(b.date)) fields.date = 'Невалидна дата (ГГГГ-ММ-ДД).';
    let published = false;
    if (has(b, 'published')) {
      published = parseBool(b.published);
      if (published === undefined) fields.published = 'Стойност true или false.';
    }
    if (!req.uploads.file && !req.uploads.fileEn) fields.file = 'Изберете поне един файл (български или английски).';
    if (Object.keys(fields).length) throw validationError(fields);
    const existing = dateTaken(b.date);
    const replace = parseBool(b.replace) === true;
    if (existing && !replace) throw conflict(existing.id);
    const oldNames = [];
    const id = await withUploads(req, (sBg, sEn) => tx(db, () => {
      const fid = sBg ? files.insertRow(sBg) : null;
      const fidEn = sEn ? files.insertRow(sEn) : null;
      const now = nowMs();
      if (existing) {
        // replace = the date's menu becomes exactly what was submitted; files of the old menu are removed
        const old = db.prepare('SELECT file_id, file_en_id FROM daily_menus WHERE id = ?').get(existing.id);
        db.prepare('UPDATE daily_menus SET file_id = ?, file_en_id = ?, published = ?, updated_at = ? WHERE id = ?').run(fid, fidEn, published ? 1 : 0, now, existing.id);
        for (const o of [old.file_id, old.file_en_id]) if (o) oldNames.push(files.deleteRow(o));
        return existing.id;
      }
      return Number(db.prepare('INSERT INTO daily_menus(menu_date, file_id, file_en_id, published, created_at, updated_at) VALUES (?,?,?,?,?,?)')
        .run(b.date, fid, fidEn, published ? 1 : 0, now, now).lastInsertRowid);
    }));
    for (const n of oldNames) if (n) await files.unlink(n);
    await cleanup(id);
    res.status(existing ? 200 : 201).json(toObj(byId(id)));
  });

  r.put('/:id', upload, async (req, res) => {
    const id = parseId(req.params.id);
    const ex = byId(id);
    if (!ex) throw notFound('Менюто не е намерено.');
    const b = req.body;
    const fields = {};
    let date = ex.menu_date;
    let published = !!ex.published;
    if (has(b, 'date')) { if (!isValidDate(b.date)) fields.date = 'Невалидна дата (ГГГГ-ММ-ДД).'; else date = b.date; }
    if (has(b, 'published')) {
      const p = parseBool(b.published);
      if (p === undefined) fields.published = 'Стойност true или false.'; else published = p;
    }
    const removeFileEn = parseBool(b.removeFileEn) === true;
    if (!fields.date && !req.uploads.file && !(ex.file_id) && !req.uploads.fileEn && removeFileEn) {
      fields.fileEn = 'Менюто трябва да има поне един файл.';
    }
    if (Object.keys(fields).length) throw validationError(fields);
    const taken = dateTaken(date, id);
    if (taken) throw conflict(taken.id);
    const oldNames = [];
    await withUploads(req, (sBg, sEn) => tx(db, () => {
      const fid = sBg ? files.insertRow(sBg) : ex.file_id;
      const fidEn = sEn ? files.insertRow(sEn) : (removeFileEn ? null : ex.file_en_id);
      db.prepare('UPDATE daily_menus SET menu_date = ?, file_id = ?, file_en_id = ?, published = ?, updated_at = ? WHERE id = ?')
        .run(date, fid, fidEn, published ? 1 : 0, nowMs(), id);
      if (ex.file_id && fid !== ex.file_id) oldNames.push(files.deleteRow(ex.file_id));
      if (ex.file_en_id && fidEn !== ex.file_en_id) oldNames.push(files.deleteRow(ex.file_en_id));
    }));
    for (const n of oldNames) if (n) await files.unlink(n);
    if (req.uploads.file || req.uploads.fileEn) await cleanup(id);
    res.json(toObj(byId(id)));
  });

  r.patch('/:id/published', (req, res) => {
    const id = parseId(req.params.id);
    if (!byId(id)) throw notFound('Менюто не е намерено.');
    const p = parseBool(req.body && req.body.published);
    if (p === undefined) throw validationError({ published: 'Стойност true или false.' });
    db.prepare('UPDATE daily_menus SET published = ?, updated_at = ? WHERE id = ?').run(p ? 1 : 0, nowMs(), id);
    res.json(toObj(byId(id)));
  });

  r.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const ex = byId(id);
    if (!ex) throw notFound('Менюто не е намерено.');
    const olds = tx(db, () => {
      db.prepare('DELETE FROM daily_menus WHERE id = ?').run(id);
      return [ex.file_id, ex.file_en_id].filter(Boolean).map((fid) => files.deleteRow(fid));
    });
    for (const n of olds) if (n) await files.unlink(n);
    res.status(204).end();
  });
  return r;
}

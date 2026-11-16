import express from 'express';
import { uploadSingle, DOC_TYPES, MB, kindOf } from '../../files.js';
import { tx } from '../../db.js';
import { fileUrlAdmin, loc, today } from '../../store.js';
import { isValidDate } from '../../time.js';
import { HttpError, validationError, notFound, parseBool, parseId, has } from '../../http.js';

export function dailyMenuRoutes({ db, nowMs, files }) {
  const r = express.Router();
  const upload = uploadSingle('file', 10 * MB);
  const SELECT = `SELECT d.*, f.stored_name, f.mime_type, f.original_name, f.size_bytes
    FROM daily_menus d JOIN files f ON f.id = d.file_id`;
  const toObj = (d) => ({
    id: d.id, date: d.menu_date, fileUrl: fileUrlAdmin(d.stored_name), mimeType: d.mime_type, kind: kindOf(d.mime_type),
    originalName: d.original_name, sizeBytes: d.size_bytes, published: !!d.published,
    createdAt: loc(d.created_at), updatedAt: loc(d.updated_at),
  });
  const byId = (id) => db.prepare(`${SELECT} WHERE d.id = ?`).get(id);
  const dateTaken = (date, exceptId = 0) => db.prepare('SELECT id FROM daily_menus WHERE menu_date = ? AND id <> ?').get(date, exceptId);
  const conflict = (existingId) => new HttpError(409, 'date_exists', 'За тази дата вече има дневно меню.', { existingId });

  r.get('/', (req, res) => {
    res.json({ today: today(nowMs()), menus: db.prepare(`${SELECT} ORDER BY d.menu_date DESC`).all().map(toObj) });
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
    if (!req.file) fields.file = 'Изберете файл.';
    if (Object.keys(fields).length) throw validationError(fields);
    const existing = dateTaken(b.date);
    const replace = parseBool(b.replace) === true;
    if (existing && !replace) throw conflict(existing.id);
    let oldName = null;
    const id = await files.withUpload(req.file, DOC_TYPES, 'file', (staged) => tx(db, () => {
      const fid = files.insertRow(staged);
      const now = nowMs();
      if (existing) {
        const old = db.prepare('SELECT file_id FROM daily_menus WHERE id = ?').get(existing.id);
        db.prepare('UPDATE daily_menus SET file_id = ?, published = ?, updated_at = ? WHERE id = ?').run(fid, published ? 1 : 0, now, existing.id);
        oldName = files.deleteRow(old.file_id);
        return existing.id;
      }
      return Number(db.prepare('INSERT INTO daily_menus(menu_date, file_id, published, created_at, updated_at) VALUES (?,?,?,?,?)')
        .run(b.date, fid, published ? 1 : 0, now, now).lastInsertRowid);
    }));
    if (oldName) await files.unlink(oldName);
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
    if (Object.keys(fields).length) throw validationError(fields);
    const taken = dateTaken(date, id);
    if (taken) throw conflict(taken.id);
    let oldName = null;
    await files.withUpload(req.file, DOC_TYPES, 'file', (staged) => tx(db, () => {
      const fid = staged ? files.insertRow(staged) : ex.file_id;
      db.prepare('UPDATE daily_menus SET menu_date = ?, file_id = ?, published = ?, updated_at = ? WHERE id = ?')
        .run(date, fid, published ? 1 : 0, nowMs(), id);
      if (staged) oldName = files.deleteRow(ex.file_id);
    }));
    if (oldName) await files.unlink(oldName);
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
    const old = tx(db, () => {
      db.prepare('DELETE FROM daily_menus WHERE id = ?').run(id);
      return files.deleteRow(ex.file_id);
    });
    await files.unlink(old);
    res.status(204).end();
  });
  return r;
}

import express from 'express';
import { uploadSingle, IMAGE_TYPES, MB } from '../../files.js';
import { tx } from '../../db.js';
import { eventStatus, fileUrlAdmin, loc } from '../../store.js';
import { sofiaLocalToUtc } from '../../time.js';
import { validationError, notFound, parseBool, parseId, has, normText } from '../../http.js';

export function eventRoutes({ db, nowMs, files }) {
  const r = express.Router();
  const upload = uploadSingle('image', 5 * MB);

  const SELECT = 'SELECT e.*, f.stored_name FROM events e LEFT JOIN files f ON f.id = e.image_file_id';
  const toObj = (e) => ({
    id: e.id, title: e.title, description: e.description,
    imageUrl: e.stored_name ? fileUrlAdmin(e.stored_name) : null,
    eventAt: loc(e.event_at), startsAt: loc(e.starts_at), expiresAt: loc(e.expires_at),
    enabled: !!e.enabled, status: eventStatus(e, nowMs()), createdAt: loc(e.created_at), updatedAt: loc(e.updated_at),
  });
  const get = (id) => db.prepare(`${SELECT} WHERE e.id = ?`).get(id);

  function parse(body, ex) {
    const fields = {};
    const out = {};
    if (has(body, 'title')) {
      const t = typeof body.title === 'string' ? normText(body.title) : '';
      if (t.length < 1 || t.length > 120) fields.title = 'Заглавието е задължително (1–120 символа).'; else out.title = t;
    } else if (ex) out.title = ex.title; else fields.title = 'Заглавието е задължително.';
    if (has(body, 'description')) {
      const d = typeof body.description === 'string' ? normText(body.description) : null;
      if (d === null || d.length > 2000) fields.description = 'Описанието е до 2000 символа.'; else out.description = d;
    } else out.description = ex ? ex.description : '';
    for (const [k, col] of [['eventAt', 'event_at'], ['startsAt', 'starts_at'], ['expiresAt', 'expires_at']]) {
      if (has(body, k)) {
        const v = body[k] === null ? '' : body[k];
        if (typeof v !== 'string') { fields[k] = 'Невалидна дата.'; continue; }
        if (v.trim() === '') { out[col] = null; continue; }
        const ms = sofiaLocalToUtc(v.trim());
        if (ms == null) fields[k] = 'Невалидна дата и час (ГГГГ-ММ-ДДTЧЧ:ММ).'; else out[col] = ms;
      } else out[col] = ex ? ex[col] : null;
    }
    if (has(body, 'enabled')) {
      const b = parseBool(body.enabled);
      if (b === undefined) fields.enabled = 'Стойност true или false.'; else out.enabled = b ? 1 : 0;
    } else out.enabled = ex ? ex.enabled : 0;
    if (out.starts_at != null && out.expires_at != null && out.expires_at <= out.starts_at && !fields.expiresAt) {
      fields.expiresAt = 'Крайната дата трябва да е след началната.';
    }
    if (Object.keys(fields).length) throw validationError(fields);
    return out;
  }

  r.get('/', (req, res) => {
    res.json({ events: db.prepare(`${SELECT} ORDER BY e.created_at DESC, e.id DESC`).all().map(toObj) });
  });

  r.post('/', upload, async (req, res) => {
    const v = parse(req.body);
    const id = await files.withUpload(req.file, IMAGE_TYPES, 'image', (staged) => tx(db, () => {
      const fid = staged ? files.insertRow(staged) : null;
      const now = nowMs();
      return Number(db.prepare(`INSERT INTO events(title, description, image_file_id, event_at, starts_at, expires_at, enabled, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(v.title, v.description, fid, v.event_at, v.starts_at, v.expires_at, v.enabled, now, now).lastInsertRowid);
    }));
    res.status(201).json(toObj(get(id)));
  });

  r.put('/:id', upload, async (req, res) => {
    const id = parseId(req.params.id);
    const ex = get(id);
    if (!ex) throw notFound('Събитието не е намерено.');
    const v = parse(req.body, ex);
    const removeImage = parseBool(req.body.removeImage) === true;
    let oldName = null;
    await files.withUpload(req.file, IMAGE_TYPES, 'image', (staged) => tx(db, () => {
      let imageId = ex.image_file_id;
      if (staged) imageId = files.insertRow(staged); else if (removeImage) imageId = null;
      db.prepare(`UPDATE events SET title=?, description=?, image_file_id=?, event_at=?, starts_at=?, expires_at=?, enabled=?, updated_at=? WHERE id=?`)
        .run(v.title, v.description, imageId, v.event_at, v.starts_at, v.expires_at, v.enabled, nowMs(), id);
      if (ex.image_file_id && imageId !== ex.image_file_id) oldName = files.deleteRow(ex.image_file_id);
    }));
    if (oldName) await files.unlink(oldName);
    res.json(toObj(get(id)));
  });

  r.patch('/:id/enabled', (req, res) => {
    const id = parseId(req.params.id);
    if (!get(id)) throw notFound('Събитието не е намерено.');
    const b = parseBool(req.body && req.body.enabled);
    if (b === undefined) throw validationError({ enabled: 'Стойност true или false.' });
    db.prepare('UPDATE events SET enabled = ?, updated_at = ? WHERE id = ?').run(b ? 1 : 0, nowMs(), id);
    res.json(toObj(get(id)));
  });

  r.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const ex = get(id);
    if (!ex) throw notFound('Събитието не е намерено.');
    const old = tx(db, () => {
      db.prepare('DELETE FROM events WHERE id = ?').run(id);
      return ex.image_file_id ? files.deleteRow(ex.image_file_id) : null;
    });
    if (old) await files.unlink(old);
    res.status(204).end();
  });
  return r;
}

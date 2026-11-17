import express from 'express';
import { uploadFields, IMAGE_TYPES, MB } from '../../files.js';
import { tx } from '../../db.js';
import { eventStatus, fileUrlAdmin, loc } from '../../store.js';
import { sofiaLocalToUtc } from '../../time.js';
import { validationError, notFound, parseBool, parseId, has, normText } from '../../http.js';

export function eventRoutes({ db, nowMs, files }) {
  const r = express.Router();
  const upload = uploadFields(['image', 'imageEn'], 5 * MB);

  const SELECT = `SELECT e.*, f.stored_name, fe.stored_name AS stored_name_en FROM events e
    LEFT JOIN files f ON f.id = e.image_file_id LEFT JOIN files fe ON fe.id = e.image_en_file_id`;
  const toObj = (e) => ({
    id: e.id, title: e.title, titleEn: e.title_en ?? '', description: e.description, descriptionEn: e.description_en ?? '',
    imageUrl: e.stored_name ? fileUrlAdmin(e.stored_name) : null,
    imageEnUrl: e.stored_name_en ? fileUrlAdmin(e.stored_name_en) : null,
    eventAt: loc(e.event_at), startsAt: loc(e.starts_at), expiresAt: loc(e.expires_at),
    enabled: !!e.enabled, status: eventStatus(e, nowMs()), createdAt: loc(e.created_at), updatedAt: loc(e.updated_at),
  });
  const get = (id) => db.prepare(`${SELECT} WHERE e.id = ?`).get(id);

  function parse(body, ex) {
    const fields = {};
    const out = {};
    if (has(body, 'title')) {
      const t = typeof body.title === 'string' ? normText(body.title) : '';
      if (t.length > 120) fields.title = 'Заглавието е до 120 символа.'; else out.title = t;
    } else out.title = ex ? ex.title : '';
    if (has(body, 'description')) {
      const d = typeof body.description === 'string' ? normText(body.description) : null;
      if (d === null || d.length > 2000) fields.description = 'Описанието е до 2000 символа.'; else out.description = d;
    } else out.description = ex ? ex.description : '';
    for (const [k, col, max, msg] of [
      ['titleEn', 'title_en', 120, 'Английското заглавие е до 120 символа.'],
      ['descriptionEn', 'description_en', 2000, 'Английското описание е до 2000 символа.'],
    ]) {
      if (has(body, k)) {
        const v = body[k] === null ? '' : normText(body[k]);
        if (typeof v !== 'string' || v.length > max) fields[k] = msg; else out[col] = v === '' ? null : v;
      } else out[col] = ex ? ex[col] : null;
    }
    // a title is required in at least one language (BG or EN)
    if (!fields.title && !fields.titleEn && !out.title && !out.title_en) {
      fields.title = 'Заглавието е задължително (на български или на английски, до 120 символа).';
    }
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

  // Runs fn(stagedBg|null, stagedEn|null) with both uploads validated/staged; staged files are discarded if fn throws.
  const withUploads = (req, fn) => files.withUpload(req.uploads.image, IMAGE_TYPES, 'image',
    (sBg) => files.withUpload(req.uploads.imageEn, IMAGE_TYPES, 'imageEn', (sEn) => fn(sBg, sEn)));

  r.post('/', upload, async (req, res) => {
    const v = parse(req.body);
    const id = await withUploads(req, (sBg, sEn) => tx(db, () => {
      const fid = sBg ? files.insertRow(sBg) : null;
      const fidEn = sEn ? files.insertRow(sEn) : null;
      const now = nowMs();
      return Number(db.prepare(`INSERT INTO events(title, title_en, description, description_en, image_file_id, image_en_file_id, event_at, starts_at, expires_at, enabled, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.title, v.title_en, v.description, v.description_en, fid, fidEn, v.event_at, v.starts_at, v.expires_at, v.enabled, now, now).lastInsertRowid);
    }));
    res.status(201).json(toObj(get(id)));
  });

  r.put('/:id', upload, async (req, res) => {
    const id = parseId(req.params.id);
    const ex = get(id);
    if (!ex) throw notFound('Събитието не е намерено.');
    const v = parse(req.body, ex);
    const removeImage = parseBool(req.body.removeImage) === true;
    const removeImageEn = parseBool(req.body.removeImageEn) === true;
    const oldNames = [];
    await withUploads(req, (sBg, sEn) => tx(db, () => {
      let imageId = ex.image_file_id;
      let imageEnId = ex.image_en_file_id;
      if (sBg) imageId = files.insertRow(sBg); else if (removeImage) imageId = null;
      if (sEn) imageEnId = files.insertRow(sEn); else if (removeImageEn) imageEnId = null;
      db.prepare(`UPDATE events SET title=?, title_en=?, description=?, description_en=?, image_file_id=?, image_en_file_id=?, event_at=?, starts_at=?, expires_at=?, enabled=?, updated_at=? WHERE id=?`)
        .run(v.title, v.title_en, v.description, v.description_en, imageId, imageEnId, v.event_at, v.starts_at, v.expires_at, v.enabled, nowMs(), id);
      if (ex.image_file_id && imageId !== ex.image_file_id) oldNames.push(files.deleteRow(ex.image_file_id));
      if (ex.image_en_file_id && imageEnId !== ex.image_en_file_id) oldNames.push(files.deleteRow(ex.image_en_file_id));
    }));
    for (const n of oldNames) if (n) await files.unlink(n);
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
    const olds = tx(db, () => {
      db.prepare('DELETE FROM events WHERE id = ?').run(id);
      return [ex.image_file_id, ex.image_en_file_id].filter(Boolean).map((fid) => files.deleteRow(fid));
    });
    for (const n of olds) if (n) await files.unlink(n);
    res.status(204).end();
  });
  return r;
}

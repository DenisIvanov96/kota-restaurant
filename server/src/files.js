import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { HttpError } from './http.js';

export const STORED_NAME_RE = /^[a-f0-9]{32}\.(pdf|jpg|png|webp)$/;
export const MB = 1024 * 1024;

const TYPES = {
  pdf: { mime: 'application/pdf', ext: 'pdf', kind: 'pdf', exts: ['pdf'], mimes: ['application/pdf'] },
  jpg: { mime: 'image/jpeg', ext: 'jpg', kind: 'image', exts: ['jpg', 'jpeg'], mimes: ['image/jpeg', 'image/jpg', 'image/pjpeg'] },
  png: { mime: 'image/png', ext: 'png', kind: 'image', exts: ['png'], mimes: ['image/png'] },
  webp: { mime: 'image/webp', ext: 'webp', kind: 'image', exts: ['webp'], mimes: ['image/webp'] },
};
export const IMAGE_TYPES = ['jpg', 'png', 'webp'];
export const DOC_TYPES = ['pdf', 'jpg', 'png', 'webp'];

/** Detect type from magic bytes. */
export function sniff(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return TYPES.pdf;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return TYPES.jpg;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return TYPES.png;
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return TYPES.webp;
  return null;
}

export function kindOf(mime) { return mime === 'application/pdf' ? 'pdf' : 'image'; }

export function sanitizeName(name) {
  let n = String(name || 'file');
  // multer/busboy decode names as latin1; recover UTF-8 when that is what was sent
  if (/[\u0080-ÿ]/.test(n) && !/[^\u0000-ÿ]/.test(n)) {
    const u = Buffer.from(n, 'latin1').toString('utf8');
    if (!u.includes('�')) n = u;
  }
  n = n.split(/[\\/]/).pop();
  n = n.replace(/[\u0000-\u001f\u007f"<>:*?|]/g, '_').trim();
  if (n.length > 200) {
    const ext = path.extname(n).slice(0, 10);
    n = n.slice(0, 200 - ext.length) + ext;
  }
  return n || 'file';
}

/** Multer middleware factory: memory storage, streaming size limit, one file in `field`. */
export function uploadSingle(field, maxBytes) {
  const m = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 20, fieldSize: 16 * 1024, parts: 30 },
  }).single(field);
  return (req, res, next) => {
    m(req, res, (err) => {
      if (!err) { req.body ||= {}; return next(); }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new HttpError(413, 'file_too_large', `Файлът е твърде голям (макс. ${Math.round(maxBytes / MB)} MB).`));
      }
      if (err instanceof multer.MulterError) {
        return next(new HttpError(400, 'bad_upload', 'Невалидно качване на файл.', { fields: { [field]: 'Невалидно качване на файл.' } }));
      }
      return next(new HttpError(400, 'bad_upload', 'Невалидна multipart заявка.'));
    });
  };
}

export function createFiles({ db, dataDir, nowMs }) {
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const unlink = async (storedName) => {
    if (!STORED_NAME_RE.test(storedName)) return;
    try { await fs.promises.unlink(path.join(uploadsDir, storedName)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  };

  return {
    uploadsDir,
    unlink,

    /** Validate and write an uploaded multer file to disk. Returns staged info; caller must insertRow or discard. */
    async stage(file, allowed, field = 'file') {
      const type = sniff(file.buffer);
      const fail = (msg) => new HttpError(415, 'unsupported_type', msg, { fields: { [field]: msg } });
      if (!type || !allowed.includes(type.ext === 'jpg' ? 'jpg' : type.ext)) {
        throw fail(allowed.includes('pdf') ? 'Позволени са само PDF, JPG, PNG и WebP файлове.' : 'Позволени са само JPG, PNG и WebP изображения.');
      }
      const declaredExt = path.extname(String(file.originalname || '')).slice(1).toLowerCase();
      if (!type.exts.includes(declaredExt)) throw fail('Разширението на файла не съответства на съдържанието му.');
      const declaredMime = String(file.mimetype || '').toLowerCase();
      if (declaredMime && declaredMime !== 'application/octet-stream' && !type.mimes.includes(declaredMime)) {
        throw fail('Типът на файла не съответства на съдържанието му.');
      }
      const storedName = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`;
      await fs.promises.writeFile(path.join(uploadsDir, storedName), file.buffer, { flag: 'wx', mode: 0o640 });
      return { storedName, originalName: sanitizeName(file.originalname), mime: type.mime, size: file.buffer.length };
    },

    /** Insert files row for staged upload; returns file id. */
    insertRow(staged) {
      return Number(db.prepare('INSERT INTO files(stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?)')
        .run(staged.storedName, staged.originalName, staged.mime, staged.size, nowMs()).lastInsertRowid);
    },

    discard: (staged) => unlink(staged.storedName).catch(() => {}),

    /** Delete files row; returns stored_name so caller can unlink after commit. */
    deleteRow(fileId) {
      const r = db.prepare('SELECT stored_name FROM files WHERE id = ?').get(fileId);
      if (!r) return null;
      db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
      return r.stored_name;
    },

    /** Run fn(staged|null) with automatic cleanup of the staged file if fn throws. */
    async withUpload(file, allowed, field, fn) {
      if (!file) return fn(null);
      const staged = await this.stage(file, allowed, field);
      try { return await fn(staged); } catch (e) { await this.discard(staged); throw e; }
    },

    /** Stream a stored file. */
    send(res, row, next) {
      const safe = row.original_name.replace(/[^A-Za-z0-9._ -]/g, '_');
      res.set({
        'Content-Type': row.mime_type,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
        'Content-Disposition': `inline; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
      });
      res.sendFile(row.stored_name, { root: uploadsDir, cacheControl: false, dotfiles: 'deny' }, (err) => {
        if (err && !res.headersSent) next(new HttpError(404, 'not_found', 'Не е намерено.'));
      });
    },
  };
}

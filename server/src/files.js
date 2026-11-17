import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { HttpError } from './http.js';

export const STORED_NAME_RE = /^[a-f0-9]{32}\.(pdf|jpg|png|webp|mp4|mov|webm)$/;
export const MB = 1024 * 1024;

const TYPES = {
  pdf: { mime: 'application/pdf', ext: 'pdf', kind: 'pdf', exts: ['pdf'], mimes: ['application/pdf'] },
  jpg: { mime: 'image/jpeg', ext: 'jpg', kind: 'image', exts: ['jpg', 'jpeg'], mimes: ['image/jpeg', 'image/jpg', 'image/pjpeg'] },
  png: { mime: 'image/png', ext: 'png', kind: 'image', exts: ['png'], mimes: ['image/png'] },
  webp: { mime: 'image/webp', ext: 'webp', kind: 'image', exts: ['webp'], mimes: ['image/webp'] },
  mp4: { mime: 'video/mp4', ext: 'mp4', kind: 'video', exts: ['mp4', 'm4v'], mimes: ['video/mp4', 'video/x-m4v'] },
  mov: { mime: 'video/quicktime', ext: 'mov', kind: 'video', exts: ['mov'], mimes: ['video/quicktime'] },
  webm: { mime: 'video/webm', ext: 'webm', kind: 'video', exts: ['webm'], mimes: ['video/webm'] },
};
export const IMAGE_TYPES = ['jpg', 'png', 'webp'];
export const DOC_TYPES = ['pdf', 'jpg', 'png', 'webp'];
export const GALLERY_TYPES = ['jpg', 'png', 'webp', 'mp4', 'mov', 'webm'];

const MP4_BRAND = /^(iso.|mp4.|avc1|M4V[ HP])$/;
const printable = (b) => b.every((c) => c >= 0x20 && c <= 0x7e);

/**
 * ISO-BMFF `ftyp` box at the start of the file: size (uint32 BE, 16..256, multiple of 4, not larger than the file),
 * 'ftyp', a 4-char major brand and 4-char compatible brands (all printable ASCII). Returns the major brand or null.
 */
function ftypBrand(buf, fileSize) {
  if (buf.length < 16 || buf.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
  const size = buf.readUInt32BE(0);
  if (size < 16 || size > 256 || size % 4 !== 0 || (fileSize != null && size > fileSize)) return null;
  // major brand (8..12) and compatible brands (16..size) are 4-char ASCII codes; 12..16 is the binary minor version
  if (!printable([...buf.subarray(8, 12), ...buf.subarray(16, Math.min(size, buf.length))])) return null;
  return buf.subarray(8, 12).toString('latin1');
}

/** WebM = EBML magic + DocType "webm" in the EBML header (Matroska .mkv shares the magic and is rejected). */
function isWebm(buf) {
  return buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3
    && buf.subarray(0, 64).includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]));
}

/** Detect type from magic bytes. */
export function sniff(buf, fileSize) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return TYPES.pdf;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return TYPES.jpg;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return TYPES.png;
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return TYPES.webp;
  const brand = ftypBrand(buf, fileSize);
  if (brand === 'qt  ') return TYPES.mov;
  if (brand !== null && MP4_BRAND.test(brand)) return TYPES.mp4;
  if (isWebm(buf)) return TYPES.webm;
  return null;
}

export function kindOf(mime) {
  if (mime === 'application/pdf') return 'pdf';
  return String(mime).startsWith('video/') ? 'video' : 'image';
}

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

export const MAX_UPLOAD_BYTES = 50 * MB;
const HEAD_BYTES = 64;

/** Reads the first bytes of a file (for magic-byte sniffing) without loading it into memory. */
async function readHead(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally { await fh.close(); }
}

const rmQuiet = (p) => fs.promises.unlink(p).catch(() => {});

/**
 * Multer middleware factory (disk temp storage in `tmpDir`, streaming size limit of MAX_UPLOAD_BYTES per file).
 * Result in req.uploads = { field: multerFile } (file.path is a temp file; stage() moves it into uploads/).
 * Every temp file is deleted when the response closes (success, error or client abort), whatever the handler did;
 * multer itself removes partial files on errors/aborts, and createFiles() sweeps leftovers on start.
 */
function makeUploader(tmpDir, fieldNames, maxBytes = MAX_UPLOAD_BYTES) {
  const m = multer({
    storage: multer.diskStorage({
      destination: tmpDir,
      filename: (req, file, cb) => cb(null, `up-${crypto.randomBytes(16).toString('hex')}.tmp`),
    }),
    limits: { fileSize: maxBytes, files: fieldNames.length, fields: 20, fieldSize: 16 * 1024, parts: 30 },
  }).fields(fieldNames.map((name) => ({ name, maxCount: 1 })));
  const tooBig = (field) => new HttpError(413, 'file_too_large', `Файлът е твърде голям (макс. ${Math.round(maxBytes / MB)} MB).`,
    field ? { fields: { [field]: 'Файлът е твърде голям.' } } : {});
  return (req, res, next) => {
    const sweep = () => {
      for (const arr of Object.values(req.files || {})) for (const f of arr || []) if (f.path) rmQuiet(f.path);
    };
    res.once('close', sweep);
    m(req, res, (err) => {
      if (!err) {
        req.body ||= {};
        req.uploads = {};
        for (const [k, arr] of Object.entries(req.files || {})) if (arr && arr[0]) req.uploads[k] = arr[0];
        return next();
      }
      if (err.code === 'LIMIT_FILE_SIZE') return next(tooBig(err.field));
      if (err instanceof multer.MulterError) {
        const f = err.field || fieldNames[0];
        return next(new HttpError(400, 'bad_upload', 'Невалидно качване на файл.', { fields: { [f]: 'Невалидно качване на файл.' } }));
      }
      return next(new HttpError(400, 'bad_upload', 'Невалидна multipart заявка.'));
    });
  };
}

export function createFiles({ db, dataDir, nowMs }) {
  const uploadsDir = path.join(dataDir, 'uploads');
  const tmpDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  // Nothing is in flight while the server starts: every temp file left in tmp/ is a leftover of a crash.
  for (const f of fs.readdirSync(tmpDir)) fs.rmSync(path.join(tmpDir, f), { recursive: true, force: true });

  const unlink = async (storedName) => {
    if (!STORED_NAME_RE.test(storedName)) return;
    try { await fs.promises.unlink(path.join(uploadsDir, storedName)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  };

  return {
    uploadsDir,
    tmpDir,
    unlink,
    /** Multer middleware for the named single-file fields (50 MB each); sets req.uploads. */
    uploadFields: (fieldNames) => makeUploader(tmpDir, fieldNames),
    uploadSingle: (field) => makeUploader(tmpDir, [field]),

    /** Validate (magic bytes from the file head) and move an uploaded temp file into uploads/. Returns staged info; caller must insertRow or discard. */
    async stage(file, allowed, field = 'file') {
      const type = sniff(await readHead(file.path), file.size);
      const fail = (msg) => new HttpError(415, 'unsupported_type', msg, { fields: { [field]: msg } });
      if (!type || !allowed.includes(type.ext === 'jpg' ? 'jpg' : type.ext)) {
        throw fail(allowed.includes('mp4') ? 'Позволени са само JPG, PNG, WebP снимки и MP4, MOV, WebM видео.'
          : allowed.includes('pdf') ? 'Позволени са само PDF, JPG, PNG и WebP файлове.' : 'Позволени са само JPG, PNG и WebP изображения.');
      }
      const declaredExt = path.extname(String(file.originalname || '')).slice(1).toLowerCase();
      if (!type.exts.includes(declaredExt)) throw fail('Разширението на файла не съответства на съдържанието му.');
      const declaredMime = String(file.mimetype || '').toLowerCase();
      if (declaredMime && declaredMime !== 'application/octet-stream' && !type.mimes.includes(declaredMime)) {
        throw fail('Типът на файла не съответства на съдържанието му.');
      }
      const storedName = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`;
      const dest = path.join(uploadsDir, storedName);
      try {
        await fs.promises.rename(file.path, dest);
      } catch (e) {
        if (e.code !== 'EXDEV') throw e;
        await fs.promises.copyFile(file.path, dest, fs.constants.COPYFILE_EXCL);
        await rmQuiet(file.path);
      }
      try { await fs.promises.chmod(dest, 0o640); } catch { /* best effort */ }
      return { storedName, originalName: sanitizeName(file.originalname), mime: type.mime, size: file.size };
    },

    /** Insert files row for staged upload; returns file id. */
    insertRow(staged) {
      return Number(db.prepare('INSERT INTO files(stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?)')
        .run(staged.storedName, staged.originalName, staged.mime, staged.size, nowMs()).lastInsertRowid);
    },

    /** Startup sweep: delete `files` rows (and their disk files) that no event, daily menu or menu page references. */
    async sweepOrphans() {
      const rows = db.prepare(`SELECT id, stored_name FROM files WHERE id NOT IN (
        SELECT image_file_id FROM events WHERE image_file_id IS NOT NULL
        UNION SELECT image_en_file_id FROM events WHERE image_en_file_id IS NOT NULL
        UNION SELECT file_id FROM daily_menus WHERE file_id IS NOT NULL
        UNION SELECT file_en_id FROM daily_menus WHERE file_en_id IS NOT NULL
        UNION SELECT file_id FROM menu_files
        UNION SELECT file_id FROM gallery_items)`).all();
      for (const r of rows) {
        db.prepare('DELETE FROM files WHERE id = ?').run(r.id);
        await unlink(r.stored_name).catch(() => {});
      }
      return rows.length;
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
        if (!err || res.headersSent) return;
        if (err.status === 416) { // unsatisfiable Range: say so (with Content-Range: bytes */size) instead of pretending the file is missing
          res.status(416).set(err.headers || {}).json({ error: 'range_not_satisfiable', message: 'Невалиден диапазон.' });
          return;
        }
        next(new HttpError(404, 'not_found', 'Не е намерено.'));
      });
    },
  };
}

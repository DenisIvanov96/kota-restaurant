export class HttpError extends Error {
  constructor(status, error, message, extra = {}) {
    super(message);
    this.status = status;
    this.error = error;
    this.extra = extra;
  }
}

export const validationError = (fields, message = 'Невалидни данни.') =>
  new HttpError(400, 'validation', message, { fields });

export const notFound = (message = 'Не е намерено.') => new HttpError(404, 'not_found', message);

export function parseBool(v) {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return undefined;
}

export function parseId(v) {
  if (!/^\d{1,12}$/.test(String(v))) throw notFound();
  const n = Number(v);
  if (n < 1) throw notFound();
  return n;
}

// Browsers send newlines in multipart as CRLF; normalise to LF before trim/length checks/storage.
export const normText = (s) => (typeof s === 'string' ? s.replace(/\r\n?/g, '\n').trim() : s);

export const has = (body, k) => body != null && Object.hasOwn(body, k) && body[k] !== undefined;

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.error, message: err.message, ...err.extra });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'Невалиден JSON.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'too_large', message: 'Заявката е твърде голяма.' });
  }
  console.error('Unhandled error:', err && err.name, err && err.message);
  return res.status(500).json({ error: 'server_error', message: 'Вътрешна грешка на сървъра.' });
}

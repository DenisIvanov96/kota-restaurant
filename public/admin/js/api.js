// API client. Every non-GET request carries X-Requested-With. 401 -> session-expired hook.

export class ApiError extends Error {
  constructor(status, data) {
    super((data && data.message) || 'Грешка');
    this.status = status;
    this.code = (data && data.error) || 'error';
    this.fields = (data && data.fields) || null;
    this.data = data || {};
  }
}

let unauthorizedHandler = () => {};
export const onUnauthorized = (fn) => { unauthorizedHandler = fn; };

const networkError = () => new ApiError(0, { error: 'network', message: 'Няма връзка със сървъра. Опитайте отново.' });

function failure(status, data, opts) {
  const err = new ApiError(status, data);
  if (status === 401 && !opts.noSession) unauthorizedHandler(err);
  return err;
}

export async function api(method, path, opts = {}) {
  const init = { method, headers: {}, credentials: 'same-origin', signal: opts.signal };
  if (method !== 'GET') init.headers['X-Requested-With'] = 'kota-admin';
  if (opts.json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.json);
  } else if (opts.form) {
    init.body = opts.form; // never set Content-Type for FormData
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw networkError();
  }
  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { data = null; }
  }
  if (!res.ok) throw failure(res.status, data, opts);
  return data;
}

export const get = (p, o) => api('GET', p, o);
export const post = (p, json, o) => api('POST', p, { ...o, json });
export const put = (p, json, o) => api('PUT', p, { ...o, json });
export const patch = (p, json, o) => api('PATCH', p, { ...o, json });
export const del = (p, o) => api('DELETE', p, o);

/**
 * Multipart upload with real progress via XMLHttpRequest.
 * Returns { promise, abort }. Rejects with ApiError (code 'aborted' when cancelled).
 */
export function upload(method, path, formData, { onProgress, onSent } = {}) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open(method, path);
    xhr.setRequestHeader('X-Requested-With', 'kota-admin');
    xhr.responseType = 'text';
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.upload.addEventListener('load', () => { if (onSent) onSent(); });
    xhr.addEventListener('load', () => {
      let data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(failure(xhr.status, data, {}));
    });
    xhr.addEventListener('error', () => reject(networkError()));
    xhr.addEventListener('abort', () => reject(new ApiError(0, { error: 'aborted', message: 'Качването е отказано.' })));
    xhr.send(formData);
  });
  return { promise, abort: () => xhr.abort() };
}

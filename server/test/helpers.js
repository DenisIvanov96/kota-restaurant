import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';

export const PASSWORD = 'correct horse battery';
export const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF\n')]);
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
export const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
export const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([60, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(64, 3)]);

export async function startApp({ iso = '2026-06-15T10:00:00Z', dataDir, trustProxy = false } = {}) {
  dataDir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'kota-test-'));
  const clock = { t: Date.parse(iso) };
  const app = createApp({ dataDir, now: () => clock.t, trustProxy });
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = {
    app, server, base, clock, dataDir, db: app.locals.db,
    uploads: () => fs.readdirSync(path.join(dataDir, 'uploads')),
    async addAdmin(username = 'boss', password = PASSWORD) {
      const now = Date.now();
      ctx.db.prepare('INSERT INTO admins(username, password_hash, created_at, updated_at) VALUES (?,?,?,?)')
        .run(username, await hashPassword(password), now, now);
    },
    async close(removeData = true) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      app.closeDb();
      if (removeData) fs.rmSync(dataDir, { recursive: true, force: true });
    },
    client: () => makeClient(base),
  };
  return ctx;
}

export function makeClient(base) {
  const c = {
    cookie: '',
    async req(method, url, { json, form, headers = {}, csrf = true, raw } = {}) {
      const h = { ...headers };
      if (csrf && url.startsWith('/api/admin') && method !== 'GET') h['X-Requested-With'] = 'kota-admin';
      if (c.cookie) h.Cookie = c.cookie;
      let body;
      if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
      if (form) body = form;
      if (raw !== undefined) body = raw;
      const res = await fetch(base + url, { method, headers: h, body, redirect: 'manual' });
      const sc = res.headers.get('set-cookie');
      if (sc) c.cookie = sc.startsWith('kota_session=;') ? '' : sc.split(';')[0];
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, headers: res.headers, data, text, setCookie: sc };
    },
    get: (u, o) => c.req('GET', u, o),
    post: (u, json, o = {}) => c.req('POST', u, { json, ...o }),
    put: (u, json, o = {}) => c.req('PUT', u, { json, ...o }),
    patch: (u, json, o = {}) => c.req('PATCH', u, { json, ...o }),
    del: (u, o) => c.req('DELETE', u, o),
    async login(username = 'boss', password = PASSWORD, totp) {
      return c.post('/api/admin/login', { username, password, ...(totp ? { totp } : {}) });
    },
  };
  return c;
}

export function formData(fields = {}, file) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.append(k, String(v));
  if (file) f.append(file.field, new Blob([file.buf], { type: file.type }), file.name);
  return f;
}

export async function loggedIn(opts) {
  const ctx = await startApp(opts);
  await ctx.addAdmin();
  const api = ctx.client();
  const r = await api.login();
  if (r.status !== 200) throw new Error('login failed in helper: ' + r.status);
  return { ...ctx, api };
}

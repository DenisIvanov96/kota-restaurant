// QA harness: spawns a REAL server process (never imports server code) and provides an HTTP client + fixtures.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PASSWORD = 'qa-test-password-123';
export const SCRATCH = process.env.QA_SCRATCH || path.join(os.tmpdir(), 'kota-qa');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function tmpDir(name) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  return fs.mkdtempSync(path.join(SCRATCH, `${name}-`));
}

export function createAdmin(dataDir, username = 'owner', password = PASSWORD) {
  execFileSync('node', ['--disable-warning=ExperimentalWarning', 'server/scripts/create-admin.js', '--username', username],
    { cwd: ROOT, env: { ...process.env, ADMIN_PASSWORD: password, DATA_DIR: dataDir }, stdio: 'pipe' });
}

/** Start the server as a child process. env may contain KOTA_NOW, NODE_ENV, HOST, TRUST_PROXY ... */
export async function startServer({ port, dataDir, now, env = {}, inheritHost = false }) {
  const e = { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...env };
  delete e.KOTA_NOW; delete e.NODE_ENV; delete e.HOST; delete e.COOKIE_SECURE;
  if (env.NODE_ENV) e.NODE_ENV = env.NODE_ENV;
  if (now) e.KOTA_NOW = now;
  if (env.HOST) e.HOST = env.HOST;
  if (env.COOKIE_SECURE) e.COOKIE_SECURE = env.COOKIE_SECURE;
  const child = spawn('node', ['--disable-warning=ExperimentalWarning', 'server/src/server.js'], { cwd: ROOT, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${log}`);
    try { const r = await fetch(`${url}/api/public/site`); if (r.ok) break; } catch { /* not yet */ }
    await sleep(100);
  }
  return {
    url, pid: child.pid, child, log: () => log,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM'); // only the PID we spawned
      await new Promise((r) => { child.once('exit', r); setTimeout(() => { child.kill('SIGKILL'); r(); }, 6000); });
    },
  };
}

/** HTTP client with a cookie jar. */
export class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.lastSetCookie = null; }
  async req(method, p, { json, form, headers = {}, csrf = true, cookie, origin, raw } = {}) {
    const h = { ...headers };
    const c = cookie !== undefined ? cookie : this.cookie;
    if (c) h.cookie = c;
    if (csrf && method !== 'GET' && method !== 'HEAD') h['x-requested-with'] = 'kota-admin';
    if (origin) h.origin = origin;
    let body;
    if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
    else if (form) body = form;
    else if (raw !== undefined) body = raw;
    const res = await fetch(this.base + p, { method, headers: h, body, redirect: 'manual' });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) {
      this.lastSetCookie = sc;
      const m = /^kota_session=([^;]*)/.exec(sc[0]);
      if (m) this.cookie = m[1] ? `kota_session=${m[1]}` : '';
    }
    const buf = Buffer.from(await res.arrayBuffer());
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json') && buf.length) { try { data = JSON.parse(buf.toString('utf8')); } catch { /* */ } }
    return { status: res.status, headers: res.headers, data, buf, text: () => buf.toString('utf8') };
  }
  get(p, o) { return this.req('GET', p, o); }
  post(p, o) { return this.req('POST', p, o); }
  put(p, o) { return this.req('PUT', p, o); }
  patch(p, o) { return this.req('PATCH', p, o); }
  del(p, o) { return this.req('DELETE', p, o); }
  async login(username = 'owner', password = PASSWORD) {
    const r = await this.post('/api/admin/login', { json: { username, password } });
    if (r.status !== 200) throw new Error(`login failed ${r.status} ${r.text()}`);
    return r;
  }
}

export function form(fields = {}, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, String(v));
  if (file) fd.append(file.field, new Blob([file.buf], { type: file.type ?? '' }), file.name);
  return fd;
}

// ---------- fixtures (real, decodable files) ----------
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Solid colour PNG w x h. */
export function makePng(w = 40, h = 30, [r, g, b] = [200, 40, 40]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
export const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
export const sofiaOffsetNote = 'Server time zone is Europe/Sofia; KOTA_NOW is an ISO instant (UTC).';

// ---------- tiny test reporter for non-node:test scripts ----------
export function reporter(name) {
  const results = [];
  return {
    results,
    pass(id, evidence = '') { results.push({ id, status: 'PASS', evidence }); console.log(`PASS  ${id}${evidence ? '  -- ' + evidence : ''}`); },
    fail(id, evidence = '') { results.push({ id, status: 'FAIL', evidence }); console.log(`FAIL  ${id}  -- ${evidence}`); process.exitCode = 1; },
    check(id, cond, evidence = '') { cond ? this.pass(id, evidence) : this.fail(id, evidence); },
    summary() {
      const p = results.filter((r) => r.status === 'PASS').length;
      console.log(`\n[${name}] ${p}/${results.length} passed`);
    },
  };
}

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MIN_PASSWORD = 12;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 3600 * 1000;
export const SESSION_IDLE_MS = 12 * 3600 * 1000;
export const COOKIE_NAME = 'kota_session';
const WINDOW_MS = 15 * 60 * 1000;

// ---------- passwords ----------
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(key, expected);
}

let dummyHash;
/** Used for unknown usernames so response time does not reveal whether the account exists. */
export async function verifyDummy(password) {
  dummyHash ||= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}

// ---------- sessions ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db, adminId, now) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash, admin_id, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?)')
    .run(sha256(token), adminId, now, now, now + SESSION_ABSOLUTE_MS);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?').run(now, now - SESSION_IDLE_MS);
  return token;
}

export function lookupSession(db, token, now) {
  if (!token) return null;
  const row = db.prepare(`SELECT s.id AS session_id, s.last_seen_at, s.expires_at, a.id AS admin_id,
      a.username, a.totp_secret FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?`)
    .get(sha256(token));
  if (!row) return null;
  if (row.expires_at <= now || row.last_seen_at <= now - SESSION_IDLE_MS) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, row.session_id);
  return { sessionId: row.session_id, adminId: row.admin_id, username: row.username, totpEnabled: !!row.totp_secret };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function sessionCookie(token, secure) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_ABSOLUTE_MS / 1000}${secure ? '; Secure' : ''}`;
}
export function clearCookie(secure) {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

// ---------- middleware ----------
export function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'kota-admin') {
    return next(new HttpError(403, 'csrf', 'Заявката е отхвърлена (CSRF).'));
  }
  const origin = req.get('origin');
  if (origin !== undefined) {
    let ok = false;
    try { ok = new URL(origin).host === req.get('host'); } catch { ok = false; }
    if (!ok) return next(new HttpError(403, 'csrf', 'Заявката е отхвърлена (CSRF).'));
  }
  return next();
}

export function requireAuth({ db, nowMs }) {
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const s = lookupSession(db, token, nowMs());
    if (!s) return next(new HttpError(401, 'unauthorized', 'Необходим е вход.'));
    req.admin = s;
    return next();
  };
}

// ---------- login rate limiting (in memory, per process) ----------
export function createLimiter(nowMs) {
  const hits = new Map(); // key -> array of failure timestamps
  const prune = (key) => {
    const cutoff = nowMs() - WINDOW_MS;
    const arr = (hits.get(key) || []).filter((t) => t > cutoff);
    if (arr.length) hits.set(key, arr); else hits.delete(key);
    return arr;
  };
  return {
    /** returns retry-after seconds if blocked, else 0 */
    blocked(ip, username) {
      let wait = 0;
      for (const [key, max] of [[`ip:${ip}`, 5], [`user:${username}`, 10]]) {
        const arr = prune(key);
        if (arr.length >= max) {
          wait = Math.max(wait, Math.ceil((arr[0] + WINDOW_MS - nowMs()) / 1000));
        }
      }
      return wait;
    },
    fail(ip, username) {
      for (const key of [`ip:${ip}`, `user:${username}`]) {
        const arr = prune(key); arr.push(nowMs()); hits.set(key, arr);
      }
      if (hits.size > 10000) for (const k of hits.keys()) prune(k);
    },
    success(username) { hits.delete(`user:${username}`); },
  };
}

// ---------- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function generateTotpSecret() { return base32Encode(crypto.randomBytes(20)); }

export function totpCode(secretB32, timeMs) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30000)));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}

export function verifyTotp(secretB32, code, timeMs) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return false;
  const given = Buffer.from(code.trim());
  let ok = false;
  for (const step of [-1, 0, 1]) {
    const exp = Buffer.from(totpCode(secretB32, timeMs + step * 30000));
    if (crypto.timingSafeEqual(given, exp)) ok = true;
  }
  return ok;
}

export function otpauthUrl(secret, username) {
  return `otpauth://totp/Kota1:${encodeURIComponent(username)}?secret=${secret}&issuer=Kota1&algorithm=SHA1&digits=6&period=30`;
}

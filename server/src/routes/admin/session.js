import express from 'express';
import {
  hashPassword, verifyPassword, verifyDummy, createSession, sessionCookie, clearCookie, parseCookies, COOKIE_NAME,
  MIN_PASSWORD, generateTotpSecret, otpauthUrl, verifyTotp,
} from '../../auth.js';
import { HttpError, validationError } from '../../http.js';

const isStr = (v) => typeof v === 'string';

/** Routes that do not need a session (login). */
export function loginRoute({ db, nowMs, limiter, config }) {
  const r = express.Router();
  r.post('/login', async (req, res) => {
    const { username, password, totp } = req.body || {};
    if (!isStr(username) || !isStr(password) || !username || !password || username.length > 100 || password.length > 1000) {
      throw validationError({ username: 'Въведете потребителско име.', password: 'Въведете парола.' });
    }
    const key = username.trim().toLowerCase();
    const wait = limiter.blocked(req.ip, key);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      throw new HttpError(429, 'rate_limited', 'Твърде много неуспешни опити. Опитайте по-късно.', { retryAfter: wait });
    }
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username.trim());
    let ok = false;
    if (admin) ok = await verifyPassword(password, admin.password_hash); else await verifyDummy(password);
    if (!ok) {
      limiter.fail(req.ip, key);
      throw new HttpError(401, 'invalid_credentials', 'Грешно потребителско име или парола.');
    }
    if (admin.totp_secret) {
      if (totp === undefined || totp === null || totp === '') {
        throw new HttpError(401, 'totp_required', 'Въведете код от приложението за удостоверяване.');
      }
      if (!verifyTotp(admin.totp_secret, String(totp), nowMs())) {
        limiter.fail(req.ip, key);
        throw new HttpError(401, 'invalid_credentials', 'Грешен код за удостоверяване.');
      }
    }
    limiter.success(key);
    const token = createSession(db, admin.id, nowMs());
    res.set('Set-Cookie', sessionCookie(token, config.cookieSecure));
    res.json({ admin: { username: admin.username, totpEnabled: !!admin.totp_secret } });
  });
  return r;
}

export function sessionRoutes({ db, nowMs, config }) {
  const r = express.Router();

  r.post('/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.admin.sessionId);
    res.set('Set-Cookie', clearCookie(config.cookieSecure));
    res.status(204).end();
  });

  r.get('/me', (req, res) => res.json({ admin: { username: req.admin.username, totpEnabled: req.admin.totpEnabled } }));

  r.post('/password', async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!isStr(currentPassword) || !currentPassword) throw validationError({ currentPassword: 'Въведете текущата парола.' });
    if (!isStr(newPassword) || newPassword.length < MIN_PASSWORD || newPassword.length > 1000) {
      throw validationError({ newPassword: `Паролата трябва да е поне ${MIN_PASSWORD} символа.` });
    }
    const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.adminId);
    if (!(await verifyPassword(currentPassword, admin.password_hash))) {
      throw validationError({ currentPassword: 'Текущата парола е грешна.' });
    }
    const hash = await hashPassword(newPassword);
    db.prepare('UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, nowMs(), admin.id);
    db.prepare('DELETE FROM sessions WHERE admin_id = ? AND id <> ?').run(admin.id, req.admin.sessionId);
    res.status(204).end();
  });

  r.post('/totp/setup', (req, res) => {
    if (req.admin.totpEnabled) throw new HttpError(409, 'totp_already_enabled', 'Двуфакторното удостоверяване вече е включено.');
    const secret = generateTotpSecret();
    db.prepare('UPDATE admins SET totp_pending_secret = ?, updated_at = ? WHERE id = ?').run(secret, nowMs(), req.admin.adminId);
    res.json({ secret, otpauthUrl: otpauthUrl(secret, req.admin.username) });
  });

  r.post('/totp/enable', (req, res) => {
    const { code } = req.body || {};
    const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.adminId);
    if (!admin.totp_pending_secret) throw new HttpError(409, 'totp_not_pending', 'Първо стартирайте настройката.');
    if (!verifyTotp(admin.totp_pending_secret, code, nowMs())) throw validationError({ code: 'Грешен код.' });
    db.prepare('UPDATE admins SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, updated_at = ? WHERE id = ?')
      .run(nowMs(), admin.id);
    res.status(204).end();
  });

  r.post('/totp/disable', async (req, res) => {
    const { password, code } = req.body || {};
    const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.adminId);
    if (!admin.totp_secret) throw new HttpError(409, 'totp_not_enabled', 'Двуфакторното удостоверяване не е включено.');
    if (!isStr(password) || !(await verifyPassword(password, admin.password_hash))) throw validationError({ password: 'Грешна парола.' });
    if (!verifyTotp(admin.totp_secret, code, nowMs())) throw validationError({ code: 'Грешен код.' });
    db.prepare('UPDATE admins SET totp_secret = NULL, totp_pending_secret = NULL, updated_at = ? WHERE id = ?').run(nowMs(), admin.id);
    res.status(204).end();
  });
  return r;
}

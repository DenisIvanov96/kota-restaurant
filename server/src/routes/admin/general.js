import express from 'express';
import { getSetting, setSetting, siteSettings, eventStatus, today, latestSnapshot, hasUnpublishedChanges, loc, pagesFlag, LANGS } from '../../store.js';
import { addDays } from '../../time.js';
import { HttpError, validationError, has, normText } from '../../http.js';
import { STORED_NAME_RE } from '../../files.js';

/** Empty, or an https URL on instagram.com / www.instagram.com (no credentials, no port, no whitespace). */
export function isInstagramUrl(v) {
  if (v === '') return true;
  if (v.length > 200 || !/^https:\/\/[^\s\\]+$/i.test(v)) return false;
  let u;
  try { u = new URL(v); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && !u.port
    && (u.hostname === 'instagram.com' || u.hostname === 'www.instagram.com');
}

/** Empty, or a plain address: one @, no spaces/control chars/markup, a dot in the domain (<= 254 chars). */
const EMAIL_LOCAL = /^[\p{L}\p{N}!#$%&*+/=?^_{|}~-]+(\.[\p{L}\p{N}!#$%&*+/=?^_{|}~-]+)*$/u;
const EMAIL_DOMAIN = /^[\p{L}\p{N}]([\p{L}\p{N}-]*[\p{L}\p{N}])?(\.[\p{L}\p{N}]([\p{L}\p{N}-]*[\p{L}\p{N}])?)+$/u;
export function isEmail(v) {
  if (v === '') return true;
  if (v.length > 254) return false;
  const parts = v.split('@');
  return parts.length === 2 && EMAIL_LOCAL.test(parts[0]) && EMAIL_DOMAIN.test(parts[1]);
}

export function generalRoutes({ db, nowMs, files }) {
  const r = express.Router();

  r.get('/dashboard', (req, res) => {
    const now = nowMs();
    const t = today(now);
    const counts = { active: 0, scheduled: 0, disabled: 0, expired: 0, activeTitles: [] };
    for (const e of db.prepare('SELECT * FROM events ORDER BY event_at IS NULL, event_at, id').all()) {
      const s = eventStatus(e, now);
      counts[s]++;
      if (s === 'active') counts.activeTitles.push(e.title || e.title_en);
    }
    const dm = (d) => {
      const row = db.prepare('SELECT id, published FROM daily_menus WHERE menu_date = ?').get(d);
      return row ? { id: row.id, published: !!row.published } : null;
    }; 
    const pages = Object.fromEntries(LANGS.map((l) => [l, {
      published: pagesFlag(db, l), count: db.prepare('SELECT COUNT(*) AS n FROM menu_files WHERE lang = ?').get(l).n,
    }]));
    const snap = latestSnapshot(db);
    const gal = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(visible), 0) AS visible FROM gallery_items').get();
    res.json({
      today: t,
      now: loc(now),
      events: counts,
      dailyMenu: { today: dm(t), tomorrow: dm(addDays(t, 1)) },
      menu: {
        mode: getSetting(db, 'menu_mode'),
        structuredPublishedAt: snap ? loc(snap.publishedAt) : null,
        hasUnpublishedChanges: hasUnpublishedChanges(db),
        pages,
      },
      gallery: { count: gal.count, visible: gal.visible },
    });
  });

  r.get('/settings', (req, res) => res.json(siteSettings(db)));

  r.put('/settings', (req, res) => {
    const b = req.body || {};
    const cur = siteSettings(db);
    const spec = {
      reservationPhone: { max: 30, re: /^[+0-9 ()-]*$/, msg: 'Само цифри и + ( ) - интервал, до 30 символа.' },
      contactEmail: { max: 254, nullable: true, check: isEmail, msg: 'Въведете валиден имейл адрес (напр. име@домейн.bg, до 254 символа) или оставете празно.' },
      address: { max: 200 },
      openingHours: { max: 500 },
      addressEn: { max: 200 },
      openingHoursEn: { max: 500 },
      currencySymbol: { max: 5 },
      aboutBg: { max: 2000, nullable: true },
      aboutEn: { max: 2000, nullable: true },
      instagramUrl: { max: 200, check: isInstagramUrl, msg: 'Въведете валиден https адрес от instagram.com (до 200 символа) или оставете празно.' },
    };
    const next = { ...cur };
    const fields = {};
    for (const [k, s] of Object.entries(spec)) {
      if (!has(b, k)) continue;
      if (s.nullable && b[k] === null) { next[k] = null; continue; }
      if (typeof b[k] !== 'string') { fields[k] = 'Невалидна стойност.'; continue; }
      const v = normText(b[k]);
      if (v.length > s.max) fields[k] = `Най-много ${s.max} символа.`;
      else if (s.re && !s.re.test(v)) fields[k] = s.msg;
      else if (s.check && !s.check(v)) fields[k] = s.msg;
      else if (k === 'currencySymbol' && v === '') fields[k] = 'Въведете символ.';
      else next[k] = s.nullable && v === '' ? null : v;
    }
    if (Object.keys(fields).length) throw validationError(fields);
    setSetting(db, 'reservation_phone', next.reservationPhone);
    setSetting(db, 'contact_email', next.contactEmail ?? '');
    setSetting(db, 'address', next.address);
    setSetting(db, 'opening_hours', next.openingHours);
    setSetting(db, 'address_en', next.addressEn);
    setSetting(db, 'opening_hours_en', next.openingHoursEn);
    setSetting(db, 'currency_symbol', next.currencySymbol);
    setSetting(db, 'instagram_url', next.instagramUrl);
    setSetting(db, 'about_bg', next.aboutBg ?? '');
    setSetting(db, 'about_en', next.aboutEn ?? '');
    res.json(siteSettings(db));
  });

  r.get('/media/:storedName', (req, res, next) => {
    const name = req.params.storedName;
    const row = STORED_NAME_RE.test(name) && db.prepare('SELECT * FROM files WHERE stored_name = ?').get(name);
    if (!row) return next(new HttpError(404, 'not_found', 'Не е намерено.'));
    return files.send(res, row, next);
  });
  return r;
}

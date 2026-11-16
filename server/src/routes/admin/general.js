import express from 'express';
import { getSetting, setSetting, siteSettings, eventStatus, today, latestSnapshot, hasUnpublishedChanges, loc } from '../../store.js';
import { addDays } from '../../time.js';
import { HttpError, validationError, has } from '../../http.js';
import { STORED_NAME_RE } from '../../files.js';

export function generalRoutes({ db, nowMs, files }) {
  const r = express.Router();

  r.get('/dashboard', (req, res) => {
    const now = nowMs();
    const t = today(now);
    const counts = { active: 0, scheduled: 0, disabled: 0, expired: 0, activeTitles: [] };
    for (const e of db.prepare('SELECT * FROM events ORDER BY event_at IS NULL, event_at, id').all()) {
      const s = eventStatus(e, now);
      counts[s]++;
      if (s === 'active') counts.activeTitles.push(e.title);
    }
    const dm = (d) => {
      const row = db.prepare('SELECT id, published FROM daily_menus WHERE menu_date = ?').get(d);
      return row ? { id: row.id, published: !!row.published } : null;
    }; 
    const pf = db.prepare('SELECT m.id, f.original_name FROM menu_files m JOIN files f ON f.id = m.file_id WHERE m.published = 1 LIMIT 1').get();
    const snap = latestSnapshot(db);
    res.json({
      today: t,
      now: loc(now),
      events: counts,
      dailyMenu: { today: dm(t), tomorrow: dm(addDays(t, 1)) },
      menu: {
        mode: getSetting(db, 'menu_mode'),
        structuredPublishedAt: snap ? loc(snap.publishedAt) : null,
        hasUnpublishedChanges: hasUnpublishedChanges(db),
        publishedFile: pf ? { id: pf.id, originalName: pf.original_name } : null,
      },
    });
  });

  r.get('/settings', (req, res) => res.json(siteSettings(db)));

  r.put('/settings', (req, res) => {
    const b = req.body || {};
    const cur = siteSettings(db);
    const spec = {
      reservationPhone: { max: 30, re: /^[+0-9 ()-]*$/, msg: 'Само цифри и + ( ) - интервал, до 30 символа.' },
      address: { max: 200 },
      openingHours: { max: 500 },
      currencySymbol: { max: 5 },
    };
    const next = { ...cur };
    const fields = {};
    for (const [k, s] of Object.entries(spec)) {
      if (!has(b, k)) continue;
      if (typeof b[k] !== 'string') { fields[k] = 'Невалидна стойност.'; continue; }
      const v = b[k].trim();
      if (v.length > s.max) fields[k] = `Най-много ${s.max} символа.`;
      else if (s.re && !s.re.test(v)) fields[k] = s.msg;
      else if (k === 'currencySymbol' && v === '') fields[k] = 'Въведете символ.';
      else next[k] = v;
    }
    if (Object.keys(fields).length) throw validationError(fields);
    setSetting(db, 'reservation_phone', next.reservationPhone);
    setSetting(db, 'address', next.address);
    setSetting(db, 'opening_hours', next.openingHours);
    setSetting(db, 'currency_symbol', next.currencySymbol);
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

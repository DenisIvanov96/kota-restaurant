// Shared data helpers (publication rules live here).
import { sofiaDate, utcToSofiaLocal } from './time.js';
import { kindOf } from './files.js';

export const loc = (ms) => (ms == null ? null : utcToSofiaLocal(ms));

export function getSetting(db, key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : null;
}
export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function siteSettings(db) {
  return {
    reservationPhone: getSetting(db, 'reservation_phone') ?? '',
    address: getSetting(db, 'address') ?? '',
    openingHours: getSetting(db, 'opening_hours') ?? '',
    currencySymbol: getSetting(db, 'currency_symbol') ?? '€',
  };
}

// ----- events -----
export function eventStatus(e, now) {
  if (!e.enabled) return 'disabled';
  if (e.starts_at != null && e.starts_at > now) return 'scheduled';
  if (e.expires_at != null && e.expires_at <= now) return 'expired';
  return 'active';
}

// ----- today -----
export const today = (now) => sofiaDate(now);

// ----- regular menu (draft + snapshots) -----
export function readDraft(db) {
  const cats = db.prepare('SELECT id, name FROM menu_categories ORDER BY position, id').all();
  const items = db.prepare('SELECT id, category_id, name, description, price_cents, available FROM menu_items ORDER BY position, id').all();
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    items: items.filter((i) => i.category_id === c.id).map((i) => ({
      id: i.id, name: i.name, description: i.description, priceCents: i.price_cents, available: !!i.available,
    })),
  }));
}

export function latestSnapshot(db) {
  const r = db.prepare('SELECT snapshot_json, published_at FROM menu_versions ORDER BY id DESC LIMIT 1').get();
  if (!r) return null;
  return { publishedAt: r.published_at, categories: JSON.parse(r.snapshot_json) };
}

const canon = (cats) => JSON.stringify(cats.map((c) => [c.name, c.items.map((i) => [i.name, i.description, i.priceCents, !!i.available])]));

export function hasUnpublishedChanges(db) {
  const draft = readDraft(db);
  const snap = latestSnapshot(db);
  return snap ? canon(draft) !== canon(snap.categories) : draft.length > 0;
}

// ----- files -----
export const fileUrlPublic = (stored) => `/media/${stored}`;
export const fileUrlAdmin = (stored) => `/api/admin/media/${stored}`;

export function publicFileInfo(row, publishedAt) {
  return { fileUrl: fileUrlPublic(row.stored_name), mimeType: row.mime_type, kind: kindOf(row.mime_type), publishedAt: loc(publishedAt) };
}

/** True if stored file is referenced by currently public content. */
export function isPubliclyVisible(db, storedName, now) {
  const f = db.prepare('SELECT id FROM files WHERE stored_name = ?').get(storedName);
  if (!f) return false;
  const ev = db.prepare(`SELECT 1 FROM events WHERE image_file_id = ? AND enabled = 1
      AND (starts_at IS NULL OR starts_at <= ?) AND (expires_at IS NULL OR expires_at > ?)`).get(f.id, now, now);
  if (ev) return true;
  if (db.prepare('SELECT 1 FROM daily_menus WHERE file_id = ? AND published = 1 AND menu_date = ?').get(f.id, today(now))) return true;
  if (getSetting(db, 'menu_mode') === 'file' &&
      db.prepare('SELECT 1 FROM menu_files WHERE file_id = ? AND published = 1').get(f.id)) return true;
  return false;
}

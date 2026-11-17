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
    addressEn: getSetting(db, 'address_en') ?? '',
    openingHoursEn: getSetting(db, 'opening_hours_en') ?? '',
    currencySymbol: getSetting(db, 'currency_symbol') ?? '€',
    instagramUrl: getSetting(db, 'instagram_url') ?? '',
  };
}

// ----- languages (public site) -----
export const LANGS = ['bg', 'en'];
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
/** Text of the requested language if non-empty, otherwise the other language's text (fallback both directions, D-39). */
export const pick = (lang, bg, en) => {
  const [first, second] = lang === 'en' ? [en, bg] : [bg, en];
  if (nonEmpty(first)) return first;
  if (nonEmpty(second)) return second;
  return typeof bg === 'string' ? bg : '';
};
/** Same fallback for nullable values (e.g. file rows): requested language first, else the other. */
export const pickAny = (lang, bg, en) => {
  const [first, second] = lang === 'en' ? [en, bg] : [bg, en];
  return first || second || null;
};

/** Public (language-resolved) site settings; same shape as before. */
export function publicSiteSettings(db, lang) {
  const s = siteSettings(db);
  return {
    reservationPhone: s.reservationPhone,
    address: pick(lang, s.address, s.addressEn),
    openingHours: pick(lang, s.openingHours, s.openingHoursEn),
    currencySymbol: s.currencySymbol,
    instagramUrl: s.instagramUrl,
  };
}

/** Resolves a (draft or snapshot) category list to one language, dropping the *En fields. */
export function resolveCategories(cats, lang) {
  return cats.map((c) => ({
    id: c.id,
    name: pick(lang, c.name, c.nameEn),
    items: c.items.map((i) => ({
      id: i.id, name: pick(lang, i.name, i.nameEn), description: pick(lang, i.description, i.descriptionEn),
      priceCents: i.priceCents, available: i.available,
    })),
  }));
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
  const cats = db.prepare('SELECT id, name, name_en FROM menu_categories ORDER BY position, id').all();
  const items = db.prepare('SELECT id, category_id, name, name_en, description, description_en, price_cents, available FROM menu_items ORDER BY position, id').all();
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    nameEn: c.name_en ?? '',
    items: items.filter((i) => i.category_id === c.id).map((i) => ({
      id: i.id, name: i.name, nameEn: i.name_en ?? '', description: i.description, descriptionEn: i.description_en ?? '', priceCents: i.price_cents, available: !!i.available,
    })),
  }));
}

export function latestSnapshot(db) {
  const r = db.prepare('SELECT snapshot_json, published_at FROM menu_versions ORDER BY id DESC LIMIT 1').get();
  if (!r) return null;
  return { publishedAt: r.published_at, categories: JSON.parse(r.snapshot_json) };
}

const canon = (cats) => JSON.stringify(cats.map((c) => [c.name, c.nameEn ?? '', c.items.map((i) => [i.name, i.nameEn ?? '', i.description, i.descriptionEn ?? '', i.priceCents, !!i.available])]));

export function hasUnpublishedChanges(db) {
  const draft = readDraft(db);
  const snap = latestSnapshot(db);
  return snap ? canon(draft) !== canon(snap.categories) : draft.length > 0;
}

// ----- files -----
export const fileUrlPublic = (stored) => `/media/${stored}`;
export const fileUrlAdmin = (stored) => `/api/admin/media/${stored}`;

// ----- regular menu pages (file mode, D-46) -----
const flagKey = (lang) => `menu_pages_published_${lang}`;
const stampKey = (lang) => `menu_pages_updated_${lang}`;
export const MAX_MENU_PAGES = 10;

export const pagesFlag = (db, lang) => getSetting(db, flagKey(lang)) === '1';
export const setPagesFlag = (db, lang, on) => setSetting(db, flagKey(lang), on ? '1' : '0');
/** Marks the page set of a language as changed (public `publishedAt`). */
export const touchPages = (db, lang, now) => setSetting(db, stampKey(lang), String(now));

export function pageRows(db, lang) {
  return db.prepare(`SELECT m.id, m.lang, m.position, m.created_at, f.stored_name, f.mime_type, f.original_name, f.size_bytes
    FROM menu_files m JOIN files f ON f.id = m.file_id WHERE m.lang = ? ORDER BY m.position, m.id`).all(lang);
}

/** Languages whose page set is public: published flag on AND at least one page. */
export function liveLangs(db) {
  return LANGS.filter((l) => pagesFlag(db, l) && db.prepare('SELECT 1 FROM menu_files WHERE lang = ?').get(l));
}

/** Public file-mode payload for the requested language (falls back to the other language), or null. */
export function publicMenuPages(db, lang) {
  const live = liveLangs(db);
  const use = live.includes(lang) ? lang : live[0];
  if (!use) return null;
  const rows = pageRows(db, use);
  const stamp = Number(getSetting(db, stampKey(use))) || Math.max(...rows.map((r) => r.created_at));
  return {
    lang: use,
    pages: rows.map((r) => ({ fileUrl: fileUrlPublic(r.stored_name), mimeType: r.mime_type, kind: kindOf(r.mime_type) })),
    publishedAt: loc(stamp),
  };
}

/** True if stored file is referenced by currently public content. */
export function isPubliclyVisible(db, storedName, now) {
  const f = db.prepare('SELECT id FROM files WHERE stored_name = ?').get(storedName);
  if (!f) return false;
  const ev = db.prepare(`SELECT 1 FROM events WHERE (image_file_id = ? OR image_en_file_id = ?) AND enabled = 1
      AND (starts_at IS NULL OR starts_at <= ?) AND (expires_at IS NULL OR expires_at > ?)`).get(f.id, f.id, now, now);
  if (ev) return true;
  if (db.prepare('SELECT 1 FROM daily_menus WHERE (file_id = ? OR file_en_id = ?) AND published = 1 AND menu_date = ?').get(f.id, f.id, today(now))) return true;
  if (getSetting(db, 'menu_mode') === 'file') {
    const page = db.prepare('SELECT lang FROM menu_files WHERE file_id = ?').get(f.id);
    if (page && pagesFlag(db, page.lang)) return true;
  }
  return false;
}

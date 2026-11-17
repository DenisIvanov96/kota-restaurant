CREATE TABLE admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  totp_secret TEXT,
  totp_pending_secret TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_admin ON sessions(admin_id);

CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_file_id INTEGER REFERENCES files(id),
  event_at INTEGER,
  starts_at INTEGER,
  expires_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE daily_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_date TEXT NOT NULL UNIQUE,
  file_id INTEGER NOT NULL REFERENCES files(id),
  published INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE menu_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL
);

CREATE TABLE menu_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_json TEXT NOT NULL,
  published_at INTEGER NOT NULL
);

CREATE TABLE menu_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id),
  published INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings(key, value) VALUES
  ('menu_mode', 'structured'),
  ('reservation_phone', ''),
  ('address', ''),
  ('opening_hours', ''),
  ('currency_symbol', '€');

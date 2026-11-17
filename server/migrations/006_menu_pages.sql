-- Multi-page regular menu in file mode (D-46): ordered pages per language + a published flag per language.
ALTER TABLE menu_files ADD COLUMN position INTEGER NOT NULL DEFAULT 1;

-- Before this migration a language had several alternative files, at most one published. Now a language is a set of pages
-- that is published as a whole, so the old alternatives must not turn into extra public pages: per language keep ONE file
-- (the published one, else the newest) as page 1. The other rows are dropped here; their now-unreferenced `files` rows and
-- disk files are removed by the startup orphan sweep.
DELETE FROM menu_files WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY lang ORDER BY published DESC, id DESC) AS rn FROM menu_files
  ) WHERE rn = 1
);

INSERT OR IGNORE INTO settings(key, value) VALUES ('menu_pages_published_bg', '0'), ('menu_pages_published_en', '0');
UPDATE settings SET value = '1' WHERE key = 'menu_pages_published_bg' AND EXISTS (SELECT 1 FROM menu_files WHERE lang = 'bg' AND published = 1);
UPDATE settings SET value = '1' WHERE key = 'menu_pages_published_en' AND EXISTS (SELECT 1 FROM menu_files WHERE lang = 'en' AND published = 1);

-- the per-file flag is superseded by the per-language setting (column kept; SQLite column drops are avoided)
UPDATE menu_files SET published = 0;

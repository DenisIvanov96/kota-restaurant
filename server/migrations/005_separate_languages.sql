-- Separate BG / EN content (D-39..D-42). Existing rows are unaffected (new columns default to NULL / 'bg').
ALTER TABLE events ADD COLUMN image_en_file_id INTEGER REFERENCES files(id);
ALTER TABLE menu_files ADD COLUMN lang TEXT NOT NULL DEFAULT 'bg';

-- daily_menus.file_id becomes nullable (an English-only daily menu is allowed) -> rebuild the table.
-- Nothing references daily_menus, so the copy/drop/rename is safe.
CREATE TABLE daily_menus_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_date TEXT NOT NULL UNIQUE,
  file_id INTEGER REFERENCES files(id),
  file_en_id INTEGER REFERENCES files(id),
  published INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO daily_menus_new(id, menu_date, file_id, file_en_id, published, created_at, updated_at)
  SELECT id, menu_date, file_id, NULL, published, created_at, updated_at FROM daily_menus;
DROP TABLE daily_menus;
ALTER TABLE daily_menus_new RENAME TO daily_menus;

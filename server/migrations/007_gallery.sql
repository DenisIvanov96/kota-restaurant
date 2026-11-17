-- Gallery (D-51): up to 25 ordered photos/videos with per-language captions and a visibility flag; editable About text (D-52).
CREATE TABLE gallery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL UNIQUE REFERENCES files(id),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  caption_bg TEXT,
  caption_en TEXT,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_gallery_position ON gallery_items(position, id);

-- empty string = not set (the public site then shows the built-in default text)
INSERT OR IGNORE INTO settings(key, value) VALUES ('about_bg', ''), ('about_en', '');

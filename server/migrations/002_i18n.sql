-- Optional English content (D-27). NULL / empty = fall back to the Bulgarian text.
ALTER TABLE events ADD COLUMN title_en TEXT;
ALTER TABLE events ADD COLUMN description_en TEXT;
ALTER TABLE menu_categories ADD COLUMN name_en TEXT;
ALTER TABLE menu_items ADD COLUMN name_en TEXT;
ALTER TABLE menu_items ADD COLUMN description_en TEXT;

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('address_en', ''),
  ('opening_hours_en', '');

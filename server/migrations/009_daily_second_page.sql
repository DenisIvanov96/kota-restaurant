-- Daily menu second page (D-62): an optional second file per language. Existing rows get NULL.
ALTER TABLE daily_menus ADD COLUMN file2_id INTEGER REFERENCES files(id);
ALTER TABLE daily_menus ADD COLUMN file2_en_id INTEGER REFERENCES files(id);

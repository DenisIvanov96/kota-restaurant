-- Owner feedback round 1 (D-37): default address, only where none is stored. Idempotent; never overwrites.
-- BUG-12: the English default is seeded ONLY together with the Bulgarian one (i.e. when the stored address is empty);
-- it must never be seeded alone, otherwise English visitors would see it instead of the owner's BG address (per-field fallback).
INSERT OR IGNORE INTO settings(key, value) VALUES ('address', ''), ('address_en', ''), ('instagram_url', '');
-- address_en first: it reads the still-empty address to decide.
UPDATE settings SET value = '85 Ralevitsa St, Sofia'
  WHERE key = 'address_en' AND TRIM(value) = ''
    AND TRIM(COALESCE((SELECT value FROM settings WHERE key = 'address'), '')) = '';
UPDATE settings SET value = 'ул. Ралевица 85, София' WHERE key = 'address' AND TRIM(value) = '';

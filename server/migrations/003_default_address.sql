-- Owner feedback round 1 (D-37): default address, only where none is stored. Idempotent; never overwrites.
INSERT OR IGNORE INTO settings(key, value) VALUES ('address', ''), ('address_en', ''), ('instagram_url', '');
UPDATE settings SET value = 'ул. Ралевица 85, София' WHERE key = 'address' AND TRIM(value) = '';
UPDATE settings SET value = '85 Ralevitsa St, Sofia' WHERE key = 'address_en' AND TRIM(value) = '';

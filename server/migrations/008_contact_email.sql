-- Editable contact email (D-55): shown on the public Contacts section and the privacy page.
-- Placeholder until the owner changes it; INSERT OR IGNORE so a later clear (empty string) is never refilled on restart.
INSERT OR IGNORE INTO settings(key, value) VALUES ('contact_email', 'example@gmail.com');

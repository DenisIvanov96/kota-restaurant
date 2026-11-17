-- BUG-12 corrective: an earlier 003 seeded the English default address even where the owner already had a different
-- Bulgarian address. Clear address_en back to '' (-> per-field fallback to the BG address) only when it is exactly the
-- default AND the stored address is not the default BG address. Idempotent; any other owner-entered value is untouched.
UPDATE settings SET value = ''
  WHERE key = 'address_en' AND value = '85 Ralevitsa St, Sofia'
    AND COALESCE((SELECT value FROM settings WHERE key = 'address'), '') <> 'ул. Ралевица 85, София';

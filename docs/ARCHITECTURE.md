# Architecture

Owned by the PM (structure, contract) and Backend Developer (implementation details). Changes to the API contract must be agreed through the PM and recorded in `docs/DECISIONS.md`.

## Overview
The site was a static page. The admin CMS needs server-side storage and authorisation, so it becomes a small **Node.js server** that serves the public site, the admin UI and a JSON API.

```
Browser ──► Node.js (Express)
             ├─ /                 static public site      (public/)
             ├─ /daily-menu       daily menu page          (public/daily-menu.html)
             ├─ /admin/           admin single-page UI     (public/admin/)
             ├─ /api/public/*     read-only published content (no auth)
             ├─ /api/admin/*      authenticated admin API
             └─ /media/<name>     uploaded files, only if publicly visible
            SQLite database + uploads folder   (DATA_DIR, default ./data — git-ignored)
```

- **Runtime:** Node.js ≥ 22.13 (built-in `node:sqlite`, global `fetch`, `node:test`).
- **Dependencies:** `express`, `multer` (multipart uploads). Nothing else at runtime. Passwords use `crypto.scrypt`; TOTP uses `crypto` HMAC. Tests use `node:test` + global `fetch`; browser tests use the pre-installed Playwright (not an npm dependency).
- **No build step.** Frontend is plain HTML/CSS/vanilla JS (ES modules allowed).

## Repository layout
```
package.json            scripts: start, test, admin:create, admin:reset-password
server/
  src/app.js            createApp({dataDir, now}) — Express app factory (used by tests)
  src/server.js         reads env, runs migrations, listens
  src/db.js             opens SQLite, runs migrations in server/migrations/ in order
  src/time.js           Europe/Sofia helpers
  src/auth.js           password hashing, sessions, rate limiting, TOTP, middleware
  src/files.js          upload validation (magic bytes), safe storage, deletion
  src/routes/public.js
  src/routes/admin/*.js
  migrations/001_init.sql
  scripts/create-admin.js, reset-password.js, disable-2fa.js
  test/                 backend tests (Backend Developer)
public/                 everything served statically (nothing else is!)
  index.html, daily-menu.html, css/, js/, images/
  admin/index.html, admin/admin.css, admin/js/*.js
tests/                  QA test suites (QA Engineer)
data/                   runtime only, git-ignored: kota.db, uploads/
```
**Only `public/` is served statically.** `server/`, `data/`, `.env`, `docs/` must never be reachable over HTTP.

## Configuration (environment variables)
| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | listen port |
| `HOST` | `127.0.0.1` | bind address; set `0.0.0.0` only in containers (D-20) |
| `DATA_DIR` | `./data` | SQLite file + `uploads/` |
| `NODE_ENV` | `development` | `production` enables secure cookies and disables test hooks |
| `COOKIE_SECURE` | `true` in production, else `false` | `Secure` flag on session cookie |
| `TRUST_PROXY` | `false` | set `1` behind a reverse proxy so rate limiting sees real client IPs |
| `KOTA_NOW` | unset | **Test hook only**: fixed "current time" (ISO 8601). Ignored when `NODE_ENV=production`. |

No secrets are required to run. Admin accounts are created with a CLI script, never through the web.

## Time rules (Europe/Sofia)
- All "today", "start", "expiry" logic is evaluated on the **server** in `Europe/Sofia` (DST-aware, via `Intl`).
- The DB stores instants as UTC epoch milliseconds and calendar dates as `YYYY-MM-DD`.
- The API sends and receives date-times as **Sofia local strings `YYYY-MM-DDTHH:mm`** (what `<input type="datetime-local">` uses) and dates as `YYYY-MM-DD`. The browser never does timezone maths.

## Data model (SQLite)
- `admins(id, username UNIQUE, password_hash, role='admin', totp_secret NULL, totp_pending_secret NULL, created_at, updated_at)`
- `sessions(id, token_hash UNIQUE, admin_id, created_at, last_seen_at, expires_at)` — absolute lifetime 7 days, idle timeout 12 h.
- `files(id, stored_name UNIQUE, original_name, mime_type, size_bytes, created_at)`
- `events(id, title, description, image_file_id NULL, event_at NULL, starts_at NULL, expires_at NULL, enabled 0/1, created_at, updated_at)`
- `daily_menus(id, menu_date UNIQUE 'YYYY-MM-DD', file_id, published 0/1, created_at, updated_at)`
- `menu_categories(id, name, position)` and `menu_items(id, category_id, name, description, price_cents, available 0/1, position)` — the **draft** structured menu.
- `menu_versions(id, snapshot_json, published_at)` — every publish of the structured menu; the latest row is public. Old rows kept as history.
- `menu_files(id, file_id, published 0/1, created_at)` — uploaded full-menu files; at most one published.
- `settings(key PRIMARY KEY, value)` — `menu_mode` (`structured`|`file`), `reservation_phone`, `address`, `opening_hours`, `currency_symbol` (default `€`), `draft_updated_at`.
- **Reserved for the future Tables feature** (do not create now): `floor_tables(id, number UNIQUE, x, y, seats, status)` — see `docs/FUTURE-TABLES.md`.

## Publication rules
- **Event is public** iff `enabled = 1` AND (`starts_at` is null OR `starts_at <= now`) AND (`expires_at` is null OR `expires_at > now`). Status for admin: `disabled` | `scheduled` (enabled, not started) | `active` | `expired` (enabled, past expiry).
- **Daily menu is public** iff `published = 1` AND `menu_date = today in Sofia`. Never yesterday's, never tomorrow's.
- **Regular menu:** `menu_mode` chooses what is public: the latest `menu_versions` snapshot (`structured`) or the one published `menu_files` row (`file`). Draft edits never change the public menu until `POST /api/admin/menu/publish`.
- **/media/<stored_name>** is served only if that file is referenced by currently public content (active event image, today's published daily menu, published menu file when mode=`file`). Otherwise 404. Admins use `/api/admin/media/<stored_name>`.
- Changes take effect on the next request — no redeploy, no server-side caching.

## HTTP conventions
- JSON everywhere; errors are `{ "error": "<code>", "message": "<Bulgarian, user-readable>", "fields": { "<field>": "<message>" } }` (fields only on validation errors).
- Status codes: 400 validation, 401 not logged in / bad credentials, 403 CSRF/forbidden, 404, 409 conflict, 413 file too large, 415 bad file type, 429 rate-limited, 500 (no stack traces to clients).
- `Cache-Control: no-store` on all `/api/*`. `/media/*` and HTML pages: `Cache-Control: no-cache` (always revalidate).
- Security headers on every response: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: SAMEORIGIN`. Admin pages also `X-Robots-Tag: noindex`.
  → Frontend must not use inline `<script>`, `on*=` attributes or `style=""` attributes.
- Text fields are plain text; the frontend renders them with `textContent` (never `innerHTML`).

## Authentication & CSRF
- Session cookie `kota_session`: random 32-byte token, only its SHA-256 hash stored. `HttpOnly; SameSite=Strict; Path=/`; `Secure` per `COOKIE_SECURE`.
- Every `/api/admin/*` route except `POST /login` requires a valid session (401 otherwise).
- Every non-GET `/api/admin/*` request (including login) must send header `X-Requested-With: kota-admin`, and if an `Origin` header is present it must match the host; otherwise 403 `csrf`.
- Login rate limit: 5 failed attempts per IP per 15 min and 10 per username per 15 min → 429 with `retryAfter` seconds.
- Passwords: min 12 characters; scrypt with per-user salt; constant-time compare.
- Optional TOTP 2FA (RFC 6238, SHA-1, 30 s, 6 digits, ±1 step). Shown as a secret key + `otpauth://` URL for manual entry in an authenticator app.
- 2FA recovery: `npm run admin:disable-2fa -- --username <name>` (server operator).
- Password recovery: no e-mail service is configured, so recovery is by the server operator running `npm run admin:reset-password -- --username <name>`. E-mail recovery is a future option (needs SMTP credentials + approval).
- No registration endpoint exists.

## API contract

### Public (no auth)
| Method & path | Response |
|---|---|
| `GET /api/public/site` | `{ reservationPhone, address, openingHours, currencySymbol }` (strings, may be empty) |
| `GET /api/public/events` | `{ events: [ { id, title, description, imageUrl\|null, eventAt\|null } ] }` — only public events, ordered by `eventAt` then `startsAt` |
| `GET /api/public/daily-menu` | `{ today: "YYYY-MM-DD", menu: null \| { date, fileUrl, mimeType, kind: "pdf"\|"image", updatedAt } }` |
| `GET /api/public/menu` | `{ mode, currencySymbol, structured: null \| { publishedAt, categories: [ { id, name, items: [ { id, name, description, priceCents, available } ] } ] }, file: null \| { fileUrl, mimeType, kind, publishedAt } }` — only the active mode is filled; the other is null |
| `GET /media/:storedName` | file bytes, or 404 if not publicly visible |

### Admin — session
| Method & path | Body | Response |
|---|---|---|
| `POST /api/admin/login` | `{ username, password, totp? }` | 200 `{ admin: { username, totpEnabled } }` + cookie · 401 `invalid_credentials` · 401 `totp_required` · 429 `rate_limited` |
| `POST /api/admin/logout` | — | 204, session deleted |
| `GET /api/admin/me` | — | `{ admin: { username, totpEnabled } }` |
| `POST /api/admin/password` | `{ currentPassword, newPassword }` | 204; all *other* sessions revoked |
| `POST /api/admin/totp/setup` | — | `{ secret, otpauthUrl }` (pending until enabled) |
| `POST /api/admin/totp/enable` | `{ code }` | 204 |
| `POST /api/admin/totp/disable` | `{ password, code }` | 204 |

### Admin — dashboard & settings
| Method & path | Response / body |
|---|---|
| `GET /api/admin/dashboard` | `{ today, now, events: { active, scheduled, disabled, expired, activeTitles: [] }, dailyMenu: { today: null\|{id, published}, tomorrow: null\|{id, published} }, menu: { mode, structuredPublishedAt\|null, hasUnpublishedChanges, publishedFile: null\|{id, originalName} } }` |
| `GET /api/admin/settings` | `{ reservationPhone, address, openingHours, currencySymbol }` |
| `PUT /api/admin/settings` | same shape (JSON) → 200 same shape. Limits: phone ≤ 30 chars of `+ 0-9 space ( ) -`; address ≤ 200; openingHours ≤ 500; currencySymbol ≤ 5 |
| `GET /api/admin/media/:storedName` | any uploaded file (auth) |

### Admin — events
Event object: `{ id, title, description, imageUrl|null, eventAt|null, startsAt|null, expiresAt|null, enabled, status, createdAt, updatedAt }` (date-times as Sofia local strings; `imageUrl` is an admin media URL).
| Method & path | Body | Response |
|---|---|---|
| `GET /api/admin/events` | — | `{ events: [...] }` newest first |
| `POST /api/admin/events` | multipart: `title` (1–120), `description` (0–2000), `eventAt?`, `startsAt?`, `expiresAt?`, `enabled` (`true`/`false`), `image?` (jpg/png/webp ≤ 5 MB) | 201 event |
| `PUT /api/admin/events/:id` | multipart, same fields; `image` replaces; `removeImage=true` removes | 200 event |
| `PATCH /api/admin/events/:id/enabled` | JSON `{ enabled }` | 200 event |
| `DELETE /api/admin/events/:id` | — | 204 (image file deleted) |
Rule: if both set, `expiresAt` must be after `startsAt` (400).

### Admin — daily menus
Daily menu object: `{ id, date, fileUrl, mimeType, kind, originalName, sizeBytes, published, createdAt, updatedAt }`.
| Method & path | Body | Response |
|---|---|---|
| `GET /api/admin/daily-menus` | — | `{ today, menus: [...] }` date descending |
| `POST /api/admin/daily-menus` | multipart: `date` (YYYY-MM-DD), `published` (`true`/`false`), `file` (pdf/jpg/jpeg/png/webp ≤ 10 MB), `replace?` (`true`) | 201 menu · 409 `date_exists` `{ existingId }` if that date already has a menu and `replace` ≠ `true` · with `replace=true` the existing row's file is replaced (old file deleted) → 200 |
| `PUT /api/admin/daily-menus/:id` | multipart: `file?`, `date?`, `published?` | 200 menu · 409 `date_exists` if moved onto a taken date |
| `PATCH /api/admin/daily-menus/:id/published` | JSON `{ published }` | 200 menu |
| `DELETE /api/admin/daily-menus/:id` | — | 204 (file deleted) |

### Admin — regular menu
| Method & path | Body | Response |
|---|---|---|
| `GET /api/admin/menu` | — | `{ mode, currencySymbol, draft: { updatedAt\|null, categories: [ { id, name, items: [ { id, name, description, priceCents, available } ] } ] }, published: null \| { publishedAt, categories }, hasUnpublishedChanges, files: [ { id, fileUrl, mimeType, kind, originalName, sizeBytes, published, createdAt } ] }` |
| `PUT /api/admin/menu/draft` | JSON `{ categories: [ { id?, name, items: [ { id?, name, description, priceCents, available } ] } ] }` — the **whole** draft; array order = display order; missing ids = new; ids not sent = deleted | 200 draft. Limits: ≤ 50 categories, ≤ 200 items/category, names 1–100, description ≤ 500, `priceCents` integer 0–10 000 000 |
| `POST /api/admin/menu/draft/discard` | — | 200 draft (draft reset to the latest published snapshot; empty if never published) |
| `POST /api/admin/menu/publish` | — | 200 `{ publishedAt }` — snapshot of the current saved draft becomes public (if mode is `structured`) |
| `POST /api/admin/menu/files` | multipart: `file` (pdf/jpg/jpeg/png/webp ≤ 15 MB) | 201 file object (unpublished) |
| `PATCH /api/admin/menu/files/:id/published` | JSON `{ published }` | 200 — publishing one unpublishes all others · 409 `in_use` when unpublishing the live file while mode is `file` (D-16) |
| `DELETE /api/admin/menu/files/:id` | — | 204 · 409 `in_use` if it is the published file and mode is `file` |
| `PUT /api/admin/menu/mode` | JSON `{ mode }` | 200 `{ mode }` · 409 `nothing_published` if the target mode has nothing published |

## Upload security
- Accept only by **magic bytes** (PDF `%PDF-`, JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`) and require the declared type/extension to agree. SVG, HTML, etc. rejected (415).
- Size limits enforced while streaming (413). Stored as `<random 32 hex>.<ext>` in `DATA_DIR/uploads/`; original name kept only as metadata (sanitised, ≤ 200 chars).
- Served with the stored MIME type, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline; filename="<safe name>"`.
- Replaced/deleted files are removed from disk; failed uploads leave no orphan files.

## Implementation notes from T-2 (binding for frontend and QA)
- Stack as built: ESM (`"type": "module"`), Express 5, multer 2 (memory storage, validated before writing to disk).
- **CSRF is checked before auth**: a non-GET `/api/admin/*` request without `X-Requested-With: kota-admin` gets **403 `csrf`** even when not logged in.
- Error codes: `validation`, `unauthorized`, `csrf`, `not_found`, `date_exists`, `in_use`, `nothing_published`, `file_too_large` (413), `unsupported_type` (415), `rate_limited` (+ `Retry-After` header), `invalid_json`, `server_error`, `totp_already_enabled`, `totp_not_pending`, `totp_not_enabled` (409).
- Login: wrong TOTP code → 401 `invalid_credentials`; correct password without code → 401 `totp_required` (not counted as a failure).
- Re-auth inside a session (wrong `currentPassword`, wrong password/code for TOTP enable/disable) → **400 `validation` with `fields`**, never 401, so the UI must not treat it as logout.
- `PUT /api/admin/events/:id` and `PUT /api/admin/daily-menus/:id` are **partial updates**: omitted fields keep their value; a date-time field sent as an empty string clears it. `enabled` defaults to `false` on create.
- Draft menu: unknown or duplicate ids → 400; validation `fields` keys look like `categories[0].items[1].priceCents`.
- Upload: file extension must match the sniffed type (`.jpg`/`.jpeg` both OK); declared MIME must match unless empty/`application/octet-stream`.
- Public file-mode `publishedAt` = the file's upload time (no separate publish timestamp).
- DST: a local time in the spring-forward gap moves forward 1 h (03:30 → 04:30); an autumn-overlap time resolves to the first (summer-time) occurrence.
- Usernames: case-insensitive, 3–50 chars `[A-Za-z0-9._-]`.
- Unknown routes return the JSON 404 (no HTML 404 page yet). Static files: `Cache-Control: no-cache`.
- Test helpers for QA: `server/test/helpers.js` → `startApp({ iso, trustProxy })`, `loggedIn`, `formData`.

## Bilingual public site — БГ / EN (D-27, added after user request)
Public site has a БГ / EN switch; **admin stays Bulgarian only**. Everything public switches: UI strings AND restaurant content. Content has optional English fields; **an empty English field falls back to the Bulgarian text**.

### Language selection (frontend)
- Default `bg`. Choice comes from, in order: URL query `?lang=en|bg` → `localStorage['kota_lang']` → `bg`.
- Switching: two buttons "БГ" and "EN" in the top-right of the header on every public page (`aria-pressed` on the active one, `lang` attribute on each button). Click → set `localStorage`, update URL with `history.replaceState` (`?lang=en`, no param for bg), re-render text in place (no full reload needed, reload acceptable), set `<html lang>`, update `<title>` and meta description. Internal links (`/`, `/daily-menu`) keep the `?lang=en` param.
- All UI strings come from one dictionary module (`public/js/i18n.js`: `{ bg: {...}, en: {...} }`), no hard-coded visible text in HTML except a BG fallback. Dates: Bulgarian vs English long format (e.g. "Friday, 20 November 2026, 20:00"); prices keep `12,50 €` in BG and `€12.50` in EN.
- In EN mode the old "Bulgarian / English" double labels become single English labels (and vice versa for BG) — no more mixed "Меню / Menu" headings.

### Data model (migration `002_i18n.sql`)
Add nullable TEXT columns: `events.title_en`, `events.description_en`, `menu_categories.name_en`, `menu_items.name_en`, `menu_items.description_en`. Settings keys: `address_en`, `opening_hours_en`. Published menu snapshots include the `*En` fields; older snapshots without them simply fall back.

### API changes
- **Public endpoints accept `?lang=bg|en`** (default `bg`, anything else → 400 `validation`). The server resolves fallback: with `lang=en`, `title` = `title_en` if non-empty else `title`, same for every translated field. Response shapes are unchanged, plus a top-level `"lang"` field. Affects `GET /api/public/site`, `/events`, `/menu`. `/daily-menu` accepts `lang` too (no text fields; returns `lang`).
- **Admin endpoints carry both languages:**
  - Event object + POST/PUT multipart fields: `titleEn` (0–120), `descriptionEn` (0–2000).
  - Draft menu: category `nameEn` (0–100), item `nameEn` (0–100), `descriptionEn` (0–500); `GET /api/admin/menu` returns them in `draft` and `published`. `hasUnpublishedChanges` must consider them.
  - Settings: `addressEn` (≤200), `openingHoursEn` (≤500).
  - Same validation rules as the BG fields (CRLF normalised, trimmed, plain text). English fields are always optional.

## Launch polish (D-29..D-33)
- **Self-hosted fonts (D-29):** Oswald 400/500/700 and Source Sans 3 400/600/700, `woff2`, latin + latin-ext + cyrillic + cyrillic-ext subsets, in `public/fonts/` with `@font-face` in `public/css/fonts.css` (loaded by public pages and admin) and the SIL OFL licence text in `public/fonts/OFL.txt`. No request to Google at runtime. CSP becomes `style-src 'self'; font-src 'self'` (remove fonts.googleapis.com / fonts.gstatic.com).
- **Favicon (D-30):** `public/favicon.svg` (KOTA 1 mark), `public/favicon-32.png`, `public/apple-touch-icon.png` (180×180); linked from every public page and the admin.
- **404 page (D-31):** `public/404.html`, bilingual via the i18n module, same header/footer. The server returns it with **status 404** for unknown non-`/api`, non-`/media` GET/HEAD paths whose `Accept` includes `text/html`; everything else keeps the JSON 404.
- **Link previews (D-32):** Open Graph + Twitter card meta on `/`, `/daily-menu`, `/privacy` (og:title, og:description, og:type=restaurant/website, og:locale bg_BG + alternate en_GB, og:image 1200×630 `public/images/og-image.png`, og:url). Absolute URLs use the token `__SITE_URL__`; the server replaces it in served `.html` files with env **`SITE_URL`** (e.g. `https://kota1.bg`, no trailing slash) or with an empty string when unset. HTML stays `Cache-Control: no-cache`.
- **Privacy notice (D-33):** `/privacy` (`public/privacy.html`), BG/EN, linked in every public footer. Content is a draft for owner/lawyer review with marked placeholders (legal entity, hosting provider, log retention days).
- **Map link:** in the contact section, when an address is set, a link "Виж на картата / View on map" → `https://www.google.com/maps/search/?api=1&query=<encodeURIComponent(address)>`, `target="_blank" rel="noopener noreferrer"`. No embedded map (no third-party requests on page load).

## Owner feedback round 1 (D-34..D-38)
1. **Reservation top bar on every public page, always (D-34):** `/`, `/daily-menu`, `/reservation`, `/privacy`, 404. Sticky at the top while scrolling (`position: sticky; top: 0`, above the header). Shows "За резервации: <phone>" / "For reservations: <phone>" as a `tel:` link. If no phone is set it still shows, with the text "Резервации" / "Reservations" linking to `/reservation`. Must not cause horizontal scroll at 320px.
2. **Admin date/time inputs in Bulgarian format (D-35):** replace every native `<input type="date">` / `datetime-local` in the admin with a custom accessible picker: date typed or picked as `дд.мм.гггг`, time as `ЧЧ:ММ` 24-hour, calendar popup with Monday first and Bulgarian month/day names, keyboard-operable, "Днес"/"Утре" shortcuts where relevant, "Изчисти" to clear. The API format is unchanged (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, Sofia local). The browser locale must have no effect.
3. **Instagram (D-36):** new setting `instagramUrl` (admin Settings, "Instagram профил"; must be empty or an `https://(www.)instagram.com/...` URL, ≤ 200 chars). Public: Instagram logo icon link (accessible name "Instagram") in the contact/info section and the footer, `target="_blank" rel="noopener noreferrer"`. When the setting is empty the icon still shows and links to `https://www.instagram.com/` (placeholder until the owner adds the profile).
4. **Location section (D-37):** a "Локация" / "Location" section on the home page, always visible: address (setting, default "ул. Ралевица 85, София" / "85 Ralevitsa St, Sofia" seeded by migration 003 **only if the stored address is empty**), "Виж на картата" map link, and opening hours when set. Nav item "Локация" / "Location". Contact keeps phone and Instagram.
5. **Reservation page `/reservation` (D-38):** a "Резервация" / "Reservation" button in the hero and the nav on all pages. The page shows:
   - a **sample floor plan**: inline SVG, numbered tables (round, square and long tables, about 10–12), entrance, bar and windows, legend, the note "Примерна схема — реалната ще бъде добавена скоро" / "Sample layout — the real plan is coming soon". It is not interactive yet; future booking is in docs/FUTURE-TABLES.md.
   - a big "Обадете се за резервация" call button with the phone (`tel:`).
   - location: the address and the map link.
   It has the same header, top bar, footer and language switch as the other pages, and follows the 404/privacy pattern (`public/reservation.html`, `?lang` aware, OG meta with `__SITE_URL__`).
- **As built (T-26):** `GET/PUT /api/admin/settings` add `instagramUrl`; `GET /api/public/site` returns `instagramUrl` (same in bg/en, may be ''). Invalid → 400 `fields.instagramUrl`. Migration 003 seeds the default address only when empty (a fresh DB now starts with the default address/addressEn).

## Owner feedback round 2 — separate BG / EN content (D-39..D-42)
Admin shows Bulgarian and English as **two clear tabs ("Български" / "English")** instead of English fold-outs. Public site shows the version matching the visitor's БГ/EN choice and switches instantly; **missing content in the chosen language falls back to the other language** (both directions).
- **Events (D-39):** tabs per language: title, description, **optional photo per language** (`imageEn`). Shared: dates, ON/OFF, event date. Validation: a title is required in **at least one** language (BG or EN). Public `?lang=en`: title/description/image = EN if present else BG; `lang=bg`: BG if present else EN.
  - API: event object adds `imageEnUrl|null`; POST/PUT multipart accept `imageEn` (same rules as `image`) and `removeImageEn=true`. Deleting an event deletes both files.
- **Regular menu (D-40):** one structure (categories, dish order, prices, availability shared) with language tabs for names/descriptions. Category/dish name required in at least one language; fallback both directions on the public site. Whole-menu **files per language**: `menu_files.lang` ('bg'|'en'); at most one published file **per language**; public file mode picks the published file of the requested language, else the other language's. Mode (structured/file) stays shared. API: file objects add `lang`; `POST /api/admin/menu/files` accepts `lang` (default bg); publishing unpublishes others **of the same language**; `in_use` / `nothing_published` rules consider any published file.
- **Daily menu (D-41):** each date may have a BG file and an optional EN file (`daily_menus.file_en_id`). Wizard: Bulgarian file (or English only) + optional English file. Public `/daily-menu?lang=en` → EN file if present else BG (and vice versa). API: daily-menu object adds `fileEnUrl|null, mimeTypeEn, kindEn, originalNameEn, sizeBytesEn`; POST/PUT multipart accept `fileEn` and `removeFileEn=true`; a menu must have at least one file. Replace flow unchanged per language.
- **Media visibility (D-42):** `/media/` serves an EN file only when it is part of currently public content (same rules as BG files).
- **Settings:** address/opening hours also in BG/EN tabs (same fields as now).
- **As built (T-33):** migration 005 adds `events.image_en_file_id`, `menu_files.lang`, rebuilds `daily_menus` with nullable `file_id` + `file_en_id` (EN-only menus allowed; BG file fields are null then). Bidirectional per-field fallback (`pick`/`pickAny`). Event title / menu names required in ≥1 language (errors on the BG field key). Daily-menu `replace=true` replaces the whole menu (both languages); PUT is per language. Menu files: one published per language; in file mode `in_use` only for the last published file of any language. Dashboard adds `menu.publishedFiles`. `/media` serves EN files under the same public-visibility rules.

## Owner feedback round 3 — bigger uploads, auto-cleanup, multi-page menu (D-44..D-46)
- **Upload limits (D-44):** every upload (event images BG/EN, daily menu files BG/EN, regular-menu pages) up to **50 MB per file**. Files are uploaded **one per request** (no 500 MB requests). Multer must not buffer 50 MB × N in memory: use disk temp storage in `DATA_DIR/tmp`, validate magic bytes from the file head, move into `uploads/`, always delete temp files. Reverse proxy body limit 55 MB.
- **Daily menu auto-cleanup (D-45):** after any successful daily-menu upload (POST, and PUT that adds a file), delete every daily menu **dated before today (Europe/Sofia)** with all its files. Today and future dates are kept. The admin list shows today + upcoming only; the wizard says "Менютата от минали дни се изтриват автоматично".
- **Regular menu — multi-page file version (D-46):** in file mode, each language has an ordered set of **up to 10 pages**. Each page is an image (JPG/PNG/WebP) or a PDF, ≤ 50 MB.
  - Admin: add pages (multi-select, uploaded one by one with per-file progress), reorder (up/down), delete (confirm), preview, and a **published ON/OFF per language**. Changes to a published set are live immediately; the UI warns. Max 10 → 409 `too_many_pages`.
  - Public file mode: the requested language's published pages in order (images stacked full-width, tap to zoom; PDFs as cards with open/download), with "Страница N от M" / "Page N of M"; else the other language's.
  - Migration 006: `menu_files.position` (order within language), setting `menu_pages_published_bg|en` (0/1). Existing files become page 1 of their language; a published one sets that language published.
  - API (replaces the per-file publish of D-40):
    - `GET /api/admin/menu` → `pages: { bg: { published, items:[{id,fileUrl,mimeType,kind,originalName,sizeBytes,position}] }, en: {...} }`
    - `POST /api/admin/menu/pages` multipart `file`, `lang` → 201 page
    - `PUT /api/admin/menu/pages/order` JSON `{ lang, ids:[...] }`
    - `DELETE /api/admin/menu/pages/:id`
    - `PUT /api/admin/menu/pages/published` JSON `{ lang, published }`
    - Public `GET /api/public/menu` with mode `file` → `file: null | { lang, pages:[{fileUrl,mimeType,kind}], publishedAt }`
    - Rules: `nothing_published` if neither language is published with ≥1 page; `in_use` when unpublishing or deleting would leave file mode with nothing public. `/media` serves a page only while its language is published and mode is `file`.
- **As built (T-38, backend; supersedes older limits and the `/menu/files*` rows above):**
  - **Uploads (D-44):** 50 MB per file on every upload route (`MAX_UPLOAD_BYTES` in `server/src/files.js`); more -> 413 `file_too_large` with `fields.<field>` (`image`, `imageEn`, `file`, `fileEn`). multer disk storage in `DATA_DIR/tmp` (created on start; all leftovers in tmp are deleted on start). Magic bytes are read from the first 16 bytes of the temp file, then it is renamed into `uploads/` (mode 0640). Temp files are deleted when the response closes (success, any error, client abort). On start, `files` rows (and disk files) that nothing references are also removed (orphan sweep).
  - **Daily-menu cleanup (D-45):** after a successful `POST /api/admin/daily-menus` and a `PUT` that uploads `file`/`fileEn`, every daily menu dated before today (Sofia) is deleted with its BG/EN files (published or not). The menu just written is exempt (a past-dated menu can still be created; the next cleanup removes it). `GET /api/admin/daily-menus` returns today and upcoming only. A cleanup failure never fails the upload.
  - **Migration 006:** `menu_files.position`, settings `menu_pages_published_bg|en`; legacy `menu_files.published` is zeroed and unused. Per language it keeps ONE old file (the published one, else the newest) as page 1; other legacy alternatives are dropped (rows by the migration, files by the orphan sweep). A published legacy file sets that language's flag. Settings `menu_pages_updated_bg|en` hold the last change time (public `publishedAt`).
  - **Removed:** `POST /api/admin/menu/files`, `PATCH /api/admin/menu/files/:id/published`, `DELETE /api/admin/menu/files/:id` (now 404); `files` in `GET /api/admin/menu`; `menu.publishedFile(s)` in the dashboard.
  - `GET /api/admin/menu` adds `pages: { bg: { published, items:[{id, fileUrl(admin), mimeType, kind, originalName, sizeBytes, position, lang, createdAt}] }, en: {...} }` (ordered, positions 1-based and contiguous).
  - `POST /api/admin/menu/pages` multipart `file` (pdf/jpg/png/webp <= 50 MB), `lang` (`bg` default | `en`) -> 201 `{id, lang, fileUrl, mimeType, kind, originalName, sizeBytes, position, createdAt}` appended last · 400 `validation` (`fields.lang` / `fields.file`) · 409 `too_many_pages` (10 per language) · 413 · 415.
  - `PUT /api/admin/menu/pages/order` `{ lang, ids }` — `ids` must be exactly the language's page ids (no duplicates, unknown or missing) else 400 `fields.ids` -> 200 `{ lang, published, items }`.
  - `PUT /api/admin/menu/pages/published` `{ lang, published }` -> 200 `{ lang, published, items }` · 409 `in_use` when it would unpublish the only live language in file mode. A flag may be set on an empty language; "live" = flag on AND >= 1 page.
  - `DELETE /api/admin/menu/pages/:id` -> 204 (file deleted, positions renumbered) · 404 · 409 `in_use` for the last page of the only live language in file mode.
  - `PUT /api/admin/menu/mode` `file` -> 409 `nothing_published` unless a language is live.
  - Dashboard: `menu.pages: { bg: { published, count }, en: { published, count } }`.
  - Public `GET /api/public/menu` (mode `file`): `file: null | { lang, pages:[{fileUrl, mimeType, kind}], publishedAt }` — requested language if live, else the other; `lang` = language actually served; `publishedAt` = Sofia-local time of the last change to that page set.

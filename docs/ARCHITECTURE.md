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
  scripts/create-admin.js, reset-password.js
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
| `PATCH /api/admin/menu/files/:id/published` | JSON `{ published }` | 200 — publishing one unpublishes all others |
| `DELETE /api/admin/menu/files/:id` | — | 204 · 409 `in_use` if it is the published file and mode is `file` |
| `PUT /api/admin/menu/mode` | JSON `{ mode }` | 200 `{ mode }` · 409 `nothing_published` if the target mode has nothing published |

## Upload security
- Accept only by **magic bytes** (PDF `%PDF-`, JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`) and require the declared type/extension to agree. SVG, HTML, etc. rejected (415).
- Size limits enforced while streaming (413). Stored as `<random 32 hex>.<ext>` in `DATA_DIR/uploads/`; original name kept only as metadata (sanitised, ≤ 200 chars).
- Served with the stored MIME type, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline; filename="<safe name>"`.
- Replaced/deleted files are removed from disk; failed uploads leave no orphan files.

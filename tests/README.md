# QA test suites (independent of the backend developer's `server/test`)

All suites start a REAL server process (`node server/src/server.js`) with a temporary `DATA_DIR`
and talk to it over HTTP or Playwright. They never import server code. The clock is moved with
`KOTA_NOW` (+ restart with the same `DATA_DIR`).

## Requirements
- Node >= 22.13, `npm ci` done. Playwright must be resolvable (`require('playwright')`, pre-installed globally in the QA environment; it is NOT a project dependency).
- Free ports 3201-3209. Do not run two suites at the same time (they reuse ports).
- Optional: `QA_PORT_MAP=3201=3209` remaps a port that a foreign process holds (the harness refuses to start when something already answers on the port).
- Optional: `QA_SCRATCH=/some/dir` (temp data dirs + `shots/` screenshots + `*-results.json`; default `$TMPDIR/kota-qa`).

## Run
```bash
export QA_SCRATCH=/tmp/kota-qa
# API: security, publication rules (events/daily menu with time travel), regular menu, persistence
node --disable-warning=ExperimentalWarning --test --test-concurrency=1 tests/api/*.test.mjs
# Playwright (each prints PASS/FAIL per check and exits non-zero on failure)
node --disable-warning=ExperimentalWarning tests/e2e/public.mjs   # public site, 3 viewports, NY timezone, XSS, time travel
node --disable-warning=ExperimentalWarning tests/e2e/admin.mjs    # admin SPA flows, error paths, 3 viewports, covering bars
node --disable-warning=ExperimentalWarning tests/e2e/a11y.mjs     # keyboard focus, contrast from computed CSS, reflow
node --disable-warning=ExperimentalWarning tests/e2e/design.mjs   # design fixes D1..D11
node --disable-warning=ExperimentalWarning tests/e2e/reflow.mjs   # header reflow 320/340/360, tab order, renderer lang override (port 3205)
node --disable-warning=ExperimentalWarning tests/e2e/i18n.mjs     # public БГ/EN switch, admin English fields, rapid-toggle race (ports 3209, 3208)
node --disable-warning=ExperimentalWarning tests/e2e/feedback1.mjs  # T-29 sticky top bar, /reservation, Location, Instagram, OG (ports 3204, 3206, 3207)
node --disable-warning=ExperimentalWarning tests/e2e/admin-dates.mjs # T-29 BG date/time pickers under en-US, Instagram settings (port 3208)
node --disable-warning=ExperimentalWarning tests/e2e/langs.mjs    # T-35 separate BG/EN content: owner scenario in the browser, admin tabs, error mapping, guard, XSS, 768 px (ports 3203, 3205)
node --disable-warning=ExperimentalWarning tests/e2e/pages.mjs    # T-43 multi-page menu: 10-file select, reorder/delete/publish, public pages, lightbox, ZIP/print downloads, a11y (ports 3201, 3202; needs unzip + pdftotext)
node --disable-warning=ExperimentalWarning tests/e2e/launch.mjs   # T-25 launch polish: fonts/CSP/404/SITE_URL/OG/favicons/privacy/map link + injection (ports 3201-3203, ~4 min)
```

## Files
- `lib/harness.mjs` - server spawn, admin creation (CLI), cookie-jar HTTP client, real PNG/JPEG/WebP/PDF fixtures, reporter.
- `lib/browser.mjs` - Playwright context with console / pageerror / failed-request / CSP-violation collectors, contrast maths.
- `api/security.test.mjs` - auth on every admin endpoint, CSRF/Origin/CORS, cookies, sessions (logout, password change, idle 12h, absolute 7d), rate limiting, uploads, traversal, headers, validation, secrets, production mode.
- `api/publication.test.mjs` - events (enable/disable/expiry/future/images) and daily menus (today/tomorrow/yesterday, Sofia midnight, DST, replace) with clock advance.
- `api/menu.test.mjs` - structured draft/publish/discard, file mode, mode switch, live-file protection, restart persistence.
- `api/i18n.test.mjs` - `?lang` resolution/fallback, En-field leakage, admin En auth/CSRF/limits, migration 002 on a pre-i18n DB (port 3209).
- `api/feedback1.test.mjs` - migration 003 matrix + 004 repair matrix, instagramUrl contract, /reservation route (port 3206).
- `api/langs.test.mjs` - T-35 (port 3204): per-language event images, daily-menu files, menu files; bidirectional fallback; /media visibility of EN files (disabled/expired/not-today/in_use); imageEn/fileEn upload validation (fake types, oversize, unknown field, no orphans); auth/CSRF on changed routes; migration 005 on a 001..004 database; T-43: menu pages replace menu files (LF1-LF3).
- `api/uploads.test.mjs` (3201), `api/cleanup.test.mjs` (3202), `api/download.test.mjs` (3203, needs `unzip` and `python3`), `api/migration006.test.mjs` (3204) - T-43: 50 MB uploads + tmp dir, D-45 daily cleanup, ZIP download, migration 006. They create up to 500 MB of files under `QA_SCRATCH` (removed when the suite ends).
- `e2e/pages.mjs` - T-43, see Run.
- `e2e/langs.mjs` - T-35, see Run.
- `e2e/feedback1.mjs`, `e2e/admin-dates.mjs` - see Run.
- `e2e/launch.mjs` - fonts self-hosted + zero third-party requests, CSP exact string, HTML/JSON 404, SITE_URL token replacement and validation, OG/Twitter meta, favicons, privacy page, footer link, map link and address injection.
- `e2e/*.mjs` - see above.

## Notes
- Fonts are self-hosted since D-29; `launch.mjs` asserts zero requests to non-localhost hosts. `lib/browser.mjs` still collects failed requests to `fonts.googleapis.com` / `fonts.gstatic.com` as environmental noise (legacy; any such request would now be a defect): failed requests to `fonts.googleapis.com` / `fonts.gstatic.com` are collected separately as environmental noise and ignored.
- BUG-1..15 are all fixed and verified (BUG-12..15 at 2dd4acb, see `docs/TESTING.md` T-32).
- `admin.mjs` dismisses persistent error toasts before pressing Save (they cover the sticky save bar at 390 px, BUG-5), as a user would.
- Production-mode checks use `NODE_ENV=production` with default `HOST`; `KOTA_NOW` is ignored there (verified).

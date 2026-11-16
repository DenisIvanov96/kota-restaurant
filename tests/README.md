# QA test suites (independent of the backend developer's `server/test`)

All suites start a REAL server process (`node server/src/server.js`) with a temporary `DATA_DIR`
and talk to it over HTTP or Playwright. They never import server code. The clock is moved with
`KOTA_NOW` (+ restart with the same `DATA_DIR`).

## Requirements
- Node >= 22.13, `npm ci` done. Playwright must be resolvable (`require('playwright')`, pre-installed globally in the QA environment; it is NOT a project dependency).
- Free ports 3201-3209. Do not run two suites at the same time (they reuse ports).
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
```

## Files
- `lib/harness.mjs` - server spawn, admin creation (CLI), cookie-jar HTTP client, real PNG/JPEG/WebP/PDF fixtures, reporter.
- `lib/browser.mjs` - Playwright context with console / pageerror / failed-request / CSP-violation collectors, contrast maths.
- `api/security.test.mjs` - auth on every admin endpoint, CSRF/Origin/CORS, cookies, sessions (logout, password change, idle 12h, absolute 7d), rate limiting, uploads, traversal, headers, validation, secrets, production mode.
- `api/publication.test.mjs` - events (enable/disable/expiry/future/images) and daily menus (today/tomorrow/yesterday, Sofia midnight, DST, replace) with clock advance.
- `api/menu.test.mjs` - structured draft/publish/discard, file mode, mode switch, live-file protection, restart persistence.
- `api/i18n.test.mjs` - `?lang` resolution/fallback, En-field leakage, admin En auth/CSRF/limits, migration 002 on a pre-i18n DB (port 3209).
- `e2e/*.mjs` - see above.

## Notes
- Google Fonts is unreachable from the sandbox: failed requests to `fonts.googleapis.com` / `fonts.gstatic.com` are collected separately as environmental noise and ignored.
- Open defects are documented by checks that FAIL on purpose (see `docs/TESTING.md`): `reflow.mjs` `RF-target44` at 360 px (BUG-11). BUG-1..10 are fixed and their checks pass.
- `admin.mjs` dismisses persistent error toasts before pressing Save (they cover the sticky save bar at 390 px, BUG-5), as a user would.
- Production-mode checks use `NODE_ENV=production` with default `HOST`; `KOTA_NOW` is ignored there (verified).

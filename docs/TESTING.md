# Testing

## Test policy
Tiers, skip-if-unchanged and non-negotiable security suites: see `CLAUDE.md` → "Testing tiers". For each suite QA records the last run as `suite | commit | result` in the table below so unchanged suites are not re-run.

| Suite | Last commit | Result |
|---|---|---|
| npm test (backend) | 0c81447 | 43/43 (server code unchanged since) |
| api security / publication / menu | 0c81447 | 42/42 · 21/21 · 17/17 (server code unchanged since) |
| api i18n (T-17) | 0c81447 | 13/13 (server code unchanged since) |
| e2e public | c376609 | 89/89 |
| e2e a11y | c376609 | 48/48 (A10b = BUG-9 now passes) |
| e2e admin | c376609 | 117/117 |
| e2e design | c376609 | 22/22 |
| e2e i18n (T-17) | c376609 | 240/240 (BUG-8, BUG-10 now pass) |
| e2e reflow (new, T-20) | c376609 | 84/88 (4 x `RF-target44` at 360 px = BUG-11) |

Server code is identical to `0c81447` through `c376609` (`git diff c77218a..c376609` touches only `public/**`); the browser suites were re-run at `c376609`.

Owned by the QA / Security Engineer. Results are recorded only for checks that were actually executed in the run named below.
How to run everything: `tests/README.md`.

## Standard viewports
390x844 (phone), 768x1024 (tablet), 1280x800 (desktop) - Playwright (Chromium, headless).

## Release regression (T-17) - 2026-11-16, branch `feature/admin-cms` @ 0c81447 (full tier: shared code changed)

Verdict: **FAIL** - 0 blocker, 1 major (BUG-9), 2 minor (BUG-8, BUG-10). BUG-5, BUG-6, BUG-7 are **VERIFIED-FIXED**.

| Suite | Result | Command |
|---|---|---|
| `npm test` | 43/43 | `npm test` |
| api security / publication / menu | 42/42, 21/21, 17/17 | `node --test --test-concurrency=1 tests/api/*.test.mjs` (93/93 incl. i18n) |
| api i18n (new) | 13/13 | `tests/api/i18n.test.mjs` (port 3209) |
| e2e public | 89/89 | `tests/e2e/public.mjs` |
| e2e a11y | 47/48 | FAIL `A10b` public index at 320 px: scrollWidth 334 > 320 (BUG-9) |
| e2e admin | 117/117 | `tests/e2e/admin.mjs` (ST locator made exact; `TOAST-OVERLAP[390]` now passes) |
| e2e design | 22/22 | `tests/e2e/design.mjs` (`D10`, `D8a` now pass) |
| e2e i18n (new) | 231/240 | `tests/e2e/i18n.mjs` (ports 3209, 3208); FAIL `RACE1..3` (BUG-8), `AEV6b`/`AMN8b` x3 viewports (BUG-10) |

Retests: BUG-5 **VERIFIED-FIXED** (`TOAST-OVERLAP` with 1 and 3 persistent error toasts at 390/768/1280: Save centre hit-testable and no toast rectangle intersects Save; at 390 the toast bottom is 696 vs Save top 720). BUG-6 **VERIFIED-FIXED** (`D10`). BUG-7 **VERIFIED-FIXED** (`D8a`).

What the new tests cover (all passed unless listed under defects):
- API (`i18n.test.mjs`): `?lang` default/bg/en on site, events, menu, daily-menu with per-field fallback (empty and whitespace-only En fall back to BG, per field); invalid lang (`fr`, empty, `EN`, `bg,en`, repeated, markup/SQL-ish) is 400 `validation` on all four endpoints and not reflected; no `*En`/snake_case En key and no En text in any BG/default public response; En fields need session (401), CSRF header and Origin (403), nothing changes on rejection; limits at boundary/+1 for every En field (titleEn 120, descriptionEn 2000 incl. CRLF normalisation, category/item nameEn 100, item descriptionEn 500, addressEn 200, openingHoursEn 500) plus type confusion (number/object/array); trimmed plain text; En-only draft edit counts as `hasUnpublishedChanges`; migration 002 on a DB built from `001_init.sql` only (with events, categories, items, an old snapshot without `*En` keys, settings): server start applies 002, data and prices intact, En columns NULL, fallback works, second start idempotent, no phantom "unpublished changes", En can be set afterwards.
- Public UI at 360/390/768/1280: switch visible, inside viewport, each button >= 44x44; BG->EN->BG on `/` and `/daily-menu` (EN content, `html lang`, title, meta description, `aria-pressed`, URL param, localStorage; EN->BG text identical to the initial BG render); no Cyrillic in text/aria-label/alt/title/meta in EN except deliberate BG fallbacks; `?lang=en` deep links; internal links keep `lang=en`; persistence across pages; URL param beats storage; invalid/malicious `?lang` ignored; localStorage that throws on access or on `setItem`; EN price/date formats; EN for PDF and image file-mode menu, daily PDF, lightbox (open/zoom/close labels, BG again after switch), no-menu-today (links keep lang), empty-menu state, load-error + retry; XSS payloads in every En field (event title/description, category, dish name/description, address, hours) render as literal text, `window.__xss` stays undefined, no injected elements, no CSP violation; no console/page/CSP/failed-request/4xx noise; no horizontal scroll (BG and EN).
- Admin UI at 390/768/1280: En round trip for event, category, dish, settings (save, public `lang=en`, reload prefilled and group open); keyboard Enter/Space opens `<details>`, Tab enters the field, visible focus ring on the summary; unsaved-changes guard on En-only edits (event, dish, settings) and no guard on an untouched form; server 400 on En fields opens the collapsed group, shows inline errors, `aria-invalid` and the error summary (events, menu, settings); preview BG|EN toggle shows English with per-field fallback (event and menu preview); admin stays Bulgarian with `?lang=en` and `kota_lang=en`; no horizontal scroll with all En groups open.

### Defects (new)
BUG-8 [VERIFIED-FIXED @ c376609, T-20] | minor | frontend-developer | Open `/?lang=bg`. Delay `GET /api/public/{events,menu,site}?lang=bg` by 1.5 s (`page.route`). Click EN, BG, EN within ~300 ms and wait 4 s. (Mirror: delay the EN responses, click EN then BG.) | Final content in the last selected language (EN). | Buttons, `html lang`, URL and static text say EN, but events, categories and dishes are Bulgarian (RACE1: `ev:["Джаз вечер",...] cats:["Салати",...]`); mirror case shows English event/dish names under a BG page (RACE2, RACE3). Cause: `public/js/index.js` `loadAll()` / `loadEvents()` / `loadMenu()` / `loadSiteInfo()` have no sequence guard, so a late response for the old language overwrites the newer render (`daily.js` has one and passes `RACE5/6`). Self-heals on the next click. | `tests/e2e/i18n.mjs` `RACE1`, `RACE2`, `RACE3` (control `RACE4` passes); `.../qa3/i18n2.log`.

BUG-9 [VERIFIED-FIXED @ c376609, T-20] | major | frontend-developer | Open `/` or `/daily-menu` (BG or EN) at 320x640 (WCAG 1.4.10 reflow). | No horizontal scroll (`a11y.mjs` `A10b` passed before T-15). | `scrollWidth` 334 (BG) / 331 (EN) > 320. The header row (logo 8-87, "Обедно меню" pill 93-206, new lang switch 212-302, hamburger 308-334) no longer fits: `.nav-toggle` ends at x=334. Fine at 340 and above (320 only). Regression from T-15. Fix: let the pill shrink/hide or wrap at <= 340 px, or reduce paddings. | `tests/e2e/a11y.mjs` `A10b` -> `334/320`; measurement `.../qa3/dbg/w320.mjs` (offender `BUTTON.nav-toggle right=334`).

BUG-10 [VERIFIED-FIXED @ c376609, T-20] | minor | frontend-developer | Admin event form (or menu "Преглед" modal): enter Bulgarian and English text, press the preview toggle "EN". | English preview looks like the English site: tag "Event", price `€4.50`, English date format. | Content is English but the public renderers still use the BG UI language (admin pins `lang=bg`): event tag "Събитие", price "4,50 €", BG date format. The owner cannot judge the real English page. | `tests/e2e/i18n.mjs` `AEV6b` -> `СъбитиеEvent 390...`, `AMN8b` -> `Soups 390Soup 3904,50 €Hot soup 390 v2` (all three viewports).

BUG-11 | minor | frontend-developer | Open `/` or `/daily-menu` (BG or EN) at exactly 360x640 (BG also 361-363). Measure `.nav-toggle`. | Header controls keep the 48x48 size set in CSS (>= 44 px target). | `.nav-toggle` is flex-shrunk to 40x48 (BG) / 43.3x48 (EN) at 360 px; 41-43 px wide at 361-363 (BG), 44.3 at 361 (EN). Every other width (320, 340-359, 364+ BG / 361+ EN) gives 48x48. Cause: from 360 px the header row is no longer wrapped (T-19 wrap applies <= 359 px) and the logo + pill + lang switch + hamburger exceed the row, so the hamburger (no `flex: none`) shrinks. Not caused by T-19, introduced by the T-15 lang switch; found while checking BUG-9 at 360. No scroll/overlap problem. Fix: `.nav-toggle { flex: none }` and let the pill shrink/wrap, or extend the wrap breakpoint to <= 363 px. | `tests/e2e/reflow.mjs` `RF-target44` x4 (`nav-toggle:40x48`); sweep `.../qa4/sweep.mjs`.

### Observations (not defects)
- The English-group inputs use `aria-label`s ("Заглавие на събитието на английски", "Име на английски: <dish>") that replace the visible label text (e.g. "Заглавие (английски)"); both are Bulgarian and unique, fine for screen readers, but the speech-input "label in name" rule (WCAG 2.5.3) is only loosely met. Not tested with real AT.
- Server 400 on En fields cannot occur from the UI (inputs have `maxlength`); the UI tests use a mocked 400 in the exact shape the real server returns (field keys verified by the API test `I10`).

## Retest T-20 - 2026-11-16, branch `feature/admin-cms` @ c376609 (targeted + shared-code regression)

Verdict: **FAIL (minor only)** - BUG-8, BUG-9, BUG-10 **VERIFIED-FIXED**; new BUG-11 (minor). 0 blocker, 0 major open.

- BUG-8: `RACE1..6` all PASS (RACE1-3 were failing; RACE4-6 controls pass). BUG-9: `a11y.mjs` `A10b` 320/320; new `tests/e2e/reflow.mjs` over `/` and `/daily-menu` x BG/EN x 320/340/360: no horizontal scroll, 5 header controls rendered inside the viewport and hit-testable, visual order = DOM order, tab order skip-link > logo > pill > БГ > EN > hamburger, nav opens without overflow, no console errors/failed requests (84/88; the 4 failures are BUG-11, 44 px width at 360). Lang switch buttons are 44x44, pill 44 px high at all widths.
- BUG-10: `AEV6b` and `AMN8b` PASS at 390/768/1280. Additionally `reflow.mjs` `RL1..RL4` call the shared renderers with an explicit `lang` on a BG page: EN gives "Event", "Saturday, 20 June 2026, 20:00", "€4.50"; BG output and default behaviour unchanged.
- Regression (shared code `render.js`, `format.js`, `i18n.js`, `style.css` changed): e2e public 89/89, admin 117/117, a11y 48/48, design 22/22, i18n 240/240 (XSS checks included: 0 failures).
- NOT RUN: `npm test`, `tests/api/*` (security, publication, menu, i18n): server code unchanged since their PASS at 0c81447 (skip-if-unchanged, CLAUDE.md tier 3; the always-run XSS rule is covered by the e2e XSS checks, which ran). Real devices, Firefox, WebKit.

### NOT RUN (T-17)
- Real devices, Firefox, WebKit, screen readers, Bulgarian/English copy review.
- Embedded PDF viewer path on desktop (headless Chromium: card path only; `FM5` only checks the page has no Cyrillic UI and no overflow).
- Migration 002 against a copy of a real production database (a hand-built pre-i18n DB from `001_init.sql` was used; admin created via the CLI after the first migrating start).
- A real server 400 on an En field through the UI (see observation).
- Deployment/HTTPS config, backups (unchanged by T-14..T-16).

Logs and screenshots: `/tmp/claude-0/-home-user-kota-restaurant/0a6b5eed-3087-545d-a04f-90c802bbd434/scratchpad/qa3/` (`*.log`, `shots/i18n-*.png`).

## Regression run 2 - T-13, 2026-11-16, branch `feature/admin-cms` (worktree on e091269: includes T-10, T-11, T-12 and the T-14 backend)

Verdict: **FAIL (3 new minor defects BUG-5..7, 0 blocker, 0 major)**. BUG-1..4 are VERIFIED-FIXED; D1..D9, D11 verified; D10 still failing, D8 partly.

| Suite | Result |
|---|---|
| `npm test` (backend dev suite; 35 at T-11, now includes T-14 tests) | 43/43 pass |
| `tests/api/*.test.mjs` (security 42, publication 21, menu 17) | 80/80 pass (after updating S8e whitelist for the documented `lang` field added by T-14) |
| `tests/e2e/public.mjs` | 89/89 pass |
| `tests/e2e/a11y.mjs` | 48/48 pass |
| `tests/e2e/admin.mjs` | 116/117 pass; 1 FAIL = `TOAST-OVERLAP[390]` (BUG-5, deliberate) |
| `tests/e2e/design.mjs` (new, D1..D11) | 20/22 pass; FAIL = `D10` (BUG-6), `D8a` (BUG-7) |

### Triage of admin.mjs steps E, X, M (reported failing after the T-10 merge)
- **E ("Запази" not found, timeout): product issue exposed by a test, filed as BUG-5.** The button exists and is enabled; Playwright's call log says `<span class="a-toast__msg">Няма връзка...</span> from <div class="a-toasts"> subtree intercepts pointer events`. Error toasts are persistent by design (role=alert, close button) and `.a-toasts` sits at `bottom: 64px+12px`, exactly where the sticky save bar is. Measured at the moment of the click: T-5 code (7a64ee8) toasts 564-612 / 620-688 / 696-768 vs Save 664-712 - the Save centre (688) happened to fall in the 8 px gap between two toasts, so the old run passed by luck. After T-10 the bar is a single row, Save is at 720-768 and its centre (744) is under the third toast. So it is neither a pure test bug nor caused by T-10 alone: any toast on a form page at 390 px covers the primary Save button until dismissed. Test now dismisses toasts like a user would, and an explicit check `TOAST-OVERLAP[390]` (one error toast, is the Save centre point hit-testable) fails and documents BUG-5.
- **X (`article:has-text("onerror")` timeout): cascade of E.** E aborted on the edit form (`#/events/1`); X then reloaded that page, so the events list never rendered. With E fixed X passes with its original assertions unchanged (payloads rendered as text, `window.__xss` undefined, no injected nodes in list, form, preview, menu editor).
- **M (strict-mode violation, "Добави ястие" matches 2 buttons): cascade of X.** X never reached its cleanup (`PUT menu/draft {categories: []}`), so M started with the XSS category and added a second one: each category legitimately has its own "Добави ястие" button. Not caused by T-10. With the cascade fixed this failure disappeared. Separately, M then failed on `Премести ястието надолу`: T-12 intentionally renamed these labels to `Премести „<name>“ надолу` (BUG-2 fix), so the selector was updated to `.a-dish` + regex (test brittleness, product correct).
- Accessibility note (observation, not filed): identical visible/accessible names "Добави ястие" on every category, and dish/category move buttons share the pattern `Премести „X“ нагоре` (a dish and a category with the same name are indistinguishable by name alone). Screen reader users get context from the surrounding group/heading; recommend `Добави ястие в „<категория>“` and `Премести ястието „X“` as a low-priority improvement.

### BUG-1..4 retest
| Bug | Check | Result |
|---|---|---|
| BUG-1 | `AV-COVER` 390/768/1280 on `#/events/new`, `#/menu`, `#/daily-menu`, `#/settings` (12 checks) | VERIFIED-FIXED (all 12 pass; e.g. events/new 390 bars `a-nav`,`a-actionbar`, last content not covered) |
| BUG-2 | `EDGE2` + new `EDGE2b` (real keystrokes via pressSequentially; label after "Моето" = `Изтрий ястието „Моето“`, after full name switch = `Налично: Моето ястие`, delete = `Изтрий ястието „Моето ястие“`; category buttons = `Изтрий категорията „Супи“`) | VERIFIED-FIXED |
| BUG-3 | `EDGE3` (one real mouse click on "Добави ястие" right after "Добави категория" adds a dish, `dishes=1`) | VERIFIED-FIXED |
| BUG-4 | `EDGE1`, `EDGE1b`, `EDGE1c` (2000 chars with 20 line breaks saved from the browser; admin API and public API values have no `\r`, length 2000, 20 `\n`) | VERIFIED-FIXED |

### Design fixes D1..D11 (tests/e2e/design.mjs, computed styles and geometry)
| ID | Check | Result |
|---|---|---|
| D1 | Expired row at 768x1024, 1024x768, 1280x800: title column 374/570/407 px, title <=2 lines, badge one line (28 px, single line), no h-scroll | VERIFIED-FIXED |
| D2 | 1280 viewport, "Телефон": frame 358 px, event card 1 column; "Компютър": frame 960 px (scrolls horizontally inside `.preview-scroll`), 2 columns; menu preview "Телефон": `column-count: auto`, categories share one x | VERIFIED-FIXED |
| D3 | `body` font-family `"Source Sans 3", system-ui, sans-serif` on public (390, 1280) and admin. Google Fonts WAS reachable in this run (`document.fonts.check` true, Source Sans 3 faces `loaded`), so the real font rendered | VERIFIED-FIXED |
| D4 | Public menu at 1280: `column-count: 2`, 5 categories, 0 split across columns (`getClientRects().length` 1, dishes share title's column) | VERIFIED-FIXED |
| D5 | Admin action bar at 390: 2 buttons on one row (same top), bar 73 px tall (9% of screen) | VERIFIED-FIXED |
| D6 | Logo link height: admin 44 px, public 50.1 px (390 and 1280) | VERIFIED-FIXED |
| D7 | `.btn .en` computed font-size 12 px (1 element on index, 390 and 1280) | VERIFIED-FIXED |
| D8 | Public header focus rings (logo, nav pill, nav toggle) fully inside viewport/no clipping ancestor; admin logo ring inside bar; admin "Изход" ring top = -1 px (1 px of the 3 px ring is off-screen) | **STILL-FAILING (partly)** -> BUG-7 |
| D9 | Dashboard active titles: `ul.a-titles`, `list-style: disc`, padding-left 20 px, 2 `li`, no `<strong>` | VERIFIED-FIXED |
| D10 | Spacing above "Включено" | **STILL-FAILING** -> BUG-6 (gap 0 px, computed `margin-bottom: 0px` on `.a-tznote`) |
| D11 | `.state-title` colour on /daily-menu with no menu = `rgb(241, 230, 210)` = `var(--text)` | VERIFIED-FIXED |

Screenshots: `/tmp/claude-0/-home-user-kota-restaurant/0a6b5eed-3087-545d-a04f-90c802bbd434/scratchpad/qa2/shots/` (`design-*.png`). Logs: `.../qa2/admin4.log`, `design.log`, `public.2.log`, `a11y.2.log`.

### NOT RUN in regression run 2
- Everything listed under "NOT RUN / could not be tested" below still applies (real devices, Firefox/WebKit, screen readers, deployment).
- The БГ/EN language switch (T-14 backend, frontend task) was not tested; only the existing suites were re-run against the T-14 backend (the public `lang` field was added to the whitelist check).
- D3 was verified with the real web font only because Google Fonts was reachable this time; the fallback behaviour was not re-measured.
- BUG-5 was only measured at 390 px with injected/forced toasts; toasts at 768/1280 are bottom-right and do not overlap the sticky bar (not measured).

## Results of run 1 - T-5 independent QA, 2026-11-16, branch `feature/admin-cms`

Verdict: **FAIL (4 minor defects, 0 blocker, 0 major)** - every required scenario was executed; all server-side security and publication rules passed. The only failing checks are 4 minor admin-UI defects (BUG-1..4).

| Suite | Result |
|---|---|
| Backend dev suite `npm test` (re-run) | 33/33 pass |
| Clean copy of tracked files: `npm ci` + `npm test` (no build step exists) | 33/33 pass, `npm ci` reports 0 vulnerabilities |
| `tests/api/security.test.mjs` | 42/42 pass |
| `tests/api/publication.test.mjs` | 21/21 pass |
| `tests/api/menu.test.mjs` | 17/17 pass |
| `tests/e2e/public.mjs` (3 viewports, Sofia + New York browser tz, browser clock forced to 2030) | 89/89 pass |
| `tests/e2e/admin.mjs` | 109/113 pass; 4 FAIL = BUG-1..4 |
| `tests/e2e/a11y.mjs` | 48/48 pass |

Screenshots: `/tmp/claude-0/-home-user-kota-restaurant/0a6b5eed-3087-545d-a04f-90c802bbd434/scratchpad/qa/shots/` (50 files, e.g. `admin-bottom_events_new-390.png`, `public-index-390.png`, `admin-menu-409-390.png`). Raw results: `.../qa/public-e2e-results.json`, `.../qa/admin-e2e-results.json`.

### Scenario table (ID = check id in the test files)

**Events**
| Scenario | Result | Evidence |
|---|---|---|
| Admin can enable (create ON, re-enable) | PASS | api E1/E3; e2e EV3, EV4 |
| Admin can disable; disappears from public API + rendered page + /media right after save | PASS | api E2; e2e EV5, public U2 |
| Keyboard ON/OFF (Space, Enter) | PASS | e2e EV6, EV6b |
| Toggle rollback on 500 / network failure | PASS | e2e EV7, EV7b (page.route) |
| Expired event disappears automatically (boundary 11:59:59Z visible, 12:00:00Z hidden, no admin action) | PASS | api E6; public V2 |
| Expired events stay listed in admin (status "expired", filter "Изтекли") | PASS | api E6; e2e EV11, EV12 |
| Future (startsAt) not shown early, appears exactly at start; winter UTC+2 correct | PASS | api E7, E8; public V1/V3 |
| Image + description update shows publicly; old image URL 404; file removed from disk; removeImage | PASS | api E4; public U3, U4; e2e EV8 |
| Delete requires confirmation; Esc/Отказ keep it; confirm deletes | PASS | e2e EV13-EV16 |
| Server 400 `fields` surfaced next to fields + summary | PASS | e2e EV9 (intercepted 400) |

**Daily menu**
| Scenario | Result | Evidence |
|---|---|---|
| Upload pdf, jpg, png, webp (API and UI wizard) | PASS | api D1; e2e DM1 x4 |
| Assigned date displays correctly on /daily-menu ("Понеделник, 15 юни 2026") | PASS | public D1 at 3 viewports |
| Today's published menu visible; unpublished today hidden | PASS | api D2; public D2; e2e DM7 |
| Tomorrow not shown early; appears at Sofia midnight (21:00Z summer, 22:00Z winter, DST day) | PASS | api D3, D5; public T1 (Sofia and New York browsers, browser clock 2030) |
| Yesterday not presented as today; "no menu today" message | PASS | api D4; public T3, D2 |
| Replace file: public updates, old /media URL 404, old file deleted, 409 without `replace` | PASS | api D6; public D4; e2e DM5 |
| /media for unpublished / future / past menus -> 404 | PASS | api D2, D3, D4, D9, D10 |
| Delete live menu asks confirmation | PASS | e2e DM6, DM6b |
| Server 415 for fake.pdf (HTML content) surfaced in wizard | PASS | e2e DM9 |

**Regular menu**
| Scenario | Result | Evidence |
|---|---|---|
| Edit dish names, prices (comma decimals), add/remove dishes and categories | PASS | api M3, M4; e2e MN1, MN4, MN6 |
| Draft never public before publish; public after publish | PASS | api M1-M3; e2e MN2-MN4 |
| Discard restores published version | PASS | api M5; e2e MN5 |
| Upload menu file, publish file, only one published file | PASS | api M7, M8; e2e MN12 |
| Mode switch structured <-> file, only one version public, /media of file only in file mode | PASS | api M9, M12; public F0-F2; e2e MN13, MN15 |
| Delete / unpublish of live file blocked (409 in_use) and shown in UI | PASS | api M10; e2e MN14 |
| 409 nothing_published message in mode switch (real server) | PASS | api M0; e2e MN11 |
| Keyboard reorder up/down; first-up / last-down disabled | PASS | e2e MN7, MN7b |
| Server 400 field paths (`categories[0].items[0].priceCents`) mapped to inputs | PASS | e2e MN9 (intercepted 400) |
| Unsaved-changes guard | PASS | e2e MN10 |

**Security**
| Scenario | Result | Evidence |
|---|---|---|
| Unauthenticated: every one of 29 `/api/admin/*` endpoints rejected (401; non-GET without CSRF header 401/403) | PASS | api S1a, S1b |
| Customers cannot modify content with CSRF header but no session | PASS | api S1d, S1e |
| Forged / garbage / oversized session cookies rejected on every endpoint | PASS | api S1c (8 cookies x 29 endpoints) |
| Cross-origin / `null` / garbage Origin rejected; no CORS headers | PASS | api S2a-S2e |
| Invalid uploads (HTML as .pdf/.png/.html, SVG, PNG as .pdf, PDF as .png, GIF+script, PHP, empty, wrong MIME, double ext) -> 415/400, no orphan files | PASS | api S5a-S5c, S5h |
| Oversize (event 5 MB, daily 10 MB, menu 15 MB) -> 413; exact 5 MB accepted | PASS | api S5d, S5e |
| Polyglot (valid PNG + trailing script) served only as image/png + nosniff + CSP | PASS | api S5f |
| Hostile filenames sanitised, stored names random hex | PASS | api S5g |
| Path traversal on /media, /api/admin/media, static (encoded, double-encoded, backslash, NUL) | PASS | api S6a, S6b |
| /server /data /.env /package.json /docs /ops /.git /tests /node_modules not served (dev and production mode) | PASS | api S6b, S11b |
| Stored XSS in event title/description, dish and category names: text only, no execution, public + admin + previews | PASS | public X1-X3 (3 viewports); admin X4-X6 |
| Login rate limiting: 5/IP (XFF spoof ignored without TRUST_PROXY), 10/username across IPs, 429 + Retry-After, locked even with correct password | PASS | api S10a, S10b |
| Logout invalidates session server-side (also via UI) | PASS | api S4a; e2e L4b |
| Password change revokes other sessions, old password dead | PASS | api S4b; e2e ST3/ST4 |
| Idle timeout 12 h and absolute lifetime 7 d (clock advance) | PASS | api S12a, S12b |
| Username enumeration: identical response; malformed login bodies 400 | PASS | api S4c |
| No registration endpoint | PASS | api S4d |
| Input validation (events, draft menu, settings, JSON size/syntax, `__proto__`, SQL-like text) | PASS | api S8a-S8f |
| Security headers + CSP on HTML, API, media, static, 404; no inline script/handlers/styles; no X-Powered-By | PASS | api S7, S7b (301 `/admin` redirect carries `default-src 'none'`, harmless) |
| Cookies HttpOnly + SameSite=Strict (+ Secure in production, KOTA_NOW ignored, loopback bind) | PASS | api S3, S11a; e2e L3 |
| No secrets in repo (`git grep -nIiE "api[_-]?key\|secret\|password\|token"`: all hits triaged - identifiers, docs, placeholders, `.env.example` comment; no credentials, no tracked .env/db) | PASS | api S9 + manual triage |
| 2FA: enable with QA-computed TOTP, wrong-code inline error not treated as logout, login step 2, disable | PASS | e2e ST5-ST9 |
| Session-expired overlay on 401 mid-session and re-login in place | PASS | e2e SE2, SE3 |

**Compatibility**
| Scenario | Result | Evidence |
|---|---|---|
| Public + admin at 390/768/1280: no console errors, no CSP violations, no failed requests, no horizontal scroll | PASS | public R1/R2, R1d/R2d; admin AV-LOG, AV (all 6 routes x 3 viewports) |
| Sticky header does not cover anchor targets / category chips (header is `position: relative`, chips sticky at 390) | PASS | public H1-H3 |
| Admin bottom tab bar does not cover last content on menu, daily menu, settings (390/768/1280) | PASS | admin AV-COVER |
| Admin sticky save bar + tab bar do not cover last content on event form at 390 | **FAIL** | BUG-1 |
| Public content updates without restart/redeploy | PASS | api P2; public U1-U5 |
| Data persists after stop/start with same DATA_DIR, sessions survive, migrations idempotent | PASS | api P1, P3 |
| `npm ci` + `npm test` | PASS | see table above |
| Browser time zone/clock independence (New York, clock 2030) | PASS | public T1 x2 |

**Accessibility (sample)**
| Scenario | Result | Evidence |
|---|---|---|
| One h1 per page, lang=bg, no skipped heading levels, alt on images, skip link | PASS | public R3, A2, A3, A5; admin AV (h1 count per route) |
| Admin inputs labelled | PASS | admin AV (unlabelled = 0 on 6 routes x 3 viewports) |
| Dialogs: Esc closes, safe button focused, focus returns to trigger, Tab never reaches background controls (native modal `<dialog>`) | PASS | e2e EV13-EV14, A-DLG1/2; a11y A9 |
| Keyboard: event ON/OFF switch, menu up/down buttons, nav toggle | PASS | e2e EV6, MN7; a11y A4 |
| Visible focus on every tab stop (public index, 5 admin routes) | PASS | a11y A1, A6 |
| Contrast computed from rendered CSS: 30 text/background pairs (public, daily, admin), lowest 4.94:1 (`.tag-unavail` 12px) - all >= AA | PASS | a11y K[...] |
| Controls >= 40 px; reflow at 320 px without horizontal scroll | PASS | a11y A7, A10 |
| Accessible names stay correct while editing (dish delete / availability) | **FAIL** | BUG-2 |

## Defects

BUG-1 | minor | frontend-developer | Open `/admin/#/events/new` at 390x844, scroll to the very bottom. | The last block of the page (preview card: frame bottom, help text "Дали е видимо сега зависи...") is reachable above the sticky save bar and the bottom tab bar. | At maximum scroll (scrollY 1335 + 844 = scrollHeight 2179) the sticky `.a-actionbar` (top 651) covers the preview frame bottom (664) and the help text (bottom 715); about 80 px of content cannot be scrolled into view. 768/1280 fine. | `tests/e2e/admin.mjs` check `AV-COVER[390] #/events/new` -> `{"barTop":651,"lastBottom":715}`; screenshot `.../qa/shots/admin-bottom_events_new-390.png`.

BUG-2 | minor | frontend-developer | `#/menu`: add category, add dish, type name "Моето ястие". Inspect delete button and availability switch. | `aria-label` reflects the current name ("Изтрий ястието Моето ястие", "Налично: Моето ястие"). | Labels are computed at render time and never updated: delete is "Изтрий ястието" (empty name), switch is "Налично: ястие", so every new dish has the same ambiguous accessible name for screen reader users until the page is reloaded. | `tests/e2e/admin.mjs` `EDGE2` -> `delete="Изтрий ястието" switch="Налично: ястие"`.

BUG-3 | minor | frontend-developer | `#/menu` with empty draft: click "Добави категория" (focus goes to the empty category-name field), then click "Добави ястие" once with a real mouse. | One click adds a dish. | The name field's blur validation inserts an error message that pushes the button down 26 px between mouse-down and mouse-up (button y 590 -> 616), so the click is swallowed; no dish is added, no feedback. Needs a second click. | `tests/e2e/admin.mjs` `EDGE3` -> `dishes=0`; measured y before/after mousedown = 590/616.

BUG-4 | minor | backend-developer (or frontend-developer) | `#/events/new`: title "x", description of exactly 2000 characters containing 20 line breaks (counter shows 2000/2000), Save. | Saved (limit is 2000, UI allows 2000). | Browsers encode newlines as CRLF in multipart, the server counts the CR too (2020 chars) and answers 400 "Описанието е до 2000 символа". Also, stored descriptions contain `\r\n` (e.g. `"Жива музика\r\nВход свободен"`). Fix: normalise `\r\n` to `\n` before validating/storing. | `tests/e2e/admin.mjs` `EDGE1`; public API output in the failed `EV3` first run showed `\r\n`.

BUG-5 | minor | frontend-developer | At 390x844 open `#/events/<id>` (edit), trigger an error toast (e.g. switch toggle fails, or a failed save), then try to tap "Запази". | The persistent error toast must not cover the sticky save bar, or the primary action must remain tappable (toasts above the bar; bar offset added to `.a-toasts` bottom when `.a-actionbar` is present). | `.a-toasts` (`bottom: 64px + 12px`, z-index 60) overlays the sticky `.a-actionbar` (bottom 64px, z-index 25): Save centre point is hit by the toast (`elementFromPoint` = `.a-toast`); Playwright: "`.a-toast__msg` from `.a-toasts` subtree intercepts pointer events", 30 s timeout. The user must first press the toast's close button. Present since T-4 (T-5 run only passed because the click point fell into the 8 px gap between 3 stacked toasts). | `tests/e2e/admin.mjs` `TOAST-OVERLAP[390]` -> `{"hit":"toast","top":720}`; `.../qa2/dbg/fail-E.png`. | **VERIFIED-FIXED (T-17, 0c81447)**

BUG-6 | minor | frontend-developer | Open `/admin/#/events/new` at 1280 (any width), look at the space between "Всички часове са по българско време." and the "Включено" label. | At least 16 px (D10 fix: `.a-tznote { margin-bottom: 16px }`). | Computed `margin-bottom: 0px`, measured gap 0 px: the later rule `.a-help { margin: 4px 0 0 }` (admin.css line 95, same specificity) overrides `.a-tznote` (line 84). Fix: raise specificity (`.a-help.a-tznote`) or move the rule below `.a-help`. | `tests/e2e/design.mjs` `D10` -> `{"gap":0,"tznoteMarginBottom":"0px"}`. | **VERIFIED-FIXED (T-17, 0c81447)**

BUG-7 | minor (cosmetic) | frontend-developer | Open `/admin/` at 390x844, focus "Изход" in the top bar with the keyboard (Tab). | Whole focus ring visible inside the 56 px bar (D8). | Ring (3 px outline + 2 px offset) spans y -1..57 on a 56 px sticky bar: the top 1 px is outside the viewport; logo ring is fine (1..55). Fix: smaller outline-offset or button height <= 50 px inside the 56 px bar. | `tests/e2e/design.mjs` `D8a` -> `.a-logout-top ringTop:-1, ringBottom:57, barTop:0, barBottom:56`; screenshot `.../qa2/shots/design-D8-admin-topbar.png`. | **VERIFIED-FIXED (T-17, 0c81447)**

## Observations (not defects)
- `GET /admin` returns 301 to `/admin/` with CSP `default-src 'none'` (Express static default); harmless.
- The admin boot probe `GET /api/admin/me` (401 when logged out) and wrong-password `POST /login` (401) show as "Failed to load resource" lines in the browser console. Expected behaviour, filtered in the tests.
- Login rate-limit counters are in memory: a server restart resets them (acceptable for one process; note for ops). With `TRUST_PROXY=1` the first `X-Forwarded-For` value is trusted, so the proxy must overwrite that header (Caddy does).
- A valid PNG with trailing script bytes is accepted by design (magic-byte validation) but is served as `image/png` + `nosniff` + CSP, so it cannot execute (api S5f).
- Chromium's Tab from the last dialog button goes to browser chrome and back (native modal behaviour), the background page is never focusable while a dialog is open.
- Descriptions are trimmed by the server (leading/trailing whitespace and newlines are dropped).

## NOT RUN / could not be tested
- Real phones/tablets (touch, iOS Safari, Android Chrome), Firefox and WebKit: only headless Chromium was used.
- PDF `<object>` embed on desktop: headless Chromium has no PDF viewer (`navigator.pdfViewerEnabled` false), so only the fallback card + "Open"/"Download" links were verified (public F2, T2).
- Real web fonts: in run 1 Google Fonts was unreachable (fallback fonts measured); in run 2 it was reachable. Re-measure if the environment differs.
- Screen reader behaviour (NVDA/VoiceOver) and Bulgarian copy review; only computed names/roles/focus were checked.
- Rate-limit window expiry after 15 minutes (clock frozen via `KOTA_NOW`; restart resets the in-memory limiter).
- HTTPS / Caddy / systemd / Docker deployment (`docs/DEPLOYMENT.md`), backup and restore scripts, `admin:reset-password` and `admin:disable-2fa` CLIs, reverse-proxy behaviour beyond `X-Forwarded-For` rate limiting.
- Upload progress bar / cancel button in the UI, admin lightbox, drag/drop; very large menus (200 items x 50 categories) in the browser.
- DST gap/overlap handling through the UI (covered only by the backend developer's own unit tests and API checks of winter/summer offsets and the 2026-10-25 day boundary).
- Real network latency, concurrent admins editing the same draft (last write wins; not tested).

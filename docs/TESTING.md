# Testing

## Test policy
Tiers, skip-if-unchanged and non-negotiable security suites: see `CLAUDE.md` → "Testing tiers". For each suite QA records the last run as `suite | commit | result` in the table below so unchanged suites are not re-run.

| Suite | Last commit | Result |
|---|---|---|
| **T-62 (D-62 limits 15 pages / 50 gallery items + daily second page, D-63 home slider; D-54 narrow scope, only the rows below were run)** | 0babfb7 (test edits in WIP commit 8b26993) | |
| api uploads / gallery / security / cleanup / feedback1 / i18n / langs / migration006 / publication / menu / download (limits 10->15, 25->50, migration lists to 009; DL12 now 10x50 MB + 5 small = 15 pages) | 0babfb7 | PASS 14/14 · 17/17 · 43/43 · 6/6 · 20/20 · 13/13 · 28/28 · 3/3 · 21/21 · 17/17 · 12/12 |
| api daily2 (new, port 3207: 4-file POST, validation, /media 404/404/200 on all 4 files, public `files`, PUT end-state rules, spoof/oversize second files, auth/CSRF, name sanitising, cleanup of 4 files + orphan sweep) | 0babfb7 | PASS 11/11 |
| npm test (PM-run, re-run by QA) | 0babfb7 | PASS 128/128 |
| e2e slider (new, port 3202: 1/2/15 real pages, arrows, keyboard, swipe, lightbox at current page, eager loading, equal home height 2 vs 15 at 390/768/1280, admin 15/15 and 50/50 limits) | 0babfb7 | PASS 53/53 |
| e2e daily2 (new, port 3201: admin wizard/edit with second pages, "2 стр.", XSS; public /daily-menu 1 image / 2 images / image+PDF / PDF+image, BG+EN, 390+1280, lightbox counter) | 0babfb7 | **99/105 - FAIL: AD2b (BUG-26), AD3h0 (BUG-24), PUB4b x4 (BUG-25)** |
| e2e pages (slider rewrite of P1/L1/AX/F1/D1/V1, limit 15 in A1a/A1d/A1e) / public (F0/F1/F2) / gallery (25->50) / admin (MN12 "1 от 15") | 0babfb7 | PASS 81/81 · 90/90 · 367/367 · 118/118 |
| e2e i18n (FM1..FM5 selectors to the slider) | 0babfb7 | 209/216: the 7 failures (EM1, AST0+AE x3) are **identical at 74057b4** (stale selectors / company line in the EN "no Cyrillic" check, not caused by T-60/T-61) |
| e2e langs (C-EDIT/ERR-3/ERR-413c-415f use per-language dialog inputs, FL1-FL3 "от 15") | 0babfb7 | 140/153 on the real tree: FAIL ED1+C-EDIT (BUG-24) and its follow-ups ERR-3/3b/413c/413d/400e/415f/413g; **155/159 on a scratch copy with the BUG-24 wording patched** = same 4 failures as baseline 74057b4 (E-GUARD, G-XSS, R-TAB[768], H-768: pre-existing, tab selectors match 2 tab groups since the About card) |
| **T-59 (D-59 map pin, D-60 About photo, D-61 VAT / 14-day logs / SuperHosting.BG; D-54 narrow scope, only the rows below were run)** | c312cc5 | |
| e2e plan (CO1/PV1/PV2 updated to D-61 text; PV2 now asserts no bracket placeholders) | c312cc5 | PASS 66/66 |
| e2e about-photo (new, port 3209) | c312cc5 | PASS 30/30 |
| e2e feedback1 (run in full: map/FRESH3 lines touched by 48cec09) | c312cc5 | PASS 781/781 |
| e2e launch E3b (updated to "no placeholders", **edit not executed**; `node --check` only) | - | NOT RUN (outside D-54 scope; needed before go-live) |
| ops/Caddyfile `roll_keep_for 336h` (`caddy validate`) | - | NOT RUN (`caddy` not installed) |
| **T-57 (D-57 real floor plan 102-115 + company details; D-54 narrow scope, only the rows below were run)** | 3ed8ced | |
| e2e plan (new `plan.mjs`, port 3208: 14 numbers inside own rects/no round/no windows, entrance on left wall between 110 and 113, bar below 114, legend 4, a11y list 14, caption, company line on home BG/EN incl. 3-line wrap at 390, privacy controller line + no `[Юридическо лице` placeholder, other placeholders unchanged; BG/EN x 390/768/1280; no h-scroll/console/CSP) | 3ed8ced | 66/66 |
| e2e feedback1 (RES4/5/6/7, RESN1, FRESH5 updated to 14 tables/no round/no windows/4-item legend/new caption; new RES5b; IG7f key list + `email` (stale since T-52)) | 3ed8ced | **775/781: FAIL RES5b x6** (BUG-23, table 104 list says "long", drawn square) |
| e2e launch (E3c allows the company name in the EN privacy page; **edit not executed**) and e2e i18n (ALLOWED_BG + company name for the EN home; **edit not executed**) | - | NOT RUN (outside the D-54 scope; one run needed before go-live) |
| **T-54 follow-up (D-56: contacts in one row at >= 768, EN "Daily Specials"; only the rows below were run)** | a87cf08 | |
| e2e email (+10: B7 one row phone/email/social at 768/1280 BG/EN, C3 long email wraps in its cell at 390/768/1280) | a87cf08 | 109/109 |
| e2e contact (SOC4 updated to D-56: three items in one row, in order) | a87cf08 | 85/85 |
| e2e i18n ("Daily Special" -> "Daily Specials" in RT1/DM1/PERS1/URL2/LS4; launch.mjs 404 label also updated, **launch not run**) | a87cf08 | 210/216: only AST0+AE x3 viewports fail, **identical 6 failures at 36b1eac (before D-55)**: pre-existing stale selector (`getByRole('tab', {name: /^English/})` count != 1 on the admin settings page), not caused by D-55/D-56 |
| **T-54 (D-54 narrow scope for D-55 contact email; only the rows below were run, everything else deferred to the pre-go-live regression)** | 24c46d9 | |
| api security (S8c extended with 7 invalid `contactEmail` cases + `fields.contactEmail`; S8e `email` key) | 24c46d9 | 43/43 |
| api feedback1 / i18n / langs / migration006 (migration lists now 001..008, public site key list + `email`) | 24c46d9 | 20/20 · 13/13 · 28/28 · 3/3 |
| e2e email (new: seed, order, privacy, long address 390/768/1280, admin edit/invalid/clear/restart, XSS API + DB injection, focus, contrast) | 24c46d9 | 99/99 |
| e2e contact (expectations updated for the email item: order, 2-column layout, Tab order) | 24c46d9 | 85/85 (62/85 before the update, all 23 failures = order/layout/Tab expectations of the old phone,social design) |
| e2e launch (E6d/E6e now clear `contactEmail`; **edit not executed**) | - | NOT RUN (4 min suite, outside the D-54 scope; needs one run before go-live) |
| **T-51 (D-54 narrow retest of BUG-19..22; only the rows below were run)** | 85a7d38 | |
| api gallery (GA11b / BUG-20) | 85a7d38 | 17/17 |
| api security | 85a7d38 | 43/43 |
| e2e bug19 (BUG-19 same-page + cross-page, BUG-21 direct /#section incl. /#about) | 85a7d38 | 194/194 |
| e2e feedback1 (LOC3) | 85a7d38 | 775/775 |
| e2e bug22 (new: BUG-22 768-959 header fit BG/EN +/- event, 960/1024/1280 unchanged vs cdcd451, same-page smooth scroll, admin "Виж на сайта") | 85a7d38 | 66/66 |
| **T-50 (D-54 narrow scope: only the suites below were run; all others are deferred, see the T-50 section)** | cdcd451 | |
| api gallery (new, `gallery.test.mjs`: D-51..D-53 API) | cdcd451 | **16/17 - FAIL GA11b (BUG-20)** |
| api security (S1a now 41 endpoints incl. 5 gallery routes) | cdcd451 | 43/43 |
| api feedback1 / i18n / langs / migration006 (007 expectations updated) | cdcd451 | 20/20 · 13/13 · 28/28 · 3/3 |
| npm test (backend) | cdcd451 | 113/113 |
| e2e gallery (new: admin, About, XSS, public grid, lightbox, empty/error, nav on 6 pages, a11y; 390/768/1280) | cdcd451 | 367/367 |
| e2e pages (existing menu lightbox + daily image after lightbox.js change) | cdcd451 | 81/81 |
| e2e bug19 (new: same-page nav, cross-page nav, direct /#section) | cdcd451 | **158/194 - FAIL, 36 checks (BUG-19 reopened, BUG-21)** |
| e2e feedback1 (IG7f updated) | cdcd451 | **772/775 - FAIL LOC3[bg 390/768/1280] (BUG-19 reopened)** |
| e2e contact | cdcd451 | 85/85 (ran before the scope change, in scope) |
| npm test (backend, `server/test/*.test.js`) | e521e80 | 93/93 (at 25bcdfb with T-47: 113/113) |
| api security (T-46: +3 endpoint entries for the admin ZIP, S1a now 36 endpoints) | e521e80 | 43/43 |
| api publication / menu | e521e80 | 21/21 · 17/17 |
| api i18n / feedback1 / langs | e521e80 | 13/13 · 20/20 · 28/28 |
| api uploads / cleanup / migration006 | e521e80 | 14/14 · 6/6 · 3/3 |
| api download (T-46, rewritten for D-49: admin-only ZIP, 401/404/400, no fallback, public route 404, streaming, 10 x 50 MB) | e521e80 | 12/12 |
| api total (`tests/api/*.test.mjs`, final test files) | e521e80 | 177/177 (at 25bcdfb with T-47: 166/177, all 11 failures are T-47 expectation changes, see T-46 section) |
| e2e public | e521e80 | 90/90 (F1b/F2 rewritten for D-49) |
| e2e admin | e521e80 | 118/118 |
| e2e langs | e521e80 | 185/185 |
| e2e i18n | e521e80 | 240/240 (FM1-FM3, DP1 rewritten for D-49) |
| e2e pages (rewritten for D-49: no public download, admin ZIP/per-page downloads, 0-page absence, daily image/PDF, lightbox) | e521e80 | 81/81 |
| e2e contact (T-46, new: D-50 Social media item beside phone) | e521e80 | 85/85 |
| e2e a11y | e521e80 | 48/48 |
| e2e design | e521e80 | 22/22 |
| e2e reflow | e521e80 | 88/88 |
| e2e launch | e521e80 | 916/916 |
| e2e feedback1 | e521e80 | **774/775 - FAIL LOC3[bg 390] (BUG-19)**; 775/775 at 3b33a4d |
| e2e admin-dates | e521e80 | 100/100 |
| width sweep 320-420 px (T-21/T-22, ad hoc, not in repo) | 2ef9c11 | 404 combos, 0 failures (NOT re-run) |

All suites ran sequentially at e521e80 in T-46 (full tier; see the T-46 section). T-43 baseline: all suites ran sequentially at 8b5c0c6 (full tier: schema 006, uploads, shared code `render.js`/`i18n.js`/`components.css`/`store.js`/`files.js` changed). a11y, design, reflow, feedback1, admin-dates and launch were run unmodified; the other suites were updated for intended changes first (see the T-43 section).

Historical note: server code was identical to `0c81447` through `c376609` (`git diff c77218a..c376609` touches only `public/**`); the browser suites were re-run at `c376609`. `5884ce2` changes only `public/css/style.css` (header `flex: none` + wrap breakpoint 379 px); public, a11y and reflow were re-run there; admin, design and i18n were NOT re-run at `5884ce2` (their pages are unaffected by the two header rules, last result at `c376609`).

Owned by the QA / Security Engineer. Results are recorded only for checks that were actually executed in the run named below.
How to run everything: `tests/README.md`.

## Limits 15 / 50, daily second page (D-62), home slider (D-63) - T-62, 2026-11-18, product code `0babfb7` (narrow tier, D-54)

Ports 3201-3209 had no listener before the run (harness refuses to start otherwise). Two server processes of my own scratch runs (a crashed debug script and a crashed slider run) were found by the same guard and killed by PID after checking `cwd`/`DATA_DIR` were in the scratchpad; none left. Commands: `node --test tests/api/<suite>.test.mjs` per suite, `node tests/e2e/<suite>.mjs`, `npm test`.

- **Expectations updated** (each checked against the spec): migration lists to `009_daily_second_page.sql` and COUNT 9 (langs, i18n, migration006, feedback1); uploads UP3/UP8 (15 accepted, 16th 409; 20 simultaneous -> exactly 15 x 201, positions 1..15, 11 left after 4 deletes), gallery `max: 50` and GA6/GA7/GA9 (50 accepted, 51st 409 `gallery_full`, race at 49), download DL12 (15 pages; 16th blocked), e2e gallery "N / 50" and the mocked 409 text "(50)", e2e pages admin "N от 15"/16th blocked, public slider walk-through instead of the page list, e2e public/i18n/langs single-card + slider selectors, langs edit-dialog inputs addressed per language (the dialog now has BG, BG 2nd, EN, EN 2nd uploaders). No unrelated assertion weakened.
- **New API tests** `tests/api/daily2.test.mjs` DS1..DS11: 15/16 and 50/51 stay in uploads UP3/UP8 and gallery GA6 (above); second-file media (unpublished today 404 x4, published tomorrow 404 x4, published today 200 x4, admin media 200, next Sofia day 404, restart back 200); PUT end-state rules (EN first removed while EN second stays -> 400 `fields.fileEn2`; EN-only menu remove first -> 400 `fields.fileEn`; second without first -> 400 `file2`/`fileEn2`; both removed together ok; upload wins over remove flag; replace deletes old file; non-boolean flag ignored; rejected PUT deletes nothing); spoofed (HTML/SVG/exe/GIF/empty/truncated PDF) -> 415 with `fields.<field>`, 50 MB + 1 -> 413 `file_too_large` with `fields.file2|fileEn2` (POST and PUT, valid sibling files not stored, tmp empty), exactly 50 MB accepted; unknown field name 400; 401/403 (CSRF, foreign origin) on the new fields and on admin media of a second page; cleanup of a past menu removes all 4 files from disk and DB; orphan sweep keeps second files of live menus and removes a real orphan.
- **New e2e** `tests/e2e/slider.mjs` and `tests/e2e/daily2.mjs` (see the table). Observations: the server replaces `< > " : * ? |` in original file names, so an XSS name cannot survive as markup; the entity-looking name `&lt;img ...&gt;'x.png` is stored verbatim and the admin renders it as literal text (AD4d); the public daily page does not print original names. For image + PDF the lightbox gallery holds one image, so it opens without prev/next and without "Страница N от M"; the caption above the image carries the real page number (observation, matches the spec's "PDF gets its own link").
- **Eager loading** measured on the network: 15 pages -> exactly pages 1+2 requested after load, 3 after one "next", all 15 only after visiting all. Home height identical for 2 vs 15 pages at 390 (2527 px document), 768 (3519), 1280 (3105); frame 254x339 / 536x715 / 480x640 on every page, ratio 0.749 at 390.
- **Not run** (outside the D-54 scope): `launch`, `feedback1`, `contact`, `email`, `plan`, `a11y`, `design`, `reflow`, `bug19`, `bug22`, `about-photo`, `api/langs` was run, but the langs **e2e** G-XSS check does not execute (pre-existing strict-mode selector failure, identical at 74057b4), so XSS evidence for this change comes from daily2 AD4, gallery e2e (367) and public e2e (90). Mobile Safari/real touch devices not available: swipe is synthetic touch events.

## D-59 / D-60 / D-61 text and About photo - T-59, 2026-11-18, HEAD `c312cc5` (narrow tier, D-54)

Ports 3201-3209 checked free before (no `ss`; harness start would have failed on EADDRINUSE), none left after. Run: `node tests/e2e/plan.mjs`, `node tests/e2e/about-photo.mjs`, `node tests/e2e/feedback1.mjs`.

- `plan.mjs`: CO1/PV1 now expect the exact BG "ИН по ДДС: BG207469415" / EN "VAT No.: BG207469415" lines; PV2 asserts zero `[...]` placeholders on `/privacy` plus "Пазят се 14 дни"/"kept for 14 days" and "SuperHosting.BG (България)"/"(Bulgaria)". The `privacy.contact.none` fallback is not expected (the seed has phone and address). 66/66.
- New `tests/e2e/about-photo.mjs` (BG/EN x 390/768/1280): company line visible in `.about-text` with VAT, no overlap with the photo (390/768: stacked; 1280: two columns), no horizontal scroll, `interior-*.webp` loaded (naturalWidth > 0), non-empty alt in the page language, one `a.map-link` = `https://maps.app.goo.gl/EQuhsMqma6TcmRqs9` with `target=_blank` and `rel="noopener noreferrer"`, no console/failed request/CSP errors. Screenshots in `$QA_SCRATCH/shots/about-photo-*.png`. 30/30.
- `launch.mjs` E3b updated to the D-61 text (no placeholders, 14 days, SuperHosting.BG, VAT) but **not executed** (4 min suite outside the D-54 scope; syntax checked with `node --check` only). `i18n.mjs` ALLOWED_BG needs no change (substring "Амора Джелато ЕООД" still matches the company line). The E6d/E6e fallback checks in launch.mjs still match `privacy.contact.none`.
- `ops/Caddyfile`: `roll_keep_for 336h` present at line 23 (grep only); syntax NOT validated, `caddy` is not installed.
- Not run: everything else (D-54).

## Contacts "Reserve a table" button -> /reservation (D-58) - T-58, 2026-11-18, HEAD `425d7ad` + uncommitted product change (narrow tier, D-54)

Ports 3201/3206 free before, no leftover servers after. Only the suites below were run.

| suite | HEAD | result |
|---|---|---|
| e2e `contact.mjs` (NP1 updated; new RB1-RB4) | 425d7ad | PASS 117/117 |
| e2e `public.mjs` (C1, U5 updated; run in full) | 425d7ad | PASS 90/90 |
| e2e `feedback1.mjs` (FRESH3 updated; run in full, 4 min) | 425d7ad | PASS 781/781 |

- Stale expectations updated: `contact.mjs` NP1 (button now visible with `href=/reservation` when no phone is set), `public.mjs` C1 (phone-item and top bar stay `tel:`, `#contact-call` is `/reservation`) and U5 (`call === false`, i.e. not hidden), `feedback1.mjs` FRESH3 (`d.call === false`). `feedback1` RESN1 concerns `#res-call` on /reservation (still hidden without a phone) and is unchanged.
- New `contact.mjs` RB1-RB4 (phone set and unset x BG/EN x 390/1280): label BG "Резервирай маса" / EN "Book a table", href, click lands on `/reservation` over http with no popup, no dialog and no non-http navigation or request, html lang and headings keep the chosen language, `#plan-svg` visible with 14 tables, no h-scroll, no console errors.
- Observation (not a defect): in EN the rendered href is `/reservation?lang=en` (langHref), in BG `/reservation`. Tests accept exactly these two.
- Not run: all other suites (D-54).

## Contact email (D-55) - T-54, 2026-11-18, product code `24c46d9` (narrow tier, D-54)

Verdict: see the T-54 handoff. Ports 3201-3208 free before the run, no leftover servers after. Spec: `docs/ARCHITECTURE.md` "Contact email (D-55)".
- API: `security` 43/43 (server/** changed), `feedback1`/`i18n`/`langs`/`migration006` pass with migration lists `001..008` (`008_contact_email.sql`, 8 rows in `schema_migrations`) and the public `site` keys `about,address,currencySymbol,email,instagramUrl,lang,openingHours,reservationPhone`. `gallery.test.mjs` only checks for 007 by name and needed no change (not run).
- New `tests/e2e/email.mjs` (port 3201, real server and API, no mocks): A seed + "PUT without the key keeps it"; B seed on home and privacy, BG/EN, 390/1280 (mailto href, order phone-email-social, privacy order phone-email-address); B6 rapid language toggling; C 254-char address at 390/768/1280 BG/EN on home and privacy (no h-scroll, inside viewport); D UI edit (trimmed save, client error, server-only error `a..b@kota.bg` mapped inline, correction, clear, restart does not re-seed); E 17 malformed/XSS values rejected with `fields.contactEmail`, 5 payloads written straight into SQLite render as text on home, privacy and admin field; F Tab order, focus outline, contrast (link 8.47, label 6.65, outline 13.72) at 390/1280.
- `contact.mjs` (T-46) failed 23 of 85 before the update: SOC3/SW1 (order now phone,email,social), SOC4 at >= 768 (the email takes the cell beside the phone; the Instagram item moves to row 2 under the phone, a layout consequence of D-55 in a 2-column grid), SOC9/SOC10 (Tab goes phone, email, Instagram). Expectations updated to the spec; 85/85 afterwards.
- Not run (D-54): `launch.mjs` (its E6d/E6e privacy placeholder checks would fail with the seeded email; expectation edited, not executed), `public.mjs`, `i18n.mjs`, `feedback1.mjs` e2e, `admin.mjs`, `a11y.mjs`, `npm test`.
- Observation: the working tree has an uncommitted change in `public/js/i18n.js` (EN "Daily Special" -> "Daily Specials", not part of 24c46d9, not made by QA). `tests/e2e/i18n.mjs` still expects "Daily Special" (regex checks match both, `includes('Daily Special')` also matches the plural).

## BUG-19..22 retest - T-51, 2026-11-17, product code `85a7d38` (narrow tier, D-54)

Verdict: **PASS** - BUG-19, BUG-20, BUG-21 and BUG-22 verified fixed; no new defect. Only the fixes and what they touch were run (no full regression; that is for the pre-go-live run). Ports 3201-3204 (all free before the run, harness refuses busy ports; no leftover servers after).
- BUG-20: `gallery.test.mjs` 17/17 (GA11b now passes), `security.test.mjs` 43/43 (server/** changed).
- BUG-19: `bug19.mjs` 194/194 (same-page nav 8 sizes x BG/EN, cross-page nav from 4 pages x 3 viewports, direct loads) and `feedback1.mjs` 775/775 (LOC3[bg 390/768/1280] pass).
- BUG-21: direct `/#about` loads at 390/768/1280 BG/EN in `bug19.mjs` B21d; plus new `bug22.mjs` B21a: the real admin "Виж на сайта" link (opens a new tab) lands with the About heading below the bar at 1280/768/390 (h2 top 112/112/96 px, bar 52).
- BUG-22: new `tests/e2e/bug22.mjs`: widths 768/800/850/900/959, BG and EN, no event and one enabled event: no horizontal scroll, EN button right edge <= viewport (768 BG+event: sw 768, EN right 751; 959: 942), links do not overlap the language switch, also /gallery, /daily-menu, /reservation, /privacy at 768 and 959. 960/1024/1280 BG/EN header metrics (font, letter spacing, gap, every link box, header height) identical to the pre-fix tree `cdcd451` (extracted with `git archive`, run with `BASE_DIR=<dir>`); the same pre-fix tree reproduces the defect at 768 BG+event (sw 795), so the comparison is meaningful. Same-page nav clicks (Локация/Контакти/Събитие/Меню, 1280/900/768, BG/EN, with event): 24/24 still scroll smoothly (position intermediate 90 ms after the click) and land with the heading below the bar.
- Changed by QA: new `tests/e2e/bug22.mjs`, `tests/lib/harness.mjs` (`startServer` accepts an optional `cwd`, default unchanged). Run: `BASE_DIR=/path/to/extracted/cdcd451 node --disable-warning=ExperimentalWarning tests/e2e/bug22.mjs` (without `BASE_DIR` the 960/1280 comparison is reported as skipped).
- Not run (D-54): everything else; 768-959 behaviour was checked in Chromium only, at height 1024 (nav layout does not depend on height).

## Gallery + editable About text + BUG-19 retest - T-50, 2026-11-17, product code `cdcd451` (narrow tier, D-54)

Verdict: **FAIL** - BUG-19 not fixed (worse), BUG-21 (nav regression at 768) and BUG-20 (minor). Gallery and About behave to spec otherwise. Commands: `tests/README.md` (sequential, ports 3201-3209).

### Run (cdcd451) - everything else is DEFERRED to the pre-release full regression
`api/gallery`, `api/security`, `api/feedback1|i18n|langs|migration006`, `npm test`, `e2e/gallery`, `e2e/pages`, `e2e/bug19`, `e2e/feedback1`, `e2e/contact` (counts in the table above). The 11 known T-47 failures were 11 expectation changes (migration list 001..007 incl. count 6 -> 7 in langs LG1 / migration006 MG1, `about` key in feedback1 F8, security S8e) plus one more found later (feedback1 e2e IG7f `about` key); each checked against D-52 and updated, nothing weakened.
Covered by the new tests: auth + CSRF + foreign Origin on all 5 gallery routes (+ S1 matrix); every accepted type; 33 spoof cases (PNG as .mp4, MP4 as .png/.webm/.mov, wrong declared type, fake ftyp variants, Matroska, bare EBML, PDF/SVG/HTML/ZIP/GIF, empty) -> 415 and no orphans; exactly 50 MB ok / +1 -> 413, tmp empty; 25 items, 26th 409, 4-way race on the 25th slot -> one winner; order validation (14 bad bodies); PATCH limits/mass assignment; delete removes file + row, compacts positions, tmp empty; hidden items 404 on /media incl. Range/HEAD/conditional; Range 206/416 for mp4/mov/webm; caption and About fallback BG/EN; About 2000 ok / 2001 -> 400; XSS payloads verbatim in JSON and rendered as text in public grid, lightbox, home About, admin list/confirm/settings; restart persistence + orphan sweep; admin upload of images + video, reorder (focus kept), visibility, captions, delete with confirmation, 25/25 disabled state, error rows 415 (real), 413/409 (response mocked); admin tab bar 360/390/768/1280; public grid 390/768/1280 BG/EN, empty/error/skeleton; lightbox image + video (webm, mp4 H.264 play, pause on next/prev/close/Escape, arrow keys do not steal seeking, swipe ignored on video, focus returns to tile); nav on /, /daily-menu, /gallery, /reservation, /privacy, 404 at 390/1280 BG/EN ("Галерия" present, no "За нас"/#about, aria-current on /gallery); contrast, 44 px targets, focus ring, reduced motion.

### Defects
BUG-19 | major (reopened) | frontend-developer | At 390/768/1280, BG, default content (phone, address, hours, no events) open `/?lang=bg`, click "Локация" (the `/#location` link is then a full page load); also open `/#location` directly, or click "Локация" from /gallery, /daily-menu, /reservation, /privacy | the "Локация" heading lands below the sticky bar (top >= 52 px) | page scrolls to the very bottom: heading at -206 px (390), -142 px (768), -142 px (1280), i.e. above the viewport, only Contact visible | `feedback1.mjs` LOC3[bg 390] `{"t":-205.73,"bar":52}`, LOC3[bg 768] -141.88, LOC3[bg 1280] -142.33 (at fd0169f only LOC3[bg 390] failed, 32.27, so cdcd451 widened it); `bug19.mjs` B21x/B21d: 24 + 6 failures (location from 4 pages x BG/EN x 3 viewports, direct load). Root-cause evidence: default smooth scrolling ends at max scroll (`sy 1316/1316` at 1280); with `prefers-reduced-motion: reduce` the same load lands correctly (`h2 112`, `sy 1062`). Same-page clicks (menu/location/contact, 8 viewport sizes, BG/EN) PASS (`bug19.mjs` B19: all pass), so the case the fix targeted works; menu and contact from other pages work. Fix attempts so far: 1 (cdcd451).
BUG-21 | minor | frontend-developer | direct load or link `/#about` (the admin "Виж на сайта" link in the new About card opens it), 390/768/1280 | About heading below the sticky bar | lands at max scroll, heading -350 px (390), -318 px (768/1280) | `bug19.mjs` B21d `/#about` 6 failures; same mechanism as BUG-19, also at fd0169f (-128 at 390, -77 at 1280), so pre-existing but now reachable from the admin.
BUG-22 | major | frontend-developer | 768x1024, BG, one enabled event, open `/` | header fits, no horizontal scroll, language buttons inside the viewport | "Галерия" is wider than "За нас": document scrollWidth 795 > 768, EN button right edge 794 px (outside the viewport); EN language and the no-event case are fine; /daily-menu, /gallery, /reservation fine (no "Събитие" item there); fd0169f same state 768 ok | probe (`event=true bg /: sw=795 OVERFLOW .lang-switch r=795`), also seen by `public.mjs` R2[768] and `i18n.mjs` SW1/HS1/HS3[768] in the early part of the run that was stopped by D-54; breakpoint range not swept (D-54).
BUG-20 | minor | backend-developer | `GET /media/<video>` with `Range: bytes=999999999-` | 416 with a JSON body labelled `application/json` | 416, `Content-Range: bytes */N` correct, JSON body but `Content-Type: video/mp4; charset=utf-8` | `gallery.test.mjs` GA11b. No effect on playback; applies to all `/media` files.

### Observations
- Lightbox counter reads "Страница 1 от 5" (existing `page.of` string) where DESIGN E3 shows "3 / 12"; the spec says to reuse `page.of`, so not filed.
- Fake `ftyp` with a valid brand ("isom") and garbage body is accepted by design (header-only sniffing; same trade-off as images).
- Interrupted-run findings that are test expectations, not product defects (NOT fixed, suites deferred): `i18n.mjs` AST0/AE fail because Настройки now has two "English" tabs (`tabA(page,'English').count() === 1` must be scoped to the site card); `public.mjs`/`i18n.mjs` 768 failures above are BUG-22.
- The pre-scope-change part of the run also executed public (89/90, R2[768] = BUG-22), admin 118/118, a11y 48/48, design 22/22, reflow 88/88, i18n 207/216 (SW1/HS1/HS3[768] = BUG-22, AST0/AE = expectation), all at cdcd451; they are NOT counted as the regression for D-54 and must be repeated in the pre-release run.

### NOT RUN
- Deferred to the pre-release full regression (D-54): launch, langs e2e, admin-dates, the 768/360 width sweeps, public/admin/a11y/design/reflow/i18n (partial runs above), the other API suites (publication, menu, uploads, cleanup, download).
- Real iOS Safari (MOV playback, swipe/seek behaviour, `#t=0.001` poster frame, Range from iOS); Chromium cannot play `.mov` (`canPlayType('video/quicktime')` empty), so MOV was tested for upload/serving only.
- Real touch gestures (swipe was dispatched as synthetic TouchEvents).
- Production/HTTPS behaviour.

## Admin-only menu download (T-44) + Instagram beside phone (T-45) - T-46, 2026-11-17, `e521e80` (full tier)

Verdict: **FAIL** - 1 minor defect open (BUG-19). Everything else passed. Run in a checkout at `e521e80`; the main checkout moved to `25bcdfb` (T-47) after the e521e80 runs finished (server file mtimes vs. log mtimes checked), and the API suites were re-run at `e521e80` in a throw-away `git worktree` with the final test files. Commands: `tests/README.md` (sequential, ports 3201-3209, `QA_SCRATCH=/tmp/claude-0/kota-qa`).

### Acceptance checks (all executed, all PASS unless noted)
- Public endpoint gone: `GET`/`HEAD /api/public/menu/download` (no lang, bg, en) -> 404 with no pages, with 3 live pages in file mode, and with an admin cookie; POST/PUT/DELETE/PATCH -> 4xx; `?lang=fr` -> 400 from the generic public lang check (never a ZIP). `download.test.mjs` DL1, `pages.mjs` D1b.
- Admin endpoint `GET /api/admin/menu/pages/download?lang=`: no session / forged / logged-out cookie -> 401 `unauthorized` (GET and HEAD, also with an invalid lang: auth precedes validation); with session -> 200 `application/zip`, `attachment; filename="kota1-menu-<lang>.zip"`, `no-store`, exact Content-Length, entries in page order, bytes identical, `unzip -t` and Python `zipfile.testzip` clean, CRC32 re-computed independently; works for UNPUBLISHED pages and in structured mode; no fallback (empty EN while BG has pages -> 404, EN ZIP only EN pages); 404 `not_found` for a language with no pages (bg, en, default); 400 `validation` + `fields.lang` for 10 bad values; delete-mid-download completes as a valid ZIP; 5 client aborts leave no fd/tmp leaks; missing file on disk -> 404; 10 x 50 MB ZIP streams (RSS +5 MB). DL1-DL12. Added the 3 URLs to the S1 auth matrix in `security.test.mjs`.
- Public site BG + EN, file mode (1 and 10 pages, PDF page), structured mode and daily menu (image and PDF): no "Изтегли"/"Download"/"Принтирай" text, no `[download]` attribute, no `.menu-dl-btn`/`.menu-page-dl`/`.menu-print-bar`/`.print-title`, no print button, no `window.print` call (pages.mjs P1d, L1l, F1b, D1a, PR1-PR4, DM2, DM4; public.mjs F1b, F2; i18n.mjs FM1-FM3, DP1). Daily PDF open link: one link, `target=_blank rel=noopener`, `/media/*.pdf` answers 200 `application/pdf` (DM4 bg+en). Lightbox: 10-page gallery (L1a-m, AX4-6) and daily image (DM3 bg+en) still open, navigate, close.
- Admin page manager (1280, real browser downloads): BG/EN tab each show exactly one "Изтегли менюто (ZIP)" link with the right `lang`; click downloads `kota1-menu-bg.zip` / `kota1-menu-en.zip`, valid, 10 / 2 entries, page-01 and page-10 byte-identical to the admin media; link absent with 0 pages (both languages) and appears after the first page is added; per-page "Изтегли страница N" (10 links, `download` attribute, admin media URL) downloads exactly page 2 (not 1 or 3). D1c-k, DM0, DM0b. Admin controls >= 44x44 at 390/768/1280, no h-scroll (V2).
- Instagram (`tests/e2e/contact.mjs`, 3 viewports x BG/EN, 85 checks): "Социални мрежи" / "Social media" item after the phone item; icon link `aria-label=Instagram`, `target=_blank rel=noopener noreferrer`, href = configured URL, svg `aria-hidden`; 768/1280: same row, to the right of the phone; 390: wraps below, same left edge; reservation-button row contains only `#contact-call` (no icon/svg/instagram link); footer icon unchanged (exactly one in #contact + one in footer); no h-scroll; icon 44x44; computed contrast label 6.65, phone link 8.47, icon 8.47 (needs 4.5 / 4.5 / 3); keyboard Tab phone -> icon -> reservation button with 3px outline on the icon; click opens the URL in a new tab with `window.opener === null` (network stubbed); no phone -> social item stays, call hidden; empty / `javascript:` / foreign host / `http:` Instagram URL -> every icon links to `https://www.instagram.com/`; 6 rapid BG/EN toggles leave exactly one phone item and one social item; no console/page errors, failed requests or CSP violations. Screenshots: `/tmp/claude-0/kota-qa/shots/contact-section-{bg,en}-{390,768,1280}.png`.
- Security tier: `security.test.mjs` 43/43 in full (final file, at `e521e80`), XSS checks in `public.mjs`/`i18n.mjs`/`feedback1.mjs`/`launch.mjs` pass; `launch.mjs` asserts zero third-party requests; S9 secrets grep passes.

### Updated test expectations for the intended change (checked against D-49/D-50 first)
`tests/api/download.test.mjs` (rewritten: public 404, admin ZIP), `tests/api/security.test.mjs` (+3 auth-matrix entries), `tests/e2e/pages.mjs` (D1 admin downloads, PR print section replaced by D-49 absence checks, DM daily checks, AX2/AX3, V1 selectors, admin browser context accepts downloads), `tests/e2e/public.mjs` F1b/F2, `tests/e2e/i18n.mjs` FM1/FM2/FM3/DP1. New: `tests/e2e/contact.mjs`. The `@media print` stylesheet is still asserted only as harmless (print emulation shows only `#menu`); the "KOTA 1" print title assertions were removed because the element was removed (D-49). No unrelated assertion weakened.

### Defects
BUG-19 | minor | frontend-developer | At 390x844, BG, default content (phone set, address, hours, no events), open `/`, tap the menu toggle, tap "Локация" | the "Локация" heading ends up visible below the sticky top bar (`top >= bar bottom`) | page lands at max scroll: `#location` top = 0.27 px, h2 top = 32 px while the sticky bar bottom = 52 px, so the heading is ~20 px under the bar; `element.scrollIntoView()` on the same state gives the correct `#location` top 64 px (scroll-padding), so the nav-click path overshoots when the content after Location is only slightly taller than the viewport | `tests/e2e/feedback1.mjs` LOC3[bg 390] FAIL: `{"t":32.265625,"bar":52,"hash":"#location"}`; same suite at `3b33a4d` 775/775 (there Location is capped higher: content after it 749 px, section top 95 px); trigger is the taller stacked Contact section of D-50 (390 px: phone, social item, button) which changes the page's max scroll; debug probe: scrollY 1015 = max 1015, scrollIntoView -> 951; the same click on "Меню" lands correctly (top 64). EN/768/1280 pass. Not caused by the download change.

### Observations (not defects)
- `?lang[]=en` (array syntax) on the admin ZIP route is ignored and treated as the default `bg` (Express query parsing); same pre-existing behaviour as other routes.
- A bad `?lang` on the removed public route returns the public router's generic 400 rather than 404; GET/HEAD without a bad lang are 404 as specified.
- Repo hygiene (for the PM): my T-46 test edits were swept into commits `508f557` (WIP checkpoint) and the T-47 commit before I handed back; `docs/DESIGN.md` showed as modified in the working tree while I worked (not mine). I did not commit anything.

### T-47 expectation changes (seen only at `25bcdfb`, NOT T-44/T-45 defects; not fixed here, gallery testing is a separate task)
`tests/api/*.test.mjs` at `25bcdfb`: 166/177, the 11 failures are: migration list now includes `007` (feedback1 N1-N5 and F1 "001..006", i18n I13, langs LG1, migration006 MG1) and `/api/public/site` / settings carry the new `about` field (feedback1 F8 key list, security S8e public whitelist). `npm test` at `25bcdfb` 113/113. e2e suites were not re-run at `25bcdfb`.

### NOT RUN
- e2e suites at `25bcdfb` (T-47 code) - out of scope for T-46.
- Real Safari/iOS, real Windows/macOS browsers; downloads were exercised in Chromium only.
- Production/HTTPS deployment behaviour.

## Owner feedback round 3 + menu download + release regression (T-43) - 2026-11-17, `8b5c0c6` (full tier)

Verdict: **PASS**. No defect found (BUG-19+ not needed). Every failure seen at the start of the run was an obsolete expectation of a change specified in `docs/ARCHITECTURE.md` "Owner feedback round 3 (D-44..D-46)", "As built (T-38)" and "Menu download (D-48)", or a mistake in a new test (fixed, listed below).

### Intended-change expectations updated (each verified against the spec first)
| Test | Obsolete expectation | New expectation |
|---|---|---|
| feedback1 F1, N1-N5; i18n I13; langs LG1 | applied migrations 001..005 | 001..006 (`006_menu_pages.sql`); LG1 also: published legacy file -> bg flag on, `pages.bg.items[0]` |
| menu M7-M13 | `/menu/files*`, one published file | `/menu/pages` (+ `/order`, `/published`, `DELETE /pages/:id`): per-language flag, ordered pages, live at once, `in_use` for the last page / last live language, `nothing_published` also for a flag on an empty language |
| langs LF1-LF3 | per-file publish, `files`, dashboard `publishedFile(s)` | pages API; `GET /api/admin/menu` has no `files`; dashboard `menu.pages {bg,en:{published,count}}`; removed endpoints answer 404 |
| langs LU4, security S5d/S5e | 5 / 10 / 15 MB limits | 50 MB (6 / 11 / 16 MB accepted; 50 MB + 1 -> 413; exactly 50 MB -> 201) |
| langs LU5/LU6/LA1, security S1a/S5b/S5g/S5h/S5i | `/menu/files` | `/menu/pages` (+ order/published/delete); LU5 now reports the offending field (`fields.fileEn`) instead of `file` (observation below) |
| publication D1, D4, D6-D9 | past menus created freely, listed and kept | D-45: past-dated menu created (that upload exempt), hidden from public and admin list (`GET` = today + upcoming), deleted with its file by the NEXT upload; D4 asserts "hidden in the admin list, still on disk until an upload"; D5 uploads at a later clock delete the earlier menus, so D6 recreates today's menu |
| admin MN12-MN14 (M) | "Качи български файл" button, per-file publish | page manager: file input uploads at once, switch "Публикувани — Български страници", delete of the last live page -> "последната публикувана страница" |
| public F0-F2 | `.menu-file` single image/PDF | `.menu-pages` / `.menu-page-image` / `.menu-page-pdf`, alt "Меню — страница N", single page without caption, direct download link |
| i18n FM1-FM5 | `.menu-file`, "Tap to enlarge", "The menu is a PDF file." | `.menu-pages`: "Enlarge page 1 of 1", "Download menu", "Download page 1", "PDF — page 1"; lightbox zoom button selector `.lb-btn:not(.lb-prev):not(.lb-next)` (prev/next buttons were added before it) |
| langs F-FILES FL1-FL13, G-XSS, R-TAB | file sections, `/menu/files` | page manager flow (tabs, auto upload, switches, reorder, public order/colours, fallback, dashboard counts, delete rules); XSS names via `/menu/pages`; R-TAB measures visible tabs only (the pages tabs exist hidden) |

### New targeted tests
- `tests/api/uploads.test.mjs` (UP0-UP8, port 3201): 50 MB exactly -> 201 and stored size 52428800; 50 MB + 1 -> 413 `file_too_large` with `fields.<field>` on POST events (`image`, `imageEn`), POST daily-menus (`file`, `fileEn`), POST `/menu/pages` (bg, en), PUT events/daily; `tmp/` empty after success, 413, 415, 400, 409 and client abort (polled up to 3 s: the file is unlinked a few ms after the response); a temp file exists in `tmp/` while a 30 MB body is in flight (disk storage); abort at 8 MB removes it, no row, no upload file; start-up sweep of leftovers; peak RSS 89 -> 115 MB after 300 MB of uploads; 16 simultaneous page uploads -> exactly 10 x 201 + 6 x 409, positions 1..10; concurrent deletes keep positions contiguous.
- `tests/api/cleanup.test.mjs` (CL1-CL6, port 3202): past menus deleted with BG+EN files from DB and disk (files table = disk), today/future kept; the clock alone deletes nothing; PUT/PATCH without file, failed (415) upload and event uploads do not clean; PUT adding `fileEn` and `replace=true` do; Sofia midnight both summer (20:59:59Z keeps, 21:00:00Z deletes) and winter (21:59:59Z / 22:00:00Z); admin list = today + upcoming.
- `tests/api/download.test.mjs` (DL1-DL9, port 3203): 404 in every non-public state; ZIP headers (`application/zip`, `attachment; filename="kota1-menu-bg.zip"`, `no-store`, `nosniff`, exact Content-Length, HEAD); own ZIP parser (EOCD, central dir, local headers, CRC32 via `zlib.crc32`) + `unzip -t` + `python3 zipfile.testzip`; entries `kota1-menu-<lang>-page-NN.<ext>` in admin order, renumbered after deletes; served-language naming and EN/BG fallback; invalid `lang` -> 400 (11 variants), extra query/path input ignored, traversal paths 404, POST/PUT/DELETE/PATCH 4xx; unpublish + delete mid-download completes as a valid ZIP (3 x 25 MB, paused client) and the next request reflects the change; abort x5 leaves no file descriptors; missing file on disk -> 404; 10 x 50 MB (500 MB ZIP in ~2 s) `unzip -t` OK, server peak RSS 117 -> 120 MB.
- `tests/api/migration006.test.mjs` (MG1-MG3, port 3204): 001..005 DB with 3 bg (one published, not the newest) + 2 en (none published) legacy files, an unreferenced `files` row, an event image and a daily file: bg keeps the published one (flag 1), en keeps the newest (flag 0), position 1, legacy `published` zeroed, other legacy files + orphan rows and disk files deleted, referenced files kept, idempotent restart, integrity/foreign-key checks; en-only published; unpublished single legacy file.
- `tests/e2e/pages.mjs` (72 checks, ports 3201 and 3202): 11 files at once refused client-side; 10 files at once -> 10 sequential uploads (no overlap, progress bar, queued rows, throttled uplink); 11th blocked (UI and API 409); reorder with arrows (+ disabled ends, live region, focus kept), delete with confirm, renumbering; publish per language; public pages in admin order (pixel colours), "Страница N от M", alt text, PDF card; unpublished pages' `/media` 404; lightbox prev/next/arrow keys/touch swipe/Escape/focus return, PDF skipped with real page numbers, EN labels; EN/BG fallback in both directions and the in_use refusal; single page -> direct download link; ZIP downloaded through the browser (`kota1-menu-bg.zip`/`-en.zip`, `unzip -t`, entry bytes = live page), per-page download; structured menu print button calls `window.print()` (keyboard too), print media hides header/top bar/footer/hero/nav/button and shows "KOTA 1" + categories + prices on a white background, real PDF via `page.pdf()` + `pdftotext` contains the menu and not the address/phone/nav; computed contrast, focus ring, lightbox focus trap, heading order, 44 px targets and no h-scroll at 390/768/1280; daily wizard note + daily image download links.

### Observations (not defects)
- `POST /menu/pages` with a wrongly named file field now reports `fields.<that field>` (e.g. `fileEn`) like the other routes; the removed single-file route reported `file`. The admin UI only sends `file`.
- Flags survive deleting all pages of a language (a flag may be set on an empty language): uploading the next page to such a language is live at once. This is the specified "live = flag on AND >= 1 page"; the UI warns for published sets.
- `tmp/` temp files are unlinked a few ms AFTER the response is sent (tests poll up to 3 s); no leftover was ever seen.
- Slow uplink: a 50 MB upload sent at ~160 KB/s (324 s, longer than Node's default 300 s `requestTimeout`) still returned 201 (probe, not in the repo).
- ZIP built in-house: no ZIP64 (> 4 GB would answer 413); 10 x 50 MB is 500 MB, well inside.

### NOT RUN
- Caddy `max_size 55MB` and HTTPS (no proxy in the sandbox); real mobile browsers and Safari (headless Chromium only; the touch swipe is a synthetic TouchEvent); real printers (only Chromium's PDF output); browser "Save as PDF" dialog.
- width sweep 320-420 px (not re-run).

## Retest BUG-16 / BUG-17 / BUG-18 (T-37) - 2026-11-17, `39ca70d` (targeted)

Verdict: **PASS**. BUG-16 and BUG-17 fixed; BUG-18 closed as "by design (D-43)". `git diff 01e69f6..HEAD` touches only `public/admin/js/daily.js` and `events.js`.

- BUG-16 **fixed**: ED4a (toast "Менюто е обновено.", list shows the new files), ERR-3 (dialog stays open, error under the English uploader, no toast), LOG-A (no page errors) all PASS. Added D-413 mocked checks with the real server shapes (files.js:81 `fields.<name>`; http.js:42 generic body without fields): daily edit dialog 413 + `fields.fileEn` (uploader 2), 413 without fields (uploader 1), 400 + `fields.fileEn` (uploader 2), 415 + `fields.file` (uploader 1): all PASS, dialog stays open each time.
- BUG-17 **fixed**: ERR-1 / ERR-1b PASS (error at the English uploader, English tab kept); new ERR-1d: summary "Снимка (English): ..." shown; ERR-413a (event 413 + `fields.imageEn`: English tab, English uploader, summary) and ERR-413b (generic 413: Bulgarian tab, uploader + summary) PASS; ERR-2 wizard still PASS.
- BUG-18 **closed, by design (D-43)**: public U5 changed to accept "85 Ralevitsa St, Sofia" (EN default) as well as the BG default; 89/89.
- Test fix (QA-owned): `tests/e2e/langs.mjs` ERR-3 diagnostic used `.a-toasts`.innerText(). Developer's claim **verified**: the toast host is created lazily (`ui.js` `host()`), so with no toast the locator does not exist and `innerText()` times out after 30 s (the correct outcome). Old test against the fixed product: `FAIL D-ERR-DAILY (locator.innerText: Timeout 30000ms)`, cascading to D-MAP (leftover dialog), E-GUARD, F-FILES, 140/144. Fixed with `allInnerTexts()`; ERR-3 assertion (dialog open, 2 uploaders, BG null, EN message) unchanged. LOG-A now also tolerates status 413 console lines (the intended, mocked responses).
- Runs: `node tests/e2e/langs.mjs` 185/185; `public.mjs` 89/89; `admin.mjs` 117/117 (admin XSS checks XSS[admin ...] and XSS-AL, plus langs G-XSS, all PASS).
- NOT RUN: api/server suites (unchanged since fc935f8 PASS); a11y, design, i18n, reflow, launch, feedback1, admin-dates (their covered code is unchanged; i18n admin tests touch events/daily error paths only via the wizard, not the edited lines).
- Residual (observation, not a defect): in the daily edit dialog an error shown at one uploader is not cleared when a later rejection puts the error on the other uploader without a file change (found while chaining mocked cases; each case now reopens the dialog). Real flow: the user changes the file, which clears it.

## Owner feedback round 2 - separate BG / EN content + release regression (T-35) - 2026-11-17, `fc935f8` (full tier)

Verdict: **FAIL** - BUG-16 (major), BUG-17 (major), BUG-18 (minor, needs a PM decision). Server behaviour (migration 005, multipart, /media visibility, fallback) is fully green; the defects are in the admin UI and one public-settings interaction. No product file was changed by QA.

### Intended-change expectations updated (each verified against `docs/ARCHITECTURE.md` "Owner feedback round 2" first)
| Test | Obsolete expectation | New expectation |
|---|---|---|
| feedback1 F1, N1-N5; i18n I13 | applied migrations 001..004 | 001..005 (`005_separate_languages.sql`, "As built (T-33)") |
| admin EV1 | "Въведете заглавие." and a required title | "Въведете заглавие поне на един език." (D-39) and no required star on the title label |
| admin M (menu file upload) | one file input, button "Качи" | one file section per language (D-40); BG section first, button "Качи български файл" (EN: "Качи английски файл") |
| i18n AE/AMN/AST (35 checks) | English fold-outs (`details.a-en`) | "Български"/"English" tabs (D-39..D-41): same flows (round trip, keyboard, preview toggle, guard, server-400 mapping, reload prefill) driven through the tabs; AMN2 now only requires an accessible label (the per-dish unique name was a property of the removed fold-out) |
| a11y A6 | focus-audit identity = tag + label | + position (two identical "Избери файл" buttons in the daily-menu wizard made the audit stop after one stop) |

### Defects
- **[FIXED T-37, verified at 39ca70d] BUG-16 | major | frontend-developer** | Daily menu list -> "Редактирай" -> choose any file or just change the date -> "Запази" | dialog closes with the success toast "Менюто е обновено." and the list refreshes | the toast reads **"abort is not defined"**, the list is NOT refreshed (still "Няма EN файл" although the server saved it), the dialog closes, an unhandled `ApiError` is thrown for later server rejections, and the in-dialog 400/413/415 mapping can never run | cause: `public/admin/js/daily.js` `editDialog` assigns `abort = up.abort` but the `let abort = null;` of 96d8c9b was dropped in T-34 (strict-mode ReferenceError after the request has been sent). Evidence: `tests/e2e/langs.mjs` ED4a (`toastTxt: "Менюто е качено и публикувано.\nabort is not defined"`, row still "Няма EN файл"), ERR-3 (`DIALOG CLOSED`), LOG-A (`ApiError` page error); log `qa10/langs4.log`.
- **[FIXED T-37, verified at 39ca70d] BUG-17 | major | frontend-developer** | Event form -> English tab -> choose a file named `x.png` that is not really an image -> "Запази" | the error "Позволени са само JPG, PNG и WebP изображения." appears at the English uploader (and the same for 413) | nothing is visible: the message is written to the **Bulgarian** uploader, which is hidden while the English tab is shown; no summary, no tab switch | cause: `events.js` `handleError` and `daily.js` edit dialog use `err.field`, which `ApiError` never sets (the server puts the field in `fields.imageEn` / `fields.fileEn`); the wizard (uses `e.fields`) is correct. Evidence: langs.mjs ERR-1/ERR-1b `{"bgPanelErr":"Позволени са само JPG, PNG и WebP изображения.","bgPanelHidden":true,"enErrHidden":true}`, screenshot `qa10/shots/langs-err-imageEn.png`. Same wrong-uploader mapping exists in the daily edit dialog (`e.field === 'fileEn'`), currently masked by BUG-16.
- **BUG-18 | minor | PM decision, then backend-developer or test owner** | Settings: clear the BG address (default setup keeps the seeded English default in the English field) -> open the BG site | BG site shows an address in Bulgarian (D-37: empty -> default "ул. Ралевица 85, София") | BG visitors now see the English text "85 Ralevitsa St, Sofia", because `publicSiteSettings` uses the new bidirectional `pick` for address/opening hours. Arguably consistent with D-39 and with the admin hint "не е попълнено - ще се покаже другият език", but it changes D-37 behaviour and the spec does not say so. Evidence: `tests/e2e/public.mjs` U5 `loc: "ЛОКАЦИЯ\nАДРЕС\n85 Ralevitsa St, Sofia ..."`. U5 was NOT weakened; if the PM accepts the new behaviour, change U5 to accept the EN default.

### Observations (not defects)
- Dashboard "ОСНОВНО МЕНЮ" shows only `menu.publishedFile` ("Публикуван файл: menu-bg2.png", BG preferred) even when an English file is also published; `publishedFiles` is returned by the API but unused. Not misleading as written, but the owner cannot see the EN file there.
- `POST /api/admin/menu/files` with a wrong file field name reports `fields.file` (single-field route), unlike events/daily which name the offending field.
- `POST /api/admin/events` also accepts a JSON body (no files) - pre-existing, by design.

### Checks run (all in this run)
- api `langs.test.mjs` 28/28: LE1-6 events (BG/EN text and images, fallback both directions per field and per image, title required in >=1 language, replace/remove imageEn, delete removes both files), LM1 EN image visibility (disabled, re-enabled, future start, expired via time travel; both languages), LD1-5 daily (BG+EN, EN-only, remove-only-file refused, replace=true replaces both, visibility incl. unpublished / tomorrow / Sofia midnight), LF1-3 menu files per language (default bg, invalid lang 400, one published per language, fallback, in_use only for the last published file, EN-only file enough for file mode, dashboard fields), LS1-3 structured names (>=1 language, fallback both directions, EN-only edit = unpublished change), LU1-6 uploads on imageEn/fileEn (11 fake types x POST/PUT, oversize 5/10/15 MB, exact limit, unknown/misplaced/duplicate fields -> 400 `bad_upload`, no orphans, no rows), LA1-2 auth/CSRF/origin on 16 changed routes + traversal, LX1 XSS payloads inert in JSON (nosniff), LG1 migration 005 on a real 001..004 database (data kept, lang defaults to bg, daily_menus rebuilt with nullable file_id and UNIQUE date, foreign_key_check/integrity ok, idempotent).
- e2e `langs.mjs` 172/177: owner scenario through the real UI (event with BG+EN title/description/photo; EN-only event; daily menu BG+EN via wizard; EN-only daily menu via replace flow with confirm text naming both languages; structured menu with BG+EN names, one dish EN-missing and one BG-missing; file mode with BG and EN files), public site at 390/768/1280 in both languages (banner/photo/menu/file verified by decoded pixel colour, switching БГ->EN->БГ in the same document without reload in <3 s, fallbacks both directions, `?lang=en`, no console errors / failed requests / horizontal scroll), admin tabs (roles, roving tabindex, ArrowLeft/Right/Home/End, Tab into panel, dots with "(попълнено)" text, hints, preview follows tab), daily list БГ/EN badges, edit dialog remove/replace fileEn, unsaved-changes guard on EN-only edits (event title, event EN image, dish name, settings address), mocked server-400 mapping for imageEn/titleEn/nameEn/addressEn, real 415 mapping (failures above), XSS in BG+EN fields on public and all admin views (payload visible as text, `window.__xss` never set), admin at 768 and 390 (no horizontal scroll, tabs >=44 px, visible focus ring, one h1, labelled inputs).
- Screenshots: `qa10/shots/langs-*.png` (scratchpad `/tmp/claude-0/-home-user-kota-restaurant/0a6b5eed-3087-545d-a04f-90c802bbd434/scratchpad/qa10/shots`).
- NOT RUN: nothing skipped; keyboard-only checks use Playwright key events (no screen reader).

## Retest of BUG-12..15 (T-32) - 2026-11-17, `2dd4acb`

Verdict: **PASS** - BUG-12, BUG-13, BUG-14, BUG-15 verified fixed; no blocker/major open. Changed by QA: `tests/api/feedback1.test.mjs` (F1 migration list 001..004; new 004 repair matrix N1-N5), `tests/api/i18n.test.mjs` (I13 list includes `004_fix_default_address_en.sql`), `tests/e2e/admin-dates.mjs` (VAL4b-f, VAL8a-e, TY3b-e added). Address assertions were not weakened.

| Bug | Result | Evidence |
|---|---|---|
| BUG-12 | FIXED | M1-M6 pass (003 alone no longer seeds EN over a stored BG address); I13 pass; N1: DB with the old (9fd7c8d) 003 already applied, BG custom + EN default -> after 004 the EN site shows the BG address; N2 owner-entered EN kept; N3/N4 defaults kept; N5 BG empty + custom EN kept; all idempotent on restart; 004 recorded. Known limit (by design): an owner EN address byte-identical to the default EN text with a custom BG address is indistinguishable from the damage and is cleared (falls back to BG). |
| BUG-13 | FIXED | VAL4 + VAL4b-f: one shared `.a-error` element; the invalid input (and only it) has `aria-invalid`, `is-invalid` and an `aria-describedby` resolving to the visible message; date error -> date only; cleared/corrected -> no stale reference; a time error survives a date edit; both invalid -> exactly one message and one referencing input. The shared-element design gives the correct accessibility outcome. |
| BUG-14 | FIXED | VAL8a-c: summary links for an invalid time in "Дата на събитието", "Показвай от", "Скрий след" focus the time input (invalid, described by the message); VAL8d date-error links still focus the date input; VAL8e range error focuses a "Скрий след" input. |
| BUG-15 | FIXED | TY3 typed and pasted `5.6.2026` -> `05.06.2026`; TY3b char-by-char (digits-only chunking unchanged: `20062026`, `15062026`, `15` -> `15.`); TY3c paste variants (`5/6/2026`, ISO); TY3d no error after blur; TY3e Backspace works. Cosmetic only: while typing, `5.6.` shows `05.6.` (padded once the next character arrives); final value is correct. |

Regression (server changed -> api all incl. security; shared admin JS -> admin, admin-dates, a11y, feedback1): npm test 57/57, api 113/113, e2e admin 117/117, a11y 48/48, feedback1 775/775, admin-dates 100/100. NOT RUN (code unchanged since PASS at 9fd7c8d): e2e public, design, i18n, reflow, launch.

## Owner feedback round 1 + release regression (T-29) - 2026-11-17, `9fd7c8d` (full tier)

Verdict at 9fd7c8d: **FAIL** (BUG-12 major, BUG-13..15 minor; all fixed and verified in T-32 above). Everything else passed; no product file was changed by QA.

### Environment note (not a product defect)
A foreign server process (PID 3065, `DATA_DIR=/tmp/kota-qa/launch-OaiLmK`, started 09:35 from `tests/e2e/launch.mjs`, parent PID 1) was still listening on port 3201 and silently answered the `public`, `launch` and `security` suites: the first baseline run showed false failures (U2/U4/T1/T2/T3, `launch` could not start). It was NOT killed (not QA's process). `tests/lib/harness.mjs` now refuses to start when something already answers on the port and supports `QA_PORT_MAP=3201=3209` to run around a stuck port. All numbers below were run with `QA_PORT_MAP=3201=3209`. The foreign process should be stopped by whoever started it.

### Outdated expectations changed (each verified against `docs/ARCHITECTURE.md` "Owner feedback round 1" before changing)
| Test | Why the old expectation is obsolete | New expectation |
|---|---|---|
| public `C2` | D-37 moved address + hours from `#contact` to `#location` | address/hours in `#location`, phone still in `#contact`, address not in `#contact` |
| public `U5` | D-34: top bar always present; D-37: Location always visible, Contact keeps Instagram | bar "Резервации" -> `/reservation` (label hidden), default address in Location, Contact visible with Instagram, nav "Локация" |
| launch `E5*`, `E6a`, `E6c`, `E7b/c` | map link + address live in `#location-list` | selectors `#location*`; `E6a` now: empty/blank address -> default address + exactly one map link (D-37) instead of "no map link" |
| launch `CSP3` | Instagram icon is an intentional external `https://(www.)instagram.com/` href | still forbids every other `http(s)://` href/src; `/reservation` added to the page list |
| launch `SU12` | `reservation.html` carries `__SITE_URL__` | 4 pages |
| admin blocks E, D | native `datetime-local`/`date` replaced by `.a-dt-date` + `.a-dt-time` (D-35) | typed `дд.мм.гггг` / `ЧЧ:ММ` |
| admin X, M (S did not fail) | **cascades of the aborted E and D steps**, not product defects: X needs the event that E could not create; the M "Добави ястие" strict-mode violation (two category bodies) only occurred in the run where E/D had aborted mid-way; X, M and S all pass in the full run once E and D use the new pickers (117/117) | unchanged |
| api security `S8e` | `GET /api/public/site` gains `instagramUrl` (D-36, public by design) | key list includes `instagramUrl` |
| api i18n `I13` | migration 003 is applied on start | applied list includes `003_default_address.sql`; the address assertions are NOT weakened (see BUG-12) |
| i18n e2e `RT1`, `RACE1-4` | hero button is now "Reservation" (D-38), bar text "For reservations:" (D-34), address lives in `#location-list` | strings/selector updated |
| reflow `RF-focus` x12 | the always-present top-bar link sits before the header | order `skip-link > top bar > logo > pill > БГ > EN > hamburger` |

### New targeted tests
- `tests/e2e/feedback1.mjs` (ports 3204, 3206, 3207; 775 checks): sticky top bar on `/`, `/daily-menu`, `/reservation`, `/privacy`, 404 x BG/EN x 320/390/768/1280 x phone/no phone (text, tel/`/reservation?lang` link, `position: sticky; top: 0`, at y=0, height <= 52 px (the `--topbar-h` that offsets the category chips), link >= 44 px, inside viewport, stays at top 0 and on top after scrolling to the bottom, no horizontal scroll, clean console); anchors `/#menu|about|location|contact` are not hidden by the bar; language switch re-translates the bar; `/reservation` (floor plan SVG role=img + title/desc, 12 tables whose numbers and shapes match the hidden text list, legend, note, contrast of plan text, call button tel/no-phone note, location + map link, no third-party requests, keyboard stops, 390/768/1280 BG/EN, screenshots in `$QA_SCRATCH/shots/fb1-*.png`); hero + nav "Резервация"/"Локация" links on every page; Instagram icons (placeholder vs configured URL on all 5 pages, rel/target, >= 44 px, contrast >= 3, focus, new-tab, no instagram request on load, clearing); 38 lookalike/`javascript:`/userinfo/port/backslash/whitespace/over-length values rejected by the live server (stored value unchanged), 5xx/type-confusion, 401/403 matrix; XSS payloads accepted by the server cannot produce a non-instagram href or an injected element; hostile API values (`javascript:`, other hosts, non-strings) fall back to the placeholder in the renderer; Location section on a fresh DB (default address BG/EN, map link, no hours row, Contact with Instagram and no call button), after the owner clears the address, and across a restart; OG/Twitter meta of `/reservation` with and without `SITE_URL`.
- `tests/e2e/admin-dates.mjs` (port 3208; 86 checks): browser locale **en-US**, timezone America/New_York. No native date/time inputs anywhere in the admin; no AM/PM, no mm/dd/yyyy in any text, placeholder, aria-label or value on all admin routes; typed and masked entry, paste of ISO; calendar (Monday first, Bulgarian month/weekday names and aria-labels, "Днес" = Sofia today and the server today in the wizard, month/year navigation, backdrop/Esc/"Затвори"), keyboard (arrows, Home/End, PageUp/PageDown, Shift+PageDown, month-end clamping, Enter/Space/Esc, focus return, no escape into the inert page, visible focus); 16 invalid-input combinations with Bulgarian errors and `aria-invalid`; summary + range rule; payload formats captured from the real XHR `FormData` (`YYYY-MM-DDTHH:mm`, `YYYY-MM-DD`); edit prefill; "Изчисти"; untouched edit form is not dirty; DST: `29.03.2026 03:30` (gap) is sent unchanged and stored as `04:30` per ARCHITECTURE ("moves forward 1 h"), `25.10.2026 03:30` (overlap) stays `03:30`, `28.03.2027 03:30` -> `04:30`, re-opening the event shows the stored value; daily wizard (Днес/Утре, disabled "Напред" for empty/invalid, calendar marks the server "today"), edit dialog; 390/768 layout; Settings "Instagram профил": client rejection without a request, three values the client accepts but the REAL server answers 400 (port, userinfo, > 200 chars) with the error mapped to the field, `aria-invalid`, focus and nothing stored, save/reload/clear, unsaved-changes guard.
- `tests/api/feedback1.test.mjs` (port 3206; 15 tests): migration 003 on legacy DBs (nothing stored, blank, both stored, BG only, BG + empty EN, EN only) incl. restart idempotence; fresh DB defaults; instagramUrl accept/reject matrix, whole-request rejection, partial update, types, auth/CSRF/Origin; `/reservation` route (200 html, no-cache, CSP, HEAD, 404 sub-path, POST, `/api/reservation` JSON 404).

### Defects (new)
BUG-12 | major | backend-developer | 1) Build a DB from `001_init.sql` + `002_i18n.sql` only (a live pre-feedback deployment). 2) Set `settings.address = 'ул. Витоша 1, София'` and leave `address_en` as `''` (the 002 default, i.e. the owner never filled English). 3) Start the server (applies `003_default_address.sql`). 4) `GET /api/public/site?lang=en`. | D-37 / ARCHITECTURE: the default address is seeded "**only if the stored address is empty**"; the English site shows the owner's stored address (per-field fallback to the BG address): `ул. Витоша 1, София`. | `address` = `85 Ralevitsa St, Sofia`: migration 003 fills `address_en` independently of `address`, so every existing restaurant with a BG address and no English address now shows a different, wrong address (and a wrong Google Maps link) to English visitors. Fix: seed `address_en` only when `address` is also empty (or do not seed `address_en` at all: the client already falls back to `loc.defaultAddress`). | `tests/api/feedback1.test.mjs` `M4`, `M5` (actual `'85 Ralevitsa St, Sofia'`, expected `'ул. Витоша 1, София'`); `tests/api/i18n.test.mjs` `I13` (same, line 186); `$QA_SCRATCH/f-api.log`. `M1..M3`, `M6` pass.

BUG-13 | minor | frontend-developer | Admin > new event; type `20.06.2026` in "Дата на събитието" and `25:00` in its time field; Tab away. | The time input is described by the error (`aria-describedby` -> error id) like the date input, so a screen reader announces "Невалиден час" when the time field is focused. | The time input has no `aria-describedby` (only `aria-invalid="true"`); the message is attached to the date input only (`datetime.js` `build()`: `timeIn` has no describedby handling). | `admin-dates.mjs` `VAL4` -> `aria-describedby=null`.

BUG-14 | minor | frontend-developer | Admin > new event; "Показвай от": date `20.06.2026`, time `99:99`; press "Запази"; click the summary item "Показвай от: Невалиден час". | Focus goes to the invalid TIME input. | Focus goes to the DATE input (`errs.push({ id: f.id })` uses the date input id; `datetime.js` has `focusInvalid()` but `events.js` does not use it). | `admin-dates.mjs` `VAL8` -> active element `a-input a-dt-date is-invalid`.

BUG-15 | minor | frontend-developer | Admin > any date field (event, daily wizard, edit dialog); type or paste `5.6.2026` (the parser documents `\d{1,2}` day/month). | The field keeps `5.6.2026` (or normalises to `05.06.2026`). | The mask drops typed dots and re-chunks the digits: `56.20.26` (typed and pasted), then an error "Въведете дата във формат дд.мм.гггг". No wrong date is ever saved, but the single-digit form cannot be entered and the text is garbled. Fix: keep dots the user types / normalise `d.m.yyyy` before masking. | `admin-dates.mjs` `TY3` -> `typed -> "56.20.26", pasted -> "56.20.26"`.

### Observations (not defects)
- DST gap: a user who enters `29.03.2026 03:30` is not warned; after saving the form shows `04:30` (backend rule, consistent everywhere and documented in ARCHITECTURE). A hint "този час не съществува" would be a UX improvement.
- The server accepts `https:///www.instagram.com/` (extra slash); the URL parser normalises it to `https://www.instagram.com/`, so it is harmless. `https://www.instagram.com:443/x` is accepted for the same reason (default port is dropped by the parser).
- The calendar is a native modal `<dialog>`: Tab from the last control leaves to the browser UI (not into the inert page); this is standard and not a keyboard trap.
- A hidden `<a id="contact-call" href="tel:">` and `<a id="res-call" href="tel:">` stay in the DOM with an empty `tel:` href when there is no phone (they are `hidden`, not focusable).
- `loadSite()` caches per language for the page lifetime: a phone changed in the admin while a visitor keeps a page open is picked up only after a reload (pre-existing behaviour).

### NOT RUN (T-29)
- Real mobile browsers/devices and a real screen reader (only Chromium headless).
- Real Google Maps / instagram.com navigation (stubbed by `context.route`; only the URLs are asserted).
- Width sweep 320-420 px beyond the four widths in `feedback1.mjs`.

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

BUG-11 [VERIFIED-FIXED @ 5884ce2, T-21] | minor | frontend-developer | Open `/` or `/daily-menu` (BG or EN) at exactly 360x640 (BG also 361-363). Measure `.nav-toggle`. | Header controls keep the 48x48 size set in CSS (>= 44 px target). | `.nav-toggle` is flex-shrunk to 40x48 (BG) / 43.3x48 (EN) at 360 px; 41-43 px wide at 361-363 (BG), 44.3 at 361 (EN). Every other width (320, 340-359, 364+ BG / 361+ EN) gives 48x48. Cause: from 360 px the header row is no longer wrapped (T-19 wrap applies <= 359 px) and the logo + pill + lang switch + hamburger exceed the row, so the hamburger (no `flex: none`) shrinks. Not caused by T-19, introduced by the T-15 lang switch; found while checking BUG-9 at 360. No scroll/overlap problem. Fix: `.nav-toggle { flex: none }` and let the pill shrink/wrap, or extend the wrap breakpoint to <= 363 px. | `tests/e2e/reflow.mjs` `RF-target44` x4 (`nav-toggle:40x48`); sweep `.../qa4/sweep.mjs`.

### Observations (not defects)
- The English-group inputs use `aria-label`s ("Заглавие на събитието на английски", "Име на английски: <dish>") that replace the visible label text (e.g. "Заглавие (английски)"); both are Bulgarian and unique, fine for screen readers, but the speech-input "label in name" rule (WCAG 2.5.3) is only loosely met. Not tested with real AT.
- Server 400 on En fields cannot occur from the UI (inputs have `maxlength`); the UI tests use a mocked 400 in the exact shape the real server returns (field keys verified by the API test `I10`).

## Retest T-20 - 2026-11-16, branch `feature/admin-cms` @ c376609 (targeted + shared-code regression)

Verdict: **FAIL (minor only)** - BUG-8, BUG-9, BUG-10 **VERIFIED-FIXED**; new BUG-11 (minor). 0 blocker, 0 major open.

- BUG-8: `RACE1..6` all PASS (RACE1-3 were failing; RACE4-6 controls pass). BUG-9: `a11y.mjs` `A10b` 320/320; new `tests/e2e/reflow.mjs` over `/` and `/daily-menu` x BG/EN x 320/340/360: no horizontal scroll, 5 header controls rendered inside the viewport and hit-testable, visual order = DOM order, tab order skip-link > logo > pill > БГ > EN > hamburger, nav opens without overflow, no console errors/failed requests (84/88; the 4 failures are BUG-11, 44 px width at 360). Lang switch buttons are 44x44, pill 44 px high at all widths.
- BUG-10: `AEV6b` and `AMN8b` PASS at 390/768/1280. Additionally `reflow.mjs` `RL1..RL4` call the shared renderers with an explicit `lang` on a BG page: EN gives "Event", "Saturday, 20 June 2026, 20:00", "€4.50"; BG output and default behaviour unchanged.
- Regression (shared code `render.js`, `format.js`, `i18n.js`, `style.css` changed): e2e public 89/89, admin 117/117, a11y 48/48, design 22/22, i18n 240/240 (XSS checks included: 0 failures).
- NOT RUN: `npm test`, `tests/api/*` (security, publication, menu, i18n): server code unchanged since their PASS at 0c81447 (skip-if-unchanged, CLAUDE.md tier 3; the always-run XSS rule is covered by the e2e XSS checks, which ran). Real devices, Firefox, WebKit.

## Retest T-21 - 2026-11-16, branch `feature/admin-cms` @ 5884ce2 (BUG-11, CSS-only change)

Verdict: **PASS** - BUG-11 **VERIFIED-FIXED**; 0 defects open.

- `git diff c376609..5884ce2` (product code): `public/css/style.css` only - `.nav-toggle { flex: none }`, header-wrap media query `max-width: 359px` -> `379px`.
- `reflow.mjs` 88/88 (the 4 `RF-target44` at 360 px now pass), `a11y.mjs` 48/48, `public.mjs` 89/89.
- Width sweep (ad hoc script, every width 320..420 px, `/` and `/daily-menu`, BG and EN = 404 combos): no horizontal scroll, hamburger exactly 48x48 (>= 44), all 5 header controls rendered, inside the viewport and hit-testable, lang buttons and pill >= 44 px, no console errors/failed requests: 0 failures. Layout switches from wrapped to one row at 369 px (BG) / 365 px (EN), so the 370-379 px wrap rule is inert there (content fits one row).
- 380 and 390 px unchanged: header geometry (every header link/button/row, x/y/size) compared with the `c376609` stylesheet (served via request interception) at 380, 381, 390, 400, 412, 420, 768, 1280 on `/` and `/daily-menu` x BG/EN = 32 combos, 0 differences (control: 360 and 375 px differ in all 8 combos, so the comparison does detect the change). 375 px (a common phone width) now wraps to two rows by design.
- NOT RUN (skip-if-unchanged, CSS header rules only): e2e admin, design, i18n; `npm test`, `tests/api/*` (server code unchanged). Real devices, Firefox, WebKit.

## Retest T-22 - 2026-11-16, branch `feature/admin-cms` @ 2ef9c11 (header wrap breakpoint 379 -> 368 px, CSS-only)

Verdict: **PASS** - 0 defects open.

- `git diff 5884ce2..2ef9c11` (product code): `public/css/style.css` only - header-wrap media query `max-width: 379px` -> `368px` (`.nav-toggle { flex: none }` kept).
- `reflow.mjs` 88/88, `a11y.mjs` 48/48, width sweep 320..420 px (`/`, `/daily-menu`, BG, EN = 404 combos) 0 failures (no scroll, hamburger exactly 48x48, 5 controls visible/in viewport/hit-testable, targets >= 44, no console errors/failed requests).
- Edge check (`/`, BG and EN at 320, 360, 364, 365, 368, 369, 370, 375, 390, 414, 420): computed `flex-wrap` is `wrap` at <= 368 and `nowrap` at >= 369; BG header is one row (80 px) at every width 369-420 and two rows (126 px) at <= 368; EN is one row at 369-420 and also at 365-368 (content fits, wrap rule inert), two rows at <= 364. No horizontal overflow at any checked width; hamburger 48x48 everywhere. 375 px is a one-row header again (supersedes the T-21 remark that 375 wrapped).
- NOT RUN (skip-if-unchanged, CSS header media query only): e2e public (last 89/89 at 5884ce2), admin, design, i18n; `npm test`, `tests/api/*` (server code unchanged). Real devices, Firefox, WebKit.

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

BUG-24 | minor | frontend-developer | Admin -> Обедно меню -> "Редактирай" on a menu that has an English file; look at the English block buttons. | "Премахни английския файл" / "Върни английския файл" (the wording before D-62, asserted by langs.mjs ED1/ED2). | "Премахни английският файл" / "Върни английският файл" (the button label is built from the nominative "Английският файл" with `.toLowerCase()`, `public/admin/js/daily.js` ~l.327-328; ungrammatical). | `node tests/e2e/daily2.mjs` AD3h0 prints `["Премахни английският файл","Избери файл","Премахни втората страница","Избери файл"]`; `tests/e2e/langs.mjs` ED1 + C-EDIT fail (and follow-ups ERR-3..413g); on a scratch copy with only this wording patched langs.mjs is 155/159 = baseline.

BUG-25 | minor | frontend-developer | Open `/daily-menu` with a published 2-page image menu (or the home slider with 2+ pages), click the first image, press ArrowRight, ArrowRight (second is a no-op at the end), then ArrowLeft. | Back on page 1: keyboard focus stays inside the dialog. | Stays on "Страница 2 от 2": when "Следваща" becomes disabled the focused button loses focus, `document.activeElement` is `BODY`, and the dialog's keydown handler (`public/js/lightbox.js` ~l.52) no longer receives the keys; only mouse "Предишна" or Tab recovers. `lightbox.js` itself was not changed by T-60/T-61 but is newly reachable by every 2-page daily menu and the 15-page home. | `node tests/e2e/daily2.mjs` PUB4b[two/bg|en/390|1280]: `pos=Страница 2 от 2 active=BODY`.

BUG-26 | major | frontend-developer | Admin -> Обедно меню (fresh wizard, step 1): choose a Bulgarian first file, then a Bulgarian second page, then press "Премахни" on the FIRST file. | The second page is dropped too and both language blocks keep their file choosers (Next disabled until a file is chosen again). | Both the Bulgarian and the English block lose their uploaders (0 `input[type=file]` left, only the `<h4>` headings), "Напред" stays disabled: dead end until the page is reloaded. Cause (suspected): `syncSecond()` in `step1()` calls `upl2.clear()` whose `onChange` re-enters `renderWizard()` while step 1 is still being built, so the shared `upl.el` ends up in the discarded tree. EN block not separately reproduced. | `node tests/e2e/daily2.mjs` AD2b: `file inputs left in the wizard: 0 (BG block text: "Български файл")`; screenshot `$QA_SCRATCH/shots/daily2-BUG-wizard-no-uploaders.png`.

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

## Launch polish verification (T-25) - 2026-11-17, `545c0ad` (full tier)

Verdict: **PASS** - 0 defects found (no BUG-12+). Run order and commands: see `tests/README.md`; evidence is the per-check output of `tests/e2e/launch.mjs` (915 checks).

Covered by `tests/e2e/launch.mjs` (new) unless noted:
- **Fonts / no third parties:** `/`, `/daily-menu`, `/privacy`, `/no-such-page`, `/admin/` x BG+EN x 390/768/1280: every request recorded via `context.on('request')` goes to 127.0.0.1 (0 external); all 8 woff2 files 200, `font/woff2`, `Cache-Control: public, max-age=2592000` (HTTP and in-browser responses); Cyrillic face loaded on BG pages and Latin face on EN pages for both Oswald and Source Sans 3 (`document.fonts`), and the rendered glyphs use the custom faces (CDP `CSS.getPlatformFontsForNode`, not a system fallback); CSS/JS keep `no-cache`; no `googleapis/gstatic` string in `public/`.
- **CSP:** exact policy string asserted (`style-src 'self'; font-src 'self'`), checked on 9 URLs incl. API, font, 404; zero `securitypolicyviolation` events and zero console errors on all pages/viewports; no inline `<style>`, inline script, `style=""`, or external `href/src` in the 5 HTML documents.
- **404:** `/no-such-page` (+ nested, `.html`, `/privacy/x`, `/PRIVACY`, unknown font/js) with `Accept: text/html` -> 404 + 404.html, noindex, no-cache; HEAD too; BG/EN, language switch, home/daily/footer/logo links work and keep `?lang`; `/api/nope`, `/media/nope`, any non-GET, and `Accept: json | */* | image/png | (none)` -> JSON; traversal/hidden-file probes (10) leak nothing, malformed `%` -> no 500.
- **SITE_URL:** unset -> token replaced by `''` (og:url `/`, og:image `/images/og-image.png`); `https://kota.example.com/` -> absolute `og:url`/`og:image`/`twitter:image` on `/`, `/daily-menu`, `/privacy`, no double slash; token never served on any of 10 HTML URLs (with and without SITE_URL); 8 invalid values (not a URL, no scheme, ftp, javascript:, credentials, query, fragment, `https://`) -> exit != 0 with message, never listens; empty/whitespace = unset; SITE_URL with `"><script>` does not break out of the attribute; ETag/304 revalidation works on replaced body; only the 3 expected files contain the token in source.
- **OG/Twitter:** present and consistent with `<title>`/meta description on 3 pages (og:type restaurant/website, locale bg_BG + alternate en_GB, card summary_large_image); `og-image.png` is a real 1200x630 PNG (313 kB), 200 `image/png`.
- **Favicons:** svg (image/svg+xml, no script), 32x32 png, 180x180 apple-touch-icon: 200, right types, linked from `/`, `/daily-menu`, `/privacy`, 404 and `/admin/`.
- **Privacy / footer:** BG/EN render (one h1, 5 h2, title/lang/meta), bracket placeholders visible (`[N]`, hosting provider, controller; contact placeholder when phone+address unset), no stray Cyrillic in EN, contact shows well-formed `tel:`; cookie/localStorage claim consistent with behaviour; footer link on `/`, `/daily-menu`, `/privacy`, 404: href keeps `?lang=en`, follows the language switch, click lands on `/privacy` in the right language; footer link target >= 44 px, text contrast >= 4.5 (computed).
- **Map link:** href exactly `https://www.google.com/maps/search/?api=1&query=%D1%83%D0%BB.%20%D0%A0%D0%B0%D0%BB%D0%B5%D0%B2%D0%B8%D1%86%D0%B0%2085%2C%20%D0%A1%D0%BE%D1%84%D0%B8%D1%8F` for "ул. Ралевица 85, София" (expected value computed independently with Python); EN address -> EN link; `target=_blank`, `rel="noopener noreferrer"`, accessible name "... (opens in a new tab)", Tab-reachable with visible focus, >= 44 px, contrast >= 4.5, no horizontal scroll, click opens a new tab (Google stubbed, `window.opener === null`); hidden when address empty or whitespace; no Google request on page load; language switch updates the link.
- **Injection (12 payloads x BG/EN x 3 viewports):** `"><img src=x onerror=window.__xss=1>`, `javascript:alert(1)`, `'><script>`, `https://evil.example/phish`, `//evil.example`, `x&api=2&query=evil`, `#frag`, `?b=c`, `</a><a href=evil>`, CRLF, RTL override, attribute-injection: link always `https://www.google.com/maps/search/` with exactly the params `api,query` and `query` equal to the payload, no `window.__xss`, no injected element/attribute, address and privacy contact shown as inert text.

Notes (not defects):
- `public/404.html` intentionally has no OG/canonical tags (noindex page); the token is absent there.
- `/favicon.ico` is not provided (JSON 404); browsers use the `<link rel=icon>` tags.
- Chromium logs "Failed to load resource" for the intentional 404 document and for the logged-out admin `GET /api/admin/me` 401; `launch.mjs` allows exactly these two.
- On the admin login screen only Source Sans 3 Cyrillic is requested (no Oswald Cyrillic text on that screen); the test accounts for it.
- Not run: real-network checks (real Google Maps page, real social-network crawlers), Lighthouse, screen reader.

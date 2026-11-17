# Task board

Owned by the Project Manager. Format: see `CLAUDE.md`. Branch: `feature/admin-cms`.

## Done
### T-0: Team setup smoke test — done, PASS (see `docs/TESTING.md`)

## Milestone 1 — Admin CMS (Events, Daily Menu, Regular Menu, Admin)

### T-1: Design spec for public features and admin dashboard
- Agent: ui-ux-designer
- Depends on: none (reads `docs/ARCHITECTURE.md`)
- Description: Extend `docs/DESIGN.md` with the event banner, daily-special button + `/daily-menu` page, dynamic regular menu (structured + file modes), and the full admin dashboard (login, dashboard, events, daily menu, regular menu, settings), mobile-first, Bulgarian labels.
- Acceptance criteria:
  - AC1 Every screen/state in the requirements is specified (empty, loading, error, success, draft vs published, confirm dialogs, upload progress)
  - AC2 Exact tokens, breakpoints and component specs; preserves current KOTA 1 identity
  - AC3 Accessibility notes incl. computed contrast for new colour pairs
  - AC4 Complete Bulgarian (+ English where public) label list
- Status: done
- Deliverables: `docs/DESIGN.md`
- Verification: PM review OK. Open points resolved as D-15..D-18. Layout widths computed, not rendered → design review after T-3/T-4. Bulgarian copy not native-reviewed.

### T-2: Backend — server, DB, auth, APIs, uploads
- Agent: backend-developer
- Depends on: none (implements `docs/ARCHITECTURE.md` contract)
- Description: Implement everything in `docs/ARCHITECTURE.md` under `server/`, plus `package.json`, `.env.example`, admin CLI scripts and backend tests.
- Acceptance criteria:
  - AC1 Every endpoint in the contract implemented with the documented status codes and shapes
  - AC2 Auth: sessions, CSRF header/origin check, login rate limiting, TOTP, password change, CLI create/reset; no registration
  - AC3 Publication rules (events window, daily menu = today Sofia, menu mode + snapshot) enforced server-side; `/media` visibility rule
  - AC4 Upload validation by magic bytes + size limits; safe names; old files deleted
  - AC5 Data persists across restart; migrations idempotent
  - AC6 `npm test` passes, covering auth, authorisation of every admin route, time rules incl. DST, uploads
- Status: done
- Deliverables: `package.json`, `package-lock.json`, `server/**`, `.env.example`
- Verification: backend's own `npm test` 32/32 pass, re-run by PM 32/32 pass. Independent QA pending (T-5). Unverified: TTY password prompt, production cookie flags via server.js, reverse proxy.

### T-3: Frontend — public site integration
- Agent: frontend-developer
- Depends on: T-1, T-2
- Description: Event banner, "Обедно меню / Daily Special" button + `/daily-menu` page, dynamic "Меню / Menu" section, phone/address/hours from settings. Preserve existing look.
- Status: review
- Deliverables: `public/index.html`, `public/daily-menu.html`, `public/css/`, `public/js/`
- Verification: developer self-test with Playwright at 390/768/1280 on 4 content scenarios: 0 console/CSP errors, no horizontal scroll. Unverified: embedded PDF `<object>` (headless has no PDF viewer), keyboard walkthrough, real fonts. Awaiting QA (T-5).

### T-4: Frontend — admin dashboard
- Agent: frontend-developer
- Depends on: T-1, T-2
- Description: `/admin` SPA: login (+TOTP), dashboard, events, daily menu, regular menu (visual editor + files + mode), settings (password, 2FA, site info), logout.
- Status: review
- Deliverables: `public/admin/**`
- Verification: developer Playwright run of all flows at 390 (+768/1280 spot checks), 0 CSP/page errors, 2 layout bugs self-fixed. Unverified: server-side 400 `fields` mapping, toggle rollback, `nothing_published`, PDF `<object>`, keyboard/screen reader. Awaiting QA (T-5) + design review (T-9).

### T-5: QA — full functional, security and responsive test pass
- Agent: qa-security-engineer
- Depends on: T-3, T-4
- Description: All scenarios from the requirements (events, daily menu, regular menu, security, compatibility) as automated tests in `tests/`.
- Status: done
- Deliverables: `tests/**`, `docs/TESTING.md`
- Verification: verdict FAIL (4 minor): API 80/80, browser 246/251; all required scenarios PASS except admin UI minor BUG-1..4 → T-11, T-12

### T-6: DevOps — deployment readiness
- Agent: devops-engineer
- Depends on: T-2 (can run alongside T-5)
- Description: Hosting recommendation, production config, backups of `DATA_DIR`, rollback, run/maintenance docs; validate a production-mode start.
- Status: review
- Deliverables: `docs/DEPLOYMENT.md`, deployment config files, `README.md` run section
- Verification: production-mode run verified by DevOps (secure cookie, KOTA_NOW ignored, internal files 404, headers), backup + restore tested on a copy. NOT RUN: Caddy, Docker, real server. Hosting choice awaits user (D-19).

### T-7: Admin user guide (Bulgarian/English)
- Agent: PM (with designer review if needed)
- Depends on: T-4
- Status: review
- Deliverables: `docs/ADMIN-GUIDE.md`
- Verification: written from DESIGN.md + labels extracted from admin code; re-check against final UI after the fix loop

### T-8: Backend hardening — HOST binding + admin:disable-2fa CLI
- Agent: backend-developer
- Depends on: T-2
- Description: findings 2 and 3 of the DevOps review (D-20)
- Status: done
- Verification: `npm test` 33/33 (re-run by PM); loopback bind confirmed by startup log + curl. Docs updated by PM.
- Deliverables: `server/src/server.js`, `server/scripts/`, tests

### T-9: Design review of implemented public site and admin
- Agent: ui-ux-designer
- Depends on: T-3, T-4
- Status: done — 11 findings (BUG-D1..D11, 3 major); spec updates D-22..D-26 by PM
- Deliverables: findings in handoff report (BUG format)

### T-10: Frontend fixes for design review BUG-D1..D11
- Agent: frontend-developer (isolated worktree)
- Depends on: T-9
- Status: review — merged (180f07d); awaiting QA retest (T-13)
- Deliverables: `public/**` changes, merged by PM after review; QA retest

### T-11: Fix BUG-4 (CRLF newlines counted twice) — attempt 1
- Agent: backend-developer
- Status: review — `npm test` 35/35 (PM re-run); awaiting QA retest

### T-12: Fix BUG-1..3 (admin bottom overlap, dish aria-labels, lost click) — attempt 1
- Agent: frontend-developer
- Status: review — QA's checks AV-COVER/EDGE1-3 pass in dev run; BUG-1 was already fixed by T-10. Dev found admin.mjs steps E/X/M failing since the T-10 merge → triage in T-13

### T-13: QA regression + retest of BUG-1..4 and D1..D11
- Agent: qa-security-engineer
- Depends on: T-11, T-12
- Status: in-progress

## Milestone 2 — БГ / EN language switch (D-27)
### T-14: Backend i18n — migration 002, `*En` fields, `?lang=` on public API
- Agent: backend-developer (worktree) · Status: merged (f0f7cd5) — awaiting QA T-17
### T-15: Public site i18n — switch, dictionary, EN rendering
- Agent: frontend-developer (worktree) · Status: merged — awaiting QA T-17
- QA focus for T-17: 360/768 widths; EN for PDF/file-mode menu, lightbox, no-menu state; localStorage blocked; **rapid БГ/EN toggling on slow network (index page has no stale-response guard — possible race)**; CSP-enforcing run
### T-16: Admin English input fields (events, menu, settings)
- Agent: frontend-developer (worktree) · Status: merged — awaiting QA T-17. QA focus: server 400 on En fields, 768, keyboard on <details> groups
### T-17: QA targeted i18n tests + full regression before release
- Agent: qa-security-engineer · Status: done — BUG-5..7 verified; found BUG-8..10 (169,994 tokens)

### T-13: QA regression run 2 — done: BUG-1..4 verified fixed, D1..D11 9/11 verified, BUG-5..7 found (108,187 tokens)
### T-18: Fix BUG-5..7 (admin CSS) — done, dev ran QA checks: design 22/22, TOAST-OVERLAP pass (18,355 tokens); awaiting QA retest

### T-19: Fix BUG-8..10 — done (43,560 tokens) · T-20 QA retest: verified, found BUG-11 (48,779)
### BUG-11 fix by PM (one-line CSS) · T-21 QA: verified (32,662) · breakpoint refined by PM · T-22 QA: PASS, 0 open defects
**Release candidate: feature/admin-cms. Awaiting user approval for hosting + production deploy.**

## Milestone 3 — Launch polish (D-29..D-33)
### T-23: Server: CSP font-src self, HTML 404, SITE_URL token, /privacy — backend-developer · done (32,468 tokens)
### T-24: Frontend: self-hosted fonts, favicon, 404 page, OG meta + image, privacy page, map link — frontend-developer · done (67,238 tokens)
### T-25: QA targeted + regression — done, PASS at 545c0ad, 0 defects
**Release candidate 545c0ad. Awaiting user: hosting choice, privacy placeholders, go-live approval.**

## Measured agent usage (from task notifications; tokens = runtime `subagent_tokens`, cost not reported per agent)
T-1 77,568 · T-2 91,126 · T-3 107,662 · T-4 192,926 · T-5 265,260 · T-6 106,051 · T-8 18,626 · T-9 135,887 · T-10 77,562 · T-11 24,438 · T-12 35,570 · T-13 108,187 (two segments, rate-limit pause) · T-14 55,482 · T-15 91,850 · T-16 82,018 · T-17 169,994 · T-18 18,355 · T-19 43,560 · T-20 48,779 · T-21 32,662 · T-22 (see notification) · T-43 293,594 (QA round 3 + download, PASS, no defects)

## Future
- Table management / Маси — see `docs/FUTURE-TABLES.md` (not started).

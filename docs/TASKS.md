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
- Status: in-progress
- Deliverables: `tests/**`, `docs/TESTING.md`

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
- Status: in-progress
- Deliverables: findings in handoff report (BUG format)

## Future
- Table management / Маси — see `docs/FUTURE-TABLES.md` (not started).

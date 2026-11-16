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
- Status: in-progress
- Deliverables: `docs/DESIGN.md`
- Verification: PM review

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
- Status: in-progress
- Deliverables: `package.json`, `package-lock.json`, `server/**`, `.env.example`
- Verification: not yet verified

### T-3: Frontend — public site integration
- Agent: frontend-developer
- Depends on: T-1, T-2
- Description: Event banner, "Обедно меню / Daily Special" button + `/daily-menu` page, dynamic "Меню / Menu" section, phone/address/hours from settings. Preserve existing look.
- Status: todo
- Deliverables: `public/index.html`, `public/daily-menu.html`, `public/css/`, `public/js/`

### T-4: Frontend — admin dashboard
- Agent: frontend-developer
- Depends on: T-1, T-2
- Description: `/admin` SPA: login (+TOTP), dashboard, events, daily menu, regular menu (visual editor + files + mode), settings (password, 2FA, site info), logout.
- Status: todo
- Deliverables: `public/admin/**`

### T-5: QA — full functional, security and responsive test pass
- Agent: qa-security-engineer
- Depends on: T-3, T-4
- Description: All scenarios from the requirements (events, daily menu, regular menu, security, compatibility) as automated tests in `tests/`.
- Status: todo
- Deliverables: `tests/**`, `docs/TESTING.md`

### T-6: DevOps — deployment readiness
- Agent: devops-engineer
- Depends on: T-2 (can run alongside T-5)
- Description: Hosting recommendation, production config, backups of `DATA_DIR`, rollback, run/maintenance docs; validate a production-mode start.
- Status: todo
- Deliverables: `docs/DEPLOYMENT.md`, deployment config files, `README.md` run section

### T-7: Admin user guide (Bulgarian/English)
- Agent: PM (with designer review if needed)
- Depends on: T-4
- Deliverables: `docs/ADMIN-GUIDE.md`

## Future
- Table management / Маси — see `docs/FUTURE-TABLES.md` (not started).

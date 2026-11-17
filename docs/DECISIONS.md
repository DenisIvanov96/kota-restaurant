# Decisions log (append-only)

| ID | Date | Decision | Why | Decided by |
|---|---|---|---|---|
| D-1 | 2026-11-16 | Static HTML/CSS/vanilla JS, no build step | Small restaurant site; simplest reliable option | PM |
| D-2 | 2026-11-16 | Google Fonts (Oswald, Lato) | Closest free match to the KOTA 1 sign lettering | PM |
| D-3 | 2026-11-16 | Hosting target GitHub Pages (pending user approval to enable) | Free, repo already on GitHub | PM |
| D-4 | 2026-11-16 | PM runs as main session; 5 specialists as subagents | Claude Code subagents cannot spawn subagents | PM |
| D-5 | 2026-11-16 | Add a Node.js (Express) server; the site is no longer purely static | Admin CMS needs server-side storage, auth and time-based publishing | PM |
| D-6 | 2026-11-16 | SQLite via built-in `node:sqlite` + uploads on local disk (`DATA_DIR`) | Zero external services, no native build; single-restaurant traffic. Risk: `node:sqlite` is flagged experimental in Node 22 → pin Node ≥ 22.13 and cover with tests | PM |
| D-7 | 2026-11-16 | Runtime deps limited to `express` + `multer`; scrypt/TOTP via Node `crypto` | Avoid unnecessary dependencies | PM |
| D-8 | 2026-11-16 | Static site moved into `public/`; only that folder is served | Prevents exposing server code, DB and env files | PM |
| D-9 | 2026-11-16 | API speaks Sofia-local date-time strings; server owns all timezone logic | Admin is in Bulgaria; avoids browser/DST bugs | PM |
| D-10 | 2026-11-16 | Structured menu: editable draft tables + immutable published snapshots | Drafts never leak; published menu survives until replaced; history kept | PM |
| D-11 | 2026-11-16 | Password recovery by server-side CLI reset; e-mail recovery deferred | No e-mail service configured; adding one needs credentials + user approval | PM |
| D-12 | 2026-11-16 | Prices stored as integer cents; currency symbol is a setting (default `€`, Bulgaria uses the euro since 2026-01-01) | Exact money maths; easy to change | PM |
| D-13 | 2026-11-16 | GitHub Pages can no longer host the site (needs a server). Hosting choice deferred to DevOps recommendation + user approval | Paid/external service changes need approval | PM |
| D-14 | 2026-11-16 | Work on branch `feature/admin-cms`; `main` unchanged until the user approves | No production change without approval | PM |
| D-15 | 2026-11-16 | All API date-time fields use Sofia-local `YYYY-MM-DDTHH:mm`, including created/updated/published timestamps | Designer T-1 open point 1; one format for the frontend | PM |
| D-16 | 2026-11-16 | Unpublishing the live menu file while mode=`file` → 409 `in_use` (same as delete) | Designer T-1 open point 2; customers must never lose the menu by accident | PM |
| D-17 | 2026-11-16 | 2FA setup is manual (secret key + `otpauth://` link), no QR library | Designer T-1 open point 3; avoids a dependency; QR can be added later | PM |
| D-18 | 2026-11-16 | Admin uses a light theme with dark brand chrome; public site stays dark | Designer T-1; legibility on phones in daylight | Designer, accepted by PM |
| D-19 | 2026-11-16 | **Proposed, awaiting user approval:** production host = small EU VPS + Caddy (auto-HTTPS) + systemd, nightly encrypted backups. Supersedes D-13 | Persistent disk, predictable low cost, no rewrite; alternatives in `docs/DEPLOYMENT.md` §2 | DevOps, PM — user to decide |
| D-20 | 2026-11-16 | Server binds to `HOST` (default 127.0.0.1); new `admin:disable-2fa` CLI | DevOps review: don't expose app port directly; 2FA recovery without manual SQL | PM |
| D-21 | 2026-11-16 | WIP checkpoint commits on the feature branch are kept (not rewritten) | Feature branch only; final reviewed state is what matters; rewriting history adds risk | PM |
| D-22 | 2026-11-16 | Body font Lato → Source Sans 3 (Cyrillic) on public site and admin | Design review BUG-D3: Google's Lato has no Cyrillic, Bulgarian text fell back to random system fonts | PM (designer finding) |
| D-23 | 2026-11-16 | Menu categories never split across CSS columns | BUG-D4 | PM |
| D-24 | 2026-11-16 | Admin sticky action bar: buttons side by side on mobile | BUG-D5: bar took 22% of a phone screen | PM |
| D-25 | 2026-11-16 | Admin previews use container queries (frame width), not viewport | BUG-D2: previews were wrong on desktop | PM |
| D-26 | 2026-11-16 | Mobile nav panel omits "Обедно меню" (pill always visible) — accepted | BUG-D6 part 1 | PM |
| D-27 | 2026-11-16 | Public site gets a БГ / EN language switch covering UI text and content; content has optional English fields with Bulgarian fallback; admin stays Bulgarian | User request after preview ("Everything", "Admin stays Bulgarian") | User |
| D-28 | 2026-11-16 | Language fallback resolved server-side via `?lang=`; choice persisted in URL + localStorage | Keeps public JS simple; shareable English links | PM |
| D-29 | 2026-11-17 | Self-host fonts; no Google Fonts requests | GDPR: Google Fonts transmits visitor IPs to Google (user approved) | User |
| D-30 | 2026-11-17 | SVG + PNG favicons from the KOTA 1 mark | User request | User |
| D-31 | 2026-11-17 | HTML 404 page (status 404) for page requests; JSON 404 stays for API | User request | User |
| D-32 | 2026-11-17 | Open Graph/Twitter meta with `SITE_URL` env token replacement | Social link previews need absolute URLs; domain not chosen yet | PM |
| D-33 | 2026-11-17 | Privacy notice draft page; map as an outbound link, not an embed | GDPR basics; an embedded map would load Google on every visit | PM |
| D-34 | 2026-11-17 | Reservation phone bar always visible & sticky on all public pages | Owner request | User |
| D-35 | 2026-11-17 | Custom dd.mm.yyyy + 24h pickers in admin; browser locale ignored | Owner saw US AM/PM format from native inputs | User |
| D-36 | 2026-11-17 | `instagramUrl` setting + Instagram icon link (placeholder to instagram.com when empty) | Owner request | User |
| D-37 | 2026-11-17 | Always-visible Location section; default address seeded if empty | Owner couldn't find location; address given by owner | User |
| D-38 | 2026-11-17 | `/reservation` page with sample floor plan, call button, location; real plan later | Owner request | User |
| D-39 | 2026-11-17 | Event BG/EN tabs incl. optional EN photo; title required in ≥1 language; bidirectional fallback | Owner: "banner should have 2 different places", fallback "whatever is available" | User (recommended options applied; user answered by message) |
| D-40 | 2026-11-17 | Regular menu: shared structure/prices, BG/EN tabs; whole-menu files per language | Owner wants separate BG/EN menus; shared prices avoid double maintenance (can switch to fully independent menus if owner prefers) | PM default, owner may revise |
| D-41 | 2026-11-17 | Daily menu: optional EN file per date with fallback | Owner wants language-specific menus | PM default |
| D-42 | 2026-11-17 | EN media follow the same public-visibility rules | Security | PM |
| D-43 | 2026-11-17 | Settings address/hours follow the same bidirectional fallback (BG empty → EN shown) | Owner rule "display whatever is available"; resolves BUG-18 as intended behaviour | PM |
| D-44 | 2026-11-17 | 50 MB per uploaded file; one file per request; disk temp storage | Owner request; avoids huge requests and memory spikes | User |
| D-45 | 2026-11-17 | Daily menus from past days are deleted automatically on each new upload; today + future kept | Owner: "old ones should be deleted"; keeping today/future protects advance uploads | PM interpretation, owner may revise |
| D-46 | 2026-11-17 | Regular menu file mode = up to 10 ordered pages per language with per-language publish | Owner's menu is 5–10 pages | User |

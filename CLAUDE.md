# Website Development Team — shared rules

This repository is built by a coordinated AI team. The **main Claude session is the Project Manager (PM)**; it loads its playbook with the `/pm` skill (`.claude/skills/pm/SKILL.md`). Five specialists are Claude Code subagents in `.claude/agents/`:

| Agent | File | Model · effort | Active when |
|---|---|---|---|
| Project Manager / Orchestrator | main session + `/pm` skill | Opus · medium (session setting) | always |
| UI/UX Designer | `ui-ux-designer` | Sonnet · medium | new pages, visual changes, design review |
| Frontend Developer | `frontend-developer` | Sonnet · medium | any UI code change |
| Backend Developer | `backend-developer` | Sonnet · high | only if server-side features are required |
| QA / Security Engineer | `qa-security-engineer` | Sonnet · high | verification of every deliverable |
| DevOps / Deployment | `devops-engineer` | Haiku · low | hosting, CI, release prep |

Subagents cannot spawn other agents; all delegation and all communication goes through the PM.

## Shared documents (single source of truth)
- `docs/TASKS.md` — task board (PM owns; agents update only their own task's status/results via their report)
- `docs/DECISIONS.md` — technical decisions log (append-only)
- `docs/ARCHITECTURE.md` — stack, structure, API contracts
- `docs/DESIGN.md` — design spec (Designer owns)
- `docs/TESTING.md` — test plan and latest results (QA owns)
- `docs/DEPLOYMENT.md` — hosting, release and rollback (DevOps owns)

## Rules for every agent
1. Stay inside your role and the task you were given. Do not edit files another agent owns; report the need instead.
2. Prefer the simplest reliable solution. No new framework, dependency or service without a `docs/DECISIONS.md` entry.
3. Never commit or print secrets, API keys or personal data. Secrets live in environment variables / hosting settings only.
4. Never invent results. Separate **Done (verified)**, **Done (unverified)**, **Assumptions** and **Not done** in every report.
5. Work only inside this repository and the session scratchpad.
6. Actions that need the **user's explicit approval** (PM escalates, nobody else does them): production deploys — including pushing to `main` once the site is live on GitHub Pages — deleting important files or data, changing external services/cloud/DNS/repo settings, anything that costs money, accessing external accounts, sending project data to new third-party services, irreversible git operations.
7. Accessibility, responsiveness (390 / 768 / 1280 px) and basic security are part of "done", not extras.

## Task format (docs/TASKS.md)
```
### T-<n>: <title>
- Agent: <agent name>
- Depends on: <task ids or none>
- Description: <what and why>
- Acceptance criteria:
  - AC1 ...
- Status: todo | in-progress | blocked | review | done
- Deliverables: <files / docs>
- Verification: <QA result summary, or "not yet verified">
```

## Handoff report (every subagent ends with this)
```
## Handoff report — T-<n>
Agent: <name>
Status: done | blocked | partial
Changed files: <list>
Done (verified): <what, and how it was verified — commands run>
Done (unverified): <what was not checked>
Assumptions: <choices made without explicit instruction>
Blockers / needs approval: <or none>
Handoff to: <next agent and what they need>
```

## Efficiency rules (all agents)
- **Read only what the brief names.** Briefs list the files and doc *sections* to read. Don't re-read whole docs or sweep the repository; use Grep/targeted reads.
- **Reuse the test harness** in `tests/lib/` (server start, admin login, seeding) instead of writing one-off seed scripts.
- **Use git, not memory:** `git diff <base>..HEAD --stat` tells you what changed; touch and test only that.
- **Concise reports:** handoff report only. Full evidence (steps, command, output excerpt, screenshot path) is required for failures; passes need only the count and the command.

## Testing tiers (see `docs/TESTING.md` → "Test policy")
1. **Targeted** (during development, by the developer and for QA retests): tests for the changed functionality, the integrations it touches, and the security checks relevant to the change.
2. **Owner rule (2026-11-17): test only what changed and what connects to it.** QA tests the changed feature plus the features that directly use the changed code (e.g. a change to the About section → About section, its admin editor, the settings API and the home page; not the gallery, menus or events). A change to shared code (`render.js`, `i18n.js`, `common.js`, `lightbox.js`, `components.css`, `files.js`, `store.js`, `http.js`, `auth.js`) is tested on the features that use the changed function/rule, found with `git diff` + Grep, not by running every suite. **Full regression only once, right before a production release** (go-live), or when the owner asks.
3. **Skip-if-unchanged:** don't re-run a suite whose covered code and test environment are unchanged since its last recorded PASS (QA records the commit hash per suite in `docs/TESTING.md`).
4. **Never skipped when their area changes:** the security suites for authentication, authorisation, CSRF, file uploads and XSS (`tests/api/security.test.mjs` + the XSS checks in e2e) run on every change to `server/**`, to upload handling, or to any code that renders user content.
5. **Bug fixes are always re-verified independently by QA** (not by the developer who fixed them). Max 3 fix attempts per bug, then escalate.

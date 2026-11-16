# Website Development Team — shared rules

This repository is built by a coordinated AI team. The **main Claude session is the Project Manager (PM)**; it loads its playbook with the `/pm` skill (`.claude/skills/pm/SKILL.md`). Five specialists are Claude Code subagents in `.claude/agents/`:

| Agent | File | Model | Active when |
|---|---|---|---|
| Project Manager / Orchestrator | main session + `/pm` skill | session model | always |
| UI/UX Designer | `ui-ux-designer` | sonnet | new pages, visual changes, design review |
| Frontend Developer | `frontend-developer` | sonnet | any UI code change |
| Backend Developer | `backend-developer` | sonnet | only if server-side features are required |
| QA / Security Engineer | `qa-security-engineer` | sonnet | verification of every deliverable |
| DevOps / Deployment | `devops-engineer` | haiku | hosting, CI, release prep |

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

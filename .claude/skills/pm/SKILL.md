---
name: pm
description: Project Manager / Orchestrator playbook for the website development team. Use when the user describes a new website or feature, asks for project status, or wants work planned, delegated to the designer/frontend/backend/QA/devops subagents, tested, or prepared for deployment.
---

# Project Manager / Orchestrator

You (the main session) are the PM. You plan, delegate to subagents with the Agent tool, track work in `docs/TASKS.md`, resolve conflicts, and escalate decisions to the user. You may do trivial edits yourself (typo, one-line copy change) rather than spinning up an agent — but every user-facing change still gets a QA check proportional to its risk.

## 1. Size the request first
- **Tiny** (copy/colour/one element): do it or send one `frontend-developer` task, then a quick QA check. No full cycle.
- **Feature** (new section/page/form): Design → Frontend (+Backend if needed) → QA → fix loop.
- **New site**: all seven phases below.
Activate the fewest agents that do the job. Backend stays inactive for static sites.

## 2. Clarify
Ask the user only what blocks progress (purpose, pages, must-have features, brand assets, hosting preference, real content). Ask at most once per phase, batched. Otherwise make a sensible assumption and record it.

## 3. Phases
1. **Planning** — write the roadmap and tasks into `docs/TASKS.md` (format in `CLAUDE.md`); record stack/hosting choices in `docs/DECISIONS.md` and `docs/ARCHITECTURE.md`.
2. **Design** — `ui-ux-designer` produces/updates `docs/DESIGN.md`.
3. **Development** — `frontend-developer` and, only if needed, `backend-developer`. Run them **in parallel** (multiple Agent calls in one message, `run_in_background: true`) only when they touch different files and the API contract is already fixed in `docs/ARCHITECTURE.md`; otherwise run sequentially.
4. **Testing** — `qa-security-engineer` verifies against acceptance criteria.
5. **Bug resolution** — route each BUG to its owner agent, then have QA retest. Max 3 loops before escalating to the user.
6. **Deployment prep** — `devops-engineer` prepares config and `docs/DEPLOYMENT.md`, stops at the approval point.
7. **Final approval** — summarise to the user: what was built, test results (only what QA actually ran), open risks, what needs their approval. **Do not deploy until the user says so.**

## 4. Delegating
Each Agent call gets `subagent_type` = the agent name and a self-contained prompt containing:
- Task ID, description, acceptance criteria, dependencies' outputs (file paths, decisions)
- Files they may change
- "End with the handoff report from CLAUDE.md."
Subagents start without this conversation's context, so include everything they need.

## 4b. Token efficiency
- Briefs name exact files and doc sections; never "read the docs". Point to `tests/lib/` harness for seeding.
- Pass `effort` only as configured in agent files (they carry it); don't override.
- Fix tasks: small, one owner, targeted tests only. Batch related small bugs into one task.
- Ask QA for: targeted tests of the changed parts + directly connected parts only (owner rule, CLAUDE.md "Testing tiers" 2); full regression only right before a production release or when the owner asks. In every QA brief, list the in-scope suites/features explicitly.
- Use worktrees (`isolation: "worktree"`) only when an agent would otherwise disturb a running QA pass; tell it to `git reset --hard feature/<branch>` first.
- Record per-agent token usage from task notifications in `docs/TASKS.md` (measured), and mark any cost figure as an estimate.

## 5. After each handoff
- Check the report against the acceptance criteria; spot-check claimed changes (`git diff`).
- Update the task's status and verification in `docs/TASKS.md`.
- If two agents conflict, decide (favour the spec in `docs/`), record it in `docs/DECISIONS.md`, and re-brief the affected agent.
- Commit verified work with a clear message. Pushing to the default branch of a live site is a production deploy → needs user approval.

## 6. Progress updates to the user
Short: phase, done, next, anything needing their decision. Never report unverified work as working.

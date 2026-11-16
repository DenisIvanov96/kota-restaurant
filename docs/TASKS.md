# Task board

Owned by the Project Manager. Format: see `CLAUDE.md`.

## Done (before the team was set up)
Starter site for Kota1 built directly in the session: single page (`index.html`), sign-inspired dark theme, reservation phone bar (placeholder `+1234`), placeholder menu/about/contact. Not yet formally QA-tested.

## Active
### T-0: Team setup smoke test
- Agent: qa-security-engineer
- Depends on: none
- Description: Harmless delegation test — read-only check that `index.html` has a `<title>`, exactly one `<h1>`, and a `tel:` link.
- Acceptance criteria:
  - AC1 Agent is invoked by name and returns a handoff report
  - AC2 No files changed
- Status: done
- Deliverables: handoff report only
- Verification: PASS — invoked by name from a fresh Claude Code process; returned handoff report; no files changed (2026-11-16)

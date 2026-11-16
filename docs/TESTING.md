# Testing

Owned by the QA / Security Engineer. Results are recorded only for checks that were actually executed.

## Standard viewports
390×844 (phone), 768×1024 (tablet), 1280×800 (desktop) — Playwright, pre-installed in the environment.

## Latest results
### T-0 smoke test — 2026-11-16 — PASS
Read-only checks on `index.html`: non-empty `<title>`, exactly one `<h1>`, well-formed `tel:+1234` link. Evidence: grep output in the agent's handoff report. Note: `+1234` is a placeholder number.

No full functional/visual QA run yet.

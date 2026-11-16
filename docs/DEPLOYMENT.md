# Deployment

Owned by the DevOps Engineer.

## Target
GitHub Pages from `main` / root of `DenisIvanov96/kota-restaurant` (requires the repo to be public on a free plan). **Not enabled yet — needs user approval.**

## Preview (non-production)
Private claude.ai artifact preview, updated by the PM on request.

## Release procedure (once live)
1. QA verdict PASS on the release commit.
2. User approves the release.
3. Push to `main` → Pages rebuilds (≈1–2 min).
4. Smoke check the live URL at phone and desktop width.

## Rollback
`git revert <bad commit>` → push to `main` (approval required) → smoke check.

## Secrets
None used. If added later: environment variables / hosting settings only; `.env*` is git-ignored, commit only `.env.example`.

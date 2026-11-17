#!/usr/bin/env bash
# Post-deploy smoke check for Kota1. Read-only: makes GET requests only.
#
# Usage: ops/smoke-check.sh https://kota.example.com
#        ops/smoke-check.sh http://localhost:3000     (local run)
#
# Exits 0 when every check passes, 1 otherwise. Warnings do not fail the run.
set -uo pipefail

BASE="${1:?usage: smoke-check.sh BASE_URL}"
BASE="${BASE%/}"
FAILS=0
WARNS=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
warn() { echo "WARN  $*"; WARNS=$((WARNS + 1)); }

# fetch PATH -> sets STATUS, and writes headers to $TMP/h, body to $TMP/b
fetch() {
  STATUS="$(curl -sS --max-time 15 -o "$TMP/b" -D "$TMP/h" -w '%{http_code}' "$BASE$1" || echo 000)"
}
header() { grep -i "^$1:" "$TMP/h" | tail -1 | tr -d '\r' | cut -d' ' -f2- ; }

# 1. Public pages and API
fetch "/"
if [[ "$STATUS" == 200 ]]; then pass "GET / -> 200"; else fail "GET / -> $STATUS"; fi
if grep -qi 'rel="icon"\|rel=icon' "$TMP/b" 2>/dev/null; then pass "home page declares a favicon"; else warn "home page has no <link rel=\"icon\">"; fi

fetch "/api/public/site"
if [[ "$STATUS" == 200 ]]; then pass "GET /api/public/site -> 200"; else fail "GET /api/public/site -> $STATUS"; fi
CC="$(header cache-control)"
[[ "$CC" == *no-store* ]] && pass "api Cache-Control: no-store" || fail "api Cache-Control is '$CC' (want no-store)"
for h in content-security-policy x-content-type-options referrer-policy x-frame-options; do
  if [[ -n "$(header $h)" ]]; then pass "security header present: $h"; else fail "missing security header: $h"; fi
done
[[ "$(header x-content-type-options)" == nosniff ]] && pass "X-Content-Type-Options is nosniff" || fail "X-Content-Type-Options is not nosniff"

fetch "/api/public/daily-menu"
if [[ "$STATUS" == 200 ]] && grep -q '"today"' "$TMP/b"; then pass "GET /api/public/daily-menu -> 200 with today"; else fail "GET /api/public/daily-menu -> $STATUS"; fi

fetch "/api/public/menu"
if [[ "$STATUS" == 200 ]]; then pass "GET /api/public/menu -> 200"; else fail "GET /api/public/menu -> $STATUS"; fi

# 2. Admin API is alive and requires login (not 500, not open)
fetch "/api/admin/me"
if [[ "$STATUS" == 401 ]]; then pass "GET /api/admin/me without session -> 401"; else fail "GET /api/admin/me without session -> $STATUS (want 401)"; fi

fetch "/admin/"
if [[ "$STATUS" == 200 ]]; then pass "GET /admin/ -> 200"; else warn "GET /admin/ -> $STATUS (admin UI not deployed yet?)"; fi

# 3. Things that must never be served
for p in /package.json /.env /server/src/app.js /data/kota.db /docs/ARCHITECTURE.md /ops/backup.sh /.git/config; do
  fetch "$p"
  if [[ "$STATUS" == 404 ]]; then pass "not served: $p -> 404"; else fail "EXPOSED or unexpected: $p -> $STATUS (want 404)"; fi
done

# 4. HTTPS details (only meaningful for https base URLs)
if [[ "$BASE" == https://* ]]; then
  HOST="${BASE#https://}"; HOST="${HOST%%/*}"
  HSTS_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "http://$HOST/" || echo 000)"
  if [[ "$HSTS_CODE" == 301 || "$HSTS_CODE" == 308 ]]; then pass "http:// redirects to https:// ($HSTS_CODE)"; else warn "http://$HOST/ -> $HSTS_CODE (expected a redirect)"; fi
fi

echo "---"
echo "smoke check: $FAILS failure(s), $WARNS warning(s) against $BASE"
[[ "$FAILS" -eq 0 ]]

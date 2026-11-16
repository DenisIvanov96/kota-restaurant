#!/usr/bin/env bash
# Kota1 backup: consistent SQLite snapshot + uploads/ folder, packed into one
# timestamped .tar.gz, with simple age-based retention.
#
# Safe to run while the server is running (SQLite VACUUM INTO reads a consistent
# snapshot; WAL mode lets the server keep writing).
#
# Usage:
#   DATA_DIR=/var/lib/kota-restaurant/data BACKUP_DIR=/var/backups/kota-restaurant \
#     /opt/kota-restaurant/ops/backup.sh
#
# Optional environment:
#   BACKUP_KEEP_DAYS=30        delete kota-*.tar.gz older than this many days
#   BACKUP_AGE_RECIPIENT=...   if set (and `age` is installed), encrypt the archive
#                              to this age public key (recommended for off-site copies)
#   NODE_BIN=node              Node >= 22.13 binary to use
#
# Exit status is non-zero on any failure, so a cron/systemd job will report it.
set -euo pipefail
umask 077   # backups are private: owner-only files

DATA_DIR="${DATA_DIR:?set DATA_DIR to the data folder that holds kota.db}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/kota-backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
NODE_BIN="${NODE_BIN:-node}"
DB="$DATA_DIR/kota.db"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v "$NODE_BIN" >/dev/null || { echo "backup: node not found ($NODE_BIN)" >&2; exit 1; }
[[ -f "$DB" ]] || { echo "backup: database not found at $DB" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d "$BACKUP_DIR/.work-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# 1. Consistent database snapshot + integrity check (node:sqlite, no sqlite3 CLI needed).
"$NODE_BIN" --disable-warning=ExperimentalWarning "$SCRIPT_DIR/snapshot-db.mjs" "$DB" "$WORK/kota.db"

# 2. Archive snapshot + uploads/ (uploads may not exist yet on a fresh install).
ARCHIVE="$BACKUP_DIR/kota-$STAMP.tar.gz"
mkdir -p "$DATA_DIR/uploads"
tar -czf "$WORK/archive.tar.gz" -C "$WORK" kota.db -C "$DATA_DIR" uploads
tar -tzf "$WORK/archive.tar.gz" >/dev/null   # verify the archive is readable

if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  command -v age >/dev/null || { echo "backup: BACKUP_AGE_RECIPIENT set but 'age' is not installed" >&2; exit 1; }
  age -r "$BACKUP_AGE_RECIPIENT" -o "$ARCHIVE.age" "$WORK/archive.tar.gz"
  echo "backup: wrote $ARCHIVE.age (encrypted)"
else
  mv -f "$WORK/archive.tar.gz" "$ARCHIVE"
  echo "backup: wrote $ARCHIVE (NOT encrypted; keep it on a private disk)"
fi

# 3. Retention: remove old backups of this script only.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'kota-*.tar.gz' -o -name 'kota-*.tar.gz.age' \) \
  -mtime "+$KEEP_DAYS" -print -delete | sed 's/^/backup: pruned /' || true
echo "backup: done"

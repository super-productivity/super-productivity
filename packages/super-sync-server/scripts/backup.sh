#!/bin/bash
# SuperSync Server Backup Script
#
# Usage:
#   ./scripts/backup.sh [--upload]
#
# This script:
#   1. Creates a PostgreSQL dump
#   2. Compresses it with gzip
#   3. Optionally uploads to remote storage (requires rclone)
#   4. Cleans up old backups (keeps 14 days)
#
# Options:
#   --upload    Upload to remote storage via rclone
#
# Setup for cron: see docs/backup-and-recovery.md (use flock with a root-owned lock
# path like /run/supersync-backup.lock so a slow dump cannot overlap the next run).
#
# Rclone setup for offsite backup:
#   1. Install: curl https://rclone.org/install.sh | sudo bash
#   2. Configure: rclone config (follow prompts for B2/S3)
#   3. Set RCLONE_REMOTE below

set -eo pipefail
# The full dump is the whole database and the accounts dump is users + passkeys — password
# hashes and passkey credentials. Under root cron the default umask is 022, so without this
# both land 0644 and every local account on the host can read them.
umask 077

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$SERVER_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Rclone remote name (e.g., "b2:supersync-backups" or "s3:my-bucket/supersync")
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

# Identifies the dump's session in pg_stat_activity. health-alert.sh exempts exactly this
# name from its long-query check: a full dump legitimately runs for hours and would
# otherwise page every night, on a schedule, forever. It is NOT exempt from the pool-busy
# check, so a dump that actually starves the server still alerts, and the exemption expires
# after 6h so a WEDGED dump still pages. Keep it in sync with the `pageable` expression in
# scripts/health-alert.sh.
BACKUP_APPLICATION_NAME="supersync-backup"

# Every dump goes through here, so a new dump site cannot forget the session stamp that
# the health check's exemption keys on.
run_pg_dump() {
  docker exec -e PGAPPNAME="$BACKUP_APPLICATION_NAME" "$DB_CONTAINER" \
    pg_dump -U "$DB_USER" "$DB_NAME" "$@"
}

# Database container name
DB_CONTAINER="${DB_CONTAINER:-supersync-postgres}"
DB_USER="${POSTGRES_USER:-supersync}"
DB_NAME="${POSTGRES_DB:-supersync}"

# Parse arguments
UPLOAD=false
if [ "$1" = "--upload" ]; then
    UPLOAD=true
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"
# Fixes a directory created before the umask above.
chmod 700 "$BACKUP_DIR"

# The EXIT trap below cannot fire on SIGKILL, OOM or a host reboot, and the retention
# find only matches final names — sweep dead runs' partials here instead. -mmin checks
# mtime and gzip touches the .tmp on every write, so a live dump — however slow — is
# never eligible; only a partial nothing has written to for 6h is.
find "$BACKUP_DIR" -name "supersync_*.sql.gz.tmp" -mmin +360 -delete

# Generate filename with timestamp
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/supersync_$DATE.sql.gz"
ACCOUNTS_FILE="$BACKUP_DIR/supersync_accounts_$DATE.sql.gz"

# A dump killed mid-run (e.g. a #9695 crash-restart) leaves a truncated file that still
# passes gzip -t: gzip sees EOF and finalizes a valid archive when pg_dump dies upstream
# (#9836, observed 2026-08-31 and 2026-09-02). Write to .tmp and rename only on success
# so a failed night leaves no plausible-looking backup behind.
trap 'rm -f "$BACKUP_FILE.tmp" "$ACCOUNTS_FILE.tmp"' EXIT

echo "==> SuperSync Backup"
echo "    Date: $DATE"
echo "    Output: $BACKUP_FILE"
echo ""

# Step 1: Create minimal accounts-only dump (users + passkeys)
# This is tiny and sufficient for disaster recovery when clients still have data.
# Recovery: restore accounts, wipe sync data, let clients re-upload.
# It runs BEFORE the 1-2 h full dump so a crash inside that window (#9695 hit the
# dump window twice in five occurrences) cannot take both artifacts.
echo "==> Creating accounts-only dump (users + passkeys)..."
run_pg_dump --table=users --table=passkeys | gzip > "$ACCOUNTS_FILE.tmp"
mv "$ACCOUNTS_FILE.tmp" "$ACCOUNTS_FILE"

ACCOUNTS_SIZE=$(du -h "$ACCOUNTS_FILE" | cut -f1)
echo "    Accounts backup size: $ACCOUNTS_SIZE"

# Step 2: Create full PostgreSQL dump
echo ""
echo "==> Creating full database dump..."
run_pg_dump | gzip > "$BACKUP_FILE.tmp"
mv "$BACKUP_FILE.tmp" "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "    Full backup size: $SIZE"

# Step 3: Upload to remote (if enabled)
if [ "$UPLOAD" = true ]; then
    if [ -z "$RCLONE_REMOTE" ]; then
        echo ""
        echo "Warning: --upload specified but RCLONE_REMOTE not set"
        echo "    Set RCLONE_REMOTE environment variable to enable uploads"
    elif command -v rclone &> /dev/null; then
        echo ""
        echo "==> Uploading to $RCLONE_REMOTE..."
        rclone copy "$BACKUP_FILE" "$RCLONE_REMOTE/"
        rclone copy "$ACCOUNTS_FILE" "$RCLONE_REMOTE/"
        echo "    Upload complete"
    else
        echo ""
        echo "Warning: rclone not installed, skipping upload"
        echo "    Install with: curl https://rclone.org/install.sh | sudo bash"
    fi
fi

# Step 4: Clean up old backups
echo ""
echo "==> Cleaning up backups older than $RETENTION_DAYS days..."
DELETED=$(find "$BACKUP_DIR" \( -name "supersync_*.sql.gz" -o -name "supersync_accounts_*.sql.gz" \) -mtime +"$RETENTION_DAYS" -delete -print | wc -l)
echo "    Deleted $DELETED old backup(s)"

# List current backups
echo ""
echo "==> Current backups:"
ls -lh "$BACKUP_DIR"/supersync_*.sql.gz 2>/dev/null | tail -10 || echo "    (none)"

echo ""
echo "==> Backup complete:"
echo "    Full:     $BACKUP_FILE"
echo "    Accounts: $ACCOUNTS_FILE"

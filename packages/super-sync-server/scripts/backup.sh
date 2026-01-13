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
# Setup for cron (daily at 3 AM):
#   (crontab -l; echo "0 3 * * * /opt/supersync/packages/super-sync-server/scripts/backup.sh") | crontab -
#
# Rclone setup for offsite backup:
#   1. Install: curl https://rclone.org/install.sh | sudo bash
#   2. Configure: rclone config (follow prompts for B2/S3)
#   3. Set RCLONE_REMOTE below

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$SERVER_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Rclone remote name (e.g., "b2:supersync-backups" or "s3:my-bucket/supersync")
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

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

# Generate filename with timestamp
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/supersync_$DATE.sql.gz"

echo "==> SuperSync Backup"
echo "    Date: $DATE"
echo "    Output: $BACKUP_FILE"
echo ""

# Step 1: Create PostgreSQL dump
echo "==> Creating database dump..."
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

# Get file size
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "    Backup size: $SIZE"

# Step 2: Upload to remote (if enabled)
if [ "$UPLOAD" = true ]; then
    if [ -z "$RCLONE_REMOTE" ]; then
        echo ""
        echo "Warning: --upload specified but RCLONE_REMOTE not set"
        echo "    Set RCLONE_REMOTE environment variable to enable uploads"
    elif command -v rclone &> /dev/null; then
        echo ""
        echo "==> Uploading to $RCLONE_REMOTE..."
        rclone copy "$BACKUP_FILE" "$RCLONE_REMOTE/"
        echo "    Upload complete"
    else
        echo ""
        echo "Warning: rclone not installed, skipping upload"
        echo "    Install with: curl https://rclone.org/install.sh | sudo bash"
    fi
fi

# Step 3: Clean up old backups
echo ""
echo "==> Cleaning up backups older than $RETENTION_DAYS days..."
DELETED=$(find "$BACKUP_DIR" -name "supersync_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete -print | wc -l)
echo "    Deleted $DELETED old backup(s)"

# List current backups
echo ""
echo "==> Current backups:"
ls -lh "$BACKUP_DIR"/supersync_*.sql.gz 2>/dev/null | tail -5 || echo "    (none)"

echo ""
echo "==> Backup complete: $BACKUP_FILE"

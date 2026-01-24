#!/bin/bash
# Backup Rotation Script for SuperSync
# Implements retention policy: 7 daily, 4 weekly, 12 monthly

set -e
set -u

BACKUP_DIR="/var/backups/supersync"
LOG_FILE="/var/log/backup-rotation.log"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

# Create log directory if needed
mkdir -p "$(dirname "$LOG_FILE")"

log "=== Starting backup rotation ==="

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Count backups before rotation
BEFORE_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name "supersync-*.enc" -type f 2>/dev/null | wc -l)
if [ -d "$BACKUP_DIR" ]; then
  BEFORE_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0")
else
  BEFORE_SIZE="0"
fi
log "Before rotation: $BEFORE_COUNT backups, $BEFORE_SIZE total"

# 1. Daily backups: Keep last 7 days
log "Rotating daily backups (keep 7 days)..."
DELETED_COUNT=0

# Find and delete daily backups older than 7 days
while IFS= read -r -d '' file; do
  rm -f "$file"
  DELETED_COUNT=$((DELETED_COUNT + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -name "supersync-*.enc" -type f -mtime +7 -print0 2>/dev/null)

log "Deleted $DELETED_COUNT old daily backups"

# 2. Weekly backups: Keep first backup of each week for 4 weeks
log "Managing weekly backups (keep 4 weeks)..."
WEEKLY_DIR="$BACKUP_DIR/weekly"
mkdir -p "$WEEKLY_DIR"

# Find first backup from each of the last 4 weeks (Sunday)
for week in $(seq 1 4); do
  START_DATE=$(date -d "$week weeks ago sunday" +%Y%m%d 2>/dev/null || date -v-${week}w -v+0d +%Y%m%d 2>/dev/null || echo "")

  if [ -z "$START_DATE" ]; then
    log "Warning: Could not calculate date for week $week"
    continue
  fi

  # Find first backup from that week
  WEEKLY_BACKUP=$(find "$BACKUP_DIR" -maxdepth 1 -name "supersync-${START_DATE}*.enc" \
    -type f 2>/dev/null | head -1)

  if [ -n "$WEEKLY_BACKUP" ]; then
    BACKUP_NAME=$(basename "$WEEKLY_BACKUP")
    if [ ! -f "$WEEKLY_DIR/$BACKUP_NAME" ]; then
      cp "$WEEKLY_BACKUP" "$WEEKLY_DIR/" 2>/dev/null || log "Warning: Could not copy weekly backup"
      log "Preserved weekly backup: $BACKUP_NAME"
    fi
  fi
done

# Remove weekly backups older than 4 weeks (28 days)
find "$WEEKLY_DIR" -name "*.enc" -type f -mtime +28 -delete 2>/dev/null || true

# 3. Monthly backups: Keep first backup of each month for 12 months
log "Managing monthly backups (keep 12 months)..."
MONTHLY_DIR="$BACKUP_DIR/monthly"
mkdir -p "$MONTHLY_DIR"

# Find first backup from each of the last 12 months
for month in $(seq 1 12); do
  MONTH_DATE=$(date -d "$month months ago" +%Y%m01 2>/dev/null || date -v-${month}m -v1d +%Y%m01 2>/dev/null || echo "")

  if [ -z "$MONTH_DATE" ]; then
    log "Warning: Could not calculate date for month $month"
    continue
  fi

  # Find first backup from that month
  MONTHLY_BACKUP=$(find "$BACKUP_DIR" -maxdepth 1 -name "supersync-${MONTH_DATE}*.enc" \
    -type f 2>/dev/null | head -1)

  if [ -n "$MONTHLY_BACKUP" ]; then
    BACKUP_NAME=$(basename "$MONTHLY_BACKUP")
    if [ ! -f "$MONTHLY_DIR/$BACKUP_NAME" ]; then
      cp "$MONTHLY_BACKUP" "$MONTHLY_DIR/" 2>/dev/null || log "Warning: Could not copy monthly backup"
      log "Preserved monthly backup: $BACKUP_NAME"
    fi
  fi
done

# Remove monthly backups older than 12 months (365 days)
find "$MONTHLY_DIR" -name "*.enc" -type f -mtime +365 -delete 2>/dev/null || true

# 4. Summary
AFTER_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name "supersync-*.enc" -type f 2>/dev/null | wc -l)
AFTER_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0")
WEEKLY_COUNT=$(find "$WEEKLY_DIR" -name "*.enc" -type f 2>/dev/null | wc -l)
MONTHLY_COUNT=$(find "$MONTHLY_DIR" -name "*.enc" -type f 2>/dev/null | wc -l)

log "=== Rotation complete ==="
log "Daily backups: $AFTER_COUNT files"
log "Weekly backups: $WEEKLY_COUNT files"
log "Monthly backups: $MONTHLY_COUNT files"
log "Total size: $AFTER_SIZE (was $BEFORE_SIZE)"

# 5. Verify at least one backup exists
TOTAL_BACKUPS=$((AFTER_COUNT + WEEKLY_COUNT + MONTHLY_COUNT))
if [ "$TOTAL_BACKUPS" -eq 0 ]; then
  log "ERROR: No backups remaining after rotation!"

  # Try to send alert if mail is available
  if command -v mail >/dev/null 2>&1; then
    echo "CRITICAL: All backups deleted during rotation on $(hostname) at $(date)" | \
      mail -s "ALERT: Backup Rotation Error" admin@example.com 2>/dev/null || true
  fi

  exit 1
fi

log "✅ Backup rotation successful (total: $TOTAL_BACKUPS backups)"

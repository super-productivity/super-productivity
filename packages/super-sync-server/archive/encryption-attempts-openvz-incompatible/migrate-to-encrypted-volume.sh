#!/bin/bash
# SuperSync Migration to Encrypted Volume
# Migrates existing PostgreSQL data to LUKS-encrypted volume
#
# IMPORTANT: Run discovery script first to identify your actual container/volume names
# ./discover-docker-names.sh

set -e  # Exit on error
set -u  # Exit on undefined variable

# Configuration - UPDATE THESE TO MATCH YOUR DEPLOYMENT
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-postgres}"  # From docker-compose.yml
POSTGRES_USER="${POSTGRES_USER:-supersync}"
POSTGRES_DB="${POSTGRES_DB:-supersync}"
SOURCE_VOLUME="${SOURCE_VOLUME:-/var/lib/docker/volumes/postgres-data/_data}"  # Run: docker volume inspect postgres-data
TARGET_MOUNT="/mnt/pg-data-encrypted"
LOG_FILE="/var/log/supersync-migration-$(date +%Y%m%d-%H%M%S).log"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

error() {
  log "ERROR: $*"
  exit 1
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  error "This script must be run as root"
fi

log "========================================"
log "SuperSync Migration to Encrypted Volume"
log "========================================"
log ""
log "Configuration:"
log "  Container: $POSTGRES_CONTAINER"
log "  Source: $SOURCE_VOLUME"
log "  Target: $TARGET_MOUNT"
log "  Log: $LOG_FILE"
log ""

# Step 1: Pre-migration validation
log "=== Step 1/7: Pre-migration Validation ==="

# Verify source exists
if [ ! -d "$SOURCE_VOLUME" ]; then
  error "Source volume not found: $SOURCE_VOLUME"
fi
log "✅ Source volume exists"

# Verify target is mounted and writable
if ! mountpoint -q "$TARGET_MOUNT"; then
  error "Target not mounted: $TARGET_MOUNT (run unlock-encrypted-volume.sh first)"
fi
log "✅ Target is mounted"

if [ ! -w "$TARGET_MOUNT" ]; then
  error "Target not writable: $TARGET_MOUNT"
fi
log "✅ Target is writable"

# Calculate disk space requirement
log "Calculating space requirements..."
SOURCE_SIZE=$(du -sb "$SOURCE_VOLUME" | cut -f1)
AVAILABLE_SPACE=$(df -B1 --output=avail "$TARGET_MOUNT" | tail -1)
REQUIRED_SPACE=$((SOURCE_SIZE + SOURCE_SIZE / 5))  # Source + 20% buffer

log "  Source size: $(numfmt --to=iec $SOURCE_SIZE)"
log "  Available: $(numfmt --to=iec $AVAILABLE_SPACE)"
log "  Required: $(numfmt --to=iec $REQUIRED_SPACE)"

if [ "$AVAILABLE_SPACE" -lt "$REQUIRED_SPACE" ]; then
  error "Insufficient disk space (need $(numfmt --to=iec $REQUIRED_SPACE), have $(numfmt --to=iec $AVAILABLE_SPACE))"
fi
log "✅ Sufficient disk space"

# Verify container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  error "PostgreSQL container not running: $POSTGRES_CONTAINER"
fi
log "✅ PostgreSQL container is running"

# Step 2: Create pre-migration backup
log ""
log "=== Step 2/7: Creating Pre-Migration Backup ==="
BACKUP_FILE="/var/backups/supersync/pre-migration-$(date +%Y%m%d-%H%M%S).sql.gz"
mkdir -p "$(dirname "$BACKUP_FILE")"

log "Creating backup: $BACKUP_FILE"
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$BACKUP_FILE"

if [ ! -f "$BACKUP_FILE" ] || [ ! -s "$BACKUP_FILE" ]; then
  error "Backup creation failed"
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "✅ Backup created: $BACKUP_SIZE"
log "   Location: $BACKUP_FILE"

# Step 3: Stop PostgreSQL cleanly
log ""
log "=== Step 3/7: Stopping PostgreSQL Gracefully ==="
log "Shutting down PostgreSQL (smart mode, 60s timeout)..."

# Try graceful shutdown first
if docker exec "$POSTGRES_CONTAINER" pg_ctl stop -D /var/lib/postgresql/data -m smart -t 60; then
  log "✅ Graceful shutdown succeeded"
else
  log "⚠️  Graceful shutdown failed, forcing stop..."
  if ! docker exec "$POSTGRES_CONTAINER" pg_ctl stop -D /var/lib/postgresql/data -m fast -t 30; then
    error "Fast shutdown also failed - PostgreSQL may not have stopped cleanly"
  fi
  log "✅ Fast shutdown succeeded"
fi

# Verify PostgreSQL process has stopped
log "Verifying PostgreSQL process terminated..."
if docker exec "$POSTGRES_CONTAINER" pgrep -x postgres >/dev/null 2>&1; then
  error "PostgreSQL processes still running after shutdown - data may be inconsistent"
fi

# Stop container
log "Stopping container: $POSTGRES_CONTAINER"
docker compose stop "$POSTGRES_CONTAINER"

# Verify container stopped
if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  error "Container still running after stop command"
fi
log "✅ PostgreSQL stopped cleanly"

# Step 4: Copy data with hard link preservation
log ""
log "=== Step 4/7: Copying Data to Encrypted Volume ==="
log "This may take several minutes depending on database size..."
log ""

START_TIME=$(date +%s)

rsync -aH --info=progress2 \
  --log-file="$LOG_FILE" \
  "$SOURCE_VOLUME/" \
  "$TARGET_MOUNT/" || error "rsync failed"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

log ""
log "✅ Data copy completed in $DURATION seconds"

# Step 5: Verify data integrity
log ""
log "=== Step 5/7: Verifying Data Integrity ==="

# File count verification
log "Comparing file counts..."
SOURCE_COUNT=$(find "$SOURCE_VOLUME" -type f 2>/dev/null | wc -l)
TARGET_COUNT=$(find "$TARGET_MOUNT" -type f 2>/dev/null | wc -l)

log "  Source files: $SOURCE_COUNT"
log "  Target files: $TARGET_COUNT"

if [ "$SOURCE_COUNT" -ne "$TARGET_COUNT" ]; then
  error "File count mismatch (source: $SOURCE_COUNT, target: $TARGET_COUNT)"
fi
log "✅ File counts match"

# Size verification
log "Comparing total sizes..."
SOURCE_SIZE_VERIFY=$(du -sb "$SOURCE_VOLUME" | cut -f1)
TARGET_SIZE=$(du -sb "$TARGET_MOUNT" | cut -f1)

log "  Source size: $(numfmt --to=iec $SOURCE_SIZE_VERIFY)"
log "  Target size: $(numfmt --to=iec $TARGET_SIZE)"

if [ "$SOURCE_SIZE_VERIFY" -ne "$TARGET_SIZE" ]; then
  error "Size mismatch (source: $SOURCE_SIZE_VERIFY, target: $TARGET_SIZE)"
fi
log "✅ Sizes match"

# PostgreSQL-specific checks
log "Verifying PostgreSQL data files..."
CRITICAL_FILES=("PG_VERSION" "base" "global")
for file in "${CRITICAL_FILES[@]}"; do
  if [ ! -e "$TARGET_MOUNT/$file" ]; then
    error "Critical file missing: $file"
  fi
done
log "✅ All critical PostgreSQL files present"

# Step 6: Set proper permissions
log ""
log "=== Step 6/7: Setting Permissions ==="
chown -R 999:999 "$TARGET_MOUNT"
chmod 700 "$TARGET_MOUNT"
log "✅ Permissions set (999:999, mode 700)"

# Step 7: Summary
log ""
log "========================================="
log "✅ Migration Completed Successfully!"
log "========================================="
log ""
log "Summary:"
log "  Files migrated: $TARGET_COUNT"
log "  Total size: $(numfmt --to=iec $TARGET_SIZE)"
log "  Duration: $DURATION seconds"
log "  Backup: $BACKUP_FILE"
log "  Log: $LOG_FILE"
log ""
log "NEXT STEPS:"
log "  1. Update docker-compose to use encrypted volume:"
log "     docker compose -f docker-compose.yml -f docker-compose.encrypted.yaml config"
log ""
log "  2. Start PostgreSQL on encrypted volume:"
log "     docker compose -f docker-compose.yml -f docker-compose.encrypted.yaml up -d postgres"
log ""
log "  3. Verify database integrity:"
log "     ./verify-migration.sh"
log ""
log "  4. Test SuperSync operations"
log ""
log "  5. If issues occur, restore from backup:"
log "     gunzip < $BACKUP_FILE | docker exec -i $POSTGRES_CONTAINER psql -U $POSTGRES_USER $POSTGRES_DB"
log ""

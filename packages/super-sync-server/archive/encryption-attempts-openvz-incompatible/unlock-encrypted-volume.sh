#!/bin/bash
# LUKS Encrypted Volume Unlock Script
# Usage: ./unlock-encrypted-volume.sh <volume-name>

set -e
set -u

# Parse arguments
VOLUME_NAME="${1:-pg-data-encrypted}"
VOLUME_FILE="/var/lib/supersync-encrypted.img"
MOUNT_POINT="/mnt/pg-data-encrypted"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "ERROR: This script must be run as root"
  exit 1
fi

echo "=== SuperSync LUKS Volume Unlock ==="
echo "Volume: $VOLUME_NAME"
echo "File: $VOLUME_FILE"
echo "Mount: $MOUNT_POINT"
echo ""

# Check if volume file exists
if [ ! -f "$VOLUME_FILE" ]; then
  echo "❌ ERROR: Volume file not found: $VOLUME_FILE"
  exit 1
fi

# Check if already unlocked
if [ -e "/dev/mapper/$VOLUME_NAME" ]; then
  echo "⚠️  Volume is already unlocked: /dev/mapper/$VOLUME_NAME"

  # Check if mounted
  if mountpoint -q "$MOUNT_POINT"; then
    echo "✅ Volume is already mounted at: $MOUNT_POINT"
    exit 0
  else
    echo "Mounting existing unlocked volume..."
    mount /dev/mapper/"$VOLUME_NAME" "$MOUNT_POINT"
    echo "✅ Mounted at: $MOUNT_POINT"
    exit 0
  fi
fi

# Step 1: Unlock LUKS volume
echo "Step 1/4: Unlocking LUKS volume..."
echo "Enter passphrase (operational or recovery):"
echo ""

if ! cryptsetup luksOpen "$VOLUME_FILE" "$VOLUME_NAME"; then
  echo ""
  echo "❌ ERROR: Failed to unlock volume"
  echo ""
  echo "Possible causes:"
  echo "  - Incorrect passphrase"
  echo "  - LUKS header corruption (restore from header backup)"
  echo "  - Wrong volume file: $VOLUME_FILE"
  echo ""
  echo "To restore from header backup:"
  echo "  cryptsetup luksHeaderRestore $VOLUME_FILE --header-backup-file <backup>"
  exit 1
fi

echo "✅ LUKS volume unlocked: /dev/mapper/$VOLUME_NAME"

# Step 2: Mount filesystem
echo ""
echo "Step 2/4: Mounting encrypted filesystem..."
mkdir -p "$MOUNT_POINT"
mount /dev/mapper/"$VOLUME_NAME" "$MOUNT_POINT"
echo "✅ Mounted at: $MOUNT_POINT"

# Step 3: Verify mount and permissions
echo ""
echo "Step 3/4: Verifying mount..."

if [ ! -d "$MOUNT_POINT" ]; then
  echo "❌ ERROR: Mount point is not a directory"
  exit 1
fi

if [ ! -w "$MOUNT_POINT" ]; then
  echo "❌ ERROR: Mount point not writable"
  exit 1
fi

# Test write
if ! touch "$MOUNT_POINT/.test" 2>/dev/null || ! rm "$MOUNT_POINT/.test" 2>/dev/null; then
  echo "❌ ERROR: Cannot write to mount point"
  exit 1
fi

echo "✅ Mount point is writable"

# Verify PostgreSQL data (if this is an existing volume)
if [ -d "$MOUNT_POINT/base" ] || [ -f "$MOUNT_POINT/PG_VERSION" ]; then
  PG_VERSION=$(cat "$MOUNT_POINT/PG_VERSION" 2>/dev/null || echo "unknown")
  echo "✅ PostgreSQL data found (version: $PG_VERSION)"
else
  echo "⚠️  PostgreSQL data directory appears empty"
  echo "   This may be a fresh volume - verify before starting PostgreSQL!"
fi

# Step 4: Audit logging (GDPR compliance)
echo ""
echo "Step 4/4: Logging unlock event..."
mkdir -p /var/log
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] VOLUME_UNLOCK volume=$VOLUME_NAME by=$USER from=${SSH_CLIENT:-localhost}" | \
  tee -a /var/log/luks-audit.log | \
  logger -t luks-audit -p auth.info

echo "✅ Audit log updated"

# Summary
echo ""
echo "========================================="
echo "✅ Volume Successfully Unlocked!"
echo "========================================="
echo ""
echo "Volume: $VOLUME_NAME"
echo "Mount: $MOUNT_POINT"
echo ""
echo "Next steps:"
echo "  1. Verify data integrity: ls -la $MOUNT_POINT"
echo "  2. Start Docker Compose: cd /opt/supersync && docker compose up -d"
echo "  3. Monitor logs: docker compose logs -f"
echo ""

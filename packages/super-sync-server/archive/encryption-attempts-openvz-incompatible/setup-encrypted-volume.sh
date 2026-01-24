#!/bin/bash
# LUKS Encrypted Volume Setup Script for SuperSync
# Usage: ./setup-encrypted-volume.sh --size 50G --name pg-data-encrypted

set -e
set -u

# Default values
VOLUME_SIZE=""
VOLUME_NAME="pg-data-encrypted"
VOLUME_FILE="/var/lib/supersync-encrypted.img"
MOUNT_POINT="/mnt/pg-data-encrypted"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --size)
      VOLUME_SIZE="$2"
      shift 2
      ;;
    --name)
      VOLUME_NAME="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 --size SIZE [--name NAME]"
      echo "Example: $0 --size 50G --name pg-data-encrypted"
      exit 1
      ;;
  esac
done

# Validate required parameters
if [ -z "$VOLUME_SIZE" ]; then
  echo "ERROR: --size parameter is required"
  echo "Usage: $0 --size SIZE [--name NAME]"
  echo "Example: $0 --size 50G --name pg-data-encrypted"
  exit 1
fi

echo "=== SuperSync LUKS Encrypted Volume Setup ==="
echo "Volume size: $VOLUME_SIZE"
echo "Volume name: $VOLUME_NAME"
echo "Volume file: $VOLUME_FILE"
echo "Mount point: $MOUNT_POINT"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "ERROR: This script must be run as root"
  exit 1
fi

# Check if volume file already exists
if [ -f "$VOLUME_FILE" ]; then
  echo "ERROR: Volume file already exists: $VOLUME_FILE"
  echo "Remove it first or choose a different name"
  exit 1
fi

# Step 1: Create loop device file
echo "Step 1/7: Creating loop device file ($VOLUME_SIZE)..."
fallocate -l "$VOLUME_SIZE" "$VOLUME_FILE"
chmod 600 "$VOLUME_FILE"
echo "✅ Created: $VOLUME_FILE"

# Step 2: Initialize LUKS with Argon2id
echo ""
echo "Step 2/7: Initializing LUKS2 encryption..."
echo "You will be prompted to enter the OPERATIONAL passphrase (Slot 0)"
echo "IMPORTANT: Use 'diceware -n 8' to generate a strong passphrase"
echo ""
cryptsetup luksFormat --type luks2 \
  --cipher aes-xts-plain64 \
  --key-size 512 \
  --hash sha256 \
  --pbkdf argon2id \
  --pbkdf-memory 1048576 \
  --pbkdf-parallel 4 \
  "$VOLUME_FILE"

echo "✅ LUKS volume initialized with AES-256-XTS encryption"
echo "   Note: --key-size 512 = AES-256-XTS (256 bits encryption + 256 bits tweak)"

# Step 3: Add emergency recovery key (Slot 1)
echo ""
echo "Step 3/7: Adding emergency recovery key (Slot 1)..."
echo "You will be prompted to:"
echo "  1. Enter the OPERATIONAL passphrase (just created)"
echo "  2. Enter a NEW RECOVERY passphrase (store in physical safe)"
echo ""
cryptsetup luksAddKey "$VOLUME_FILE"
echo "✅ Emergency recovery key added to Slot 1"

# Step 4: Open and format
echo ""
echo "Step 4/7: Opening LUKS volume and formatting filesystem..."
echo "Enter the operational passphrase:"
cryptsetup luksOpen "$VOLUME_FILE" "$VOLUME_NAME"
mkfs.ext4 -L "$VOLUME_NAME" /dev/mapper/"$VOLUME_NAME"
echo "✅ ext4 filesystem created"

# Step 5: Mount and set permissions
echo ""
echo "Step 5/7: Mounting and setting permissions..."
mkdir -p "$MOUNT_POINT"
mount /dev/mapper/"$VOLUME_NAME" "$MOUNT_POINT"
chown -R 999:999 "$MOUNT_POINT"  # PostgreSQL UID:GID
chmod 700 "$MOUNT_POINT"
echo "✅ Mounted at: $MOUNT_POINT"
echo "   Permissions set for PostgreSQL (UID 999)"

# Step 6: Verify AES-NI hardware acceleration
echo ""
echo "Step 6/7: Checking hardware acceleration..."
if ! grep -q aes /proc/cpuinfo; then
  echo "⚠️  WARNING: No AES-NI hardware acceleration detected"
  echo "   Performance overhead may be 20-40% instead of 3-10%"
else
  echo "✅ AES-NI hardware acceleration available"
  echo "   Expected encryption overhead: 3-10%"
fi

# Step 7: Backup LUKS header (CRITICAL for disaster recovery)
echo ""
echo "Step 7/7: Backing up LUKS header..."
mkdir -p /var/backups
HEADER_BACKUP="/var/backups/luks-header-$VOLUME_NAME-$(date +%Y%m%d).img"

cryptsetup luksHeaderBackup "$VOLUME_FILE" \
  --header-backup-file "$HEADER_BACKUP"

# Check if backup passphrase file exists
if [ -f "/run/secrets/backup_passphrase" ]; then
  echo "Encrypting header backup with backup passphrase..."
  openssl enc -aes-256-cbc -salt -pbkdf2 -iter 1000000 \
    -pass file:/run/secrets/backup_passphrase \
    -in "$HEADER_BACKUP" \
    -out "$HEADER_BACKUP.enc"

  # Verify encrypted header can be decrypted
  echo "Verifying encrypted header backup..."
  if openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
      -pass file:/run/secrets/backup_passphrase \
      -in "$HEADER_BACKUP.enc" | dd bs=1 count=1 >/dev/null 2>&1; then
    echo "✅ Header backup encryption verified (decrypts successfully)"
  else
    echo "❌ ERROR: Encrypted header backup cannot be decrypted!"
    echo "   DO NOT PROCEED - header backup is corrupted"
    exit 1
  fi

  # Remove unencrypted header
  rm "$HEADER_BACKUP"
  echo "✅ LUKS header backup created: $HEADER_BACKUP.enc"
else
  echo "⚠️  WARNING: /run/secrets/backup_passphrase not found"
  echo "   Header backup saved unencrypted: $HEADER_BACKUP"
  echo "   Encrypt it manually before storing!"
fi

# Summary
echo ""
echo "========================================="
echo "✅ LUKS Encrypted Volume Setup Complete!"
echo "========================================="
echo ""
echo "Volume Details:"
echo "  File: $VOLUME_FILE"
echo "  Name: $VOLUME_NAME"
echo "  Mount: $MOUNT_POINT"
echo "  Size: $VOLUME_SIZE"
echo "  Encryption: AES-256-XTS with Argon2id"
echo "  Key Slots: 0 (operational), 1 (recovery)"
echo ""
echo "CRITICAL NEXT STEPS:"
echo "  1. Store OPERATIONAL passphrase in 1Password vault"
echo "  2. Store RECOVERY passphrase in physical safe"
echo "  3. Store encrypted header backup with recovery key"
echo "  4. Test unlocking with both passphrases"
echo "  5. Never store passphrases on the server!"
echo ""
echo "To unlock this volume:"
echo "  ./unlock-encrypted-volume.sh $VOLUME_NAME"
echo ""

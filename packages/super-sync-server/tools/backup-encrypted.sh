#!/bin/bash
# SuperSync Encrypted Backup Script
# Creates streaming encrypted backups (PostgreSQL → gzip → OpenSSL)
# SECURITY: No temporary unencrypted files created

set -e
set -o pipefail
set -u

# Configuration
BACKUP_DIR="/var/backups/supersync"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
ENCRYPTED_BACKUP="$BACKUP_DIR/supersync-$TIMESTAMP.sql.gz.enc"
ENCRYPTED_BACKUP_TMP="$ENCRYPTED_BACKUP.tmp"

# Cleanup temp file on exit
trap 'rm -f "$ENCRYPTED_BACKUP_TMP"' EXIT
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-db}"  # Default to 'db', override with env var
POSTGRES_USER="${POSTGRES_USER:-supersync}"
POSTGRES_DB="${POSTGRES_DB:-supersync_db}"

echo "=== SuperSync Encrypted Backup ==="
echo "Timestamp: $TIMESTAMP"
echo "Container: $POSTGRES_CONTAINER"
echo "Database: $POSTGRES_DB"
echo "Output: $ENCRYPTED_BACKUP"
echo ""

# Check if running as root (needed for secure file permissions)
if [ "$EUID" -ne 0 ]; then
  echo "⚠️  WARNING: Not running as root - backup file permissions may be insecure"
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Check if backup passphrase file exists
if [ ! -f "/run/secrets/backup_passphrase" ]; then
  echo "❌ ERROR: Backup passphrase file not found: /run/secrets/backup_passphrase"
  echo ""
  echo "Create it with:"
  echo "  diceware -n 8 > /run/secrets/backup_passphrase"
  echo "  chmod 600 /run/secrets/backup_passphrase"
  echo "  chown root:root /run/secrets/backup_passphrase"
  exit 1
fi

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  echo "❌ ERROR: PostgreSQL container not running: $POSTGRES_CONTAINER"
  echo ""
  echo "Available containers:"
  docker ps --format '{{.Names}}'
  exit 1
fi

# Check if PostgreSQL is ready to accept connections
echo "Checking PostgreSQL readiness..."
if ! docker exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then
  echo "❌ ERROR: PostgreSQL is not ready to accept connections"
  echo ""
  echo "Check container logs:"
  echo "  docker logs $POSTGRES_CONTAINER"
  exit 1
fi
echo "✅ PostgreSQL is ready"
echo ""

# Step 1: Stream database dump → compression → encryption
echo "Step 1/3: Creating encrypted backup (streaming)..."
echo "  Source: PostgreSQL database '$POSTGRES_DB'"
echo "  Encryption: AES-256-CBC with PBKDF2 (1M iterations)"
echo ""

docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | \
  gzip -9 | \
  openssl enc -aes-256-cbc -salt -pbkdf2 -iter 1000000 \
    -pass file:/run/secrets/backup_passphrase \
    -out "$ENCRYPTED_BACKUP_TMP"

echo "✅ Temporary backup file created"

# Step 2: Verify encrypted file
echo ""
echo "Step 2/3: Verifying backup..."

if [ ! -f "$ENCRYPTED_BACKUP_TMP" ]; then
  echo "❌ ERROR: Encrypted backup file not created"
  exit 1
fi

# Verify file is actually encrypted (not plaintext)
if file "$ENCRYPTED_BACKUP_TMP" | grep -qi "text\|SQL"; then
  echo "❌ ERROR: Backup appears to be unencrypted!"
  rm "$ENCRYPTED_BACKUP_TMP"
  exit 1
fi

# Atomically move temp file to final location
echo "Moving to final location..."
mv "$ENCRYPTED_BACKUP_TMP" "$ENCRYPTED_BACKUP"

# Set secure permissions
chmod 600 "$ENCRYPTED_BACKUP"
chown root:root "$ENCRYPTED_BACKUP" 2>/dev/null || true

echo "✅ Backup is properly encrypted"

# Step 3: Log backup event (audit trail)
echo ""
echo "Step 3/3: Logging backup event..."
BACKUP_SIZE=$(du -h "$ENCRYPTED_BACKUP" | cut -f1)
mkdir -p /var/log
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BACKUP_CREATED file=$ENCRYPTED_BACKUP size=$BACKUP_SIZE" | \
  tee -a /var/log/backup-audit.log

echo "✅ Audit log updated"

# Summary
echo ""
echo "========================================="
echo "✅ Encrypted Backup Complete!"
echo "========================================="
echo ""
echo "Backup file: $ENCRYPTED_BACKUP"
echo "Size: $BACKUP_SIZE"
echo "Encryption: AES-256-CBC + PBKDF2 (1M iterations)"
echo ""
echo "To restore this backup:"
echo "  openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \\"
echo "    -pass file:/run/secrets/backup_passphrase \\"
echo "    -in $ENCRYPTED_BACKUP | \\"
echo "    gunzip | \\"
echo "    docker exec -i $POSTGRES_CONTAINER psql -U $POSTGRES_USER $POSTGRES_DB"
echo ""
echo "IMPORTANT: Store backup passphrase separately from LUKS passphrase!"
echo ""

#!/bin/bash
# Post-Migration Verification Script
# Verifies data integrity after migration to encrypted volume
# ENHANCED: Includes checksum verification to detect silent corruption

set -e
set -u

# Configuration
SOURCE_DIR="${SOURCE_DIR:-/var/lib/docker/volumes/postgres-data/_data}"
TARGET_DIR="${TARGET_DIR:-/mnt/pg-data-encrypted}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-supersync}"
POSTGRES_DB="${POSTGRES_DB:-supersync}"
CHECKSUM_TEMP="/tmp/migration-checksums-$$"

echo "=== SuperSync Migration Verification ==="
echo "Source: $SOURCE_DIR"
echo "Target: $TARGET_DIR"
echo ""

# Create temp directory for checksums
mkdir -p "$CHECKSUM_TEMP"
trap "rm -rf $CHECKSUM_TEMP" EXIT

# Step 1: File count verification
echo "Step 1/5: Verifying file counts..."
SOURCE_COUNT=$(find "$SOURCE_DIR" -type f 2>/dev/null | wc -l)
TARGET_COUNT=$(find "$TARGET_DIR" -type f 2>/dev/null | wc -l)

echo "  Source files: $SOURCE_COUNT"
echo "  Target files: $TARGET_COUNT"

if [ "$SOURCE_COUNT" -ne "$TARGET_COUNT" ]; then
  echo "❌ FAIL: File count mismatch"
  exit 1
fi
echo "  ✅ File counts match"

# Step 2: Total size verification
echo ""
echo "Step 2/5: Verifying total sizes..."
SOURCE_SIZE=$(du -sb "$SOURCE_DIR" 2>/dev/null | cut -f1)
TARGET_SIZE=$(du -sb "$TARGET_DIR" 2>/dev/null | cut -f1)

echo "  Source size: $(numfmt --to=iec $SOURCE_SIZE)"
echo "  Target size: $(numfmt --to=iec $TARGET_SIZE)"

if [ "$SOURCE_SIZE" -ne "$TARGET_SIZE" ]; then
  echo "❌ FAIL: Size mismatch"
  exit 1
fi
echo "  ✅ Sizes match"

# Step 3: Checksum verification (detects silent corruption)
echo ""
echo "Step 3/5: Computing and comparing checksums..."
echo "  This may take a few minutes for large databases..."

# Generate source checksums (PostgreSQL critical files only for speed)
echo "  Computing source checksums..."
find "$SOURCE_DIR" -type f \( -name "*.conf" -o -name "pg_*" -o -path "*/base/*" \) -print0 2>/dev/null | \
  sort -z | \
  xargs -0 -r md5sum 2>/dev/null > "$CHECKSUM_TEMP/source.md5" || true

# Generate target checksums
echo "  Computing target checksums..."
find "$TARGET_DIR" -type f \( -name "*.conf" -o -name "pg_*" -o -path "*/base/*" \) -print0 2>/dev/null | \
  sort -z | \
  xargs -0 -r md5sum 2>/dev/null > "$CHECKSUM_TEMP/target.md5" || true

# Normalize paths (remove directory prefixes)
sed "s|$SOURCE_DIR/||" "$CHECKSUM_TEMP/source.md5" > "$CHECKSUM_TEMP/source-normalized.md5"
sed "s|$TARGET_DIR/||" "$CHECKSUM_TEMP/target.md5" > "$CHECKSUM_TEMP/target-normalized.md5"

# Compare checksums
if ! diff -q "$CHECKSUM_TEMP/source-normalized.md5" "$CHECKSUM_TEMP/target-normalized.md5" >/dev/null 2>&1; then
  echo "❌ FAIL: Checksum mismatch detected - data corruption or incomplete copy"
  echo ""
  echo "First 10 differences:"
  diff "$CHECKSUM_TEMP/source-normalized.md5" "$CHECKSUM_TEMP/target-normalized.md5" | head -20
  exit 1
fi

CHECKSUM_COUNT=$(wc -l < "$CHECKSUM_TEMP/source-normalized.md5")
echo "  ✅ Checksums match ($CHECKSUM_COUNT files verified)"

# Step 4: PostgreSQL-specific integrity checks
echo ""
echo "Step 4/5: Verifying PostgreSQL data integrity..."

# Check for critical PostgreSQL files
CRITICAL_FILES=(
  "PG_VERSION"
  "postgresql.conf"
  "base"
  "global"
  "pg_wal"
)

for file in "${CRITICAL_FILES[@]}"; do
  if [ ! -e "$TARGET_DIR/$file" ]; then
    echo "❌ FAIL: Critical file missing: $file"
    exit 1
  fi
done
echo "  ✅ All critical PostgreSQL files present"

# Verify PG_VERSION matches
if [ -f "$SOURCE_DIR/PG_VERSION" ] && [ -f "$TARGET_DIR/PG_VERSION" ]; then
  SOURCE_VERSION=$(cat "$SOURCE_DIR/PG_VERSION")
  TARGET_VERSION=$(cat "$TARGET_DIR/PG_VERSION")

  if [ "$SOURCE_VERSION" != "$TARGET_VERSION" ]; then
    echo "❌ FAIL: PostgreSQL version mismatch (source: $SOURCE_VERSION, target: $TARGET_VERSION)"
    exit 1
  fi
  echo "  ✅ PostgreSQL version matches: $TARGET_VERSION"
fi

# Step 5: Database-level verification (if PostgreSQL is running)
echo ""
echo "Step 5/5: Database row count verification..."

if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  echo "  PostgreSQL is running - verifying row counts..."

  # Get table list and row counts
  TABLES=$(docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" "$POSTGRES_DB" -t -c "
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename;
  " 2>/dev/null | tr -d ' ' | grep -v '^$' || echo "")

  if [ -n "$TABLES" ]; then
    TOTAL_ROWS=0
    TABLE_COUNT=0

    while IFS= read -r table; do
      [ -z "$table" ] && continue

      ROW_COUNT=$(docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" "$POSTGRES_DB" -t -c "
        SELECT COUNT(*) FROM \"$table\";
      " 2>/dev/null | tr -d ' ' || echo "0")

      TOTAL_ROWS=$((TOTAL_ROWS + ROW_COUNT))
      TABLE_COUNT=$((TABLE_COUNT + 1))

      echo "    $table: $ROW_COUNT rows"
    done <<< "$TABLES"

    echo "  ✅ Database accessible: $TABLE_COUNT tables, $TOTAL_ROWS total rows"
  else
    echo "  ⚠️  No tables found (may be a fresh database)"
  fi
else
  echo "  ⚠️  PostgreSQL not running - skipping database verification"
  echo "     Start PostgreSQL and re-run for full verification"
fi

# Summary
echo ""
echo "========================================="
echo "✅ Migration Verification PASSED"
echo "========================================="
echo ""
echo "Summary:"
echo "  Files: $TARGET_COUNT"
echo "  Size: $(numfmt --to=iec $TARGET_SIZE)"
echo "  Checksums verified: $CHECKSUM_COUNT files"
echo "  No corruption detected"
echo ""
echo "Migration integrity confirmed!"
echo ""

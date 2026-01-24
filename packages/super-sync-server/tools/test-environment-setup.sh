#!/bin/bash
# Test Environment Setup for Encryption Testing
# Creates sample database with test data for migration dry-run

set -e
set -u

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-supersync}"
POSTGRES_DB="${POSTGRES_DB:-supersync}"

echo "=== SuperSync Test Environment Setup ==="
echo "Container: $POSTGRES_CONTAINER"
echo "Database: $POSTGRES_DB"
echo ""

# Check if PostgreSQL is running
if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  echo "Starting PostgreSQL..."
  docker compose up -d postgres

  # Wait for PostgreSQL to be ready
  echo "Waiting for PostgreSQL to be ready..."
  until docker exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; do
    sleep 1
  done
fi

echo "✅ PostgreSQL is running"

# Verify database exists
if ! docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -lqt | cut -d \| -f 1 | grep -qw "$POSTGRES_DB"; then
  echo "Creating database: $POSTGRES_DB"
  docker exec "$POSTGRES_CONTAINER" createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
fi

echo "✅ Database exists"

# Create sample schema (simple test data)
echo "Creating test schema..."
docker exec -i "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" "$POSTGRES_DB" <<'EOF'
-- Drop existing test tables
DROP TABLE IF EXISTS test_operations CASCADE;
DROP TABLE IF EXISTS test_users CASCADE;
DROP TABLE IF EXISTS test_snapshots CASCADE;

-- Users table
CREATE TABLE test_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Operations table (simulating sync operations)
CREATE TABLE test_operations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES test_users(id),
  operation_type VARCHAR(50),
  payload TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Snapshots table
CREATE TABLE test_snapshots (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES test_users(id),
  snapshot_data BYTEA,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert test users
INSERT INTO test_users (email)
SELECT 'user' || generate_series(1, 10) || '@example.com';

-- Insert test operations (simulate sync activity)
INSERT INTO test_operations (user_id, operation_type, payload)
SELECT
  (random() * 9 + 1)::INTEGER,
  CASE (random() * 3)::INTEGER
    WHEN 0 THEN 'CREATE'
    WHEN 1 THEN 'UPDATE'
    ELSE 'DELETE'
  END,
  'Test payload data ' || generate_series(1, 1000);

-- Insert test snapshots
INSERT INTO test_snapshots (user_id, snapshot_data)
SELECT
  generate_series(1, 10),
  decode(repeat('deadbeef', 1000), 'hex');  -- 4KB of data per snapshot

-- Create indexes (similar to production)
CREATE INDEX idx_operations_user_id ON test_operations(user_id);
CREATE INDEX idx_operations_created_at ON test_operations(created_at);
CREATE INDEX idx_snapshots_user_id ON test_snapshots(user_id);

EOF

echo "✅ Test schema created"

# Display statistics
echo ""
echo "=== Test Data Summary ==="
docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c "
  SELECT
    (SELECT COUNT(*) FROM test_users) AS users,
    (SELECT COUNT(*) FROM test_operations) AS operations,
    (SELECT COUNT(*) FROM test_snapshots) AS snapshots;
"

# Display database size
echo ""
echo "=== Database Size ==="
docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c "
  SELECT pg_size_pretty(pg_database_size('$POSTGRES_DB')) AS size;
"

# Display table sizes
echo ""
echo "=== Table Sizes ==="
docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c "
  SELECT
    schemaname || '.' || tablename AS table,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"

echo ""
echo "========================================="
echo "✅ Test Environment Ready!"
echo "========================================="
echo ""
echo "You can now test:"
echo "  1. Migration: sudo ./tools/migrate-to-encrypted-volume.sh"
echo "  2. Backup: sudo ./tools/backup-encrypted.sh"
echo "  3. Verification: sudo ./tools/verify-migration.sh"
echo ""
echo "To clean up test data:"
echo "  docker exec $POSTGRES_CONTAINER psql -U $POSTGRES_USER $POSTGRES_DB -c \"DROP TABLE test_operations, test_users, test_snapshots CASCADE;\""
echo ""

# SuperSync Encryption-at-Rest Testing Guide

This guide covers Phase 2 testing and validation procedures for the LUKS encryption implementation.

## Overview

**Purpose**: Validate encryption setup before production migration
**Environment**: Test VM or local development environment
**Duration**: 1-2 days for complete testing
**Prerequisites**: Phase 1 tooling installed and verified

## Pre-Test Checklist

- [ ] Test environment available (VM or local)
- [ ] All Phase 1 scripts created and executable
- [ ] Prerequisites verified (`./tools/verify-prerequisites.sh`)
- [ ] AES-NI support confirmed (`grep aes /proc/cpuinfo`)
- [ ] Docker and Docker Compose installed
- [ ] Sufficient disk space (3x database size minimum)

## Test 1: Setup Validation

**Objective**: Verify LUKS volume creation and unlock procedures

### Steps

```bash
# 1. Create test encrypted volume (10GB for testing)
cd /opt/supersync/packages/super-sync-server
sudo ./tools/setup-encrypted-volume.sh --size 10G --name pg-data-encrypted-test

# 2. Verify volume is created and mounted
sudo cryptsetup status pg-data-encrypted-test
mountpoint /mnt/pg-data-encrypted
ls -la /mnt/pg-data-encrypted

# 3. Test unlock with operational passphrase
sudo umount /mnt/pg-data-encrypted
sudo cryptsetup luksClose pg-data-encrypted-test
sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted-test

# 4. Test unlock with recovery passphrase
sudo umount /mnt/pg-data-encrypted
sudo cryptsetup luksClose pg-data-encrypted-test
sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted-test
# Enter recovery passphrase

# 5. Test with WRONG passphrase (should fail)
sudo umount /mnt/pg-data-encrypted
sudo cryptsetup luksClose pg-data-encrypted-test
sudo cryptsetup luksOpen /var/lib/supersync-encrypted.img pg-data-encrypted-test
# Enter incorrect passphrase - should fail

# 6. Unlock again for next tests
sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted-test
```

### Success Criteria

- ✅ Volume creates without errors
- ✅ Both passphrases unlock successfully
- ✅ Wrong passphrase fails cleanly
- ✅ Audit log created: `/var/log/luks-audit.log`
- ✅ LUKS header backup created: `/var/backups/luks-header-*.img.enc`

## Test 2: Migration Dry Run

**Objective**: Test full migration procedure with sample data

### Setup Test Database

```bash
# 1. Start SuperSync with unencrypted volume
cd /opt/supersync/packages/super-sync-server
docker compose up -d

# 2. Wait for services to be healthy
docker compose ps
curl http://localhost:1900/health

# 3. Create test data
# Option A: Manual via API
curl -X POST http://localhost:1900/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# Option B: Use existing E2E test fixtures
# (if available)

# 4. Verify data exists
docker exec postgres psql -U supersync supersync -c "\dt"
docker exec postgres psql -U supersync supersync -c "SELECT COUNT(*) FROM users;"
```

### Execute Migration

```bash
# 1. Run migration script
sudo ./tools/migrate-to-encrypted-volume.sh

# 2. Update Docker Compose configuration
docker compose -f docker-compose.yml -f docker-compose.encrypted.yaml config

# 3. Start with encrypted volume
docker compose -f docker-compose.yml -f docker-compose.encrypted.yaml up -d

# 4. Verify migration
sudo ./tools/verify-migration.sh
```

### Success Criteria

- ✅ Pre-migration backup created
- ✅ PostgreSQL stops cleanly
- ✅ All files copied (rsync completes without errors)
- ✅ File counts match (verify-migration.sh passes)
- ✅ Checksums match (no corruption)
- ✅ PostgreSQL starts on encrypted volume
- ✅ Data accessible (same row counts)
- ✅ SuperSync health check passes

## Test 3: Performance Benchmarking

**Objective**: Measure encryption overhead

### Baseline (Unencrypted)

```bash
# Start with unencrypted volume
docker compose -f docker-compose.yml up -d

# Wait for healthy
until curl -sf http://localhost:1900/health > /dev/null; do sleep 1; done

# Measure database operations
echo "=== Baseline Performance ===" > performance-results.txt
date >> performance-results.txt

# Database benchmark
docker exec postgres pgbench -i -s 10 supersync
docker exec postgres pgbench -c 10 -j 2 -t 1000 supersync | tee -a performance-results.txt

# I/O metrics
iostat -x 5 12 >> performance-results.txt
```

### Encrypted Performance

```bash
# Start with encrypted volume
docker compose -f docker-compose.yml -f docker-compose.encrypted.yaml up -d

# Wait for healthy
until curl -sf http://localhost:1900/health > /dev/null; do sleep 1; done

# Same benchmarks
echo "=== Encrypted Performance ===" >> performance-results.txt
date >> performance-results.txt

docker exec postgres pgbench -c 10 -j 2 -t 1000 supersync | tee -a performance-results.txt
iostat -x 5 12 >> performance-results.txt
```

### Analyze Results

```bash
# Calculate overhead percentage
cat performance-results.txt

# Expected with AES-NI:
# - TPS (transactions/sec): within 10% of baseline
# - Latency: +3-10%
# - Disk utilization: +5-10%
```

### Success Criteria

- ✅ Overhead < 10% for database operations
- ✅ Overhead < 15% for bulk operations
- ✅ No errors during benchmark
- ✅ AES-NI acceleration confirmed (check `/proc/crypto`)

## Test 4: Backup and Restore

**Objective**: Validate encrypted backup procedures

### Create Backup Passphrase

```bash
# Generate backup passphrase
diceware -n 8 | sudo tee /run/secrets/backup_passphrase > /dev/null
sudo chmod 600 /run/secrets/backup_passphrase
```

### Test Backup Creation

```bash
# 1. Create encrypted backup
sudo POSTGRES_CONTAINER=postgres ./tools/backup-encrypted.sh

# 2. Verify backup file
BACKUP=$(ls -t /var/backups/supersync/*.enc | head -1)
ls -lh "$BACKUP"

# 3. Verify file is encrypted (not plaintext)
file "$BACKUP"  # Should NOT say "text" or "SQL"

# 4. Check audit log
tail /var/log/backup-audit.log
```

### Test Restore

```bash
# 1. Create test database
docker exec postgres createdb -U supersync backup_test

# 2. Decrypt and restore
BACKUP=$(ls -t /var/backups/supersync/*.enc | head -1)

openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
  -pass file:/run/secrets/backup_passphrase \
  -in "$BACKUP" | \
  gunzip | \
  docker exec -i postgres psql -U supersync backup_test

# 3. Verify row counts match
PROD_COUNT=$(docker exec postgres psql -U supersync supersync -t -c "SELECT COUNT(*) FROM users;")
TEST_COUNT=$(docker exec postgres psql -U supersync backup_test -t -c "SELECT COUNT(*) FROM users;")

echo "Production: $PROD_COUNT"
echo "Backup: $TEST_COUNT"

# 4. Cleanup
docker exec postgres dropdb -U supersync backup_test
```

### Test Wrong Passphrase

```bash
# Should fail cleanly
echo "wrongpassphrase" > /tmp/wrong_pass

openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
  -pass file:/tmp/wrong_pass \
  -in "$BACKUP" 2>&1 | grep -i "bad decrypt"

rm /tmp/wrong_pass
```

### Success Criteria

- ✅ Backup creates without errors
- ✅ Backup file is encrypted
- ✅ Restore succeeds with correct passphrase
- ✅ Row counts match production
- ✅ Restore fails with wrong passphrase
- ✅ Audit log updated

## Test 5: Rollback Procedure

**Objective**: Practice emergency rollback

### Execute Rollback

```bash
# 1. Document current state
docker exec postgres psql -U supersync supersync -c "SELECT COUNT(*) FROM users;" > pre-rollback-counts.txt

# 2. Stop services
docker compose down

# 3. Unmount and close encrypted volume
sudo umount /mnt/pg-data-encrypted
sudo cryptsetup luksClose pg-data-encrypted-test

# 4. Restore to unencrypted (using pre-migration backup)
BACKUP="/var/backups/supersync/pre-migration-*.sql.gz"

# Start unencrypted postgres
docker compose -f docker-compose.yml up -d postgres

# Wait for ready
until docker exec postgres pg_isready -U supersync; do sleep 1; done

# Drop and recreate database
docker exec postgres psql -U supersync -c "DROP DATABASE IF EXISTS supersync;"
docker exec postgres psql -U supersync -c "CREATE DATABASE supersync;"

# Restore
gunzip < $BACKUP | docker exec -i postgres psql -U supersync supersync

# 5. Start all services
docker compose -f docker-compose.yml up -d

# 6. Verify
docker exec postgres psql -U supersync supersync -c "SELECT COUNT(*) FROM users;" > post-rollback-counts.txt
diff pre-rollback-counts.txt post-rollback-counts.txt

curl http://localhost:1900/health
```

### Success Criteria

- ✅ Rollback completes without errors
- ✅ Row counts match pre-migration
- ✅ SuperSync health check passes
- ✅ No data loss
- ✅ Rollback time < 30 minutes (documented)

## Test 6: Backup Rotation

**Objective**: Validate backup retention policy

### Setup Test Backups

```bash
# Create fake backups with different dates
sudo mkdir -p /var/backups/supersync

# Daily (recent)
for i in {0..10}; do
  DATE=$(date -d "$i days ago" +%Y%m%d-%H%M%S)
  sudo touch -d "$i days ago" "/var/backups/supersync/supersync-$DATE.sql.gz.enc"
done

# Weekly (older)
for i in {1..6}; do
  DATE=$(date -d "$((i * 7)) days ago" +%Y%m%d-%H%M%S)
  sudo touch -d "$((i * 7)) days ago" "/var/backups/supersync/supersync-$DATE.sql.gz.enc"
done

# Count before rotation
echo "Before: $(find /var/backups/supersync -name '*.enc' | wc -l) backups"
```

### Run Rotation

```bash
# Execute rotation
sudo ./tools/backup-rotate.sh

# Check results
echo "After: $(find /var/backups/supersync -maxdepth 1 -name '*.enc' | wc -l) daily"
echo "Weekly: $(find /var/backups/supersync/weekly -name '*.enc' | wc -l) weekly"
echo "Monthly: $(find /var/backups/supersync/monthly -name '*.enc' | wc -l) monthly"

# Verify logs
tail -20 /var/log/backup-rotation.log
```

### Success Criteria

- ✅ Backups > 7 days deleted
- ✅ Weekly backups preserved
- ✅ Monthly backups preserved
- ✅ At least one backup remains
- ✅ Rotation log created

## Results Template

Document test results in: `/packages/super-sync-server/docs/phase2-test-results.md`

```markdown
# Phase 2 Test Results

**Date**: YYYY-MM-DD
**Tester**: [Name]
**Environment**: [VM/Local/Cloud]

## Test Results Summary

| Test                     | Status  | Notes            |
| ------------------------ | ------- | ---------------- |
| 1. Setup Validation      | ✅ PASS |                  |
| 2. Migration Dry Run     | ✅ PASS |                  |
| 3. Performance Benchmark | ✅ PASS | Overhead: X%     |
| 4. Backup/Restore        | ✅ PASS |                  |
| 5. Rollback              | ✅ PASS | Duration: XX min |
| 6. Backup Rotation       | ✅ PASS |                  |

## Performance Results

**Baseline (Unencrypted)**:

- TPS: XXX transactions/sec
- Latency avg: XX ms
- Latency 95th: XX ms

**Encrypted**:

- TPS: XXX transactions/sec (-X%)
- Latency avg: XX ms (+X%)
- Latency 95th: XX ms (+X%)

**Overhead**: X% (within acceptable < 10%)

## Issues Encountered

None / [List any issues]

## Recommendations

- [ ] Ready for production migration
- [ ] Issues to address: [List]
- [ ] Performance acceptable: YES/NO

## Sign-Off

Tested by: [Name]
Date: [Date]
Approved for production: YES/NO
```

## Cleanup After Testing

```bash
# Stop services
docker compose down

# Remove test volume
sudo umount /mnt/pg-data-encrypted
sudo cryptsetup luksClose pg-data-encrypted-test
sudo rm /var/lib/supersync-encrypted.img

# Remove test backups
sudo rm -rf /var/backups/supersync/*

# Clear logs
sudo rm /var/log/luks-audit.log
sudo rm /var/log/backup-audit.log
```

## Next Steps

After successful Phase 2 testing:

1. Document all test results
2. Review with team
3. Proceed to Phase 3: Migration Planning
4. Schedule production migration window

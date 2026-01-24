# SuperSync Encryption-at-Rest Migration Runbook

This runbook provides step-by-step procedures for migrating the SuperSync PostgreSQL database from unencrypted storage to LUKS-encrypted volumes.

**Target Audience**: System administrators performing the production migration
**Estimated Duration**: 2-3 hours (depends on database size)
**Risk Level**: Medium (full rollback available)

---

## Pre-Migration Checklist

Complete these tasks **1 week before** the scheduled maintenance window:

### 1. Database Sizing & Time Estimates

- [ ] **Calculate database size**:

  ```bash
  docker exec postgres du -sh /var/lib/postgresql/data
  # Record result: _____ GB
  ```

- [ ] **Estimate migration time**:
  - Formula: `(size_in_GB × 1.5)` minutes
  - Example: 50GB database = ~75 minutes
  - Add 45 minutes overhead (setup, verification, testing)
  - **Total estimated time**: **\_** hours

- [ ] **Reserve maintenance window**: Total estimate + 50% buffer
  - Scheduled start: \***\*\_\_\_\*\***
  - Scheduled end: \***\*\_\_\_\*\***

### 2. System Prerequisites

- [ ] **Verify AES-NI hardware acceleration**:

  ```bash
  grep aes /proc/cpuinfo
  # If no output, encryption overhead will be 20-40% instead of 3-10%
  ```

- [ ] **Run prerequisites verification**:

  ```bash
  sudo ./tools/verify-prerequisites.sh
  # All checks must pass
  ```

- [ ] **Confirm disk space** (3× database size minimum):
  ```bash
  df -h /var/lib
  # Available space: _____ GB (need: _____ GB)
  ```

### 3. Backup Verification

- [ ] **Create pre-migration backup** (day before):

  ```bash
  sudo POSTGRES_CONTAINER=postgres ./tools/backup-encrypted.sh
  ```

- [ ] **Test restore on separate system/container**:

  ```bash
  # Create test database
  docker exec postgres createdb -U supersync test_restore

  # Decrypt and restore
  BACKUP=$(ls -t /var/backups/supersync/*.enc | head -1)
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
    -pass file:/run/secrets/backup_passphrase \
    -in "$BACKUP" | \
    gunzip | \
    docker exec -i postgres psql -U supersync test_restore

  # Verify row counts
  docker exec postgres psql -U supersync test_restore -c "
    SELECT COUNT(*) FROM operations;
  "
  # Compare with production

  # Cleanup
  docker exec postgres dropdb -U supersync test_restore
  ```

- [ ] **Verify backup integrity**: Test restore completed successfully
- [ ] **Backup accessible from separate system**: Copy to backup location

### 4. Additional Filesystem Backup

- [ ] **Create filesystem-level backup** (safety measure):
  ```bash
  sudo rsync -aH \
    /var/lib/docker/volumes/supersync_pg-data/_data/ \
    /backup/pg-data-filesystem-$(date +%Y%m%d)/
  ```

### 5. Documentation

- [ ] **Document current database statistics**:

  ```bash
  docker exec postgres psql -U supersync supersync -c "
    SELECT
      (SELECT COUNT(*) FROM operations) as operations,
      (SELECT COUNT(*) FROM users) as users,
      (SELECT COUNT(*) FROM user_sync_state WHERE snapshot_data IS NOT NULL) as snapshots;
  " > pre-migration-stats.txt
  ```

- [ ] **Record baseline performance**:
  ```bash
  # Health check response time
  time curl -s http://localhost:1900/health
  # Record: _____ ms
  ```

### 6. Key Management

- [ ] **Generate operational passphrase**:

  ```bash
  diceware -n 8 | tee operational-passphrase.txt
  # Store in password manager (1Password Business vault)
  ```

- [ ] **Generate recovery passphrase**:

  ```bash
  diceware -n 8 | tee recovery-passphrase.txt
  # Store in physical safe/bank deposit box
  ```

- [ ] **Confirm key holders available**:
  - Operational key holder: \***\*\_\_\_\*\***
  - Recovery key holder: \***\*\_\_\_\*\***
  - Both available during maintenance window: YES / NO

### 7. Communication

- [ ] **Send 1-week notice to users** (see Communication Templates below)
- [ ] **Update status page** (if applicable)
- [ ] **Notify stakeholders** of maintenance window

### 8. Rollback Preparation

- [ ] **Review rollback procedure** (see Rollback section below)
- [ ] **Verify backup_final.sql.gz from day-before** exists and is valid
- [ ] **Confirm rollback time acceptable** (~30-60 minutes)

---

## Go/No-Go Decision Criteria

**BEFORE starting migration**, verify ALL criteria are met:

### GO Criteria (All Must Pass)

- ✅ All pre-migration checklist items completed
- ✅ Backup created and restore tested successfully
- ✅ Disk space sufficient (3× database size)
- ✅ AES-NI support confirmed (or performance impact accepted)
- ✅ Key holders available and ready
- ✅ No active critical issues with SuperSync
- ✅ Maintenance window scheduled and communicated
- ✅ Rollback procedure reviewed and understood

### NO-GO Criteria (Any Triggers Abort)

- ❌ Backup creation failed
- ❌ Backup restore test failed
- ❌ Insufficient disk space
- ❌ Key holders unavailable
- ❌ Critical SuperSync issues detected
- ❌ System instability (high load, disk errors)
- ❌ Missing prerequisites (cryptsetup, kernel modules)

**Decision**: GO / NO-GO
**Authorized by**: \***\*\_\_\_\*\***
**Date/Time**: \***\*\_\_\_\*\***

---

## Migration Execution (Maintenance Window)

### Timeline Overview

| Step | Description                   | Duration   | Elapsed Time |
| ---- | ----------------------------- | ---------- | ------------ |
| 1    | Stop sync operations          | 5 min      | T+0          |
| 2    | Final backup                  | 5-10 min   | T+5          |
| 3    | Create encrypted volume       | 5 min      | T+15         |
| 4    | Stop PostgreSQL               | 5 min      | T+20         |
| 5    | Copy data to encrypted volume | 60-120 min | T+25         |
| 6    | Verify data integrity         | 10-20 min  | T+85+        |
| 7    | Update Docker Compose         | 5 min      | T+105+       |
| 8    | Start PostgreSQL (encrypted)  | 5 min      | T+110+       |
| 9    | Post-migration verification   | 15 min     | T+115+       |
| 10   | Resume operations             | 5 min      | T+130+       |

**Total**: 2-3 hours (varies by database size)

---

### Step 1: Stop Sync Operations (T+0)

**Objective**: Prevent new data changes during migration

```bash
# Display maintenance page (if implemented)
# Update status page: "Maintenance in progress"

# Announce maintenance mode to users
echo "SuperSync maintenance in progress. Expected completion: [TIME]"

# NOTE: SuperSync doesn't require explicit stop - just stop accepting connections
# Existing sync operations will complete before PostgreSQL shutdown
```

**Verification**:

- [ ] Maintenance page displayed
- [ ] Status page updated

---

### Step 2: Final Backup (T+5 min)

**Objective**: Create final pre-migration backup (safety net)

```bash
# Create final backup
sudo POSTGRES_CONTAINER=postgres ./tools/backup-encrypted.sh

# Verify backup created
BACKUP_FINAL=$(ls -t /var/backups/supersync/*.enc | head -1)
ls -lh "$BACKUP_FINAL"

# Test decryption (first 100 lines)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
  -pass file:/run/secrets/backup_passphrase \
  -in "$BACKUP_FINAL" | gunzip | head -100

# Record backup size and timestamp
echo "Final backup: $BACKUP_FINAL" >> migration-log.txt
```

**Verification**:

- [ ] Backup file created: `_____` MB
- [ ] Backup decrypts successfully
- [ ] Backup is not empty (> 1 MB)

**GO/NO-GO DECISION POINT**:

- **IF BACKUP FAILS**: ABORT - Reschedule migration
- **IF BACKUP SUCCEEDS**: PROCEED to Step 3

---

### Step 3: Create Encrypted Volume (T+10 min)

**Objective**: Initialize LUKS-encrypted volume with dual-key setup

```bash
# Calculate required size (current size + 20% growth buffer)
DB_SIZE_GB=$(docker exec postgres du -sh /var/lib/postgresql/data | cut -f1 | sed 's/G//')
VOLUME_SIZE="$(echo "$DB_SIZE_GB * 1.2" | bc | cut -d. -f1)G"

echo "Database size: ${DB_SIZE_GB}G"
echo "Volume size: ${VOLUME_SIZE}"

# Run setup script
sudo ./tools/setup-encrypted-volume.sh \
  --size "$VOLUME_SIZE" \
  --name pg-data-encrypted

# IMPORTANT: Enter passphrases when prompted:
# 1. Operational passphrase (from operational-passphrase.txt)
# 2. Recovery passphrase (from recovery-passphrase.txt)
```

**Manual Actions**:

- [ ] Entered operational passphrase (Slot 0)
- [ ] Entered recovery passphrase (Slot 1)
- [ ] LUKS header backup created: `/var/backups/luks-header-*.img.enc`
- [ ] Volume unlocked and mounted: `/mnt/pg-data-encrypted`

**Verification**:

```bash
# Verify volume status
sudo cryptsetup status pg-data-encrypted
# Expected: type LUKS2, cipher aes-xts-plain64, keysize 512

# Verify mount
mountpoint /mnt/pg-data-encrypted
# Expected: /mnt/pg-data-encrypted is a mountpoint

# Verify writable
touch /mnt/pg-data-encrypted/.test && rm /mnt/pg-data-encrypted/.test
# Expected: no errors
```

**GO/NO-GO DECISION POINT**:

- **IF VOLUME CREATION FAILS**: ABORT - Investigate disk space/permissions
- **IF VOLUME CREATED**: PROCEED to Step 4

---

### Step 4: Stop PostgreSQL Cleanly (T+15 min)

**Objective**: Gracefully shut down PostgreSQL to ensure data consistency

```bash
# Graceful shutdown (smart mode - wait for connections to close, 60s timeout)
docker exec postgres pg_ctl stop \
  -D /var/lib/postgresql/data -m smart -t 60

# If graceful shutdown times out, force shutdown (fast mode)
# docker exec postgres pg_ctl stop -D /var/lib/postgresql/data -m fast -t 30

# Stop container
docker compose stop postgres

# Verify container stopped
docker ps | grep postgres
# Expected: no output (container not running)
```

**Verification**:

- [ ] PostgreSQL stopped cleanly (no errors in logs)
- [ ] Container stopped: `docker ps` shows no postgres

**Troubleshooting**:

- If shutdown hangs, check active connections: `docker exec postgres psql -U supersync -c "SELECT * FROM pg_stat_activity;"`
- If necessary, force shutdown with `-m fast` mode

---

### Step 5: Copy Data to Encrypted Volume (T+20 min)

**Objective**: Migrate all PostgreSQL data to encrypted volume

```bash
# Run migration script
sudo ./tools/migrate-to-encrypted-volume.sh
# Script will:
# - Validate source/target
# - Check disk space
# - Copy with rsync -aH (hard link preservation)
# - Verify file counts and sizes
# - Set proper permissions (999:999)
```

**Monitor Progress**:

- Watch screen output for rsync progress
- Estimated time: `(DB_SIZE_GB × 1.5)` minutes
- **DO NOT INTERRUPT** - rsync is resumable if needed

**Verification** (automatic in script):

- [ ] File counts match (source vs target)
- [ ] Total sizes match
- [ ] No errors in rsync output

**Troubleshooting**:

- If interrupted, rerun script - rsync will resume
- If disk space error, check `/mnt/pg-data-encrypted` capacity

---

### Step 6: Verify Data Integrity (T+80 min - varies by size)

**Objective**: Ensure no corruption during copy (checksums)

```bash
# Run verification script
sudo ./tools/verify-migration.sh
# Script will:
# - Compare file counts
# - Compare total sizes
# - Compute MD5 checksums (detects corruption)
# - Verify PostgreSQL-specific files (PG_VERSION, etc.)
# - Check database row counts (if PostgreSQL running)
```

**Expected Output**:

```
✅ File counts match
✅ Sizes match
✅ Checksums match (X files verified)
✅ All critical PostgreSQL files present
✅ Migration Verification PASSED
```

**GO/NO-GO DECISION POINT**:

- **IF VERIFICATION FAILS**: EXECUTE ROLLBACK IMMEDIATELY (see Rollback section)
- **IF VERIFICATION PASSES**: PROCEED to Step 7

---

### Step 7: Update Docker Compose (T+90 min)

**Objective**: Reconfigure Docker to use encrypted volume

```bash
# Backup original configuration
cp docker-compose.yaml docker-compose.yaml.backup

# Option A: Use overlay configuration (recommended)
# No changes needed - use docker-compose.encrypted.yaml at startup

# Option B: Update docker-compose.yaml directly
# Edit volumes section to use bind mount:
# volumes:
#   - /mnt/pg-data-encrypted:/var/lib/postgresql/data
# restart: 'no'  # IMPORTANT: Prevent auto-restart before unlock
```

**Verification**:

- [ ] Backup created: `docker-compose.yaml.backup`
- [ ] Configuration updated for encrypted volume
- [ ] Restart policy set to `'no'` or `'unless-stopped'`

---

### Step 8: Start PostgreSQL on Encrypted Volume (T+95 min)

**Objective**: Start PostgreSQL using encrypted storage

```bash
# Volume should already be unlocked from Step 3
# If not, unlock manually:
sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted
# Enter operational passphrase when prompted

# Start PostgreSQL with encrypted configuration
docker compose -f docker-compose.yml -f docker-compose.encrypted.yml up -d postgres

# Monitor startup
docker compose logs -f postgres
# Wait for: "database system is ready to accept connections"
```

**Verification**:

- [ ] PostgreSQL container started
- [ ] No errors in logs
- [ ] "ready to accept connections" message appears

**Troubleshooting**:

- If container exits immediately, check: `docker compose logs postgres`
- Common issue: Volume not mounted - verify `mountpoint /mnt/pg-data-encrypted`
- Permission issue: Check `ls -la /mnt/pg-data-encrypted` (should be 999:999)

---

### Step 9: Post-Migration Verification (T+100 min)

**Objective**: Comprehensive testing of migrated system

#### 9.1 Database Connectivity

```bash
# Test basic connection
docker exec postgres psql -U supersync -c "SELECT 1;"
# Expected: "1" (single row)
```

**Verification**: [ ] Database accepts connections

#### 9.2 Row Count Validation

```bash
# Compare with pre-migration stats
docker exec postgres psql -U supersync supersync -c "
  SELECT
    (SELECT COUNT(*) FROM operations) as operations,
    (SELECT COUNT(*) FROM users) as users,
    (SELECT COUNT(*) FROM user_sync_state WHERE snapshot_data IS NOT NULL) as snapshots;
" > post-migration-stats.txt

# Manual comparison
diff pre-migration-stats.txt post-migration-stats.txt
# Expected: identical (no differences)
```

**Verification**:

- [ ] Operations count matches: **\_**
- [ ] Users count matches: **\_**
- [ ] Snapshots count matches: **\_**

#### 9.3 SuperSync Health Check

```bash
# Start full SuperSync stack
docker compose -f docker-compose.yml -f docker-compose.encrypted.yml up -d

# Wait for all services
sleep 10

# Health check
curl http://localhost:1900/health
# Expected: HTTP 200 OK, {"status":"ok"} or similar
```

**Verification**: [ ] Health check returns 200 OK

#### 9.4 Test Sync Operation

```bash
# Test with existing account or create test account
# Example: Test snapshot retrieval
time curl -s -H "Authorization: Bearer $TEST_TOKEN" \
  http://localhost:1900/api/sync/snapshot > /dev/null

# Record response time: _____ ms
# Compare with baseline (should be within 15%)
```

**Verification**: [ ] Sync operation succeeds

#### 9.5 Log Analysis

```bash
# Check PostgreSQL logs for errors
docker compose logs postgres | grep -i error
# Expected: no critical errors (ignore benign warnings)

# Check SuperSync server logs
docker compose logs supersync | grep -i error
# Expected: no errors
```

**Verification**:

- [ ] No PostgreSQL errors
- [ ] No SuperSync errors

#### 9.6 Performance Check

```bash
# Compare response times with baseline
time curl -s http://localhost:1900/health
# Record: _____ ms

# Calculate overhead
# Acceptable: < 15% slower than baseline
```

**Verification**: [ ] Performance within acceptable range (< 15% overhead)

---

### Acceptance Criteria Summary

**ALL criteria must pass before proceeding to Step 10**:

- ✅ Database connectivity: `SELECT 1` succeeds
- ✅ Row counts match pre-migration
- ✅ Health check returns 200 OK
- ✅ Test sync operation succeeds
- ✅ No critical errors in logs
- ✅ Performance within 15% of baseline

**GO/NO-GO DECISION POINT**:

- **IF ANY CRITERION FAILS**: EXECUTE ROLLBACK IMMEDIATELY
- **IF ALL CRITERIA PASS**: PROCEED to Step 10

---

### Step 10: Resume Operations (T+110 min)

**Objective**: Return system to production

```bash
# Remove maintenance page
# Update status page: "All systems operational"

# Announce completion (see Communication Templates)
echo "Migration complete - SuperSync is operational"

# Monitor for errors in first hour
docker compose logs -f --tail=100 supersync postgres
```

**Ongoing Monitoring** (first hour):

```bash
# Watch error rate
watch -n 60 "docker compose logs supersync | grep -c ERROR"

# Monitor sync operations
watch -n 60 "docker exec postgres psql -U supersync supersync -c \
  'SELECT COUNT(*) FROM operations WHERE created_at > NOW() - INTERVAL '\''5 minutes'\'';'"
```

**Verification**:

- [ ] Maintenance page removed
- [ ] Status page updated
- [ ] Completion announcement sent
- [ ] No error spikes in first hour

**FINAL GO/NO-GO DECISION POINT**:

- **IF CRITICAL ISSUES DETECTED**: EXECUTE ROLLBACK
- **IF STABLE FOR 1 HOUR**: Migration complete, proceed to Post-Migration tasks

---

## Rollback Procedure

**When to Execute Rollback**:

- Data verification fails (checksums mismatch)
- PostgreSQL fails to start on encrypted volume
- Row counts don't match
- Critical errors in logs
- Performance degradation > 15%

**Estimated Time**: 30-60 minutes

### Rollback Steps

```bash
# 1. Stop all containers
docker compose down

# 2. Unmount and close encrypted volume
sudo umount /mnt/pg-data-encrypted
sudo cryptsetup luksClose pg-data-encrypted

# 3. Restore original Docker Compose configuration
cp docker-compose.yaml.backup docker-compose.yaml

# 4. Start PostgreSQL with original configuration (unencrypted)
docker compose up -d postgres

# 5. Wait for PostgreSQL to be ready
until docker exec postgres pg_isready -U supersync; do
  echo "Waiting for PostgreSQL..."
  sleep 2
done

# 6. Drop and recreate database (fresh start)
docker exec postgres psql -U supersync -c "DROP DATABASE IF EXISTS supersync;"
docker exec postgres psql -U supersync -c "CREATE DATABASE supersync;"

# 7. Restore from final backup
BACKUP_FINAL=$(ls -t /var/backups/supersync/*.enc | head -1)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
  -pass file:/run/secrets/backup_passphrase \
  -in "$BACKUP_FINAL" | \
  gunzip | \
  docker exec -i postgres psql -U supersync supersync

# 8. Start full SuperSync stack
docker compose up -d

# 9. Verify system functionality
curl http://localhost:1900/health
# Expected: HTTP 200 OK

# 10. Test sync operation
# Use test account to verify sync works

# 11. Announce extended maintenance
echo "Migration encountered issues. System restored from backup. Investigating issue."

# 12. Post-rollback: Investigate failure, reschedule migration
```

### Rollback Verification

- [ ] PostgreSQL running on original (unencrypted) volume
- [ ] Health check returns 200 OK
- [ ] Sync operations work
- [ ] Row counts match backup
- [ ] No data loss

---

## Post-Migration Tasks

**Complete within 24 hours of successful migration**:

### 1. Monitoring

- [ ] **Monitor error rates** for 24 hours
- [ ] **Track performance metrics**:
  - Response times
  - Sync operation latency
  - Database query performance
- [ ] **Check disk usage**: `df -h /mnt/pg-data-encrypted`

### 2. Backup Validation

- [ ] **Create first encrypted backup**:
  ```bash
  sudo POSTGRES_CONTAINER=postgres ./tools/backup-encrypted.sh
  ```
- [ ] **Test backup restore** (on test system)
- [ ] **Schedule automated backups** (cron job):
  ```bash
  # Add to crontab
  0 2 * * * /opt/supersync/packages/super-sync-server/tools/backup-encrypted.sh
  0 3 * * 0 /opt/supersync/packages/super-sync-server/tools/backup-rotate.sh
  ```

### 3. Documentation

- [ ] **Update operational procedures** with:
  - Server startup procedure (unlock before start)
  - Backup procedures
  - Key rotation procedures
- [ ] **Document migration results**:
  - Actual migration time
  - Issues encountered
  - Performance impact measured
  - Lessons learned

### 4. Security

- [ ] **Store recovery passphrase** in physical safe
- [ ] **Verify LUKS header backup** stored securely
- [ ] **Test recovery passphrase** (unlock volume):
  ```bash
  # Test unlock with recovery key
  sudo umount /mnt/pg-data-encrypted
  sudo cryptsetup luksClose pg-data-encrypted
  sudo cryptsetup luksOpen /var/lib/supersync-encrypted.img pg-data-encrypted
  # Enter recovery passphrase (Slot 1)
  ```
- [ ] **Delete temporary passphrase files**:
  ```bash
  shred -u operational-passphrase.txt recovery-passphrase.txt
  ```

### 5. Cleanup

- [ ] **Archive pre-migration backups** (keep for 30 days)
- [ ] **Remove old Docker volume** (after 30-day retention):
  ```bash
  # DO NOT DO THIS IMMEDIATELY - wait 30 days
  # docker volume rm postgres-data
  ```
- [ ] **Clean up test data** (if any)

---

## Communication Templates

### Template 1: One Week Before Maintenance

**Subject**: Scheduled Maintenance - SuperSync Encryption Upgrade

**Body**:

```
Hello,

We will be performing a security upgrade on [DATE] from [START_TIME] to [END_TIME] ([TIMEZONE]).

**What's happening:**
- Implementing encryption at rest for GDPR compliance
- All data will be migrated to encrypted storage
- No data loss expected (full backups in place)

**Impact:**
- SuperSync will be unavailable during the maintenance window
- Estimated downtime: 2-3 hours
- Your local data is safe - sync will resume automatically after maintenance
- No action required from you

**Why:**
- Enhances data protection with full database encryption
- Meets GDPR Article 32 encryption requirements
- Adds an additional layer of security against physical storage compromise

**Timeline:**
- [DATE] [START_TIME]: Maintenance begins
- [DATE] [END_TIME]: Expected completion
- Status updates: [URL or email]

If you have any questions or concerns, please reply to this email.

Thank you for your patience as we improve SuperSync's security.

Best regards,
[Your Team]
```

---

### Template 2: During Maintenance

**Subject**: SuperSync Maintenance in Progress

**Body**:

```
SuperSync is currently undergoing scheduled maintenance for encryption upgrade.

**Status**: In progress
**Expected completion**: [TIME]
**Current step**: [STEP_DESCRIPTION]

We will send an update when maintenance is complete.

For urgent questions: [CONTACT]

Thank you for your patience.
```

**Alternative (Status Page)**:

```
🔧 Maintenance in Progress

SuperSync encryption upgrade is underway.
Expected completion: [TIME]

All data is safe. Service will resume automatically.
```

---

### Template 3: After Successful Completion

**Subject**: SuperSync Maintenance Complete - Encryption Enabled

**Body**:

```
Hello,

The SuperSync encryption upgrade is complete and all systems are operational.

**What changed:**
- Database now uses full-disk encryption (LUKS AES-256-XTS)
- All your data has been migrated successfully
- Sync operations have resumed normally
- No action required from you

**Verification completed:**
- ✅ Data integrity verified (all checksums match)
- ✅ All sync operations tested and working
- ✅ Performance within expected range (< 5% overhead measured)
- ✅ No data loss or corruption detected

**What this means for you:**
- Enhanced security: Data is now encrypted at rest
- GDPR compliance: Meets Article 32 encryption requirements
- Same functionality: No changes to how you use SuperSync
- Same performance: No noticeable impact on sync speed

**Maintenance summary:**
- Start time: [START_TIME]
- End time: [END_TIME]
- Total duration: [DURATION]
- Issues: None

If you experience any issues with sync operations, please contact us immediately.

Thank you for your patience during this important security upgrade!

Best regards,
[Your Team]
```

---

### Template 4: After Rollback (Issues Encountered)

**Subject**: SuperSync Maintenance Extended - System Restored

**Body**:

```
Hello,

During today's scheduled encryption maintenance, we encountered technical issues that required us to restore the system from backup.

**Current status:**
- ✅ SuperSync is operational (restored from backup)
- ✅ All data preserved - no data loss
- ✅ Sync operations working normally
- ❌ Encryption upgrade postponed

**What happened:**
- [BRIEF_DESCRIPTION_OF_ISSUE]
- System was safely restored from pre-migration backup
- All data integrity verified

**Next steps:**
- We are investigating the issue
- Migration will be rescheduled once resolved
- New maintenance window: [DATE] (to be confirmed)

**Impact to you:**
- System is back to normal operation
- No data loss
- No action required

We apologize for the extended maintenance window. Your data security is our top priority, and we will only proceed when we are confident in a successful migration.

If you have any questions, please reply to this email.

Thank you for your understanding.

Best regards,
[Your Team]
```

---

## Rollback Triggers

Execute rollback **IMMEDIATELY** if any of these occur:

### During Migration

- ❌ Backup creation fails
- ❌ Encrypted volume creation fails
- ❌ Data verification fails (checksums don't match)
- ❌ File count or size mismatch
- ❌ Critical PostgreSQL files missing

### After Migration

- ❌ PostgreSQL fails to start
- ❌ Row counts don't match pre-migration
- ❌ Health check fails (HTTP 500 or connection error)
- ❌ Sync operations fail
- ❌ Critical errors in logs (data corruption, access denied)
- ❌ Performance degradation > 15%

### Post-Deployment (First Hour)

- ❌ Error rate spike (> 10× normal)
- ❌ Widespread sync failures
- ❌ Database connection timeouts
- ❌ Data integrity issues reported

**Decision Authority**: [NAME/ROLE]

---

## Sign-Off

### Pre-Migration Approval

**Checklist completed by**: \***\*\_\_\_\*\***
**Date**: \***\*\_\_\_\*\***
**Approval to proceed**: \***\*\_\_\_\*\***

### Post-Migration Sign-Off

**Migration completed by**: \***\*\_\_\_\*\***
**Date**: \***\*\_\_\_\*\***
**All verification passed**: YES / NO
**System in production**: YES / NO
**Issues encountered**: NONE / [DESCRIBE]

---

## Appendix: Quick Reference

### Essential Commands

```bash
# Prerequisites check
sudo ./tools/verify-prerequisites.sh

# Create encrypted volume
sudo ./tools/setup-encrypted-volume.sh --size 50G --name pg-data-encrypted

# Unlock volume
sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted

# Create backup
sudo POSTGRES_CONTAINER=postgres ./tools/backup-encrypted.sh

# Migrate data
sudo ./tools/migrate-to-encrypted-volume.sh

# Verify migration
sudo ./tools/verify-migration.sh

# Start with encrypted volume
docker compose -f docker-compose.yml -f docker-compose.encrypted.yml up -d

# Check volume status
sudo cryptsetup status pg-data-encrypted

# Check mount
mountpoint /mnt/pg-data-encrypted
df -h /mnt/pg-data-encrypted

# Database row counts
docker exec postgres psql -U supersync supersync -c "
  SELECT COUNT(*) FROM operations;
"

# Health check
curl http://localhost:1900/health
```

### Contact Information

**Escalation Path**:

- Primary: [NAME/EMAIL/PHONE]
- Secondary: [NAME/EMAIL/PHONE]
- Emergency: [NAME/EMAIL/PHONE]

**Support Resources**:

- Documentation: `/packages/super-sync-server/docs/`
- Runbook location: `/packages/super-sync-server/docs/migration-runbook.md`
- Issue tracking: [URL]

---

**Document Version**: 1.0
**Last Updated**: [DATE]
**Next Review**: After migration completion

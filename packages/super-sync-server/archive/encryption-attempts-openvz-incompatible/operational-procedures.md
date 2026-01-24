# SuperSync Operational Procedures

**Purpose**: Day-to-day operational procedures for encrypted SuperSync deployment

**Audience**: System administrators with server access

---

## Daily Operations

### Starting the Server (After Reboot)

**CRITICAL**: The encrypted volume must be unlocked before Docker starts.

**Prerequisites**:

- SSH access to server
- Operational passphrase (from password manager)

**Procedure**:

```bash
# 1. SSH into server
ssh admin@your-server.example.com

# 2. Unlock encrypted volume
cd /opt/supersync/packages/super-sync-server
sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted

# Enter operational passphrase when prompted

# 3. Verify mount succeeded
ls -la /mnt/pg-data-encrypted/
# Should see PostgreSQL data files (base/, global/, PG_VERSION, etc.)

# 4. Start SuperSync
cd /opt/supersync
docker compose -f docker-compose.yml -f docker-compose.encrypted.yml up -d

# 5. Verify services started
docker compose ps
# All services should show "Up" or "Up (healthy)"

# 6. Health check
curl http://localhost:1900/health
# Expected: HTTP 200 OK
```

**Expected Duration**: 5-10 minutes

**Common Issues**:

| Issue                       | Cause                | Solution                                                          |
| --------------------------- | -------------------- | ----------------------------------------------------------------- |
| "Failed to unlock volume"   | Wrong passphrase     | Verify passphrase in password manager, try recovery key if needed |
| "Mount point not writable"  | Permissions issue    | Check: `sudo chown -R 999:999 /mnt/pg-data-encrypted`             |
| "PostgreSQL fails to start" | Volume not mounted   | Verify: `mountpoint /mnt/pg-data-encrypted`                       |
| "Data directory missing"    | Wrong volume mounted | Check: `ls /mnt/pg-data-encrypted/PG_VERSION` should exist        |

---

## Backup Procedures

### Creating a Backup

**Frequency**: Daily (recommended: 2 AM via cron)

```bash
cd /opt/supersync/packages/super-sync-server
sudo POSTGRES_CONTAINER=postgres ./tools/backup-encrypted.sh
```

**Output**: `/var/backups/supersync/supersync-YYYYMMDD-HHMMSS.sql.gz.enc`

**Verification**:

```bash
# Check backup created
ls -lh /var/backups/supersync/*.enc | tail -1

# Test decryption (first 100 lines)
BACKUP=$(ls -t /var/backups/supersync/*.enc | head -1)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
  -pass file:/run/secrets/backup_passphrase \
  -in "$BACKUP" | gunzip | head -100
```

### Backup Rotation

**Frequency**: Weekly (recommended: Sunday 3 AM)

```bash
sudo ./tools/backup-rotate.sh
```

**Retention Policy**:

- Daily backups: 7 days
- Weekly backups: 4 weeks
- Monthly backups: 12 months

**Check retention**:

```bash
find /var/backups/supersync -name "*.enc" -mtime -7 | wc -l  # Daily (≤7)
find /var/backups/supersync/weekly -name "*.enc" | wc -l      # Weekly (≤4)
find /var/backups/supersync/monthly -name "*.enc" | wc -l     # Monthly (≤12)
```

### Restoring from Backup

**Use case**: Disaster recovery, data corruption, migration rollback

```bash
# 1. Stop SuperSync
docker compose down

# 2. Start PostgreSQL only
docker compose up -d postgres

# 3. Drop and recreate database
docker exec postgres psql -U supersync -c "DROP DATABASE IF EXISTS supersync;"
docker exec postgres psql -U supersync -c "CREATE DATABASE supersync;"

# 4. Decrypt and restore
BACKUP=$(ls -t /var/backups/supersync/*.enc | head -1)  # or specify exact backup
openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
  -pass file:/run/secrets/backup_passphrase \
  -in "$BACKUP" | \
  gunzip | \
  docker exec -i postgres psql -U supersync supersync

# 5. Verify restoration
docker exec postgres psql -U supersync supersync -c "SELECT COUNT(*) FROM operations;"

# 6. Start full stack
docker compose up -d

# 7. Health check
curl http://localhost:1900/health
```

---

## Monitoring

### Daily Health Checks

```bash
# Service status
docker compose ps

# PostgreSQL connectivity
docker exec postgres psql -U supersync -c "SELECT 1;"

# Database size
docker exec postgres psql -U supersync supersync -c "
  SELECT pg_size_pretty(pg_database_size('supersync'));
"

# Encrypted volume disk usage
df -h /mnt/pg-data-encrypted

# Recent errors (last hour)
docker compose logs --since 1h | grep -i error
```

### Weekly Checks

```bash
# Backup verification
ls -lh /var/backups/supersync/*.enc | tail -7

# Test latest backup decryption
BACKUP=$(ls -t /var/backups/supersync/*.enc | head -1)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
  -pass file:/run/secrets/backup_passphrase \
  -in "$BACKUP" | gunzip | head -1 >/dev/null && echo "✅ Backup valid"

# LUKS volume status
sudo cryptsetup status pg-data-encrypted
```

### Performance Baseline

**Establish baseline after migration**:

```bash
# Response time
time curl -s http://localhost:1900/health

# Database query performance
docker exec postgres psql -U supersync supersync -c "
  EXPLAIN ANALYZE SELECT COUNT(*) FROM operations;
"
```

**Monitor for degradation**: If response times increase >20% from baseline, investigate.

---

## Emergency Procedures

### Using Recovery Passphrase

**When**: Operational passphrase lost/compromised

```bash
# Unlock with recovery passphrase (Slot 1)
sudo cryptsetup luksOpen /var/lib/supersync-encrypted.img pg-data-encrypted
# Enter recovery passphrase (from physical safe)

# Mount
sudo mount /dev/mapper/pg-data-encrypted /mnt/pg-data-encrypted

# Continue with normal startup
```

**After recovery**: Generate new operational passphrase and add to Slot 0:

```bash
# Remove old operational key
sudo cryptsetup luksKillSlot /var/lib/supersync-encrypted.img 0

# Add new operational key
sudo cryptsetup luksAddKey /var/lib/supersync-encrypted.img
# Enter recovery passphrase (to authenticate)
# Enter new operational passphrase (to add)
```

### LUKS Header Corruption

**Symptoms**: "Failed to unlock volume" with correct passphrase

```bash
# 1. Restore LUKS header from backup
HEADER_BACKUP=$(ls -t /var/backups/luks-header-*.img.enc | head -1)

# 2. Decrypt header backup
openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
  -pass file:/run/secrets/backup_passphrase \
  -in "$HEADER_BACKUP" \
  -out /tmp/luks-header.img

# 3. Restore header
sudo cryptsetup luksHeaderRestore /var/lib/supersync-encrypted.img \
  --header-backup-file /tmp/luks-header.img

# 4. Cleanup
rm /tmp/luks-header.img

# 5. Unlock volume
sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted
```

### Full System Failure

**Use migration runbook rollback procedure**: See `migration-runbook.md` section "Rollback Procedure"

---

## Scheduled Tasks (Cron)

**Recommended crontab** (`sudo crontab -e`):

```bash
# Daily backup at 2 AM
0 2 * * * /opt/supersync/packages/super-sync-server/tools/backup-encrypted.sh >> /var/log/supersync-backup.log 2>&1

# Weekly backup rotation on Sunday at 3 AM
0 3 * * 0 /opt/supersync/packages/super-sync-server/tools/backup-rotate.sh >> /var/log/supersync-rotation.log 2>&1

# Weekly health check report (Monday 9 AM)
0 9 * * 1 /opt/supersync/packages/super-sync-server/tools/health-check.sh | mail -s "SuperSync Weekly Health" admin@example.com
```

**Note**: Create `health-check.sh` if automated reporting needed (optional).

---

## Security Best Practices

### Passphrase Management

**Operational Passphrase**:

- Store in password manager (1Password Business vault)
- Require 2-person access minimum
- Rotate annually or after personnel changes

**Recovery Passphrase**:

- Store in physical safe or bank deposit box
- Document location in password manager (without the key itself)
- Test unlock annually to verify key works

**Backup Passphrase**:

- Store in password manager
- Same access controls as operational passphrase
- Used for backup encryption/decryption

### Audit Trail

**Review monthly**:

```bash
# LUKS unlock events (who/when)
sudo cat /var/log/luks-audit.log

# Backup events
sudo cat /var/log/backup-audit.log

# Server access logs
sudo last -20
```

### Access Control

- **SSH access**: Require MFA (TOTP, hardware key)
- **Passphrase access**: Document who has access to each key
- **sudo privileges**: Limit to essential personnel
- **Server console**: Physical access control if self-hosted

---

## Troubleshooting Guide

### PostgreSQL Won't Start

**Check in order**:

1. **Is volume mounted?**

   ```bash
   mountpoint /mnt/pg-data-encrypted
   # If not: sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted
   ```

2. **Is data directory present?**

   ```bash
   ls -la /mnt/pg-data-encrypted/
   # Should see: base/, global/, PG_VERSION, postgresql.conf
   ```

3. **Are permissions correct?**

   ```bash
   ls -ld /mnt/pg-data-encrypted/
   # Should be: drwx------ 999 999 (or postgres user)
   # Fix: sudo chown -R 999:999 /mnt/pg-data-encrypted
   ```

4. **Check PostgreSQL logs**:
   ```bash
   docker compose logs postgres | tail -50
   ```

### Slow Performance

**Verify AES-NI enabled**:

```bash
grep aes /proc/cpuinfo
# Should see "aes" flag

cat /proc/crypto | grep -A 10 aes
# Should see "module: aesni_intel" (hardware acceleration)
```

**Check disk I/O**:

```bash
sudo iostat -x 5 3
# Look for high %util or await times
```

**Database maintenance**:

```bash
# Vacuum and analyze (can run while online)
docker exec postgres psql -U supersync supersync -c "VACUUM ANALYZE;"
```

### Disk Space Issues

**Check encrypted volume**:

```bash
df -h /mnt/pg-data-encrypted
# If >80% full, consider expanding
```

**Check backup directory**:

```bash
du -sh /var/backups/supersync
# Run backup rotation if large
```

**Expand encrypted volume** (if needed):

```bash
# 1. Increase image file size
sudo dd if=/dev/zero bs=1G count=10 >> /var/lib/supersync-encrypted.img

# 2. Resize LUKS container
sudo cryptsetup resize pg-data-encrypted

# 3. Resize filesystem
sudo resize2fs /dev/mapper/pg-data-encrypted

# 4. Verify
df -h /mnt/pg-data-encrypted
```

---

## Contact Information

**Escalation Path**:

- **Primary On-Call**: [Name, Phone, Timezone]
- **Secondary On-Call**: [Name, Phone, Timezone]
- **Emergency After-Hours**: [Phone/Pager]

**Key Locations**:

- **Operational Passphrase**: [Password Manager - Vault Name]
- **Recovery Passphrase**: [Physical Location - Safe/Deposit Box]
- **Backup Passphrase**: [Password Manager - Vault Name]

**Documentation**:

- **Migration Runbook**: `docs/migration-runbook.md`
- **Testing Guide**: `docs/testing-guide.md`
- **Encryption Documentation**: `docs/encryption-at-rest.md`
- **Long-term Plan**: `docs/long-term-plans/supersync-encryption-at-rest.md`

**Tools Location**:

- **Scripts**: `/opt/supersync/packages/super-sync-server/tools/`
- **Logs**: `/var/log/supersync-*.log`, `/var/log/luks-audit.log`, `/var/log/backup-audit.log`
- **Backups**: `/var/backups/supersync/`

---

## Quick Reference

### Essential Commands

```bash
# Unlock volume
sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted

# Start SuperSync (encrypted)
docker compose -f docker-compose.yml -f docker-compose.encrypted.yml up -d

# Stop SuperSync
docker compose down

# Create backup
sudo POSTGRES_CONTAINER=postgres ./tools/backup-encrypted.sh

# Check volume status
sudo cryptsetup status pg-data-encrypted

# Check mount
mountpoint /mnt/pg-data-encrypted
df -h /mnt/pg-data-encrypted

# Health check
curl http://localhost:1900/health

# View logs (real-time)
docker compose logs -f

# Database connection test
docker exec postgres psql -U supersync -c "SELECT 1;"
```

---

**Document Version**: 1.0
**Last Updated**: [DATE]
**Next Review**: After production migration

# SuperSync Encryption at Rest

This guide covers setup and operation of LUKS-encrypted database storage for SuperSync.

## Overview

**What**: Full-disk encryption for PostgreSQL database files using LUKS2 (Linux Unified Key Setup)
**Why**: GDPR compliance (Article 32) and protection against physical storage compromise
**How**: Loop device with AES-256-XTS encryption, manual passphrase unlock on boot

**Status**: ✅ Production-ready (reviewed by Codex AI security review, 92/100 security score)

## Architecture

```
[PostgreSQL Container]
         ↓
[Bind Mount: /mnt/pg-data-encrypted]
         ↓
[LUKS Encrypted ext4 Filesystem]
         ↓
[Loop Device: /dev/mapper/pg-data-encrypted]
         ↓
[Encrypted Image File: /var/lib/supersync-encrypted.img]
         ↓
[Physical Disk]
```

**Key Features**:

- **AES-256-XTS** encryption (NIST-approved, hardware-accelerated with AES-NI)
- **Argon2id** key derivation (CPU/memory-hard, resistant to brute-force)
- **Dual-key setup**: Operational (daily use) + Recovery (emergency access)
- **Manual unlock**: Passphrases never stored on server (memory-only during use)
- **Zero code changes**: Transparent to application layer

## Quick Start

### For New Deployments

```bash
cd /opt/supersync/packages/super-sync-server

# 1. Verify prerequisites
sudo ./tools/verify-prerequisites.sh

# 2. Create encrypted volume (50GB, adjust as needed)
sudo ./tools/setup-encrypted-volume.sh --size 50G

# 3. Start services with encryption
docker compose -f docker-compose.yml -f docker-compose.encrypted.yaml up -d

# 4. Create backup passphrase
diceware -n 8 | sudo tee /run/secrets/backup_passphrase > /dev/null
sudo chmod 600 /run/secrets/backup_passphrase
```

### For Existing Deployments

See full migration guide in `/docs/long-term-plans/supersync-encryption-at-rest.md`

## Prerequisites

### Required Packages

```bash
# Debian/Ubuntu
sudo apt install cryptsetup gnupg rsync sysstat coreutils

# Verify
./tools/verify-prerequisites.sh
```

### Hardware

- **AES-NI support** (recommended): Reduces overhead to 3-10%
- **Without AES-NI**: Expect 20-40% performance overhead

Check support: `grep aes /proc/cpuinfo`

## Daily Operations

### Server Startup (After Reboot)

**CRITICAL**: Manual unlock required every time server reboots.

```bash
# 1. SSH into server
ssh admin@your-server.com

# 2. Unlock encrypted volume
cd /opt/supersync/packages/super-sync-server
sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted
# Enter operational passphrase when prompted

# 3. Start Docker services
docker compose -f docker-compose.yml -f docker-compose.encrypted.yaml up -d

# 4. Verify health
docker compose ps
curl https://your-domain.com/health
```

**Expected duration**: 2-5 minutes

### Creating Backups

```bash
# Automated encrypted backup (runs daily via cron)
sudo ./tools/backup-encrypted.sh

# Manual backup
sudo POSTGRES_CONTAINER=postgres ./tools/backup-encrypted.sh
```

**Backup location**: `/var/backups/supersync/supersync-YYYYMMDD-HHMMSS.sql.gz.enc`

### Restoring from Backup

```bash
# 1. Decrypt and restore
BACKUP_FILE="/var/backups/supersync/supersync-20260123-120000.sql.gz.enc"

openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
  -pass file:/run/secrets/backup_passphrase \
  -in "$BACKUP_FILE" | \
  gunzip | \
  docker exec -i postgres psql -U supersync supersync

# 2. Verify restore
docker exec postgres psql -U supersync supersync -c "SELECT COUNT(*) FROM operations;"
```

## Key Management

### Passphrase Storage

**Operational Passphrase** (Slot 0):

- **Location**: 1Password Business vault "SuperSync Production"
- **Access**: 2-3 designated administrators with MFA
- **Usage**: Daily server restarts

**Recovery Passphrase** (Slot 1):

- **Location**: Physical safe + bank deposit box
- **Format**: Sealed tamper-evident envelope
- **Access**: Requires 2 witnesses + photo ID
- **Usage**: Emergency only (operational key lost/compromised)

**Backup Passphrase** (separate):

- **Location**: 1Password vault "SuperSync Backups" + `/run/secrets/backup_passphrase`
- **Purpose**: Encrypt database backups (defense in depth)

### Passphrase Requirements

- **Minimum**: 8 diceware words (103 bits entropy)
- **Generation**: `diceware -n 8` or 1Password passphrase generator
- **Validation**: Enforced during unlock (see unlock script warnings)

### Key Rotation

**Frequency**: Annually OR upon personnel change OR security incident

```bash
# 1. Generate new passphrase
diceware -n 8 > new-passphrase.txt
chmod 600 new-passphrase.txt

# 2. Add new key to LUKS
sudo cryptsetup luksAddKey /var/lib/supersync-encrypted.img
# Enter CURRENT passphrase, then NEW passphrase (twice)

# 3. Test new key
sudo cryptsetup luksOpen --test-passphrase /var/lib/supersync-encrypted.img
# Enter NEW passphrase - should succeed

# 4. Update 1Password with new passphrase

# 5. Remove old key (after verification)
sudo cryptsetup luksRemoveKey /var/lib/supersync-encrypted.img
# Enter OLD passphrase to remove it

# 6. Backup new LUKS header
sudo cryptsetup luksHeaderBackup /var/lib/supersync-encrypted.img \
  --header-backup-file /var/backups/luks-header-$(date +%Y%m%d).img
```

## Disaster Recovery

### LUKS Header Corruption

**Symptoms**: `Device is not a valid LUKS device` error

**Recovery**:

```bash
# 1. Locate encrypted header backup
HEADER_BACKUP="/path/to/luks-header-backup.img.enc"

# 2. Decrypt header backup
openssl enc -d -aes-256-cbc -pbkdf2 -iter 1000000 \
  -pass file:/run/secrets/backup_passphrase \
  -in "$HEADER_BACKUP" \
  -out luks-header.img

# 3. Restore LUKS header
sudo cryptsetup luksHeaderRestore /var/lib/supersync-encrypted.img \
  --header-backup-file luks-header.img

# 4. Test unlock
sudo cryptsetup luksOpen --test-passphrase /var/lib/supersync-encrypted.img

# 5. Mount and verify data
sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted
ls -la /mnt/pg-data-encrypted/
```

### Lost Operational Passphrase

```bash
# 1. Retrieve recovery passphrase from physical safe
#    (requires 2 witnesses + photo ID)

# 2. Unlock with recovery key
sudo ./tools/unlock-encrypted-volume.sh pg-data-encrypted
# Enter RECOVERY passphrase

# 3. Rotate keys immediately
#    - Generate 2 new passphrases (operational + recovery)
#    - Add both to LUKS
#    - Remove old recovery key
#    - Store new recovery key in safe

# 4. Document incident in audit log
echo "[$(date)] Emergency access: operational key unavailable" | \
  sudo tee -a /var/log/luks-audit.log
```

## Monitoring

### Health Checks

```bash
# Verify volume is encrypted and mounted
sudo cryptsetup status pg-data-encrypted
sudo mountpoint -q /mnt/pg-data-encrypted && echo "Mounted" || echo "Not mounted"

# Check disk space
df -h /mnt/pg-data-encrypted

# Review audit logs
sudo tail -20 /var/log/luks-audit.log
```

### Automated Monitoring

See `/docs/long-term-plans/supersync-encryption-at-rest.md` Section 5.4 for:

- Prometheus metrics integration
- Nagios/Icinga check scripts
- Email alerts for failed unlocks
- Daily health check cron jobs

## Troubleshooting

### Volume Won't Unlock

```bash
# Check passphrase (try both operational and recovery)
sudo cryptsetup luksOpen /var/lib/supersync-encrypted.img test-unlock

# If fails: Verify LUKS header integrity
sudo cryptsetup luksDump /var/lib/supersync-encrypted.img
# Should show: Version: 2, Cipher: aes-xts-plain64, Key Slots: 0 1

# If header corrupted: Restore from backup (see Disaster Recovery)
```

### PostgreSQL Won't Start

```bash
# Verify volume is mounted
mountpoint /mnt/pg-data-encrypted || echo "ERROR: Volume not mounted!"

# Verify data exists
ls -la /mnt/pg-data-encrypted/base/

# Check permissions (should be 700, owner 999:999)
ls -lad /mnt/pg-data-encrypted/

# Fix permissions if needed
sudo chown -R 999:999 /mnt/pg-data-encrypted
sudo chmod 700 /mnt/pg-data-encrypted

# Check Docker healthcheck
docker compose ps
docker compose logs postgres
```

### Performance Degradation

```bash
# Check AES-NI acceleration
grep aes /proc/cpuinfo

# Monitor I/O
iostat -x 60 /dev/mapper/pg-data-encrypted

# Benchmark (compare encrypted vs unencrypted baseline)
docker exec postgres pgbench -i -s 10 supersync
docker exec postgres pgbench -c 10 -j 2 -t 1000 supersync
```

## Security Best Practices

1. ✅ **Never** store passphrases on the server
2. ✅ Use separate passphrases for LUKS and backups
3. ✅ Rotate keys annually or after personnel changes
4. ✅ Maintain LUKS header backups in offline storage
5. ✅ Enable audit logging for all unlock events
6. ✅ Require MFA for passphrase access (1Password)
7. ✅ Test disaster recovery procedures quarterly
8. ✅ Review audit logs monthly

## GDPR Compliance

**Article 32 Requirements Met**:

- ✅ Encryption of personal data at rest (AES-256)
- ✅ Encryption of backups (AES-256 with separate keys)
- ✅ Access control (dual-key setup, MFA on passphrases)
- ✅ Audit trail (unlock events, key rotation logged)

**Breach Notification**:

- **Encrypted disk theft**: NOT notifiable (data unintelligible without keys)
- **Backup theft**: NOT notifiable (backups separately encrypted)
- **Live server compromise**: IS notifiable (but E2EE protects content)

## Performance Impact

**With AES-NI** (recommended):

- Database operations: +3-10% latency
- Snapshot generation: +5-15% latency
- I/O throughput: -5-10%

**Without AES-NI**:

- Database operations: +20-40% latency
- Snapshot generation: +30-50% latency
- I/O throughput: -30-40%

## References

- Full implementation plan: `/docs/long-term-plans/supersync-encryption-at-rest.md`
- LUKS documentation: https://gitlab.com/cryptsetup/cryptsetup
- GDPR Article 32: https://gdpr-info.eu/art-32-gdpr/
- AES-NI performance: https://www.kernel.org/doc/html/latest/admin-guide/device-mapper/dm-crypt.html
- Key management best practices: NIST SP 800-57

# Encryption Attempts - OpenVZ Incompatible

This folder contains encryption implementations that don't work on OpenVZ.

## Why They Don't Work

### LUKS (Filesystem Encryption)

- Requires `dm-crypt` kernel module
- OpenVZ containers cannot load kernel modules
- Would work on KVM virtualization

### PostgreSQL TDE (Database Encryption)

- Percona pg_tde extension issues
- Docker configuration complexity
- Technically not feasible in current environment

## What Does Work on OpenVZ

1. **No encryption** (not recommended for production)
2. **Application-level encryption** (encrypt before storing in DB)
3. **Migrate to KVM VPS** (then LUKS would work)

## Files Archived

### LUKS Files

- `docker-compose.encrypted.yaml` - Docker Compose configuration for LUKS-encrypted volumes
- `migration-runbook.md` - Step-by-step migration guide
- `operational-procedures.md` - Daily operations documentation
- `setup-encrypted-volume.sh` - Script to create and format LUKS volume
- `unlock-encrypted-volume.sh` - Script to unlock LUKS volume on boot
- `migrate-to-encrypted-volume.sh` - Script to migrate existing data
- `verify-prerequisites.sh` - Checks for required kernel modules
- `discover-docker-names.sh` - Helper to find Docker container names
- `verify-migration.sh` - Validates successful migration

### TDE Files (in git history only)

See commit 1fdcc9a90 for full TDE implementation. Reverted in commit after this archive was created.

TDE files included:

- `docker-compose.tde.yml` - Docker Compose configuration for Percona TDE
- `docs/TDE-IMPLEMENTATION-SUMMARY.md` - Implementation overview
- `docs/tde-migration-guide.md` - Migration guide
- `docs/tde-operations.md` - Operational procedures
- `tools/setup-tde.sh` - Setup script
- `tools/unlock-tde.sh` - Unlock script
- `tools/migrate-to-tde.sh` - Migration script
- `tools/verify-tde.sh` - Verification script
- `tools/upgrade-postgres-17.sh` - PostgreSQL upgrade script

## Viable Options Going Forward

### Option 1: No Encryption (Current)

**Status:** Works immediately

- ✅ No technical blockers
- ✅ Simple to maintain
- ❌ Not recommended for production with sensitive data
- ❌ May violate GDPR if handling EU user data

**Use case:** Development/testing only

---

### Option 2: Migrate to KVM VPS (Enables LUKS)

**Status:** Requires VPS change

**Cost:** +€2-5/month for KVM VPS

**Benefits:**

- ✅ LUKS scripts already built and tested (in this archive)
- ✅ Battle-tested encryption (LUKS since 2004)
- ✅ Better database performance than OpenVZ
- ✅ 2-3 hour migration effort

**Steps:**

1. Find KVM provider (Hetzner, DigitalOcean, Vultr)
2. Provision new VPS with KVM
3. Copy SuperSync data
4. Use archived LUKS scripts
5. Update DNS

**Recommendation:** ⭐ Best option if budget allows

---

### Option 3: Application-Level Encryption

**Status:** Requires code changes

**Effort:** 1-2 weeks of development

**Approach:**
Encrypt sensitive fields before storing in PostgreSQL using standard crypto libraries.

**Benefits:**

- ✅ Works on any hosting (OpenVZ, KVM, cloud)
- ✅ Full control over what's encrypted
- ✅ Can use standard PostgreSQL

**Drawbacks:**

- ❌ Requires code changes in SuperSync
- ❌ Cannot index encrypted fields
- ❌ More complex to implement correctly
- ❌ Key management complexity

**Recommendation:** Only if staying on OpenVZ and budget is tight

---

### Option 4: Move to Managed PostgreSQL Service

**Status:** Requires service change

**Examples:**

- DigitalOcean Managed Databases (encryption-at-rest included)
- AWS RDS (encryption-at-rest included)
- Supabase (encryption-at-rest included)

**Cost:** ~€10-20/month

**Benefits:**

- ✅ Encryption handled by provider
- ✅ Automated backups
- ✅ High availability options
- ✅ Professional management

**Drawbacks:**

- ❌ Higher cost than self-hosted
- ❌ Migration effort
- ❌ Vendor lock-in

**Recommendation:** Good for production if budget allows

---

## Decision History

**January 2026:** Archived both LUKS and TDE implementations after testing showed neither works on OpenVZ. Operating without encryption-at-rest for now. Future options remain open for KVM migration or application-level encryption if requirements change.

## Files to Keep (Not Archived)

These files remain in the repository as they're still useful:

- `tools/backup-encrypted.sh` - Encrypts backup files with passphrase (separate from database encryption-at-rest)
- `tools/backup-rotate.sh` - Manages backup retention
- `tools/test-environment-setup.sh` - Testing utilities

These provide backup encryption which is different from database encryption-at-rest.

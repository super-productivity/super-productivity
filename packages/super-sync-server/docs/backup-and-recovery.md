# Backup & Disaster Recovery

## Architecture Context

Super Productivity uses an append-only operation log for sync. Every client (desktop, mobile, web) keeps a full copy of its data in local IndexedDB. The server is a relay — **clients are the source of truth**, not the server.

This means disaster recovery is simpler than in a traditional server-authoritative system: as long as one client device survives, all data can be recovered.

## What the Backup Protects

| Data | Where it lives | Why back it up |
|---|---|---|
| User accounts (email, password hash) | Server only | Users can't authenticate without this |
| Passkeys (WebAuthn credentials) | Server only | Can't be regenerated |
| Operation log | Server + all clients | Last resort if all client devices are lost |
| Task/project/tag data | Derived from operation log | Clients reconstruct from ops |

## Backup Setup

### Daily Automated Backup

The backup script creates two dumps:

- **Full dump** (`supersync_*.sql.gz`) — complete database including all operations (~300MB+ for active instances)
- **Accounts-only dump** (`supersync_accounts_*.sql.gz`) — just `users` and `passkeys` tables (tiny, <1MB)

```bash
# Run manually
./scripts/backup.sh

# Set up daily cron at 3 AM with 3-day retention
(crontab -l 2>/dev/null; echo "0 3 * * * RETENTION_DAYS=3 /path/to/scripts/backup.sh >> /var/log/supersync-backup.log 2>&1") | crontab -
```

Backups are saved to `backups/` next to the scripts directory.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `BACKUP_DIR` | `../backups` | Where to store backup files |
| `RETENTION_DAYS` | `14` | Delete backups older than this |
| `DB_CONTAINER` | `supersync-postgres` | Docker container name |
| `POSTGRES_USER` | `supersync` | Database user |
| `POSTGRES_DB` | `supersync` | Database name |
| `RCLONE_REMOTE` | (empty) | Optional rclone remote for off-site upload |

### Off-site Backup (Optional)

```bash
# Install rclone
curl https://rclone.org/install.sh | sudo bash

# Configure a remote (e.g., Backblaze B2)
rclone config

# Run backup with upload
RCLONE_REMOTE=b2:my-bucket/supersync ./scripts/backup.sh --upload
```

## Disaster Recovery

### Recommended: Accounts-Only Restore

This is the simplest and most reliable recovery method when at least one client device has been online recently.

**How it works:**
1. Restore the accounts-only dump (users + passkeys)
2. Sync data (operations, snapshots) starts empty
3. When clients reconnect, gap detection fires automatically
4. Each client re-uploads its full state to the server
5. All clients converge to a consistent state

**Steps:**
```bash
# 1. Restore accounts from backup
gunzip -c backups/supersync_accounts_YYYYMMDD_HHMMSS.sql.gz | \
  docker exec -i supersync-postgres psql -U supersync supersync

# 2. That's it — clients will re-sync automatically when they connect
```

**Why this is preferred:**
- Avoids `SYNC_IMPORT_EXISTS` conflicts that occur with partial restores
- Clients hold the complete data — they are the authoritative source
- Produces a clean, consistent server state
- Verified by e2e tests (`supersync-server-backup-revert.spec.ts`)

### Fallback: Full Database Restore

Use this only if **all client devices are lost** (no client can re-upload data).

```bash
# 1. Stop the server
docker compose stop supersync

# 2. Drop existing data and restore the full dump
docker exec -i supersync-postgres psql -U supersync supersync \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c backups/supersync_YYYYMMDD_HHMMSS.sql.gz | \
  docker exec -i supersync-postgres psql -U supersync supersync

# 3. Restart the server
docker compose start supersync
```

> **Note:** The database name (`supersync` above) must match your deployment's
> `POSTGRES_DB` setting. Check your `.env` or `docker-compose.yml` for the actual value.

**Known limitation:** If clients reconnect after a full restore, the server's existing `SYNC_IMPORT` operation can conflict with the client's gap detection mechanism (`SYNC_IMPORT_EXISTS` error). To resolve this, use the "Reset Account" feature in the app to clear server sync data, then re-sync.

### Recovery Decision Tree

```
Server is down / data lost
├── Do any client devices still have data?
│   ├── YES → Use accounts-only restore (recommended)
│   │         Clients will re-upload automatically
│   └── NO  → Use full database restore (fallback)
│             Accept data loss since last backup
```

## Hoster Backups

If your VPS hoster provides incremental backups (e.g., daily snapshots), these serve as an additional safety net. However:

- **Not a substitute for pg_dump** — filesystem-level backups of a running PostgreSQL database may not be crash-consistent
- **Good complement** — they capture config files, TLS certs, Docker setup, and other server state that pg_dump doesn't cover

The combination of `pg_dump` cron + hoster backups covers both scenarios well.

## Verifying Backups

```bash
# Check backup exists and has reasonable size
ls -lh backups/

# Verify the dump contains valid SQL
gunzip -c backups/supersync_YYYYMMDD_HHMMSS.sql.gz | head -5

# Check cron is running
cat /var/log/supersync-backup.log
```

## E2E Test Coverage

The backup recovery scenarios are covered by automated tests in `e2e/tests/sync/supersync-server-backup-revert.spec.ts`:

1. **Complete data loss** — server wiped, single client recovers all data
2. **Partial revert** — server reverted to older state, client preserves local data
3. **Accounts-only restore** — recommended recovery path with multi-client convergence

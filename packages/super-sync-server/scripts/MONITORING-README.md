# SuperSync Monitoring & Analysis Tools

Comprehensive suite of tools for monitoring and analyzing SuperSync server storage, operations, and user patterns.

## Quick Start

```bash
# Run all monitoring checks
npm run monitor:all

# Run quick health check (skip deep analysis)
npm run monitor:all:quick

# Save full report to file
npm run monitor:all:save

# Focus on specific user
npm run monitor:all -- --user 29
```

## Available Tools

### 1. Basic Monitoring (`monitor.ts`)

General server health and user storage tracking.

```bash
# System vitals (CPU, memory, disk, DB)
npm run monitor:dev -- stats

# Top 20 users by storage
npm run monitor:dev -- usage

# View usage history/trends
npm run monitor:dev -- usage-history --tail 20

# Active user counts and recent activity
npm run monitor:dev -- active-users
npm run monitor:dev -- active-users --threshold 5 --limit 50

# Recent operations analysis
npm run monitor:dev -- ops --tail 100
npm run monitor:dev -- ops --user 29

# View server logs
npm run monitor:dev -- logs --tail 200
npm run monitor:dev -- logs --search "error"
npm run monitor:dev -- logs --error
```

### 2. Storage Analysis (`analyze-storage.ts`)

Deep-dive analysis for investigating storage anomalies and patterns.

```bash
# Analyze operation size distribution
npm run analyze-storage -- operation-sizes
npm run analyze-storage -- operation-sizes --user 29

# Temporal patterns (bursts, daily/hourly trends)
npm run analyze-storage -- operation-timeline
npm run analyze-storage -- operation-timeline --user 29

# Breakdown by operation/entity types
npm run analyze-storage -- operation-types
npm run analyze-storage -- operation-types --user 29

# Find largest operations
npm run analyze-storage -- large-ops --limit 50

# Detect rapid-fire/sync loops (>5 ops/second by default)
npm run analyze-storage -- rapid-fire --threshold 10

# Analyze snapshot patterns
npm run analyze-storage -- snapshot-analysis

# Complete deep-dive for one user
npm run analyze-storage -- user-deep-dive --user 27

# Export operations to JSON for external analysis
npm run analyze-storage -- export-ops --user 29 --limit 1000

# Compare two users
npm run analyze-storage -- compare-users 27 29
```

### 3. Complete Monitoring Suite (`run-all-monitoring.ts`)

Runs all monitoring and analysis tools in sequence.

```bash
# Run everything
npm run monitor:all

# Quick mode (skip deep analysis)
npm run monitor:all:quick

# Save to timestamped file in monitoring-reports/
npm run monitor:all:save

# Focus on specific user
npm run monitor:all -- --user 29 --save
```

## Investigation Workflows

### Workflow 1: General Health Check

```bash
npm run monitor:all:quick
```

Review:

- System vitals
- Top users by storage
- Operation size distribution
- Large operations
- Rapid-fire detection

### Workflow 2: Investigate User with High Storage

User has unusually high storage (e.g., User #29 with 28k operations):

```bash
# Step 1: Get complete picture
npm run analyze-storage -- user-deep-dive --user 29

# Step 2: Check for rapid-fire patterns
npm run analyze-storage -- rapid-fire --threshold 3

# Step 3: Export for detailed analysis
npm run analyze-storage -- export-ops --user 29 --limit 5000
```

### Workflow 3: Investigate Large Operations

User has unusually large operations (e.g., User #27 with 54KB avg):

```bash
# Step 1: Find largest operations
npm run analyze-storage -- large-ops --limit 20

# Step 2: Analyze that user's patterns
npm run analyze-storage -- user-deep-dive --user 27

# Step 3: Compare with "normal" user
npm run analyze-storage -- compare-users 27 29
```

### Workflow 4: Investigate Sync Loops

Suspect a sync loop or rapid-fire operations:

```bash
# Step 1: Detect rapid-fire (lower threshold)
npm run analyze-storage -- rapid-fire --threshold 3

# Step 2: Timeline analysis for affected user
npm run analyze-storage -- operation-timeline --user 29

# Step 3: Check operation types
npm run analyze-storage -- operation-types --user 29
```

### Workflow 5: Monthly Report

Generate comprehensive monthly storage report:

```bash
# Generate and save full report
npm run monitor:all:save

# Review trends
npm run monitor:dev -- usage-history --tail 30
```

## Output Files

- **Usage History**: `logs/usage-history.jsonl` - Appended by `monitor.ts usage`
- **Analysis Exports**: `analysis-output/` - JSON exports from `export-ops`
- **Full Reports**: `monitoring-reports/` - Timestamped reports from `monitor:all --save`

## Common Patterns to Investigate

### High Operation Count (>10k ops)

Possible causes:

- Long-time user (check first_op timestamp)
- Sync loop (check rapid-fire detection)
- Small operations (check avg op size)

**Investigate**: `user-deep-dive`, `operation-timeline`, `rapid-fire`

### Large Average Operation Size (>10KB)

Possible causes:

- SYNC_IMPORT operations
- Large task attachments
- Bulk operations

**Investigate**: `large-ops`, `operation-types`, compare with normal users

### Many Operations per Second

Possible causes:

- Sync loop between devices
- Rapid user interaction
- Buggy client

**Investigate**: `rapid-fire`, `operation-timeline`, per-device breakdown in `user-deep-dive`

### Large Snapshots

Possible causes:

- High operation count triggering snapshot
- Large state size

**Investigate**: `snapshot-analysis`, correlation with op count

## Alerting (health-alert.sh)

The reports above are things you go and read. `health-alert.sh` is the only thing
that comes and finds you, and it is **the piece that has to be installed** — it
is not started by `deploy.sh` and nothing else runs it:

```bash
(crontab -l 2>/dev/null; echo "*/5 * * * * ALERT_EMAIL=you@example.com /path/to/super-sync-server/scripts/health-alert.sh") | crontab -
```

`deploy.sh` reports at the end of every deploy whether this exact cron exists,
whether it is still completing, and whether the last attempted email failed. It
cannot prove delivery while the system is healthy because no email is sent then.
If it says the cron is missing, nothing is watching the server.

### What it checks

| #   | Check                                                            | Fires when                                                               |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0–3 | Docker daemon, container state/health, OOM kills, restart counts | a container is down, unhealthy, OOM-killed, or crash-looping             |
| 4   | `/health` endpoint                                               | HTTP != 200                                                              |
| 5   | Disk usage                                                       | > 85%                                                                    |
| 6   | Long-running queries                                             | any query `active` > `MAX_QUERY_SECONDS` (default 120)                   |
| 7   | Pool saturation                                                  | connections in use ≥ `POOL_WARN_PCT`% (default 75) of `connection_limit` |
| 8   | Invalid operations indexes                                       | a non-building index is not valid/ready/live                             |

Checks 0–5 detect the outage once containers or `/health` fail. Checks 6–8 inspect
the database through the app container and catch the precursor while the server
can still answer. This also works when `POSTGRES_SERVICE=` selects an external
database. A failed/malformed probe and a missing `connection_limit` are themselves
alertable problems, so the new checks cannot silently become inert.

Check 7 is deliberately a **ratio** against `connection_limit`, not a fixed
number: measured steady state sits the same order of magnitude below the
pathological-query ceiling (pool size ÷ worst-case query duration), so the
absolute margin is thin and a fixed threshold would not survive a pool resize.

Check 8 matters more than it looks. An interrupted `CREATE INDEX CONCURRENTLY`
leaves an index that is **unusable for reads but still maintained on every
insert**. If `operations_entity_ids_gin` were the invalid one, the conflict
lookup would silently degrade to a sequential scan on every upload, permanently,
and nothing else in the codebase would report it.

The known migrator is excluded from the long-query check. Indexes currently
listed in `pg_stat_progress_create_index`, and invalid indexes carrying the
exact DDL lock held by an active migrator, are excluded from check 8. The latter
also covers `DROP INDEX CONCURRENTLY`, which has no progress-view entry, without
hiding unrelated invalid indexes. Each migration run has a unique database
application id; its finite database/client timeouts and targeted backend cleanup
bound interrupted DDL without generating incident/recovery noise.

Repeat alerts for the same problem are suppressed by a content hash, so counts
and durations are normalised out — you get one mail per distinct problem, plus a
recovery mail when it clears.

## Automation

You can set up cron jobs for regular monitoring:

```bash
# Daily health check at 2 AM
0 2 * * * cd /path/to/super-sync-server && npm run monitor:all:quick >> logs/daily-check.log 2>&1

# Weekly full report every Sunday at 3 AM
0 3 * * 0 cd /path/to/super-sync-server && npm run monitor:all:save

# Hourly rapid-fire detection
0 * * * * cd /path/to/super-sync-server && npm run analyze-storage -- rapid-fire >> logs/rapid-fire.log 2>&1
```

## Tips

1. **Start broad, then narrow**: Use `monitor:all:quick` first, then drill down with specific commands
2. **Always save significant findings**: Use `--save` or redirect output to files
3. **Compare users**: Use `compare-users` to understand what's "normal" vs anomalous
4. **Export for deep analysis**: Use `export-ops` to get raw data for custom analysis
5. **Watch trends**: Regular `usage-history` checks reveal growth patterns

## Troubleshooting

### "Database connection failed"

- Check DATABASE_URL in .env
- Ensure PostgreSQL is running
- Verify network access

### "Command not found: tsx"

- Install tsx globally: `npm install -g tsx`
- Or use npx: `npx tsx scripts/analyze-storage.ts ...`

### "Out of memory"

- Reduce `--limit` values
- Run in quick mode
- Increase Node.js heap: `NODE_OPTIONS=--max-old-space-size=4096 npm run ...`

### "Query timeout"

- Database might be under load
- Reduce time ranges
- Add indexes if needed

## Development

To add new analysis commands:

1. Add function to `scripts/analyze-storage.ts`
2. Add case to `main()` switch
3. Update `getMonitoringCommands()` in `run-all-monitoring.ts` if it should run in full suite
4. Document here

## Performance Notes

- **Quick mode**: ~10-30 seconds
- **Full suite**: ~1-3 minutes (depends on data size)
- **user-deep-dive**: ~5-15 seconds per user
- **export-ops**: ~1-5 seconds per 1000 operations

## Security Notes

- Exports contain full operation payloads - handle securely
- User emails are included in outputs - be mindful of privacy
- Encrypted payloads show as encrypted in analysis
- Clean up old reports periodically

---

**Questions or issues?** File an issue or check the main SuperSync documentation.

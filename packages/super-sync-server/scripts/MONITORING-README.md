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

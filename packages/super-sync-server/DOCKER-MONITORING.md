# Production Docker Monitoring Guide

Quick reference for monitoring your SuperSync production Docker container.

## Prerequisites

- Docker container running (default name: `supersync-server`)
- If using custom container name: `export SUPERSYNC_CONTAINER=your-container-name`

## Quick Start

```bash
cd packages/super-sync-server

# View current storage usage (your use case!)
npm run docker:monitor:usage

# Complete monitoring suite (saves to file in container)
npm run docker:monitor:all

# Interactive shell
npm run docker:shell
```

## Common Commands

### Basic Health Checks

```bash
# System vitals (CPU, memory, disk, DB)
./scripts/docker-monitor.sh stats

# Top 20 users by storage (MOST USEFUL for your current investigation)
./scripts/docker-monitor.sh usage

# Recent operations
./scripts/docker-monitor.sh ops --tail 100

# Server logs
./scripts/docker-monitor.sh logs --tail 200
./scripts/docker-monitor.sh logs --error
```

### Investigate Specific Users

Based on your production data, investigate the anomalies:

```bash
# User #29 with 28k operations (171 bytes avg)
./scripts/docker-monitor.sh analyze user-deep-dive --user 29
./scripts/docker-monitor.sh analyze rapid-fire --threshold 3

# User #27 with huge operations (54 KB avg)
./scripts/docker-monitor.sh analyze user-deep-dive --user 27
./scripts/docker-monitor.sh analyze large-ops --limit 20

# Compare the two
./scripts/docker-monitor.sh analyze compare-users 27 29
```

### Analysis Commands

```bash
# Operation size distribution
./scripts/docker-monitor.sh analyze operation-sizes
./scripts/docker-monitor.sh analyze operation-sizes --user 29

# Detect sync loops/rapid-fire
./scripts/docker-monitor.sh analyze rapid-fire --threshold 5

# Find largest operations
./scripts/docker-monitor.sh analyze large-ops --limit 50

# Timeline analysis (daily/hourly patterns)
./scripts/docker-monitor.sh analyze operation-timeline --user 29

# Operation type breakdown
./scripts/docker-monitor.sh analyze operation-types --user 29

# Snapshot analysis
./scripts/docker-monitor.sh analyze snapshot-analysis

# Export data for offline analysis
./scripts/docker-monitor.sh analyze export-ops --user 29 --limit 1000
```

### Complete Monitoring Suite

```bash
# Run all checks (takes 1-3 minutes)
./scripts/docker-monitor.sh monitor-all

# Quick mode (skip deep analysis, ~30 seconds)
./scripts/docker-monitor.sh monitor-all --quick

# Save report to file in container
./scripts/docker-monitor.sh monitor-all --save

# Focus on specific user
./scripts/docker-monitor.sh monitor-all --user 29 --save
```

### Get Reports from Container

```bash
# Copy all reports from container to host
./scripts/docker-monitor.sh get-reports ./my-reports

# Files copied:
# - monitoring-reports/*.txt (from monitor-all --save)
# - analysis-output/*.json (from export-ops)
# - usage-history.jsonl (usage tracking over time)
```

## Direct Docker Commands

If you prefer not to use the wrapper script:

```bash
# Basic monitoring (uses compiled JS)
docker exec -it supersync-server node dist/scripts/monitor.js usage
docker exec -it supersync-server node dist/scripts/monitor.js stats
docker exec -it supersync-server node dist/scripts/monitor.js ops --user 29

# Analysis (requires tsx - auto-installed on first use)
docker exec -it supersync-server tsx scripts/analyze-storage.ts user-deep-dive --user 29

# Interactive shell
docker exec -it supersync-server sh

# Inside the shell:
cd /app
tsx scripts/analyze-storage.ts --help
node dist/scripts/monitor.js --help
```

## Automated Monitoring

Set up cron jobs on the Docker host:

```bash
# Add to host crontab
crontab -e

# Daily usage snapshot at 2 AM
0 2 * * * cd /path/to/super-productivity/packages/super-sync-server && ./scripts/docker-monitor.sh usage >> /var/log/supersync-daily.log 2>&1

# Weekly full report every Sunday at 3 AM
0 3 * * 0 cd /path/to/super-productivity/packages/super-sync-server && ./scripts/docker-monitor.sh monitor-all --save

# Hourly rapid-fire detection
0 * * * * cd /path/to/super-productivity/packages/super-sync-server && ./scripts/docker-monitor.sh analyze rapid-fire >> /var/log/supersync-rapid-fire.log 2>&1
```

## Recommended Investigation Workflow

Based on your current production findings:

### Step 1: Get the big picture

```bash
./scripts/docker-monitor.sh monitor-all --save
./scripts/docker-monitor.sh get-reports ./investigation-$(date +%Y%m%d)
```

### Step 2: Investigate User #29 (28k tiny ops)

```bash
./scripts/docker-monitor.sh analyze user-deep-dive --user 29
./scripts/docker-monitor.sh analyze rapid-fire --threshold 3
./scripts/docker-monitor.sh analyze operation-timeline --user 29
```

### Step 3: Investigate User #27 (huge ops)

```bash
./scripts/docker-monitor.sh analyze user-deep-dive --user 27
./scripts/docker-monitor.sh analyze large-ops --limit 10
```

### Step 4: Export data for deeper analysis

```bash
./scripts/docker-monitor.sh analyze export-ops --user 29 --limit 5000
./scripts/docker-monitor.sh analyze export-ops --user 27 --limit 1000
./scripts/docker-monitor.sh get-reports ./exports
```

## Troubleshooting

### Container not found

```bash
# List running containers
docker ps

# Set custom container name
export SUPERSYNC_CONTAINER=my-container-name
./scripts/docker-monitor.sh usage
```

### tsx not found (first time)

The script automatically installs `tsx` globally in the container on first use. This persists until the container is recreated.

To manually install:

```bash
docker exec supersync-server npm install -g tsx
```

### Permission denied on script

```bash
chmod +x packages/super-sync-server/scripts/docker-monitor.sh
```

### Out of memory in container

Increase Docker memory limit or reduce analysis scope:

```bash
# Reduce limits
./scripts/docker-monitor.sh analyze large-ops --limit 10
./scripts/docker-monitor.sh analyze export-ops --user 29 --limit 100
```

### Reports not found when getting

Run a command with `--save` first:

```bash
./scripts/docker-monitor.sh monitor-all --save
./scripts/docker-monitor.sh get-reports .
```

## Performance Notes

- **Basic commands** (stats, usage, ops): < 5 seconds
- **Quick suite**: ~30 seconds
- **Full suite**: 1-3 minutes depending on data size
- **User deep-dive**: 5-15 seconds per user
- **Export operations**: ~1 second per 1000 operations

## Security Notes

- Scripts run as the `supersync` user inside the container
- Exported data contains full operation payloads - handle securely
- User emails are included in reports
- Clean up old reports periodically to save disk space

## File Locations (in container)

- Monitoring reports: `/app/monitoring-reports/`
- Analysis exports: `/app/analysis-output/`
- Usage history: `/app/logs/usage-history.jsonl`
- Server logs: `/app/logs/app.log`

## Next Steps

After gathering data:

1. Review the reports
2. Identify patterns (sync loops, large ops, etc.)
3. Check client-side logs for affected users
4. Consider implementing fixes or contacting users
5. Set up regular monitoring to catch future issues

For detailed command documentation, see [MONITORING-README.md](scripts/MONITORING-README.md).

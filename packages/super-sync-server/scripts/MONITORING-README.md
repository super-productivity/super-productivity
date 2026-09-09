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

The all-user operation reports (`operation-sizes`, `operation-types`,
`large-ops`, `rapid-fire`, `operation-timeline`, and `monitor -- ops`) sample the
200 most recently active users by default. `MONITOR_SCOPE_USERS` moves that cap —
raise it for a wider picture, lower it if a report hits the database
`statement_timeout`. See [Performance Notes](#performance-notes).

It is an environment variable rather than a flag so that it also reaches the
suite, which builds its own child command lines and forwards no per-report flags:

```bash
MONITOR_SCOPE_USERS=500 npm run analyze-storage -- operation-sizes
MONITOR_SCOPE_USERS=25 npm run monitor:all          # applies to all six reports
```

Each report prints the population it actually measured, including how many users
matched, so a truncated sample cannot be mistaken for a complete one.

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
# Step 1: Find the largest operations among currently-active users.
# This is a recent sample, not a search of all history -- see Performance Notes.
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

### Workflow 6: Digging out of an ops backlog

Retention failing silently (see the `Cleanup [old-ops]` warnings in the server
log) leaves a prunable backlog that the steady-state budget cannot clear: the
sweep runs **once per day**, so the 25k default clears 25k/day — a 4.4M-row backlog
takes about six months, and a few million takes months.

```bash
npm run dry-run-old-ops-sweep     # read-only; predicts what would go
```

Run it **off-peak**: it is two full aggregate passes over `operations` and will evict the
page cache the live site depends on. It also _over_-predicts slightly — it mirrors the
sweep's skip reasons in SQL, but it cannot model a user the sweep skips on a database
error, which is exactly the deep-prefix cohort you are digging out of. The
`N user(s) threw before their drain` count below is that discrepancy.

Size `OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN` against that number so the backlog
clears in a defined number of nights, then put it **back** to the default — a
permanently high ceiling turns a future runaway into a bigger one. Raise in steps
and watch three signals:

- `N user(s) failed mid-drain` — the **delete** batch is hitting the database
  `statement_timeout`. Lower `OLD_OPS_CLEANUP_DELETE_BATCH_SIZE` (on a host with slow
  cold reads, try 500–1000 rather than the 5000 default); do not raise the timeout.
- `N user(s) threw before their drain` — a **probe** timed out on a deep prefix, before
  anything was deleted. Lowering the batch size does not help; this is the cohort that
  needs a partial index covering the causal-boundary probe (see the operations
  runbook for the outage analysis and index SQL).
- the pool-busy health alert — the sweep is competing with real traffic.

`Cleanup [old-ops]: abandoned the run after N consecutive candidate failures` means the
fault is systemic (pool exhausted, cold cache, database down), not per-user; the sweep
stopped on purpose rather than hammering the whole fleet at one timeout each.

Two things surprise people afterwards. Deleting millions of rows leaves that many
dead tuples, so expect autovacuum work. And the table does **not** shrink on
disk — `DELETE` returns space to PostgreSQL for reuse, not to the OS; only
`VACUUM FULL` or `pg_repack` does that, both needing a maintenance window. Dumps
shrink immediately either way, since `pg_dump` writes live rows only.

The daily sweep fires ~10s after the app starts and then every 24h, so the
**restart time picks the hour it runs**. Restart at a quiet hour — and not during
the backup window — if the sweep is heavy.

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

### The cron entry is not enough — you also need an MTA

`ALERT_EMAIL` plus the crontab line above gets the _checks_ running. Delivering
their result needs a working `mail` command, and stock Debian and Ubuntu have
none. Install `mailutils` or `bsd-mailx` — those provide `mail` itself. Neither
`msmtp` nor `msmtp-mta` does: msmtp is a transport and `msmtp-mta` only supplies
the `sendmail` interface underneath, so installing it alone leaves the check
still failing. Use it _in addition to_ `bsd-mailx` if msmtp is your relay.

`health-alert.sh` checks for the binary on every run and records its absence
in `.health-alert/mail-failed`, which `deploy.sh` surfaces. The same marker
pattern carries `.health-alert/oom-check-blind` (see the OOM section below):
conditions that mean _a check could not run_ are reported at deploy time, never
in the alert body, so they cannot keep `PROBLEMS` permanently non-empty and
disable the recovery mail. Confirm delivery end to end before trusting the
setup:

```bash
echo test | mail -s 'SuperSync test' you@example.com
```

A queuing MTA exits 0 on accept, not on delivery, so check the message actually
arrived. If it did not, `mailx` writes the undelivered body to `~/dead.letter`
for the cron user.

`deploy.sh` reports at the end of every successful deploy whether this exact cron exists,
whether it is still completing, and why the last attempted email failed. If it
says the cron is missing, nothing is watching the server.

If the cron was already running _before_ you installed the MTA, the missing-binary
marker gets you that proof for free: the next healthy run sends one
`SuperSync OK: Health Check Recovered` message and clears the marker. In the other
order nothing is sent on a healthy server, so use the manual test above.

The `Reason:` line `deploy.sh` prints comes from your MTA and can name the recipient
address and the relay host — redact it before pasting into an issue.

### What it checks

| #     | Check                                                 | Fires when                                                                                                                                                                                                             |
| ----- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0,1,3 | Docker daemon, container state/health, restart counts | a container is down, unhealthy, or crash-looping. A stopped container reports its exit code (`state: exited (exit 128)`)                                                                                               |
| 2     | OOM kills (kernel log)                                | an OOM kill in the last 6 min. Needs the cron user to read the kernel log (`systemd-journal`, or `adm`); otherwise skipped and reported via the marker below, never as a health finding. Runs even when Docker is down |
| 4     | `/health` endpoint                                    | HTTP != 200                                                                                                                                                                                                            |
| 5     | Disk usage                                            | > 85%                                                                                                                                                                                                                  |
| 6     | Long-running queries                                  | any query `active` > `MAX_QUERY_SECONDS` (default 120)                                                                                                                                                                 |
| 7     | Pool busy                                             | connections concurrently busy ≥ `POOL_WARN_PCT`% (default 75) of `connection_limit` in **two consecutive runs**                                                                                                        |
| 8     | Invalid operations indexes                            | a non-building index is not valid/ready/live                                                                                                                                                                           |
| 9     | PostgreSQL in-place crash-restart                     | the postmaster logged `all server processes terminated; reinitializing` in the last 6 min — a backend crash plus WAL recovery inside the still-running container                                                       |

Check 2 runs outside the Docker gate on purpose: a host that just OOM-killed something
is exactly when `docker info` is least likely to answer.

Checks 0–5 detect the outage once containers or `/health` fail. Checks 6–8 inspect
the database through the app container and catch the precursor while the server
can still answer. This also works when `POSTGRES_SERVICE=` selects an external
database. A failed/malformed probe and a missing `connection_limit` are themselves
alertable problems, so the new checks cannot silently become inert.

Check 7 counts connections that are **busy** — `active`, or holding an open
transaction — not connections the pool has open. Prisma keeps its connections
open after use, so a healthy server sits near `connection_limit` in _occupancy_
essentially all the time while this check correctly reads low: on the hosted
server, 57 of 60 connections were open and `idle` while the probe reported 0.
That is why the alert says "busy" and not "saturated" — the number that moves is
concurrency, and it is the one worth paging on. It also means an `idle in
transaction` leak shows up here but **never** in check 6, whose age is measured
only for `active` sessions. The count is database-wide for the sync user — a
migrator, the monitor, or a second replica all add to it — while the limit is one
client's pool cap, so the percentage can legitimately exceed 100. The threshold is
deliberately a **ratio** against `connection_limit`, not a fixed number: measured steady state sits the same order
of magnitude below the pathological-query ceiling (pool size ÷ worst-case query
duration), so the absolute margin is thin and a fixed threshold would not survive
a pool resize.

Check 7 is also the only one that pages on **persistence**: the crossing must be
seen in two consecutive runs (~10 min). It samples an instantaneous gauge, and a
single crossing is routinely a stampede that self-heals within one interval —
the morning of 2026-08-27 produced three fail+recovery pairs that way
(hourly-aligned client sync at 04:00Z/06:00Z, the reconnect herd after a deploy
restart at 07:00Z). Sustained exhaustion still pages, one interval later. The
pending marker (`.health-alert/pool-busy-pending`) ages out after three
intervals, so a gap of three or more intervals cannot weld two unrelated spikes
into a "sustained" condition (a shorter blind gap — a probe failure between two
spikes — still can, costing one bounded false pair).

Check 8 matters more than it looks. An interrupted `CREATE INDEX CONCURRENTLY`
leaves an index that is **unusable for reads but still maintained on every
insert**. If `operations_entity_ids_gin` were the invalid one, the conflict
lookup would silently degrade to a sequential scan on every upload, permanently,
and nothing else in the codebase would report it.

Check 9 exists because PostgreSQL recovers from a backend crash **inside** the
running container: the postmaster terminates every connection, re-runs WAL
recovery, and is answering again within seconds. `RestartCount` stays 0, the
container never leaves `running`, and the compose healthcheck needs five
consecutive failed probes — so checks 0–3 are all structurally blind to it. The
hosted server crash-restarted 45 times over three months before the first one
was noticed ([#9695](https://github.com/super-productivity/super-productivity/issues/9695));
users see each one only as a failed sync. The check reads the postgres container
log directly (the app-container probe cannot: the crash kills its connection),
so it is skipped when `POSTGRES_SERVICE=` selects an external database — an
external database's availability still surfaces through checks 4 and 6–8.

The known migrator and the nightly backup (`backup.sh`, which tags its `pg_dump`
sessions `supersync-backup`) are excluded from the long-query check — a full dump
legitimately runs for hours, and an alert that fires on a timetable teaches you to
ignore the channel. Both still count toward check 7, so a dump that genuinely
starves the pool is still caught. Indexes currently
listed in `pg_stat_progress_create_index`, and invalid indexes carrying the
exact DDL lock held by an active migrator, are excluded from check 8. The latter
also covers `DROP INDEX CONCURRENTLY`, which has no progress-view entry, without
hiding unrelated invalid indexes. Each migration run has a unique database
application id; its finite database/client timeouts and targeted backend cleanup
bound interrupted DDL without generating incident/recovery noise.

### Alert damping

Repeat alerts for the same problem are suppressed by a content hash, so counts,
durations and the probe's exit status are normalised out — you get one mail per
distinct problem, plus a recovery mail when it clears.

On top of that, two rules bound how loud a single incident can get. They exist
because one incident is routinely reported as several different problems: a long
query saturates the pool, the health probe then times out behind it, and the
status it dies with alternates run to run (124 timeout, 143 SIGTERM, 128 exec
failure). Every one of those is a different hash, and a single-slot state file
re-mailed on every flip.

| Rule                                                               | Tunable                           |
| ------------------------------------------------------------------ | --------------------------------- |
| A problem already mailed in the current incident never mails again | —                                 |
| Recovery needs this many consecutive healthy runs                  | `RECOVERY_CLEAN_RUNS` (default 2) |

There is deliberately **no** minimum gap between alert mails: normalisation
already collapses every volatile field, so a hash that is genuinely new means a
symptom nobody has been told about yet, and a blanket rate cap would hold a
disk-95% or OOM alert for half an hour because an unrelated minor problem mailed
first. `RECOVERY_CLEAN_RUNS` falls back to its default on a bad value rather than
joining `CONFIG_PROBLEMS`: that string is the alert body _and_ the dedupe input,
so a typo there would keep `PROBLEMS` permanently non-empty and disable the
recovery mail — the same trap as the OOM marker.

State lives in `.health-alert/`: `state` (one hash per line: the problems already
mailed in this incident) and `clean-runs`.

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

### `deploy.sh` warns "OOM detection is BLIND"

The OOM check reads `journalctl -k`. A cron user outside `adm`/`systemd-journal`
— or any host without systemd — gets no output and **exit 0**, so before
2026-08-25 the check silently could never fire and the absence of an OOM alert
was not evidence of no OOM. It now probes readability first.

An unreadable kernel log is a broken capability, not an unhealthy service, so it
is recorded in `.health-alert/oom-check-blind` and surfaced by `deploy.sh`
alongside the `mail-failed` marker — deliberately **not** added to the alert
body. Putting it there would keep `PROBLEMS` permanently non-empty, and
`[ -n "$PROBLEMS" ]` gates the recovery branch, so `Health Check Recovered`
could never be sent again on a host that merely lacks a group. (Alerts
themselves would keep arriving: the dedupe key is a content hash, so a new
problem still changes the hash and still mails.)

Fix it rather than ignoring it: `sudo usermod -aG systemd-journal "$USER"`
(re-login required). Prefer `systemd-journal` over `adm` — it grants the journal
read and nothing else, where `adm` also opens `/var/log` broadly. Running the
cron as root works too but grants far more than this one read needs. The marker
clears itself on the next run once the log is readable.

If the group is already there and `journalctl -k` still prints nothing, the
host is a container (OpenVZ/Virtuozzo, LXC) that does not expose a kernel log
to guests at all — verified on the hosted server 2026-09-09, cron user in
`systemd-journal`, journal empty. No group fixes that; the marker is permanent
there and `docker inspect -f '{{.State.OOMKilled}}'` is the only OOM signal.

### "PostgreSQL canceled this query because it exceeded statement_timeout"

The reports no longer inherit the deployment's `statement_timeout`. `monitoring-db.ts`
appends its own to the connection string (`MONITOR_STATEMENT_TIMEOUT_MS`, default
300000ms) because the deployment's value is sized for user-facing sync requests,
where a slow query means someone is waiting — the wrong budget for a report.

This also means monitoring is capped on a stock instance, which sets **none**
(`statement_timeout` is an opt-in recovery guardrail in `env.example`, and
`docker-compose.yml` deliberately leaves it off). That retires the old failure
shape here — a slow report holding a pool connection until someone killed it, the
shape of the 2026-07-20 incident — at the cost that a stock-instance report which
used to grind on for 400s now gets cancelled. Raise the variable when that is the
one you want.

The app's own sessions are still uncapped on a stock instance. To end one, find it
with `SELECT pid, query_start, left(query, 80) FROM pg_stat_activity WHERE state = 'active'`
and stop it with `SELECT pg_cancel_backend(<pid>)`. Monitoring sessions identify
themselves as `application_name = 'supersync-monitor'`, which is also how
`health-alert.sh` knows not to page about a long-running report.

- **Check the `payload_bytes` backfill first.** Rows still at 0 make every size
  expression read the payload itself, an out-of-line TOAST fetch per row and by
  far the largest per-row cost in these reports — measured at 6.5x the blocks and
  10.7x the time of the backfilled path. `SELECT EXISTS (SELECT 1 FROM operations
WHERE payload_bytes = 0)` answers it through a partial index in one probe.
  `npm run migrate-payload-bytes` fixes it; it is safe to run online (batched,
  primary-key updates, no table lock) but it is a long backfill, not a quick fix.
- **Raise `MONITOR_STATEMENT_TIMEOUT_MS` before shrinking the sample.** These
  scripts do not inherit the operator's request-path timeout: `monitoring-db.ts`
  appends its own (default 300000ms) to the connection string, because a budget
  sized so a user is not left waiting on a sync is the wrong budget for a
  fleet-wide report. If a report cancels anyway, the honest question is whether
  it needs longer or is genuinely pathological — raise this first, and only then
  cut the sample, so you find out which.
- Lower `MONITOR_SCOPE_USERS`; it is what bounds these reports' cost
  (`MONITOR_SCOPE_USERS=25 npm run monitor:all`).
- Scope to one account with `--user <id>` — supported by `operation-sizes`,
  `operation-types`, `operation-timeline` and `monitor -- ops`. `large-ops` and
  `rapid-fire` are fleet-wide only.
- If a report is still slow at a small `MONITOR_SCOPE_USERS`, the database itself
  is under load — check `monitor -- stats` and the long-query alert in
  `health-alert.sh`.

## Development

To add new analysis commands:

1. Add function to `scripts/analyze-storage.ts`
2. Add case to `main()` switch
3. Update `getMonitoringCommands()` in `run-all-monitoring.ts` if it should run in full suite
4. Document here
5. **If it reads `operations`,** drive it from `resolveOperationScope()` in
   `scripts/monitoring-scope.ts` and add it to `ALL_USER_OPERATION_REPORTS` in
   `tests/monitoring-scripts.spec.ts`. That test is what keeps the bound below
   from silently regressing; a new report not listed there is unchecked.

## Performance Notes

Wall-clock timings depend on the instance and have not been re-measured since the
bounding rewrite; treat the structure below as the contract, not the durations.

### How the operations reports stay bounded

`ops`, `operation-sizes`, `operation-types`, `large-ops`, `rapid-fire` and
`operation-timeline` are the reports that read `operations`, by far the largest
table. They all share one driver (`resolveOperationScope()` in
`scripts/monitoring-scope.ts`): the `MONITOR_SCOPE_USERS` most recently active
users by device heartbeat, and for each of them a tail of the newest operations
read backwards through the `(user_id, server_seq)` index.

**Work against `operations` is therefore `users x tail` and does not grow with
the table.** Measured on an 8,610-account / 1.1M-operation fixture: 200 index
descents, ~1,500 blocks, flat when the operations table shrank 10x. `monitor ops`
in particular went from 68,919 blocks and a 430-block temp spill to 1,720 blocks.

The _driver_ is a different matter and is deliberately not claimed to be
constant: `sync_devices` has no index on `last_seen_at`, so selecting the top N
is a sequential scan plus a top-N sort, linear in device count. It is small (72
blocks / 15ms at 8,610 accounts, measured) and it never touches `operations`, but
it is the next term that will bind — at 861,000 devices it is 10,476 blocks and
1.1s. An index on `sync_devices (last_seen_at)` is the fix if it ever matters.

That bound is the whole point, so keep it when editing these queries:

- Never drive a per-user tail from `users`, `user_sync_state`, or an uncapped
  `sync_devices` scan. Those grow with every signup, including accounts that
  stopped syncing years ago.
- Resolve the scope **once per report** and reuse the user list across its
  statements. Live heartbeats reorder `sync_devices` continuously, so re-running
  the driver per statement lets one report's tables describe different
  populations — `operation-types` has three tables, `operation-sizes` two.
- Never sample the table itself (`TABLESAMPLE SYSTEM (1)` and friends). One
  percent of a table that keeps growing is not a bound.
- Compute the size expression **at the scan**, never over a CTE that projects
  `payload` forward. The extra materialisation pass copies every inline-stored
  payload and spills it to temp files (measured 46ms/559 temp blocks vs
  17ms/none on 20k 12KB rows).
- Keep `received_at` windows outside the per-user tail. Inside it, the LIMIT no
  longer bounds anything: Postgres walks the user's whole history looking for
  matches.

These reports are samples of recent activity, not full-history statistics — the
printed header says exactly which population each one measured and how many users
matched. `operation-sizes`, `operation-types`, `operation-timeline` and
`monitor -- ops` accept `--user <id>` to read one account's index tail directly
instead of sampling the fleet; `large-ops` and `rapid-fire` do not.

One capability was genuinely lost: `large-ops` used to sample 1% of _all_ history
and so could surface an old outlier. It now reports the largest of the newest
operations of currently-active users, which answers "is something blowing up
right now" but not "what is the biggest row ever written". Answering the latter
exactly would need an index on `payload_bytes` — a permanent write cost on the
upload hot path for a monitoring convenience — so it is deliberately not done.

## Security Notes

- Exports contain full operation payloads - handle securely
- User emails are included in outputs - be mindful of privacy
- Encrypted payloads show as encrypted in analysis
- Clean up old reports periodically

---

**Questions or issues?** File an issue or check the main SuperSync documentation.

# Production Capacity and the OpenVZ Constraint

**Status:** current. **Numbers last verified:** 2026-08-28; crash-restart figures
2026-09-03. Every figure below is
a point-in-time measurement — re-measure before relying on any of them.

## Scope

This documents the **measured limits of the hosted SuperSync deployment** and the
design decisions those limits have already forced, so that neither has to be
rediscovered from commit messages and closed issues.

Host names, unix accounts, filesystem paths, and the backup/reboot schedule are
deliberately **not** here — they live in the operator's private runbook, which is
also where the 2026-08-25 outage remediation plan went when it was removed from
this repository. What follows is the part that is safe to keep in the open and
that contributors need in order to read the code correctly.

## The constraint

| Property                       | Value                                      | Source                         |
| ------------------------------ | ------------------------------------------ | ------------------------------ |
| Virtualization                 | OpenVZ / Virtuozzo container               | `systemd-detect-virt` → openvz |
| Disk throughput limit          | 50 MB/s                                    | Hoster, 2026-08-28             |
| Disk IOPS limit                | **150**                                    | Hoster, 2026-08-28             |
| Underlying media               | SSD                                        | Hoster, 2026-08-28             |
| Host RAM                       | 4 GB                                       | Measured 2026-08-25            |
| Postgres container `mem_limit` | 1,536 MB                                   | `docker-compose.yml`           |
| Cold random read latency       | **~9.5 ms per 8 KB block**                 | Measured 2026-08               |
| Sequential throughput          | ~22 MB/s (fine — the cap is on random I/O) | Measured 2026-08-25            |

The IOPS limit is **tariff-bound, not a fault**. The hoster confirmed on
2026-08-28 that the measured values match the configured limits, that the node is
SSD-backed, and — importantly — that **migrating the container to another node
leaves the limits unchanged**. There is no support ticket that fixes this.

### Why 150 IOPS is the binding constraint

150 IOPS × 8 KB = **1.2 MB/s of random reads**. Sequential access merges and is
unaffected, so the ceiling only bites where the workload seeks:

- The `operations` heap was 6,770 MB / 860,996 pages at 8.6M live rows (2026-08).
- A **random** page walk over all of it costs ~860,996 ÷ 150 ≈ **96 minutes**.
  Note this figure applies _only_ to seek-bound access. A sequential pass over
  the same heap plus its 1,911 MB TOAST relation is ~6.6 minutes at the measured
  ~22 MB/s, so never quote the 96 minutes for anything that scans in order — the
  nightly `pg_dump`'s runtime is **not** explained by it, and the likeliest
  cause there is per-row TOAST detoast fetches, which are random.
- Under cgroup v2 the page cache is charged to the container, so Postgres reaches
  at most `mem_limit` of `shared_buffers` + file cache: roughly **1.1 GB of
  cache**, no matter how much RAM the host has. That is ~16% of the 6.77 GB heap
  alone, but the same cache also has to hold ~3 GB of indexes and the 1.9 GB
  TOAST relation, so the real resident fraction of the working set is nearer
  **9–12%**.

The consequence is that anything touching the ~90% that is not resident pays
~9.5 ms per block. One measured example: the retention cleanup's fleet-wide
aggregate ran in **80,612 ms cold vs 155 ms warm** on identical block counts — a
520× difference that is entirely page cache versus disk.

## What this has already cost

Three independent costs trace back to the same hosting choice.

**1. No encryption at rest.** Both project-managed LUKS and PostgreSQL TDE were
implemented and then retired as incompatible with the OpenVZ environment. See
[`../archive/encryption-attempts-openvz-incompatible/`](../archive/encryption-attempts-openvz-incompatible/)
and [`encryption-at-rest.md`](encryption-at-rest.md).

**2. Database crash-restarts (fixed in #9917, platform-amplified).**
For months a "server process" exited with code 2 roughly every two weeks, later
hours apart (50 occurrences, #9695). This was long read as the `quickdie` /
`SIGQUIT` path and therefore as unattributable from inside an OpenVZ guest. It was
neither: the dying PID was the compose healthcheck's `pg_isready`, orphaned when
dockerd killed a timed-out probe shell, adopted by the postmaster running as PID 1,
and exiting 2 ("no response"). The postmaster treats any reaped status other than
0/1 as a backend crash. Fixed with `init: true` on the postgres service (see the
comment in `docker-compose.yml`); closure is tracked on #9695. What the platform
contributes is the trigger: the 25–52 s I/O stalls that time the probe out come
from the 150-IOPS budget described here.

**3. A permanent tax on query design.** Every mitigation in the next section
exists only because random reads cost ~9.5 ms here. That is recurring
engineering time, spent on work that a faster disk would make unnecessary.

## What has been built around it

These are responses to the constraint above, not general-purpose optimizations.
Each one's reasoning lives at its own call site — **pointers, not summaries**, so
this list cannot drift out of sync with the code it describes:

| Mitigation                                                                                           | Where the reasoning lives                                            |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Windowed retention deletes (stated two-sided `server_seq` range, not a discovered `take`)            | `storage-quota.service.ts`, #9692, #9763                             |
| Covering `(user_id, received_at, server_seq)` index for the fresh-prefix probe                       | migration `20260828000001`                                           |
| Causal partial index so the fleet-wide boundary scan runs index-only (additive; the broad one stays) | migration `20260829000000`                                           |
| Autovacuum **insert** scale factor at 0.02 (and why the other two are deliberately excluded)         | migration `20260828000003`                                           |
| `POSTGRES_MEM_LIMIT` / `POSTGRES_EFFECTIVE_CACHE_SIZE` kept opt-in                                   | `docker-compose.yml`, `env.example`                                  |
| Opt-in 60s `statement_timeout` — **off by default**, and only the `DATABASE_URL` form works          | `env.example`, `docker-compose.yml`                                  |
| Query-plan integration specs against real PostgreSQL                                                 | `tests/integration/old-ops-*-plan.integration.spec.ts`, #9191, #9192 |

### Operating the autovacuum tuning

`20260828000003` is checksum-frozen once applied, so its evolving guidance lives
here instead:

- **Before deploying it**, check `age(relfrozenxid)` on `operations` and its
  TOAST relation. An ordinary autovacuum yields to the `ALTER` after
  `deadlock_timeout`; an anti-wraparound one does not, and colliding with one
  _can_ fail the deploy with `57014`. `migrate-deploy.sh` does not auto-recover
  that shape — clear it with `prisma migrate resolve --rolled-back` and re-run.
- **The "~5× or ~0.5× vacuum I/O" question is answered, and it is why only the
  insert factor ships.** Measured with `VACUUM (VERBOSE)` on PostgreSQL 16
  against this schema: an insert-triggered pass reports `index scans: 0` and
  "index scan not needed", touching 16.9% of heap pages — the index pass is
  skipped outright, not merely LP_DEAD-bypassed. A pass following a `DELETE`
  reports `index scans: 1` and walks all 8 indexes (~3 GB). The amplification
  belongs to the **dead-tuple** factor, which is therefore left at its default;
  on a growing append-only table it is a no-op anyway, since the insert trigger
  always fires first. Re-measure if the table stops growing.
- **Do not justify it with the fresh-prefix probe.** That query is immune to
  visibility-map decay: `server_seq` is the covering index's third column, so it
  becomes an Index Cond and btree discards non-matching rows before the
  visibility check ever runs. Measured on PostgreSQL 16 against this schema —
  2,000 unvacuumed rows, a 38-page map deficit, `Heap Fetches: 0`. The cost
  lands on index-only scans that **emit** rows over the same window: the same
  fixture measured ~2,014 heap fetches, 0 after a VACUUM. Both are pinned in
  `tests/integration/old-ops-probe-plan.integration.spec.ts`. When that was
  written no production query was both index-only-capable and emitted volume, so
  the benefit was bounded map sag and freeze debt. Migration `20260829000000`
  changed that: the fleet-wide boundary scan is now index-only and emits ~3,162
  rows, so map coverage became a query cost — see below.
- **Revisit against the monitoring report.** `npm run monitor stats` prints an
  `operations: visibility map & autovacuum` section — map coverage,
  `n_ins_since_vacuum`, `n_mod_since_analyze`, autovacuum cadence, the live
  `reloptions`, and `age(relfrozenxid)` — and warns below 90% coverage.
  `n_dead_tup` is shown but is not evidence on its own; it oscillates.
- **During a retention backlog dig-out** (raising
  `OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN`, see `MONITORING-README.md`) deletes
  start triggering vacuums, so passes begin walking all 8 indexes. Whether that
  gets _worse_ per pass depends on which outruns which: a higher delete budget
  raises dead tuples per pass, a shorter interval lowers them. Do not assume;
  watch `n_dead_tup` and the autovacuum cadence in the monitoring report.

### Operating the causal boundary index

`20260829000000` is checksum-frozen once applied, so its evolving guidance lives
here instead:

- **Set `MIGRATION_TIMEOUT` explicitly for the deploy that applies it.** The
  default is 900s (`deploy.sh`), and this is the first `CREATE INDEX
CONCURRENTLY` on `operations` at ~7 GB. What can exceed the budget is not the
  build — only ~3,162 rows match the predicate, and the two heap passes are
  sequential — but the two phases where `CONCURRENTLY` **waits for every
  transaction older than its snapshot to finish**. That wait is unbounded and has
  nothing to do with disk speed. Check `pg_stat_activity` for long-running
  transactions first; the sweep and snapshot generation are the usual holders.
- **Do not size the build from autovacuum's observed rate.** A vacuum on this
  host was measured at ~163 pages/s (2026-08-29), which would imply hours for two
  passes over ~861k pages. That rate is `autovacuum_vacuum_cost_delay`
  throttling, not the disk; `CREATE INDEX CONCURRENTLY` has no such throttle and
  reads sequentially. Measured on PostgreSQL 16.15 against this schema
  (2026-08-29): the build took 24 ms over 1,101 pages and 401 ms over 27,524 —
  linear in pages, so ~13 s at production's ~861k on that hardware. Even an order
  of magnitude slower leaves it far inside a 1800 s budget. **The build is not
  the risk. The wait is.**
- **The win does not decay as the table grows.** Same measurements: a 25x larger
  table (60k -> 1.5M rows, 1,101 -> 27,524 pages) moved the scan from 12 to 242
  blocks — tracking the _causal_ row count, which grew 25x too, at a flat
  ~0.003 blocks per causal row. Production's causal ratio is ~165x _lower_ than
  that fixture's (~3,162 causal rows in 9.1M), so its scan should land nearer the
  12 than the 242. Cost belongs to full-state ops, not to the table.
- **A timed-out build is recoverable, not wedged.** The migration is in
  `migrate-deploy.sh`'s recoverable-`CONCURRENTLY` list, so a leftover INVALID
  index is dropped and rebuilt on the next attempt. `deploy.sh` exits 124 and
  says so. This is the shape #9783/#9787 exist to handle — verify the recovery
  actually ran rather than assuming it.
- **The win depends on the visibility map, so it depends on the autovacuum
  tuning above.** The boundary scan is index-only and emits rows, so map decay
  costs it one heap fetch per emitted tuple on a non-all-visible page. That cost
  is proportional to **recent** full-state ops (a handful a day), not to the
  table, because the index is partial — pinned as a test against an unvacuumed
  tail in `tests/integration/old-ops-boundary-plan.integration.spec.ts`. If
  `npm run monitor stats` warns on map coverage, this statement is one of the
  things paying for it.
- **After applying it, re-measure.** `EXPLAIN (ANALYZE, BUFFERS)` on the sweep's
  boundary `groupBy` read 3,930 heap blocks in 33.7s before (2026-08-29, on a run
  that did not hit the 60s cap; an earlier one did). Everything above is measured
  on a 60k-row fixture; that one production number is what converts it.

## The open decision

Whether to move the deployment off this platform is tracked in **#9780**, along
with the arguments either way and the outstanding question to the hoster. It is
deliberately not restated here: it is an unresolved operator decision, not
contributor documentation, and a second copy would go stale the moment the
hoster replies.

## Guidance for contributors

- Assume **random reads are expensive and sequential reads are not.** A plan that
  looks acceptable on a laptop NVMe can be an outage here.
- Prefer index-only scans, and treat anything that depends on the visibility map
  as depending on autovacuum actually running.
- Do not size a query by rows returned; size it by **blocks touched**, and prefer
  stated ranges over discovered limits.
- Numbers in this file are dated. Re-measure before relying on them, and see
  `scripts/MONITORING-README.md` for the tooling.

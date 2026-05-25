# Generic CONCURRENTLY migration recovery — design

Date: 2026-05-15
Status: validated, ready for implementation

## Problem

A production deploy failed applying `20260514000000_add_encrypted_ops_partial_index`:

```
Database error code: 25001
ERROR: DROP INDEX CONCURRENTLY cannot run inside a transaction block
ERROR: prisma migrate deploy failed (exit 1).
```

Prisma 5.22 wraps every migration in a transaction; PostgreSQL forbids
`CREATE/DROP INDEX CONCURRENTLY` inside a transaction block (P3018 / SQLSTATE
25001). The codebase already knows this and has an out-of-band recovery path —
but it failed to engage.

### Root cause

The recovery logic was **duplicated and name-hardcoded** in two places:

- host `scripts/deploy.sh` — a ~310-line ladder of `is_*_transaction_block_failure`
  / `apply_*_outside_prisma` / `resolve_*` functions hardcoding three migration
  names.
- in-image `scripts/migrate-deploy.sh` — a second copy with the same three
  hardcoded names.

`deploy.sh` runs **on the host** and self-updates only via a best-effort
`git pull --ff-only || echo "WARNING: … continuing with current files"`. The
production host's `deploy.sh` predated PR #7621, so it knew only about
`20260512000000`. It pulled the new image (which *does* contain the new
CONCURRENTLY migration), ran `prisma migrate deploy`, hit P3018 on
`20260514000000`, matched none of its hardcoded recovery branches, and bailed.

The real defect is **host/image version skew plus name hardcoding**: every new
CONCURRENTLY migration requires editing host-side recovery logic in lockstep,
and a stale host script silently degrades.

## Goals

1. Eliminate host/image skew: recovery logic ships *inside the image*,
   version-locked to `prisma/migrations/` in the same build.
2. Name-agnostic: no migration names hardcoded anywhere. New CONCURRENTLY
   migrations need zero changes to deploy tooling.
3. Tight safety gate: never force-mark a genuinely broken migration as applied.
4. De-duplicate: one recovery implementation, three call sites.

## Architecture

`scripts/migrate-deploy.sh` becomes the single source of truth (reuse the
existing filename — already `COPY`'d into the image by the `Dockerfile`,
already the startup `CMD` target; Dockerfile unchanged).

| Caller | Before | After |
| --- | --- | --- |
| Host `deploy.sh` | `npx prisma migrate deploy` + ~310 lines of hardcoded host-side recovery | `timeout "$MIGRATION_TIMEOUT" $MIGRATOR_RUN sh -ec 'sh scripts/migrate-deploy.sh'` + exit-code handling only |
| Image startup (`RUN_MIGRATIONS_ON_STARTUP=true`) | own hardcoded copy | the new generic script (wiring unchanged) |
| Manual ops | run the deploy.sh dance by hand | `docker compose run --rm supersync sh scripts/migrate-deploy.sh` |

Because `scripts/` and `prisma/migrations/` are copied into the image in the
same `Dockerfile` build, the recovery logic can never be stale relative to the
migrations it must handle. A stale host `deploy.sh` only needs to know how to
*invoke* the in-image script; the recovery *content* always comes from the
freshly pulled image.

Removed: the entire `deploy.sh` block from `MIGRATE_LOG=""` (~line 176) through
the if-ladder (~line 486), and all hardcoded logic in the old
`migrate-deploy.sh`. Net: ~440 hardcoded lines deleted, ~120 generic lines
added.

## Recovery algorithm (in `migrate-deploy.sh`)

Bounded loop (max 8 attempts — covers several sequential CONCURRENTLY
migrations in one deploy):

```
attempt = 0
loop:
  log = $(npx prisma migrate deploy 2>&1); status = $?
  echo "$log"
  status == 0 -> exit 0
  attempt++ ; attempt > MAX -> fail loudly, exit status

  name = parse_failing_migration(log)
  name empty -> fail loudly + manual cmds, exit status

  is_txn_block = log has 'P3018' AND 'cannot run inside a transaction block'
  is_stuck     = log has 'P3009'                       # prior failed migration
  not (is_txn_block OR is_stuck) -> fail loudly, exit status

  sql = prisma/migrations/<name>/migration.sql
  sql missing OR not grep -qi 'INDEX[[:space:]]\+CONCURRENTLY' sql
      -> fail loudly, exit status                      # CONCURRENTLY guard

  name == last_recovered_name -> abort (re-failed), exit 1   # no infinite loop

  recover(name); last_recovered_name = name
  continue
```

`parse_failing_migration` matches Prisma's own output, in priority order:
`Migration name: <name>` (P3018 block), else the backticked name in
`Applying migration \`<name>\``, else the backticked name in the P3009 sentence
(`The \`<name>\` migration started at … failed`). All three strings appear
verbatim in the observed production log.

`recover(name)`:

1. `npx prisma migrate resolve --rolled-back <name>` — tolerate non-zero with a
   warning (`"not in a failed state; continuing"`), matching today's behavior.
2. Split `migration.sql` into statements; run **each** via
   `printf '%s\n' "$stmt" | npx prisma db execute --schema prisma/schema.prisma --stdin`.
3. If **any** statement fails: STOP, do **not** `resolve --applied`, print the
   exact remaining manual commands, exit non-zero.
4. Only if **every** statement succeeded: `npx prisma migrate resolve --applied
   <name>`.

`--applied` is therefore never "force" — it is asserted only after the
migration's own SQL verifiably ran. Genuine bugs, non-CONCURRENTLY migrations,
and unexpected errors all fall through to loud failure with a manual escape
hatch.

## Statement splitter

`prisma db execute --file` would re-trigger the implicit-transaction bug for
multi-statement files (Postgres treats a multi-statement simple query as one
transaction), so statements are split and executed one per `--stdin` call. An
`awk` pass:

- drops full-line comments (`^[[:space:]]*--`),
- accumulates lines, emits a statement when a line ends with `;`,
- trims whitespace; skips empty statements.

### Constraint (documented in the script header + migrations docs)

Out-of-band recovery supports CONCURRENTLY **index** migrations only. Statements
must not embed `;` inside string literals; comments must be full-line `--`. All
four existing CONCURRENTLY migrations satisfy this. Acceptable because the
CONCURRENTLY guard already restricts the blast radius to index migrations.

### Authoring rule (documented requirement)

A CONCURRENTLY migration MUST be written as:

```sql
DROP INDEX CONCURRENTLY IF EXISTS "x";
CREATE INDEX CONCURRENTLY "x" ON ...;
```

`DROP … IF EXISTS` first makes re-runs idempotent and clears a leftover INVALID
index from an interrupted concurrent build. This promotes an already-implicit
pattern (stated in the existing migrations' own comments) to a stated rule.

## Host `deploy.sh` (unchanged concerns)

Keeps: Caddy validation, `git pull`, image pull/build, Postgres compose-up,
`DATABASE_URL` host rewrite, DB connectivity check, the `timeout` wrapper (a
hung concurrent build still fails the deploy with exit 124, loudly),
`RUN_MIGRATIONS_ON_STARTUP=false` for the compose update, container start,
health checks. Only the migration block collapses to a single timed
invocation of the in-image script.

## Failure / escape hatch

On any bail (genuine bug, guard miss, statement failure, re-failure) the script
prints the precise manual sequence — `migrate resolve --rolled-back <name>`,
the per-statement `db execute` lines from that migration's SQL, `migrate
resolve --applied <name>` — so an operator always has a copy-pasteable
recovery.

## Testing

1. **Fast, no DB** — shell fixture tests for `parse_failing_migration` and the
   SQL splitter against: a sample Prisma P3018 log, a sample P3009 log, and the
   four real `migration.sql` files. Locks the two fiddly text routines.
2. **Integration (docker Postgres)** — using the existing SuperSync compose
   harness:
   - positive: a synthetic CONCURRENTLY index migration → script recovers from
     the in-transaction failure, `_prisma_migrations` row is `applied`, the
     index exists.
   - stuck-state: pre-seed a failed (`P3009`) CONCURRENTLY row (the live
     incident shape) → script recovers.
   - negative: a deliberately broken **non-CONCURRENTLY** migration → script
     does **not** mark it applied and exits non-zero.

## Out of scope

- Changing Prisma's transaction behavior or upgrading Prisma.
- Generalizing beyond index CONCURRENTLY migrations (guard intentionally
  narrow).
- Host `deploy.sh` self-update mechanism (best-effort `git pull` stays; this
  design makes its staleness irrelevant to migration correctness).

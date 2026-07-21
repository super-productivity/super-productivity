# Migration authoring rules

Prisma 5.x wraps every migration in a transaction. PostgreSQL forbids
`CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY` inside a transaction
block, so a CONCURRENTLY migration always fails the normal
`prisma migrate deploy` path (P3018 / SQLSTATE 25001).

`scripts/migrate-deploy.sh` recovers from this generically: on that specific
failure it reads the failing migration's name from Prisma's output, runs _that
migration's own `migration.sql`_ out-of-band (no transaction,
statement-by-statement), marks it applied, and retries. It has a second recovery
for the lock-bounded `ALTER INDEX` shape described below. **It hardcodes no
migration name, index name, or SQL text** — a migration opts into a recovery
path by its _shape_ alone. Naming nothing has been the design goal since this
logic moved in-image: the _host_ copy went stale against the migrations it knew
about and broke a deploy. This copy is version-locked to `prisma/migrations` by
the image build, so a name here would not go stale the same way, but it is still
a silent coupling. Recovery is exercised by
`tests/migrate-deploy-script.spec.ts` (behavioral, end-to-end) and
`tests/migration-sql.spec.ts` (the migration SQL shapes the recovery relies on,
and the no-hardcoded-names invariant itself).

## Prefer migrations that don't need recovery

Recovery is a safety net, not the happy path. Prefer, in order:

1. **No CONCURRENTLY** if the table is small enough that a brief lock is fine.
2. **A single CONCURRENTLY statement per migration file.** Prisma issues a
   single-statement migration as one query, which Postgres does _not_ wrap in
   an implicit transaction, so `prisma migrate deploy` applies it natively with
   no recovery needed. (Do not retro-split already-applied migrations — see
   "Never edit an applied migration" below.)

Out-of-band recovery cost scales with the number of consecutive pending
CONCURRENTLY migrations and the number of statements in each (one Prisma
process per statement), so a large backlog deploy is intentionally slower.

## Rules for a lock-bounded `ALTER INDEX` migration

DDL that needs an `ACCESS EXCLUSIVE` lock on a hot object must bound its own
lock wait. `20260720000000_disable_operation_entity_ids_gin_fastupdate` is the
worked example:

```sql
SET LOCAL lock_timeout = '1s';
ALTER INDEX "operations_entity_ids_gin" SET (fastupdate = off);
```

**Never raise the timeout to make such a migration succeed.** A waiting
`ACCESS EXCLUSIVE` request queues every _new_ query on the table behind it —
measured, a trivial reader went from 79 ms to 8005 ms while one waited. That is
the shape of a prior outage. The fix for losing the race is many short attempts,
never one long wait.

Note the lock is contended more easily than it looks: the planner takes
`AccessShareLock` on **every** index of a table for any query that plans against
it, held to end of transaction — so a single slow query touching the table
starves the window, even one that uses no index at all.

A migration is retried natively **only if** it has exactly two statements — a
`SET LOCAL lock_timeout` of at most a few seconds, then a single
`ALTER INDEX ... SET (...)`. Four properties are what make retrying safe:

1. **A short bound**: at most 5 seconds (`1ms`-`5000ms` or `1s`-`5s`). Anything longer is refused,
   and so is `'0'` — which in PostgreSQL means _no_ timeout, i.e. wait forever.
   Retrying an unbounded wait is the outage this whole section exists to avoid.
2. **Exactly two statements**, so Postgres wraps them in an implicit
   transaction and a lock timeout rolls the migration back with nothing
   partially applied.
3. **`ALTER INDEX ... SET (reloption)`**, which is idempotent on re-run.
4. **No `CONCURRENTLY`.** A _single_-statement migration gets no implicit
   transaction, so a lock timeout mid-build leaves an `INVALID` index that a
   retry cannot clear. Those stay fail-loud (see the bare-CREATE section below).

Note rule 2 is not enough on its own: the splitter breaks on `;` at _end of
line_, so a second statement sharing the `ALTER`'s line would still end in `);`.
What actually excludes that is the `ALTER` pattern being fully anchored with a
**paren-free** option list — the `ALTER`'s own `)` always lands inside the span,
so nothing can follow it.

Spacing and keyword case are not load-bearing — the gate matches with
`grep -Ei`, like the CONCURRENTLY gates.

`SET LOCAL` and the `ALTER` must stay in the same Prisma transaction, so such a
migration must never be split or executed out-of-band.

A lock timeout leaves a failed Prisma migration record; a later deploy then sees
only Prisma's cause-free `P3009`. The deploy script handles either state by
marking the failed attempt rolled back and retrying through
`prisma migrate deploy`, up to 10 attempts (one retry is not
enough — production lost a whole deploy to exactly that in July 2026). After the
last attempt the migration is left **rolled back**, so re-running the deploy is
always safe. Any different Prisma error fails loudly without being
auto-resolved, and the script never marks such a migration applied itself.

The following migration calls `gin_clean_pending_list` in a separate
transaction, capped by a five-minute `statement_timeout`. Keep it separate so
the index lock from the reloption change is released before cleanup starts. If
cleanup times out, inspect database load, mark only that cleanup migration
rolled back, and re-run the deploy; the cleanup call is safe to repeat.

## Rules for a recoverable CONCURRENTLY index migration

A migration is **auto-recovered only if** its SQL contains BOTH a
`DROP INDEX CONCURRENTLY` and a `CREATE INDEX CONCURRENTLY` (the idempotent
drop-then-create shape). Anything else falls through to a loud failure with
copy-pasteable manual steps and is **never** auto-marked-applied.

1. **Drop-then-create, idempotent.** A re-run after a partial/interrupted
   concurrent build (which leaves an `INVALID` index) must succeed:

   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS "my_idx";
   CREATE INDEX CONCURRENTLY "my_idx" ON "operations"(...) WHERE ...;
   ```

   Do **not** use `CREATE INDEX CONCURRENTLY IF NOT EXISTS` instead — a leftover
   `INVALID` index has the right name but is unusable, so `IF NOT EXISTS` would
   skip rebuilding it.

2. **One statement per logical block, terminated by `;` at end of line.** The
   out-of-band splitter ends a statement when a line ends with `;`. Multi-line
   statements are fine (collapsed to one line before execution — safe for index
   DDL).

3. **Full-line `--` comments only.** Trailing/inline comments after SQL on the
   same line are not stripped.

4. **No `;` inside string literals.** The splitter treats any end-of-line `;`
   as a statement terminator. (True for all index DDL; the `WHERE op_type IN
('A', 'B')` form is fine — no semicolons.)

5. **No `BEGIN` / `COMMIT` / `DROP TABLE`.**

## Intentional exception: bare `CREATE INDEX CONCURRENTLY`

`20260511000000_add_entity_sequence_index` is a deliberately bare
`CREATE INDEX CONCURRENTLY` with **no** `DROP`. Its own comment is explicit: an
interrupted build leaving an `INVALID` index "should fail loudly instead of
being marked as an applied migration." The recovery guard requires the
drop-then-create shape precisely so this (and any future bare-CREATE) is **not**
auto-recovered — it fails loudly by gate, deterministically, which is the
intended behavior. This is enforced by `tests/migration-sql.spec.ts` (the
migration has no `DROP`) and `tests/migrate-deploy-script.spec.ts` (a bare
CREATE is refused, never marked applied).

**Bare vs drop-then-create for a _new_ index.** Reserve the bare fail-loud
shape for a _correctness-critical_ index, where an interrupted build should
halt the deploy for a human rather than silently retry. For a
_performance-only_ index that has a correct fallback path — e.g.
`operations_entity_ids_gin`, whose conflict lookups fall back to the scalar
`entity_id` — prefer the auto-recoverable drop-then-create shape so an
interrupted build self-heals on the next deploy instead of wedging it and
requiring manual recovery. Do **not** retro-convert an already-applied bare
CREATE — see below.

## Never edit an applied migration

Not because `migrate deploy` catches it. **It does not**: verified against
PostgreSQL 16 with Prisma 5.22.0, `migrate deploy` never re-reads an applied
migration's file, reports "No pending migrations to apply." and exits 0 even
when that file was replaced with `DROP TABLE`. `migrate status` is silent too;
only `migrate dev` notices, by replaying against a shadow database.

Edit one anyway and: every install that already applied it **never executes the
new SQL**, so a fix retrofitted there reaches nobody who already ran it; the
recorded `checksum` permanently disagrees with the file; and contributors
running `migrate dev` hit a shadow-database replay of the new content. Ship a
new migration instead.

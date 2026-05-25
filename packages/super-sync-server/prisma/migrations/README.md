# Migration authoring rules

Prisma 5.x wraps every migration in a transaction. PostgreSQL forbids
`CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY` inside a transaction
block, so a CONCURRENTLY migration always fails the normal
`prisma migrate deploy` path (P3018 / SQLSTATE 25001).

`scripts/migrate-deploy.sh` recovers from this generically: on that specific
failure it reads the failing migration's name from Prisma's output, runs *that
migration's own `migration.sql`* out-of-band (no transaction,
statement-by-statement), marks it applied, and retries. It hardcodes no
migration names. Recovery is exercised by `tests/migrate-deploy-script.spec.ts`
(behavioral, end-to-end) and `tests/migration-sql.spec.ts` (the migration SQL
shapes the recovery relies on).

## Prefer migrations that don't need recovery

Recovery is a safety net, not the happy path. Prefer, in order:

1. **No CONCURRENTLY** if the table is small enough that a brief lock is fine.
2. **A single CONCURRENTLY statement per migration file.** Prisma issues a
   single-statement migration as one query, which Postgres does *not* wrap in
   an implicit transaction, so `prisma migrate deploy` applies it natively with
   no recovery needed. (Do not retro-split already-applied migrations — that
   changes their checksum and breaks `migrate deploy`.)

Out-of-band recovery cost scales with the number of consecutive pending
CONCURRENTLY migrations and the number of statements in each (one Prisma
process per statement), so a large backlog deploy is intentionally slower.

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

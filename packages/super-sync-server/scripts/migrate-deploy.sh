#!/bin/sh
set -eu

# Generic, name-agnostic Prisma migration deploy + recovery.
#
# Prisma 5.x wraps every migration in a transaction. PostgreSQL forbids
# CREATE/DROP INDEX CONCURRENTLY inside a transaction block, so such a
# migration fails with P3018 / SQLSTATE 25001 ("cannot run inside a
# transaction block"), and a later deploy then refuses with P3009 (the
# migration is stuck in a failed state).
#
# This script has two deliberately narrow recovery paths:
#
# 1. For the transaction-block failure above, it runs a migration with the safe
#    DROP+CREATE CONCURRENTLY shape out-of-band, marks it applied, and retries.
# 2. For the exact two-statement SET LOCAL lock_timeout + ALTER INDEX
#    fastupdate=off shape, it rolls back Prisma's failed record and retries once
#    through Prisma. It never splits or marks that transactional migration
#    applied itself.
#
# Both paths discover the failing migration from Prisma's output and inspect
# prisma/migrations/<name>/migration.sql. Anything matching neither guarded
# recovery path fails loudly.
#
# A P1002 advisory-lock timeout (another session holds Prisma's migration lock,
# usually a migrator container orphaned by a prior interrupted deploy) is NOT a
# migration failure: it is detected separately and printed with cleanup steps,
# never auto-resolved.
#
# This script is COPYed into the image next to prisma/migrations in the same
# build, so it is always version-locked to the migrations it must handle. All
# three call sites (host deploy.sh, image startup CMD, helm initContainer)
# invoke it, so it carries its own step timeout as defense-in-depth (deploy.sh
# also wraps it; the CMD/initContainer paths have no outer timeout).
#
# OUT-OF-BAND RECOVERABLE shape: a migration whose SQL
# contains BOTH a DROP INDEX CONCURRENTLY and a CREATE INDEX CONCURRENTLY, so
# re-running it out-of-band is idempotent and clears a half-built INVALID index
# first:
#
#     DROP INDEX CONCURRENTLY IF EXISTS "x";
#     CREATE INDEX CONCURRENTLY "x" ON ...;
#
# A bare `CREATE INDEX CONCURRENTLY` (no DROP) is INTENTIONALLY not recovered:
# such migrations (e.g. 20260511000000) are written to fail loudly rather than
# be marked applied with a possibly-INVALID index. They fall through to a loud
# failure here by gate, deterministically.
#
# Statements must end with `;` at end of line, comments must be full-line `--`,
# and `;` must not appear inside string literals (true for all index DDL).

SCHEMA="prisma/schema.prisma"
MIGRATIONS_DIR="prisma/migrations"
# 3 recoverable CONCURRENTLY migrations today + a final clean pass + slack.
# The real infinite-loop backstop is the LAST_RECOVERED guard below; this is
# just a tight upper bound. Overridable for emergencies.
MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-6}"
# Per-step timeout. A CONCURRENTLY build blocked by a long-running transaction
# can hang forever; without this the CMD/initContainer paths never fail.
STEP_TIMEOUT="${MIGRATE_STEP_TIMEOUT:-1800}"

if command -v timeout >/dev/null 2>&1; then
  with_timeout() {
    wt_rc=0
    timeout "$STEP_TIMEOUT" "$@" || wt_rc=$?
    # GNU coreutils `timeout` exits 124 on expiry; BusyBox `timeout` (shipped by
    # the node:*-alpine runtime image) instead lets the child die from the
    # default SIGTERM and returns 128+15=143. Normalize so the single 124
    # timeout branch is reached on both. Under this wrapper a 143 is timeout's
    # own SIGTERM, not an unrelated external kill.
    if [ "$wt_rc" -eq 143 ]; then
      wt_rc=124
    fi
    return "$wt_rc"
  }
else
  with_timeout() { "$@"; }
fi

MIGRATE_LOG=""
MIGRATE_STATUS=0
LAST_RECOVERED=""
LAST_NATIVE_RETRY=""

STMT_FILE="$(mktemp "${TMPDIR:-/tmp}/supersync-stmts.XXXXXX")"
cleanup() {
  rm -f "$STMT_FILE" "$MIGRATE_LOG"
}
trap cleanup EXIT

run_migrate_deploy() {
  # Drop the previous attempt's log so retries don't leak temp files (the
  # trap only ever sees the last value).
  [ -n "$MIGRATE_LOG" ] && rm -f "$MIGRATE_LOG"
  MIGRATE_LOG="$(mktemp "${TMPDIR:-/tmp}/supersync-migrate.XXXXXX")"
  set +e
  with_timeout npx prisma migrate deploy >"$MIGRATE_LOG" 2>&1
  MIGRATE_STATUS=$?
  set -e
  cat "$MIGRATE_LOG"
}

# Failing migration name, from Prisma's own output, validated to the migration
# directory charset (rejects path traversal / metacharacters). Empty = unknown.
# Always exits 0 (used in `name=$(...)` under `set -e`).
parse_failing_migration() {
  # P3018: precise "Migration name:" line.
  name=$(sed -n 's/^Migration name: *\([^ ].*[^ ]\) *$/\1/p' "$MIGRATE_LOG" | tail -n1)
  if [ -z "$name" ]; then
    # P3009: the specific failed-migration sentence.
    name=$(sed -n 's/.*`\([0-9]\{14\}_[A-Za-z0-9_]*\)` migration started at.*failed.*/\1/p' \
      "$MIGRATE_LOG" | tail -n1)
  fi
  if [ -z "$name" ]; then
    # Last resort: a backticked migration-shaped token ("Applying migration").
    name=$(grep -oE '`[0-9]{14}_[A-Za-z0-9_]+`' "$MIGRATE_LOG" | tr -d '`' | tail -n1 || true)
  fi
  case "$name" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*)
      # Reject anything outside the migration-name charset (defence in depth).
      case "$name" in
        *[!A-Za-z0-9_]*) name="" ;;
      esac
      ;;
    *) name="" ;;
  esac
  printf '%s' "$name"
}

log_has() {
  grep -q "$1" "$MIGRATE_LOG"
}

log_has_line() {
  grep -Eq "$1" "$MIGRATE_LOG"
}

is_transaction_block_failure() {
  log_has_line '^Error: P3018[[:space:]]*$' &&
    { log_has_line '^ERROR: .*cannot run inside a transaction block[[:space:]]*$' ||
      log_has_line '^Database error code: 25001[[:space:]]*$'; }
}

is_lock_timeout_failure() {
  log_has_line '^Error: P3018[[:space:]]*$' &&
    { log_has_line '^ERROR: canceling statement due to lock timeout[[:space:]]*$' ||
      log_has_line '^Database error code: 55P03[[:space:]]*$'; }
}

is_stuck_failed_migration() {
  log_has_line '^Error: P3009[[:space:]]*$'
}

# A P1002 whose message names the advisory lock: another DB session holds
# Prisma's migration advisory lock, so `migrate deploy` never began applying
# migrations. Distinct from every migration-level failure below — nothing was
# applied, so there is no failing migration to recover; only the holder to clear.
is_advisory_lock_timeout() {
  log_has 'P1002' && log_has 'advisory lock'
}

migration_sql_path() {
  printf '%s/%s/migration.sql' "$MIGRATIONS_DIR" "$1"
}

# Guard: only auto-recover the idempotent drop-then-create CONCURRENTLY shape.
# A bare CREATE (no DROP) or any non-CONCURRENTLY migration fails this and is
# never auto-resolved.
is_recoverable_concurrently_migration() {
  sql="$1"
  [ -f "$sql" ] &&
    grep -Eqi 'DROP[[:space:]]+INDEX[[:space:]]+CONCURRENTLY' "$sql" &&
    grep -Eqi 'CREATE[[:space:]]+INDEX[[:space:]]+CONCURRENTLY' "$sql"
}

# The intentionally-fail-loud shape: a bare CREATE INDEX CONCURRENTLY with no
# DROP. Not auto-recovered (an interrupted build leaves an INVALID index that
# must be handled deliberately), but distinguished from a plain non-index
# migration so the loud failure can print the correct manual steps.
is_bare_create_concurrently() {
  sql="$1"
  [ -f "$sql" ] &&
    grep -Eqi 'CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX[[:space:]]+CONCURRENTLY' "$sql" &&
    ! grep -Eqi 'DROP[[:space:]]+INDEX[[:space:]]+CONCURRENTLY' "$sql"
}

# One statement per line; multi-line statements collapsed to a single line
# (index DDL is whitespace-insensitive and has no line-spanning literals).
split_statements() {
  awk '
    /^[[:space:]]*--/ { next }
    {
      sub(/^[[:space:]]+/, ""); sub(/[[:space:]]+$/, "")
      if ($0 == "") next
      stmt = (stmt == "" ? $0 : stmt " " $0)
      if ($0 ~ /;$/) { print stmt; stmt = "" }
    }
    END { if (stmt != "") print stmt }
  ' "$1"
}

# This migration needs native Prisma transaction semantics: SET LOCAL must
# apply to the ALTER, and a successful native retry must be what records the
# migration as applied. Keep the gate exact so no unrelated failed migration is
# ever rolled back automatically.
is_retryable_fastupdate_migration() {
  sql="$1"
  [ -f "$sql" ] || return 1

  split_statements "$sql" > "$STMT_FILE"
  first_stmt="$(sed -n '1p' "$STMT_FILE")"
  second_stmt="$(sed -n '2p' "$STMT_FILE")"
  third_stmt="$(sed -n '3p' "$STMT_FILE")"

  [ "$first_stmt" = "SET LOCAL lock_timeout = '1s';" ] &&
    [ "$second_stmt" = 'ALTER INDEX "operations_entity_ids_gin" SET (fastupdate = off);' ] &&
    [ -z "$third_stmt" ]
}

# Single-quote a value for safe shell paste (a'b -> 'a'\''b').
shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

print_manual_recovery() {
  name="$1"
  sql="$2"
  echo ""
  echo "Manual recovery for $name (copy-paste):"
  echo "  npx prisma migrate resolve --rolled-back $(shell_quote "$name")"
  split_statements "$sql" > "$STMT_FILE"
  while IFS= read -r stmt; do
    [ -n "$stmt" ] || continue
    echo "  printf '%s\\n' $(shell_quote "$stmt") | npx prisma db execute --schema $SCHEMA --stdin"
  done < "$STMT_FILE"
  echo "  npx prisma migrate resolve --applied $(shell_quote "$name")   # only after every statement above succeeds"
}

# Copy-paste recovery for an interrupted bare CREATE INDEX CONCURRENTLY. An
# aborted concurrent build leaves an INVALID index of the same name, so a plain
# re-run of the migration fails with "already exists"; the INVALID index must be
# dropped first. Then clear the failed record so the next deploy re-applies the
# migration natively (single-statement CONCURRENTLY needs no out-of-band run).
print_bare_create_recovery() {
  name="$1"
  sql="$2"
  idx="$(grep -Ei 'CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX[[:space:]]+CONCURRENTLY' "$sql" |
    grep -oE '"[^"]+"' | head -n1 | tr -d '"')"
  echo ""
  echo "Manual recovery for $name (interrupted bare CREATE INDEX CONCURRENTLY, copy-paste):"
  if [ -n "$idx" ]; then
    echo "  printf '%s\\n' $(shell_quote "DROP INDEX CONCURRENTLY IF EXISTS \"$idx\";") | npx prisma db execute --schema $SCHEMA --stdin"
  else
    echo "  # Drop any INVALID index left by the interrupted build (see $sql), e.g.:"
    echo "  #   DROP INDEX CONCURRENTLY IF EXISTS \"<index_name>\";"
  fi
  echo "  npx prisma migrate resolve --rolled-back $(shell_quote "$name")"
  echo "  # Then re-run the deploy; $name re-applies natively."
}

# Print copy-paste recovery for an INTERRUPTED CONCURRENTLY index build (a
# migrate step aborted by a timeout SIGTERM, OOM, or external stop), if — and
# only if — the failing migration is one. An aborted CONCURRENTLY build leaves
# an INVALID index of the target name, so a plain re-run cannot rebuild it. This
# only ever prints guidance; it never resolves a migration, and a non-index or
# unidentifiable failure prints nothing. Safe to call from any failure branch.
emit_interrupted_recovery_hint() {
  hint_name="$(parse_failing_migration)"
  [ -n "$hint_name" ] || return 0
  hint_sql="$(migration_sql_path "$hint_name")"
  if is_bare_create_concurrently "$hint_sql"; then
    print_bare_create_recovery "$hint_name" "$hint_sql"
  elif is_recoverable_concurrently_migration "$hint_sql"; then
    echo ""
    echo "$hint_name is an auto-recoverable CONCURRENTLY migration; re-run the deploy to finish it (the re-run drops any INVALID index and rebuilds)."
  fi
}

# Copy-paste diagnosis + cleanup for a P1002 advisory-lock timeout. Another DB
# session holds Prisma's migration advisory lock — almost always a one-off
# migrator container orphaned by a previous interrupted deploy (a timed-out
# `docker compose run` can leave its container, and thus its DB connection,
# alive). This only ever prints guidance; it NEVER terminates a backend, because
# an active CREATE INDEX CONCURRENTLY build legitimately holds the lock and must
# not be killed. The operator decides.
emit_advisory_lock_recovery() {
  echo ""
  echo "Another database session holds Prisma's migration advisory lock, so"
  echo "migrate deploy could not start. This is usually a migrator container"
  echo "orphaned by a previous interrupted deploy. Diagnose and clear it:"
  echo ""
  echo "  1. Remove any orphaned one-off migrator containers:"
  echo "       docker ps -aq --filter name=supersync-migrator | xargs -r docker rm -f"
  echo "       docker ps -aq --filter name=supersync-run       | xargs -r docker rm -f"
  echo "  2. If the lock is still held, find who holds it (against your Postgres):"
  echo "       SELECT a.pid, a.state, now() - a.state_change AS idle_for, left(a.query, 80)"
  echo "         FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid"
  echo "        WHERE l.locktype = 'advisory' AND l.granted;"
  echo "  3. If that session is idle (NOT actively building an index), release it:"
  echo "       SELECT pg_terminate_backend(<pid>);"
  echo "  4. Re-run the deploy. Never terminate a live CREATE INDEX CONCURRENTLY build."
}

fail_loudly() {
  echo ""
  echo "ERROR: $1"
  echo "       Not auto-recovered. Investigate the migration; do not blindly"
  echo "       mark it applied. See https://pris.ly/d/migrate-resolve"
  exit "${2:-$MIGRATE_STATUS}"
}

recover_migration() {
  name="$1"
  sql="$2"

  echo ""
  echo "==> Recovering $name outside Prisma migrate (CONCURRENTLY cannot run in a transaction)..."

  set +e
  with_timeout npx prisma migrate resolve --rolled-back "$name"
  resolve_status=$?
  set -e
  if [ "$resolve_status" -ne 0 ]; then
    echo "    Migration $name was not in a failed state; continuing with out-of-band SQL."
  fi

  split_statements "$sql" > "$STMT_FILE"
  exec_rc=0
  while IFS= read -r stmt; do
    [ -n "$stmt" ] || continue
    echo "    -> $stmt"
    if ! printf '%s\n' "$stmt" | with_timeout npx prisma db execute --schema "$SCHEMA" --stdin; then
      exec_rc=1
      break
    fi
  done < "$STMT_FILE"
  if [ "$exec_rc" -ne 0 ]; then
    echo ""
    echo "ERROR: an out-of-band statement for $name failed."
    echo "       $name was NOT marked applied (schema may be incomplete)."
    print_manual_recovery "$name" "$sql"
    exit 1
  fi

  with_timeout npx prisma migrate resolve --applied "$name"
  echo "    $name applied out-of-band and marked applied."
}

rollback_for_native_retry() {
  name="$1"

  echo ""
  echo "==> Rolling back failed migration record for bounded native retry: $name"
  set +e
  with_timeout npx prisma migrate resolve --rolled-back "$name"
  resolve_status=$?
  set -e
  if [ "$resolve_status" -ne 0 ]; then
    fail_loudly "could not mark $name rolled back; refusing to retry it." 1
  fi
}

attempt=0
while :; do
  run_migrate_deploy
  if [ "$MIGRATE_STATUS" -eq 0 ]; then
    exit 0
  fi
  if [ "$MIGRATE_STATUS" -eq 124 ]; then
    # This branch also catches a normalized 143 (with_timeout maps BusyBox's
    # SIGTERM exit to 124), i.e. the incident's own signal. A timed-out/aborted
    # CONCURRENTLY build leaves an INVALID index + a failed record, so raising
    # the timeout alone will not let a plain re-run rebuild it — surface the
    # drop-index recovery here so the FIRST failure is actionable.
    emit_interrupted_recovery_hint
    fail_loudly "prisma migrate deploy timed out after ${STEP_TIMEOUT}s (a long-running transaction may be blocking CREATE/DROP INDEX CONCURRENTLY). Clear the blocker, then raise MIGRATION_TIMEOUT (it forwards to MIGRATE_STEP_TIMEOUT) and re-run." 1
  fi

  if ! is_transaction_block_failure && ! is_lock_timeout_failure && ! is_stuck_failed_migration; then
    if is_advisory_lock_timeout; then
      # Not a migration failure (nothing was applied) — print cleanup guidance
      # and fail loudly. Rationale is on is_advisory_lock_timeout / the emitter.
      emit_advisory_lock_recovery
      fail_loudly "prisma migrate deploy could not acquire the migration advisory lock (P1002) within 10s; another migrator session holds it." 1
    fi
    # A non-P3018/P3009 exit is usually a genuine error (bad SQL, unreachable
    # DB), but OOM (137) or another non-timeout kill can also abort an in-flight
    # CONCURRENTLY build before Prisma records the failure. (A timeout SIGTERM is
    # normalized to 124 above and handled there — it never reaches here.) Surface
    # the drop-index recovery when the in-flight migration is a CONCURRENTLY
    # build so the FIRST failure is actionable (deploy.sh promises "recovery
    # steps above"); guidance only, never auto-resolves.
    emit_interrupted_recovery_hint
    fail_loudly "prisma migrate deploy failed (exit $MIGRATE_STATUS)."
  fi

  name="$(parse_failing_migration)"
  if [ -z "$name" ]; then
    fail_loudly "could not determine the failing migration from Prisma output."
  fi

  sql="$(migration_sql_path "$name")"

  # ALTER INDEX ... fastupdate takes ACCESS EXCLUSIVE on the hot GIN index.
  # Its 1s lock_timeout intentionally fails rather than queueing normal reads
  # and writes behind a waiting DDL lock. Prisma records that timeout as a
  # failed migration, so clear the failed row and retry the exact atomic,
  # idempotent migration once using Prisma itself. Never split/execute it
  # out-of-band: SET LOCAL would expire before the ALTER.
  if is_retryable_fastupdate_migration "$sql" &&
    { is_lock_timeout_failure || is_stuck_failed_migration; }; then
    rollback_for_native_retry "$name"
    if [ "$name" = "$LAST_NATIVE_RETRY" ]; then
      fail_loudly "$name failed again after its bounded native retry and was left rolled back; inspect the Prisma error above, clear the blocker, and re-run the deploy." 1
    fi
    LAST_NATIVE_RETRY="$name"
    echo ""
    echo "==> Retrying prisma migrate deploy after bounded native recovery for $name..."
    continue
  fi

  if is_lock_timeout_failure; then
    fail_loudly "$name is not the exact bounded fastupdate migration; refusing to auto-resolve its lock timeout."
  fi

  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    fail_loudly "prisma migrate deploy still failing after $attempt attempts."
  fi

  if ! is_recoverable_concurrently_migration "$sql"; then
    if is_bare_create_concurrently "$sql"; then
      print_bare_create_recovery "$name" "$sql"
    fi
    fail_loudly "$name is not a recoverable drop-then-create CONCURRENTLY index migration (a bare CREATE is intentionally fail-loud); refusing to auto-resolve."
  fi

  if [ "$name" = "$LAST_RECOVERED" ]; then
    echo ""
    echo "ERROR: $name failed again after out-of-band recovery."
    print_manual_recovery "$name" "$sql"
    exit 1
  fi

  recover_migration "$name" "$sql"
  LAST_RECOVERED="$name"
  echo ""
  echo "==> Retrying prisma migrate deploy after recovering $name..."
done

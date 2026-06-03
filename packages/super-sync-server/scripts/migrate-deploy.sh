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
# This script applies migrations and, ONLY for that specific failure mode,
# recovers by running the failing migration's own SQL out-of-band (no
# transaction), then marks it applied and retries. It hardcodes no migration
# names: the failing migration is read from Prisma's own output and its SQL is
# read from prisma/migrations/<name>/migration.sql.
#
# This script is COPYed into the image next to prisma/migrations in the same
# build, so it is always version-locked to the migrations it must handle. All
# three call sites (host deploy.sh, image startup CMD, helm initContainer)
# invoke it, so it carries its own step timeout as defense-in-depth (deploy.sh
# also wraps it; the CMD/initContainer paths have no outer timeout).
#
# RECOVERABLE shape (only this is auto-recovered): a migration whose SQL
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
  with_timeout() { timeout "$STEP_TIMEOUT" "$@"; }
else
  with_timeout() { "$@"; }
fi

MIGRATE_LOG=""
MIGRATE_STATUS=0
LAST_RECOVERED=""

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

is_transaction_block_failure() {
  log_has 'P3018' &&
    { log_has 'cannot run inside a transaction block' || log_has '25001'; }
}

is_stuck_failed_migration() {
  log_has 'P3009'
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

attempt=0
while :; do
  run_migrate_deploy
  if [ "$MIGRATE_STATUS" -eq 0 ]; then
    exit 0
  fi
  if [ "$MIGRATE_STATUS" -eq 124 ]; then
    fail_loudly "prisma migrate deploy timed out after ${STEP_TIMEOUT}s (a long-running transaction may be blocking CREATE/DROP INDEX CONCURRENTLY)." 1
  fi

  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    fail_loudly "prisma migrate deploy still failing after $attempt attempts."
  fi

  if ! is_transaction_block_failure && ! is_stuck_failed_migration; then
    fail_loudly "prisma migrate deploy failed (exit $MIGRATE_STATUS)."
  fi

  name="$(parse_failing_migration)"
  if [ -z "$name" ]; then
    fail_loudly "could not determine the failing migration from Prisma output."
  fi

  sql="$(migration_sql_path "$name")"
  if ! is_recoverable_concurrently_migration "$sql"; then
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

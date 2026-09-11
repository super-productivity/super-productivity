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
#    The recovery is serialized across racing migrators by a dedicated advisory
#    lock (RECOVERY_LOCK_KEY, see acquire_recovery_lock), and it first
#    terminates any orphaned CONCURRENTLY build a prior interrupted deploy left
#    holding the table lock (see terminate_orphaned_concurrently_backends), so
#    the DROP cannot wedge behind it on statement_timeout.
# 2. For the two-statement SET LOCAL lock_timeout + ALTER INDEX ... SET (...)
#    shape, it rolls back Prisma's failed record and retries a bounded number of
#    times through Prisma. It never splits or marks that transactional migration
#    applied itself. The gate is on SHAPE, never on a migration or index name.
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
# 5 recoverable CONCURRENTLY migrations today (20260512000000, 20260514000000,
# 20260514000002, 20260828000001, 20260829000000) + a final clean pass + slack.
# Raise this WITH the list: each recoverable migration can cost one attempt, so
# a stale count silently eats the slack rather than failing a check. The real
# infinite-loop backstop is the LAST_RECOVERED guard below; this is just a
# tight upper bound. Overridable for emergencies.
MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-8}"
# Validated for the same reason MAX_LOCK_ATTEMPTS is not settable at all: a
# non-numeric value makes the `-ge` test error inside an `if`, which `set -e`
# does not catch, so the guard silently never fires.
case "$MAX_ATTEMPTS" in
  ''|0*|*[!0-9]*)
    echo "ERROR: MIGRATE_MAX_ATTEMPTS must be a positive integer." >&2
    exit 2
    ;;
esac
# Total native attempts at one lock-bounded migration before it is left rolled
# back. Production 2026-07-21: a single retry lost one deploy outright and won
# the next only on its second try, so one retry is a coin flip against a table
# under continuous load.
#
# Each attempt is a `migrate resolve` plus a `migrate deploy`, so two Prisma CLI
# starts pace the loop; there is no explicit sleep. That spacing is INCIDENTAL —
# a property of Prisma's startup cost, not of this script — so treat the duty
# cycle of parked ACCESS EXCLUSIVE requests as un-guaranteed rather than tuned.
#
# MIGRATE_STEP_TIMEOUT does NOT bound the loop — it is per-step, and every step
# here is short. The only outer bound is deploy.sh's MIGRATION_TIMEOUT (900s
# default); the image CMD and the Helm initContainer have no outer timeout at
# all. Note the budget is PER MIGRATION (the counter resets when the failing
# name changes), so a deploy with N pending lock-bounded migrations can reach
# N x MAX_LOCK_ATTEMPTS attempts — keep that in mind before raising it.
#
# Not operator-settable: nothing needs to tune it, and the `-ge` test below
# would error inside an `if` on a non-numeric value, which `set -e` does not
# catch — an unbounded loop on exactly those two unbounded paths.
MAX_LOCK_ATTEMPTS=10
# Per-step client timeout. PostgreSQL also receives a per-statement timeout five
# seconds shorter. If cumulative work still reaches the client deadline, the
# wrapper terminates only the backend carrying this run's unique application id.
STEP_TIMEOUT="${MIGRATE_STEP_TIMEOUT:-1800}"
case "$STEP_TIMEOUT" in
  ''|0*|*[!0-9]*)
    echo "ERROR: MIGRATE_STEP_TIMEOUT must be an integer from 1 to 2147483 seconds." >&2
    exit 2
    ;;
esac
if [ "${#STEP_TIMEOUT}" -gt 7 ] || [ "$STEP_TIMEOUT" -gt 2147483 ]; then
  echo "ERROR: MIGRATE_STEP_TIMEOUT must be an integer from 1 to 2147483 seconds." >&2
  exit 2
fi
if [ "$STEP_TIMEOUT" -gt 5 ]; then
  STATEMENT_TIMEOUT_SECONDS=$((STEP_TIMEOUT - 5))
else
  STATEMENT_TIMEOUT_SECONDS=1
fi
STATEMENT_TIMEOUT_MS=$((STATEMENT_TIMEOUT_SECONDS * 1000))

# Dedicated advisory lock serializing the out-of-band recovery across racing
# migrators (#9781). Distinct from Prisma's own migrate lock (72707369): the
# recovery calls `migrate resolve` while holding this one, and those commands
# take Prisma's lock themselves — sharing the key would self-deadlock. How long
# an acquirer waits for a peer's recovery before giving up; most recoveries are
# seconds, so the default rides out a small-table rebuild without a restart.
RECOVERY_LOCK_KEY=72707370
RECOVERY_LOCK_TIMEOUT="${MIGRATE_RECOVERY_LOCK_TIMEOUT:-30}"
case "$RECOVERY_LOCK_TIMEOUT" in
  ''|0*|*[!0-9]*)
    echo "ERROR: MIGRATE_RECOVERY_LOCK_TIMEOUT must be a positive integer (seconds)." >&2
    exit 2
    ;;
esac
RECOVERY_LOCK_PID=""
RECOVERY_LOCK_ACK=""

# Helm cannot inspect a DATABASE_URL stored in an existing Kubernetes Secret,
# so its migration init container requests the same check at runtime.
if [ "${REQUIRE_DATABASE_POOL_LIMITS:-false}" = "true" ]; then
  if ! node -e '
    try {
      const url = new URL(process.env.DATABASE_URL);
      const valid = ["connection_limit", "pool_timeout"].every((name) => {
        const values = url.searchParams.getAll(name);
        const value = values[0];
        return values.length === 1 && /^[1-9][0-9]*$/.test(value) &&
          Number.isSafeInteger(Number(value));
      });
      process.exit(valid ? 0 : 1);
    } catch {
      process.exit(1);
    }
  '; then
    echo "ERROR: DATABASE_URL must include exactly one positive connection_limit and pool_timeout value each." >&2
    exit 1
  fi
fi

# DATABASE_URL may cap application statements. Migrations use a statement
# timeout just below STEP_TIMEOUT instead: a shorter application cap can cancel
# CREATE INDEX CONCURRENTLY and leave an INVALID index, while an unlimited cap
# can leave PostgreSQL working after a killed client. Collapse protected query
# parameters so a duplicate cannot override the final settings. The
# application_name lets health-alert.sh ignore expected long-running DDL.
#
# client_connection_check_interval makes an abandoned migrator backend notice
# its client is gone mid-statement and cancel itself within ~10s, so a killed/
# OOM'd/timed-out deploy no longer leaves a CONCURRENTLY build holding the table
# lock (the incident terminate_orphaned_concurrently_backends heals). It leaves
# an INVALID index the drop-then-create recovery shape already clears. Requires
# PostgreSQL >= 14 on a Linux-hosted server (POLLRDHUP) — a deliberate floor,
# documented in the server README; an older server rejects the startup option
# with FATAL, failing every migration loudly rather than degrading silently.
# Connection option format: https://www.postgresql.org/docs/16/libpq-connect.html
#
# Single source of truth for the migrator identity prefix: the generator, the
# prefix guard, and the orphan-cleanup LIKE pattern below all key on it, so a
# rename cannot silently turn the cleanup into a no-op. health-alert.sh
# hardcodes the same prefix (a shell script cannot share a variable across
# files without sourcing).
MIGRATOR_APP_NAME_PREFIX="supersync-migrator-"
if [ -n "${DATABASE_URL:-}" ]; then
  # Normally unset, so each run gets a fresh unique identity. An explicitly
  # exported value is honored (tests pin a known one; an operator could too), but
  # it MUST carry the MIGRATOR_APP_NAME_PREFIX the recovery cleanup keys on,
  # so a stray value cannot silently opt this session out of orphan termination.
  if [ -z "${MIGRATOR_APPLICATION_NAME:-}" ]; then
    if ! MIGRATOR_APPLICATION_NAME=$(node -e \
      "process.stdout.write('$MIGRATOR_APP_NAME_PREFIX' + require('node:crypto').randomUUID())"); then
      echo "ERROR: could not generate a unique database migrator identifier." >&2
      exit 1
    fi
  fi
  case "$MIGRATOR_APPLICATION_NAME" in
    "$MIGRATOR_APP_NAME_PREFIX"*) ;;
    *)
      echo "ERROR: MIGRATOR_APPLICATION_NAME must start with '$MIGRATOR_APP_NAME_PREFIX'." >&2
      exit 1
      ;;
  esac
  export MIGRATOR_APPLICATION_NAME
  if ! MIGRATOR_DATABASE_URL=$(
    MIGRATOR_SOURCE_DATABASE_URL="$DATABASE_URL" \
      MIGRATOR_STATEMENT_TIMEOUT_MS="$STATEMENT_TIMEOUT_MS" \
      MIGRATOR_APPLICATION_NAME="$MIGRATOR_APPLICATION_NAME" \
      node <<'NODE'
try {
  const url = new URL(process.env.MIGRATOR_SOURCE_DATABASE_URL);
  const options = url.searchParams.getAll('options').filter(Boolean);
  options.push(
    `-c statement_timeout=${process.env.MIGRATOR_STATEMENT_TIMEOUT_MS}`,
    // Abandoned-backend self-cancel; PG >= 14 / Linux floor (comment above).
    '-c client_connection_check_interval=10000',
  );

  url.searchParams.delete('options');
  url.searchParams.append('options', options.join(' '));
  url.searchParams.delete('application_name');
  url.searchParams.append(
    'application_name',
    process.env.MIGRATOR_APPLICATION_NAME,
  );
  url.search = url.searchParams.toString().replace(/\+/g, '%20');
  process.stdout.write(url.toString());
} catch {
  process.exit(1);
}
NODE
  ); then
    echo "ERROR: DATABASE_URL is not a valid PostgreSQL URL." >&2
    exit 1
  fi
  DATABASE_URL="$MIGRATOR_DATABASE_URL"
  export DATABASE_URL
fi

PRISMA_RECOVERY_CMD="MIGRATE_STEP_TIMEOUT=$STEP_TIMEOUT sh scripts/migrate-deploy.sh --prisma"
if [ "${MIGRATE_RECOVERY_RUNTIME:-}" = "compose" ]; then
  # Keep DATABASE_URL (and its credentials) inside Compose. The host command
  # works even when the URL comes entirely from compose defaults.
  PRISMA_RECOVERY_CMD="docker compose run --rm --no-deps -T -e \"MIGRATE_STEP_TIMEOUT=$STEP_TIMEOUT\" supersync sh scripts/migrate-deploy.sh --prisma"
  if [ "${MIGRATE_RECOVERY_BUILD_LOCAL:-false}" = "true" ]; then
    PRISMA_RECOVERY_CMD="docker compose -f docker-compose.yml -f docker-compose.build.yml run --rm --no-deps -T -e \"MIGRATE_STEP_TIMEOUT=$STEP_TIMEOUT\" supersync sh scripts/migrate-deploy.sh --prisma"
  fi
fi

if ! command -v timeout >/dev/null 2>&1; then
  echo "ERROR: timeout is required to bound database migration steps." >&2
  exit 1
fi

terminate_migrator_backends() {
  [ -n "${DATABASE_URL:-}" ] && [ -n "${MIGRATOR_APPLICATION_NAME:-}" ] || return 0

  cleanup_status=0
  MIGRATOR_TARGET_APPLICATION_NAME="$MIGRATOR_APPLICATION_NAME" \
    timeout -k 2 10 node <<'NODE' || cleanup_status=$?
const { PrismaClient } = require('@prisma/client');

const target = process.env.MIGRATOR_TARGET_APPLICATION_NAME;
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set('application_name', `${target}-cleanup`);
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });

prisma
  .$queryRawUnsafe(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND usename = current_user
        AND application_name = $1
        AND pid <> pg_backend_pid()`,
    target,
  )
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
NODE
  if [ "$cleanup_status" -ne 0 ]; then
    echo "WARNING: could not terminate the interrupted migrator database session." >&2
  fi
  return 0
}

with_timeout() {
  wt_rc=0
  timeout -k 5 "$STEP_TIMEOUT" "$@" || wt_rc=$?
  case "$wt_rc" in
    124|137|143) terminate_migrator_backends ;;
  esac
  # GNU coreutils `timeout` exits 124 on expiry; BusyBox `timeout` (shipped by
  # the node:*-alpine runtime image) instead lets the child die from the
  # default SIGTERM and returns 128+15=143. Normalize so the single 124 timeout
  # branch is reached on both. Under this wrapper a 143 is timeout's own
  # SIGTERM, not an unrelated external kill.
  if [ "$wt_rc" -eq 143 ]; then
    wt_rc=124
  fi
  return "$wt_rc"
}

# Orphaned CONCURRENTLY index builds outlive their migrator: PostgreSQL does not
# notice that a client disconnected while a backend is mid-statement
# (client_connection_check_interval defaults to 0), so a CREATE INDEX
# CONCURRENTLY whose migrator container was killed, OOM'd, or timed out keeps
# running and keeps its SHARE UPDATE EXCLUSIVE lock on the table. The out-of-band
# DROP in recover_migration would then queue behind that lock and be cancelled by
# statement_timeout, wedging every retry until an operator terminates the backend
# by hand. Clear it first so a re-run (e.g. after raising MIGRATION_TIMEOUT for a
# large table) self-heals instead.
#
# Migrator connections set client_connection_check_interval (options rewrite
# above), so a backend whose client cleanly vanished cancels itself within ~10s
# and new orphans of that class should be rare. This kill remains load-bearing
# for what the GUC cannot see: orphans left by pre-GUC migrator versions, and
# half-open connections (migrator node death, network partition) where no FIN
# arrives and only TCP keepalives eventually reap the socket.
#
# Scoped so it cannot touch the app, monitoring, another database on a shared
# cluster, or THIS run's own connections:
#   * datname = current_database() AND usename = current_user — the same DB+role
#     the orphan was created under (its DATABASE_URL is ours), never a sibling
#     environment sharing the cluster. Matches terminate_migrator_backends /
#     health-alert.sh. The role scope CAN skip an orphan created under a
#     since-rotated credential (same DB, different role); that narrow case wedges
#     on statement_timeout exactly as it did before this cleanup existed and
#     still needs a manual pg_terminate_backend.
#   * application_name LIKE '<MIGRATOR_APP_NAME_PREFIX>%' — only this pipeline's
#     migrator identity (the app sets none; monitoring uses 'supersync-monitor'),
#   * application_name <> the current run AND pid <> pg_backend_pid() — never our
#     own session nor the cleanup connection itself,
#   * state = 'active' AND query ILIKE '%CONCURRENTLY%' — only a session ACTIVELY running
#     a concurrent build/drop. The state filter is load-bearing:
#     pg_stat_activity.query keeps showing the LAST statement on an idle session,
#     so without it an idle migrator connection whose previous statement was a
#     CONCURRENTLY build would be a false match.
#
# This kill cannot tell an orphan apart from a PEER run's LIVE build (the
# out-of-band recovery never holds Prisma's advisory lock — that is why a P3018
# on a pending migration is reachable at all), so every caller MUST hold the
# dedicated recovery advisory lock first (acquire_recovery_lock, #9781): with
# recoveries serialized, no peer recovery can be mid-build when this fires.
# The predicate stays as defense-in-depth for what the lock cannot cover: a
# pre-lock migrator version racing this one, an operator running the printed
# manual recovery statements outside the lock, and a run that degraded to
# UNLOCKED after a lock-helper failure — in those windows a live peer build is
# still killable, and the fleet then converges via the idempotent
# drop-then-create at the cost of a wasted rebuild. That trade is why the
# P1002 path still refuses to auto-kill (its lock holder may be a live build
# the operator must adjudicate).
#
# Runs through prisma db execute (not the node cleanup used on timeout), so it
# inherits the same finite statement_timeout and stays fake-able in tests.
# Best-effort: on failure the DROP still runs, so warn and continue.
terminate_orphaned_concurrently_backends() {
  [ -n "${DATABASE_URL:-}" ] && [ -n "${MIGRATOR_APPLICATION_NAME:-}" ] || return 0

  echo "    Clearing any orphaned CONCURRENTLY index build left running by an interrupted prior deploy..."
  orphan_cleanup_err="$(mktemp "${TMPDIR:-/tmp}/supersync-orphan-err.XXXXXX")"
  if ! printf '%s\n' "SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE datname = current_database()
   AND usename = current_user
   AND application_name LIKE '${MIGRATOR_APP_NAME_PREFIX}%'
   AND application_name <> '$MIGRATOR_APPLICATION_NAME'
   AND pid <> pg_backend_pid()
   AND state = 'active'
   AND query ILIKE '%CONCURRENTLY%';" |
    with_timeout npx prisma db execute --schema "$SCHEMA" --stdin \
      >/dev/null 2>"$orphan_cleanup_err"; then
    echo "    WARNING: could not clear orphaned CONCURRENTLY builds; continuing with recovery." >&2
    sed 's/^/      /' "$orphan_cleanup_err" >&2 || true
  fi
  rm -f "$orphan_cleanup_err"
  return 0
}

# Serialize the out-of-band recovery under RECOVERY_LOCK_KEY (#9781), so the
# orphan-kill above can never fire while a PEER recovery is mid-build.
#
# Why a held helper connection: `npx prisma db execute` opens a fresh session
# per statement, so a session-level pg_advisory_lock taken there would vanish
# immediately, and pg_advisory_xact_lock bundled per statement only serializes
# individual statements — a peer could still kill a build between them (and
# bundling would turn CONCURRENTLY DDL into a multi-statement transaction,
# which PostgreSQL forbids). So a small node helper opens ONE PrismaClient
# connection (connection_limit=1 — a session lock lives and dies with its
# session, so the pool must never swap it), polls pg_try_advisory_lock once a
# second up to RECOVERY_LOCK_TIMEOUT (pg_try_* returns a plain boolean; the
# blocking pg_advisory_lock returns void, which Prisma's raw deserializer
# cannot be trusted with), acks through a file, and holds the session until
# SIGTERM. While holding, a 30s heartbeat keeps the pooled connection from
# being reaped idle and re-secures the lock if the pool ever swapped the
# session; the helper also exits when the parent shell is gone, so a holder
# orphaned by a hard kill releases within one beat instead of wedging peers.
# An idle session's death is detected by PostgreSQL immediately (the backend
# is blocked reading the socket), so a killed holder releases the lock at
# once — the mid-statement orphan problem the kill above heals does not apply
# to the holder itself.
#
# Failure split, deliberately asymmetric:
#   * exit 3 (connected, lock still held after the wait) is FATAL for the
#     caller: the holder is a live peer recovery whose CONCURRENTLY build must
#     not be touched — fail loudly with diagnosis guidance and let the
#     orchestrator's restart retry.
#   * any other failure (cannot even connect/start) degrades to an UNLOCKED
#     recovery with a loud warning: Prisma itself just reached the database
#     over the same URL, so this is a helper problem, and refusing to recover
#     would turn every such hiccup into a wedged deploy. Unlocked equals the
#     pre-lock behavior; the kill predicate still bounds what it can touch.
acquire_recovery_lock() {
  [ -n "${DATABASE_URL:-}" ] && [ -n "${MIGRATOR_APPLICATION_NAME:-}" ] || return 0

  echo "    Serializing recovery under the dedicated recovery advisory lock ($RECOVERY_LOCK_KEY)..."
  RECOVERY_LOCK_ACK="$(mktemp "${TMPDIR:-/tmp}/supersync-recovery-lock.XXXXXX")"
  RECOVERY_LOCK_ACK_FILE="$RECOVERY_LOCK_ACK" \
    RECOVERY_LOCK_KEY="$RECOVERY_LOCK_KEY" \
    RECOVERY_LOCK_TIMEOUT_S="$RECOVERY_LOCK_TIMEOUT" \
    RECOVERY_LOCK_PARENT_PID="$$" \
    node <<'NODE' &
const { PrismaClient } = require('@prisma/client');
const { writeFileSync } = require('node:fs');

const ackFile = process.env.RECOVERY_LOCK_ACK_FILE;
const key = process.env.RECOVERY_LOCK_KEY;
const waitSeconds = Number(process.env.RECOVERY_LOCK_TIMEOUT_S);
const parentPid = Number(process.env.RECOVERY_LOCK_PARENT_PID);

const url = new URL(process.env.DATABASE_URL);
// One physical connection: the session-level advisory lock lives and dies
// with its session, so the pool must never swap it under us. The suffix keeps
// this session visible (and 'supersync-migrator-<uuid>-lock' stays under
// PostgreSQL's 63-byte NAMEDATALEN); it is idle while held and its queries
// never contain CONCURRENTLY, so the orphan-kill predicate can never match it.
url.searchParams.set('connection_limit', '1');
url.searchParams.set(
  'application_name',
  `${process.env.MIGRATOR_APPLICATION_NAME}-lock`,
);
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });

const EXIT_HELD = 3;
const EXIT_UNAVAILABLE = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let done = false;
const stop = async (code) => {
  if (done) return;
  done = true;
  await prisma.$disconnect().catch(() => {});
  process.exit(code);
};
process.on('SIGTERM', () => void stop(0));
process.on('SIGINT', () => void stop(0));

const tryLock = async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT pg_try_advisory_lock(${key}) AS locked, pg_backend_pid() AS pid`,
  );
  return rows[0];
};

(async () => {
  try {
    await prisma.$connect();
  } catch (e) {
    console.error(`recovery-lock: could not connect: ${e && e.message ? e.message : e}`);
    return stop(EXIT_UNAVAILABLE);
  }
  const deadline = Date.now() + waitSeconds * 1000;
  let row;
  for (;;) {
    row = await tryLock();
    if (row.locked) break;
    if (Date.now() >= deadline) return stop(EXIT_HELD);
    await sleep(1000);
  }
  writeFileSync(ackFile, `acquired:${row.pid}\n`);
  let heldPid = row.pid;
  setInterval(async () => {
    if (process.ppid !== parentPid) return void stop(0);
    try {
      const beat = await tryLock();
      if (beat.pid !== heldPid || !beat.locked) {
        console.error(
          'recovery-lock WARNING: database session changed under the lock; re-secured where possible.',
        );
        heldPid = beat.pid;
      }
    } catch (e) {
      console.error(`recovery-lock heartbeat failed: ${e && e.message ? e.message : e}`);
    }
  }, 30_000);
})().catch((e) => {
  console.error(`recovery-lock: ${e && e.message ? e.message : e}`);
  return stop(EXIT_UNAVAILABLE);
});
NODE
  RECOVERY_LOCK_PID=$!
  # Wait for the helper to acquire, refuse, or die. Bounded: the helper's own
  # wait budget plus slack for node startup and the connect attempt.
  arl_deadline=$((RECOVERY_LOCK_TIMEOUT + 15))
  arl_waited=0
  while :; do
    if [ -s "$RECOVERY_LOCK_ACK" ]; then
      return 0
    fi
    kill -0 "$RECOVERY_LOCK_PID" 2>/dev/null || break
    if [ "$arl_waited" -ge "$arl_deadline" ]; then
      break
    fi
    sleep 1
    arl_waited=$((arl_waited + 1))
  done
  kill "$RECOVERY_LOCK_PID" 2>/dev/null || true
  arl_status=0
  wait "$RECOVERY_LOCK_PID" || arl_status=$?
  RECOVERY_LOCK_PID=""
  rm -f "$RECOVERY_LOCK_ACK"
  RECOVERY_LOCK_ACK=""
  if [ "$arl_status" -eq 3 ]; then
    return 3
  fi
  echo "    WARNING: could not acquire the recovery advisory lock (helper exit $arl_status); continuing UNLOCKED — racing recoveries are not serialized this run."
  return 0
}

release_recovery_lock() {
  [ -n "$RECOVERY_LOCK_PID" ] || return 0
  kill "$RECOVERY_LOCK_PID" 2>/dev/null || true
  rrl_waited=0
  while kill -0 "$RECOVERY_LOCK_PID" 2>/dev/null && [ "$rrl_waited" -lt 5 ]; do
    sleep 1
    rrl_waited=$((rrl_waited + 1))
  done
  kill -9 "$RECOVERY_LOCK_PID" 2>/dev/null || true
  wait "$RECOVERY_LOCK_PID" 2>/dev/null || true
  RECOVERY_LOCK_PID=""
  [ -n "$RECOVERY_LOCK_ACK" ] && rm -f "$RECOVERY_LOCK_ACK"
  RECOVERY_LOCK_ACK=""
  return 0
}

# Copy-paste diagnosis when the recovery lock is held: almost always a live
# peer recovery whose build must simply be allowed to finish. Guidance only —
# mirrors the P1002 emitter's operator-decides stance.
emit_recovery_lock_busy() {
  echo ""
  echo "Another migration recovery holds the dedicated recovery advisory lock"
  echo "($RECOVERY_LOCK_KEY), so this run refused to touch its (possibly live)"
  echo "CONCURRENTLY build. Usually that recovery is still working — re-running"
  echo "this deploy after it finishes succeeds. If it looks stuck, diagnose"
  echo "against your Postgres:"
  echo ""
  echo "  SELECT a.pid, a.state, a.application_name, now() - a.state_change AS held_for, left(a.query, 80)"
  echo "    FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid"
  echo "   WHERE l.locktype = 'advisory' AND l.objid = $RECOVERY_LOCK_KEY AND l.granted;"
  echo ""
  echo "  Only if the holder is idle and its migrator is gone, release it:"
  echo "    SELECT pg_terminate_backend(<pid>);"
}

# Printed manual-recovery commands re-enter through this narrow wrapper so
# they receive the same finite bounds without printing database secrets.
if [ "${1:-}" = "--prisma" ]; then
  shift
  [ "$#" -gt 0 ] || { echo "ERROR: --prisma requires Prisma arguments." >&2; exit 2; }
  prisma_status=0
  with_timeout npx prisma "$@" || prisma_status=$?
  exit "$prisma_status"
fi

# Test/diagnostic seam: run ONLY the orphaned-CONCURRENTLY cleanup, then exit.
# It takes the recovery advisory lock like the full recovery does, so it cannot
# kill a build a locked peer recovery is running — but a legitimate long build
# in an UNLOCKED context (a pre-lock migrator version, an operator's manual
# recovery) is still indistinguishable from an orphan, so prefer not to run it
# while any deploy is in progress. Exists mainly to let the integration test
# assert targeting and serialization against a real pg_stat_activity without
# provoking a full CONCURRENTLY index build.
if [ "${1:-}" = "--terminate-orphaned-concurrently" ]; then
  # Fail loudly rather than silently exiting 0: an operator running this from a
  # host shell without DATABASE_URL would otherwise conclude no orphan exists
  # while the orphan still holds the table lock.
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: --terminate-orphaned-concurrently requires DATABASE_URL; nothing was checked or terminated." >&2
    exit 2
  fi
  if ! acquire_recovery_lock; then
    emit_recovery_lock_busy
    echo ""
    echo "ERROR: recovery advisory lock ($RECOVERY_LOCK_KEY) is held by another recovery; nothing was terminated." >&2
    exit 1
  fi
  terminate_orphaned_concurrently_backends
  release_recovery_lock
  exit 0
fi

MIGRATE_LOG=""
MIGRATE_STATUS=0
LAST_RECOVERED=""
LAST_NATIVE_RETRY=""
LOCK_ATTEMPTS=0

STMT_FILE="$(mktemp "${TMPDIR:-/tmp}/supersync-stmts.XXXXXX")"
PREFLIGHT_LOG=""
cleanup() {
  rm -f "$STMT_FILE" "$MIGRATE_LOG" "$PREFLIGHT_LOG"
  # Recovery error paths exit directly; make sure the lock holder never
  # outlives the script (its session closing is what releases the lock).
  release_recovery_lock
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
  # Strip ANSI colour ONCE, here, so every later reader sees plain text. Prisma
  # renders `Error: P3018` as `\e[1m\e[31mError: \e[39m\e[22m\e[31mP3018` under
  # FORCE_COLOR / npm_config_color=always. That anchor is the first conjunct of
  # all three failure detectors, so a single stray env var would otherwise
  # disable EVERY recovery path at once — and would also poison
  # parse_failing_migration, whose charset check rejects a name with escapes.
  # ESC is built with printf because `\x1b` is a GNU sed extension BusyBox lacks.
  sed -i "s/$(printf '\033')\[[0-9;]*m//g" "$MIGRATE_LOG"
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

# A lock-bounded migration: exactly two statements, a SET LOCAL lock_timeout
# followed by a single ALTER INDEX ... SET (...). Such a migration needs native
# Prisma transaction semantics (SET LOCAL must apply to the ALTER, and a
# successful native retry must be what records it as applied), and re-running it
# from scratch is free, so a lock timeout can safely be retried.
#
# Gated on SHAPE, never on a migration or index name; absence of names is
# enforced by tests/migration-sql.spec.ts. Rationale: prisma/migrations/README.md.
#
# Three properties are enforced below, and a fourth follows from them:
#   - a SHORT lock_timeout bound (<= 5s). This is the load-bearing one: the point
#     of the bound is to fail fast rather than queue new queries behind a waiting
#     ACCESS EXCLUSIVE request, so a long value ('30min') — or a disabled one
#     ('0', which means wait forever in PostgreSQL) — must never be retried at
#     all, let alone MAX_LOCK_ATTEMPTS times;
#   - exactly two statements, so Postgres wraps them in an implicit transaction
#     and a lock timeout rolls the whole migration back with nothing partially
#     applied;
#   - an ALTER INDEX ... SET (reloption), which is idempotent on re-run.
# The fourth — no CONCURRENTLY — is NOT a separate check: it follows from the
# ALTER pattern being fully anchored with a paren-free option list, so the
# ALTER's own `)` always lands inside the span and nothing can follow it. That
# matters because split_statements breaks on `;` at END OF LINE, so the
# statement count alone would not stop a CONCURRENTLY build sharing the ALTER's
# line — and a SINGLE-statement migration gets no implicit transaction, so a
# lock timeout mid-build leaves an INVALID index a blind retry cannot clear.
#
# Matched with grep -Ei, like the CONCURRENTLY gates above, so that spacing and
# keyword case are not load-bearing for a future migration author.
is_lock_bounded_migration() {
  sql="$1"
  [ -f "$sql" ] || return 1

  split_statements "$sql" > "$STMT_FILE"
  first_stmt="$(sed -n '1p' "$STMT_FILE")"
  second_stmt="$(sed -n '2p' "$STMT_FILE")"
  third_stmt="$(sed -n '3p' "$STMT_FILE")"

  printf '%s\n' "$first_stmt" | grep -Eqi \
    "^SET[[:space:]]+LOCAL[[:space:]]+lock_timeout[[:space:]]*=[[:space:]]*'(([1-9][0-9]{0,2}|[1-4][0-9]{3}|5000)ms|[1-5]s)';\$" ||
    return 1
  printf '%s\n' "$second_stmt" | grep -Eqi \
    '^ALTER[[:space:]]+INDEX[[:space:]]+"[^"]+"[[:space:]]+SET[[:space:]]*\([^()]*\);$' ||
    return 1
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
  echo "  $PRISMA_RECOVERY_CMD migrate resolve --rolled-back $(shell_quote "$name")"
  split_statements "$sql" > "$STMT_FILE"
  while IFS= read -r stmt; do
    [ -n "$stmt" ] || continue
    echo "  printf '%s\\n' $(shell_quote "$stmt") | $PRISMA_RECOVERY_CMD db execute --schema $SCHEMA --stdin"
  done < "$STMT_FILE"
  echo "  $PRISMA_RECOVERY_CMD migrate resolve --applied $(shell_quote "$name")   # only after every statement above succeeds"
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
    echo "  printf '%s\\n' $(shell_quote "DROP INDEX CONCURRENTLY IF EXISTS \"$idx\";") | $PRISMA_RECOVERY_CMD db execute --schema $SCHEMA --stdin"
  else
    echo "  # Drop any INVALID index left by the interrupted build (see $sql), e.g.:"
    echo "  #   DROP INDEX CONCURRENTLY IF EXISTS \"<index_name>\";"
  fi
  echo "  $PRISMA_RECOVERY_CMD migrate resolve --rolled-back $(shell_quote "$name")"
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

  # Serialize the whole recovery — most importantly the orphan-kill below —
  # against racing migrators (#9781). A held lock means a peer recovery is
  # mid-build: refusing (retryably) is the point, not a failure of this run.
  if ! acquire_recovery_lock; then
    emit_recovery_lock_busy
    fail_loudly "another migration recovery holds the recovery advisory lock ($RECOVERY_LOCK_KEY); its CONCURRENTLY build may be live. Re-run the deploy once it finishes (guidance above)." 1
  fi

  # A prior interrupted deploy can leave a CONCURRENTLY build still holding the
  # table lock; clear it before the DROP below queues behind it and dies on
  # statement_timeout. See terminate_orphaned_concurrently_backends.
  terminate_orphaned_concurrently_backends

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
  release_recovery_lock
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

# Preflight: warn where the server is below the supported floor of 16.
#
# There is deliberately NO hard block here. The migration chain does require
# PG13 -- it sets a storage parameter older servers reject with 22023, which
# matches none of the gates above, so the migration would land failed and every
# later deploy would die on P3009 (under Helm, a CrashLooping migrate-db
# initContainer). But the migrator connection options set further up already
# include client_connection_check_interval, a PG14+ startup option that an older
# server rejects with FATAL at connect time. 14 > 13, so no connection capable of
# wedging the chain is ever established.
#
# That is measured, not assumed: on 12.22 and on 13.x this preflight cannot
# connect either, `migrate deploy` fails loudly with the FATAL, and
# `_prisma_migrations` is never created. An earlier revision of this preflight
# carried a second tier that refused below 13; once the connection option landed
# it provably never fired, so it was removed rather than left as dead code.
#
# PG14-15 is the case left to report: those servers apply every migration
# cleanly, they are just outside what the project tests. Blocking them would
# strand self-hosters who are working today, on a floor this repo never declared
# before, as a side effect of a performance tweak. They get a warning instead.
#
# Deliberately generic: this script must never name a migration or a reloption.
# That lockstep coupling is what went stale and broke a production deploy, and
# it is guarded by tests/migration-sql.spec.ts. Details live in README.md.
#
# A DO block rather than parsing a version out of a query, because
# `prisma db execute` reports no rows: RAISE makes the server do the comparison
# and turns a wrong version into a non-zero exit with a readable message.
#
# RAISE EXCEPTION, not the WARNING this tier's severity would suggest, because
# `prisma db execute` does not surface warnings at all: verified against a real
# PostgreSQL 15, a WARNING returns "Script executed successfully" and exit 0, so
# a grep for it could never match and the tier would silently never fire. An
# EXCEPTION's message text IS surfaced (verified: "Error: ERROR: <message>",
# exit 1).
#
# A `db execute` can also fail because the database is unreachable, still
# starting, or too old for the migrator's connection options. Reporting any of
# those as "your PostgreSQL is below 16" would send an operator down the wrong
# path entirely -- so anything not carrying the marker falls through and lets
# `migrate deploy` report the real error in its own words.
UNSUPPORTED_MARKER='SuperSync supports PostgreSQL 16 or newer'

require_supported_postgres_version() {
  echo "==> Checking PostgreSQL version..."
  PREFLIGHT_LOG="$(mktemp "${TMPDIR:-/tmp}/supersync-pgversion.XXXXXX")"
  preflight_log="$PREFLIGHT_LOG"
  set +e
  printf '%s\n' "DO \$\$ BEGIN
     IF current_setting('server_version_num')::int < 160000 THEN
       RAISE EXCEPTION '$UNSUPPORTED_MARKER, found %',
         current_setting('server_version');
     END IF;
   END \$\$;" | with_timeout npx prisma db execute --schema "$SCHEMA" --stdin \
    > "$preflight_log" 2>&1
  preflight_status=$?
  set -e
  if [ "$preflight_status" -eq 0 ]; then
    return 0
  fi
  if grep -q "$UNSUPPORTED_MARKER" "$preflight_log"; then
    echo ""
    echo "WARNING: this PostgreSQL is below SuperSync's supported floor (16)."
    echo "         Migrations still apply, and nothing here is known to break,"
    echo "         but this version is not covered by the test suite."
    echo "         See packages/super-sync-server/README.md."
    echo ""
    return 0
  fi
  echo "    Could not determine the server version (exit $preflight_status);"
  echo "    continuing -- migrate deploy will report the underlying error."
  return 0
}

require_supported_postgres_version

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

  # ALTER INDEX ... SET (...) takes ACCESS EXCLUSIVE on the target index. Its
  # short lock_timeout intentionally fails rather than queueing normal reads and
  # writes behind a waiting DDL lock — a waiting exclusive request blocks every
  # new query on the table, which is the shape of a prior outage. So the fix for
  # losing the race is MANY SHORT ATTEMPTS, never one long wait. Prisma records
  # the timeout as a failed migration, so clear the failed row and retry the
  # atomic, idempotent migration through Prisma itself. Never split/execute it
  # out-of-band: SET LOCAL would expire before the ALTER.
  if is_lock_bounded_migration "$sql" &&
    { is_lock_timeout_failure || is_stuck_failed_migration; }; then
    rollback_for_native_retry "$name"
    if [ "$name" != "$LAST_NATIVE_RETRY" ]; then
      LAST_NATIVE_RETRY="$name"
      LOCK_ATTEMPTS=0
    fi
    LOCK_ATTEMPTS=$((LOCK_ATTEMPTS + 1))
    if [ "$LOCK_ATTEMPTS" -ge "$MAX_LOCK_ATTEMPTS" ]; then
      fail_loudly "$name could not take its lock in $LOCK_ATTEMPTS attempts and was left rolled back; inspect the Prisma error above, clear the blocker, and re-run the deploy." 1
    fi
    echo ""
    echo "==> Retrying prisma migrate deploy after bounded native recovery for $name (attempt $((LOCK_ATTEMPTS + 1)) of $MAX_LOCK_ATTEMPTS)..."
    continue
  fi

  if is_lock_timeout_failure; then
    # A lock timeout can also abort a CONCURRENTLY build (an operator-supplied
    # lock_timeout in DATABASE_URL applies to every migration), which leaves an
    # INVALID index. Print the drop-index steps so the FIRST failure is
    # actionable, matching the timeout and non-gate branches above.
    emit_interrupted_recovery_hint
    fail_loudly "$name is not a lock-bounded ALTER INDEX migration; refusing to auto-resolve its lock timeout."
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

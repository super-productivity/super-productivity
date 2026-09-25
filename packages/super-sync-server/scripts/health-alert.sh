#!/bin/bash
# SuperSync Health Alert Script
#
# Checks container health and sends an email alert if something is wrong.
# Designed to run via cron every 5 minutes.
#
# Setup:
#   chmod +x scripts/health-alert.sh
#   crontab -e
#   */5 * * * * ALERT_EMAIL=you@example.com /path/to/super-sync-server/scripts/health-alert.sh
#
# Configuration (set these or pass via environment):
#   ALERT_EMAIL    - Email address to receive alerts (required)
#   MAIL_CMD       - mail binary to use (default: mail); a test seam
#   JOURNAL_CMD    - journalctl binary to use (default: journalctl); a test seam
#   COMPOSE_DIR    - Path to docker-compose.yml directory (default: script directory's parent)
#   HEALTH_URL     - Health endpoint URL (default: read from .env DOMAIN)
#   MAX_QUERY_SECONDS  - Alert if any query has been active longer (default: 120)
#   POOL_WARN_PCT      - Alert if this % of the pool is concurrently BUSY -- running a
#                        query or holding a transaction (default: 75). Idle pooled
#                        connections are not counted; see MONITORING-README.md check 7.
#   POSTGRES_SERVICE   - Bundled database service to health-check
#                        (default: postgres; empty: none)

# Do NOT use set -e — a monitoring script must never silently abort.
set -uo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$(dirname "$SCRIPT_DIR")}"
# No default recipient on purpose: this script ships in the repo and the image, so any
# default address would silently mail a self-hoster's hostname, disk usage and container
# state to whoever that address belongs to. Alerting is off until the operator opts in.
ALERT_EMAIL="${ALERT_EMAIL:-}"
MAIL_CMD="${MAIL_CMD:-mail}"
JOURNAL_CMD="${JOURNAL_CMD:-journalctl}"
MAX_QUERY_SECONDS="${MAX_QUERY_SECONDS:-120}"
POOL_WARN_PCT="${POOL_WARN_PCT:-75}"

if [ -z "$ALERT_EMAIL" ]; then
  echo "health-alert: ALERT_EMAIL is not set, alerting is disabled." >&2
  echo "  Enable it with: ALERT_EMAIL=you@example.com $0" >&2
  exit 0
fi

CONFIG_PROBLEMS=""
DB_CONFIG_OK=true
if ! [[ "$MAX_QUERY_SECONDS" =~ ^[1-9][0-9]*$ ]] ||
  [ "${#MAX_QUERY_SECONDS}" -gt 10 ] ||
  [ "$MAX_QUERY_SECONDS" -gt 2147483647 ]; then
  CONFIG_PROBLEMS="${CONFIG_PROBLEMS}MAX_QUERY_SECONDS must be an integer from 1 to 2147483647\n"
  DB_CONFIG_OK=false
fi
if ! [[ "$POOL_WARN_PCT" =~ ^([1-9]|[1-9][0-9]|100)$ ]]; then
  CONFIG_PROBLEMS="${CONFIG_PROBLEMS}POOL_WARN_PCT must be an integer from 1 to 100\n"
  DB_CONFIG_OK=false
fi

if [ ! -f "$COMPOSE_DIR/docker-compose.yml" ]; then
  echo "ERROR: $COMPOSE_DIR does not contain docker-compose.yml" >&2
  exit 1
fi

# State file in project-local directory (not /tmp — avoids symlink attacks (only while it stays non-world-writable) and tmp cleanup)
ALERT_STATE_DIR="${COMPOSE_DIR}/.health-alert"
# umask 077 makes this 0700. Later runs do not re-chmod it, so an operator can widen it to
# let a non-root deploy.sh read the markers — which is why deploy.sh sanitizes on read too.
mkdir -p "$ALERT_STATE_DIR"
# One hash per line: every distinct problem already mailed in the CURRENT incident. A single
# slot was the alert-storm bug — an incident that alternates between two symptoms (a long
# query, then a probe that times out because of it) overwrote the slot on every flip, so each
# flip looked new and mailed again. Cleared when the incident ends.
ALERT_STATE_FILE="$ALERT_STATE_DIR/state"
# One healthy run is not a recovery: a five-minute blip would otherwise cost a matched
# alert/recovery pair every time it flickers. This marker is the "one healthy run seen"
# half of that; the second consecutive healthy run sends. Deliberately not tunable — a
# fixed two runs needs no arithmetic, no validation, and no bad-value branch echoing to
# stderr on every one of the 288 cron runs a day.
CLEAN_RUN_SEEN_FILE="$ALERT_STATE_DIR/clean-run-seen"
MAIL_FAILED_FILE="$ALERT_STATE_DIR/mail-failed"
OOM_BLIND_FILE="$ALERT_STATE_DIR/oom-check-blind"
# The failure-side mirror of CLEAN_RUN_SEEN_FILE, for the one check that reads an
# instantaneous gauge: pool-busy pages only when the pressure survives to the next run.
# See the check itself for why.
POOL_PENDING_FILE="$ALERT_STATE_DIR/pool-busy-pending"
MAIL_ERR_MAX_BYTES=4096
# The database probe's own stderr, carried into the alert BODY. Far shorter than the mail
# limit above: this is diagnostic context appended to an alert, not the alert itself, and a
# Prisma stack trace would otherwise bury the problem list it is attached to.
DB_PROBE_ERR_MAX_BYTES=512

# Strip terminal control sequences from text this script did not produce (a remote SMTP
# relay, a Prisma error) and that is about to be echoed to a terminal or mailed. The sed
# matches UTF-8-*encoded* C1 (\xc2 followed by \x80-\x9f, which encodes U+0080-U+009F and
# nothing else) so CSI/OSC go but em-dash, NBSP and CJK survive; a plain 0x80-0x9F byte
# range would instead eat UTF-8 continuation bytes and corrupt every non-ASCII message.
# Both halves are pinned by the "strips UTF-8-encoded C1 controls" spec case. TAB (\011)
# and newline (\012) are deliberately spared: a multi-line probe error stays readable. $1
# caps the output length.
# shortcut: `|| true` because `head -c` closing the pipe early makes the pipeline exit 141
# under `set -o pipefail` on any input that truncates. Both call sites discard the status
# today, so this only stops that from becoming a trap for a future `… || warn` caller.
strip_control_chars() {
  { LC_ALL=C tr -d '\000-\010\013-\037\177' |
    LC_ALL=C sed 's/\xc2[\x80-\x9f]//g' | head -c "$1"; } || true
}

# Record why mail could not be delivered. Line 1 is always the timestamp, so readers that
# want only that (deploy.sh) can take the first line; the reason follows. Reason text can
# originate from a remote SMTP relay and deploy.sh echoes it to a terminal, so it is
# sanitized and capped at write time.
record_mail_failure() {
  {
    date -u +%Y-%m-%dT%H:%M:%SZ
    printf '%s\n' "$1" | strip_control_chars "$MAIL_ERR_MAX_BYTES"
  } > "$MAIL_FAILED_FILE"
}

# One send path for both call sites. Body on stdin; returns non-zero and records why on
# failure. Callers gate on $MAIL_AVAILABLE — see the two send conditions below.
send_alert_mail() {
  local err errfile rc
  # stderr to a FILE, never `err=$(...)`: command substitution waits for pipe EOF, so an
  # MTA that forks a delivery child survives `timeout 30` and hangs the run indefinitely
  # while holding the flock — silently killing every later cron run. stdout is discarded
  # because that is where msmtp --debug prints the SMTP dialogue, AUTH included.
  errfile="$ALERT_STATE_DIR/.mail-err"
  timeout 30 "$MAIL_CMD" -s "$1" -- "$ALERT_EMAIL" >/dev/null 2>"$errfile"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    rm -f "$errfile"
    return 0
  fi
  err=$(head -c "$MAIL_ERR_MAX_BYTES" "$errfile" 2>/dev/null)
  rm -f "$errfile"
  if [ "$rc" -eq 124 ]; then
    err="timed out after 30s${err:+: $err}"
  fi
  record_mail_failure "${err:-mail exited $rc with no error output}"
  return 1
}

# Prevent concurrent runs (cron overlap if a previous run hangs)
LOCK_FILE="$ALERT_STATE_DIR/health-alert.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

# The probe's stderr lands here UNREDACTED for the ~25s between the redirect and the read,
# and a Prisma connection error can name the datasource URL. The normal path unlinks it,
# but a SIGKILL or reboot inside that window would otherwise leave a credential on disk
# until the next probe truncates the file. umask 077 keeps it 0600, which is the second
# line of defence, not the first: the state dir is documented above as something an
# operator may widen so a non-root deploy.sh can read the markers.
DB_ERRFILE="$ALERT_STATE_DIR/.db-probe-err"
trap 'rm -f "$DB_ERRFILE"' EXIT

# A stock Debian/Ubuntu host has no `mail` binary, and without this check the first
# discovery of that is the first real incident, months after setup. Record it in the marker
# deploy.sh already surfaces — never in CONFIG_PROBLEMS, which is the alert body and the
# dedupe hash input: routing it there would report the broken channel through the broken
# channel and keep PROBLEMS permanently non-empty, disabling the recovery branch.
MAIL_AVAILABLE=true
if ! command -v "$MAIL_CMD" >/dev/null 2>&1; then
  MAIL_AVAILABLE=false
  echo "health-alert: no '$MAIL_CMD' binary on PATH — install mailutils or bsd-mailx." >&2
  record_mail_failure "no $MAIL_CMD binary on PATH — install mailutils or bsd-mailx"
fi

cd "$COMPOSE_DIR"

# Load domain from .env
DOMAIN=""
if [ -f ".env" ]; then
  DOMAIN=$(grep -E '^DOMAIN=' ".env" 2>/dev/null | cut -d'=' -f2 | tr -d "\"' " || true)
fi
HEALTH_URL="${HEALTH_URL:-https://${DOMAIN:-localhost}/health}"

# An explicitly empty value means the deployment uses an external database.
if [ "${POSTGRES_SERVICE+x}" != "x" ]; then
  if grep -qE '^POSTGRES_SERVICE=' ".env" 2>/dev/null; then
    POSTGRES_SERVICE=$(grep -m1 -E '^POSTGRES_SERVICE=' ".env" 2>/dev/null |
      cut -d'=' -f2- | tr -d "\"' " || true)
  else
    POSTGRES_SERVICE="postgres"
  fi
fi

PROBLEMS="$CONFIG_PROBLEMS"
DOCKER_OK=true
# Set only when the database probe fails, and only ever read into the mail body. Declared
# here because the probe lives behind the Docker gate: under `set -u` a Docker-down run
# would otherwise abort at the body-assembly line below.
DB_PROBE_DETAIL=""

# 0. Check Docker daemon is accessible
if ! docker info >/dev/null 2>&1; then
  PROBLEMS="${PROBLEMS}Docker daemon is not running or not accessible!\n"
  DOCKER_OK=false
fi

if $DOCKER_OK; then
  # 1. Check if all containers are running and healthy
  SERVICES=(supersync)
  if [ -n "$POSTGRES_SERVICE" ]; then
    SERVICES+=("$POSTGRES_SERVICE")
  fi
  SERVICES+=(caddy)
  for svc in "${SERVICES[@]}"; do
    # `-a` is load-bearing: without it compose lists only running containers, so a crashed
    # one reports an EMPTY state -- the 2026-08-25 alert read "state:" with nothing after
    # it. `{{.State}}` alone is NOT enough: it renders a bare "exited", so the (128) that
    # named the failure still would not reach the operator. The code has its own field.
    # (`{{.Status}}` carries it as "Exited (128) 4 minutes ago", but that relative time
    # changes every run and the normalizer does not touch it -- it would defeat dedupe and
    # re-alert every 5 minutes. ExitCode is stable.)
    # All three fields in ONE call: separate calls could describe different containers.
    # head -1: `-a` is also what admits leftover one-off `docker compose run` containers
    # ("including those created by the run command" -- compose's own --help), and row order
    # is undocumented. Ceiling: a crashed replica beside a healthy one reads as healthy.
    # Accepted because deploy.sh's two `run` call sites both pass --rm, so a leftover needs
    # a hard kill mid-migration. Upgrade path: add {{.Name}} and drop rows matching -run-.
    PS_LINE=$(docker compose ps -a --format '{{.State}}|{{.Health}}|{{.ExitCode}}' "$svc" 2>/dev/null | head -1)
    # A Go template naming ONE unsupported field aborts the WHOLE render: empty stdout,
    # exit 1, no partial output (verified against compose v5.4.0). On a compose too old for
    # {{.ExitCode}} that is byte-identical to "no such container", so every service on a
    # healthy stack would be alerted as `missing`. Dockerfile:60 ships this to self-hosters,
    # so retry the previously shipped template before believing the emptiness.
    if [ -z "$PS_LINE" ]; then
      PS_LINE=$(docker compose ps -a --format '{{.State}}|{{.Health}}' "$svc" 2>/dev/null | head -1)
    fi
    # `read` over ${VAR%%|*} chains: a missing field reads as empty instead of yielding the
    # whole line, which is what `${PS_LINE#*|}` does when compose emits no delimiter at all.
    IFS='|' read -r STATE HEALTH EXIT_CODE <<<"$PS_LINE"
    # No output at all means there is no such container.
    if [ -z "$PS_LINE" ]; then STATE="missing"; fi
    # Guard against "<no value>" from older Docker Compose versions
    if [ "$HEALTH" = "<no value>" ]; then HEALTH=""; fi

    if [ "$STATE" != "running" ]; then
      # :-unknown is unconditional on purpose: the empty-state guard above only fires when
      # the whole line is empty, so a "|healthy" line would regress to the 2026-08-25 mail.
      # A non-zero code distinguishes "OOM-killed" (137) from "config rejected" (78) from
      # the runc task-creation failure (128) that caused the outage. Zero and empty carry
      # no information -- a never-started container reports 0 -- so they are left off.
      STATE_DETAIL=""
      if [[ "${EXIT_CODE:-0}" =~ ^[0-9]+$ ]] && [ "${EXIT_CODE:-0}" -ne 0 ]; then
        STATE_DETAIL=" (exit ${EXIT_CODE})"
      fi
      PROBLEMS="${PROBLEMS}Container '$svc' state: ${STATE:-unknown}${STATE_DETAIL}\n"
    elif [ -n "$HEALTH" ] && [ "$HEALTH" != "healthy" ]; then
      PROBLEMS="${PROBLEMS}Container '$svc' health: ${HEALTH}\n"
    fi
  done

  # 3. Check restart counts
  # Note: RestartCount is cumulative over the container's lifetime. It only resets on
  # docker compose down/up or --force-recreate. Threshold of 5 avoids false positives
  # from normal deploy restarts.
  for svc in "${SERVICES[@]}"; do
    # `-a` for the same reason as check 1: without it a dead container has no id here, so
    # RestartCount -- the value distinguishing "died once" from "crash-looped 40 times" --
    # goes missing precisely when the operator needs it. The two checks must agree on which
    # containers exist; disagreeing is what produced the 2026-08-25 alert.
    CONTAINER_ID=$(docker compose ps -aq "$svc" 2>/dev/null | head -1 || true)
    if [ -n "$CONTAINER_ID" ]; then
      RESTARTS=$(docker inspect --format='{{.RestartCount}}' "$CONTAINER_ID" 2>/dev/null || echo "0")
      if [[ "$RESTARTS" =~ ^[0-9]+$ ]] && [ "$RESTARTS" -gt 5 ]; then
        PROBLEMS="${PROBLEMS}Container '$svc' has restarted ${RESTARTS} times\n"
      fi
    fi
  done

  # 9. PostgreSQL in-place crash-restart (#9695). When a backend dies unexpectedly the
  # postmaster terminates every connection and re-runs WAL recovery INSIDE the running
  # container: RestartCount stays 0, the container never leaves "running", and recovery
  # finishes in seconds — fewer than the 5 failed probes the compose healthcheck needs —
  # so checks 1 and 3 are structurally blind to it (45 undetected occurrences on the
  # hosted server). The postmaster's reinitializing line is the one durable trace, and
  # the postgres json-file log window is small (10m x 3), so only a prompt reader — this
  # check — sees it at all. The count says "entries" on purpose: the "(N entries" rule in
  # the normalizer below already collapses it, so a crash sitting in the one-minute
  # overlap of two consecutive 6-min windows cannot re-mail as a new problem.
  if [ -n "$POSTGRES_SERVICE" ]; then
    PG_CONTAINER_ID=$(docker compose ps -aq "$POSTGRES_SERVICE" 2>/dev/null | head -1 || true)
    if [ -n "$PG_CONTAINER_ID" ]; then
      # 2>&1: postgres logs to stderr and `docker logs` keeps the streams apart.
      # Bounded like every other read under the flock.
      PG_CRASHES=$(timeout 10 docker logs --since 6m "$PG_CONTAINER_ID" 2>&1 |
        grep -c 'all server processes terminated; reinitializing' || true)
      if [[ "$PG_CRASHES" =~ ^[0-9]+$ ]] && [ "$PG_CRASHES" -gt 0 ]; then
        PROBLEMS="${PROBLEMS}PostgreSQL crash-restarted in place (${PG_CRASHES} entries in last 6 min)\n"
      fi
    fi
  fi

  # 6-8. Query the configured database from the app container so external
  # PostgreSQL deployments use the same DATABASE_URL and Prisma client as the app.
  if $DB_CONFIG_OK; then
    DB_PROBE_JS=$(cat <<'NODE'
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const maxQuerySeconds = Number(process.env.HEALTH_MAX_QUERY_SECONDS);

const readPoolLimit = () => {
  try {
    const values = new URL(process.env.DATABASE_URL ?? '').searchParams.getAll(
      'connection_limit',
    );
    if (values.length !== 1) return '';
    const [value] = values;
    const numericValue = Number(value);
    return value && /^\d+$/.test(value) && numericValue > 0 && Number.isSafeInteger(numericValue)
      ? String(numericValue)
      : '';
  } catch {
    return '';
  }
};

const main = async () => {
  console.log(`POOL_LIMIT=${readPoolLimit()}`);

  const { activity, indexes } = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 10000');
      const [activity] = await tx.$queryRawUnsafe(
        `WITH pool_sessions AS (
       SELECT CASE
         WHEN state = 'active' THEN now() - query_start
       END AS active_age,
       -- Long-running maintenance sessions are expected, so they must not page
       -- anyone -- but they still occupy a real backend, which is the resource
       -- the 2026-07-20 incident exhausted. Carrying the flag instead of
       -- filtering the CTE is what keeps them out of "longQueryCount"/"longest"
       -- while poolInUse below still counts every busy session.
       application_name NOT LIKE 'supersync-migrator-%'
         AND application_name <> 'supersync-monitor'
         -- The nightly pg_dump (scripts/backup.sh sets PGAPPNAME). A full dump
         -- legitimately runs for hours and is scheduled, so it would page every
         -- night forever -- an alert that fires on a timetable trains you to
         -- ignore the channel. It still counts toward poolInUse below, so a dump
         -- that actually starves the server is still caught.
         AND NOT (application_name = 'supersync-backup'
                  AND now() - query_start < interval '6 hours') AS pageable
       FROM pg_stat_activity
       WHERE state IN (
         'active',
         'idle in transaction',
         'idle in transaction (aborted)'
       )
         AND pid <> pg_backend_pid()
         AND backend_type = 'client backend'
         AND datname = current_database()
         AND usename = current_user
     )
     SELECT
       count(*) FILTER (
         WHERE pageable AND active_age > $1::integer * interval '1 second'
       )::integer AS "longQueryCount",
       COALESCE(round(extract(epoch FROM max(active_age) FILTER (WHERE pageable))), 0)::integer AS "longest",
       count(*)::integer AS "poolInUse"
     FROM pool_sessions`,
        maxQuerySeconds,
      );

      const [indexes] = await tx.$queryRawUnsafe(
        `SELECT COALESCE(
       string_agg(i.indexrelid::regclass::text, ', ' ORDER BY i.indexrelid),
       ''
     ) AS "badIndex"
     FROM pg_index i
     WHERE i.indrelid = 'operations'::regclass
       AND (NOT i.indisvalid OR NOT i.indisready OR NOT i.indislive)
       AND NOT EXISTS (
         SELECT 1
         FROM pg_stat_progress_create_index p
          WHERE p.index_relid = i.indexrelid
       )
       AND NOT EXISTS (
         SELECT 1
         FROM pg_stat_activity m
         JOIN pg_locks l
           ON l.pid = m.pid
          AND l.locktype = 'relation'
          AND l.relation = i.indexrelid
          AND l.mode = 'ShareUpdateExclusiveLock'
         WHERE m.datname = current_database()
           AND m.usename = current_user
           AND m.state = 'active'
           AND m.application_name LIKE 'supersync-migrator-%'
       )`,
      );

      return { activity, indexes };
    },
    { maxWait: 5000, timeout: 12000 },
  );

  console.log(`LONG_Q=${activity.longQueryCount}`);
  console.log(`LONGEST=${activity.longest}`);
  console.log(`POOL_IN_USE=${activity.poolInUse}`);
  console.log(`BAD_INDEX=${indexes.badIndex}`);
};

main()
  .catch((error) => {
    // Set the code first: a console.error that itself throws must not lose the failure
    // to the trailing .catch below.
    process.exitCode = 1;
    console.error(
      'Database probe failed:',
      error instanceof Error ? error.message : String(error),
    );
  })
  .finally(() => prisma.$disconnect())
  // Trailing, not inside .finally: .finally RETURNS its callback's promise, so anything
  // teardown throws becomes an unhandled rejection and exits 1 with a complete, healthy
  // sample already printed -- a database alert on a healthy database.
  .catch(() => {});
NODE
)

    # `</dev/null` is load-bearing: `docker compose exec -T` keeps stdin attached and does
    # not exit until EOF, so an inherited stdin leaves the $(...) capture hanging until -k
    # SIGKILLs it and compose's buffered stdout dies with it — a healthy server then reports
    # every probe key missing. Measured live: 25s/exit 137 without it, 1s/exit 0 with.
    # Allow Prisma's 5s pool wait plus its 12s transaction bound to finish.
    # stderr to a FILE, not 2>/dev/null and not a pipe. Discarding it is why an exit-1
    # probe — the one failure mode where Prisma DID report a cause — arrived as a bare
    # status with the only useful line already gone, and a database that was healthy every
    # time anyone went and looked. A pipe would be worse than either: command substitution
    # waits for EOF, so a child outliving `timeout` would hang the run while holding the
    # flock, which is the same trap send_alert_mail documents above. $DB_ERRFILE is set
    # next to the flock, with an EXIT trap; the redirect below truncates it every run, so a
    # file left by a killed run can never be read as if it were this run's output.
    DB_OUTPUT=$(timeout -k 5 20 docker compose exec -T \
      -e "HEALTH_MAX_QUERY_SECONDS=$MAX_QUERY_SECONDS" \
      supersync timeout 18 node -e "$DB_PROBE_JS" </dev/null 2>"$DB_ERRFILE")
    DB_STATUS=$?

    LONG_Q=""
    LONGEST=""
    POOL_IN_USE=""
    POOL_LIMIT=""
    BAD_IDX=""
    HAVE_LONG_Q=false
    HAVE_LONGEST=false
    HAVE_POOL_IN_USE=false
    HAVE_POOL_LIMIT=false
    HAVE_BAD_IDX=false
    while IFS='=' read -r KEY VALUE; do
      case "$KEY" in
        LONG_Q) LONG_Q="$VALUE"; HAVE_LONG_Q=true ;;
        LONGEST) LONGEST="$VALUE"; HAVE_LONGEST=true ;;
        POOL_IN_USE) POOL_IN_USE="$VALUE"; HAVE_POOL_IN_USE=true ;;
        POOL_LIMIT) POOL_LIMIT="$VALUE"; HAVE_POOL_LIMIT=true ;;
        BAD_INDEX) BAD_IDX="$VALUE"; HAVE_BAD_IDX=true ;;
      esac
    done <<< "$DB_OUTPUT"

    if $HAVE_POOL_LIMIT && ! [[ "$POOL_LIMIT" =~ ^[1-9][0-9]*$ ]]; then
      PROBLEMS="${PROBLEMS}DATABASE_URL has no valid connection_limit\n"
    fi

    DB_RESULTS_OK=true
    if [ "$DB_STATUS" -ne 0 ] || ! $HAVE_LONG_Q || ! $HAVE_LONGEST ||
      ! $HAVE_POOL_IN_USE || ! $HAVE_POOL_LIMIT || ! $HAVE_BAD_IDX ||
      ! [[ "$LONG_Q" =~ ^[0-9]+$ ]] ||
      ! [[ "$LONGEST" =~ ^[0-9]+$ ]] ||
      ! [[ "$POOL_IN_USE" =~ ^[0-9]+$ ]]; then
      DB_RESULTS_OK=false
      # The status separates a timeout or kill (124/137) from a broken exec (126/127), a
      # probe error (1) and incomplete output (0). Not the probe's stderr: PROBLEMS is the
      # dedupe hash input, so text that varies per run would re-alert every five minutes.
      # The stderr goes into the mail BODY instead, below.
      PROBLEMS="${PROBLEMS}Database monitoring checks failed (exit ${DB_STATUS})\n"
      # Read only on failure. Compose can print malformed datasource URLs containing
      # whitespace in credentials, so redact from ANY scheme through the end of its line.
      # Redact before truncating, so the byte limit cannot cut inside a credential.
      DB_PROBE_DETAIL=$(LC_ALL=C sed -E 's#[a-zA-Z][a-zA-Z0-9+.-]*://.*#<redacted-url>#' \
        "$DB_ERRFILE" 2>/dev/null | strip_control_chars "$DB_PROBE_ERR_MAX_BYTES")
      # Empty stderr is possible after a timeout, silent failure or malformed output.
      : "${DB_PROBE_DETAIL:=(no stderr captured)}"
    fi
    rm -f "$DB_ERRFILE"

    if $DB_RESULTS_OK; then
      if [ "$LONG_Q" -gt 0 ]; then
        PROBLEMS="${PROBLEMS}${LONG_Q} query(s) active longer than ${MAX_QUERY_SECONDS}s (longest: ${LONGEST}s)\n"
      fi

      if [[ "$POOL_LIMIT" =~ ^[1-9][0-9]*$ ]]; then
        PCT=$(( POOL_IN_USE * 100 / POOL_LIMIT ))
        if [ "$PCT" -ge "$POOL_WARN_PCT" ]; then
          # Page only when the pressure survives to the NEXT run. Every other check here
          # reports something already durable (a stopped container, a query past 120s, a
          # full disk); this one samples a gauge, and a single crossing is routinely a
          # stampede that self-heals within one interval — the morning of 2026-08-27 was
          # three fail+recovery pairs for exactly that (hourly-aligned client sync at
          # 04:00Z/06:00Z, the reconnect herd after a deploy restart at 07:00Z). Sustained
          # exhaustion — the 2026-07-20 incident — still pages, one interval later. The
          # marker only counts while fresh (three intervals), so a gap of three or more
          # intervals cannot weld two unrelated spikes into a "sustained" condition; a
          # SHORTER blind gap (probe failure between two spikes) still can, at the cost
          # of one bounded false pair — accepted. A pool-healthy run clears the marker,
          # mirroring CLEAN_RUN_SEEN_FILE on the recovery side.
          if [ -n "$(find "$POOL_PENDING_FILE" -mmin -15 2>/dev/null)" ]; then
            PROBLEMS="${PROBLEMS}Connection pool ${PCT}% busy (${POOL_IN_USE} of ${POOL_LIMIT} running a query or in a transaction)\n"
          fi
          touch "$POOL_PENDING_FILE"
        else
          rm -f "$POOL_PENDING_FILE"
        fi
      fi

      if [ -n "$BAD_IDX" ]; then
        PROBLEMS="${PROBLEMS}Invalid/unusable index(es) present: ${BAD_IDX}\n"
      fi
    fi
  fi
fi

# 2. Check for OOM kills via kernel log (docker OOMKilled flag resets on restart)
# Deliberately OUTSIDE the $DOCKER_OK gate: reading the kernel log needs no daemon, and a
# host that has just OOM-killed something is exactly when dockerd is least likely to
# answer -- gating this on Docker skipped the check in its own scenario. It also keeps the
# blind-marker lifecycle running while Docker is down, so deploy.sh cannot report a
# stale "BLIND since <onset>" the operator already fixed.
# For a cron user outside 'adm'/'systemd-journal' -- or on a host with no journalctl at
# all -- `journalctl -k` emits no kernel line and exits 0, so the count below is 0
# forever and the check silently never fires. Probe with an UNBOUNDED -n 1 first: a
# quiet 6-minute window is also empty, so the bounded query below cannot tell "no OOM"
# from "no access". (dmesg is no fallback: kernel.dmesg_restrict locks out the same
# users.) A blind check is a broken capability, not a health finding: it goes to the
# marker deploy.sh surfaces, NEVER to PROBLEMS -- same rule, and same reason, as the
# MAIL_AVAILABLE precedent above. PROBLEMS is the dedupe hash input and its emptiness
# gates the recovery mail, so a permanent entry there would kill "Health Check
# Recovered" forever on any host that simply lacks the group.
# `command -v` first, matching the MAIL_AVAILABLE probe above: an ABSENT journalctl and an
# UNREADABLE journal both yield empty output, but only one of them is the operator's to
# fix. On a non-systemd host (Alpine — and Dockerfile:60 ships scripts/ to self-hosters)
# there is no journal, no 'systemd-journal' group, and nothing to repair, so telling those
# operators to join a group forever is unactionable noise. Marker line 2 carries the
# reason, same shape as record_mail_failure, and deploy.sh picks the advice from it.
# Both branches write only on a TRANSITION: the condition is permanent, and cron mails
# every line of output -- an unconditional echo is 288 mails/day into the same inbox as
# the real alerts. A CHANGED reason counts as a transition, because the two get opposite
# advice from deploy.sh and a stale line 2 would keep withholding the actionable one; the
# onset in line 1 is carried over, which is what deploy.sh's "since" claims.
# Both reads are bounded for the same reason send_alert_mail and the db probe are: this
# runs under the flock, so a journalctl blocked on a corrupt or slow journal does not just
# lose the OOM check -- every later cron run finds the lock held and exits 0 silently,
# which is the "monitoring stopped and nobody noticed" failure this whole script exists to
# prevent. A journal that cannot answer in 10s is unreadable for our purposes anyway.
OOM_BLIND_REASON=""
if ! command -v "$JOURNAL_CMD" >/dev/null 2>&1; then
  OOM_BLIND_REASON="no-journalctl"
elif ! KERNEL_LOG=$(timeout 10 "$JOURNAL_CMD" -k -q -n 1 --no-pager 2>/dev/null); then
  # A failed or timed-out read is inconclusive, even if it printed some entries.
  OOM_BLIND_REASON="journal-error"
elif [ -z "$KERNEL_LOG" ]; then
  # -q suppresses journalctl's permissions hint. Check exact group names to avoid
  # recommending membership the user already has, but do not infer the host type:
  # empty output can also reflect journal configuration or host restrictions.
  if [ "$(id -u 2>/dev/null)" = "0" ] ||
    id -nG 2>/dev/null | grep -qE '(^|[[:space:]])(adm|systemd-journal|wheel)([[:space:]]|$)'; then
    OOM_BLIND_REASON="no-kernel-log"
  else
    OOM_BLIND_REASON="unreadable"
  fi
fi
if [ -n "$OOM_BLIND_REASON" ]; then
  PREVIOUS_REASON=""
  if [ -f "$OOM_BLIND_FILE" ]; then
    PREVIOUS_REASON=$(sed -n '2p' "$OOM_BLIND_FILE" 2>/dev/null || true)
  fi
  if [ "$PREVIOUS_REASON" != "$OOM_BLIND_REASON" ]; then
    if [ "$OOM_BLIND_REASON" = "no-journalctl" ]; then
      echo "health-alert: no journalctl on this host — OOM detection is unavailable (not a misconfiguration)." >&2
    elif [ "$OOM_BLIND_REASON" = "journal-error" ]; then
      echo "health-alert: failed to read the kernel log — OOM detection is blind. Check journalctl -k and journal configuration." >&2
    elif [ "$OOM_BLIND_REASON" = "no-kernel-log" ]; then
      echo "health-alert: no kernel log entries are available — OOM detection is unavailable. Check journal configuration and host kernel-log access." >&2
    else
      echo "health-alert: cannot read the kernel log — OOM detection is blind. Add the cron user to group 'systemd-journal' (or 'adm')." >&2
    fi
    ONSET=""
    if [ -n "$PREVIOUS_REASON" ]; then
      ONSET=$(sed -n '1p' "$OOM_BLIND_FILE" 2>/dev/null || true)
    fi
    {
      printf '%s\n' "${ONSET:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
      printf '%s\n' "$OOM_BLIND_REASON"
    } > "$OOM_BLIND_FILE"
  fi
else
  # rm -f, unguarded: it is already a no-op on a missing file, and `[ -f ] &&` would
  # make this line return 1 on the healthy path for no reason.
  rm -f "$OOM_BLIND_FILE"
  OOM_HITS=$(timeout 10 "$JOURNAL_CMD" -k --since "6 minutes ago" --no-pager 2>/dev/null \
    | grep -ciE "out of memory:|oom-kill:|oom_reaper:" || true)
  if [[ "$OOM_HITS" =~ ^[0-9]+$ ]] && [ "$OOM_HITS" -gt 0 ]; then
    PROBLEMS="${PROBLEMS}OOM kill detected in kernel log (${OOM_HITS} entries in last 6 min)\n"
  fi
fi

# 4. Check health endpoint (runs even if Docker is down — tests from outside)
# No `|| echo "000"`: curl WRITES the code and THEN exits non-zero -- so a fallback
# appended a SECOND value ("HTTP 000000" in the 2026-08-25 alert). No `-f` either: it
# leaves %{http_code} byte-identical and only sets the exit status nothing here reads,
# which is exactly what made the `|| echo` look reasonable. A failed connection already
# prints 000. The regex still earns its place for an absent or killed curl (no output).
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null)
if ! [[ "$HTTP_CODE" =~ ^[0-9]{3}$ ]]; then HTTP_CODE="000"; fi
if [ "$HTTP_CODE" != "200" ]; then
  PROBLEMS="${PROBLEMS}Health endpoint returned HTTP ${HTTP_CODE} (${HEALTH_URL})\n"
fi

# 5. Check disk usage
for mount_point in / /var/lib/docker; do
  if mountpoint -q "$mount_point" 2>/dev/null || [ "$mount_point" = "/" ]; then
    DISK_USAGE=$(df --output=pcent "$mount_point" 2>/dev/null | tail -1 | tr -d ' %' || true)
    if [[ "${DISK_USAGE:-0}" =~ ^[0-9]+$ ]] && [ "${DISK_USAGE:-0}" -gt 85 ]; then
      PROBLEMS="${PROBLEMS}Disk usage at ${DISK_USAGE}% on ${mount_point}\n"
    fi
  fi
done

# Normalize volatile data so the same issue is not re-reported. The `(exit N)` rule is
# deliberately generic: BOTH the container-state line ("exited (exit 137)") and the DB
# probe line ("checks failed (exit 124)") carry a code that rotates run to run under load
# — 124 timeout / 143 SIGTERM / 128 exec failure was the 2026-08-25 storm. The code stays
# in the MAIL BODY (that renders $PROBLEMS, not this), so the operator still sees which
# fault it was; it just must not reopen the alert. Trade-off accepted: a probe that shifts
# from 124 to 127 mid-incident does not re-mail until the incident ages out below.
NORMALIZED_PROBLEMS=$(printf '%b' "$PROBLEMS" | sed \
  's/restarted [0-9]* times/restarted N times/g
   s/([0-9]* entries/(N entries/g
   s/at [0-9]*% on/at N% on/g
   s/HTTP [0-9]*/HTTP NNN/g
   s/[0-9]* query(s) active longer than [0-9]*s (longest: [0-9]*s)/N query(s) active longer than Ns (longest: Ns)/g
   s/(exit [0-9]*)/(exit N)/g
   s/pool [0-9]*% busy ([0-9]* of [0-9]* running/pool N% busy (N of N running/g')

# Bound the incident. The state file below is cleared only by a recovery mail, and recovery
# needs PROBLEMS entirely empty — so ONE never-clearing check (disk stuck at 86%, a
# cumulative container restart count, an invalid index) would otherwise hold the incident
# open forever and permanently mute every symptom already mailed inside it. mtime is the
# right clock here: it advances whenever a NEW symptom is recorded, so a still-evolving
# incident keeps its memory and only a quiet one ages out and re-reports.
ALERT_MUTE_MINUTES=1440
if [ -n "$(find "$ALERT_STATE_FILE" -mmin +$ALERT_MUTE_MINUTES 2>/dev/null)" ]; then
  rm -f "$ALERT_STATE_FILE"
fi

if [ -n "$PROBLEMS" ]; then
  rm -f "$CLEAN_RUN_SEEN_FILE"
  # Keyed per PROBLEM LINE, not per problem SET. Hashing the whole set keys on its power
  # set: with symptoms A and B, "A", "A+B" and "B" are three independent entries, so a
  # flapping incident across k symptoms costs up to 2^k-1 mails — the same storm class,
  # one level up. Per line it is k. The normalized line IS the key, so there is no hash to
  # compute and the state file is readable when someone asks why a mail did not arrive.
  touch "$ALERT_STATE_FILE"
  NEW_PROBLEMS=$(printf '%s\n' "$NORMALIZED_PROBLEMS" | grep -vxF -f "$ALERT_STATE_FILE" || true)
  NEW_PROBLEMS=$(printf '%s' "$NEW_PROBLEMS" | sed '/^$/d')
  ALERT_IS_NEW=false
  [ -n "$NEW_PROBLEMS" ] && ALERT_IS_NEW=true

  # No minimum gap between mails on purpose: normalization above already collapses every
  # volatile field, so a line that is genuinely new means a symptom nobody has been told
  # about yet. A blanket rate cap would hold a disk-95% or OOM alert for half an hour
  # because an unrelated minor problem mailed first.
  if $MAIL_AVAILABLE && { $ALERT_IS_NEW || [ -f "$MAIL_FAILED_FILE" ]; }; then
    # New or changed problem — send alert, only write state if mail succeeds
    # Coverage caveat, deliberately NOT part of $PROBLEMS: a mail listing problems while one
    # check silently did not run overstates what was verified, but putting this in PROBLEMS
    # would make it permanent there and kill the recovery branch (see check 2). Appending to
    # the body leaves the dedupe keys and the recovery gate untouched.
    COVERAGE_NOTE=""
    if [ -f "$OOM_BLIND_FILE" ]; then
      COVERAGE_NOTE=$'\nNote: the OOM check did not run (kernel log unavailable), so an OOM kill\nwould not appear above. See scripts/MONITORING-README.md.\n'
    fi
    # Same reasoning as COVERAGE_NOTE: body only. It varies run to run by design — that is
    # the point of it — and PROBLEMS is the dedupe key, so putting it there would re-mail
    # the same incident on every flip of a Prisma error string.
    PROBE_DETAIL_NOTE=""
    if [ -n "$DB_PROBE_DETAIL" ]; then
      PROBE_DETAIL_NOTE=$'\nDatabase probe stderr (URLs redacted):\n'"$DB_PROBE_DETAIL"$'\n'
    fi
    if printf 'SuperSync health check failed at %s\n\nProblems found:\n%b\n%s%sServer: %s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PROBLEMS" "$PROBE_DETAIL_NOTE" "$COVERAGE_NOTE" \
        "$(hostname)" \
        | send_alert_mail "SuperSync Alert: Health Check Failed"; then
      # One line per distinct symptom, so growth is bounded by the check list, not by its
      # power set. Cleared on recovery and aged out above.
      if $ALERT_IS_NEW; then
        printf '%s\n' "$NEW_PROBLEMS" >> "$ALERT_STATE_FILE"
      fi
      rm -f "$MAIL_FAILED_FILE"
    else
      echo "ERROR: Failed to send alert email" >&2
    fi
  fi
else
  # Only meaningful while a recovery is pending; a healthy retry also proves mail works
  # again and clears a sticky failure marker.
  RECOVERED=false
  if [ -f "$ALERT_STATE_FILE" ] || [ -f "$MAIL_FAILED_FILE" ]; then
    if [ -f "$CLEAN_RUN_SEEN_FILE" ]; then
      RECOVERED=true
    else
      : > "$CLEAN_RUN_SEEN_FILE"
    fi
  fi

  if $MAIL_AVAILABLE && $RECOVERED; then
    if printf 'SuperSync health check recovered at %s\n\nAll checks passing.\nServer: %s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(hostname)" \
        | send_alert_mail "SuperSync OK: Health Check Recovered"; then
      rm -f "$ALERT_STATE_FILE" "$MAIL_FAILED_FILE" "$CLEAN_RUN_SEEN_FILE"
    else
      echo "ERROR: Failed to send recovery email" >&2
    fi
  fi
fi

# Record the last completed run for deploy-time monitoring verification.
date -u +%Y-%m-%dT%H:%M:%SZ > "$ALERT_STATE_DIR/last-run"

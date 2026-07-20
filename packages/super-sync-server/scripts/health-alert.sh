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
#   COMPOSE_DIR    - Path to docker-compose.yml directory (default: script directory's parent)
#   HEALTH_URL     - Health endpoint URL (default: read from .env DOMAIN)
#   MAX_QUERY_SECONDS  - Alert if any query has been active longer (default: 120)
#   POOL_WARN_PCT      - Alert if active backends exceed this % of the pool (default: 75)

# Do NOT use set -e — a monitoring script must never silently abort.
set -uo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$(dirname "$SCRIPT_DIR")}"
ALERT_EMAIL="${ALERT_EMAIL:-contact@super-productivity.com}"
MAX_QUERY_SECONDS="${MAX_QUERY_SECONDS:-120}"
POOL_WARN_PCT="${POOL_WARN_PCT:-75}"

if [ ! -f "$COMPOSE_DIR/docker-compose.yml" ]; then
  echo "ERROR: $COMPOSE_DIR does not contain docker-compose.yml" >&2
  exit 1
fi

# State file in project-local directory (not /tmp — avoids symlink attacks and tmp cleanup)
ALERT_STATE_DIR="${COMPOSE_DIR}/.health-alert"
mkdir -p "$ALERT_STATE_DIR"
ALERT_STATE_FILE="$ALERT_STATE_DIR/state"

# Prevent concurrent runs (cron overlap if a previous run hangs)
LOCK_FILE="$ALERT_STATE_DIR/health-alert.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

cd "$COMPOSE_DIR"

# Load domain from .env
DOMAIN=""
if [ -f ".env" ]; then
  DOMAIN=$(grep -E '^DOMAIN=' ".env" 2>/dev/null | cut -d'=' -f2 | tr -d "\"' " || true)
fi
HEALTH_URL="${HEALTH_URL:-https://${DOMAIN:-localhost}/health}"

PROBLEMS=""
DOCKER_OK=true

# 0. Check Docker daemon is accessible
if ! docker info >/dev/null 2>&1; then
  PROBLEMS="${PROBLEMS}Docker daemon is not running or not accessible!\n"
  DOCKER_OK=false
fi

if $DOCKER_OK; then
  # 1. Check if all containers are running and healthy
  SERVICES=(supersync postgres caddy)
  for svc in "${SERVICES[@]}"; do
    STATE=$(docker compose ps --format '{{.State}}' "$svc" 2>/dev/null || echo "missing")
    HEALTH=$(docker compose ps --format '{{.Health}}' "$svc" 2>/dev/null || echo "")
    # Guard against "<no value>" from older Docker Compose versions
    if [ "$HEALTH" = "<no value>" ]; then HEALTH=""; fi

    if [ "$STATE" != "running" ]; then
      PROBLEMS="${PROBLEMS}Container '$svc' state: ${STATE}\n"
    elif [ -n "$HEALTH" ] && [ "$HEALTH" != "healthy" ]; then
      PROBLEMS="${PROBLEMS}Container '$svc' health: ${HEALTH}\n"
    fi
  done

  # 2. Check for OOM kills via kernel log (docker OOMKilled flag resets on restart)
  OOM_HITS=$(journalctl -k --since "6 minutes ago" --no-pager 2>/dev/null \
    | grep -ciE "out of memory:|oom-kill:|oom_reaper:" || true)
  if [[ "$OOM_HITS" =~ ^[0-9]+$ ]] && [ "$OOM_HITS" -gt 0 ]; then
    PROBLEMS="${PROBLEMS}OOM kill detected in kernel log (${OOM_HITS} entries in last 6 min)\n"
  fi

  # 3. Check restart counts
  # Note: RestartCount is cumulative over the container's lifetime. It only resets on
  # docker compose down/up or --force-recreate. Threshold of 5 avoids false positives
  # from normal deploy restarts.
  for svc in "${SERVICES[@]}"; do
    CONTAINER_ID=$(docker compose ps -q "$svc" 2>/dev/null | head -1 || true)
    if [ -n "$CONTAINER_ID" ]; then
      RESTARTS=$(docker inspect --format='{{.RestartCount}}' "$CONTAINER_ID" 2>/dev/null || echo "0")
      if [[ "$RESTARTS" =~ ^[0-9]+$ ]] && [ "$RESTARTS" -gt 5 ]; then
        PROBLEMS="${PROBLEMS}Container '$svc' has restarted ${RESTARTS} times\n"
      fi
    fi
  done

  # --- Database-level checks (#9191) ---------------------------------------
  #
  # Checks 1-5 are all liveness: is the process up, is the endpoint answering.
  # They cannot see the failure mode that caused the 2026-07-20 outage and the
  # two operations-table pool incidents before it, where every container stayed
  # "running" and healthy while a degenerate query plan held connections until
  # the pool was empty. That failure is bistable — below the capacity line
  # nothing is visibly wrong, above it everything fails at once — so there is no
  # gradual phase to notice. These three checks look at the pool directly.
  #
  # Best-effort by design: a failed psql must never mask checks 0-5, so every
  # query falls back to empty and is skipped rather than alerting.
  PG_ID=$(docker compose ps -q postgres 2>/dev/null | head -1 || true)
  if [ -n "$PG_ID" ]; then
    DB_USER=$(grep -E '^POSTGRES_USER=' ".env" 2>/dev/null | cut -d'=' -f2 | tr -d "\"' " || true)
    DB_NAME=$(grep -E '^POSTGRES_DB=' ".env" 2>/dev/null | cut -d'=' -f2 | tr -d "\"' " || true)
    DB_USER="${DB_USER:-supersync}"
    DB_NAME="${DB_NAME:-supersync}"

    pg_query() {
      timeout 15 docker exec "$PG_ID" \
        psql -U "$DB_USER" -d "$DB_NAME" -tAX -c "$1" 2>/dev/null | tr -d ' ' || true
    }

    # 6. Long-running queries. statement_timeout should cap these at 60s, so
    # anything past MAX_QUERY_SECONDS means the guardrail is absent, overridden,
    # or the session is exempt (the migrator legitimately is). Excludes idle
    # backends and this script's own query.
    LONG_Q=$(pg_query "
      SELECT count(*) FROM pg_stat_activity
      WHERE state = 'active' AND pid <> pg_backend_pid()
        AND backend_type = 'client backend'
        AND now() - query_start > interval '${MAX_QUERY_SECONDS} seconds';")
    if [[ "$LONG_Q" =~ ^[0-9]+$ ]] && [ "$LONG_Q" -gt 0 ]; then
      LONGEST=$(pg_query "
        SELECT round(extract(epoch FROM max(now() - query_start)))
        FROM pg_stat_activity
        WHERE state = 'active' AND pid <> pg_backend_pid()
          AND backend_type = 'client backend';")
      PROBLEMS="${PROBLEMS}${LONG_Q} query(s) active longer than ${MAX_QUERY_SECONDS}s (longest: ${LONGEST:-?}s)\n"
    fi

    # 7. Pool saturation, as a RATIO against the app's connection_limit rather
    # than a fixed number: measured steady state (~0.75 downloads/sec) sits the
    # same order of magnitude below the pathological-query ceiling (pool size ÷
    # worst-case query duration), so the absolute margin is thin and a fixed
    # threshold would not survive a pool resize.
    #
    # Read connection_limit from the RUNNING container's env, not from .env: the
    # limit may come from the compose default instead, and .env may hold a stale
    # value the container was not recreated for. Falling back to max_connections
    # would silently under-report — with a pool of 60 against max_connections
    # 120, a fully exhausted pool measures 50% and never alerts.
    APP_ID=$(docker compose ps -q supersync 2>/dev/null | head -1 || true)
    POOL_LIMIT=""
    if [ -n "$APP_ID" ]; then
      POOL_LIMIT=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$APP_ID" 2>/dev/null |
        grep -m1 '^DATABASE_URL=' | grep -oE 'connection_limit=[0-9]+' | cut -d'=' -f2 || true)
    fi
    if ! [[ "${POOL_LIMIT:-}" =~ ^[0-9]+$ ]]; then
      # No explicit limit: Prisma defaults to host_cores * 2 + 1 (read from HOST
      # cores, not the container cpu limit), which is unknowable from here. Report
      # against max_connections and say so, rather than skipping the check.
      POOL_LIMIT=$(pg_query "SHOW max_connections;")
      POOL_LIMIT_NOTE=" — no connection_limit set, measured against max_connections"
    fi
    ACTIVE=$(pg_query "
      SELECT count(*) FROM pg_stat_activity
      WHERE state = 'active' AND pid <> pg_backend_pid()
        AND backend_type = 'client backend';")
    if [[ "${ACTIVE:-}" =~ ^[0-9]+$ ]] && [[ "${POOL_LIMIT:-}" =~ ^[0-9]+$ ]] && [ "$POOL_LIMIT" -gt 0 ]; then
      PCT=$(( ACTIVE * 100 / POOL_LIMIT ))
      if [ "$PCT" -ge "$POOL_WARN_PCT" ]; then
        PROBLEMS="${PROBLEMS}Connection pool ${PCT}% saturated (${ACTIVE} active / ${POOL_LIMIT} limit)${POOL_LIMIT_NOTE:-}\n"
      fi
    fi

    # 8. Invalid indexes. An interrupted CREATE INDEX CONCURRENTLY leaves an
    # index that is unusable for reads but STILL maintained on every insert, and
    # nothing else in the codebase reports it. If operations_entity_ids_gin were
    # the invalid one, the conflict lookup's array branch would silently degrade
    # to a sequential scan on every upload — worse than the outage this check
    # exists to catch, and permanent until someone reindexes. indisready and
    # indislive are the other two partial states the same interruption leaves.
    BAD_IDX=$(pg_query "
      SELECT string_agg(indexrelid::regclass::text, ', ')
      FROM pg_index
      WHERE (NOT indisvalid OR NOT indisready OR NOT indislive)
        AND indrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace);")
    if [ -n "${BAD_IDX:-}" ]; then
      PROBLEMS="${PROBLEMS}Invalid/unusable index(es) present: ${BAD_IDX}\n"
    fi
  fi
fi

# 4. Check health endpoint (runs even if Docker is down — tests from outside)
HTTP_CODE=$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")
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

# Normalize volatile data before hashing to prevent repeated alerts for the same issue
HASH_INPUT=$(printf '%s' "$PROBLEMS" | sed \
  's/restarted [0-9]* times/restarted N times/g
   s/([0-9]* entries/(N entries/g
   s/at [0-9]*% on/at N% on/g
   s/HTTP [0-9]*/HTTP NNN/g
   s/[0-9]* query(s) active longer than [0-9]*s (longest: [0-9?]*s)/N query(s) active longer than Ns (longest: Ns)/g
   s/pool [0-9]*% saturated ([0-9]* active \/ [0-9]* limit)/pool N% saturated (N active \/ N limit)/g')
CURRENT_HASH=$(printf '%s' "$HASH_INPUT" | sha256sum | cut -d' ' -f1)
PREVIOUS_HASH=$(cat "$ALERT_STATE_FILE" 2>/dev/null || echo "none")

if [ -n "$PROBLEMS" ]; then
  if [ "$CURRENT_HASH" != "$PREVIOUS_HASH" ]; then
    # New or changed problem — send alert, only write state if mail succeeds
    if printf 'SuperSync health check failed at %s\n\nProblems found:\n%b\nServer: %s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PROBLEMS" "$(hostname)" \
        | timeout 30 mail -s "SuperSync Alert: Health Check Failed" "$ALERT_EMAIL" 2>/dev/null; then
      echo "$CURRENT_HASH" > "$ALERT_STATE_FILE"
      rm -f "$ALERT_STATE_DIR/mail-failed"
    else
      # A failing alert path is indistinguishable from a healthy system: stderr
      # from cron goes to the local mail spool, which is exactly what is broken
      # when mail is broken. Leave a marker deploy.sh can surface instead. (#9191)
      echo "ERROR: Failed to send alert email" >&2
      date -u +%Y-%m-%dT%H:%M:%SZ > "$ALERT_STATE_DIR/mail-failed"
    fi
  fi
else
  # All clear — send recovery notification, only delete state if mail succeeds.
  # Also runs when only the mail-failed marker is present: a failed alert send
  # leaves no state file, so without this the marker (and deploy.sh's warning)
  # would survive every later healthy run and never clear. Retrying here doubles
  # as the proof that delivery works again.
  if [ -f "$ALERT_STATE_FILE" ] || [ -f "$ALERT_STATE_DIR/mail-failed" ]; then
    if printf 'SuperSync health check recovered at %s\n\nAll checks passing.\nServer: %s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(hostname)" \
        | timeout 30 mail -s "SuperSync OK: Health Check Recovered" "$ALERT_EMAIL" 2>/dev/null; then
      rm -f "$ALERT_STATE_FILE"
      rm -f "$ALERT_STATE_DIR/mail-failed"
    else
      echo "ERROR: Failed to send recovery email" >&2
      date -u +%Y-%m-%dT%H:%M:%SZ > "$ALERT_STATE_DIR/mail-failed"
    fi
  fi
fi

# Record last successful run for monitoring verification
date -u +%Y-%m-%dT%H:%M:%SZ > "$ALERT_STATE_DIR/last-run"

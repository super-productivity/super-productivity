#!/bin/bash
# SuperSync Server Deployment Script
#
# Usage:
#   ./scripts/deploy.sh [--build]
#
# This script:
#   1. Validates Caddyfile syntax
#   2. Pulls latest image from GHCR (or builds locally with --build)
#   3. Applies database migrations before replacing the app container
#   4. Restarts containers and waits for health checks
#
# Options:
#   --build    Build locally instead of pulling from registry

set -euo pipefail
shopt -s inherit_errexit 2>/dev/null || true

# Check required dependencies
for cmd in docker curl git; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: Required command '$cmd' not found"
        exit 1
    fi
done

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"

# Get domain from .env file
DOMAIN=""
if [ -f "$SERVER_DIR/.env" ]; then
    DOMAIN=$(grep -E '^DOMAIN=' "$SERVER_DIR/.env" | cut -d'=' -f2- | tr -d '"'"'" || true)
fi

if [ -z "$DOMAIN" ]; then
    echo "Warning: DOMAIN not set in .env, using localhost for health check"
    HEALTH_URL="http://localhost:1900/health"
else
    HEALTH_URL="https://$DOMAIN/health"
fi

# Parse arguments
BUILD_LOCAL=false
if [ "${1:-}" = "--build" ]; then
    BUILD_LOCAL=true
fi

echo "==> SuperSync Deployment"
echo "    Server dir: $SERVER_DIR"
echo "    Health URL: $HEALTH_URL"
echo ""

cd "$SERVER_DIR"

# Pull latest code (scripts, docker-compose.yml, etc.)
echo "==> Pulling latest code..."
git pull --ff-only || { echo "WARNING: git pull failed — continuing with current files"; }
echo ""

# Load deploy-script settings from .env when they were not already exported.
load_env_value() {
    local key="$1"
    local line

    if [ -n "${!key+x}" ] || [ ! -f ".env" ]; then
        return
    fi

    line=$(grep -E "^${key}=" ".env" 2>/dev/null | tail -n 1 || true)
    if [ -z "$line" ]; then
        return
    fi

    local value="${line#*=}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    export "$key=$value"
}

for env_key in GHCR_USER GHCR_TOKEN DATABASE_URL POSTGRES_SERVICE POSTGRES_WAIT_TIMEOUT MIGRATION_TIMEOUT DEPLOY_WAIT_TIMEOUT; do
    load_env_value "$env_key"
done

# Login to GHCR if credentials provided
if [ -n "${GHCR_TOKEN:-}" ] && [ -n "${GHCR_USER:-}" ]; then
    echo "==> Logging in to GHCR..."
    echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
    echo ""
fi

# Check if monitoring compose exists and include it
COMPOSE_FILES="-f docker-compose.yml"
if [ -f "docker-compose.monitoring.yml" ]; then
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.monitoring.yml"
fi

# Validate Caddyfile syntax before deploying
CADDY_IMAGE=$(grep 'image:.*caddy:' docker-compose.yml | head -1 | awk '{print $2}' | tr -d '"'"'" || true)
if [ -z "$CADDY_IMAGE" ]; then
    echo "ERROR: Could not determine Caddy image from docker-compose.yml"
    exit 1
fi
echo "==> Validating Caddyfile (using $CADDY_IMAGE)..."
if ! docker run --rm -e "DOMAIN=${DOMAIN}" \
    -v "$SERVER_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" \
    "$CADDY_IMAGE" caddy validate --config /etc/caddy/Caddyfile 2>&1; then
    echo ""
    echo "==> Caddyfile validation failed! Fix the errors above before deploying."
    exit 1
fi
echo ""

if [ "$BUILD_LOCAL" = true ]; then
    # Local build mode
    echo "==> Building locally..."
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.build.yml"
    docker compose $COMPOSE_FILES build
else
    # Pull from registry (default)
    echo "==> Pulling latest image..."
    docker compose $COMPOSE_FILES pull supersync
fi

# Run migrations before replacing the app container. This keeps the currently
# running app available while online index builds run, and it fails the deploy
# before the app is restarted if Prisma cannot apply a migration.
POSTGRES_WAIT_TIMEOUT="${POSTGRES_WAIT_TIMEOUT:-60}"
POSTGRES_SERVICE="${POSTGRES_SERVICE-postgres}"
if [ "$POSTGRES_SERVICE" = "postgres" ] && [[ "${DATABASE_URL:-}" == *@db:5432/* ]]; then
    export DATABASE_URL="${DATABASE_URL/@db:5432/@postgres:5432}"
    echo "==> Rewriting legacy bundled DATABASE_URL host db to postgres for this deploy"
fi
echo ""
if [ -n "$POSTGRES_SERVICE" ]; then
    echo "==> Ensuring $POSTGRES_SERVICE is running (wait timeout: ${POSTGRES_WAIT_TIMEOUT}s)..."
    docker compose $COMPOSE_FILES up -d --wait --wait-timeout "$POSTGRES_WAIT_TIMEOUT" "$POSTGRES_SERVICE"
else
    echo "==> Skipping compose database startup (POSTGRES_SERVICE is empty)..."
fi

echo ""
# `CREATE INDEX CONCURRENTLY` migrations can block on long-running transactions
# for arbitrarily long. Wrap the migrator with a timeout so a stuck deploy fails
# loudly instead of hanging this script forever. Exit code 124 = timed out.
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-900}"
MIGRATOR_RUN="docker compose $COMPOSE_FILES run --rm --no-deps --interactive=false -T supersync"
FULL_STATE_INDEX_MIGRATION="20260512000000_add_full_state_sequence_index_drop_redundant_indexes"
ENCRYPTED_OPS_INDEX_MIGRATION="20260514000000_add_encrypted_ops_partial_index"
PAYLOAD_BYTES_INDEX_MIGRATION="20260514000002_add_payload_bytes_unbackfilled_index"
echo "==> Verifying database connectivity from the supersync image..."
set +e
timeout "$POSTGRES_WAIT_TIMEOUT" \
    $MIGRATOR_RUN sh -ec 'printf "SELECT 1;" | npx prisma db execute --schema prisma/schema.prisma --stdin > /dev/null'
DB_CHECK_STATUS=$?
set -e
if [ "$DB_CHECK_STATUS" -eq 124 ]; then
    echo ""
    echo "ERROR: database connectivity check timed out after ${POSTGRES_WAIT_TIMEOUT}s."
    echo "       Check DATABASE_URL and the compose Postgres service health."
    exit 1
fi
if [ "$DB_CHECK_STATUS" -ne 0 ]; then
    echo ""
    echo "ERROR: database connectivity check failed (exit $DB_CHECK_STATUS)."
    echo "       Check DATABASE_URL. For the bundled database, leave it unset or use postgres:5432."
    exit "$DB_CHECK_STATUS"
fi
echo "    Database reachable"
echo ""
echo "==> Applying database migrations before app restart (timeout: ${MIGRATION_TIMEOUT}s)..."

MIGRATE_LOG=""
MIGRATE_STATUS=0

run_migrate_deploy() {
    MIGRATE_LOG="$(mktemp "${TMPDIR:-/tmp}/supersync-migrate.XXXXXX")"
    set +e
    timeout "$MIGRATION_TIMEOUT" \
        $MIGRATOR_RUN sh -ec 'echo "    Migrator container started"; npx prisma migrate deploy' 2>&1 | tee "$MIGRATE_LOG"
    MIGRATE_STATUS=${PIPESTATUS[0]}
    set -e
}

is_recoverable_full_state_index_migration_failure() {
    [ -n "$MIGRATE_LOG" ] &&
        grep -q 'P3009' "$MIGRATE_LOG" &&
        grep -q "$FULL_STATE_INDEX_MIGRATION" "$MIGRATE_LOG"
}

is_full_state_index_transaction_block_failure() {
    [ -n "$MIGRATE_LOG" ] &&
        grep -q 'P3018' "$MIGRATE_LOG" &&
        grep -q "$FULL_STATE_INDEX_MIGRATION" "$MIGRATE_LOG" &&
        grep -q 'cannot run inside a transaction block' "$MIGRATE_LOG"
}

is_recoverable_encrypted_ops_index_migration_failure() {
    [ -n "$MIGRATE_LOG" ] &&
        grep -q 'P3009' "$MIGRATE_LOG" &&
        grep -q "$ENCRYPTED_OPS_INDEX_MIGRATION" "$MIGRATE_LOG"
}

is_encrypted_ops_index_transaction_block_failure() {
    [ -n "$MIGRATE_LOG" ] &&
        grep -q 'P3018' "$MIGRATE_LOG" &&
        grep -q "$ENCRYPTED_OPS_INDEX_MIGRATION" "$MIGRATE_LOG" &&
        grep -q 'cannot run inside a transaction block' "$MIGRATE_LOG"
}

is_recoverable_payload_bytes_index_migration_failure() {
    [ -n "$MIGRATE_LOG" ] &&
        grep -q 'P3009' "$MIGRATE_LOG" &&
        grep -q "$PAYLOAD_BYTES_INDEX_MIGRATION" "$MIGRATE_LOG"
}

is_payload_bytes_index_transaction_block_failure() {
    [ -n "$MIGRATE_LOG" ] &&
        grep -q 'P3018' "$MIGRATE_LOG" &&
        grep -q "$PAYLOAD_BYTES_INDEX_MIGRATION" "$MIGRATE_LOG" &&
        grep -q 'cannot run inside a transaction block' "$MIGRATE_LOG"
}

run_concurrent_index_sql() {
    local sql="$1"
    local execute_status

    set +e
    # Use the same supersync container and DATABASE_URL as `migrate deploy`.
    # This avoids marking the Prisma migration applied in one database after
    # running the out-of-band index SQL against another.
    printf '%s\n' "$sql" | timeout "$MIGRATION_TIMEOUT" \
        $MIGRATOR_RUN sh -ec 'npx prisma db execute --schema prisma/schema.prisma --stdin'
    execute_status=${PIPESTATUS[1]}
    set -e

    if [ "$execute_status" -eq 124 ]; then
        echo ""
        echo "ERROR: concurrent index SQL timed out after ${MIGRATION_TIMEOUT}s."
        echo "       A long-running transaction may be blocking CREATE/DROP INDEX CONCURRENTLY."
        exit 1
    fi
    if [ "$execute_status" -ne 0 ]; then
        echo ""
        echo "ERROR: concurrent index SQL failed (exit $execute_status)."
        exit "$execute_status"
    fi
}

apply_full_state_index_migration_outside_prisma() {
    echo ""
    echo "==> Applying $FULL_STATE_INDEX_MIGRATION outside Prisma migrate..."
    echo "    Prisma cannot run this multi-statement CONCURRENTLY migration in one transaction block."

    run_concurrent_index_sql 'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_full_state_server_seq_idx";'
    run_concurrent_index_sql "CREATE INDEX CONCURRENTLY \"operations_user_id_full_state_server_seq_idx\" ON \"operations\"(\"user_id\", \"server_seq\") WHERE \"op_type\" IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR');"
    run_concurrent_index_sql 'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_op_type_idx";'
    run_concurrent_index_sql 'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_entity_type_entity_id_idx";'
    run_concurrent_index_sql 'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_idx";'
}

apply_encrypted_ops_index_migration_outside_prisma() {
    echo ""
    echo "==> Applying $ENCRYPTED_OPS_INDEX_MIGRATION outside Prisma migrate..."
    echo "    Prisma cannot run CREATE INDEX CONCURRENTLY in a transaction block."

    run_concurrent_index_sql 'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_encrypted_idx";'
    run_concurrent_index_sql 'CREATE INDEX CONCURRENTLY "operations_user_id_server_seq_encrypted_idx" ON "operations"("user_id", "server_seq") WHERE "is_payload_encrypted" = true;'
}

apply_payload_bytes_index_migration_outside_prisma() {
    echo ""
    echo "==> Applying $PAYLOAD_BYTES_INDEX_MIGRATION outside Prisma migrate..."
    echo "    Prisma cannot run CREATE INDEX CONCURRENTLY in a transaction block."

    run_concurrent_index_sql 'DROP INDEX CONCURRENTLY IF EXISTS "operations_payload_bytes_unbackfilled_idx";'
    run_concurrent_index_sql 'CREATE INDEX CONCURRENTLY "operations_payload_bytes_unbackfilled_idx" ON "operations"("user_id", "id") WHERE "payload_bytes" = 0;'
}

resolve_failed_full_state_index_migration() {
    local resolve_status

    echo ""
    echo "==> Resolving failed index-only migration $FULL_STATE_INDEX_MIGRATION..."
    echo "    Marking it rolled back so Prisma can retry the idempotent migration SQL."
    set +e
    timeout "$POSTGRES_WAIT_TIMEOUT" \
        $MIGRATOR_RUN npx prisma migrate resolve --rolled-back "$FULL_STATE_INDEX_MIGRATION"
    resolve_status=$?
    set -e

    if [ "$resolve_status" -eq 124 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve timed out after ${POSTGRES_WAIT_TIMEOUT}s."
        exit 1
    fi
    if [ "$resolve_status" -ne 0 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve failed (exit $resolve_status)."
        exit "$resolve_status"
    fi
}

resolve_failed_encrypted_ops_index_migration() {
    local resolve_status

    echo ""
    echo "==> Resolving failed index-only migration $ENCRYPTED_OPS_INDEX_MIGRATION..."
    echo "    Marking it rolled back so Prisma can retry the migration SQL."
    set +e
    timeout "$POSTGRES_WAIT_TIMEOUT" \
        $MIGRATOR_RUN npx prisma migrate resolve --rolled-back "$ENCRYPTED_OPS_INDEX_MIGRATION"
    resolve_status=$?
    set -e

    if [ "$resolve_status" -eq 124 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve timed out after ${POSTGRES_WAIT_TIMEOUT}s."
        exit 1
    fi
    if [ "$resolve_status" -ne 0 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve failed (exit $resolve_status)."
        exit "$resolve_status"
    fi
}

resolve_applied_full_state_index_migration() {
    local resolve_status

    echo ""
    echo "==> Marking $FULL_STATE_INDEX_MIGRATION as applied after out-of-band SQL..."
    set +e
    timeout "$POSTGRES_WAIT_TIMEOUT" \
        $MIGRATOR_RUN npx prisma migrate resolve --applied "$FULL_STATE_INDEX_MIGRATION"
    resolve_status=$?
    set -e

    if [ "$resolve_status" -eq 124 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve --applied timed out after ${POSTGRES_WAIT_TIMEOUT}s."
        exit 1
    fi
    if [ "$resolve_status" -ne 0 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve --applied failed (exit $resolve_status)."
        exit "$resolve_status"
    fi
}

resolve_applied_encrypted_ops_index_migration() {
    local resolve_status

    echo ""
    echo "==> Marking $ENCRYPTED_OPS_INDEX_MIGRATION as applied after out-of-band SQL..."
    set +e
    timeout "$POSTGRES_WAIT_TIMEOUT" \
        $MIGRATOR_RUN npx prisma migrate resolve --applied "$ENCRYPTED_OPS_INDEX_MIGRATION"
    resolve_status=$?
    set -e

    if [ "$resolve_status" -eq 124 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve --applied timed out after ${POSTGRES_WAIT_TIMEOUT}s."
        exit 1
    fi
    if [ "$resolve_status" -ne 0 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve --applied failed (exit $resolve_status)."
        exit "$resolve_status"
    fi
}

resolve_failed_payload_bytes_index_migration() {
    local resolve_status

    echo ""
    echo "==> Resolving failed index-only migration $PAYLOAD_BYTES_INDEX_MIGRATION..."
    echo "    Marking it rolled back so Prisma can retry the migration SQL."
    set +e
    timeout "$POSTGRES_WAIT_TIMEOUT" \
        $MIGRATOR_RUN npx prisma migrate resolve --rolled-back "$PAYLOAD_BYTES_INDEX_MIGRATION"
    resolve_status=$?
    set -e

    if [ "$resolve_status" -eq 124 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve timed out after ${POSTGRES_WAIT_TIMEOUT}s."
        exit 1
    fi
    if [ "$resolve_status" -ne 0 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve failed (exit $resolve_status)."
        exit "$resolve_status"
    fi
}

resolve_applied_payload_bytes_index_migration() {
    local resolve_status

    echo ""
    echo "==> Marking $PAYLOAD_BYTES_INDEX_MIGRATION as applied after out-of-band SQL..."
    set +e
    timeout "$POSTGRES_WAIT_TIMEOUT" \
        $MIGRATOR_RUN npx prisma migrate resolve --applied "$PAYLOAD_BYTES_INDEX_MIGRATION"
    resolve_status=$?
    set -e

    if [ "$resolve_status" -eq 124 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve --applied timed out after ${POSTGRES_WAIT_TIMEOUT}s."
        exit 1
    fi
    if [ "$resolve_status" -ne 0 ]; then
        echo ""
        echo "ERROR: prisma migrate resolve --applied failed (exit $resolve_status)."
        exit "$resolve_status"
    fi
}

run_migrate_deploy
if [ "$MIGRATE_STATUS" -ne 0 ] && [ "$MIGRATE_STATUS" -ne 124 ] &&
    is_recoverable_full_state_index_migration_failure; then
    resolve_failed_full_state_index_migration
    echo ""
    echo "==> Retrying database migrations after resolving $FULL_STATE_INDEX_MIGRATION..."
    run_migrate_deploy
fi
if [ "$MIGRATE_STATUS" -ne 0 ] && [ "$MIGRATE_STATUS" -ne 124 ] &&
    is_full_state_index_transaction_block_failure; then
    apply_full_state_index_migration_outside_prisma
    resolve_applied_full_state_index_migration
    echo ""
    echo "==> Retrying database migrations after applying $FULL_STATE_INDEX_MIGRATION..."
    run_migrate_deploy
fi
if [ "$MIGRATE_STATUS" -ne 0 ] && [ "$MIGRATE_STATUS" -ne 124 ] &&
    is_recoverable_encrypted_ops_index_migration_failure; then
    resolve_failed_encrypted_ops_index_migration
    apply_encrypted_ops_index_migration_outside_prisma
    resolve_applied_encrypted_ops_index_migration
    echo ""
    echo "==> Retrying database migrations after applying $ENCRYPTED_OPS_INDEX_MIGRATION..."
    run_migrate_deploy
fi
if [ "$MIGRATE_STATUS" -ne 0 ] && [ "$MIGRATE_STATUS" -ne 124 ] &&
    is_encrypted_ops_index_transaction_block_failure; then
    apply_encrypted_ops_index_migration_outside_prisma
    resolve_applied_encrypted_ops_index_migration
    echo ""
    echo "==> Retrying database migrations after applying $ENCRYPTED_OPS_INDEX_MIGRATION..."
    run_migrate_deploy
fi
if [ "$MIGRATE_STATUS" -ne 0 ] && [ "$MIGRATE_STATUS" -ne 124 ] &&
    is_recoverable_payload_bytes_index_migration_failure; then
    resolve_failed_payload_bytes_index_migration
    apply_payload_bytes_index_migration_outside_prisma
    resolve_applied_payload_bytes_index_migration
    echo ""
    echo "==> Retrying database migrations after applying $PAYLOAD_BYTES_INDEX_MIGRATION..."
    run_migrate_deploy
fi
if [ "$MIGRATE_STATUS" -ne 0 ] && [ "$MIGRATE_STATUS" -ne 124 ] &&
    is_payload_bytes_index_transaction_block_failure; then
    apply_payload_bytes_index_migration_outside_prisma
    resolve_applied_payload_bytes_index_migration
    echo ""
    echo "==> Retrying database migrations after applying $PAYLOAD_BYTES_INDEX_MIGRATION..."
    run_migrate_deploy
fi

if [ "$MIGRATE_STATUS" -eq 124 ]; then
    echo ""
    echo "ERROR: prisma migrate deploy timed out after ${MIGRATION_TIMEOUT}s."
    echo "       A long-running transaction may be blocking CREATE INDEX CONCURRENTLY."
    echo "       Raise MIGRATION_TIMEOUT or re-run once the blocker clears."
    exit 1
fi
if [ "$MIGRATE_STATUS" -ne 0 ]; then
    echo ""
    echo "ERROR: prisma migrate deploy failed (exit $MIGRATE_STATUS)."
    exit "$MIGRATE_STATUS"
fi

# The migration above already ran while the old app was still serving. Disable
# startup migrations for this compose update so the replacement app starts
# immediately after image creation. Direct docker-compose users keep the image
# default unless they also set RUN_MIGRATIONS_ON_STARTUP=false.
export RUN_MIGRATIONS_ON_STARTUP="${RUN_MIGRATIONS_ON_STARTUP:-false}"

# Start containers and wait for all health checks. Online index migrations should
# already be applied, but the longer timeout still covers slow image starts and
# no-op migration checks in the app container entrypoint.
WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-900}"
echo ""
echo "==> Starting containers (wait timeout: ${WAIT_TIMEOUT}s)..."
START_STATUS=0
if [ -n "$POSTGRES_SERVICE" ]; then
    START_RESULT=$(docker compose $COMPOSE_FILES up -d --wait --wait-timeout "$WAIT_TIMEOUT" 2>&1) || START_STATUS=$?
else
    START_RESULT=$(docker compose $COMPOSE_FILES up -d --wait --wait-timeout "$WAIT_TIMEOUT" --no-deps supersync caddy 2>&1) || START_STATUS=$?
fi
if [ "${START_STATUS:-0}" -ne 0 ]; then
    echo "$START_RESULT"
    echo ""
    echo "==> Container startup failed!"

    # Show status of non-running containers — best-effort under pipefail so
    # the script still reaches `exit 1` when this diagnostic block fails.
    echo "    Container status:"
    {
        docker compose $COMPOSE_FILES ps --format '{{.Name}}\t{{.Service}}\t{{.State}}' | while IFS=$'\t' read -r NAME SERVICE STATE; do
            if [ -n "$STATE" ] && [ "$STATE" != "running" ]; then
                echo "      $NAME ($STATE)"
                echo ""
                docker compose $COMPOSE_FILES logs --tail=10 "$SERVICE" 2>/dev/null || true
            fi
        done
    } || true
    exit 1
fi
echo "$START_RESULT"
echo "    All containers healthy"

# Verify HTTPS health check
echo ""
echo "==> Verifying HTTPS health check..."
for i in {1..6}; do
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        echo ""
        echo "==> Deployment successful!"
        echo "    Service is healthy at $HEALTH_URL"
        exit 0
    fi
    echo "    Waiting... (attempt $i/6)"
    sleep 5
done

echo ""
echo "==> Health check failed!"
echo "    Recent logs:"
docker compose $COMPOSE_FILES logs --tail=30
exit 1

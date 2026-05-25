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
DEPLOY_SCRIPT_FILE="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
SCRIPT_BEFORE_HASH=""
if [ -z "${SUPER_SYNC_DEPLOY_REEXECED:-}" ]; then
    SCRIPT_BEFORE_HASH="$(git hash-object "$DEPLOY_SCRIPT_FILE" 2>/dev/null || true)"
fi
echo "==> Pulling latest code..."
git pull --ff-only || { echo "WARNING: git pull failed — continuing with current files"; }
if [ -z "${SUPER_SYNC_DEPLOY_REEXECED:-}" ] && [ -n "$SCRIPT_BEFORE_HASH" ]; then
    SCRIPT_AFTER_HASH="$(git hash-object "$DEPLOY_SCRIPT_FILE" 2>/dev/null || true)"
    if [ -n "$SCRIPT_AFTER_HASH" ] && [ "$SCRIPT_BEFORE_HASH" != "$SCRIPT_AFTER_HASH" ]; then
        echo ""
        echo "==> deploy.sh updated by git pull; re-executing the new version..."
        export SUPER_SYNC_DEPLOY_REEXECED=1
        exec "$DEPLOY_SCRIPT_FILE" "$@"
    fi
fi
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

for env_key in GHCR_USER GHCR_TOKEN DATABASE_URL POSTGRES_SERVICE POSTGRES_WAIT_TIMEOUT MIGRATION_TIMEOUT DEPLOY_WAIT_TIMEOUT SUPERSYNC_SKIP_IMAGE_REVISION_CHECK; do
    load_env_value "$env_key"
done

if [ "${SUPERSYNC_SKIP_IMAGE_REVISION_CHECK:-}" != "true" ] && ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required to read the supersync image from docker compose config."
    echo "       Install jq, or set SUPERSYNC_SKIP_IMAGE_REVISION_CHECK=true for a deliberate manual override."
    exit 1
fi

supersync_image_source_revision() {
    local revision

    revision="$(git log -1 --format=%H -- \
        ../../.dockerignore \
        ../../.github/workflows/supersync-docker.yml \
        ../../package.json \
        ../../package-lock.json \
        ../shared-schema \
        ../sync-core \
        . 2>/dev/null || true)"
    if [ -n "$revision" ]; then
        printf '%s\n' "$revision"
        return
    fi

    git rev-parse HEAD 2>/dev/null || true
}

assert_clean_supersync_image_inputs() {
    local untracked_files

    if ! git diff --quiet -- \
        ../../.dockerignore \
        ../../.github/workflows/supersync-docker.yml \
        ../../package.json \
        ../../package-lock.json \
        ../shared-schema \
        ../sync-core \
        . ||
        ! git diff --cached --quiet -- \
            ../../.dockerignore \
            ../../.github/workflows/supersync-docker.yml \
            ../../package.json \
            ../../package-lock.json \
            ../shared-schema \
            ../sync-core \
            .; then
        echo ""
        echo "ERROR: Refusing to build a labeled supersync image from dirty tracked input files."
        echo "       Commit or stash changes under packages/super-sync-server,"
        echo "       packages/sync-core, packages/shared-schema, package*.json, or"
        echo "       .dockerignore/.github/workflows/supersync-docker.yml before running --build."
        exit 1
    fi

    untracked_files="$(git ls-files --others --exclude-standard -- \
        ../../.dockerignore \
        ../../.github/workflows/supersync-docker.yml \
        ../../package.json \
        ../../package-lock.json \
        ../shared-schema \
        ../sync-core \
        . 2>/dev/null || true)"
    if [ -n "$untracked_files" ]; then
        echo ""
        echo "ERROR: Refusing to build a labeled supersync image with untracked input files."
        echo "       Commit, stash, remove, or ignore these files first:"
        printf '%s\n' "$untracked_files" | sed 's/^/       - /'
        exit 1
    fi
}

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
    assert_clean_supersync_image_inputs
    export SUPERSYNC_BUILD_SHA="$(supersync_image_source_revision)"
    docker compose $COMPOSE_FILES build
else
    # Pull from registry (default)
    echo "==> Pulling latest image..."
    docker compose $COMPOSE_FILES pull supersync
fi

verify_supersync_image_revision() {
    if [ "${SUPERSYNC_SKIP_IMAGE_REVISION_CHECK:-}" = "true" ]; then
        echo "==> Skipping image revision check (SUPERSYNC_SKIP_IMAGE_REVISION_CHECK=true)"
        return
    fi

    local compose_config_json expected_revision image_ref image_revision

    expected_revision="$(supersync_image_source_revision)"
    if [ -z "$expected_revision" ]; then
        echo "WARNING: Could not determine expected supersync image revision; skipping image revision check"
        return
    fi

    compose_config_json="$(docker compose $COMPOSE_FILES config --format json 2>/dev/null || true)"
    if [ -z "$compose_config_json" ]; then
        echo ""
        echo "ERROR: docker compose config --format json failed."
        echo "       Upgrade Docker Compose, or set SUPERSYNC_SKIP_IMAGE_REVISION_CHECK=true"
        echo "       for a deliberate manual override."
        exit 1
    fi

    image_ref="$(printf '%s\n' "$compose_config_json" | jq -r '.services.supersync.image // empty' 2>/dev/null || true)"
    if [ -z "$image_ref" ]; then
        echo ""
        echo "ERROR: Could not determine the supersync image from docker compose config JSON."
        exit 1
    fi

    image_revision="$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_ref" 2>/dev/null || true)"
    if [ -z "$image_revision" ] || [ "$image_revision" = "<no value>" ] || [ "$image_revision" = "unknown" ]; then
        echo ""
        echo "ERROR: The supersync image has no git revision label."
        echo "       It may be stale relative to the checked-out deploy scripts."
        echo "       Build and push the current image, or run ./scripts/deploy.sh --build."
        exit 1
    fi

    if [ "$image_revision" != "$expected_revision" ]; then
        echo ""
        echo "ERROR: The supersync image revision does not match the expected source revision."
        echo "       image: $image_revision"
        echo "       code:  $expected_revision"
        echo "       Wait for the GHCR image build to finish, build/push the current image,"
        echo "       or run ./scripts/deploy.sh --build."
        exit 1
    fi

    echo "==> Verified supersync image revision: ${image_revision:0:12}"
}

verify_supersync_image_revision

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

# Migration application + recovery lives in the in-image scripts/migrate-deploy.sh
# so it is always version-locked to prisma/migrations in the pulled image (a
# stale host deploy.sh can no longer skip a new CONCURRENTLY migration's
# recovery). The host only owns the timeout + exit-code policy here.
MIGRATE_STATUS=0
set +e
timeout "$MIGRATION_TIMEOUT" \
    $MIGRATOR_RUN sh -ec 'echo "    Migrator container started"; sh scripts/migrate-deploy.sh'
MIGRATE_STATUS=$?
set -e

if [ "$MIGRATE_STATUS" -eq 124 ]; then
    echo ""
    echo "ERROR: prisma migrate deploy timed out after ${MIGRATION_TIMEOUT}s."
    echo "       A long-running transaction may be blocking CREATE INDEX CONCURRENTLY."
    echo "       Raise MIGRATION_TIMEOUT or re-run once the blocker clears."
    exit 1
fi
if [ "$MIGRATE_STATUS" -ne 0 ]; then
    echo ""
    echo "ERROR: database migrations failed (exit $MIGRATE_STATUS)."
    echo "       scripts/migrate-deploy.sh prints exact manual recovery steps"
    echo "       above for any migration it cannot safely auto-recover."
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

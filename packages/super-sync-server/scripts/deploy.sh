#!/bin/bash
# SuperSync Server Deployment Script
#
# Usage:
#   ./scripts/deploy.sh [--build]
#
# This script:
#   1. Pulls latest image from GHCR (or builds locally with --build)
#   2. Restarts containers
#   3. Verifies health check passes
#
# Options:
#   --build    Build locally instead of pulling from registry

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"

# Get domain from .env file
if [ -f "$SERVER_DIR/.env" ]; then
    DOMAIN=$(grep -E '^DOMAIN=' "$SERVER_DIR/.env" | cut -d'=' -f2)
fi

if [ -z "$DOMAIN" ]; then
    echo "Warning: DOMAIN not set in .env, using localhost for health check"
    HEALTH_URL="http://localhost:1900/health"
else
    HEALTH_URL="https://$DOMAIN/health"
fi

# Parse arguments
BUILD_LOCAL=false
if [ "$1" = "--build" ]; then
    BUILD_LOCAL=true
fi

echo "==> SuperSync Deployment"
echo "    Server dir: $SERVER_DIR"
echo "    Health URL: $HEALTH_URL"
echo ""

cd "$SERVER_DIR"

# Load GHCR credentials from .env (for private images)
if [ -f ".env" ]; then
    export $(grep -E '^(GHCR_USER|GHCR_TOKEN)=' ".env" 2>/dev/null | xargs)
fi

# Login to GHCR if credentials provided
if [ -n "$GHCR_TOKEN" ] && [ -n "$GHCR_USER" ]; then
    echo "==> Logging in to GHCR..."
    echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
    echo ""
fi

# Check if monitoring compose exists and include it
COMPOSE_FILES="-f docker-compose.yml"
if [ -f "docker-compose.monitoring.yml" ]; then
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.monitoring.yml"
fi

if [ "$BUILD_LOCAL" = true ]; then
    # Local build mode
    echo "==> Building locally..."
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.build.yml"
    docker compose $COMPOSE_FILES up -d --build
else
    # Pull from registry (default)
    echo "==> Pulling latest image..."
    docker compose $COMPOSE_FILES pull supersync

    echo ""
    echo "==> Restarting containers..."
    docker compose $COMPOSE_FILES up -d
fi

# Wait for health check
echo ""
echo "==> Waiting for service to be healthy..."
sleep 5

# Retry health check up to 6 times (30 seconds total)
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
docker compose logs --tail=30 supersync
exit 1

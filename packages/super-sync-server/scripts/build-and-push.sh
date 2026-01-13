#!/bin/bash
# SuperSync Server - Build and Push to GitHub Container Registry
#
# Usage:
#   ./scripts/build-and-push.sh [TAG]
#
# Examples:
#   ./scripts/build-and-push.sh          # Pushes as :latest
#   ./scripts/build-and-push.sh v1.0.0   # Pushes as :v1.0.0 and :latest
#
# Prerequisites:
#   Add to .env file:
#     GHCR_USER=your-github-username
#     GHCR_TOKEN=your-github-token

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$SERVER_DIR")")"
DOCKERFILE="$SERVER_DIR/Dockerfile"

# Load .env file
if [ -f "$SERVER_DIR/.env" ]; then
    export $(grep -E '^(GHCR_USER|GHCR_TOKEN)=' "$SERVER_DIR/.env" | xargs)
fi

# Configuration
GITHUB_USER="${GHCR_USER:-johannesjo}"
GHCR_TOKEN="${GHCR_TOKEN:-}"
IMAGE_NAME="ghcr.io/$GITHUB_USER/supersync"

# Parse tag argument
TAG="${1:-latest}"

echo "==> SuperSync Build & Push"
echo "    Image: $IMAGE_NAME:$TAG"
echo "    Repo:  $REPO_ROOT"
echo ""

# Step 1: Build image
echo "==> Building image..."
docker build \
    -t "$IMAGE_NAME:$TAG" \
    -t "$IMAGE_NAME:latest" \
    -f "$DOCKERFILE" \
    "$REPO_ROOT"

echo ""
echo "==> Build complete!"
echo ""

# Step 2: Login to GHCR (if token provided)
if [ -n "$GHCR_TOKEN" ]; then
    echo "==> Logging in to GHCR..."
    echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin
    echo ""
fi

# Step 3: Push to registry
echo "==> Pushing to GHCR..."
docker push "$IMAGE_NAME:$TAG"

if [ "$TAG" != "latest" ]; then
    docker push "$IMAGE_NAME:latest"
fi

echo ""
echo "==> Done!"
echo "    Pushed: $IMAGE_NAME:$TAG"
echo ""
echo "    To deploy on server, run:"
echo "    ./scripts/deploy.sh"

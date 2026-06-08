#!/bin/bash
# SuperSync Server - Build and Push to GitHub Container Registry
#
# Usage:
#   ./scripts/build-and-push.sh [TAG] [--no-cache]
#
# Examples:
#   ./scripts/build-and-push.sh                # Pushes as :latest
#   ./scripts/build-and-push.sh v1.0.0         # Pushes as :v1.0.0 and :latest
#   ./scripts/build-and-push.sh --no-cache     # Pushes as :latest without cache
#   ./scripts/build-and-push.sh v1.0.0 --no-cache  # With version tag and no cache
#
# Prerequisites:
#   Add to .env file:
#     GHCR_USER=your-github-username   # GitHub account used to log in to GHCR
#     GHCR_TOKEN=your-github-token
#   Optional:
#     GHCR_NAMESPACE=super-productivity  # image owner; defaults to the org

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$SERVER_DIR")")"
DOCKERFILE="$SERVER_DIR/Dockerfile"

# Load .env file
if [ -f "$SERVER_DIR/.env" ]; then
    export $(grep -E '^(GHCR_USER|GHCR_TOKEN|GHCR_NAMESPACE)=' "$SERVER_DIR/.env" | xargs)
fi

# Configuration
# Publish under the super-productivity org namespace to match the CI workflow
# (.github/workflows/supersync-docker.yml), docker-compose.yml and the Helm
# chart. Override GHCR_NAMESPACE only when pushing to a fork/personal registry.
GHCR_NAMESPACE="${GHCR_NAMESPACE:-super-productivity}"
# GHCR login user: a GitHub *account* with write access to the namespace's
# packages (you cannot authenticate as an org). Required only when pushing.
GITHUB_USER="${GHCR_USER:-}"
GHCR_TOKEN="${GHCR_TOKEN:-}"
IMAGE_NAME="ghcr.io/$GHCR_NAMESPACE/supersync"

supersync_image_source_revision() {
    git -C "$REPO_ROOT" log -1 --format=%H -- \
        .dockerignore \
        .github/workflows/supersync-docker.yml \
        package.json \
        package-lock.json \
        packages/shared-schema \
        packages/sync-core \
        packages/super-sync-server 2>/dev/null ||
        git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null ||
        echo unknown
}

assert_clean_supersync_image_inputs() {
    local untracked_files

    if ! git -C "$REPO_ROOT" diff --quiet -- \
        .dockerignore \
        .github/workflows/supersync-docker.yml \
        package.json \
        package-lock.json \
        packages/shared-schema \
        packages/sync-core \
        packages/super-sync-server ||
        ! git -C "$REPO_ROOT" diff --cached --quiet -- \
            .dockerignore \
            .github/workflows/supersync-docker.yml \
            package.json \
            package-lock.json \
            packages/shared-schema \
            packages/sync-core \
            packages/super-sync-server; then
        echo ""
        echo "ERROR: Refusing to build a labeled supersync image from dirty tracked input files."
        echo "       Commit or stash changes under packages/super-sync-server,"
        echo "       packages/sync-core, packages/shared-schema, package*.json, or"
        echo "       .dockerignore/.github/workflows/supersync-docker.yml before building."
        exit 1
    fi

    untracked_files="$(git -C "$REPO_ROOT" ls-files --others --exclude-standard -- \
        .dockerignore \
        .github/workflows/supersync-docker.yml \
        package.json \
        package-lock.json \
        packages/shared-schema \
        packages/sync-core \
        packages/super-sync-server 2>/dev/null || true)"
    if [ -n "$untracked_files" ]; then
        echo ""
        echo "ERROR: Refusing to build a labeled supersync image with untracked input files."
        echo "       Commit, stash, remove, or ignore these files first:"
        printf '%s\n' "$untracked_files" | sed 's/^/       - /'
        exit 1
    fi
}

assert_clean_supersync_image_inputs
VCS_REF="$(supersync_image_source_revision)"

# Parse arguments
TAG="latest"
BUILD_NO_CACHE=false

for arg in "$@"; do
    if [ "$arg" = "--no-cache" ]; then
        BUILD_NO_CACHE=true
    elif [ "${arg:0:1}" != "-" ]; then
        TAG="$arg"
    fi
done

echo "==> SuperSync Build & Push"
echo "    Image: $IMAGE_NAME:$TAG"
echo "    Repo:  $REPO_ROOT"
echo ""

# Step 1: Build image
echo "==> Building image..."
if [ "$BUILD_NO_CACHE" = true ]; then
    echo "    Using --no-cache flag to prevent layer caching"
    docker build --no-cache \
        --build-arg "VCS_REF=$VCS_REF" \
        -t "$IMAGE_NAME:$TAG" \
        -t "$IMAGE_NAME:latest" \
        -f "$DOCKERFILE" \
        "$REPO_ROOT"
else
    docker build \
        --build-arg "VCS_REF=$VCS_REF" \
        -t "$IMAGE_NAME:$TAG" \
        -t "$IMAGE_NAME:latest" \
        -f "$DOCKERFILE" \
        "$REPO_ROOT"
fi

echo ""
echo "==> Build complete!"
echo ""

# Step 2: Login to GHCR (if token provided)
if [ -n "$GHCR_TOKEN" ]; then
    if [ -z "$GITHUB_USER" ]; then
        echo "ERROR: GHCR_TOKEN is set but GHCR_USER is empty." >&2
        echo "       Set GHCR_USER to the GitHub account used to authenticate to GHCR." >&2
        exit 1
    fi
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

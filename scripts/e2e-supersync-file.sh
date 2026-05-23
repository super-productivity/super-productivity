#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: npm run e2e:supersync:file -- <spec-file> [playwright args...]" >&2
  exit 2
fi

COMPOSE_FILES=(-f docker-compose.yaml -f docker-compose.supersync.yaml)

cleanup() {
  local exit_code=$?
  docker compose "${COMPOSE_FILES[@]}" down supersync
  exit "$exit_code"
}
trap cleanup EXIT

docker compose "${COMPOSE_FILES[@]}" up -d --build supersync
./scripts/wait-for-supersync.sh

E2E_REQUIRE_SUPERSYNC=true E2E_VERBOSE=true npx playwright test \
  --config e2e/playwright.config.ts \
  --reporter=list \
  --workers=3 \
  "$@"

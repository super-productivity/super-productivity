#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILES=(-f docker-compose.yaml -f docker-compose.supersync.yaml)

cleanup() {
  local exit_code=$?
  docker compose "${COMPOSE_FILES[@]}" down supersync
  exit "$exit_code"
}
trap cleanup EXIT

docker compose "${COMPOSE_FILES[@]}" up -d --build supersync
./scripts/wait-for-supersync.sh

E2E_REQUIRE_SUPERSYNC=true npm run e2e:all -- --grep @supersync --workers=3 "$@"

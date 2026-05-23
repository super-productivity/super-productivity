#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  local exit_code=$?
  docker compose down
  exit "$exit_code"
}
trap cleanup EXIT

docker compose up -d webdav
./scripts/wait-for-webdav.sh

E2E_REQUIRE_WEBDAV=true npm run e2e:all -- --grep @webdav "$@"

#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: npm run e2e:webdav:file -- <spec-file> [playwright args...]" >&2
  exit 2
fi

cleanup() {
  local exit_code=$?
  docker compose down
  exit "$exit_code"
}
trap cleanup EXIT

docker compose up -d webdav
./scripts/wait-for-webdav.sh

E2E_REQUIRE_WEBDAV=true E2E_VERBOSE=true npx playwright test \
  --config e2e/playwright.config.ts \
  --reporter=list \
  "$@"

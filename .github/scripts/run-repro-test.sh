#!/usr/bin/env bash
# Runs one E2E spec for .github/workflows/issue-reproduce.yml with a minimal,
# credential-free environment. The spec is Node code the agent wrote from
# attacker-authored issue text, so it must not be able to read the Claude
# OAuth token, the job token or any other runner secret from process.env.
# Allowlist rather than unset: a new secret in the job must not leak by default.
set -euo pipefail
exec env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  CI=true \
  LANG=C.UTF-8 \
  TMPDIR="${TMPDIR:-/tmp}" \
  npm run e2e:file "$@"

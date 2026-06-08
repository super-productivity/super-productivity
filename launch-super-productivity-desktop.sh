#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.local-test-logs"
NG_LOG="$LOG_DIR/ng-serve.log"
NPM_LOG="$LOG_DIR/npm-ci.log"
ENV_LOG="$LOG_DIR/env.log"
ELECTRON_BUILD_LOG="$LOG_DIR/electron-build.log"
mkdir -p "$LOG_DIR"
cd "$ROOT_DIR"

say() { printf '\n%s\n' "$*"; }

have_cmd() { command -v "$1" >/dev/null 2>&1; }

port_4200_open() {
  if have_cmd curl; then
    curl -fsS "http://127.0.0.1:4200" >/dev/null 2>&1
  elif have_cmd python3; then
    python3 - <<'PY' >/dev/null 2>&1
import socket
s = socket.socket()
s.settimeout(0.5)
s.connect(('127.0.0.1', 4200))
s.close()
PY
  else
    return 1
  fi
}

fail() {
  say "FAILED: $*"
  if [[ -f "$NG_LOG" ]]; then
    say "Last Angular log lines:"
    tail -80 "$NG_LOG" || true
  fi
  if [[ -f "$NPM_LOG" ]]; then
    say "Last npm install log lines:"
    tail -40 "$NPM_LOG" || true
  fi
  if [[ -f "$ELECTRON_BUILD_LOG" ]]; then
    say "Last Electron build log lines:"
    tail -40 "$ELECTRON_BUILD_LOG" || true
  fi
  exit 1
}

wait_for_frontend() {
  local tries=120
  local i=0
  while (( i < tries )); do
    if port_4200_open; then
      return 0
    fi

    if [[ -f "$NG_LOG" ]] && grep -E "Application bundle generation failed|✘ \[ERROR\]|\[ERROR\]" "$NG_LOG" >/dev/null 2>&1; then
      return 1
    fi
    sleep 1
    ((i++))
  done
  return 1
}

say "Super Productivity desktop launcher"
say "Folder: $ROOT_DIR"

if ! have_cmd npm; then
  fail "npm is not installed or not in PATH. Install Node/npm first. Tiny dependency troll; unavoidable."
fi

if [[ ! -d node_modules ]]; then
  say "Installing npm dependencies once. Output is going to: $NPM_LOG"
  HUSKY=0 npm ci --no-audit --no-fund --progress=false >"$NPM_LOG" 2>&1 || fail "npm ci failed"
else
  say "node_modules exists, skipping npm ci. Good. No package-installing goblin today."
fi

say "Generating local env file. Log: $ENV_LOG"
npm run env >"$ENV_LOG" 2>&1 || fail "env generation failed"

if port_4200_open; then
  fail "port 4200 is already in use. Close the old Super Productivity test terminal first, or run: pkill -f 'ng serve.*4200'"
fi

# Kill background Angular server on exit.
NG_PID=""
cleanup() {
  if [[ -n "$NG_PID" ]] && kill -0 "$NG_PID" >/dev/null 2>&1; then
    kill "$NG_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

say "Starting Angular dev server in the background. Log: $NG_LOG"
: >"$NG_LOG"
./node_modules/.bin/ng serve --host 127.0.0.1 --port 4200 >"$NG_LOG" 2>&1 &
NG_PID=$!

say "Waiting for local app server..."
wait_for_frontend || fail "Angular dev server did not become ready"

say "Building Electron shell. Log: $ELECTRON_BUILD_LOG"
: >"$ELECTRON_BUILD_LOG"
npm run electron:build >"$ELECTRON_BUILD_LOG" 2>&1 || fail "Electron build failed"

say "Launching Super Productivity desktop window. No browser tab."
say "Close the Super Productivity window to stop this launcher."
NODE_ENV=DEV ./node_modules/.bin/electron .

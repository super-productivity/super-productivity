#!/usr/bin/env bash
# Asserts that a built .snap ships electron-builder's maintained desktop-common.sh.
# patches/app-builder-lib+*.patch swaps it in for the 2019 template copy, whose
# unguarded XDG migration aborts every launch after the first when an XDG dir is
# a symlink to an empty dir (#10576). A failed or dropped patch still builds
# green, so CI checks the payload. Needs unsquashfs (squashfs-tools).
set -euo pipefail

SNAP_FILE="${1:?usage: assert-snap-xdg-guard.sh <file.snap>}"
SCRIPT="$(mktemp)"
trap 'rm -f "$SCRIPT"' EXIT

unsquashfs -cat "$SNAP_FILE" desktop-common.sh > "$SCRIPT"
grep -A1 -F '[ -L "$old" ]' "$SCRIPT" \
  | grep -qF 'is_subpath "$old" "$SNAP_USER_DATA"' || {
  echo "::error::desktop-common.sh lacks the is_subpath guard -- the app-builder-lib patch was not applied (#10576)"
  exit 1
}

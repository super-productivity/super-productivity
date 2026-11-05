#!/usr/bin/env bash
# Asserts that a built .snap is a core24 package with the gpu-2404 content
# plug that clears the Mesa ABI drift on Snap+Wayland (#5672,
# docs/research/snap-wayland-gpu-fix-research.md).
#
# Replaces tools/assert-snap-xdg-guard.sh for core24 builds: that check targeted
# the core22 template's desktop-common.sh (#10576), which SnapCore24 does not
# ship. Needs unsquashfs (squashfs-tools).
set -euo pipefail

SNAP_FILE="${1:?usage: assert-snap-core24.sh <file.snap>}"
META="$(mktemp)"
trap 'rm -f "$META"' EXIT

unsquashfs -cat "$SNAP_FILE" meta/snap.yaml > "$META"

grep -Eq '^base:[[:space:]]*core24[[:space:]]*$' "$META" || {
  echo "::error::meta/snap.yaml base is not core24 — SnapCore24 was not selected"
  exit 1
}

# The GNOME extension declares gpu-2404 (default-provider mesa-2404). Accept
# either the plug name or the provider so a future rename still fails loudly
# only when both are gone.
if ! grep -Eq 'gpu-2404|mesa-2404' "$META"; then
  echo "::error::meta/snap.yaml lacks gpu-2404/mesa-2404 — Wayland Mesa fix not wired"
  exit 1
fi

if ! grep -Eq 'gnome-46-2404' "$META"; then
  echo "::error::meta/snap.yaml lacks gnome-46-2404 — GNOME extension content snap missing"
  exit 1
fi

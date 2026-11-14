#!/usr/bin/env bash
# Asserts that a built .snap is a core24 package with the gpu-2404 content
# plug that clears the Mesa ABI drift on Snap+Wayland (#5672,
# docs/research/snap-wayland-gpu-fix-research.md), and that the app still
# declares the plugs an explicit `plugs:` list can otherwise drop.
#
# Replaces the core22 template check (desktop-common.sh / #10576), which
# SnapCore24 does not ship. Needs unsquashfs (squashfs-tools).
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

# Explicit `plugs:` replaces electron-builder's defaults. Without `- default`,
# home / network disappear even though GNOME still adds desktop / wayland /
# x11. Match YAML list entries so a comment mentioning "home" cannot pass.
for plug in home network browser-support; do
  grep -Eq "^[[:space:]]+-[[:space:]]+${plug}([[:space:]]|$)" "$META" || {
    echo "::error::meta/snap.yaml lacks plug '${plug}' — restore \`- default\` / browser-support"
    exit 1
  }
done

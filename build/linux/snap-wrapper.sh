#!/bin/sh
# Pre-Electron argv wrapper for Super Productivity on Linux.
#
# Forces --ozone-platform=x11 when launched inside *our* Snap sandbox on a
# Wayland session. This is load-bearing: the programmatic
# app.commandLine.appendSwitch('ozone-platform','x11') in electron/start-app.ts
# is not enough in practice — field reports on issue #7270 show Chromium's
# Ozone init dlopens libEGL/libgbm on the core22 Mesa path before
# appendSwitch is honored, which segfaults under host-vs-snap Mesa ABI
# drift. Putting the flag into argv before Electron's argv parser runs
# bypasses that.
#
# Same mechanism used by Signal Desktop and Mattermost Desktop snaps
# (snapcrafters/signal-desktop, snapcrafters/mattermost-desktop).
#
# Non-Snap launches (AppImage, .deb, .rpm) hit the passthrough branch so
# behavior for those targets is unchanged. The SNAP_NAME gate also protects
# .deb/.rpm installs invoked via xdg-open from *another* snap (where $SNAP
# leaks into the child env).
#
# See docs/research/snap-wayland-gpu-fix-research.md §18.

# Derive the real ELF path. Inside our snap confinement, $SNAP is the
# revision mount root and is more reliable than $0 resolution through
# snapd's wrapper chain. Elsewhere, resolve $0 through symlinks — this
# handles /usr/bin/superproductivity symlinks from .deb/.rpm installs.
if [ -n "$SNAP" ] && [ "$SNAP_NAME" = "superproductivity" ]; then
  IS_OUR_SNAP=1
  BIN_DIR="$SNAP"
else
  IS_OUR_SNAP=
  SELF=$(readlink -f "$0" 2>/dev/null || echo "$0")
  BIN_DIR=$(dirname "$SELF")
fi
BIN="$BIN_DIR/superproductivity-bin"

# If the user already supplied --ozone-platform on argv, don't override.
# Stop scanning at -- so positional args aren't misread as flags.
for arg in "$@"; do
  case "$arg" in
    --) break ;;
    --ozone-platform=* | --ozone-platform) exec "$BIN" "$@" ;;
  esac
done

if [ -n "$IS_OUR_SNAP" ] && { [ "$XDG_SESSION_TYPE" = "wayland" ] || [ -n "$WAYLAND_DISPLAY" ]; }; then
  exec "$BIN" --ozone-platform=x11 "$@"
fi

exec "$BIN" "$@"

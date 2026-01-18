#!/bin/bash
# Wrapper to launch the Super Productivity build
# This uses the unpacked binary to avoid FUSE issues on Arch/CachyOS

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
EXEC_PATH="$DIR/.tmp/app-builds/linux-unpacked/superproductivity"

echo "Launching Super Productivity from: $EXEC_PATH"
"$EXEC_PATH" "$@" &

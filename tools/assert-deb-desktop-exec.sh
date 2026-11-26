#!/usr/bin/env bash
# Asserts that a built .deb's desktop entry launches the spaceless /usr/bin link.
# patches/app-builder-lib+*.patch replaces electron-builder's quoted
# "/opt/Super Productivity/superproductivity" Exec, which xdg-open discards as a
# handler, so superproductivity:// URLs opened the browser (#11117). A failed or
# dropped patch still builds green, so CI checks the payload.
set -euo pipefail

DEB_FILE="${1:?usage: assert-deb-desktop-exec.sh <file.deb>}"
EXPECTED='Exec=/usr/bin/superproductivity %U'

dpkg-deb --fsys-tarfile "$DEB_FILE" \
  | tar -xO ./usr/share/applications/superproductivity.desktop \
  | grep -qxF "$EXPECTED" || {
  echo "::error::.deb desktop entry lacks '$EXPECTED' -- the app-builder-lib patch was not applied (#11117)"
  exit 1
}

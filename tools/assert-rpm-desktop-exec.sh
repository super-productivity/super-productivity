#!/usr/bin/env bash
# Asserts that a built .rpm's desktop entry launches the spaceless /usr/bin link
# and ships the %posttrans that keeps that link alive across upgrades (#11136).
# patches/app-builder-lib+*.patch replaces electron-builder's quoted
# "/opt/Super Productivity/superproductivity" Exec, which xdg-open discards as a
# handler. A failed or dropped patch still builds green, so CI checks the payload.
set -euo pipefail

RPM_FILE="${1:?usage: assert-rpm-desktop-exec.sh <file.rpm>}"
EXPECTED='Exec=/usr/bin/superproductivity %U'

rpm2cpio "$RPM_FILE" \
  | cpio -i --quiet --to-stdout ./usr/share/applications/superproductivity.desktop \
  | grep -qxF "$EXPECTED" || {
  echo "::error::.rpm desktop entry lacks '$EXPECTED' -- the app-builder-lib patch was not applied (#11136)"
  exit 1
}

# Without it the old package's %postun deletes /usr/bin/superproductivity on upgrade.
rpm -qp --scripts "$RPM_FILE" | grep -q '^posttrans scriptlet' || {
  echo "::error::.rpm lacks the %posttrans that restores /usr/bin/superproductivity (#11136)"
  exit 1
}

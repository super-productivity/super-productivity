#!/usr/bin/env bash
# Fails unless App.app and its ShareExtension are code-signed with the App
# Group entitlement. Without it ShareInbox cannot resolve the shared container
# and every launch shows "Could not import shared content" (#10777). The
# provisioning profile granting the group is not enough: only the signature
# counts.
#
# Usage: tools/assert-ios-app-group-entitlements.sh <path/to/App.app>
set -euo pipefail

APP="${1:?usage: $0 <path/to/App.app>}"
GROUP='group.com.super-productivity.app'

check_bundle() {
  local bundle="$1" entitlements
  entitlements=$(codesign -d --entitlements - --xml "$bundle" 2>/dev/null || true)
  if ! grep -qF "<string>$GROUP</string>" <<<"$entitlements"; then
    echo "::error::${bundle##*/} is not signed with the $GROUP App Group entitlement"
    return 1
  fi
  echo "${bundle##*/}: signed with $GROUP"
}

status=0
check_bundle "$APP" || status=1
SHARE_EXTENSION="$APP/PlugIns/ShareExtension.appex"
if [ -d "$SHARE_EXTENSION" ]; then
  check_bundle "$SHARE_EXTENSION" || status=1
fi
exit "$status"

#!/usr/bin/env bash
# Ad-hoc signs the app and its extensions in an unsigned iOS archive with the
# targets' .entitlements. An unsigned archive carries no entitlements, so
# -exportArchive signed the IPA without the App Group although the profile
# grants it (#10777). Xcode refuses ad-hoc signing for the iOS SDK at build
# time, codesign does not. Needs no credentials; the export re-signs.
#
# Extensions are matched to ios/App/<Name>/<Name>.entitlements by bundle name.
#
# Usage: tools/sign-ios-archive-adhoc.sh <path/to/App.xcarchive>
set -euo pipefail
shopt -s nullglob

ARCHIVE="${1:?usage: $0 <path/to/App.xcarchive>}"
IOS_APP_DIR="$(cd "$(dirname "$0")/../ios/App" && pwd)"
APP="$ARCHIVE/Products/Applications/App.app"

if [ ! -d "$APP" ]; then
  echo "::error::No App.app in $ARCHIVE"
  exit 1
fi

sign() {
  codesign --force --sign - --timestamp=none "$@"
}

sign_with_entitlements() {
  local bundle="$1" entitlements="$2"
  if [ -f "$entitlements" ]; then
    sign --entitlements "$entitlements" "$bundle"
  else
    sign "$bundle"
  fi
}

# Inside-out: codesign rejects a bundle whose nested code is unsigned.
for nested in "$APP"/Frameworks/*.framework "$APP"/Frameworks/*.dylib; do
  sign "$nested"
done
for extension in "$APP"/PlugIns/*.appex; do
  name=$(basename "$extension" .appex)
  for nested in "$extension"/Frameworks/*.framework "$extension"/Frameworks/*.dylib; do
    sign "$nested"
  done
  sign_with_entitlements "$extension" "$IOS_APP_DIR/$name/$name.entitlements"
done
sign --entitlements "$IOS_APP_DIR/App/App.entitlements" "$APP"

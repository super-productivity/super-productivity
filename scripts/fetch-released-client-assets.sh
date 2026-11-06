#!/usr/bin/env bash
# Extract the unmodified web bundles of published releases for the
# released-client compatibility E2E specs (COMPAT_OLD_ASSETS/COMPAT_NEW_ASSETS).
#
#   scripts/fetch-released-client-assets.sh <out-dir> <tag>...
#
# For each tag, downloads that GitHub release's app-play-release.apk, checks it
# against the SHA-256 pinned below and extracts only its assets/public directory
# to <out-dir>/<tag>, with index.html at the root. Nothing is rebuilt or patched.
#
# Pins are the releases the specs were written against. The specs assert their
# release's exact appVersion and behavior, so a pin is never moved to a newer
# tag. To cover a new release, add its tag and APK digest (shown on the GitHub
# release asset) and write specs against it. Drop a pin once no spec uses it.
set -euo pipefail

apk_sha256() {
  case "$1" in
    v18.14.0) echo 1dab9bb1124200f0b2c3dc51e464a4bba38f951cb4325091e1cc4fcfb5b6126e ;;
    v19.0.1) echo 9ba64b5cb0b043f442187250ac0e2e91a44f79ebdcc8dd3dc2b10588a7037530 ;;
    v19.1.0) echo 127af90995763d88a502eae428af9dc395dcdf17d3f8f1be498f56dfa4aab9dc ;;
    *) return 1 ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

if [ $# -lt 2 ]; then
  echo "usage: $0 <out-dir> <tag>..." >&2
  exit 2
fi
out=$1
shift
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

for tag in "$@"; do
  if ! expected=$(apk_sha256 "$tag"); then
    echo "$tag: no pinned APK digest in $0" >&2
    exit 1
  fi
  apk="$work/$tag.apk"
  curl --fail --location --silent --show-error \
    --retry 5 --retry-all-errors --retry-delay 5 --output "$apk" \
    "https://github.com/super-productivity/super-productivity/releases/download/$tag/app-play-release.apk"
  actual=$(sha256_of "$apk")
  if [ "$actual" != "$expected" ]; then
    echo "$tag: APK SHA-256 $actual does not match the pinned $expected" >&2
    exit 1
  fi
  rm -rf "$work/extract" "$out/$tag"
  unzip -q "$apk" 'assets/public/*' -d "$work/extract"
  mv "$work/extract/assets/public" "$out/$tag"
  if [ ! -f "$out/$tag/index.html" ]; then
    echo "$tag: extracted bundle has no index.html" >&2
    exit 1
  fi
  echo "$tag: $(find "$out/$tag" -type f | wc -l | tr -d ' ') files in $out/$tag"
done

#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 INPUT_APPIMAGE OUTPUT_DIRECTORY" >&2
  exit 2
fi

input="$(realpath "$1")"
name="$(basename "$input")"
appimagetool="${APPIMAGETOOL:-$HOME/.local/bin/appimagetool}"

if [[ "$name" != "superProductivity-x86_64.AppImage" ]]; then
  echo "Unexpected AppImage filename: $name" >&2
  exit 1
fi

[[ -f "$input" && -x "$input" ]] || {
  echo "Input AppImage missing or not executable" >&2
  exit 1
}

[[ -x "$appimagetool" ]] || {
  echo "appimagetool is missing or not executable" >&2
  exit 1
}

command -v zsyncmake >/dev/null || {
  echo "zsyncmake is required" >&2
  exit 1
}

mkdir -p "$2"
output="$(realpath "$2")"

if [[ "$input" == "$output/$name" ]]; then
  echo "Input and output must be in different directories" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
builder_dir="${APP_BUILDER_LIB_DIR:-$script_dir/../node_modules/app-builder-lib}"
blockmap_helper="$builder_dir/out/targets/differentialUpdateInfoBuilder.js"

[[ -f "$blockmap_helper" ]] || {
  echo "Missing app-builder-lib blockmap helper: $blockmap_helper" >&2
  exit 1
}

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
cd "$workdir"

"$input" --appimage-extract >/dev/null

update_channel="${APPIMAGE_UPDATE_CHANNEL:-latest}"
case "$update_channel" in
  latest|latest-pre) ;;
  *)
    echo "Unsupported AppImage update channel: $update_channel" >&2
    exit 1
    ;;
esac

update_info="gh-releases-zsync|super-productivity|super-productivity|${update_channel}|${name}.zsync"

APPIMAGE_EXTRACT_AND_RUN=1 ARCH=x86_64 \
  "$appimagetool" -u "$update_info" squashfs-root "$name"

test -s "$name"
test -s "$name.zsync"

# Preserve electron-builder differential updates by generating a fresh
# embedded blockmap for the rebuilt AppImage.
node - "$blockmap_helper" "$name" <<'JS'
const { appendBlockmap } = require(process.argv[2]);

(async () => {
  const result = await appendBlockmap(process.argv[3]);
  if (!result.blockMapSize) {
    throw new Error('No embedded blockmap was generated');
  }
  console.log('Embedded blockmap size:', result.blockMapSize);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
JS

# Appending the blockmap changes the binary. Generate zsync last.
zsyncmake -u "$name" -o "$name.zsync" "$name"

actual_info="./$name"
actual_info="$("$actual_info" --appimage-updateinformation)"

[[ "$actual_info" == "$update_info" ]] || {
  echo "Embedded update information mismatch" >&2
  exit 1
}

python3 - "$name" "$name.zsync" <<'PY'
import hashlib
import sys
from pathlib import Path

image, zsync = map(Path, sys.argv[1:])

with zsync.open("rb") as f:
    header = f.read(16384).split(b"\n\n", 1)[0].decode()

fields = dict(
    line.split(": ", 1)
    for line in header.splitlines()
    if ": " in line
)

digest = hashlib.sha1()
with image.open("rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        digest.update(chunk)

assert int(fields["Length"]) == image.stat().st_size
assert fields["SHA-1"] == digest.hexdigest()
assert fields["Filename"] == image.name
assert fields["URL"] == image.name

import json
import zlib

with image.open("rb") as f:
    f.seek(-4, 2)
    length = int.from_bytes(f.read(4), "big")
    assert 0 < length < 10_000_000, "Missing embedded blockmap"
    f.seek(-(length + 4), 2)
    blockmap = json.loads(zlib.decompress(f.read(length), -15))

assert blockmap.get("files"), "Invalid embedded blockmap"

print("PASS: AppImage, embedded blockmap and zsync metadata match")
PY

mv "$name" "$output/$name"
mv "$name.zsync" "$output/$name.zsync"

echo "PASS: Update-enabled AppImage and zsync generated"

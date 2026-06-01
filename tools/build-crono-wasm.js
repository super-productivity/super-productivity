#!/usr/bin/env node
/**
 * Rebuilds the English-to-cron WASM module from the sibling `crono-eng` Zig
 * project and copies it into `src/assets/crono-eng.wasm`.
 *
 * Requires the Zig toolchain (>= 0.15.1) on PATH and the crono-eng repo checked
 * out next to this one (or at $CRONO_ENG_DIR). The committed
 * `src/assets/crono-eng.wasm` is the source of truth for normal builds; run
 * this only when crono-eng changes.
 *
 *   npm run build:crono-wasm
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cronoDir =
  process.env.CRONO_ENG_DIR || path.resolve(__dirname, '..', '..', 'crono-eng');
const dest = path.resolve(__dirname, '..', 'src', 'assets', 'crono-eng.wasm');

if (!fs.existsSync(path.join(cronoDir, 'src', 'wasm.zig'))) {
  console.error(`crono-eng not found at ${cronoDir} (set CRONO_ENG_DIR).`);
  process.exit(1);
}

// `zig build-exe` infers the output name from the source file, so emit to a
// temp name and move it into place (the `-femit-bin=*.wasm` form is rejected by
// zig 0.15.1).
const out = path.join(cronoDir, 'wasm.wasm');
console.log(`Building crono-eng WASM in ${cronoDir} ...`);
execFileSync(
  'zig',
  [
    'build-exe',
    'src/wasm.zig',
    '-target',
    'wasm32-freestanding',
    '-O',
    'ReleaseSmall',
    '-fno-entry',
    '-rdynamic',
  ],
  { cwd: cronoDir, stdio: 'inherit' },
);

fs.copyFileSync(out, dest);
fs.rmSync(out, { force: true });
console.log(`Wrote ${dest} (${fs.statSync(dest).size} bytes).`);

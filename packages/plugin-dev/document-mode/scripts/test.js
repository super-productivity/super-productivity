#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Unit-test runner for the document-mode plugin.
 *
 * The plugin has no browser-based test setup — its testable logic is the pure
 * `doc-transform` module. This script transpiles every `*.spec.ts` under
 * `src/` with esbuild (already a build dependency) and runs them with the
 * built-in `node --test` runner. No extra test framework needed.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildSync } = require('esbuild');

const ROOT_DIR = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const OUT_DIR = path.join(ROOT_DIR, 'dist-test');

/** Recursively collect files under `dir` whose name ends with `suffix`. */
function collect(dir, suffix) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full, suffix));
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
  return out;
}

const specs = collect(SRC_DIR, '.spec.ts');
if (specs.length === 0) {
  console.log('No *.spec.ts files found under src/.');
  process.exit(0);
}

if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// Transpile + bundle each spec to CJS. On `platform: 'node'` the built-ins
// (`node:test`, `node:assert`) stay external; the plugin-api import is
// type-only and is dropped, so nothing needs runtime resolution beyond the
// bundled `doc-transform` source.
buildSync({
  entryPoints: specs,
  outdir: OUT_DIR,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'warning',
});

const compiled = collect(OUT_DIR, '.js');
try {
  execFileSync(process.execPath, ['--test', ...compiled], { stdio: 'inherit' });
} catch {
  process.exit(1);
}

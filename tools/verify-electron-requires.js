#!/usr/bin/env node
/*
 * Walks the contents of a packaged app.asar and verifies that every relative
 * require() call inside electron/ .js/.cjs/.mjs files resolves to a file that
 * was actually packaged. Catches #7320-class bugs where tsc happily compiles
 * an import reaching out of the electron tree (e.g. '../src/app/util/foo')
 * but the compiled dependency lives outside the files glob in
 * electron-builder.yaml and is therefore missing from app.asar at runtime.
 *
 * Usage:
 *   node tools/verify-electron-requires.js <path/to/app.asar>
 *
 * Exits 0 on success, 1 when unresolvable requires are found, 2 on usage
 * errors.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const asarPath = process.argv[2];
if (!asarPath) {
  console.error('Usage: verify-electron-requires.js <path/to/app.asar>');
  process.exit(2);
}
if (!fs.existsSync(asarPath)) {
  console.error(`asar not found: ${asarPath}`);
  process.exit(2);
}

let asar;
try {
  asar = require('@electron/asar');
} catch (err) {
  console.error(
    'Could not load @electron/asar. Run "npm i" first (it is a transitive of electron-builder).',
  );
  console.error(err.message);
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-verify-asar-'));
const errors = [];

// Note: `electron/preload.js` is an esbuild bundle produced by
// electron/scripts/bundle-preload.js. All relative imports are inlined at
// bundle time, so no require('./...') calls reach this walker — meaning
// preload-side regressions of the #7320 class are NOT caught here. That
// coverage comes from the launch smoke test in electron-smoke.yml.
const SHIPPED_JS_EXT = /\.(c|m)?js$/;

const walkSourceFiles = (root, visit) => {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkSourceFiles(full, visit);
    } else if (entry.isFile() && SHIPPED_JS_EXT.test(full)) {
      visit(full);
    }
  }
};

const collectRelativeRequires = (src) => {
  const targets = [];
  const re = /\brequire\(\s*(['"])(\.[^'"\n]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) targets.push(m[2]);
  return targets;
};

// Guard: a resolved path must stay inside the extracted asar tree.
// Without this, a relative require with enough `..` climbs above `tmp` and
// Node's resolver happily hits the host filesystem (or the host's
// node_modules), masking a genuinely missing module behind a stray file.
const tmpPrefix = tmp.endsWith(path.sep) ? tmp : tmp + path.sep;
const isInsideTmp = (p) => p === tmp || p.startsWith(tmpPrefix);

let exitCode = 0;
try {
  asar.extractAll(asarPath, tmp);

  const electronDir = path.join(tmp, 'electron');
  if (!fs.existsSync(electronDir)) {
    console.error(`No electron/ directory found inside ${asarPath}`);
    exitCode = 1;
  } else {
    walkSourceFiles(electronDir, (file) => {
      const src = fs.readFileSync(file, 'utf8');
      for (const target of collectRelativeRequires(src)) {
        const candidate = path.resolve(path.dirname(file), target);
        if (!isInsideTmp(candidate)) {
          errors.push(
            `${path.relative(tmp, file)}: require('${target}') escapes packaged tree`,
          );
          continue;
        }
        try {
          const resolved = require.resolve(candidate, {
            paths: [path.dirname(file)],
          });
          if (!isInsideTmp(resolved)) {
            errors.push(
              `${path.relative(tmp, file)}: require('${target}') resolved to host path ${resolved} — module is missing from app.asar`,
            );
          }
        } catch {
          errors.push(
            `${path.relative(tmp, file)}: cannot resolve require('${target}')`,
          );
        }
      }
    });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (exitCode !== 0) process.exit(exitCode);

if (errors.length) {
  console.error(
    `Found ${errors.length} unresolvable require() target(s) inside ${asarPath}:\n`,
  );
  for (const err of errors) console.error('  ' + err);
  console.error(
    '\nThis means a .ts file under electron/ imported a path that was not packaged.',
  );
  console.error(
    'Fix: move the imported module under electron/shared-with-frontend/ (or another',
  );
  console.error(
    'path covered by files: in electron-builder.yaml) and update importers.',
  );
  process.exit(1);
}

console.log(
  `OK: all relative require() targets under electron/ resolve cleanly in ${asarPath}`,
);

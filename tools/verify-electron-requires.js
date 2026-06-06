#!/usr/bin/env node
/*
 * Walks the contents of a packaged app.asar and verifies, for every .js/.cjs/.mjs
 * file under electron/, that:
 *
 *   1. Every relative require() target resolves to a file that was actually
 *      packaged. Catches #7320-class bugs where tsc happily compiles an import
 *      reaching out of the electron tree (e.g. '../src/app/util/foo') but the
 *      compiled dependency lives outside the files glob in electron-builder.yaml
 *      and is therefore missing from app.asar at runtime.
 *
 *   2. No bare require() targets a package that electron-builder.yaml lists as
 *      excluded from the asar (e.g. require('@noble/ciphers')). This catches
 *      the regression class where dev (running against on-disk node_modules)
 *      succeeds, but the packaged release crashes with MODULE_NOT_FOUND because
 *      the package was pruned out of app.asar. The exclusion list is parsed
 *      from electron-builder.yaml; keep that file as the single source of truth.
 *
 * Usage:
 *   node tools/verify-electron-requires.js <path/to/app.asar>
 *
 * Exits 0 on success, 1 when violations are found, 2 on usage errors.
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

// Bare specifiers: anything that doesn't start with '.' or '/'. Built-ins
// (fs, path, electron, etc.) and runtime deps both pass through here; the
// exclusion check below is what flags forbidden ones.
const collectBareRequires = (src) => {
  const targets = [];
  const re = /\brequire\(\s*(['"])([^./'"][^'"\n]*)\1\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) targets.push(m[2]);
  return targets;
};

// Parse `'!**/<name>/**'` entries from electron-builder.yaml. Multi-segment
// patterns like '!**/@nx/nx-darwin-*/**' don't match this shape and are
// intentionally skipped — only full-package exclusions count as "you can't
// import this from electron/".
const parseExcludedPackages = (yamlPath) => {
  const text = fs.readFileSync(yamlPath, 'utf8');
  const re = /^\s*-\s*['"]!\*\*\/([^/'"*]+)\/\*\*['"]\s*$/gm;
  const set = new Set();
  let m;
  while ((m = re.exec(text)) !== null) set.add(m[1]);
  return set;
};

// '@scope/pkg/sub' -> '@scope/pkg'; 'pkg/sub' -> 'pkg'. Used to test against
// the exclusion set, which can hold either a scope ('@noble' covers all of
// @noble/*) or a full package name ('hash-wasm').
const isExcludedBareRequire = (target, excluded) => {
  if (target.startsWith('@')) {
    const [scope, pkg] = target.split('/');
    if (excluded.has(scope)) return scope;
    if (pkg != null && excluded.has(`${scope}/${pkg}`)) return `${scope}/${pkg}`;
    return null;
  }
  const [pkg] = target.split('/');
  return excluded.has(pkg) ? pkg : null;
};

// Guard: a resolved path must stay inside the extracted asar tree.
// Without this, a relative require with enough `..` climbs above `tmp` and
// Node's resolver happily hits the host filesystem (or the host's
// node_modules), masking a genuinely missing module behind a stray file.
const tmpPrefix = tmp.endsWith(path.sep) ? tmp : tmp + path.sep;
const isInsideTmp = (p) => p === tmp || p.startsWith(tmpPrefix);

// Resolve electron-builder.yaml relative to this script's location so the
// check works regardless of where node is invoked from.
const builderYaml = path.join(__dirname, '..', 'electron-builder.yaml');
let excludedPackages;
try {
  excludedPackages = parseExcludedPackages(builderYaml);
} catch (err) {
  console.error(`Could not read exclusion list from ${builderYaml}: ${err.message}`);
  process.exit(2);
}

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
          errors.push(`${path.relative(tmp, file)}: cannot resolve require('${target}')`);
        }
      }
      for (const target of collectBareRequires(src)) {
        const hit = isExcludedBareRequire(target, excludedPackages);
        if (hit != null) {
          errors.push(
            `${path.relative(tmp, file)}: require('${target}') targets '${hit}', which electron-builder.yaml excludes from app.asar — the packaged release will crash with MODULE_NOT_FOUND`,
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
  console.error(`Found ${errors.length} require() problem(s) inside ${asarPath}:\n`);
  for (const err of errors) console.error('  ' + err);
  console.error('\nFix for relative-require failures: move the imported module under');
  console.error('electron/shared-with-frontend/ (or another path covered by files: in');
  console.error('electron-builder.yaml) and update importers.');
  console.error(
    '\nFix for excluded-package requires: either drop the require in electron/',
  );
  console.error('or remove the matching `!**/<pkg>/**` line from electron-builder.yaml');
  console.error('(and the two build/electron-builder.mas*.yaml siblings).');
  process.exit(1);
}

console.log(`OK: all require() targets under electron/ resolve cleanly in ${asarPath}`);
console.log(
  `     (${excludedPackages.size} package(s) checked against asar exclusion list)`,
);

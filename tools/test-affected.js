#!/usr/bin/env node
/**
 * Runs only the Angular specs that (transitively) import a file changed since
 * the merge base with master — a fast local pre-check, NOT a replacement for
 * `npm test`: CI still runs everything.
 *
 * Usage: npm run test:affected [-- --base <ref>] [-- --list]
 *
 * shortcut: static import graph only — anything not visible as an import
 * (karma/test setup, assets loaded over HTTP, configs) falls back to a full run.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
// Above this, a full run is about as fast and avoids command-line length limits.
const MAX_SPECS = 500;
const SPEC_RE = /^src\/.*\.spec\.ts$/;
const GRAPH_RE =
  /^(src|packages\/[^/]+\/src|electron\/shared-with-frontend)\/.*\.(ts|json)$/;
// Changes here affect every spec (build/test setup) or are invisible to the graph.
const RUN_ALL_RE =
  /^(angular\.json|package(-lock)?\.json|tsconfig[^/]*\.json|src\/(test|polyfills)\.ts|src\/karma\.conf\.js|src\/tsconfig[^/]*\.json)$/;

const git = (...args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

const stripJsonComments = (text) => text.replace(/^\s*\/\/.*$/gm, '');

/** Builds a resolver for import specifiers, mirroring tsconfig `baseUrl: ./` + `paths`. */
const createResolver = (fileSet, tsPaths) => {
  const tryResolve = (base) =>
    [base, `${base}.ts`, `${base}/index.ts`].find((c) => fileSet.has(c)) || null;
  return (from, spec) => {
    if (spec.startsWith('.')) {
      return tryResolve(path.posix.join(path.posix.dirname(from), spec));
    }
    if (tsPaths[spec]) return tryResolve(path.posix.normalize(tsPaths[spec][0]));
    // baseUrl is the repo root, so `src/app/...` imports resolve from there
    return tryResolve(spec);
  };
};

/** Maps each file to the set of files importing it. */
const buildReverseGraph = ({ files, readFile, resolve, preProcess }) => {
  const rev = new Map();
  for (const file of files) {
    if (!file.endsWith('.ts')) continue;
    for (const { fileName } of preProcess(readFile(file))) {
      const target = resolve(file, fileName);
      if (!target) continue;
      if (!rev.has(target)) rev.set(target, new Set());
      rev.get(target).add(file);
    }
  }
  return rev;
};

/** Returns the spec files reachable from `changed` through the reverse graph. */
const findAffectedSpecs = (changed, rev) => {
  const seen = new Set();
  const stack = [...changed];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    stack.push(...(rev.get(file) || []));
  }
  return [...seen].filter((f) => SPEC_RE.test(f)).sort();
};

/**
 * Sorts changed paths into graph entry points, or flags a full run.
 * @returns {{ runAll: string | null, entries: string[] }}
 */
const classifyChanges = (changed, fileSet) => {
  const entries = [];
  for (const file of changed) {
    if (RUN_ALL_RE.test(file)) return { runAll: file, entries };
    if (fileSet.has(file)) {
      entries.push(file);
      continue;
    }
    const component = file.replace(/\.(html|scss)$/, '.ts');
    if (component !== file && fileSet.has(component)) {
      entries.push(component);
    } else if (file.startsWith('src/') && !/\.(ts|json|s?css|md)$/.test(file)) {
      // e.g. assets fetched at runtime or a template without a sibling .ts;
      // a missing .ts/.json was deleted, so its importers changed as well
      return { runAll: file, entries };
    }
  }
  return { runAll: null, entries };
};

/** Extracts the `--include` globs of an npm script so LA has one source of truth. */
const parseIncludeGlobs = (script) =>
  [...script.matchAll(/--include='([^']+)'/g)].map((m) => m[1]);

const resolveBase = (explicit) => {
  if (explicit) return explicit;
  for (const ref of ['origin/master', 'master']) {
    try {
      return git('merge-base', 'HEAD', ref)[0];
    } catch {
      // ref missing in this clone; try the next one
    }
  }
  throw new Error('No master ref found; pass --base <ref>');
};

const runNg = (tz, specs) => {
  const args = ['test', '--watch=false', ...specs.map((s) => `--include=${s}`)];
  console.log(
    `\n▶ TZ=${tz} ng test ${specs.length ? `--include ×${specs.length}` : '(all specs)'}`,
  );
  const ngBin = path.join(repoRoot, 'node_modules/@angular/cli/bin/ng.js');
  const result = spawnSync(process.execPath, [ngBin, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, TZ: tz },
  });
  return result.status ?? 1;
};

const main = () => {
  const argv = process.argv.slice(2);
  const baseIdx = argv.indexOf('--base');
  const base = resolveBase(baseIdx >= 0 ? argv[baseIdx + 1] : undefined);
  const listOnly = argv.includes('--list');

  const tracked = git('ls-files', '--cached', '--others', '--exclude-standard');
  const fileSet = new Set(
    tracked.filter((f) => GRAPH_RE.test(f) && fs.existsSync(path.join(repoRoot, f))),
  );
  const changed = [
    ...new Set([
      ...git('diff', '--name-only', base),
      ...git('ls-files', '--others', '--exclude-standard'),
    ]),
  ];
  const { runAll, entries } = classifyChanges(changed, fileSet);

  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const laGlobs = parseIncludeGlobs(pkg.scripts['test:tz:la:subset']);
  let specs = [];
  let reason = runAll && `${runAll} changed`;
  if (!runAll) {
    const ts = require('typescript');
    const tsConfig = fs.readFileSync(path.join(repoRoot, 'tsconfig.base.json'), 'utf8');
    const rev = buildReverseGraph({
      files: [...fileSet],
      readFile: (f) => fs.readFileSync(path.join(repoRoot, f), 'utf8'),
      resolve: createResolver(
        fileSet,
        JSON.parse(stripJsonComments(tsConfig)).compilerOptions.paths,
      ),
      preProcess: (src) => ts.preProcessFile(src, true, true).importedFiles,
    });
    specs = findAffectedSpecs(entries, rev);
    if (specs.length > MAX_SPECS) reason = `${specs.length} affected spec files`;
  }

  console.log(`Base ${base.slice(0, 10)}: ${changed.length} changed files`);
  if (reason) {
    console.log(`Full run: ${reason}`);
    if (listOnly) return 0;
    return runNg('Europe/Berlin', []) || runNg('America/Los_Angeles', laGlobs);
  }
  const laSpecs = specs.filter((s) => laGlobs.some((g) => path.matchesGlob(s, g)));
  console.log(`${specs.length} affected spec files (${laSpecs.length} also run in LA)`);
  if (listOnly) {
    specs.forEach((s) => console.log(`  ${s}`));
    return 0;
  }
  if (!specs.length) return 0;
  return (
    runNg('Europe/Berlin', specs) ||
    (laSpecs.length && runNg('America/Los_Angeles', laSpecs))
  );
};

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  buildReverseGraph,
  classifyChanges,
  createResolver,
  findAffectedSpecs,
  parseIncludeGlobs,
};

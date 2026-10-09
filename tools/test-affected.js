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
// Above this, a full run is about as fast; it also keeps ~80 chars per
// --include under the ~32k command-line limit on Windows.
const MAX_SPECS = 250;
const SPEC_RE = /^src\/.*\.spec\.ts$/;
const GRAPH_RE =
  /^((src|packages\/[^/]+\/src|electron\/shared-with-frontend)\/.*\.(ts|json)|src\/.*\.(html|scss)|electron\/.*\.d\.ts)$/;
const TEMPLATE_URL_RE = /\b(?:templateUrl|styleUrl)\s*:\s*['"]([^'"]+)['"]/g;
const STYLE_URLS_RE = /\bstyleUrls\s*:\s*\[([^\]]*)\]/g;
// Their direct imports load into every spec: test.ts runs global
// beforeEach/afterEach hooks, polyfills.ts patches globals (karma `polyfills`).
// shortcut: direct imports only — the transitive closure pulls in most of the
// op-log, which would turn nearly every sync change into a full run.
const SETUP_FILES = ['src/test.ts', 'src/polyfills.ts'];
// Non-TS sources nothing imports: global styles (karma `styles`), scss
// partials (@use isn't tracked) and assets fetched at runtime. Translations
// other than en.json are never loaded by specs.
const UNTRACKED_RESOURCE_RE = /^src\/(?!assets\/i18n\/).*\.(html|json|scss)$/;
const FLAGS = new Set(['--base', '--list']);
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
    [base, `${base}.ts`, `${base}.d.ts`, `${base}/index.ts`].find((c) =>
      fileSet.has(c),
    ) || null;
  return (from, spec) => {
    if (spec.startsWith('.')) {
      return tryResolve(path.posix.join(path.posix.dirname(from), spec));
    }
    if (tsPaths[spec]) return tryResolve(path.posix.normalize(tsPaths[spec][0]));
    // baseUrl is the repo root, so `src/app/...` imports resolve from there
    return tryResolve(spec);
  };
};

/** Import and `/// <reference path>` specifiers of a TypeScript source. */
const listImports = (src) => {
  const { importedFiles, referencedFiles } = require('typescript').preProcessFile(
    src,
    true,
    true,
  );
  // reference paths are relative even without a leading ./
  const refs = referencedFiles.map(({ fileName }) =>
    fileName.startsWith('.') ? fileName : `./${fileName}`,
  );
  return [...importedFiles.map(({ fileName }) => fileName), ...refs];
};

/** Component templates/styles, as relative specifiers, so they become graph edges. */
const extractResourceUrls = (src) => {
  const urls = [...src.matchAll(TEMPLATE_URL_RE)].map((m) => m[1]);
  for (const [, list] of src.matchAll(STYLE_URLS_RE)) {
    urls.push(...[...list.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]));
  }
  return urls.map((url) => (url.startsWith('.') ? url : `./${url}`));
};

/** Maps each file to the set of files importing it (or using it as template/style). */
const buildReverseGraph = ({ files, readFile, resolve, preProcess }) => {
  const rev = new Map();
  for (const file of files) {
    if (!file.endsWith('.ts')) continue;
    const src = readFile(file);
    for (const spec of [...preProcess(src), ...extractResourceUrls(src)]) {
      const target = resolve(file, spec);
      if (!target) continue;
      if (!rev.has(target)) rev.set(target, new Set());
      rev.get(target).add(file);
    }
  }
  return rev;
};

const isSetupImport = (file, rev) => SETUP_FILES.some((s) => rev.get(file)?.has(s));

/**
 * Returns a changed file whose reach the graph can't show, so every spec
 * must run: a global setup module, an ambient (never imported) .d.ts, or a
 * non-TS resource nothing imports.
 */
const findGlobalEntry = (entries, rev) =>
  entries.find(
    (f) =>
      isSetupImport(f, rev) ||
      (!rev.has(f) && (f.endsWith('.d.ts') || UNTRACKED_RESOURCE_RE.test(f))),
  ) || null;

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
    // e.g. assets fetched at runtime; a changed path missing from fileSet with
    // a graph extension was deleted — main() follows its stale importers
    if (file.startsWith('src/') && !/\.(ts|json|html|s?css|md)$/.test(file)) {
      return { runAll: file, entries };
    }
  }
  return { runAll: null, entries };
};

/** Extracts the `--include` globs of an npm script so LA has one source of truth. */
const parseIncludeGlobs = (script) =>
  [...script.matchAll(/--include='([^']+)'/g)].map((m) => m[1]);

/** Parses `--base <ref>`, `--base=<ref>` and `--list`; rejects anything else. */
const parseArgs = (argv) => {
  const args = { base: null, list: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (!FLAGS.has(flag)) throw new Error(`unknown argument ${argv[i]}`);
    if (flag === '--list') args.list = true;
    if (flag !== '--base') continue;
    args.base = inline ?? argv[++i];
    if (!args.base || args.base.startsWith('--')) {
      throw new Error('--base needs a git ref');
    }
  }
  return args;
};

// Diff against the fork point, not the ref tip, so commits that landed on the
// ref after branching don't count as changes.
const resolveBase = (ref) => {
  if (ref) return git('merge-base', 'HEAD', ref)[0];
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
  if (result.error) {
    console.error(`Could not start ng test: ${result.error.message}`);
  }
  return result.status ?? 1;
};

const main = () => {
  const { base: baseRef, list: listOnly } = parseArgs(process.argv.slice(2));
  const base = resolveBase(baseRef);

  const tracked = git('ls-files', '--cached', '--others', '--exclude-standard');
  const fileSet = new Set(
    tracked.filter((f) => GRAPH_RE.test(f) && fs.existsSync(path.join(repoRoot, f))),
  );
  const changed = [
    ...new Set([
      // --no-renames: a rename must also list its old path as deleted
      ...git('diff', '--name-only', '--no-renames', base),
      ...git('ls-files', '--others', '--exclude-standard'),
    ]),
  ];
  const { runAll, entries } = classifyChanges(changed, fileSet);
  // Importers still pointing at a deleted file no longer compile, so resolve
  // imports to it as if it existed and select their specs.
  const deleted = changed.filter((f) => GRAPH_RE.test(f) && !fileSet.has(f));

  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const laGlobs = parseIncludeGlobs(pkg.scripts['test:tz:la:subset']);
  if (!laGlobs.length) throw new Error('No --include globs in test:tz:la:subset');
  let specs = [];
  let reason = runAll && `${runAll} changed`;
  if (!runAll) {
    const tsConfig = fs.readFileSync(path.join(repoRoot, 'tsconfig.base.json'), 'utf8');
    const rev = buildReverseGraph({
      files: [...fileSet],
      readFile: (f) => fs.readFileSync(path.join(repoRoot, f), 'utf8'),
      resolve: createResolver(
        new Set([...fileSet, ...deleted]),
        JSON.parse(stripJsonComments(tsConfig)).compilerOptions.paths,
      ),
      preProcess: listImports,
    });
    const globalEntry =
      findGlobalEntry(entries, rev) || deleted.find((f) => isSetupImport(f, rev));
    specs = findAffectedSpecs([...entries, ...deleted], rev);
    if (globalEntry) reason = `${globalEntry} changed (global effect)`;
    else if (specs.length > MAX_SPECS) reason = `${specs.length} affected spec files`;
  }

  console.log(`Base ${base.slice(0, 10)}: ${changed.length} changed files`);
  if (reason) {
    console.log(`Full run: ${reason}`);
    if (listOnly) return 0;
    return runNg('Europe/Berlin', []) || runNg('America/Los_Angeles', laGlobs);
  }
  const laSpecs = specs.filter((s) => laGlobs.some((g) => path.posix.matchesGlob(s, g)));
  console.log(`${specs.length} affected spec files (${laSpecs.length} also run in LA)`);
  if (entries.some((f) => f.startsWith('packages/'))) {
    console.log('Package sources changed: also run npm run packages:test');
  }
  if (listOnly) {
    specs.forEach((s) => console.log(`  ${s}`));
    return 0;
  }
  if (!specs.length) {
    console.log(
      'No Angular spec imports the changed files, so nothing was tested or compiled.' +
        ' Run npm run checkFile on them; new services and state logic need a spec.',
    );
    return 0;
  }
  return (
    runNg('Europe/Berlin', specs) ||
    (laSpecs.length && runNg('America/Los_Angeles', laSpecs))
  );
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`test:affected: ${error.message}`);
    process.exitCode = 2;
  }
}

module.exports = {
  buildReverseGraph,
  classifyChanges,
  createResolver,
  findAffectedSpecs,
  findGlobalEntry,
  isSetupImport,
  listImports,
  parseArgs,
  parseIncludeGlobs,
};

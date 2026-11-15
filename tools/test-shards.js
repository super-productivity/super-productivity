#!/usr/bin/env node
/**
 * Runs the Angular specs as several `ng test --include=…` shards. Karma runs
 * every spec in one Chrome tab, so one run uses about one core; shards spread
 * the suite over several. Locally all shards run in parallel; CI runs one shard
 * per job with `--shard i/N`, so both split the specs the same way.
 *
 * Usage: node tools/test-shards.js <suite...> [--shards N | --shard i/N]
 *   berlin     all specs, TZ=Europe/Berlin
 *   la         all specs, TZ=America/Los_Angeles
 *   la-subset  the `test:tz:la:subset` npm script's globs, TZ=America/Los_Angeles
 *
 * A suite in one shard passes its globs (none = all specs), like a plain
 * `ng test`; split suites pass every spec path as an --include arg.
 */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseIncludeGlobs } = require('./test-affected');

const repoRoot = path.join(__dirname, '..');
const LOG_DIR = path.join(repoRoot, '.tmp', 'logs');
const SPEC_RE = /^src\/.*\.spec\.ts$/;
const SUITES = {
  berlin: { tz: 'Europe/Berlin' },
  la: { tz: 'America/Los_Angeles' },
  'la-subset': { tz: 'America/Los_Angeles', globsFrom: 'test:tz:la:subset' },
};
const RESULT_RE = /Executed (\d+) of (\d+).*?(SUCCESS|FAILED)/g;

/**
 * Every shard compiles the whole spec program (src/tsconfig.spec.json includes
 * all specs, whatever --include says): ~200 CPU-seconds on ~6 cores. Measured
 * 2026-11 on 24 cores: 3 parallel shards beat one run, 4 and 6 were slower.
 */
const defaultShardCount = () =>
  // shortcut: Windows caps a command line at ~32k chars and the full suite's
  // paths take ~78k, so it runs unsplit — pass the includes via a file if needed.
  process.platform === 'win32'
    ? 1
    : Math.min(3, Math.max(1, Math.floor(os.availableParallelism() / 8)));

/** Parses `<suite...> [--shards N | --shard i/N]`; rejects anything else. */
const parseArgs = (argv) => {
  const args = { suites: [], shards: null, shard: null };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (SUITES[flag]) {
      args.suites.push(flag);
    } else if (flag === '--shards' || flag === '--shard') {
      const value = inline ?? argv[++i];
      if (flag === '--shards') args.shards = parsePositiveInt(value, flag);
      else args.shard = parseShard(value);
    } else {
      throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  if (!args.suites.length) throw new Error(`name a suite: ${Object.keys(SUITES)}`);
  if (args.shards && args.shard) throw new Error('use --shards or --shard, not both');
  return args;
};

const parsePositiveInt = (value, flag) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a positive integer`);
  return n;
};

const parseShard = (value) => {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? '');
  const [index, total] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  if (index < 1 || index > total) throw new Error('--shard needs i/N with 1 <= i <= N');
  return { index, total };
};

/**
 * Splits weighted files into `count` shards of similar total weight
 * (largest first into the lightest shard). Deterministic, so every CI job
 * computes the same split.
 */
const splitIntoShards = (files, count) => {
  const shards = Array.from({ length: count }, () => ({ weight: 0, files: [] }));
  const ordered = [...files].sort(
    (a, b) => b.weight - a.weight || a.file.localeCompare(b.file),
  );
  for (const { file, weight } of ordered) {
    const lightest = shards.reduce((min, s) => (s.weight < min.weight ? s : min));
    lightest.files.push(file);
    lightest.weight += weight;
  }
  return shards.map((s) => s.files.sort());
};

/** Spec files of a suite, weighted by size as a proxy for their test count. */
const listSuiteSpecs = (suite) => {
  const tracked = execFileSync(
    'git',
    // -z: unquoted paths, so non-ASCII spec names are not dropped as missing
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'src'],
    { cwd: repoRoot, encoding: 'utf8' },
  ).split('\0');
  const globs = suiteGlobs(suite);
  return [...new Set(tracked)]
    .filter((f) => SPEC_RE.test(f) && fs.existsSync(path.join(repoRoot, f)))
    .filter((f) => !globs.length || globs.some((g) => path.posix.matchesGlob(f, g)))
    .map((file) => ({ file, weight: fs.statSync(path.join(repoRoot, file)).size }));
};

const suiteGlobs = (suite) => {
  const script = SUITES[suite].globsFrom;
  if (!script) return [];
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const globs = parseIncludeGlobs(pkg.scripts[script] ?? '');
  if (!globs.length) throw new Error(`No --include globs in ${script}`);
  return globs;
};

/** Runs one shard; output goes to `logFile`, or straight through when null. */
const runShard = ({ label, tz, files, includes, logFile }) =>
  new Promise((resolve) => {
    const ngBin = path.join(repoRoot, 'node_modules/@angular/cli/bin/ng.js');
    const args = ['test', '--watch=false', ...includes.map((f) => `--include=${f}`)];
    const out = logFile ? fs.openSync(logFile, 'w') : 'inherit';
    console.log(`▶ ${label}: TZ=${tz}, ${files.length} spec files`);
    const child = spawn(process.execPath, [ngBin, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', out, out],
      env: { ...process.env, TZ: tz },
    });
    const done = (status) => {
      if (logFile) fs.closeSync(out);
      resolve({ label, status, logFile });
    };
    child.on('error', (error) => {
      console.error(`${label}: could not start ng test: ${error.message}`);
      done(1);
    });
    // 'exit', not 'close': a leftover Chrome or esbuild process may keep the
    // inherited output open after ng itself has finished.
    child.on('exit', (code) => done(code ?? 1));
  });

/** Runs `jobs` (functions returning promises) with at most `limit` at once. */
const runPool = async (jobs, limit) => {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) results.push(await jobs[next++]());
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
};

/** Last Karma result line of a log: `{ executed, total, ok }`, or null. */
const readResult = (log) => {
  const plain = log.replace(/\x1b\[[0-9;]*m/g, '');
  const last = [...plain.matchAll(RESULT_RE)].pop();
  return last ? { executed: +last[1], total: +last[2], ok: last[3] === 'SUCCESS' } : null;
};

/** Prints a shard's outcome; a shard without a passing Karma result failed. */
const reportShard = ({ label, status, logFile }) => {
  const log = fs.readFileSync(logFile, 'utf8');
  const result = readResult(log);
  const tests = result ? `${result.executed} of ${result.total} tests` : 'no result';
  const rel = path.relative(repoRoot, logFile);
  const ok = status === 0 && !!result?.ok;
  console.log(`${ok ? '✓' : '✗'} ${label}: ${tests} (${rel})`);
  if (!ok) console.log(log.split('\n').slice(-60).join('\n'));
  return { ok, executed: result?.executed ?? 0 };
};

const sumWeight = (files) => files.reduce((sum, f) => sum + f.weight, 0);

/**
 * Builds one job per non-empty shard. Smaller suites get proportionally fewer
 * shards, since each shard pays for a full build.
 */
const planShards = ({ suites, shards, shard }, listSpecs = listSuiteSpecs) => {
  const specs = suites.map((suite) => ({ suite, files: listSpecs(suite) }));
  const maxWeight = Math.max(...specs.map((s) => sumWeight(s.files))) || 1;
  const base = shards ?? defaultShardCount();
  return specs.flatMap(({ suite, files }) => {
    const count =
      shard?.total ?? Math.max(1, Math.round((base * sumWeight(files)) / maxWeight));
    return splitIntoShards(files, count)
      .map((part, i) => ({
        label: `${suite} ${i + 1}/${count}`,
        index: i + 1,
        tz: SUITES[suite].tz,
        files: part,
        includes: count === 1 ? suiteGlobs(suite) : part,
      }))
      .filter((job) => job.files.length && (!shard || job.index === shard.index));
  });
};

const logFileFor = (label) =>
  path.join(LOG_DIR, `test-shard-${label.replace(/\W+/g, '-')}.log`);

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const plan = planShards(args);
  if (!plan.length) throw new Error('no spec files to run');
  const limit = args.shard ? 1 : (args.shards ?? defaultShardCount());
  if (limit === 1) {
    // One shard at a time (CI jobs, small machines, release builds): stream
    // Karma's output and rely on its exit code, like a plain `ng test`.
    const run = plan.map((job) => () => runShard({ ...job, logFile: null }));
    const results = await runPool(run, 1);
    return results.every((r) => r.status === 0) ? 0 : 1;
  }
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const run = plan.map(
    (job) => () => runShard({ ...job, logFile: logFileFor(job.label) }),
  );
  const reports = (await runPool(run, limit)).map(reportShard);
  const executed = reports.reduce((sum, r) => sum + r.executed, 0);
  const failed = reports.filter((r) => !r.ok).length;
  // `TOTAL:` prefix: tools/quiet.js shows lines starting with it as the summary
  console.log(`TOTAL: ${executed} tests in ${reports.length} shards, ${failed} failed`);
  return failed ? 1 : 0;
};

if (require.main === module) {
  main().then(
    (code) => (process.exitCode = code),
    (error) => {
      console.error(`test-shards: ${error.message}`);
      process.exitCode = 2;
    },
  );
}

module.exports = { parseArgs, planShards, readResult, splitIntoShards };

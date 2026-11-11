#!/usr/bin/env node
/**
 * Splits a tagged E2E suite into shards of about equal measured duration and
 * writes one shard's spec files as a Playwright `--test-list` file.
 *
 * Playwright's own `--shard` cuts contiguous blocks by test count, so the shards
 * that get the slow specs run far longer than the rest (20–29 min across the six
 * SuperSync shards in one run, measured 2026-11).
 *
 * Usage:
 *   node tools/e2e-shard.js --grep @supersync --shards 8 --shard 3 --out <file>
 *       [--only sync/a.spec.ts,sync/b.spec.ts]
 *   node tools/e2e-shard.js --update-durations <junit.xml...>
 *
 * The test list comes from `playwright test --list`, so the shards always cover
 * exactly the tests the tag selects. Durations only steer the split: a file
 * missing from e2e/test-durations.json is estimated from its test count, and a
 * stale entry makes the shards uneven again, never skips a test.
 *
 * Refresh the durations from the junit artifacts CI uploads
 * (`e2e-sync-pr-junit-*`): download them, then run `--update-durations` on the
 * XML files and commit the result.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const DURATIONS_FILE = path.join(repoRoot, 'e2e', 'test-durations.json');
const CONFIG = 'e2e/playwright.config.ts';
// Used only when no listed file has a measured duration.
const FALLBACK_SEC_PER_TEST = 30;

/** Parses `--flag value` / `--flag=value` pairs and `--update-durations <files...>`. */
const parseArgs = (argv) => {
  if (argv[0] === '--update-durations') {
    if (argv.length < 2) throw new Error('--update-durations needs junit XML files');
    return { updateDurations: argv.slice(1) };
  }
  const args = {};
  const known = new Set(['--grep', '--shards', '--shard', '--out', '--only']);
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (!known.has(flag)) throw new Error(`unknown argument ${argv[i]}`);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    args[flag.slice(2)] = value;
  }
  for (const required of ['grep', 'shards', 'shard', 'out']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const shards = Number(args.shards);
  const shard = Number(args.shard);
  if (!Number.isInteger(shards) || shards < 1) throw new Error('--shards must be >= 1');
  if (!Number.isInteger(shard) || shard < 1 || shard > shards) {
    throw new Error(`--shard must be between 1 and ${shards}`);
  }
  const only = args.only
    ? args.only
        .split(/[\s,]+/)
        .map((f) => f.trim())
        .filter(Boolean)
    : null;
  return { grep: args.grep, shards, shard, out: args.out, only };
};

/** Maps each spec file (relative to the test dir) to its number of tests. */
const countTestsPerFile = (listJson) => {
  if (listJson.errors?.length) {
    const first = listJson.errors[0];
    throw new Error(`playwright --list reported errors: ${first.message || first}`);
  }
  const files = new Map();
  const walk = (suite) => {
    for (const spec of suite.specs || []) {
      files.set(spec.file, (files.get(spec.file) || 0) + spec.tests.length);
    }
    (suite.suites || []).forEach(walk);
  };
  (listJson.suites || []).forEach(walk);
  return files;
};

/** Weight per file: measured seconds, else an estimate from its test count. */
const weighFiles = (testCounts, durations) => {
  let knownSec = 0;
  let knownTests = 0;
  for (const [file, count] of testCounts) {
    if (typeof durations[file] === 'number') {
      knownSec += durations[file];
      knownTests += count;
    }
  }
  const secPerTest = knownTests ? knownSec / knownTests : FALLBACK_SEC_PER_TEST;
  return [...testCounts].map(([file, count]) => ({
    file,
    sec:
      typeof durations[file] === 'number'
        ? durations[file]
        : Math.round(secPerTest * count),
    estimated: typeof durations[file] !== 'number',
  }));
};

/**
 * Longest-processing-time first: the heaviest file goes to the lightest shard.
 * Deterministic (ties broken by name, then shard index), so every shard job
 * computes the same split without passing files between jobs.
 */
const assignShards = (weighted, shardCount) => {
  const shards = Array.from({ length: shardCount }, () => ({ sec: 0, files: [] }));
  const order = [...weighted].sort(
    (a, b) => b.sec - a.sec || a.file.localeCompare(b.file),
  );
  for (const item of order) {
    let target = shards[0];
    for (const s of shards) if (s.sec < target.sec) target = s;
    target.sec += item.sec;
    target.files.push(item.file);
  }
  shards.forEach((s) => s.files.sort());
  return shards;
};

/** Throws unless the shards together hold every file exactly once. */
const assertCoverage = (shards, files) => {
  const assigned = shards.flatMap((s) => s.files).sort();
  const expected = [...files].sort();
  if (assigned.length !== expected.length || assigned.some((f, i) => f !== expected[i])) {
    throw new Error(
      `shard split does not cover the suite exactly (${assigned.length} assigned, ${expected.length} listed)`,
    );
  }
};

const decodeXml = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Sums `<testsuite name=… time=…>` per file across junit reports. */
const parseJunitDurations = (xmlTexts) => {
  const sums = {};
  for (const xml of xmlTexts) {
    for (const [, attrs] of xml.matchAll(/<testsuite\s([^>]*)>/g)) {
      const name = attrs.match(/\bname="([^"]*)"/)?.[1];
      const time = Number(attrs.match(/\btime="([^"]*)"/)?.[1]);
      if (!name || !Number.isFinite(time)) continue;
      const file = decodeXml(name);
      sums[file] = (sums[file] || 0) + time;
    }
  }
  return sums;
};

/** Measured files replace their old entries; everything else is kept. */
const mergeDurations = (existing, measured) => {
  const merged = { ...existing };
  for (const [file, sec] of Object.entries(measured)) merged[file] = Math.round(sec);
  return Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
  );
};

const readDurations = () =>
  fs.existsSync(DURATIONS_FILE)
    ? JSON.parse(fs.readFileSync(DURATIONS_FILE, 'utf8'))
    : {};

const listTests = (grep) => {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('@playwright/test/cli'),
      'test',
      '--config',
      CONFIG,
      '--list',
      '--reporter=json',
      '--grep',
      grep,
    ],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`playwright --list failed (exit ${result.status}): ${result.stderr}`);
  }
  const counts = countTestsPerFile(json);
  if (result.status !== 0) {
    throw new Error(`playwright --list exited ${result.status}: ${result.stderr}`);
  }
  return counts;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.updateDurations) {
    const measured = parseJunitDurations(
      args.updateDurations.map((f) => fs.readFileSync(f, 'utf8')),
    );
    const count = Object.keys(measured).length;
    if (!count) throw new Error('no <testsuite> durations found in the given files');
    fs.writeFileSync(
      DURATIONS_FILE,
      `${JSON.stringify(mergeDurations(readDurations(), measured), null, 2)}\n`,
    );
    console.log(`Updated ${count} files in ${path.relative(repoRoot, DURATIONS_FILE)}`);
    return 0;
  }

  let testCounts = listTests(args.grep);
  if (args.only) {
    const only = new Set(args.only);
    testCounts = new Map([...testCounts].filter(([file]) => only.has(file)));
  }
  const weighted = weighFiles(testCounts, readDurations());
  const shards = assignShards(weighted, args.shards);
  assertCoverage(shards, testCounts.keys());

  const estimated = weighted.filter((w) => w.estimated).map((w) => w.file);
  const mine = shards[args.shard - 1];
  console.log(
    `${args.grep}: ${testCounts.size} files in ${args.shards} shards, est. worker-min per shard: ` +
      shards.map((s) => (s.sec / 60).toFixed(1)).join(' / '),
  );
  if (estimated.length) {
    console.log(
      `No measured duration (estimated from test count): ${estimated.join(', ')}`,
    );
  }
  console.log(`Shard ${args.shard}: ${mine.files.length} files`);
  mine.files.forEach((f) => console.log(`  ${f}`));
  fs.mkdirSync(path.dirname(path.resolve(repoRoot, args.out)), { recursive: true });
  fs.writeFileSync(
    path.resolve(repoRoot, args.out),
    mine.files.length ? `${mine.files.join('\n')}\n` : '',
  );
  return 0;
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`e2e-shard: ${error.message}`);
    process.exitCode = 2;
  }
}

module.exports = {
  assertCoverage,
  assignShards,
  countTestsPerFile,
  mergeDurations,
  parseArgs,
  parseJunitDurations,
  weighFiles,
};

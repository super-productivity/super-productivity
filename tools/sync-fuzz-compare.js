#!/usr/bin/env node

// Compares the sync fuzz signature report of the working tree with a base ref
// and fails on any seed that newly shows a failure signature.
//
//   npm run sync-fuzz:compare              # against origin/master
//   npm run sync-fuzz:compare -- <ref>
//
// The pinned traces and the random sweep only report signatures no pin
// explains, so a change that makes a known failure more frequent passes them.
// This comparison caught two such regressions in #10398. It runs
// sync-fuzz-signature-report.benchmark.ts in the working tree and in a
// temporary worktree of the base ref (sharing node_modules), one after the
// other, since both use Karma's port, and takes 5 to 10 minutes. The base
// run uses the working tree's report benchmark and intent mixes, so both
// sweep the same seeds; it warns when other harness files differ, since the
// base then reports what its own harness detects. An interrupted run removes
// its worktree too; after a crash, `git worktree prune` cleans up.
//
// For each newly failing seed it prints whether both revisions executed the
// same steps and which final field values differ: judge the original seed by
// those first. A shrunk trace only helps to diagnose (see JUDGE_HINT).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FUZZ_DIR = 'src/app/op-log/testing/integration/sync-fuzz';
const REPORT_SPEC = `${FUZZ_DIR}/sync-fuzz-signature-report.benchmark.ts`;
const SHARED_FILES = [REPORT_SPEC, `${FUZZ_DIR}/sync-fuzz-profiles.ts`];
const JUDGE_HINT =
  'Judge each newly failing seed on the original seed first: the lines under ' +
  'it say whether both revisions executed the same steps and which final ' +
  "field values differ. The values are device C's live tasks, notes and " +
  'habits after its last restart, not the other devices or the archive: the ' +
  'same steps reaching the same values clear only an entry about those ' +
  'fields. A divergence, restart, time or archive entry still needs the ' +
  'original seed compared on both revisions. A shrunk trace only helps to ' +
  'diagnose: shrinking can remove the interaction that made the seed worse, ' +
  'so a shrunk trace that fails the same way on the base clears nothing. To ' +
  'shrink a seed, set FIRST_SEED to it, SEED_COUNT to 1 and IGNORE_PINNED to ' +
  `true in ${FUZZ_DIR}/sync-fuzz-seeds.benchmark.ts and run it with npm run ` +
  'test:file.';
const REPORT_PATTERN = /SYNC_FUZZ_REPORT_START(\{.*?\})SYNC_FUZZ_REPORT_END/s;

/**
 * The report in a Karma run's output, or undefined: `signatures` maps each
 * signature to its seeds, and `runs` gives each seed's executed-steps hash
 * and final field values.
 */
const parseReport = (output) => {
  const match = REPORT_PATTERN.exec(output);
  return match ? JSON.parse(match[1]) : undefined;
};

/** How a seed's run differs between the base and the head. */
const describeRun = (base, head) => {
  if (!base || !head) return ['  run details missing'];
  const lines = [
    base.steps === head.steps
      ? `  same executed steps (${head.steps})`
      : `  executed steps differ: base ${base.steps}, head ${head.steps}`,
  ];
  const keys = [...new Set([...Object.keys(base.values), ...Object.keys(head.values)])];
  const differing = keys
    .sort()
    .filter(
      (key) => JSON.stringify(base.values[key]) !== JSON.stringify(head.values[key]),
    );
  if (differing.length === 0)
    lines.push("  same final field values (device C's live state)");
  for (const key of differing) {
    lines.push(
      `  ${key}: base ${JSON.stringify(base.values[key])}, head ${JSON.stringify(head.values[key])}`,
    );
  }
  return lines;
};

/** Seeds that newly show a signature, and seeds that no longer do. */
const compareReports = (base, head) => {
  const newFailures = [];
  const fixed = [];
  const signatures = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  for (const signature of signatures) {
    const baseSeeds = new Set(base[signature] ?? []);
    const headSeeds = new Set(head[signature] ?? []);
    const added = [...headSeeds].filter((seed) => !baseSeeds.has(seed)).sort();
    const removed = [...baseSeeds].filter((seed) => !headSeeds.has(seed)).sort();
    if (added.length > 0) newFailures.push({ signature, seeds: added });
    if (removed.length > 0) fixed.push({ signature, seeds: removed });
  }
  return { newFailures, fixed };
};

/**
 * Harness files that differ from the base apart from the ones the base run
 * borrows, specs, benchmarks (they run only when named) and data: they change
 * what the base can detect.
 */
const harnessDifferences = (changedFiles) =>
  changedFiles.filter(
    (file) =>
      !SHARED_FILES.includes(file) &&
      !/\.(spec|benchmark)\.ts$/.test(file) &&
      !file.endsWith('.json'),
  );

const formatComparison = ({ newFailures, fixed }, label, runs) => {
  const lines = [`Sync fuzz signatures: ${label}`];
  const section = (title, entries) => {
    lines.push(`${title} (${entries.length})`);
    for (const { signature, seeds } of entries) {
      lines.push(`  ${signature}: ${seeds.join(', ')}`);
    }
  };
  section('Newly failing', newFailures);
  section('No longer failing', fixed);
  if (runs) {
    const seeds = Object.keys(runs.head).sort();
    const differ = seeds.filter(
      (seed) => runs.base[seed]?.steps !== runs.head[seed].steps,
    );
    lines.push(
      `Executed steps: ${seeds.length - differ.length} of ${seeds.length} seeds identical` +
        (differ.length > 0 ? `; differing: ${differ.join(', ')}` : ''),
    );
  }
  if (runs && newFailures.length > 0) {
    const seeds = [...new Set(newFailures.flatMap(({ seeds }) => seeds))].sort();
    lines.push(`Newly failing seeds, base vs head (${seeds.length})`);
    for (const seed of seeds) {
      lines.push(seed, ...describeRun(runs.base[seed], runs.head[seed]));
    }
  }
  return lines.join('\n');
};

const git = (cwd, args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

let interrupted = false;

const runReport = (cwd, label) => {
  console.log(`Running the signature report on ${label}…`);
  // The build imports the git-ignored env.generated.ts; a fresh worktree lacks it.
  execFileSync('node', ['tools/load-env.js', '--ensure'], { cwd, stdio: 'ignore' });
  const result = spawnSync(
    'npx',
    ['ng', 'test', '--watch=false', '--include', REPORT_SPEC],
    {
      cwd,
      env: { ...process.env, TZ: 'Europe/Berlin' },
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  // spawnSync blocks the event loop, so the SIGINT handler has not run yet;
  // the child's own exit shows the interrupt.
  if (result.signal === 'SIGINT' || result.status === 130) interrupted = true;
  if (interrupted) throw new Error('Interrupted');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const report = parseReport(output);
  if (!report) {
    throw new Error(`No signature report from ${cwd}:\n${output.slice(-4000)}`);
  }
  return report;
};

const main = () => {
  const baseRef = process.argv[2] ?? 'origin/master';
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const baseSha = git(root, ['rev-parse', '--short', baseRef]);
  const baseLabel = `${baseRef} (${baseSha})`;
  const differing = harnessDifferences(
    git(root, ['diff', '--name-only', baseRef, '--', FUZZ_DIR])
      .split('\n')
      .filter(Boolean),
  );
  if (differing.length > 0) {
    console.warn(
      `Warning: these harness files differ from ${baseLabel}, so the two runs ` +
        `may detect different signatures:\n  ${differing.join('\n  ')}`,
    );
  }
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-fuzz-base-'));
  // Without a handler, Ctrl-C would end Node before the cleanup below. The
  // children get the signal too, so the running report returns at once.
  process.once('SIGINT', () => {
    interrupted = true;
  });
  let comparison;
  let runs;
  try {
    git(root, ['worktree', 'add', '--detach', worktree, baseRef]);
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(worktree, 'node_modules'));
    for (const file of SHARED_FILES) {
      fs.copyFileSync(path.join(root, file), path.join(worktree, file));
    }
    const head = runReport(root, 'the working tree');
    const base = runReport(worktree, baseLabel);
    comparison = compareReports(base.signatures, head.signatures);
    runs = { base: base.runs, head: head.runs };
  } catch (error) {
    if (interrupted) {
      process.exitCode = 130;
      return;
    }
    throw error;
  } finally {
    git(root, ['worktree', 'remove', '--force', worktree]);
  }
  console.log(formatComparison(comparison, `working tree vs ${baseLabel}`, runs));
  if (comparison.newFailures.length > 0) console.log(`\n${JUDGE_HINT}`);
  process.exitCode = comparison.newFailures.length > 0 ? 1 : 0;
};

if (require.main === module) {
  main();
}

module.exports = {
  compareReports,
  describeRun,
  formatComparison,
  harnessDifferences,
  parseReport,
};

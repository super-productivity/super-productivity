const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareReports,
  describeRun,
  formatComparison,
  harnessDifferences,
  parseReport,
} = require('./sync-fuzz-compare');

test('parses the report between its markers in Karma output', () => {
  const output =
    'FAILED\n  Failed: SYNC_FUZZ_REPORT_START{"signatures":{"time-loss:task":["all:1"]},' +
    '"runs":{"all:1":{"steps":"3:ab","values":{"task:t1.title":"x"}}}}' +
    'SYNC_FUZZ_REPORT_END\n    at <Jasmine>';
  assert.deepEqual(parseReport(output), {
    signatures: { 'time-loss:task': ['all:1'] },
    runs: { 'all:1': { steps: '3:ab', values: { 'task:t1.title': 'x' } } },
  });
});

test('reads a missing report as undefined', () => {
  assert.equal(parseReport('Executed 0 of 0 DISCONNECTED'), undefined);
});

test('lists seeds that newly show a signature, and fixed ones', () => {
  const base = { a: ['all:1', 'all:2'], b: ['tasks:3'] };
  const head = { a: ['all:2', 'all:4'], c: ['noReorder:5'] };
  assert.deepEqual(compareReports(base, head), {
    newFailures: [
      { signature: 'a', seeds: ['all:4'] },
      { signature: 'c', seeds: ['noReorder:5'] },
    ],
    fixed: [
      { signature: 'a', seeds: ['all:1'] },
      { signature: 'b', seeds: ['tasks:3'] },
    ],
  });
});

test('a count that stays equal but moves seeds is still a new failure', () => {
  const { newFailures } = compareReports({ a: ['all:1'] }, { a: ['all:2'] });
  assert.deepEqual(newFailures, [{ signature: 'a', seeds: ['all:2'] }]);
});

test('formats both sections', () => {
  const text = formatComparison(
    { newFailures: [{ signature: 'a', seeds: ['all:4'] }], fixed: [] },
    'working tree vs origin/master',
  );
  assert.equal(
    text,
    [
      'Sync fuzz signatures: working tree vs origin/master',
      'Newly failing (1)',
      '  a: all:4',
      'No longer failing (0)',
    ].join('\n'),
  );
});

test('describes a seed by its executed steps and differing final values', () => {
  const base = {
    steps: '30:aa',
    values: { 'task:t1.notes': 'C2', 'task:t1.title': 'B' },
  };
  assert.deepEqual(describeRun(base, { ...base }), [
    '  same executed steps (30:aa)',
    "  same final field values (device C's live state)",
  ]);
  assert.deepEqual(
    describeRun(base, {
      steps: '30:bb',
      values: { 'task:t1.notes': 'A0', 'task:t1.title': 'B', 'note:n1.isLock': true },
    }),
    [
      '  executed steps differ: base 30:aa, head 30:bb',
      '  note:n1.isLock: base undefined, head true',
      '  task:t1.notes: base "C2", head "A0"',
    ],
  );
});

test('lists each newly failing seed with how its run differs', () => {
  const run = { steps: '30:aa', values: { 'task:t1.notes': 'C2' } };
  const text = formatComparison(
    {
      newFailures: [
        { signature: 'a', seeds: ['all:4'] },
        { signature: 'b', seeds: ['all:4'] },
      ],
      fixed: [],
    },
    'working tree vs origin/master',
    {
      base: { 'all:4': run },
      head: { 'all:4': { ...run, values: { 'task:t1.notes': 'A0' } } },
    },
  );
  assert.equal(
    text,
    [
      'Sync fuzz signatures: working tree vs origin/master',
      'Newly failing (2)',
      '  a: all:4',
      '  b: all:4',
      'No longer failing (0)',
      'Executed steps: 1 of 1 seeds identical',
      'Newly failing seeds, base vs head (1)',
      'all:4',
      '  same executed steps (30:aa)',
      '  task:t1.notes: base "C2", head "A0"',
    ].join('\n'),
  );
});

test('names harness files that change what the base run detects', () => {
  const dir = 'src/app/op-log/testing/integration/sync-fuzz';
  assert.deepEqual(
    harnessDifferences([
      `${dir}/sync-fuzz-runner.ts`,
      `${dir}/sync-fuzz-profiles.ts`,
      `${dir}/sync-fuzz-signature-report.benchmark.ts`,
      `${dir}/sync-fuzz-pinned.integration.spec.ts`,
      `${dir}/sync-fuzz-seeds.benchmark.ts`,
      `${dir}/sync-fuzz-pinned-traces.json`,
      `${dir}/fake-super-sync-server.ts`,
    ]),
    [`${dir}/sync-fuzz-runner.ts`, `${dir}/fake-super-sync-server.ts`],
  );
});

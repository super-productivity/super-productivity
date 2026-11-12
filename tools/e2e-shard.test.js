const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assignShards,
  countTestsPerFile,
  mergeDurations,
  parseArgs,
  parseJunitDurations,
  selectFiles,
  weighFiles,
} = require('./e2e-shard');

test('parseArgs reads shard options and the --only list', () => {
  assert.deepEqual(
    parseArgs([
      '--grep',
      '@supersync',
      '--shards=8',
      '--shard',
      '3',
      '--out',
      'x.txt',
      '--only',
      'sync/a.spec.ts sync/b.spec.ts',
    ]),
    {
      grep: '@supersync',
      shards: 8,
      shard: 3,
      out: 'x.txt',
      countOut: null,
      only: ['sync/a.spec.ts', 'sync/b.spec.ts'],
    },
  );
  assert.equal(
    parseArgs([
      '--grep',
      'x',
      '--shards',
      '1',
      '--shard',
      '1',
      '--out',
      'o',
      '--only',
      '',
    ]).only,
    null,
  );
});

test('parseArgs rejects bad shard numbers and unknown flags', () => {
  const base = ['--grep', 'x', '--out', 'o'];
  assert.throws(
    () => parseArgs([...base, '--shards', '2', '--shard', '3']),
    /between 1 and 2/,
  );
  assert.throws(() => parseArgs([...base, '--shards', '0', '--shard', '1']), />= 1/);
  assert.throws(
    () => parseArgs([...base, '--shards', '2', '--shard', '1', '--x', '1']),
    /unknown/,
  );
  assert.throws(
    () => parseArgs(['--shards', '2', '--shard', '1', '--out', 'o']),
    /--grep/,
  );
});

test('parseArgs takes junit files for --update-durations', () => {
  assert.deepEqual(parseArgs(['--update-durations', 'a.xml', 'b.xml']), {
    updateDurations: ['a.xml', 'b.xml'],
  });
  assert.throws(() => parseArgs(['--update-durations']), /junit/);
});

test('countTestsPerFile sums tests per file across nested suites', () => {
  const json = {
    errors: [],
    suites: [
      {
        specs: [{ file: 'sync/a.spec.ts', tests: [{}, {}] }],
        suites: [{ specs: [{ file: 'sync/a.spec.ts', tests: [{}] }] }],
      },
      { specs: [{ file: 'sync/b.spec.ts', tests: [{}] }] },
    ],
  };
  assert.deepEqual(
    [...countTestsPerFile(json)],
    [
      ['sync/a.spec.ts', 3],
      ['sync/b.spec.ts', 1],
    ],
  );
});

test('countTestsPerFile refuses a listing with load errors', () => {
  // A spec that fails to load would silently drop out of every shard.
  assert.throws(
    () => countTestsPerFile({ errors: [{ message: 'Cannot find module' }], suites: [] }),
    /Cannot find module/,
  );
});

test('weighFiles estimates unmeasured files from the measured seconds per test', () => {
  const weighted = weighFiles(
    new Map([
      ['a', 2],
      ['b', 3],
      ['new', 4],
    ]),
    { a: 100, b: 150, gone: 999 },
  );
  assert.deepEqual(weighted, [
    { file: 'a', sec: 100, estimated: false },
    { file: 'b', sec: 150, estimated: false },
    { file: 'new', sec: 200, estimated: true },
  ]);
});

test('weighFiles falls back to a fixed per-test estimate without any data', () => {
  assert.deepEqual(weighFiles(new Map([['a', 2]]), {}), [
    { file: 'a', sec: 60, estimated: true },
  ]);
});

test('assignShards balances by duration, not by file order', () => {
  const shards = assignShards(
    [
      { file: 'a', sec: 10 },
      { file: 'b', sec: 10 },
      { file: 'c', sec: 10 },
      { file: 'd', sec: 30 },
    ],
    2,
  );
  assert.deepEqual(
    shards.map((s) => [s.sec, s.files]),
    [
      [30, ['d']],
      [30, ['a', 'b', 'c']],
    ],
  );
});

test('assignShards is deterministic regardless of input order', () => {
  const items = [
    { file: 'x', sec: 5 },
    { file: 'y', sec: 5 },
    { file: 'z', sec: 7 },
    { file: 'w', sec: 1 },
  ];
  const a = assignShards(items, 3);
  const b = assignShards([...items].reverse(), 3);
  assert.deepEqual(a, b);
});

test('assignShards leaves surplus shards empty', () => {
  const shards = assignShards([{ file: 'a', sec: 1 }], 3);
  assert.deepEqual(
    shards.map((s) => s.files),
    [['a'], [], []],
  );
});

test('selectFiles refuses an empty full suite', () => {
  // Playwright passes a --test-list run that found no tests, so an empty
  // listing would turn every shard green without running anything.
  assert.throws(
    () => selectFiles(new Map(), null, '@supersync'),
    /no tests match @supersync/,
  );
});

test('selectFiles narrows to --only and allows an empty result', () => {
  const counts = new Map([
    ['sync/a.spec.ts', 2],
    ['sync/b.spec.ts', 1],
  ]);
  assert.deepEqual(
    [...selectFiles(counts, ['sync/b.spec.ts', 'sync/x.spec.ts'], 't')],
    [['sync/b.spec.ts', 1]],
  );
  // A spec-only PR's changed spec may not carry this suite's tag.
  assert.equal(selectFiles(counts, ['sync/x.spec.ts'], 't').size, 0);
});

test('parseArgs reads --count-out', () => {
  assert.equal(
    parseArgs([
      '--grep',
      'x',
      '--shards',
      '1',
      '--shard',
      '1',
      '--out',
      'o',
      '--count-out',
      'c',
    ]).countOut,
    'c',
  );
});

test('parseJunitDurations sums testsuite time per file across reports', () => {
  const report = (time) =>
    `<testsuites><testsuite name="sync/a &amp; b.spec.ts" timestamp="t" hostname="chromium" tests="2" time="${time}" errors="0">` +
    `<testcase name="x" classname="sync/a &amp; b.spec.ts" time="1"></testcase></testsuite></testsuites>`;
  assert.deepEqual(parseJunitDurations([report('12.5'), report('7.5')]), {
    'sync/a & b.spec.ts': 20,
  });
});

test('mergeDurations replaces measured files, keeps others, sorts keys', () => {
  assert.deepEqual(Object.entries(mergeDurations({ b: 1, a: 2 }, { b: 9.6, c: 3.2 })), [
    ['a', 2],
    ['b', 10],
    ['c', 3],
  ]);
});

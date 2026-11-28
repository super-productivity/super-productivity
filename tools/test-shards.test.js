const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, planShards, readResult, splitIntoShards } = require('./test-shards');

test('splitIntoShards balances by weight, largest first', () => {
  const files = [
    { file: 'a', weight: 5 },
    { file: 'b', weight: 4 },
    { file: 'c', weight: 3 },
    { file: 'd', weight: 3 },
    { file: 'e', weight: 1 },
  ];
  // a→1 (5), b→2 (4), c→2 (7), d→1 (8), e→2 (8)
  assert.deepEqual(splitIntoShards(files, 2), [
    ['a', 'd'],
    ['b', 'c', 'e'],
  ]);
});

test('splitIntoShards keeps every file exactly once and leaves extra shards empty', () => {
  const files = [
    { file: 'x', weight: 1 },
    { file: 'y', weight: 1 },
  ];
  assert.deepEqual(splitIntoShards(files, 3), [['x'], ['y'], []]);
});

test('splitIntoShards is independent of input order', () => {
  const files = [
    { file: 'b', weight: 2 },
    { file: 'a', weight: 2 },
    { file: 'c', weight: 2 },
  ];
  assert.deepEqual(splitIntoShards(files, 2), splitIntoShards([...files].reverse(), 2));
});

test('parseArgs reads suites and shard flags', () => {
  assert.deepEqual(parseArgs(['berlin', 'la-subset', '--shards', '4']), {
    suites: ['berlin', 'la-subset'],
    shards: 4,
    shard: null,
  });
  assert.deepEqual(parseArgs(['la', '--shard=2/3']).shard, { index: 2, total: 3 });
});

test('parseArgs rejects bad input', () => {
  assert.throws(() => parseArgs([]), /name a suite/);
  assert.throws(() => parseArgs(['tokyo']), /unknown argument/);
  assert.throws(() => parseArgs(['la', '--shard', '3/2']), /--shard needs/);
  assert.throws(() => parseArgs(['la', '--shards', '0']), /positive integer/);
  assert.throws(() => parseArgs(['la', '--shards', '2', '--shard', '1/2']), /not both/);
});

test('readResult returns the last Karma result line', () => {
  const log = [
    'Chrome Headless: Executed 10 of 20155 SUCCESS (1 sec / 0.5 secs)',
    '\x1b[32mChrome Headless: Executed 20153 of 20155 (skipped 2)\x1b[39m\x1b[32m SUCCESS\x1b[39m (3 mins)',
  ].join('\n');
  assert.deepEqual(readResult(log), { executed: 20153, total: 20155, ok: true });
  assert.deepEqual(readResult('Executed 3 of 4 (1 FAILED) FAILED'), {
    executed: 3,
    total: 4,
    ok: false,
  });
  assert.equal(readResult('no karma output'), null);
});

const fakeSpecs = {
  berlin: [
    { file: 'src/a.spec.ts', weight: 4 },
    { file: 'src/b.spec.ts', weight: 3 },
    { file: 'src/c.spec.ts', weight: 2 },
    { file: 'src/d.spec.ts', weight: 1 },
  ],
  la: [
    { file: 'src/a.spec.ts', weight: 4 },
    { file: 'src/b.spec.ts', weight: 3 },
  ],
  'la-subset': [{ file: 'src/a.tz.spec.ts', weight: 2 }],
};
const listFake = (suite) => fakeSpecs[suite];

test('planShards splits large suites by path and runs small ones by glob', () => {
  const plan = planShards({ suites: ['berlin', 'la-subset'], shards: 2 }, listFake);
  assert.deepEqual(
    plan.map((job) => [job.label, job.tz, job.files]),
    [
      ['berlin 1/2', 'Europe/Berlin', ['src/a.spec.ts', 'src/d.spec.ts']],
      ['berlin 2/2', 'Europe/Berlin', ['src/b.spec.ts', 'src/c.spec.ts']],
      ['la-subset 1/1', 'America/Los_Angeles', ['src/a.tz.spec.ts']],
    ],
  );
  assert.deepEqual(plan[0].includes, ['src/a.spec.ts', 'src/d.spec.ts']);
  // one shard: the npm script's globs, exactly what `test:tz:la:subset` passes
  assert.ok(plan[2].includes.includes('**/*.tz.spec.ts'));
});

test('planShards with --shard runs only that shard, with its CI total', () => {
  const plan = planShards({ suites: ['la'], shard: { index: 2, total: 2 } }, listFake);
  assert.deepEqual(
    plan.map((job) => [job.label, job.includes]),
    [['la 2/2', ['src/b.spec.ts']]],
  );
});

test('planShards with one shard runs a full suite without --include', () => {
  const plan = planShards({ suites: ['berlin'], shards: 1 }, listFake);
  assert.deepEqual(
    plan.map((job) => [job.label, job.includes]),
    [['berlin 1/1', []]],
  );
});

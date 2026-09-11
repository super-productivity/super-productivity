const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTORESPONSE,
  buildComment,
  buildSearchQueries,
  isStale,
  parseModelJson,
  parseVersion,
  pickLabels,
  pickRelated,
} = require('./triage.js');

test('parseModelJson tolerates the fenced blocks the model keeps emitting', () => {
  assert.deepEqual(parseModelJson('```json\n{"type":"bug"}\n```'), { type: 'bug' });
  assert.deepEqual(parseModelJson('Sure! {"type":"bug"} Hope that helps.'), {
    type: 'bug',
  });
});

test('parseModelJson returns null rather than throwing on unusable output', () => {
  for (const raw of ['', null, undefined, 'no json here', '{not json}', '[1,2]']) {
    assert.equal(parseModelJson(raw), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

test('pickLabels keeps only labels that exist in the repo', () => {
  const { labels, missing } = pickLabels({
    type: 'bug',
    platforms: ['android', 'firefox'],
    missing: ['version'],
  });
  assert.deepEqual(labels, ['bug', 'android', 'firefox', 'needs clarification']);
  assert.deepEqual(missing, ['version']);
});

test('pickLabels drops labels the model invented', () => {
  const { labels, missing } = pickLabels({
    type: 'wontfix',
    platforms: ['windows', 'haiku', '../../etc/passwd'],
    missing: ['delete_repo', 'steps'],
  });
  assert.deepEqual(labels, ['windows', 'needs clarification']);
  assert.deepEqual(missing, ['steps']);
});

test('pickLabels survives a malformed or absent classification', () => {
  for (const triage of [null, {}, { platforms: 'android', missing: 7 }]) {
    assert.deepEqual(pickLabels(triage), { labels: [], missing: [] });
  }
});

test('buildSearchQueries strips anything GitHub would read as a qualifier', () => {
  assert.deepEqual(
    buildSearchQueries({ searchTerms: ['repo:evil/x secret', 'is:pr "quoted" OR boom'] }),
    ['repo evil x secret', 'is pr quoted boom'],
  );
});

test('buildSearchQueries strips a leading hyphen so no word becomes an exclusion', () => {
  assert.deepEqual(
    buildSearchQueries({
      searchTerms: ['-sync conflict', 'drag --drop', 'non-blocking'],
    }),
    ['sync conflict', 'drag drop', 'non-blocking'],
  );
});

test('buildSearchQueries caps the query count and drops stubs', () => {
  const queries = buildSearchQueries({
    searchTerms: ['ab', 'sync conflict', 'a b', 'c d', 'e f'],
  });
  assert.equal(queries.length, 3);
  assert.ok(!queries.includes('ab'));
});

test('pickRelated only returns numbers retrieval actually found', () => {
  const found = [
    { number: 12, state: 'open' },
    { number: 34, state: 'closed' },
  ];
  assert.deepEqual(pickRelated('{"related":[12,99,12]}', found), [
    { number: 12, state: 'open' },
  ]);
  assert.deepEqual(pickRelated('{"related":[9999]}', found), []);
  assert.deepEqual(pickRelated('{"related":["12"]}', found), []);
  assert.deepEqual(pickRelated('garbage', found), []);
  assert.deepEqual(pickRelated('{"related":[12]}', undefined), []);
});

test('pickLabels ignores inherited Object properties', () => {
  // `key in obj` and `obj[key]` both walk the prototype, so a model answering
  // "constructor" or "toString" used to slip past both allowlists.
  assert.deepEqual(pickLabels({ type: 'constructor', platforms: ['android'] }), {
    labels: ['android'],
    missing: [],
  });
  assert.deepEqual(pickLabels({ type: 'bug', missing: ['toString', 'hasOwnProperty'] }), {
    labels: ['bug'],
    missing: [],
  });
});

test('buildComment cannot be made to render a prototype member', () => {
  const { missing } = pickLabels({ missing: ['toString'] });
  assert.equal(buildComment({ missing }), AUTORESPONSE);
});

test('parseModelJson stops at the brace that balances the first one', () => {
  assert.deepEqual(parseModelJson('{"type":"bug"} see the docs {here}'), { type: 'bug' });
  assert.deepEqual(parseModelJson('noise {"a":{"b":1}} tail}'), { a: { b: 1 } });
  assert.deepEqual(parseModelJson('{"a":"}"}'), { a: '}' });
});

test('buildComment separates closed matches from open ones', () => {
  const body = buildComment({
    related: [
      { number: 11, state: 'open' },
      { number: 22, state: 'closed' },
    ],
  });
  assert.match(body, /Possibly related: #11\./);
  assert.match(body, /already closed: #22\./);
});

test('buildComment only adds the staleness note for bugs', () => {
  const stale = { reportedVersion: '7.12.0', latestTag: 'v18.21.2' };
  assert.ok(buildComment({ type: 'bug', ...stale }).includes('You reported **v7.12.0**'));
  for (const type of ['enhancement', 'question', 'unclear', undefined]) {
    assert.equal(buildComment({ type, ...stale }), AUTORESPONSE, `type ${type}`);
  }
});

test('isStale fires a minor behind but tolerates patch drift', () => {
  const latest = parseVersion('v18.21.2');
  assert.equal(isStale(parseVersion('18.20.9'), latest), true);
  assert.equal(isStale(parseVersion('7.12.0'), latest), true);
  assert.equal(isStale(parseVersion('18.21.0'), latest), false);
  assert.equal(isStale(parseVersion('19.0.0'), latest), false);
});

test('parseVersion rejects non-versions instead of guessing', () => {
  for (const raw of ['latest', 'newest', '', null, '<img src=x>']) {
    assert.equal(parseVersion(raw), null);
  }
  assert.deepEqual(parseVersion('v7.12.0 snap'), { major: 7, minor: 12, text: '7.12.0' });
});

test('buildComment is exactly the old autoresponse when triage found nothing', () => {
  assert.equal(buildComment({}), AUTORESPONSE);
  assert.equal(
    buildComment({ missing: [], related: [], reportedVersion: null }),
    AUTORESPONSE,
  );
});

test('buildComment appends only the sections that apply', () => {
  const body = buildComment({
    type: 'bug',
    missing: ['version', 'syncProvider'],
    reportedVersion: '7.12.0',
    latestTag: 'v18.21.2',
    related: [
      { number: 4242, state: 'open' },
      { number: 4243, state: 'open' },
    ],
  });
  assert.ok(body.startsWith(AUTORESPONSE));
  assert.ok(body.includes('**Version**'));
  assert.ok(body.includes('**Sync provider**'));
  assert.ok(body.includes('You reported **v7.12.0**'));
  assert.ok(body.includes('#4242, #4243'));
  assert.ok(!body.includes('**Steps to reproduce**'));
});

test('buildComment never echoes a model-authored version string', () => {
  const body = buildComment({
    type: 'bug',
    reportedVersion: '7.12.0 <script>alert(1)</script>',
    latestTag: 'v18.21.2',
  });
  assert.ok(body.includes('**v7.12.0**'));
  assert.ok(!body.includes('script'));
});

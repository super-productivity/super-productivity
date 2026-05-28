const test = require('node:test');
const assert = require('node:assert/strict');

const { __test, getAndroidVersionInfo } = require('./release-notes');

const parse = (subject) => __test.parseCommitSubject(subject);

test('calculates stable and pre-release Android version codes', () => {
  assert.deepEqual(getAndroidVersionInfo('18.5.0'), {
    baseVersion: '18.5.0',
    isPreRelease: false,
    versionCode: 1805009000,
    versionCodeWithUnderscores: '18_05_00_9000',
  });

  assert.deepEqual(getAndroidVersionInfo('18.6.0-RC.2'), {
    baseVersion: '18.6.0',
    isPreRelease: true,
    versionCode: 1806000002,
    versionCodeWithUnderscores: '18_06_00_0002',
  });
});

test('parses conventional and plain commit subjects', () => {
  assert.deepEqual(parse('fix(sync): keep Dropbox refresh token'), {
    type: 'fix',
    scope: 'sync',
    description: 'keep Dropbox refresh token',
    raw: 'fix(sync): keep Dropbox refresh token',
  });

  assert.deepEqual(parse('plain release note'), {
    type: null,
    scope: null,
    description: 'plain release note',
    raw: 'plain release note',
  });
});

test('keeps first duplicate release-note description only', () => {
  const commits = [
    parse('fix(sync): Avoid duplicate task import'),
    parse('fix(tasks): avoid duplicate task import'),
    parse('feat(theme): add blur slider'),
  ];

  assert.deepEqual(
    __test.uniqueByDescription(commits).map((commit) => commit.raw),
    ['fix(sync): Avoid duplicate task import', 'feat(theme): add blur slider'],
  );
});

test('filters to user-facing commits and falls back when only internal commits exist', () => {
  const mixedCommits = [
    parse('test(sync): stabilize flaky test'),
    parse('build(release): add automated release notes'),
    parse('fix(sync): repair archive hydration'),
    parse('docs: update wiki'),
  ];
  assert.deepEqual(
    __test.getUserFacingCommits(mixedCommits).map((commit) => commit.raw),
    ['fix(sync): repair archive hydration'],
  );

  const internalCommits = [
    parse('test(sync): stabilize flaky test'),
    parse('build(release): add automated release notes'),
    parse('docs: update wiki'),
  ];
  assert.deepEqual(
    __test.getUserFacingCommits(internalCommits).map((commit) => commit.raw),
    [
      'test(sync): stabilize flaky test',
      'build(release): add automated release notes',
      'docs: update wiki',
    ],
  );
});

test('groups GitHub markdown by semantic commit type', () => {
  const markdown = __test.toGroupedGithubMarkdown([
    parse('feat(theme): add blur slider'),
    parse('fix(sync): repair archive hydration'),
    parse('perf(android): prewarm WebView'),
    parse('docs: update wiki'),
  ]);

  assert.match(markdown, /### Features\n\n- \*\*theme:\*\* add blur slider/);
  assert.match(markdown, /### Fixes\n\n- \*\*sync:\*\* repair archive hydration/);
  assert.match(markdown, /### Performance\n\n- \*\*android:\*\* prewarm WebView/);
  assert.match(markdown, /### Other Changes\n\n- update wiki/);
});

test('normalizes Play Store text and enforces the character limit', () => {
  const normalized = __test.normalizePlayStoreText(
    `- Fixed [sync](https://example.com) issues\r\n${'x'.repeat(600)}`,
  );

  assert.equal(normalized, '- Fixed sync issues');
  assert.ok(normalized.length <= 500);
});

test('parses fenced AI JSON and constrains Play Store output', () => {
  const response = `\`\`\`json
${JSON.stringify({
  githubMarkdown: '### Fixes\n\n- Fixed sync',
  playStore: `- Fixed [sync](https://example.com)\n${'x'.repeat(600)}`,
})}
\`\`\``;

  const parsed = __test.parseAiResponse(response);

  assert.equal(parsed.githubMarkdown, '### Fixes\n\n- Fixed sync');
  assert.equal(parsed.playStore, '- Fixed sync');
  assert.ok(parsed.playStore.length <= 500);
});

test('resolves explicit AI provider environment values', () => {
  assert.equal(
    __test.resolveAiProvider({
      env: { SP_RELEASE_NOTES_AI: 'claude' },
      isInteractive: false,
    }),
    'claude',
  );
  assert.equal(
    __test.resolveAiProvider({
      env: { SP_RELEASE_NOTES_AI: 'false' },
      isInteractive: true,
      lifecycleEvent: 'version',
      prompt: () => '',
    }),
    null,
  );
  assert.equal(
    __test.resolveAiProvider({
      env: { SP_RELEASE_NOTES_AI: '1', SP_RELEASE_NOTES_AI_PROVIDER: 'claude' },
      isInteractive: false,
    }),
    'claude',
  );
});

test('prompts during npm version only and defaults to AI on enter', () => {
  assert.equal(
    __test.resolveAiProvider({
      env: {},
      isInteractive: true,
      lifecycleEvent: 'version',
      prompt: () => '',
    }),
    'codex',
  );
  assert.equal(
    __test.resolveAiProvider({
      env: {},
      isInteractive: true,
      lifecycleEvent: 'version',
      prompt: () => 'n',
    }),
    null,
  );
  assert.equal(
    __test.resolveAiProvider({
      env: {},
      isInteractive: true,
      lifecycleEvent: 'release-notes:generate',
      prompt: () => '',
    }),
    null,
  );
  assert.equal(
    __test.resolveAiProvider({
      env: {},
      isInteractive: false,
      lifecycleEvent: 'version',
      prompt: () => '',
    }),
    null,
  );
});

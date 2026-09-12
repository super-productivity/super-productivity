const test = require('node:test');
const assert = require('node:assert/strict');

const {
  __test,
  getAndroidVersionInfo,
  resolveReleaseBaseTag,
} = require('./release-notes');

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

const withSilencedWarnings = async (run) => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.warn = originalWarn;
  }
};

const publishedReleases = [
  { tag_name: 'v19.0.0', draft: true, prerelease: false },
  { tag_name: 'v18.22.0', draft: true, prerelease: false },
  { tag_name: 'v18.22.0-RC.1', draft: false, prerelease: true },
  { tag_name: 'v18.21.1', draft: false, prerelease: false },
  { tag_name: 'v18.21.0', draft: false, prerelease: false },
];

test('picks the newest published release tag and skips drafts', () => {
  assert.equal(
    __test.pickPublishedBaseTag({
      releases: publishedReleases,
      version: '19.0.1',
      stableOnly: true,
      isUsableTag: () => true,
    }),
    'v18.21.1',
  );
});

test('picks a published pre-release as base for a pre-release version', () => {
  assert.equal(
    __test.pickPublishedBaseTag({
      releases: publishedReleases,
      version: '19.0.0-RC.1',
      stableOnly: false,
      isUsableTag: () => true,
    }),
    'v18.22.0-RC.1',
  );
});

test('skips the version being released and tags missing from the current history', () => {
  assert.equal(
    __test.pickPublishedBaseTag({
      releases: publishedReleases,
      version: '18.21.1',
      stableOnly: true,
      isUsableTag: () => true,
    }),
    'v18.21.0',
  );

  assert.equal(
    __test.pickPublishedBaseTag({
      releases: publishedReleases,
      version: '19.0.1',
      stableOnly: true,
      isUsableTag: (tag) => tag === 'v18.21.0',
    }),
    'v18.21.0',
  );

  assert.equal(
    __test.pickPublishedBaseTag({
      releases: [{ tag_name: 'v19.0.0', draft: true, prerelease: false }],
      version: '19.0.1',
      stableOnly: true,
      isUsableTag: () => true,
    }),
    undefined,
  );
});

test('resolves the release notes base from published releases', async () => {
  const baseTag = await withSilencedWarnings(() =>
    resolveReleaseBaseTag({
      version: '19.0.1',
      stableOnly: true,
      env: { GITHUB_REPOSITORY: 'super-productivity/super-productivity' },
      fetchImpl: async () => ({ ok: true, json: async () => publishedReleases }),
      isUsableTag: () => true,
      getFallbackTag: () => 'v19.0.0',
      timeoutMs: 50,
    }),
  );

  assert.equal(baseTag, 'v18.21.1');
});

test('falls back to the latest tag when published releases are unreadable', async () => {
  const unreachable = await withSilencedWarnings(() =>
    resolveReleaseBaseTag({
      version: '19.0.1',
      stableOnly: true,
      env: { GITHUB_REPOSITORY: 'super-productivity/super-productivity' },
      fetchImpl: async () => {
        throw new Error('network down');
      },
      isUsableTag: () => true,
      getFallbackTag: () => 'v19.0.0',
      timeoutMs: 50,
    }),
  );
  assert.equal(unreachable, 'v19.0.0');

  const rateLimited = await withSilencedWarnings(() =>
    resolveReleaseBaseTag({
      version: '19.0.1',
      stableOnly: true,
      env: { GITHUB_REPOSITORY: 'super-productivity/super-productivity' },
      fetchImpl: async () => ({ ok: false, status: 403 }),
      isUsableTag: () => true,
      getFallbackTag: () => 'v19.0.0',
      timeoutMs: 50,
    }),
  );
  assert.equal(rateLimited, 'v19.0.0');
});

test('prefers an explicit release notes base over any lookup', async () => {
  const baseTag = await withSilencedWarnings(() =>
    resolveReleaseBaseTag({
      version: '19.0.1',
      stableOnly: true,
      env: {
        GITHUB_REPOSITORY: 'super-productivity/super-productivity',
        SP_RELEASE_NOTES_BASE_TAG: 'v18.21.1',
      },
      fetchImpl: async () => {
        throw new Error('must not be called');
      },
      getFallbackTag: () => 'v19.0.0',
    }),
  );

  assert.equal(baseTag, 'v18.21.1');
});

test('reads the repository slug from the environment', () => {
  assert.equal(
    __test.getRepoSlug({ GITHUB_REPOSITORY: 'super-productivity/super-productivity' }),
    'super-productivity/super-productivity',
  );
});

test('treats npm version commits as noise, not release notes', () => {
  assert.deepEqual(
    ['19.0.1', 'v18.22.0', '19.1.0-RC.2', 'fix(sync): keep section order'].map(
      __test.isVersionBumpSubject,
    ),
    [true, true, true, false],
  );
});

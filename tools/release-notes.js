const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const PLAY_STORE_MAX_CHARS = 500;
const DEFAULT_CHANGELOG = 'Bug fixes and improvements';
const DOWNLOADS_NOTE =
  'For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).';

const GENERATED_RELEASE_NOTES_DIR = path.join(
  ROOT_DIR,
  'build',
  'generated-release-notes',
);
const PLAY_STORE_WHATS_NEW_DIR = path.join(GENERATED_RELEASE_NOTES_DIR, 'play-store');
const PLAY_STORE_WHATS_NEW_FILE = path.join(PLAY_STORE_WHATS_NEW_DIR, 'whatsnew-en-US');
const GITHUB_RELEASE_NOTES_FILE = path.join(ROOT_DIR, 'build', 'release-notes.md');

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_API_TIMEOUT_MS = 10000;
const STABLE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
// `npm version` commits carry the bare version as their subject. A base that is
// the last published release can span several of them, so drop them as noise.
const VERSION_BUMP_SUBJECT_PATTERN = /^v?\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const RELEASE_TAG_PATTERN = /^v/;

const USER_FACING_TYPES = new Set(['feat', 'fix', 'perf']);
const LOW_SIGNAL_TYPES = new Set([
  'build',
  'chore',
  'ci',
  'docs',
  'refactor',
  'style',
  'test',
]);
const SUPPORTED_AI_PROVIDERS = new Set(['codex', 'claude']);
const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'none', 'off']);
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const GITHUB_GROUPS = [
  {
    heading: 'Features',
    isMatch: (commit) => commit.type === 'feat',
  },
  {
    heading: 'Fixes',
    isMatch: (commit) => commit.type === 'fix',
  },
  {
    heading: 'Performance',
    isMatch: (commit) => commit.type === 'perf',
  },
  {
    heading: 'Other Changes',
    isMatch: (commit) => !commit.type || !USER_FACING_TYPES.has(commit.type),
  },
];

const RELEASE_NOTES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['githubMarkdown', 'playStore'],
  properties: {
    githubMarkdown: {
      type: 'string',
      description: 'Markdown release notes for GitHub. Use concise grouped bullets.',
    },
    playStore: {
      type: 'string',
      description: 'Plain-text Google Play release notes, max 500 characters.',
    },
  },
};

const parseCommitSubject = (subject) => {
  const match = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  if (!match) {
    return {
      type: null,
      scope: null,
      description: subject.trim(),
      raw: subject.trim(),
    };
  }

  return {
    type: match[1].toLowerCase(),
    scope: match[2] || null,
    description: match[4].trim(),
    raw: subject.trim(),
  };
};

const getAndroidVersionInfo = (version) => {
  const versionParts = version.split('-');
  const baseVersion = versionParts[0];
  const preRelease = versionParts[1];
  const isPreRelease = !!preRelease;
  const baseVersionCode =
    Number(
      baseVersion
        .split('.')
        .map((num) => num.padStart(2, '0'))
        .join(''),
    ) * 10000;
  const preReleaseNum = isPreRelease
    ? parseInt(preRelease.split('.')[1] || '1', 10)
    : null;
  const versionCode = isPreRelease
    ? baseVersionCode + preReleaseNum
    : baseVersionCode + 9000;
  const versionCodeWithUnderscores = versionCode
    .toString()
    .padStart(10, '0')
    .replace(/^(\d{2})(\d{2})(\d{2})(\d{4})$/, '$1_$2_$3_$4');

  return {
    baseVersion,
    isPreRelease,
    versionCode,
    versionCodeWithUnderscores,
  };
};

const getLatestTag = ({ version, stableOnly = false }) =>
  execFileSync('git', ['tag', '--merged', 'HEAD', '--sort=-v:refname'], {
    encoding: 'utf8',
  })
    .split('\n')
    .find((tag) => {
      const releaseTag = tag.trim();
      if (releaseTag === `v${version}`) {
        return false;
      }
      return stableOnly
        ? STABLE_TAG_PATTERN.test(releaseTag)
        : RELEASE_TAG_PATTERN.test(releaseTag);
    })
    ?.trim();

const getRepoSlug = (env = process.env) => {
  if (env.GITHUB_REPOSITORY) {
    return env.GITHUB_REPOSITORY;
  }

  try {
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
    }).trim();
    return remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  } catch {
    return undefined;
  }
};

const isTagMergedIntoHead = (tag) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', `${tag}^{commit}`, 'HEAD'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

const fetchPublishedReleases = async ({
  repoSlug,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = GITHUB_API_TIMEOUT_MS,
}) => {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  const response = await fetchImpl(
    `${GITHUB_API_URL}/repos/${repoSlug}/releases?per_page=100`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'super-productivity-release-notes',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub API responded with ${response.status}`);
  }

  return response.json();
};

// Drafts are excluded: an abandoned or still-unpublished draft still leaves its
// tag behind, and basing the notes on that tag silently drops everything the
// unpublished versions contained. This assumes the API's newest-first order
// (created_at descending) matches version order, which holds for this repo's
// single-line release flow - a backport published after a newer release would
// need version sorting instead.
const pickPublishedBaseTag = ({
  releases,
  version,
  stableOnly,
  isUsableTag = isTagMergedIntoHead,
}) =>
  releases
    .filter((release) => {
      if (release.draft) {
        return false;
      }
      if (stableOnly && release.prerelease) {
        return false;
      }
      const tag = release.tag_name?.trim();
      if (!tag || tag === `v${version}`) {
        return false;
      }
      return stableOnly ? STABLE_TAG_PATTERN.test(tag) : RELEASE_TAG_PATTERN.test(tag);
    })
    .map((release) => release.tag_name.trim())
    .find((tag) => isUsableTag(tag));

// Every message here goes to stderr so that `base-tag` keeps stdout to the tag
// alone - the release workflow reads it through command substitution.
const resolveReleaseBaseTag = async ({
  version,
  stableOnly,
  env = process.env,
  fetchImpl = globalThis.fetch,
  isUsableTag = isTagMergedIntoHead,
  getFallbackTag = getLatestTag,
  timeoutMs = GITHUB_API_TIMEOUT_MS,
} = {}) => {
  const overrideTag = env.SP_RELEASE_NOTES_BASE_TAG?.trim();
  if (overrideTag) {
    console.warn(
      `Using release notes base from SP_RELEASE_NOTES_BASE_TAG: ${overrideTag}`,
    );
    return overrideTag;
  }

  const repoSlug = getRepoSlug(env);
  if (repoSlug) {
    try {
      const releases = await fetchPublishedReleases({
        repoSlug,
        env,
        fetchImpl,
        timeoutMs,
      });
      const publishedTag = pickPublishedBaseTag({
        releases,
        version,
        stableOnly,
        isUsableTag,
      });
      if (publishedTag) {
        console.warn(
          `Using the last published release as release notes base: ${publishedTag}`,
        );
        return publishedTag;
      }
      console.warn('Found no published GitHub release to use as release notes base');
    } catch (err) {
      console.warn(`Could not read published GitHub releases: ${err.message}`);
    }
  } else {
    console.warn(
      'Could not determine the GitHub repository to look up published releases',
    );
  }

  const fallbackTag = getFallbackTag({ version, stableOnly });
  if (!fallbackTag) {
    console.warn('Found no release notes base tag');
    return undefined;
  }

  console.warn(
    `Falling back to the latest ${stableOnly ? 'stable ' : ''}tag as release notes base: ${fallbackTag}. ` +
      'A tag whose release was never published would shorten the notes - review them before pushing.',
  );
  return fallbackTag;
};

const getCommitSubjectsSinceBaseTag = (baseTag) => {
  const readLast20Commits = () =>
    execFileSync('git', ['log', '-20', '--no-merges', '--pretty=format:%s'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);

  if (!baseTag) {
    console.warn('No release notes base tag - falling back to last 20 commits');
    return readLast20Commits();
  }

  try {
    return execFileSync(
      'git',
      ['log', `${baseTag}...HEAD`, '--no-merges', '--pretty=format:%s'],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);
  } catch (err) {
    console.warn(`Could not generate changelog since ${baseTag}: ${err.message}`);
    console.warn('Falling back to last 20 commits');
    return readLast20Commits();
  }
};

const isVersionBumpSubject = (subject) =>
  VERSION_BUMP_SUBJECT_PATTERN.test(subject.trim());

const uniqueByDescription = (commits) => {
  const seen = new Set();
  const result = [];

  for (const commit of commits) {
    const key = commit.description.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(commit);
  }

  return result;
};

const toBulletLines = (commits) =>
  commits.map((commit) => {
    const scope = commit.scope ? `**${commit.scope}:** ` : '';
    return `- ${scope}${commit.description}`;
  });

const toGroupedGithubMarkdown = (commits) => {
  const sections = [];

  for (const group of GITHUB_GROUPS) {
    const groupCommits = commits.filter(group.isMatch);
    if (groupCommits.length === 0) {
      continue;
    }
    sections.push(`### ${group.heading}\n\n${toBulletLines(groupCommits).join('\n')}`);
  }

  return sections.join('\n\n') || `### Highlights\n\n- ${DEFAULT_CHANGELOG}`;
};

const getUserFacingCommits = (commits) => {
  const userFacing = commits.filter((commit) => {
    if (commit.type && USER_FACING_TYPES.has(commit.type)) {
      return true;
    }
    return !commit.type || !LOW_SIGNAL_TYPES.has(commit.type);
  });

  return userFacing.length > 0 ? userFacing : commits;
};

const truncateAtLineBoundary = (text, maxChars) => {
  const lines = text.split('\n');
  let truncated = '';

  for (const line of lines) {
    const next = truncated ? `${truncated}\n${line}` : line;
    if (next.length > maxChars) {
      break;
    }
    truncated = next;
  }

  if (truncated) {
    return truncated;
  }

  return text.slice(0, maxChars).trim();
};

const toPlainTextBullets = (commits, maxChars = PLAY_STORE_MAX_CHARS) => {
  const text = commits
    .map((commit) => `- ${commit.description}`)
    .join('\n')
    .trim();

  return truncateAtLineBoundary(text || DEFAULT_CHANGELOG, maxChars) || DEFAULT_CHANGELOG;
};

const normalizePlayStoreText = (text) =>
  truncateAtLineBoundary(
    text
      .replace(/\r\n/g, '\n')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim() || DEFAULT_CHANGELOG,
    PLAY_STORE_MAX_CHARS,
  ) || DEFAULT_CHANGELOG;

const writeFileEnsuringDir = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
};

const readLineSync = () => {
  // Open /dev/tty directly when available: stdin (fd 0) may be in non-blocking
  // mode when this script is invoked through `npm run`, which makes
  // fs.readSync(0, ...) throw EAGAIN immediately. /dev/tty is always blocking.
  let fd = 0;
  let opened = false;
  try {
    fd = fs.openSync('/dev/tty', 'r');
    opened = true;
  } catch {
    fd = 0;
  }

  const buffer = Buffer.alloc(1);
  const chars = [];
  const sharedBuf = new SharedArrayBuffer(4);
  const waitView = new Int32Array(sharedBuf);

  try {
    while (true) {
      let bytesRead;
      try {
        bytesRead = fs.readSync(fd, buffer, 0, 1, null);
      } catch (err) {
        if (err.code === 'EAGAIN') {
          Atomics.wait(waitView, 0, 0, 20);
          continue;
        }
        throw err;
      }
      if (bytesRead === 0) {
        break;
      }

      const char = buffer.toString('utf8', 0, bytesRead);
      if (char === '\n') {
        break;
      }
      if (char !== '\r') {
        chars.push(char);
      }
    }
  } finally {
    if (opened) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }

  return chars.join('');
};

const promptGenerateReleaseNotesViaAi = () => {
  fs.writeSync(1, 'Generate release notes via AI? [Y/n] ');
  return readLineSync();
};

const getDefaultAiProvider = (env = process.env) =>
  env.SP_RELEASE_NOTES_AI_PROVIDER || 'codex';

const resolveAiProvider = ({
  env = process.env,
  isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  lifecycleEvent = env.npm_lifecycle_event,
  prompt = promptGenerateReleaseNotesViaAi,
} = {}) => {
  const explicitProvider = env.SP_RELEASE_NOTES_AI?.trim().toLowerCase();

  if (explicitProvider) {
    if (FALSE_ENV_VALUES.has(explicitProvider)) {
      return null;
    }
    if (TRUE_ENV_VALUES.has(explicitProvider)) {
      return getDefaultAiProvider(env);
    }
    return explicitProvider;
  }

  if (lifecycleEvent !== 'version' || !isInteractive) {
    return null;
  }

  const answer = prompt().trim().toLowerCase();
  if (answer === '' || answer === 'y' || answer === 'yes') {
    return getDefaultAiProvider(env);
  }
  if (answer === 'n' || answer === 'no') {
    return null;
  }

  console.warn(`Unknown answer "${answer}" - using deterministic release notes`);
  return null;
};

const runCodexReleaseNotes = ({ prompt }) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-release-notes-'));
  const schemaFile = path.join(tmpDir, 'schema.json');
  const outputFile = path.join(tmpDir, 'release-notes.json');

  fs.writeFileSync(schemaFile, JSON.stringify(RELEASE_NOTES_SCHEMA), 'utf8');

  execFileSync(
    'codex',
    [
      '--ask-for-approval',
      'never',
      'exec',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--output-schema',
      schemaFile,
      '--output-last-message',
      outputFile,
      '-',
    ],
    {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      input: prompt,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  return fs.readFileSync(outputFile, 'utf8');
};

const runClaudeReleaseNotes = ({ prompt }) =>
  execFileSync(
    'claude',
    [
      '-p',
      '--tools',
      '',
      '--output-format',
      'text',
      '--json-schema',
      JSON.stringify(RELEASE_NOTES_SCHEMA),
      prompt,
    ],
    {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

const parseAiResponse = (response) => {
  const jsonText = response.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
  const parsed = JSON.parse(jsonText);

  if (
    typeof parsed.githubMarkdown !== 'string' ||
    typeof parsed.playStore !== 'string' ||
    parsed.githubMarkdown.trim().length === 0 ||
    parsed.playStore.trim().length === 0
  ) {
    throw new Error('AI release notes response did not match the expected shape');
  }

  return {
    githubMarkdown: parsed.githubMarkdown.trim(),
    playStore: normalizePlayStoreText(parsed.playStore),
  };
};

const buildAiPrompt = ({
  version,
  commits,
  deterministicGithubMarkdown,
  playStoreText,
}) => `You are writing release notes for Super Productivity, an open-source todo and time-tracking app.

Rewrite the raw commit subjects into user-facing release notes.

Rules:
- Do not invent features, fixes, issue numbers, platforms, or claims.
- Prefer user-facing changes over internal build/test/refactor details.
- Keep GitHub notes concise and grouped with markdown headings and bullets.
- Keep Play Store notes plain text, no markdown links, max ${PLAY_STORE_MAX_CHARS} characters.
- Return JSON only, matching the provided schema.

Version: ${version}

Raw commits:
${JSON.stringify(commits, null, 2)}

Deterministic fallback GitHub notes:
${deterministicGithubMarkdown}

Deterministic fallback Play Store notes:
${playStoreText}
`;

const getAiReleaseNotes = ({
  version,
  commits,
  deterministicGithubMarkdown,
  playStoreText,
}) => {
  const provider = resolveAiProvider();
  if (!provider) {
    return null;
  }

  if (!SUPPORTED_AI_PROVIDERS.has(provider)) {
    const message = `Unsupported release notes AI provider "${provider}". Expected codex or claude.`;
    if (process.env.SP_RELEASE_NOTES_AI_REQUIRED === '1') {
      throw new Error(message);
    }
    console.warn(message);
    console.warn('Falling back to deterministic release notes');
    return null;
  }

  const prompt = buildAiPrompt({
    version,
    commits,
    deterministicGithubMarkdown,
    playStoreText,
  });

  try {
    const response =
      provider === 'claude'
        ? runClaudeReleaseNotes({ prompt })
        : runCodexReleaseNotes({ prompt });
    const aiNotes = parseAiResponse(response);
    console.log(`Using ${provider} generated release notes`);
    return aiNotes;
  } catch (err) {
    const message = `Could not generate AI release notes with ${provider}: ${err.message}`;
    if (process.env.SP_RELEASE_NOTES_AI_REQUIRED === '1') {
      throw new Error(message);
    }
    console.warn(message);
    console.warn('Falling back to deterministic release notes');
    return null;
  }
};

const getAndroidFastlaneChangelogFile = (versionCode) =>
  path.join(
    ROOT_DIR,
    'android',
    'fastlane',
    'metadata',
    'android',
    'en-US',
    'changelogs',
    `${versionCode}.txt`,
  );

const getLegacyFastlaneChangelogFile = (versionCode) =>
  path.join(
    ROOT_DIR,
    'fastlane',
    'metadata',
    'android',
    'en-US',
    'changelogs',
    `${versionCode}.txt`,
  );

const generateReleaseNotes = async ({ version, versionCode, isPreRelease }) => {
  const baseTag = await resolveReleaseBaseTag({
    version,
    stableOnly: !isPreRelease,
  });
  const commits = uniqueByDescription(
    getCommitSubjectsSinceBaseTag(baseTag)
      .filter((subject) => !isVersionBumpSubject(subject))
      .map(parseCommitSubject),
  );
  const releaseCommits =
    commits.length > 0 ? commits : [parseCommitSubject(DEFAULT_CHANGELOG)];
  const userFacingCommits = getUserFacingCommits(releaseCommits);
  const deterministicGithubMarkdown = toGroupedGithubMarkdown(userFacingCommits);
  const deterministicPlayStoreText = toPlainTextBullets(userFacingCommits);
  const aiReleaseNotes = getAiReleaseNotes({
    version,
    commits: releaseCommits,
    deterministicGithubMarkdown,
    playStoreText: deterministicPlayStoreText,
  });
  const githubReleaseNotes = `${DOWNLOADS_NOTE}

${aiReleaseNotes?.githubMarkdown || deterministicGithubMarkdown}
`;

  writeFileEnsuringDir(GITHUB_RELEASE_NOTES_FILE, githubReleaseNotes);
  console.log(`Wrote GitHub release notes to ${GITHUB_RELEASE_NOTES_FILE}`);

  if (isPreRelease) {
    console.log('Pre-release version - skipping Play Store changelog generation');
    return;
  }

  const playStoreChangelog = aiReleaseNotes?.playStore || deterministicPlayStoreText;
  const androidFastlaneChangelogFile = getAndroidFastlaneChangelogFile(versionCode);
  writeFileEnsuringDir(androidFastlaneChangelogFile, playStoreChangelog);

  console.log(
    `Wrote Android changelog for ${version} to ${androidFastlaneChangelogFile}`,
  );
};

const preparePlayStoreReleaseNotes = ({ versionCode }) => {
  const candidates = [
    getAndroidFastlaneChangelogFile(versionCode),
    getLegacyFastlaneChangelogFile(versionCode),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    throw new Error(`No versioned Play Store changelog found for ${versionCode}`);
  }

  const sourceText = fs.readFileSync(source, 'utf8');
  const playStoreChangelog =
    truncateAtLineBoundary(
      sourceText.trim() || DEFAULT_CHANGELOG,
      PLAY_STORE_MAX_CHARS,
    ) || DEFAULT_CHANGELOG;

  writeFileEnsuringDir(PLAY_STORE_WHATS_NEW_FILE, playStoreChangelog);

  console.log(`Prepared Google Play release notes from ${source}`);
  console.log(`Wrote Google Play release notes to ${PLAY_STORE_WHATS_NEW_FILE}`);
};

const getCurrentPackageVersion = () =>
  JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version;

const runCommand = async (command) => {
  const version = getCurrentPackageVersion();
  const versionInfo = getAndroidVersionInfo(version);

  if (command === 'generate') {
    await generateReleaseNotes({ version, ...versionInfo });
  } else if (command === 'prepare-play-store') {
    preparePlayStoreReleaseNotes(versionInfo);
  } else if (command === 'base-tag') {
    const baseTag = await resolveReleaseBaseTag({
      version,
      stableOnly: !versionInfo.isPreRelease,
    });
    process.stdout.write(baseTag ? `${baseTag}\n` : '');
  } else {
    console.error(`Unknown release notes command: ${command}`);
    process.exit(1);
  }
};

if (require.main === module) {
  runCommand(process.argv[2] || 'generate').catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  getAndroidVersionInfo,
  generateReleaseNotes,
  preparePlayStoreReleaseNotes,
  resolveReleaseBaseTag,
  __test: {
    getRepoSlug,
    getUserFacingCommits,
    isVersionBumpSubject,
    normalizePlayStoreText,
    parseAiResponse,
    parseCommitSubject,
    pickPublishedBaseTag,
    resolveAiProvider,
    toGroupedGithubMarkdown,
    toPlainTextBullets,
    truncateAtLineBoundary,
    uniqueByDescription,
  },
};

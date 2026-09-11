import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateMigrationRegistry } from '../src/migrate';
import { MIGRATIONS } from '../src/migrations';
import { CURRENT_SCHEMA_VERSION } from '../src/schema-version';

type RuntimeSurface = 'reducer' | 'persistence' | 'cursor';

interface SharedSchemaEvidence {
  kind: 'shared-schema-spec';
  specPath: `tests/${string}.spec.ts`;
}

interface ReleasedOracleEvidence {
  kind: 'pinned-released-oracle';
  oracleSpecPath: `tests/released-client-oracles/${string}.spec.ts`;
  cohorts: readonly {
    releaseTag: `v${string}`;
    commitSha: string;
    sourcePath: string;
    sourceBlobSha: string;
  }[];
}

interface CompatibilityAssessment {
  toVersion: number;
  runtimeSurfaces: readonly RuntimeSurface[];
  evidence: SharedSchemaEvidence | ReleasedOracleEvidence;
}

const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA1_PATTERN = /^(?!0{40}$)[0-9a-f]{40}$/;
const ALL_ZERO_SHA1 = '0'.repeat(40);

const GIT_LOCAL_ENVIRONMENT_VARIABLES = execFileSync(
  'git',
  ['rev-parse', '--local-env-vars'],
  { encoding: 'utf8' },
)
  .trim()
  .split(/\r?\n/);

const createGitEnvironment = (): NodeJS.ProcessEnv => {
  const environment = { ...process.env, GIT_NO_LAZY_FETCH: '1' };
  // Git hooks export repository-local state that takes precedence over `git -C`.
  for (const variableName of GIT_LOCAL_ENVIRONMENT_VARIABLES) {
    delete environment[variableName];
  }
  return environment;
};

const runGit = (repositoryRoot: string, args: string[]): string =>
  execFileSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    env: createGitEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const tryGit = (repositoryRoot: string, args: string[]): string | undefined => {
  try {
    return runGit(repositoryRoot, args);
  } catch {
    return undefined;
  }
};

const validateReleasedOracleProvenance = (
  cohort: ReleasedOracleEvidence['cohorts'][number],
  repositoryRoot: string,
): string[] => {
  const errors: string[] = [];
  const isShallow =
    tryGit(repositoryRoot, ['rev-parse', '--is-shallow-repository']) === 'true';
  const unavailableHint = isShallow
    ? ' (the shallow checkout does not contain the pinned provenance)'
    : '';
  const tagCommit = RELEASE_TAG_PATTERN.test(cohort.releaseTag)
    ? tryGit(repositoryRoot, [
        'rev-parse',
        '--verify',
        `refs/tags/${cohort.releaseTag}^{commit}`,
      ])
    : undefined;
  const commitType = SHA1_PATTERN.test(cohort.commitSha)
    ? tryGit(repositoryRoot, ['cat-file', '-t', cohort.commitSha])
    : undefined;
  const sourceBlob =
    SHA1_PATTERN.test(cohort.commitSha) && cohort.sourcePath.length > 0
      ? tryGit(repositoryRoot, [
          'rev-parse',
          '--verify',
          `${cohort.commitSha}:${cohort.sourcePath}`,
        ])
      : undefined;
  const sourceBlobType = sourceBlob
    ? tryGit(repositoryRoot, ['cat-file', '-t', sourceBlob])
    : undefined;

  if (tagCommit !== cohort.commitSha) {
    errors.push(
      `Invalid or unavailable release tag pin: ${cohort.releaseTag}${unavailableHint}`,
    );
  }
  if (commitType !== 'commit') {
    errors.push(
      `Invalid or unavailable commit pin: ${cohort.commitSha}${unavailableHint}`,
    );
  }
  if (
    !SHA1_PATTERN.test(cohort.sourceBlobSha) ||
    sourceBlob !== cohort.sourceBlobSha ||
    sourceBlobType !== 'blob'
  ) {
    errors.push(
      `Invalid or unavailable source blob pin: ${cohort.sourceBlobSha}${unavailableHint}`,
    );
  }

  return errors;
};

const withTestGitRepository = (
  assertion: (
    repositoryRoot: string,
    cohort: ReleasedOracleEvidence['cohorts'][number],
  ) => void,
): void => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'released-oracle-provenance-'));
  try {
    runGit(repositoryRoot, ['init', '--quiet']);
    runGit(repositoryRoot, ['config', 'user.name', 'Compatibility Test']);
    runGit(repositoryRoot, ['config', 'user.email', 'compatibility@test.invalid']);
    writeFileSync(
      join(repositoryRoot, 'released-source.ts'),
      'export const value = 1;\n',
    );
    runGit(repositoryRoot, ['add', 'released-source.ts']);
    runGit(repositoryRoot, ['commit', '--quiet', '-m', 'released source']);
    runGit(repositoryRoot, ['tag', '-a', 'v1.2.3', '-m', 'v1.2.3']);

    const commitSha = runGit(repositoryRoot, ['rev-parse', 'HEAD']);
    const sourceBlobSha = runGit(repositoryRoot, [
      'rev-parse',
      `${commitSha}:released-source.ts`,
    ]);
    assertion(repositoryRoot, {
      releaseTag: 'v1.2.3',
      commitSha,
      sourcePath: 'released-source.ts',
      sourceBlobSha,
    });
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
};

/**
 * Schemas through v4 were reviewed historically, before this evidence gate.
 * This does not claim that the current-client forward-schema E2E exercises a
 * released legacy receiver.
 *
 * Do not add a generic old-app bundle here. Add one assessment per future
 * migration. A package-only migration may cite a shared-schema spec; behavior
 * reaching reducers, persistence, or cursor acknowledgement needs a small,
 * deterministic oracle pinned to the affected released cohort.
 */
const POLICY_BASELINE_SCHEMA_VERSION = 4;
const COMPATIBILITY_ASSESSMENTS: readonly CompatibilityAssessment[] = [];

const expectExistingSpec = (specPath: string): void => {
  expect(
    existsSync(resolve(process.cwd(), specPath)),
    `Compatibility evidence does not exist: ${specPath}`,
  ).toBe(true);
};

describe('released-client compatibility policy', () => {
  it('keeps temporary Git setup isolated from inherited hook environment', () => {
    const outerRepositoryRoot = mkdtempSync(join(tmpdir(), 'released-oracle-outer-'));
    const temporaryRepositoryRoot = mkdtempSync(join(tmpdir(), 'released-oracle-inner-'));
    const inheritedGitDir = process.env.GIT_DIR;
    const isolatedEnvironment = { ...process.env };
    for (const variableName of GIT_LOCAL_ENVIRONMENT_VARIABLES) {
      delete isolatedEnvironment[variableName];
    }

    try {
      execFileSync('git', ['-C', outerRepositoryRoot, 'init', '--quiet'], {
        env: isolatedEnvironment,
      });
      process.env.GIT_DIR = join(outerRepositoryRoot, '.git');

      try {
        runGit(temporaryRepositoryRoot, ['init', '--quiet']);
      } finally {
        if (inheritedGitDir === undefined) {
          delete process.env.GIT_DIR;
        } else {
          process.env.GIT_DIR = inheritedGitDir;
        }
      }

      expect(existsSync(join(temporaryRepositoryRoot, '.git'))).toBe(true);
      expect(
        execFileSync(
          'git',
          ['-C', outerRepositoryRoot, 'rev-parse', '--is-bare-repository'],
          { encoding: 'utf8', env: isolatedEnvironment },
        ).trim(),
      ).toBe('false');
    } finally {
      rmSync(outerRepositoryRoot, { recursive: true, force: true });
      rmSync(temporaryRepositoryRoot, { recursive: true, force: true });
    }
  });

  it('accepts a tag, commit, source path, and blob from one real Git provenance chain', () => {
    withTestGitRepository((repositoryRoot, cohort) => {
      expect(validateReleasedOracleProvenance(cohort, repositoryRoot)).toEqual([]);
    });
  });

  it('rejects fake and all-zero release provenance pins', () => {
    withTestGitRepository((repositoryRoot, cohort) => {
      const tamperedPins: readonly [ReleasedOracleEvidence['cohorts'][number], string][] =
        [
          [{ ...cohort, releaseTag: 'v9.9.9' }, 'release tag'],
          [{ ...cohort, commitSha: '1'.repeat(40) }, 'commit'],
          [{ ...cohort, sourceBlobSha: '2'.repeat(40) }, 'source blob'],
        ];

      for (const [pins, expectedError] of tamperedPins) {
        expect(validateReleasedOracleProvenance(pins, repositoryRoot)).toEqual(
          expect.arrayContaining([expect.stringContaining(expectedError)]),
        );
      }

      const allZeroErrors = validateReleasedOracleProvenance(
        {
          ...cohort,
          commitSha: ALL_ZERO_SHA1,
          sourceBlobSha: ALL_ZERO_SHA1,
        },
        repositoryRoot,
      );
      expect(allZeroErrors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('commit'),
          expect.stringContaining('source blob'),
        ]),
      );
    });
  });

  it('requires an explicit assessment for every schema after the audited baseline', () => {
    expect(validateMigrationRegistry()).toEqual([]);
    expect(CURRENT_SCHEMA_VERSION).toBe(MIGRATIONS.at(-1)?.toVersion);

    const migrationVersions = MIGRATIONS.filter(
      ({ toVersion }) => toVersion > POLICY_BASELINE_SCHEMA_VERSION,
    )
      .map(({ toVersion }) => toVersion)
      .sort((a, b) => a - b);
    const assessmentVersions = COMPATIBILITY_ASSESSMENTS.map(
      ({ toVersion }) => toVersion,
    ).sort((a, b) => a - b);

    expect(new Set(assessmentVersions).size).toBe(assessmentVersions.length);
    expect(assessmentVersions).toEqual(migrationVersions);
  });

  it('requires a pinned released oracle for runtime-visible migration semantics', () => {
    for (const assessment of COMPATIBILITY_ASSESSMENTS) {
      if (assessment.runtimeSurfaces.length === 0) {
        expect(assessment.evidence.kind).toBe('shared-schema-spec');
        if (assessment.evidence.kind === 'shared-schema-spec') {
          expectExistingSpec(assessment.evidence.specPath);
        }
        continue;
      }

      expect(assessment.evidence.kind).toBe('pinned-released-oracle');
      if (assessment.evidence.kind !== 'pinned-released-oracle') {
        continue;
      }

      expectExistingSpec(assessment.evidence.oracleSpecPath);
      expect(assessment.evidence.cohorts.length).toBeGreaterThan(0);
      const repositoryRoot = runGit(process.cwd(), ['rev-parse', '--show-toplevel']);
      for (const cohort of assessment.evidence.cohorts) {
        expect(validateReleasedOracleProvenance(cohort, repositoryRoot)).toEqual([]);
      }
    }
  });
});

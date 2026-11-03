import { GitlabCfg } from './gitlab.model';
import { DEFAULT_GITLAB_CFG } from './gitlab.const';
import { getGitlabSourceLabel } from './gitlab-issue-source.util';
import { IssueProvider } from '../../issue.model';
import {
  getIssueProviderInitials,
  getIssueProviderTooltip,
} from '../../mapping-helper/get-issue-provider-tooltip';

describe('getGitlabSourceLabel', () => {
  const cfg = (overrides: Partial<GitlabCfg> = {}): GitlabCfg => ({
    ...DEFAULT_GITLAB_CFG,
    project: 'old-org/old-project',
    ...overrides,
  });

  it('returns the project when no source is stored', () => {
    expect(getGitlabSourceLabel(cfg({ issueSource: undefined }))).toBe(
      'old-org/old-project',
    );
  });

  it('returns the group, not a leftover project, for the group source', () => {
    expect(getGitlabSourceLabel(cfg({ issueSource: 'group', group: 'my-org' }))).toBe(
      'my-org',
    );
  });

  it('returns nothing for all projects', () => {
    expect(getGitlabSourceLabel(cfg({ issueSource: 'all' }))).toBeUndefined();
  });
});

// Guards that the shared provider tooltip and initials use the source label.
describe('GitLab provider tooltip and initials', () => {
  const gitlabProvider = (overrides: Record<string, unknown> = {}): IssueProvider =>
    ({
      id: 'ip-1',
      issueProviderKey: 'GITLAB',
      project: 'old-org/old-project',
      ...overrides,
    }) as unknown as IssueProvider;

  it('uses the source label for tooltip and initials', () => {
    const provider = gitlabProvider({ issueSource: 'group', group: 'my-org' });
    expect(getIssueProviderTooltip(provider)).toBe('my-org');
    expect(getIssueProviderInitials(provider)).toBe('MY');
  });

  it('falls back to the provider key when there is no label', () => {
    expect(getIssueProviderTooltip(gitlabProvider({ issueSource: 'all' }))).toBe(
      'GITLAB',
    );
  });
});

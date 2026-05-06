import { IssueProviderKey, SearchResultItem } from '../../issue.model';
import { GiteaCfg } from './gitea.model';
import { GiteaIssue } from './gitea-issue.model';
import { formatGiteaIssueTitle } from './format-gitea-issue-title.util';

export const mapGiteaIssueToSearchResult = (issue: GiteaIssue): SearchResultItem => {
  return {
    title: formatGiteaIssueTitle(issue),
    titleHighlighted: formatGiteaIssueTitle(issue),
    issueType: 'GITEA' as IssueProviderKey,
    issueData: issue,
  };
};

// Gitea uses the issue number instead of issue id to track the issues
export const mapGiteaIssueIdToIssueNumber = (issue: GiteaIssue): GiteaIssue => {
  return { ...issue, id: issue.number };
};

// We need to filter as api does not do it for us
export const isIssueFromProject = (issue: GiteaIssue, cfg: GiteaCfg): boolean => {
  if (!issue.repository) {
    return false;
  }
  return issue.repository.full_name === cfg.repoFullname;
};

export const parseLabelList = (raw: string | null): string[] =>
  (raw ?? '')
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

// Gitea/Forgejo's two issue endpoints (`/repos/{o}/{r}/issues` and
// `/repos/issues/search`) historically disagree on whether `labels=a,b` means
// AND or OR (see go-gitea/gitea#33509), and Forgejo inherits the same code.
// We always filter labels client-side so behavior is consistent and independent
// of any server-side fixes.
export const isIssueIncludedByLabels = (
  issue: GiteaIssue,
  excludedLabelNames: readonly string[],
): boolean => {
  if (excludedLabelNames.length === 0) {
    return true;
  }
  const issueLabelNames = new Set((issue.labels ?? []).map((l) => l.name));
  return !excludedLabelNames.some((name) => issueLabelNames.has(name));
};

export const hasAllLabels = (
  issue: GiteaIssue,
  requiredLabelNames: readonly string[],
): boolean => {
  if (requiredLabelNames.length === 0) {
    return true;
  }
  const issueLabelNames = new Set((issue.labels ?? []).map((l) => l.name));
  return requiredLabelNames.every((name) => issueLabelNames.has(name));
};

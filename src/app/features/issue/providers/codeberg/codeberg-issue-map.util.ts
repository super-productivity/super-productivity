import { IssueProviderKey, SearchResultItem } from '../../issue.model';
import { CodebergCfg } from './codeberg.model';
import { CodebergIssue } from './codeberg-issue.model';
import { formatCodebergIssueTitle } from './format-codeberg-issue-title.util';

export const mapCodebergIssueToSearchResult = (issue: CodebergIssue): SearchResultItem => {
  return {
    title: formatCodebergIssueTitle(issue),
    titleHighlighted: formatCodebergIssueTitle(issue),
    issueType: 'CODEBERG' as IssueProviderKey,
    issueData: issue,
  };
};

// Codeberg uses the issue number instead of the database issue id to track issues in Super Productivity.
export const mapCodebergIssueIdToIssueNumber = (issue: CodebergIssue): CodebergIssue => {
  return { ...issue, id: issue.number };
};

// The search endpoint can return issues outside the prioritized repository.
// Keep the provider scoped to the configured repo.
export const isIssueFromProject = (issue: CodebergIssue, cfg: CodebergCfg): boolean => {
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

// Codeberg-style issue endpoints can differ on whether `labels=a,b` is
// treated as AND or OR. Keep label allow/deny filtering client-side so
// Codeberg behaves consistently across instances.
export const isIssueIncludedByLabels = (
  issue: CodebergIssue,
  excludedLabelNames: readonly string[],
): boolean => {
  if (excludedLabelNames.length === 0) {
    return true;
  }
  const issueLabelNames = new Set((issue.labels ?? []).map((l) => l.name));
  return !excludedLabelNames.some((name) => issueLabelNames.has(name));
};

export const hasAllLabels = (
  issue: CodebergIssue,
  requiredLabelNames: readonly string[],
): boolean => {
  if (requiredLabelNames.length === 0) {
    return true;
  }
  const issueLabelNames = new Set((issue.labels ?? []).map((l) => l.name));
  return requiredLabelNames.every((name) => issueLabelNames.has(name));
};

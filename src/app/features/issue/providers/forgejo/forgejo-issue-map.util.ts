import { IssueProviderKey, SearchResultItem } from '../../issue.model';
import { ForgejoCfg } from './forgejo.model';
import { ForgejoIssue } from './forgejo-issue.model';
import { formatForgejoIssueTitle } from './format-forgejo-issue-title.util';

export const mapForgejoIssueToSearchResult = (issue: ForgejoIssue): SearchResultItem => {
  return {
    title: formatForgejoIssueTitle(issue),
    titleHighlighted: formatForgejoIssueTitle(issue),
    issueType: 'FORGEJO' as IssueProviderKey,
    issueData: issue,
  };
};

// Forgejo uses the issue number instead of the database issue id to track issues in Super Productivity.
export const mapForgejoIssueIdToIssueNumber = (issue: ForgejoIssue): ForgejoIssue => {
  return { ...issue, id: issue.number };
};

// The search endpoint can return issues outside the prioritized repository.
// Keep the provider scoped to the configured repo.
export const isIssueFromProject = (issue: ForgejoIssue, cfg: ForgejoCfg): boolean => {
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

// Forgejo-style issue endpoints can differ on whether `labels=a,b` is
// treated as AND or OR. Keep label allow/deny filtering client-side so
// Forgejo behaves consistently across instances.
export const isIssueIncludedByLabels = (
  issue: ForgejoIssue,
  excludedLabelNames: readonly string[],
): boolean => {
  if (excludedLabelNames.length === 0) {
    return true;
  }
  const issueLabelNames = new Set((issue.labels ?? []).map((l) => l.name));
  return !excludedLabelNames.some((name) => issueLabelNames.has(name));
};

export const hasAllLabels = (
  issue: ForgejoIssue,
  requiredLabelNames: readonly string[],
): boolean => {
  if (requiredLabelNames.length === 0) {
    return true;
  }
  const issueLabelNames = new Set((issue.labels ?? []).map((l) => l.name));
  return requiredLabelNames.every((name) => issueLabelNames.has(name));
};

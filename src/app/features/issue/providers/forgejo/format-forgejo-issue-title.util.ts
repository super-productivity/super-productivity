import { ForgejoIssue } from './forgejo-issue.model';
import { truncate } from '../../../../util/truncate';

export const formatForgejoIssueTitle = ({ number, title }: ForgejoIssue): string => {
  return `#${number} ${title}`;
};

export const formatForgejoIssueTitleForSnack = (issue: ForgejoIssue): string => {
  return `${truncate(formatForgejoIssueTitle(issue))}`;
};

import { CodebergIssue } from './codeberg-issue.model';
import { truncate } from '../../../../util/truncate';

export const formatCodebergIssueTitle = ({ number, title }: CodebergIssue): string => {
  return `#${number} ${title}`;
};

export const formatCodebergIssueTitleForSnack = (issue: CodebergIssue): string => {
  return `${truncate(formatCodebergIssueTitle(issue))}`;
};

import { RedmineIssue } from './redmine-issue.model';
import { truncate } from '../../../../util/truncate';

export const formatRedmineIssueTitle = ({ id, title }: RedmineIssue): string => {
  title = title.replaceAll(`#${id}`, '');
  return `#${id} ${title}`;
};

export const formatRedmineIssueTitleForSnack = (issue: RedmineIssue): string => {
  return `${truncate(formatRedmineIssueTitle(issue))}`;
};

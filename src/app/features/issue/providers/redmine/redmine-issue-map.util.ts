import { IssueDataReduced, IssueProviderKey, SearchResultItem } from '../../issue.model';
import { RedmineIssue, RedmineSearchResultItem } from './redmine-issue.model';

export const mapRedmineSearchResultItemToSearchResult = (
  item: RedmineSearchResultItem,
): SearchResultItem => {
  return {
    title: item.title,
    titleHighlighted: item.title,
    issueType: 'REDMINE' as IssueProviderKey,
    issueData: item as IssueDataReduced,
  };
};

export const mapRedmineIssueToSearchResult = (issue: RedmineIssue): SearchResultItem => {
  const title = `#${issue.id} ${issue.subject}`;
  return {
    title,
    titleHighlighted: title,
    issueType: 'REDMINE' as IssueProviderKey,
    issueData: { ...issue, title: issue.subject },
  };
};

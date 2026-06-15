import { IssueDataReduced, IssueProviderKey, SearchResultItem } from '../../issue.model';
import { PlainspaceIssue } from './plainspace-issue.model';

export const mapPlainspaceIssueToSearchResult = (
  issue: PlainspaceIssue,
): SearchResultItem => {
  return {
    title: issue.title,
    titleHighlighted: issue.title,
    issueType: 'PLAINSPACE' as IssueProviderKey,
    issueData: issue as IssueDataReduced,
  };
};

import { SearchResultItem } from '../issue.model';
import { isLinearIssueDone } from '../providers/linear/linear-issue-map.util';

const ISSUE_DONE_STATE_NAME_GUESSES = ['closed', 'done', 'completed', 'resolved'];

export const isIssueDone = (searchResultItem: SearchResultItem): boolean => {
  switch (searchResultItem.issueType) {
    case 'GITLAB':
      return (
        (searchResultItem as SearchResultItem<'GITLAB'>).issueData.state === 'closed'
      );

    case 'GITEA':
      return ISSUE_DONE_STATE_NAME_GUESSES.includes(
        (searchResultItem as SearchResultItem<'GITEA'>).issueData.state,
      );

    case 'JIRA':
      return ISSUE_DONE_STATE_NAME_GUESSES.includes(
        (searchResultItem as SearchResultItem<'JIRA'>).issueData.status?.name,
      );

    case 'REDMINE':
      return ISSUE_DONE_STATE_NAME_GUESSES.includes(
        (searchResultItem as SearchResultItem<'REDMINE'>).issueData.status?.name,
      );

    case 'OPEN_PROJECT':
      return false;

    case 'CALDAV':
      return false;

    case 'LINEAR':
      return isLinearIssueDone(
        (searchResultItem as SearchResultItem<'LINEAR'>).issueData,
      );

    default: {
      // Handle plugin providers and migrated providers (e.g. 'GITHUB')
      // PluginIssue uses 'state', PluginSearchResult uses 'status'
      const issueData = searchResultItem.issueData as {
        state?: string;
        status?: string;
      };
      const stateOrStatus = issueData?.state ?? issueData?.status;
      if (typeof stateOrStatus === 'string') {
        return ISSUE_DONE_STATE_NAME_GUESSES.includes(stateOrStatus.toLowerCase());
      }
      return false;
    }
  }
};

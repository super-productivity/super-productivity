import { IssueProviderKey } from '../issue.model';

export const getIssueProviderHelpLink = (
  issueProviderKey: IssueProviderKey,
): string | undefined => {
  switch (issueProviderKey) {
    // NOTE: we don't use JQL for now thus no link
    // case 'JIRA':
    //   return 'https://support.atlassian.com/jira-service-management-cloud/docs/use-advanced-search-with-jira-query-language-jql/';
    case 'GITHUB':
      return 'https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests';
    case 'GITLAB':
      return 'https://docs.gitlab.com/ee/user/search/advanced_search.html';
    // case 'LOGSEQ':
    // NOTE: Logseq uses wildcard '*' - no external help link needed
    // case 'GITEA':
    // case 'CALDAV':
    // case 'REDMINE':
    // case 'OPEN_PROJECT':
  }
  return undefined;
};

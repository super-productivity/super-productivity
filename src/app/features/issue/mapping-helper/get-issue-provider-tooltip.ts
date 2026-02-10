import { IssueProvider } from '../issue.model';

export const getIssueProviderTooltip = (issueProvider: IssueProvider): string => {
  const v = (() => {
    switch (issueProvider.issueProviderKey) {
      case 'JIRA':
        return issueProvider.host;
      case 'GITHUB':
        return issueProvider.repo;
      case 'GITLAB':
        return issueProvider.project;
      case 'GITEA':
        return issueProvider.repoFullname;
      case 'CALDAV':
        return issueProvider.caldavUrl;
      case 'ICAL':
        return issueProvider.icalUrl;
      case 'REDMINE':
        return issueProvider.projectId;
      case 'OPEN_PROJECT':
        return issueProvider.projectId;
      case 'TRELLO':
        return issueProvider.boardName || issueProvider.boardId;
      case 'AZURE_DEVOPS':
        return issueProvider.project || undefined;
      default:
        return undefined;
    }
  })();
  return v || issueProvider.issueProviderKey;
};

const getRepoInitials = (repo: string | null): string | undefined => {
  if (!repo) {
    return undefined;
  }

  const repoName = repo?.split('/')[1];
  const repoNameParts = repoName?.split('-');

  if (!repoNameParts) {
    return repo.substring(0, 2).toUpperCase();
  }

  if (repoNameParts.length === 1) {
    return repoNameParts[0].substring(0, 2).toUpperCase();
  }
  return repoNameParts
    .map((part) => part[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
};

export const getIssueProviderInitials = (
  issueProvider: IssueProvider,
): string | undefined | null => {
  switch (issueProvider.issueProviderKey) {
    case 'JIRA':
      return issueProvider.host
        ?.replace('https://', '')
        ?.replace('http://', '')
        ?.substring(0, 2)
        ?.toUpperCase();
    case 'CALDAV':
      return issueProvider.caldavUrl
        ?.replace('https://', '')
        ?.replace('http://', '')
        ?.substring(0, 2)
        ?.toUpperCase();
    case 'ICAL':
      if (issueProvider.icalUrl.includes('google')) return 'G';
      if (issueProvider.icalUrl.includes('office365')) return 'MS';

      return issueProvider.icalUrl
        ?.replace('https://', '')
        ?.replace('http://', '')
        ?.substring(0, 2)
        ?.toUpperCase();
    case 'REDMINE':
      return issueProvider.projectId?.substring(0, 2).toUpperCase();
    case 'OPEN_PROJECT':
      return issueProvider.projectId?.substring(0, 2).toUpperCase();

    case 'GITHUB':
      return getRepoInitials(issueProvider.repo);
    case 'GITLAB':
      return getRepoInitials(issueProvider.project);
    case 'GITEA':
      return getRepoInitials(issueProvider.repoFullname);
    case 'TRELLO':
      return (issueProvider.boardName || issueProvider.boardId)
        ?.substring(0, 2)
        ?.toUpperCase();
    case 'AZURE_DEVOPS':
      return issueProvider.project?.substring(0, 2)?.toUpperCase() || 'AD';
  }
  return undefined;
};

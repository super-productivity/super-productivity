import { IssueProvider } from '../issue.model';

const SECRET_KEY_PATTERNS = /token|secret|key|password|apikey|api_key/i;

const _hasPluginConfig = (
  issueProvider: IssueProvider,
): issueProvider is IssueProvider & { pluginConfig: Record<string, unknown> } => {
  return !!(issueProvider as { pluginConfig?: unknown }).pluginConfig;
};

const _getSafePluginConfigString = (
  pluginConfig: Record<string, unknown>,
): string | undefined => {
  const safeEntries = Object.entries(pluginConfig).filter(
    ([k]) => !SECRET_KEY_PATTERNS.test(k),
  );
  return safeEntries.find(([, v]) => typeof v === 'string' && v.length > 0)?.[1] as
    | string
    | undefined;
};

export const getIssueProviderTooltip = (issueProvider: IssueProvider): string => {
  if (_hasPluginConfig(issueProvider)) {
    const cfgStr = _getSafePluginConfigString(issueProvider.pluginConfig);
    return cfgStr || issueProvider.issueProviderKey;
  }
  const v = (() => {
    switch (issueProvider.issueProviderKey) {
      case 'JIRA':
        return issueProvider.host;
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
      case 'NEXTCLOUD_DECK':
        return issueProvider.selectedBoardTitle
          ? `Deck: ${issueProvider.selectedBoardTitle}`
          : undefined;
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
  if (_hasPluginConfig(issueProvider)) {
    const firstStr = _getSafePluginConfigString(issueProvider.pluginConfig);
    return firstStr?.includes('/')
      ? getRepoInitials(firstStr)
      : firstStr?.substring(0, 2)?.toUpperCase();
  }
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

    case 'GITLAB':
      return getRepoInitials(issueProvider.project);
    case 'GITEA':
      return getRepoInitials(issueProvider.repoFullname);
    case 'TRELLO':
      return (issueProvider.boardName || issueProvider.boardId)
        ?.substring(0, 2)
        ?.toUpperCase();
    case 'NEXTCLOUD_DECK':
      return issueProvider.selectedBoardTitle?.substring(0, 2)?.toUpperCase();
    case 'AZURE_DEVOPS':
      return issueProvider.project?.substring(0, 2)?.toUpperCase() || 'AD';
  }
  return undefined;
};

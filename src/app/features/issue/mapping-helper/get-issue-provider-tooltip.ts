import { IssueProvider } from '../issue.model';

const SECRET_KEY_PATTERNS = /token|secret|key|password|apikey|api_key/i;

// iCal feed URLs frequently embed credentials in the path (e.g. Google
// private feeds) or query string. Show only the hostname so tokens never
// end up in tooltips, screenshots, or screenshares. Opaque-scheme URLs
// (data:, blob:, javascript:, …) collapse to a generic label rather than
// leaking their inline payload.
export const sanitizeIcalUrlForDisplay = (url: string | undefined): string => {
  if (!url) return 'iCal';
  try {
    // webcal:// is the canonical iCal subscription scheme but is non-special
    // in URL Standard terms; normalize so URL parsing extracts the hostname.
    // Anchor the trailing `//` so a malformed `webcal:javascript:...` doesn't
    // get rewritten into the parser's special-scheme path.
    const normalized = url.replace(/^webcals?:\/\//i, 'https://');
    const u = new URL(normalized);
    if (u.hostname) return u.hostname;
    if (u.protocol === 'file:') {
      const basename = u.pathname.split('/').filter(Boolean).pop();
      return basename ? `file: ${basename}` : 'iCal';
    }
    return 'iCal';
  } catch {
    return 'iCal';
  }
};

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
        return sanitizeIcalUrlForDisplay(issueProvider.icalUrl);
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
      if (issueProvider.icalUrl?.includes('google')) return 'G';
      if (issueProvider.icalUrl?.includes('office365')) return 'MS';
      // Route through the sanitizer so credentials embedded in user/path/query
      // can never bleed into the chip badge (always-visible, no hover).
      return sanitizeIcalUrlForDisplay(issueProvider.icalUrl)
        .substring(0, 2)
        .toUpperCase();
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

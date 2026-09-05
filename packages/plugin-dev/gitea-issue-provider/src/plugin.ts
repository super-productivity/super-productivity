import type {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
  PluginHttpOptions,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};

const API_SUFFIX = 'api';
const API_VERSION = 'v1';

// Scope option values — must stay identical to the built-in provider's stored
// config so existing (migrated) providers keep working.
const SCOPE_CREATED_BY_ME = 'created-by-me';
const SCOPE_ASSIGNED_TO_ME = 'assigned-to-me';

interface GiteaConfig {
  host?: string;
  token?: string;
  repoFullname?: string;
  scope?: string;
  filterLabels?: string;
  excludeLabels?: string;
}

interface GiteaUser {
  avatar_url: string;
  id: number;
  username: string;
  login: string;
  full_name: string;
}

interface GiteaLabel {
  id: number;
  name: string;
  color: string;
}

interface GiteaRepositoryReduced {
  id: number;
  full_name: string;
}

interface GiteaIssue {
  id: number;
  number: number;
  url: string;
  html_url: string;
  title: string;
  body: string;
  state: string;
  labels: GiteaLabel[];
  user: GiteaUser | null;
  assignee: GiteaUser | null;
  assignees: GiteaUser[] | null;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  repository: GiteaRepositoryReduced | null;
}

interface GiteaComment {
  id: number;
  body: string;
  created_at: string;
  user: GiteaUser | null;
}

const t = (key: string): string => {
  try {
    return PluginAPI.translate(key);
  } catch {
    return key;
  }
};

const baseUrl = (cfg: GiteaConfig): string => {
  const host = (cfg.host || '').replace(/\/+$/, '');
  if (!host) {
    throw new Error('Gitea host is not configured.');
  }
  return `${host}/${API_SUFFIX}/${API_VERSION}`;
};

// Auth is sent as `Authorization: token <token>` (a Gitea-supported scheme),
// which keeps the token out of request URLs / logs.
const giteaHeaders = (cfg: GiteaConfig): Record<string, string> => {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cfg.token) {
    headers['Authorization'] = `token ${cfg.token}`;
  }
  return headers;
};

const parseLabelList = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

// Gitea/Forgejo's two issue endpoints historically disagree on whether a
// `labels=a,b` query means AND or OR (see go-gitea/gitea#33509). We always
// filter labels client-side so behavior is consistent regardless of server.
const hasAllLabels = (issue: GiteaIssue, required: readonly string[]): boolean => {
  if (required.length === 0) {
    return true;
  }
  const names = new Set((issue.labels ?? []).map((l) => l.name));
  return required.every((name) => names.has(name));
};

const isIssueIncludedByLabels = (
  issue: GiteaIssue,
  excluded: readonly string[],
): boolean => {
  if (excluded.length === 0) {
    return true;
  }
  const names = new Set((issue.labels ?? []).map((l) => l.name));
  return !excluded.some((name) => names.has(name));
};

const issueAssignees = (issue: GiteaIssue): string[] =>
  (issue.assignees ?? [])
    .map((a) => a.login || a.username)
    .filter((name): name is string => !!name);

const mapSearchResult = (issue: GiteaIssue): PluginSearchResult => ({
  // Gitea tracks issues by their per-repo `number`, not the global `id`.
  id: String(issue.number),
  title: `#${issue.number} ${issue.title}`,
  url: issue.html_url,
  status: issue.state,
  assignee: issue.assignee?.login || issue.assignee?.username,
  labels: (issue.labels ?? []).map((l) => l.name),
});

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'host',
      type: 'input',
      label: t('CFG.HOST'),
      required: true,
    },
    {
      key: 'token',
      type: 'password',
      label: t('CFG.TOKEN'),
      required: true,
    },
    {
      key: 'tokenHelp',
      type: 'link',
      label: t('CFG.HOW_TO_GET_TOKEN'),
      url: 'https://docs.gitea.com/development/api-usage#generating-and-listing-api-tokens',
    },
    {
      key: 'repoFullname',
      type: 'input',
      label: t('CFG.REPO_FULL_NAME'),
      required: true,
    },
    {
      key: 'scope',
      type: 'select',
      label: t('CFG.SCOPE'),
      required: true,
      options: [
        { value: 'all', label: t('CFG.SCOPE_ALL') },
        { value: SCOPE_CREATED_BY_ME, label: t('CFG.SCOPE_CREATED') },
        { value: SCOPE_ASSIGNED_TO_ME, label: t('CFG.SCOPE_ASSIGNED') },
      ],
    },
    {
      key: 'filterLabels',
      type: 'input',
      label: t('CFG.FILTER_LABELS'),
      advanced: true,
    },
    {
      key: 'excludeLabels',
      type: 'input',
      label: t('CFG.EXCLUDE_LABELS'),
      advanced: true,
    },
  ],

  getHeaders(config: Record<string, unknown>): Record<string, string> {
    return giteaHeaders(config as unknown as GiteaConfig);
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = config as unknown as GiteaConfig;
    const base = baseUrl(cfg);
    const includedLabels = parseLabelList(cfg.filterLabels);
    const excludedLabels = parseLabelList(cfg.excludeLabels);

    const params: Record<string, string> = {
      limit: '100',
      state: 'open',
      q: searchTerm,
    };
    if (cfg.scope === SCOPE_CREATED_BY_ME) {
      params['created'] = 'true';
    } else if (cfg.scope === SCOPE_ASSIGNED_TO_ME) {
      params['assigned'] = 'true';
    }
    if (includedLabels.length > 0) {
      params['labels'] = includedLabels.join(',');
    }

    const issues =
      (await http.get<GiteaIssue[]>(`${base}/repos/issues/search`, { params })) || [];
    return issues
      .filter((issue) => issue.repository?.full_name === cfg.repoFullname)
      .filter((issue) => hasAllLabels(issue, includedLabels))
      .filter((issue) => isIssueIncludedByLabels(issue, excludedLabels))
      .map(mapSearchResult);
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = config as unknown as GiteaConfig;
    const base = baseUrl(cfg);
    const issueUrl = `${base}/repos/${cfg.repoFullname}/issues/${issueId}`;
    const issue = await http.get<GiteaIssue>(issueUrl);

    const result: PluginIssue = {
      id: String(issue.number),
      title: issue.title,
      body: issue.body || '',
      url: issue.html_url,
      state: issue.state,
      lastUpdated: new Date(issue.updated_at).getTime(),
      assignee: issue.assignee?.login || issue.assignee?.username,
      labels: (issue.labels ?? []).map((l) => l.name),
      comments: [],

      // Extended fields for richer display
      number: issue.number,
      summary: `#${issue.number} ${issue.title}`,
      assignees: issueAssignees(issue),
      creator: issue.user?.login || issue.user?.username,
      creatorAvatarUrl: issue.user?.avatar_url,
      createdAt: new Date(issue.created_at).getTime(),
      closedAt: issue.closed_at ? new Date(issue.closed_at).getTime() : undefined,
    };

    if (issue.comments > 0) {
      const commentsData = await http.get<GiteaComment[]>(`${issueUrl}/comments`);
      result.comments = (commentsData || []).map((c) => ({
        author: c.user?.login || c.user?.username || 'unknown',
        body: c.body || '',
        created: new Date(c.created_at).getTime(),
        avatarUrl: c.user?.avatar_url,
      }));
    }

    return result;
  },

  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    const cfg = config as unknown as GiteaConfig;
    const host = (cfg.host || '').replace(/\/+$/, '');
    return `${host}/${cfg.repoFullname}/issues/${issueId}`;
  },

  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    const cfg = config as unknown as GiteaConfig;
    try {
      await http.get(`${baseUrl(cfg)}/repos/${cfg.repoFullname}`);
      return true;
    } catch {
      return false;
    }
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = config as unknown as GiteaConfig;
    const base = baseUrl(cfg);
    const includedLabels = parseLabelList(cfg.filterLabels);
    const excludedLabels = parseLabelList(cfg.excludeLabels);

    const pageLimit = 4;
    let page = 1;
    let allIssues: Map<number, GiteaIssue> = new Map();
    let issues: GiteaIssue[] = [];
    let user: GiteaUser | undefined;
    // Loop over pages until no issues are returned or we reach the limit
    // The server can restrict the issues per page to less than requested
    while ((page === 1 || issues.length !== 0) && page <= pageLimit) {
      const params: Record<string, string> = {
        limit: '100',
        state: 'open',
        page: page.toString(),
      };
      if (cfg.scope === SCOPE_CREATED_BY_ME || cfg.scope === SCOPE_ASSIGNED_TO_ME) {
        user = user || (await http.get<GiteaUser>(`${base}/user`));
        if (cfg.scope === SCOPE_CREATED_BY_ME) {
          params['created_by'] = user.username;
        } else {
          params['assigned_by'] = user.username;
        }
      }
      if (includedLabels.length > 0) {
        params['labels'] = includedLabels.join(',');
      }

      const opts: PluginHttpOptions = { params };
      try {
        issues =
          (await http.get<GiteaIssue[]>(
            `${base}/repos/${cfg.repoFullname}/issues`,
            opts,
          )) || [];
      } catch (error) {
        issues = [];
        if (page === 1) {
          // Only throw the error on the first page
          throw error;
        }
      }
      issues.forEach((issue) => allIssues.set(issue.id, issue));
      page += 1;
    }
    return [...allIssues.values()]
      .filter((issue) => hasAllLabels(issue, includedLabels))
      .filter((issue) => isIssueIncludedByLabels(issue, excludedLabels))
      .map(mapSearchResult);
  },

  issueDisplay: [
    { field: 'summary', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'state', label: t('DISPLAY.STATE'), type: 'text' },
    { field: 'assignees', label: t('DISPLAY.ASSIGNEE'), type: 'list', hideEmpty: true },
    { field: 'labels', label: t('DISPLAY.LABELS'), type: 'list', hideEmpty: true },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown' },
  ],

  commentsConfig: {
    authorField: 'author',
    bodyField: 'body',
    createdField: 'created',
    avatarField: 'avatarUrl',
  },

  // Read-only provider: pull-only mappings drive remote-update detection only.
  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'state',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string => (taskValue ? 'closed' : 'open'),
      toTaskValue: (issueValue: unknown): boolean => issueValue === 'closed',
    },
  ] satisfies PluginFieldMapping[],

  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    return {
      state: issue.state,
      title: issue.title,
      body: issue.body,
    };
  },
});

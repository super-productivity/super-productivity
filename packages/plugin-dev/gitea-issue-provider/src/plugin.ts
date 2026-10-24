import type {
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';
import {
  asConfig,
  canConnect,
  COMMENTS_CONFIG,
  isDoneMapping,
  pickSyncValues,
  registerIssueProvider,
  t,
  tokenAuth,
} from '../../issue-provider-kit';

declare const PluginAPI: {
  log: {
    err: (...args: unknown[]) => void;
  };
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

const baseUrl = (cfg: GiteaConfig): string => {
  const host = (cfg.host || '').replace(/\/+$/, '');
  if (!host) {
    throw new Error('Gitea host is not configured.');
  }
  return `${host}/${API_SUFFIX}/${API_VERSION}`;
};

// Auth is sent as `Authorization: token <token>` (a Gitea-supported scheme),
// which keeps the token out of request URLs / logs.
const giteaHeaders = (cfg: GiteaConfig): Record<string, string> => ({
  accept: 'application/json',
  ...tokenAuth(cfg.token),
});

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

/** Configured `owner/repo`; empty means every repository on the host. */
const repoOf = (cfg: GiteaConfig): string => (cfg.repoFullname || '').trim();

// Issue ids are the per-repo `number` when the provider is bound to one repo
// (pre-existing format) and `owner/repo#number` when it spans the host, so one
// provider can hold issues from many repositories.
const parseIssueId = (
  issueId: string,
  cfg: GiteaConfig,
): { repo: string; number: string } => {
  const m = /^(.+)#(\d+)$/.exec(issueId);
  if (m) {
    return { repo: m[1], number: m[2] };
  }
  const repo = repoOf(cfg);
  if (!repo) {
    // Repository cleared on a provider that already has linked tasks.
    throw new Error(t('ERRORS.ID_WITHOUT_REPO', { id: issueId }));
  }
  return { repo, number: issueId };
};

const isScoped = (cfg: GiteaConfig): boolean =>
  cfg.scope === SCOPE_CREATED_BY_ME || cfg.scope === SCOPE_ASSIGNED_TO_ME;

// Host-wide `/repos/issues/search` without `created`/`assigned` returns every
// public repository on the host, not the user's; refuse that combination.
const assertHostWideScope = (cfg: GiteaConfig): void => {
  if (!repoOf(cfg) && !isScoped(cfg)) {
    throw new Error(t('ERRORS.HOST_WIDE_SCOPE'));
  }
};

/** `#12` for a single-repo provider, `owner/repo#12` for a host-wide one. */
const issueRef = (issue: GiteaIssue, cfg: GiteaConfig): string =>
  `${repoOf(cfg) ? '' : (issue.repository?.full_name ?? '')}#${issue.number}`;

const issueIdOf = (issue: GiteaIssue, cfg: GiteaConfig): string =>
  repoOf(cfg) ? String(issue.number) : issueRef(issue, cfg);

const mapSearchResult =
  (cfg: GiteaConfig) =>
  (issue: GiteaIssue): PluginSearchResult => ({
    id: issueIdOf(issue, cfg),
    title: `${issueRef(issue, cfg)} ${issue.title}`,
    url: issue.html_url,
    status: issue.state,
    assignee: issue.assignee?.login || issue.assignee?.username,
    labels: (issue.labels ?? []).map((l) => l.name),
  });

// Returns a page fetcher for open issues: the repo endpoint when a repo is
// configured (scope via `created_by`/`assigned_by` username, resolved once),
// otherwise the host-wide `/repos/issues/search` (scope via `created`/`assigned`).
const issuePager = (
  cfg: GiteaConfig,
  http: PluginHttp,
  searchTerm?: string,
): ((page: number) => Promise<GiteaIssue[]>) => {
  assertHostWideScope(cfg);
  const base = baseUrl(cfg);
  const repo = repoOf(cfg);
  const includedLabels = parseLabelList(cfg.filterLabels);
  const scoped = isScoped(cfg);
  let user: Promise<GiteaUser> | undefined;
  return async (page: number): Promise<GiteaIssue[]> => {
    const params: Record<string, string> = {
      limit: '100',
      state: 'open',
      type: 'issues',
      page: String(page),
    };
    if (searchTerm) {
      params['q'] = searchTerm;
    }
    if (includedLabels.length > 0) {
      params['labels'] = includedLabels.join(',');
    }
    if (repo) {
      if (scoped) {
        const me = await (user ??= http.get<GiteaUser>(`${base}/user`));
        params[cfg.scope === SCOPE_CREATED_BY_ME ? 'created_by' : 'assigned_by'] =
          me.username;
      }
      return (
        (await http.get<GiteaIssue[]>(`${base}/repos/${repo}/issues`, { params })) || []
      );
    }
    if (scoped) {
      params[cfg.scope === SCOPE_CREATED_BY_ME ? 'created' : 'assigned'] = 'true';
    }
    return (
      (await http.get<GiteaIssue[]>(`${base}/repos/issues/search`, { params })) || []
    );
  };
};

const applyLabelFilters = (issues: GiteaIssue[], cfg: GiteaConfig): GiteaIssue[] => {
  const includedLabels = parseLabelList(cfg.filterLabels);
  const excludedLabels = parseLabelList(cfg.excludeLabels);
  return issues
    .filter((issue) => hasAllLabels(issue, includedLabels))
    .filter((issue) => isIssueIncludedByLabels(issue, excludedLabels));
};

registerIssueProvider({
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
      description: t('CFG.REPO_FULL_NAME_HINT'),
      pattern: '^[^/\\s]+/[^/\\s]+$',
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

  getHeaders: (config) => giteaHeaders(asConfig<GiteaConfig>(config)),

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = asConfig<GiteaConfig>(config);
    const issues = await issuePager(cfg, http, searchTerm)(1);
    return applyLabelFilters(issues, cfg).map(mapSearchResult(cfg));
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = asConfig<GiteaConfig>(config);
    const { repo, number } = parseIssueId(issueId, cfg);
    const issueUrl = `${baseUrl(cfg)}/repos/${repo}/issues/${number}`;
    const issue = await http.get<GiteaIssue>(issueUrl);

    const result: PluginIssue = {
      id: issueId,
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
      summary: `${issueRef(issue, cfg)} ${issue.title}`,
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
    const cfg = asConfig<GiteaConfig>(config);
    const host = (cfg.host || '').replace(/\/+$/, '');
    const { repo, number } = parseIssueId(issueId, cfg);
    return `${host}/${repo}/issues/${number}`;
  },

  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    const cfg = asConfig<GiteaConfig>(config);
    assertHostWideScope(cfg);
    const repo = repoOf(cfg);
    return canConnect(() =>
      http.get(repo ? `${baseUrl(cfg)}/repos/${repo}` : `${baseUrl(cfg)}/user`),
    );
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = asConfig<GiteaConfig>(config);
    const fetchPage = issuePager(cfg, http);

    // Hard ceiling on fetched pages; deliberate so huge repos can't stall the
    // backlog sync. 4 × 100 = 400 issues max.
    const MAX_PAGES = 4;
    let page = 1;
    const allIssues: Map<string, GiteaIssue> = new Map();
    let issues: GiteaIssue[] = [];
    // Loop over pages until no issues are returned or we reach the limit
    // The server can restrict the issues per page to less than requested
    while ((page === 1 || issues.length !== 0) && page <= MAX_PAGES) {
      try {
        issues = await fetchPage(page);
      } catch (error) {
        if (page === 1) {
          // Only throw the error on the first page
          throw error;
        }
        // Later pages are best-effort: log and stop paging
        PluginAPI.log.err('Gitea issue provider: failed to fetch page', page, error);
        break;
      }
      issues.forEach((issue) => allIssues.set(issueIdOf(issue, cfg), issue));
      page += 1;
    }
    return applyLabelFilters([...allIssues.values()], cfg).map(mapSearchResult(cfg));
  },

  issueDisplay: [
    { field: 'summary', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'state', label: t('DISPLAY.STATE'), type: 'text' },
    { field: 'assignees', label: t('DISPLAY.ASSIGNEE'), type: 'list', hideEmpty: true },
    { field: 'labels', label: t('DISPLAY.LABELS'), type: 'list', hideEmpty: true },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown' },
  ],

  commentsConfig: COMMENTS_CONFIG,

  // Read-only provider: pull-only mappings drive remote-update detection only.
  fieldMappings: [isDoneMapping()],

  extractSyncValues: pickSyncValues('state', 'title', 'body'),
});

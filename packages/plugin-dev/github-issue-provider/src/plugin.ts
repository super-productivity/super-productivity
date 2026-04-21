import type {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};

const API_BASE = 'https://api.github.com';

interface GithubConfig {
  repo: string;
  token?: string;
  filterUsername?: string;
  backlogQuery?: string;
}

interface GithubUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

interface GithubLabel {
  name: string;
  description?: string;
  color?: string;
}

interface GithubMilestone {
  title: string;
  number: number;
  state: string;
}

interface GithubIssueResponse {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  url: string;
  state: string;
  locked: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  comments: number;
  user: GithubUser | null;
  assignee: GithubUser | null;
  labels: (string | GithubLabel)[];
  milestone: GithubMilestone | null;
  pull_request?: { html_url: string };
}

interface GithubSearchResponse {
  items: GithubIssueResponse[];
}

interface GithubCommentResponse {
  user: GithubUser | null;
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  author_association: string;
}

const parseRepo = (config: GithubConfig): { owner: string; repo: string } => {
  const raw = (config.repo || '').trim();
  const parts = raw.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo format "${raw}". Expected "owner/repo".`);
  }
  return { owner: parts[0], repo: parts[1] };
};

const mapSearchResult = (issue: GithubIssueResponse): PluginSearchResult => ({
  id: String(issue.number),
  title: `#${issue.number} ${issue.title}`,
  url: issue.html_url,
  status: issue.state,
  assignee: issue.assignee?.login,
});

const t = (key: string): string => {
  try {
    return PluginAPI.translate(key);
  } catch {
    return key;
  }
};

const isAuthOrNotFoundError = (err: unknown): boolean => {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status: unknown }).status;
    return status === 401 || status === 403 || status === 404;
  }
  return false;
};

// GitHub's search API requires parentheses percent-encoded, but
// encodeURIComponent leaves them intact (they're unreserved per RFC 3986).
// Unencoded parens cause HTTP 422 on queries like "(author:@me OR assignee:@me)".
// See https://github.com/super-productivity/super-productivity/issues/4913
const encodeGithubQuery = (query: string): string =>
  encodeURIComponent(query).replace(/\(/g, '%28').replace(/\)/g, '%29');

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'repo',
      type: 'input',
      label: t('CFG.REPO'),
      required: true,
    },
    {
      key: 'token',
      type: 'password',
      label: t('CFG.TOKEN'),
      required: false,
    },
    {
      key: 'tokenHelp',
      type: 'link',
      label: t('CFG.HOW_TO_GET_TOKEN'),
      url: 'https://github.com/super-productivity/super-productivity/blob/master/docs/github-access-token-instructions.md',
    },
    {
      key: 'filterUsername',
      type: 'input',
      label: t('CFG.FILTER_USERNAME'),
      required: false,
      advanced: true,
    },
    {
      key: 'backlogQuery',
      type: 'input',
      label: t('CFG.BACKLOG_QUERY'),
      required: false,
      advanced: true,
    },
  ],

  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const cfg = config as unknown as GithubConfig;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };
    if (cfg.token) {
      headers['Authorization'] = `token ${cfg.token}`;
    }
    return headers;
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = config as unknown as GithubConfig;
    const { owner, repo } = parseRepo(cfg);
    // Ensure we only search issues (not PRs) unless user explicitly specifies
    const hasTypeFilter =
      searchTerm.includes('is:issue') || searchTerm.includes('is:pull-request');
    const typeFilter = hasTypeFilter ? '' : ' is:issue';
    const q = encodeGithubQuery(`repo:${owner}/${repo}${typeFilter} ${searchTerm}`);
    const url = `${API_BASE}/search/issues?q=${q}&per_page=50&advanced_search=true`;
    const response = await http.get<GithubSearchResponse>(url);
    return (response.items || []).map(mapSearchResult);
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = config as unknown as GithubConfig;
    const { owner, repo } = parseRepo(cfg);
    const issueUrl = `${API_BASE}/repos/${owner}/${repo}/issues/${issueId}`;
    const issue = await http.get<GithubIssueResponse>(issueUrl);

    const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));

    const result: PluginIssue = {
      // Core fields used by the adapter
      id: String(issue.number),
      title: issue.title,
      body: issue.body || '',
      url: issue.html_url,
      state: issue.state,
      lastUpdated: new Date(issue.updated_at).getTime(),
      assignee: issue.assignee?.login,
      labels,
      comments: [],

      // Extended fields for richer display
      number: issue.number,
      summary: `#${issue.number} ${issue.title}`,
      creator: issue.user?.login,
      creatorAvatarUrl: issue.user?.avatar_url,
      assigneeUrl: issue.assignee?.html_url,
      milestone: issue.milestone?.title,
      locked: issue.locked,
      isPullRequest: !!issue.pull_request,
      pullRequestUrl: issue.pull_request?.html_url,
      createdAt: new Date(issue.created_at).getTime(),
      closedAt: issue.closed_at ? new Date(issue.closed_at).getTime() : undefined,
    };

    // Fetch comments if any exist
    if (issue.comments > 0) {
      const commentsData = await http.get<GithubCommentResponse[]>(
        `${issueUrl}/comments?per_page=100`,
      );

      result.comments = commentsData.map((c) => ({
        author: c.user?.login || 'unknown',
        body: c.body || '',
        created: new Date(c.created_at).getTime(),
        avatarUrl: c.user?.avatar_url,
      }));

      // Smart lastUpdated: filter out own comments for update detection
      // (matches built-in GitHub provider's filterUsernameForIssueUpdates)
      if (cfg.filterUsername) {
        const otherComments = commentsData.filter(
          (c) => c.user?.login?.toLowerCase() !== cfg.filterUsername!.toLowerCase(),
        );
        if (otherComments.length > 0) {
          const latestOtherComment = Math.max(
            ...otherComments.map((c) => new Date(c.created_at).getTime()),
          );
          result.lastUpdated = Math.max(result.lastUpdated!, latestOtherComment);
        }
      }
    }

    return result;
  },

  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    const { owner, repo } = parseRepo(config as unknown as GithubConfig);
    return `https://github.com/${owner}/${repo}/issues/${issueId}`;
  },

  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    const { owner, repo } = parseRepo(config as unknown as GithubConfig);
    try {
      await http.get(`${API_BASE}/repos/${owner}/${repo}`);
      return true;
    } catch {
      return false;
    }
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = config as unknown as GithubConfig;
    const { owner, repo } = parseRepo(cfg);
    const query = cfg.backlogQuery || 'sort:updated state:open assignee:@me';
    const q = encodeGithubQuery(`repo:${owner}/${repo} is:issue ${query}`);
    const url = `${API_BASE}/search/issues?q=${q}&per_page=50&advanced_search=true`;
    const response = await http.get<GithubSearchResponse>(url);
    return (response.items || []).map(mapSearchResult);
  },

  issueDisplay: [
    { field: 'summary', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'state', label: t('DISPLAY.STATE'), type: 'text' },
    { field: 'assignee', label: t('DISPLAY.ASSIGNEE'), type: 'text', hideEmpty: true },
    { field: 'labels', label: t('DISPLAY.LABELS'), type: 'list', hideEmpty: true },
    { field: 'milestone', label: t('DISPLAY.MILESTONE'), type: 'text', hideEmpty: true },
    { field: 'creator', label: t('DISPLAY.CREATOR'), type: 'text', hideEmpty: true },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown' },
  ],

  commentsConfig: {
    authorField: 'author',
    bodyField: 'body',
    createdField: 'created',
    avatarField: 'avatarUrl',
  },

  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'state',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string => (taskValue ? 'closed' : 'open'),
      toTaskValue: (issueValue: unknown): boolean => issueValue === 'closed',
    },
    {
      taskField: 'title',
      issueField: 'title',
      defaultDirection: 'pullOnly',
      toIssueValue: (
        taskValue: unknown,
        ctx: { issueId: string; issueNumber?: number },
      ): string => {
        const str = taskValue as string;
        const prefix = `#${ctx.issueNumber} `;
        return str.startsWith(prefix) ? str.slice(prefix.length) : str;
      },
      toTaskValue: (
        issueValue: unknown,
        ctx: { issueId: string; issueNumber?: number },
      ): string => `#${ctx.issueNumber} ${issueValue}`,
    },
    {
      taskField: 'notes',
      issueField: 'body',
      defaultDirection: 'off',
      toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
      toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
    },
  ] satisfies PluginFieldMapping[],

  async updateIssue(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    const cfg = config as unknown as GithubConfig;
    if (!cfg.token) {
      throw new Error(t('ERRORS.TOKEN_REQUIRED'));
    }
    const { owner, repo } = parseRepo(cfg);
    try {
      await http.patch(`${API_BASE}/repos/${owner}/${repo}/issues/${id}`, changes);
    } catch (e) {
      throw isAuthOrNotFoundError(e)
        ? new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'))
        : e;
    }
  },

  async createIssue(
    title: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ issueId: string; issueNumber: number; issueData: PluginIssue }> {
    const cfg = config as unknown as GithubConfig;
    if (!cfg.token) {
      throw new Error(t('ERRORS.TOKEN_REQUIRED'));
    }
    const { owner, repo } = parseRepo(cfg);
    let response: GithubIssueResponse;
    try {
      response = await http.post<GithubIssueResponse>(
        `${API_BASE}/repos/${owner}/${repo}/issues`,
        { title },
      );
    } catch (e) {
      throw isAuthOrNotFoundError(e)
        ? new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'))
        : e;
    }
    return {
      issueId: String(response.number),
      issueNumber: response.number,
      issueData: {
        id: String(response.number),
        title: response.title,
        body: response.body || '',
        url: response.html_url,
        state: response.state,
        lastUpdated: new Date(response.updated_at).getTime(),
      },
    };
  },

  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    return {
      state: issue.state,
      title: issue.title,
      body: issue.body,
    };
  },
});

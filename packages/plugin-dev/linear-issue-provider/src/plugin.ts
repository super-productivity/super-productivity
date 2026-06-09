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

const LINEAR_API_URL = 'https://api.linear.app/graphql';

// Linear workflow state types that mean "done" (matches the built-in provider).
const DONE_STATE_TYPES = ['completed', 'canceled'];

interface LinearConfig {
  apiKey?: string;
  teamId?: string;
  projectId?: string;
}

interface LinearGraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface LinearRawIssueReduced {
  id: string;
  identifier: string;
  number: number;
  title: string;
  updatedAt: string;
  url: string;
  state: { name: string; type: string };
}

interface LinearRawIssue extends LinearRawIssueReduced {
  description?: string;
  priority: number;
  createdAt: string;
  completedAt?: string;
  canceledAt?: string;
  dueDate?: string;
  assignee?: { id: string; name: string; avatarUrl?: string };
  creator?: { id: string; name: string };
  labels?: { nodes: Array<{ id: string; name: string; color: string }> };
  comments?: {
    nodes: Array<{
      id: string;
      body: string;
      createdAt: string;
      user?: { id: string; name: string; avatarUrl?: string };
    }>;
  };
}

const t = (key: string): string => {
  try {
    return PluginAPI.translate(key);
  } catch {
    return key;
  }
};

const SEARCH_ISSUES_QUERY = `
  query SearchIssues($first: Int!, $team: TeamFilter, $project: NullableProjectFilter) {
    viewer {
      assignedIssues(
        first: $first,
        filter: {
          state: { type: { in: ["backlog", "unstarted", "started"] } },
          team: $team,
          project: $project
        }
      ) {
        nodes {
          id identifier number title updatedAt url
          state { id name type }
        }
      }
    }
  }
`;

const GET_ISSUE_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
      id identifier number title description priority
      createdAt updatedAt completedAt canceledAt dueDate url
      state { id name type }
      team { id name key }
      assignee { id name avatarUrl }
      creator { id name }
      labels(first: 50) { nodes { id name color } }
      comments(first: 50) {
        nodes { id body createdAt user { id name avatarUrl } }
      }
    }
  }
`;

const GET_VIEWER_QUERY = `query GetViewer { viewer { id name } }`;

const graphql = async <T>(
  http: PluginHttp,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> => {
  const res = await http.post<LinearGraphQLResponse<T>>(LINEAR_API_URL, {
    query,
    variables,
  });
  if (res?.errors?.length) {
    throw new Error(res.errors[0].message || 'Linear GraphQL error');
  }
  if (!res?.data) {
    throw new Error('No data returned from Linear');
  }
  return res.data;
};

const mapReduced = (issue: LinearRawIssueReduced): PluginSearchResult => ({
  id: issue.id,
  title: `${issue.identifier} ${issue.title}`,
  url: issue.url,
  status: issue.state?.name,
  // Provider-specific fields used for display + isDone mapping.
  identifier: issue.identifier,
  stateType: issue.state?.type,
});

const searchAssignedIssues = async (
  searchTerm: string,
  cfg: LinearConfig,
  http: PluginHttp,
): Promise<PluginSearchResult[]> => {
  const variables: Record<string, unknown> = { first: 50 };
  // Deliberate behavior change from the built-in provider: the old
  // LinearApiService accepted teamId/projectId but its callers never passed
  // them, so the "filter to specific team/project" config fields were inert.
  // Here we honor them as the labels promise. Empty fields = no filter (the
  // common case), so this only narrows results for users who set a value.
  if (cfg.teamId) {
    variables.team = { id: { eq: cfg.teamId } };
  }
  if (cfg.projectId) {
    variables.project = { id: { eq: cfg.projectId } };
  }

  const data = await graphql<{
    viewer: { assignedIssues: { nodes: LinearRawIssueReduced[] } };
  }>(http, SEARCH_ISSUES_QUERY, variables);

  let issues = data.viewer?.assignedIssues?.nodes || [];
  const term = searchTerm.trim().toLowerCase();
  if (term) {
    issues = issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(term) ||
        issue.identifier.toLowerCase().includes(term),
    );
  }
  return issues.map(mapReduced);
};

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'apiKey',
      type: 'password',
      label: t('CFG.API_KEY'),
      required: true,
    },
    {
      key: 'apiKeyHelp',
      type: 'link',
      label: t('CFG.HOW_TO_GET_TOKEN'),
      url: 'https://linear.app/settings/account/security',
    },
    {
      key: 'teamId',
      type: 'input',
      label: t('CFG.TEAM_ID'),
      advanced: true,
    },
    {
      key: 'projectId',
      type: 'input',
      label: t('CFG.PROJECT_ID'),
      advanced: true,
    },
  ],

  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const cfg = config as unknown as LinearConfig;
    return {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      Authorization: cfg.apiKey || '',
    };
  },

  searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    return searchAssignedIssues(searchTerm, config as unknown as LinearConfig, http);
  },

  async getById(
    issueId: string,
    _config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const data = await graphql<{ issue: LinearRawIssue | null }>(http, GET_ISSUE_QUERY, {
      id: issueId,
    });
    const issue = data.issue;
    if (!issue) {
      throw new Error('No issue data returned from Linear');
    }

    return {
      id: issue.id,
      title: issue.title,
      body: issue.description || '',
      url: issue.url,
      state: issue.state?.name,
      lastUpdated: new Date(issue.updatedAt).getTime(),
      assignee: issue.assignee?.name,
      labels: (issue.labels?.nodes || []).map((l) => l.name),
      comments: (issue.comments?.nodes || [])
        .filter((c) => !!c.user)
        .map((c) => ({
          author: c.user!.name,
          body: c.body || '',
          created: new Date(c.createdAt).getTime(),
          avatarUrl: c.user!.avatarUrl,
        })),

      // Extended fields for display + isDone mapping.
      identifier: issue.identifier,
      number: issue.number,
      summary: `${issue.identifier} ${issue.title}`,
      stateType: issue.state?.type,
      priority: issue.priority,
      creator: issue.creator?.name,
      createdAt: new Date(issue.createdAt).getTime(),
      completedAt: issue.completedAt ? new Date(issue.completedAt).getTime() : undefined,
    };
  },

  // Linear issue URLs require the workspace slug, which can't be derived from the
  // id + config alone. Returning '' makes the adapter fall back to getById().url,
  // matching the built-in provider's behavior.
  getIssueLink(): string {
    return '';
  },

  async testConnection(
    _config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    try {
      await graphql(http, GET_VIEWER_QUERY, {});
      return true;
    } catch {
      return false;
    }
  },

  getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    return searchAssignedIssues('', config as unknown as LinearConfig, http);
  },

  issueDisplay: [
    { field: 'summary', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'state', label: t('DISPLAY.STATE'), type: 'text', hideEmpty: true },
    { field: 'priority', label: t('DISPLAY.PRIORITY'), type: 'text', hideEmpty: true },
    { field: 'assignee', label: t('DISPLAY.ASSIGNEE'), type: 'text', hideEmpty: true },
    { field: 'labels', label: t('DISPLAY.LABELS'), type: 'list', hideEmpty: true },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown' },
  ],

  commentsConfig: {
    authorField: 'author',
    bodyField: 'body',
    createdField: 'created',
    avatarField: 'avatarUrl',
  },

  // Read-only provider: pull-only mapping drives remote-update detection only.
  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'stateType',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string =>
        taskValue ? 'completed' : 'unstarted',
      toTaskValue: (issueValue: unknown): boolean =>
        DONE_STATE_TYPES.includes(issueValue as string),
    },
  ] satisfies PluginFieldMapping[],

  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    return {
      stateType: issue.stateType,
      title: issue.title,
      body: issue.body,
    };
  },
});

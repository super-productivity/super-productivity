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
  getOAuthToken(): Promise<string | null>;
};

// --- Microsoft Graph API constants ---

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
// /common/ supports both personal Microsoft accounts and work/school accounts.
// /organizations/ only accepts work/school accounts.
const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const SCOPES = ['Tasks.ReadWrite', 'offline_access'];

// Azure AD app registration client ID.
// This is a public client (no secret) registered for multi-tenant work/school accounts.
// NOT A SECRET — this is a "Desktop" OAuth client type (RFC 8252).
// Azure AD classifies these as public clients where the secret cannot be kept
// confidential (it ships in the binary users download). PKCE is the actual
// security mechanism. Do not rotate or revoke — this value is intentionally committed.
const CLIENT_ID = '2492f1d4-74c9-477b-836f-6384ddfa6255';

// --- i18n helper ---

const t = (key: string): string => {
  try {
    return PluginAPI.translate(key);
  } catch {
    return key;
  }
};

// --- Graph API types ---

interface GraphTaskList {
  id: string;
  displayName: string;
  isOwner: boolean;
  isShared: boolean;
}

interface GraphTaskListsResponse {
  value: GraphTaskList[];
}

interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}

interface GraphTaskItem {
  id: string;
  title: string;
  status: string;
  importance: string;
  body?: {
    content: string;
    contentType: 'text' | 'html';
  };
  completedDateTime?: GraphDateTime;
  dueDateTime?: GraphDateTime;
  startDateTime?: GraphDateTime;
  createdDateTime: string;
  lastModifiedDateTime: string;
  isReminderOn: boolean;
  categories?: string[];
}

interface GraphTasksResponse {
  value: GraphTaskItem[];
}

// --- Helpers ---

const toTimestamp = (dt?: GraphDateTime): number | undefined => {
  if (!dt?.dateTime) return undefined;
  return new Date(dt.dateTime).getTime();
};

const toFormattedDate = (dt?: GraphDateTime): string | undefined => {
  if (!dt?.dateTime) return undefined;
  return new Date(dt.dateTime).toLocaleDateString();
};

/** Escape single quotes for OData filter strings. */
const escapeODataString = (s: string): string => s.replace(/'/g, "''");

const mapTaskToSearchResult = (task: GraphTaskItem): PluginSearchResult => ({
  id: task.id,
  title: task.title,
  status: task.status,
  dueWithTime: toTimestamp(task.dueDateTime),
});

const mapTaskToIssue = (task: GraphTaskItem): PluginIssue => ({
  id: task.id,
  title: task.title,
  url: `https://to.do.microsoft.com/tasks/${encodeURIComponent(task.id)}`,
  body: task.body?.content || '',
  state: task.status,
  lastUpdated: new Date(task.lastModifiedDateTime).getTime(),
  importance: task.importance,
  dueDateFormatted: toFormattedDate(task.dueDateTime),
  startDateTime: toTimestamp(task.startDateTime),
  completedDateTime: toTimestamp(task.completedDateTime),
  categories: task.categories,
  isReminderOn: task.isReminderOn,
});

// --- Load task lists for config dropdown ---

const loadTaskLists = async (
  _config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => {
  const res = await http.get<GraphTaskListsResponse>(
    `${GRAPH_API_BASE}/me/todo/lists?$select=id,displayName,isOwner,isShared&$orderby=displayName`,
  );
  return (res.value || []).map((list) => ({
    label: list.displayName + (list.isShared ? ' (Shared)' : ''),
    value: list.id,
  }));
};

// --- Plugin registration ---

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'oauth',
      type: 'oauthButton' as const,
      label: t('CFG.CONNECT_ACCOUNT'),
      oauthConfig: {
        authUrl: MS_AUTH_URL,
        tokenUrl: MS_TOKEN_URL,
        clientId: CLIENT_ID,
        scopes: SCOPES,
        // Azure AD requires an exact redirect_uri match. Register this URI in
        // your Azure AD app under Authentication > Platform configurations >
        // Mobile and desktop applications > Add URI.
        redirectUri: 'http://localhost:51234',
        extraAuthParams: { prompt: 'consent' },
      },
    },
    {
      key: 'taskListId',
      type: 'select' as const,
      label: t('CFG.TASK_LIST'),
      description: t('CFG.TASK_LIST_DESC'),
      required: true,
      options: [{ label: 'Tasks', value: 'defaultTasks' }],
      loadOptions: loadTaskLists,
    },
    {
      key: 'syncDirection',
      type: 'select' as const,
      label: t('CFG.SYNC_DIRECTION'),
      description: t('CFG.SYNC_DIRECTION_DESC'),
      required: false,
      advanced: true,
      options: [
        { label: t('CFG.SYNC_DIRECTION_PULL_ONLY'), value: 'pullOnly' },
        { label: t('CFG.SYNC_DIRECTION_PUSH_AND_PULL'), value: 'both' },
        { label: t('CFG.SYNC_DIRECTION_OFF'), value: 'off' },
      ],
    },
  ],

  async getHeaders(
    _config: Record<string, unknown>,
  ): Promise<Record<string, string>> {
    const token = await PluginAPI.getOAuthToken();
    if (!token) {
      throw new Error(t('ERRORS.NOT_AUTHENTICATED'));
    }
    return { Authorization: `Bearer ${token}` };
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const listId = (config.taskListId as string) || 'defaultTasks';
    const encodedSearch = escapeODataString(searchTerm);
    const url = `${GRAPH_API_BASE}/me/todo/lists/${listId}/tasks?$filter=contains(title,'${encodedSearch}')&$top=50&$orderby=lastModifiedDateTime desc`;
    const res = await http.get<GraphTasksResponse>(url);
    return (res.value || []).map(mapTaskToSearchResult);
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const listId = (config.taskListId as string) || 'defaultTasks';
    const url = `${GRAPH_API_BASE}/me/todo/lists/${listId}/tasks/${issueId}`;
    const task = await http.get<GraphTaskItem>(url);
    return mapTaskToIssue(task);
  },

  getIssueLink(issueId: string, _config: Record<string, unknown>): string {
    return `https://to.do.microsoft.com/tasks/${encodeURIComponent(issueId)}`;
  },

  async testConnection(
    _config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    try {
      await http.get<GraphTaskListsResponse>(
        `${GRAPH_API_BASE}/me/todo/lists?$top=1`,
      );
      return true;
    } catch {
      return false;
    }
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const listId = (config.taskListId as string) || 'defaultTasks';
    const url = `${GRAPH_API_BASE}/me/todo/lists/${listId}/tasks?$filter=status ne 'completed'&$top=100&$orderby=lastModifiedDateTime desc`;
    const res = await http.get<GraphTasksResponse>(url);
    return (res.value || []).map(mapTaskToSearchResult);
  },

  issueDisplay: [
    { field: 'title', label: t('DISPLAY.TITLE'), type: 'link', linkField: 'url' },
    { field: 'status', label: t('DISPLAY.STATUS'), type: 'text' },
    { field: 'importance', label: t('DISPLAY.IMPORTANCE'), type: 'text', hideEmpty: true },
    { field: 'dueDateFormatted', label: t('DISPLAY.DUE_DATE'), type: 'text', hideEmpty: true },
    { field: 'categories', label: t('DISPLAY.CATEGORIES'), type: 'list', hideEmpty: true },
    { field: 'body', label: t('DISPLAY.NOTES'), type: 'markdown', hideEmpty: true },
  ],

  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'status',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string =>
        taskValue ? 'completed' : 'notStarted',
      toTaskValue: (issueValue: unknown): boolean =>
        issueValue === 'completed',
    },
    {
      taskField: 'title',
      issueField: 'title',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string => (taskValue as string) ?? '',
      toTaskValue: (issueValue: unknown): string => (issueValue as string) ?? '',
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
    const listId = (config.taskListId as string) || 'defaultTasks';
    const url = `${GRAPH_API_BASE}/me/todo/lists/${listId}/tasks/${id}`;

    const patch: Record<string, unknown> = {};

    if (changes.title !== undefined) {
      patch.title = changes.title;
    }

    if (changes.body !== undefined) {
      patch.body = {
        content: changes.body,
        contentType: 'text',
      };
    }

    if (changes.status !== undefined) {
      patch.status = changes.status;
    }

    if (Object.keys(patch).length > 0) {
      await http.patch(url, patch);
    }
  },

  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    return {
      status: issue.state,
      title: issue.title,
      body: issue.body || '',
    };
  },
});

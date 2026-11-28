import type {
  IssueProviderPluginDefinition,
  OAuthFlowConfig,
  OAuthTokenResult,
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from '@super-productivity/plugin-api';
import {
  asConfig,
  canConnect,
  isDoneMapping,
  pickSyncValues,
  t,
  textMapping,
} from '../../issue-provider-kit';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  startOAuthFlow(config: OAuthFlowConfig): Promise<OAuthTokenResult>;
  // Internal host ↔ bundled-plugin contract; not supported for third-party plugins.
  getOAuthToken(tokenKey?: string): Promise<string | null>;
  clearOAuthToken(): Promise<void>;
};

export const GOOGLE_TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

// Transient host config paired with getOAuthToken(tokenKey), never synced or public.
const SP_OAUTH_TOKEN_KEY_CFG_KEY = '__spOAuthTokenKey';
const DEFAULT_TASK_LIST_ID = '@default';
const COMPOUND_SEP = '::';
const MAX_PAGES = 10;

export interface GoogleTasksOAuthOverrides {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

export interface GoogleTasksConfig {
  [SP_OAUTH_TOKEN_KEY_CFG_KEY]?: string;
  taskListId?: string;
  includeCompleted?: boolean;
  oauthOverrides?: GoogleTasksOAuthOverrides;
}

export interface GoogleTaskList {
  id: string;
  title: string;
  updated?: string;
}

export interface GoogleTaskListsResponse {
  items?: GoogleTaskList[];
  nextPageToken?: string;
}

export interface GoogleTask {
  id: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string | null;
  completed?: string | null;
  deleted?: boolean;
  hidden?: boolean;
  updated?: string;
  parent?: string;
  position?: string;
  webViewLink?: string;
}

export interface GoogleTasksListResponse {
  items?: GoogleTask[];
  nextPageToken?: string;
}

export const getTaskListId = (cfg: GoogleTasksConfig): string =>
  cfg.taskListId?.trim() || DEFAULT_TASK_LIST_ID;

export const toCompoundId = (taskListId: string, taskId: string): string =>
  `${taskListId}${COMPOUND_SEP}${taskId}`;

export const parseCompoundId = (
  id: string,
  fallbackTaskListId: string,
): { taskListId: string; taskId: string } => {
  const sep = id.indexOf(COMPOUND_SEP);
  if (sep === -1) {
    return { taskListId: fallbackTaskListId, taskId: id };
  }
  return {
    taskListId: id.slice(0, sep) || fallbackTaskListId,
    taskId: id.slice(sep + COMPOUND_SEP.length),
  };
};

export const taskListUrl = (taskListId: string, taskId?: string): string => {
  const base = `${GOOGLE_TASKS_API}/lists/${encodeURIComponent(taskListId)}/tasks`;
  return taskId ? `${base}/${encodeURIComponent(taskId)}` : base;
};

/**
 * Convert an RFC 3339 date string from Google Tasks (e.g. "2026-03-20T00:00:00.000Z")
 * to a local YYYY-MM-DD date string (`dueDay`).
 * Google Tasks API stores only the date portion in UTC midnight.
 */
export const parseGoogleDueToDueDay = (due: unknown): string | undefined => {
  if (typeof due !== 'string' || !due.trim()) {
    return undefined;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(due.trim());
  if (match) {
    return match[1];
  }
  const parsed = new Date(due);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString().slice(0, 10);
};

/**
 * Convert a YYYY-MM-DD `dueDay` string to the RFC 3339 UTC midnight timestamp
 * expected by the Google Tasks API ("YYYY-MM-DDT00:00:00.000Z"), or null when cleared.
 */
export const formatDueDayToGoogleDue = (dueDay: unknown): string | null => {
  if (typeof dueDay !== 'string' || !dueDay.trim()) {
    return null;
  }
  const trimmed = dueDay.trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (match) {
    return `${match[1]}T00:00:00.000Z`;
  }
  return null;
};

/**
 * Convert a local epoch timestamp (`dueWithTime`) to its local YYYY-MM-DD date string
 * so timed scheduling changes in Super Productivity push their date to Google Tasks.
 */
export const formatTimestampToLocalDueDay = (ms: unknown): string | null => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return null;
  }
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseStartMsFromDue = (due: string | null | undefined): number | undefined => {
  const dueDay = parseGoogleDueToDueDay(due);
  if (!dueDay) {
    return undefined;
  }
  // Parse as local midnight so `getDbDateStr(startMs)` in the adapter preserves the exact YYYY-MM-DD date
  const ms = new Date(`${dueDay}T00:00:00`).getTime();
  return Number.isNaN(ms) ? undefined : ms;
};

export const mapTaskToSearchResult = (
  task: GoogleTask,
  taskListId: string,
): PluginSearchResult => {
  const start = parseStartMsFromDue(task.due);
  const dueDay = parseGoogleDueToDueDay(task.due);
  return {
    id: toCompoundId(taskListId, task.id),
    title: task.title || t('FALLBACK.NO_TITLE'),
    status: task.deleted ? 'deleted' : task.status || 'needsAction',
    url: task.webViewLink || 'https://tasks.google.com/',
    description: task.notes || '',
    ...(start !== undefined ? { start, isAllDay: true } : {}),
    ...(dueDay !== undefined ? { dueDay } : {}),
  };
};

export const mapTaskToPluginIssue = (
  task: GoogleTask,
  taskListId: string,
): PluginIssue => {
  const compoundId = toCompoundId(taskListId, task.id);
  const isCompleted = task.status === 'completed';
  const state = task.deleted ? 'deleted' : isCompleted ? 'completed' : 'needsAction';
  const dueDay = parseGoogleDueToDueDay(task.due);
  const start = parseStartMsFromDue(task.due);
  const title = task.title || t('FALLBACK.NO_TITLE');

  return {
    id: compoundId,
    title,
    body: task.notes || '',
    url: task.webViewLink || 'https://tasks.google.com/',
    state,
    lastUpdated: task.updated ? new Date(task.updated).getTime() : undefined,
    summary: title,
    statusLabel: isCompleted ? t('STATUS.COMPLETED') : t('STATUS.NEEDS_ACTION'),
    dueDay,
    ...(start !== undefined ? { start } : {}),
  };
};

const fetchTasksFromList = async (
  http: PluginHttp,
  taskListId: string,
  opts: { showCompleted: boolean },
): Promise<GoogleTask[]> => {
  const allTasks: GoogleTask[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = {
      maxResults: '100',
      showCompleted: opts.showCompleted ? 'true' : 'false',
      showHidden: opts.showCompleted ? 'true' : 'false',
    };
    if (pageToken) {
      params.pageToken = pageToken;
    }

    const res = await http.get<GoogleTasksListResponse>(taskListUrl(taskListId), {
      params,
    });
    const items = res.items || [];
    allTasks.push(...items.filter((item) => !item.deleted));

    if (!res.nextPageToken) {
      break;
    }
    pageToken = res.nextPageToken;
  }

  return allTasks;
};

const loadTaskLists = async (
  _config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => {
  const res = await http.get<GoogleTaskListsResponse>(
    `${GOOGLE_TASKS_API}/users/@me/lists`,
    { params: { maxResults: '100' } },
  );
  const lists = res.items || [];
  if (lists.length === 0) {
    return [{ label: t('CFG.DEFAULT_TASK_LIST'), value: DEFAULT_TASK_LIST_ID }];
  }
  return lists.map((list) => ({
    label: list.title,
    value: list.id,
  }));
};

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'oauthOverrides.clientId',
      type: 'input',
      label: t('CFG.CUSTOM_CLIENT_ID'),
      description: t('CFG.CUSTOM_CLIENT_ID_DESC'),
      required: true,
    },
    {
      key: 'oauthOverrides.clientSecret',
      type: 'password',
      label: t('CFG.CUSTOM_CLIENT_SECRET'),
      description: t('CFG.CUSTOM_CLIENT_SECRET_DESC'),
      required: true,
    },
    {
      key: 'oauth',
      type: 'oauthButton',
      label: t('CFG.CONNECT_ACCOUNT'),
      oauthConfig: {
        authUrl: GOOGLE_AUTH_URL,
        tokenUrl: GOOGLE_TOKEN_URL,
        clientId: '',
        scopes: [GOOGLE_TASKS_SCOPE],
        extraAuthParams: { access_type: 'offline', prompt: 'consent' },
      },
    },
    {
      key: 'taskListId',
      type: 'select',
      label: t('CFG.TASK_LIST'),
      description: t('CFG.TASK_LIST_DESC'),
      required: true,
      options: [{ label: t('CFG.DEFAULT_TASK_LIST'), value: DEFAULT_TASK_LIST_ID }],
      loadOptions: loadTaskLists,
    },
    {
      key: 'includeCompleted',
      type: 'checkbox',
      label: t('CFG.INCLUDE_COMPLETED'),
      description: t('CFG.INCLUDE_COMPLETED_DESC'),
      advanced: true,
    },
    {
      key: 'oauthOverrides.redirectUri',
      type: 'input',
      label: t('CFG.CUSTOM_REDIRECT_URI'),
      description: t('CFG.CUSTOM_REDIRECT_URI_DESC'),
      advanced: true,
    },
  ],

  async getHeaders(config: Record<string, unknown>): Promise<Record<string, string>> {
    const cfg = asConfig<GoogleTasksConfig>(config);
    const token = cfg[SP_OAUTH_TOKEN_KEY_CFG_KEY]
      ? await PluginAPI.getOAuthToken(cfg[SP_OAUTH_TOKEN_KEY_CFG_KEY])
      : await PluginAPI.getOAuthToken();
    if (!token) {
      throw new Error('Not authenticated. Please connect your Google account first.');
    }
    return {
      Authorization: `Bearer ${token}`,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
    };
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = asConfig<GoogleTasksConfig>(config);
    const taskListId = getTaskListId(cfg);
    const tasks = await fetchTasksFromList(http, taskListId, {
      showCompleted: !!cfg.includeCompleted,
    });
    const trimmed = searchTerm.trim().toLowerCase();
    const filtered = trimmed
      ? tasks.filter(
          (task) =>
            (task.title || '').toLowerCase().includes(trimmed) ||
            (task.notes || '').toLowerCase().includes(trimmed),
        )
      : tasks;
    return filtered.map((task) => mapTaskToSearchResult(task, taskListId));
  },

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue> {
    const cfg = asConfig<GoogleTasksConfig>(config);
    const { taskListId, taskId } = parseCompoundId(issueId, getTaskListId(cfg));
    const task = await http.get<GoogleTask>(taskListUrl(taskListId, taskId));
    return mapTaskToPluginIssue(task, taskListId);
  },

  getIssueLink(_issueId: string, _config: Record<string, unknown>): string {
    return 'https://tasks.google.com/';
  },

  testConnection: (config, http) => {
    const cfg = asConfig<GoogleTasksConfig>(config);
    const taskListId = getTaskListId(cfg);
    return canConnect(() =>
      http.get(taskListUrl(taskListId), { params: { maxResults: '1' } }),
    );
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const cfg = asConfig<GoogleTasksConfig>(config);
    const taskListId = getTaskListId(cfg);
    const tasks = await fetchTasksFromList(http, taskListId, {
      showCompleted: false,
    });
    return tasks
      .filter((task) => task.status !== 'completed')
      .map((task) => mapTaskToSearchResult(task, taskListId));
  },

  issueDisplay: [
    { field: 'summary', label: t('DISPLAY.SUMMARY'), type: 'link', linkField: 'url' },
    { field: 'statusLabel', label: t('DISPLAY.STATUS'), type: 'text' },
    { field: 'dueDay', label: t('DISPLAY.DUE_DATE'), type: 'text', hideEmpty: true },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown', hideEmpty: true },
  ],

  fieldMappings: [
    {
      ...isDoneMapping({
        issueField: 'state',
        done: 'completed',
        open: 'needsAction',
      }),
      defaultDirection: 'both',
    },
    textMapping('title', 'title', 'both'),
    textMapping('notes', 'body', 'both'),
    {
      taskField: 'dueDay',
      issueField: 'dueDay',
      defaultDirection: 'both',
      mutuallyExclusive: ['dueWithTime'],
      toIssueValue: (taskValue: unknown): string | null =>
        typeof taskValue === 'string' && taskValue.trim() ? taskValue.trim() : null,
      toTaskValue: (issueValue: unknown): string | undefined =>
        typeof issueValue === 'string' && issueValue.trim()
          ? issueValue.trim()
          : undefined,
    },
    {
      taskField: 'dueWithTime',
      issueField: 'dueDay',
      defaultDirection: 'pushOnly',
      mutuallyExclusive: ['dueDay'],
      toIssueValue: (taskValue: unknown): string | null =>
        formatTimestampToLocalDueDay(taskValue),
      // The import path runs every mapping regardless of direction.
      toTaskValue: (): undefined => undefined,
    },
  ] satisfies PluginFieldMapping[],

  async updateIssue(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    const cfg = asConfig<GoogleTasksConfig>(config);
    const { taskListId, taskId } = parseCompoundId(id, getTaskListId(cfg));
    const patch: Record<string, unknown> = {};

    if ('title' in changes && changes.title !== undefined) {
      patch.title = changes.title;
    }
    if ('body' in changes && changes.body !== undefined) {
      patch.notes = changes.body;
    }
    if ('state' in changes && changes.state !== undefined) {
      const isCompleted = changes.state === 'completed';
      patch.status = isCompleted ? 'completed' : 'needsAction';
      patch.completed = isCompleted ? new Date().toISOString() : null;
    }
    if ('dueDay' in changes && changes.dueDay !== undefined) {
      patch.due = formatDueDayToGoogleDue(changes.dueDay);
    }

    if (Object.keys(patch).length > 0) {
      await http.patch(taskListUrl(taskListId, taskId), patch);
    }
  },

  async createIssue(
    title: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ issueId: string; issueData: PluginIssue }> {
    const cfg = asConfig<GoogleTasksConfig>(config);
    const taskListId = getTaskListId(cfg);
    const created = await http.post<GoogleTask>(taskListUrl(taskListId), {
      title,
    });
    const issueData = mapTaskToPluginIssue(created, taskListId);
    return {
      issueId: issueData.id,
      issueData,
    };
  },

  async deleteIssue(
    id: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    const cfg = asConfig<GoogleTasksConfig>(config);
    const { taskListId, taskId } = parseCompoundId(id, getTaskListId(cfg));
    await http.delete(taskListUrl(taskListId, taskId));
  },

  extractSyncValues: pickSyncValues('state', 'title', 'body', 'dueDay'),

  doneStates: ['completed'],
  deletedStates: ['deleted'],
});

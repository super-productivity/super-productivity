import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '@super-productivity/plugin-api';

let GOOGLE_TASKS_SCOPE: string;
let formatDueDayToGoogleDue: (dueDay: unknown) => string | null;
let formatTimestampToLocalDueDay: (ms: unknown) => string | null;
let parseCompoundId: (
  id: string,
  fallbackTaskListId: string,
) => { taskListId: string; taskId: string };
let parseGoogleDueToDueDay: (due: unknown) => string | undefined;
let toCompoundId: (taskListId: string, taskId: string) => string;

let definition: IssueProviderPluginDefinition;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).PluginAPI = {
    registerIssueProvider: vi.fn((def: IssueProviderPluginDefinition) => {
      definition = def;
    }),
    getOAuthToken: vi.fn().mockResolvedValue('mock-token'),
    clearOAuthToken: vi.fn().mockResolvedValue(undefined),
    translate: vi.fn((key: string) => key),
  };
  ({
    GOOGLE_TASKS_SCOPE,
    formatDueDayToGoogleDue,
    formatTimestampToLocalDueDay,
    parseCompoundId,
    parseGoogleDueToDueDay,
    toCompoundId,
  } = await import('./plugin'));
});

type MockHttp = PluginHttp & {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
};

describe('Google Tasks Plugin', () => {
  let mockHttp: MockHttp;

  beforeEach(() => {
    const pluginApi = (globalThis as Record<string, unknown>).PluginAPI as {
      getOAuthToken: ReturnType<typeof vi.fn>;
    };
    pluginApi.getOAuthToken.mockReset();
    pluginApi.getOAuthToken.mockResolvedValue('mock-token');
    mockHttp = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
    } as unknown as MockHttp;
  });

  describe('OAuth and bring-your-own credential configuration', () => {
    it('configures bring-your-own OAuth without embedding shared app credentials', () => {
      const oauthField = definition.configFields.find((f) => f.type === 'oauthButton');
      expect(oauthField).toBeDefined();
      expect(oauthField?.oauthConfig).toEqual({
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId: '',
        scopes: [GOOGLE_TASKS_SCOPE],
        extraAuthParams: { access_type: 'offline', prompt: 'consent' },
      });
    });

    it('exposes required oauthOverrides.clientId and oauthOverrides.clientSecret fields and advanced redirectUri', () => {
      const clientIdField = definition.configFields.find(
        (f) => f.key === 'oauthOverrides.clientId',
      );
      const clientSecretField = definition.configFields.find(
        (f) => f.key === 'oauthOverrides.clientSecret',
      );
      const redirectUriField = definition.configFields.find(
        (f) => f.key === 'oauthOverrides.redirectUri',
      );

      expect(clientIdField).toBeDefined();
      expect(clientIdField?.type).toBe('input');
      expect(clientIdField?.required).toBe(true);
      expect(clientIdField?.advanced).toBeUndefined();

      expect(clientSecretField).toBeDefined();
      expect(clientSecretField?.type).toBe('password');
      expect(clientSecretField?.required).toBe(true);
      expect(clientSecretField?.advanced).toBeUndefined();

      expect(redirectUriField).toBeDefined();
      expect(redirectUriField?.type).toBe('input');
      expect(redirectUriField?.advanced).toBe(true);
    });
  });

  describe('compound IDs and date helpers', () => {
    it('round-trips compound task list and task IDs', () => {
      const compound = toCompoundId('list-123', 'task-456');
      expect(compound).toBe('list-123::task-456');
      expect(parseCompoundId(compound, '@default')).toEqual({
        taskListId: 'list-123',
        taskId: 'task-456',
      });
    });

    it('falls back to configured task list ID when ID is not compound', () => {
      expect(parseCompoundId('plain-task-id', 'my-list')).toEqual({
        taskListId: 'my-list',
        taskId: 'plain-task-id',
      });
    });

    it('parses RFC 3339 due strings to YYYY-MM-DD dueDay', () => {
      expect(parseGoogleDueToDueDay('2026-03-20T00:00:00.000Z')).toBe('2026-03-20');
      expect(parseGoogleDueToDueDay(null)).toBeUndefined();
      expect(parseGoogleDueToDueDay('')).toBeUndefined();
    });

    it('formats YYYY-MM-DD dueDay to RFC 3339 UTC midnight for Google Tasks API', () => {
      expect(formatDueDayToGoogleDue('2026-03-20')).toBe('2026-03-20T00:00:00.000Z');
      expect(formatDueDayToGoogleDue('')).toBeNull();
      expect(formatDueDayToGoogleDue(null)).toBeNull();
    });

    it('formats local epoch timestamps to local YYYY-MM-DD strings', () => {
      const localTimestamp = new Date(2026, 10, 22, 15, 0, 0).getTime();
      expect(formatTimestampToLocalDueDay(localTimestamp)).toBe('2026-11-22');
      expect(formatTimestampToLocalDueDay(null)).toBeNull();
      expect(formatTimestampToLocalDueDay(undefined)).toBeNull();
      expect(formatTimestampToLocalDueDay(Number.NaN)).toBeNull();
    });
  });

  describe('getHeaders', () => {
    it('passes __spOAuthTokenKey to PluginAPI.getOAuthToken when present', async () => {
      const pluginApi = (globalThis as Record<string, unknown>).PluginAPI as {
        getOAuthToken: ReturnType<typeof vi.fn>;
      };
      const headers = await definition.getHeaders({
        __spOAuthTokenKey: 'provider-instance-1',
      });
      expect(pluginApi.getOAuthToken).toHaveBeenCalledWith('provider-instance-1');
      expect(headers.Authorization).toBe('Bearer mock-token');
    });

    it('throws when not authenticated', async () => {
      const pluginApi = (globalThis as Record<string, unknown>).PluginAPI as {
        getOAuthToken: ReturnType<typeof vi.fn>;
      };
      pluginApi.getOAuthToken.mockResolvedValueOnce(null);
      await expect(definition.getHeaders({})).rejects.toThrow(/Not authenticated/);
    });
  });

  describe('loadOptions for taskListId', () => {
    it('fetches user task lists from Google Tasks API without appending hard-coded English suffix', async () => {
      const taskListField = definition.configFields.find((f) => f.key === 'taskListId');
      expect(taskListField?.loadOptions).toBeDefined();

      mockHttp.get.mockResolvedValueOnce({
        items: [
          { id: 'list-1', title: 'My Tasks' },
          { id: 'list-2', title: 'Work' },
        ],
      });

      const options = await taskListField!.loadOptions!({}, mockHttp);
      expect(mockHttp.get).toHaveBeenCalledWith(
        'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
        { params: { maxResults: '100' } },
      );
      expect(options).toEqual([
        { label: 'My Tasks', value: 'list-1' },
        { label: 'Work', value: 'list-2' },
      ]);
    });
  });

  describe('searchIssues and getNewIssuesForBacklog', () => {
    it('searches tasks by title and notes and filters deleted tasks', async () => {
      mockHttp.get.mockResolvedValueOnce({
        items: [
          {
            id: 't1',
            title: 'Buy groceries',
            notes: 'Milk and eggs',
            status: 'needsAction',
            due: '2026-04-10T00:00:00.000Z',
          },
          {
            id: 't2',
            title: 'Deleted task',
            status: 'needsAction',
            deleted: true,
          },
          {
            id: 't3',
            title: 'Call dentist',
            status: 'needsAction',
          },
        ],
      });

      const results = await definition.searchIssues(
        'milk',
        { taskListId: 'list-1' },
        mockHttp,
      );
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'list-1::t1',
        title: 'Buy groceries',
        description: 'Milk and eggs',
        status: 'needsAction',
        dueDay: '2026-04-10',
        isAllDay: true,
      });
    });

    it('returns only uncompleted tasks for backlog import', async () => {
      mockHttp.get.mockResolvedValueOnce({
        items: [
          { id: 't1', title: 'Open task', status: 'needsAction' },
          { id: 't2', title: 'Done task', status: 'completed' },
        ],
      });

      const results = await definition.getNewIssuesForBacklog!(
        { taskListId: 'list-1' },
        mockHttp,
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('list-1::t1');
    });
  });

  describe('getById, createIssue, updateIssue, deleteIssue', () => {
    it('fetches a single task by compound ID and maps statusLabel and dueDay', async () => {
      mockHttp.get.mockResolvedValueOnce({
        id: 't1',
        title: 'Write unit tests',
        notes: 'Cover OAuth overrides',
        status: 'completed',
        due: '2026-05-01T00:00:00.000Z',
        updated: '2026-05-01T12:00:00.000Z',
      });

      const issue = await definition.getById('list-1::t1', {}, mockHttp);
      expect(mockHttp.get).toHaveBeenCalledWith(
        'https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks/t1',
      );
      expect(issue).toMatchObject({
        id: 'list-1::t1',
        title: 'Write unit tests',
        body: 'Cover OAuth overrides',
        state: 'completed',
        statusLabel: 'STATUS.COMPLETED',
        dueDay: '2026-05-01',
      });
    });

    it('uses translated fallback title when task has no title', async () => {
      mockHttp.get.mockResolvedValueOnce({
        id: 't-untitled',
        status: 'needsAction',
      });

      const issue = await definition.getById('list-1::t-untitled', {}, mockHttp);
      expect(issue.title).toBe('FALLBACK.NO_TITLE');
      expect(issue.summary).toBe('FALLBACK.NO_TITLE');
      expect(issue.statusLabel).toBe('STATUS.NEEDS_ACTION');
    });

    it('patches status, completed timestamp, title, notes, and due date on updateIssue', async () => {
      mockHttp.patch.mockResolvedValueOnce({});

      await definition.updateIssue!(
        'list-1::t1',
        {
          title: 'Updated title',
          body: 'Updated notes',
          state: 'completed',
          dueDay: '2026-06-15',
        },
        {},
        mockHttp,
      );

      expect(mockHttp.patch).toHaveBeenCalledWith(
        'https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks/t1',
        expect.objectContaining({
          title: 'Updated title',
          notes: 'Updated notes',
          status: 'completed',
          completed: expect.any(String),
          due: '2026-06-15T00:00:00.000Z',
        }),
      );
    });

    it('clears completed and due when task is reopened and unscheduled', async () => {
      mockHttp.patch.mockResolvedValueOnce({});

      await definition.updateIssue!(
        'list-1::t1',
        {
          state: 'needsAction',
          dueDay: null,
        },
        {},
        mockHttp,
      );

      expect(mockHttp.patch).toHaveBeenCalledWith(
        'https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks/t1',
        {
          status: 'needsAction',
          completed: null,
          due: null,
        },
      );
    });

    it('creates a new Google Task on createIssue', async () => {
      mockHttp.post.mockResolvedValueOnce({
        id: 'new-task-id',
        title: 'Created from SP',
        status: 'needsAction',
      });

      const created = await definition.createIssue!(
        'Created from SP',
        { taskListId: 'list-1' },
        mockHttp,
      );
      expect(mockHttp.post).toHaveBeenCalledWith(
        'https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks',
        { title: 'Created from SP' },
      );
      expect(created.issueId).toBe('list-1::new-task-id');
      expect(created.issueData.title).toBe('Created from SP');
    });

    it('deletes a Google Task on deleteIssue', async () => {
      mockHttp.delete.mockResolvedValueOnce(undefined);

      await definition.deleteIssue!('list-1::t1', {}, mockHttp);
      expect(mockHttp.delete).toHaveBeenCalledWith(
        'https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks/t1',
      );
    });
  });

  describe('fieldMappings', () => {
    it('maps isDone <-> state and dueDay <-> dueDay', () => {
      const mappings = definition.fieldMappings!;
      const isDone = mappings.find((m) => m.taskField === 'isDone')!;
      expect(isDone.toIssueValue(true, { issueId: '1' })).toBe('completed');
      expect(isDone.toIssueValue(false, { issueId: '1' })).toBe('needsAction');
      expect(isDone.toTaskValue('completed', { issueId: '1' })).toBe(true);
      expect(isDone.toTaskValue('needsAction', { issueId: '1' })).toBe(false);

      const dueDay = mappings.find((m) => m.taskField === 'dueDay')!;
      expect(dueDay.mutuallyExclusive).toEqual(['dueWithTime']);
      expect(dueDay.toIssueValue('2026-07-01', { issueId: '1' })).toBe('2026-07-01');
      expect(dueDay.toIssueValue(undefined, { issueId: '1' })).toBeNull();
      expect(dueDay.toTaskValue('2026-07-01', { issueId: '1' })).toBe('2026-07-01');
      expect(dueDay.toTaskValue(undefined, { issueId: '1' })).toBeUndefined();
    });

    it('maps dueWithTime -> dueDay as pushOnly so timed scheduling and unscheduling sync to Google Tasks', () => {
      const mappings = definition.fieldMappings!;
      const dueWithTime = mappings.find((m) => m.taskField === 'dueWithTime')!;
      expect(dueWithTime).toBeDefined();
      expect(dueWithTime.issueField).toBe('dueDay');
      expect(dueWithTime.defaultDirection).toBe('pushOnly');
      expect(dueWithTime.mutuallyExclusive).toEqual(['dueDay']);

      const localTimestamp = new Date(2026, 10, 22, 15, 0, 0).getTime();
      expect(dueWithTime.toIssueValue(localTimestamp, { issueId: '1' })).toBe(
        '2026-11-22',
      );
      expect(dueWithTime.toIssueValue(undefined, { issueId: '1' })).toBeNull();
      expect(dueWithTime.toIssueValue(null, { issueId: '1' })).toBeNull();
      expect(dueWithTime.toTaskValue('2026-11-22', { issueId: '1' })).toBeUndefined();
    });
  });
});

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '@super-productivity/plugin-api';

let DEFAULT_CLIENT_ID: string;
let DEFAULT_CLIENT_SECRET: string;
let DEFAULT_IOS_CLIENT_ID: string;
let DEFAULT_MOBILE_CLIENT_ID: string;
let GOOGLE_TASKS_SCOPE: string;
let formatDueDayToGoogleDue: (dueDay: string | null | undefined) => string | null;
let parseCompoundId: (
  id: string,
  fallbackTaskListId: string,
) => { taskListId: string; taskId: string };
let parseGoogleDueToDueDay: (due?: string | null) => string | undefined;
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
    DEFAULT_CLIENT_ID,
    DEFAULT_CLIENT_SECRET,
    DEFAULT_IOS_CLIENT_ID,
    DEFAULT_MOBILE_CLIENT_ID,
    GOOGLE_TASKS_SCOPE,
    formatDueDayToGoogleDue,
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

  describe('OAuth and custom credential configuration', () => {
    it('falls back to the Google Calendar OAuth client credentials by default', () => {
      const oauthField = definition.configFields.find((f) => f.key === 'oauth');
      expect(oauthField?.type).toBe('oauthButton');
      expect(oauthField?.oauthConfig).toEqual({
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId: DEFAULT_CLIENT_ID,
        clientSecret: DEFAULT_CLIENT_SECRET,
        mobileClientId: DEFAULT_MOBILE_CLIENT_ID,
        iosClientId: DEFAULT_IOS_CLIENT_ID,
        scopes: [GOOGLE_TASKS_SCOPE],
        extraAuthParams: { access_type: 'offline', prompt: 'consent' },
      });
    });

    it('exposes advanced oauthOverrides fields for custom clientId, clientSecret, and redirectUri', () => {
      const clientIdField = definition.configFields.find(
        (f) => f.key === 'oauthOverrides.clientId',
      );
      const clientSecretField = definition.configFields.find(
        (f) => f.key === 'oauthOverrides.clientSecret',
      );
      const redirectUriField = definition.configFields.find(
        (f) => f.key === 'oauthOverrides.redirectUri',
      );

      expect(clientIdField).toMatchObject({
        type: 'input',
        advanced: true,
      });
      expect(clientSecretField).toMatchObject({
        type: 'password',
        advanced: true,
      });
      expect(redirectUriField).toMatchObject({
        type: 'input',
        advanced: true,
      });
    });

    it('reads OAuth token with transient provider-specific token key', async () => {
      const pluginApi = (globalThis as Record<string, unknown>).PluginAPI as {
        getOAuthToken: ReturnType<typeof vi.fn>;
      };
      pluginApi.getOAuthToken.mockResolvedValueOnce('scoped-token');

      await expect(
        definition.getHeaders({ __spOAuthTokenKey: 'provider-1' }),
      ).resolves.toEqual({
        Authorization: 'Bearer scoped-token',
        'Content-Type': 'application/json',
      });

      expect(pluginApi.getOAuthToken).toHaveBeenCalledWith('provider-1');
    });

    it('throws when OAuth token is missing', async () => {
      const pluginApi = (globalThis as Record<string, unknown>).PluginAPI as {
        getOAuthToken: ReturnType<typeof vi.fn>;
      };
      pluginApi.getOAuthToken.mockResolvedValueOnce(null);

      await expect(definition.getHeaders({})).rejects.toThrow(
        'Not authenticated. Please connect your Google account first.',
      );
    });
  });

  describe('compound IDs and date helpers', () => {
    it('creates and parses compound IDs with fallback list ID', () => {
      expect(toCompoundId('list-1', 'task-1')).toBe('list-1::task-1');
      expect(parseCompoundId('list-1::task-1', '@default')).toEqual({
        taskListId: 'list-1',
        taskId: 'task-1',
      });
      expect(parseCompoundId('plain-task-id', 'my-list')).toEqual({
        taskListId: 'my-list',
        taskId: 'plain-task-id',
      });
    });

    it('converts between Google RFC 3339 due strings and YYYY-MM-DD dueDay', () => {
      expect(parseGoogleDueToDueDay('2026-11-20T00:00:00.000Z')).toBe('2026-11-20');
      expect(parseGoogleDueToDueDay('')).toBeUndefined();
      expect(parseGoogleDueToDueDay(null)).toBeUndefined();

      expect(formatDueDayToGoogleDue('2026-11-20')).toBe('2026-11-20T00:00:00.000Z');
      expect(formatDueDayToGoogleDue('')).toBeNull();
      expect(formatDueDayToGoogleDue(null)).toBeNull();
    });
  });

  describe('loadOptions for taskListId', () => {
    it('loads task lists from Google Tasks API and marks first as Default', async () => {
      const listField = definition.configFields.find((f) => f.key === 'taskListId')!;
      mockHttp.get.mockResolvedValueOnce({
        items: [
          { id: 'list-primary', title: 'My Tasks' },
          { id: 'list-work', title: 'Work' },
        ],
      });

      const options = await listField.loadOptions!({}, mockHttp);
      expect(mockHttp.get).toHaveBeenCalledWith(
        'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
        { params: { maxResults: '100' } },
      );
      expect(options).toEqual([
        { label: 'My Tasks (Default)', value: 'list-primary' },
        { label: 'Work', value: 'list-work' },
      ]);
    });
  });

  describe('searchIssues and getNewIssuesForBacklog', () => {
    it('searches tasks across pages and filters by search term', async () => {
      mockHttp.get
        .mockResolvedValueOnce({
          items: [
            {
              id: 't1',
              title: 'Buy milk',
              notes: 'From grocery store',
              status: 'needsAction',
              due: '2026-11-16T00:00:00.000Z',
            },
            {
              id: 't2',
              title: 'Deleted task',
              deleted: true,
            },
          ],
          nextPageToken: 'page-2',
        })
        .mockResolvedValueOnce({
          items: [
            {
              id: 't3',
              title: 'Prepare milkshakes',
              status: 'needsAction',
            },
            {
              id: 't4',
              title: 'Unrelated task',
              status: 'needsAction',
            },
          ],
        });

      const results = await definition.searchIssues(
        'milk',
        { taskListId: 'list-1' },
        mockHttp,
      );

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        id: 'list-1::t1',
        title: 'Buy milk',
        status: 'needsAction',
        dueDay: '2026-11-16',
        isAllDay: true,
      });
      expect(results[1]).toMatchObject({
        id: 'list-1::t3',
        title: 'Prepare milkshakes',
      });
    });

    it('returns only open tasks for getNewIssuesForBacklog', async () => {
      mockHttp.get.mockResolvedValueOnce({
        items: [
          { id: 't1', title: 'Open task', status: 'needsAction' },
          { id: 't2', title: 'Done task', status: 'completed' },
        ],
      });

      const backlog = await definition.getNewIssuesForBacklog!(
        { taskListId: 'list-1' },
        mockHttp,
      );

      expect(backlog).toHaveLength(1);
      expect(backlog[0].id).toBe('list-1::t1');
    });
  });

  describe('getById, createIssue, updateIssue, deleteIssue', () => {
    it('fetches a single task by compound ID and maps it to PluginIssue', async () => {
      mockHttp.get.mockResolvedValueOnce({
        id: 'task-42',
        title: 'Review PR',
        notes: 'Check tests',
        status: 'completed',
        due: '2026-11-25T00:00:00.000Z',
        updated: '2026-11-16T10:00:00.000Z',
      });

      const issue = await definition.getById('list-1::task-42', {}, mockHttp);
      expect(mockHttp.get).toHaveBeenCalledWith(
        'https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks/task-42',
      );
      expect(issue).toMatchObject({
        id: 'list-1::task-42',
        title: 'Review PR',
        body: 'Check tests',
        state: 'completed',
        dueDay: '2026-11-25',
      });
    });

    it('creates a new task in the configured task list', async () => {
      mockHttp.post.mockResolvedValueOnce({
        id: 'new-task-1',
        title: 'New SP Task',
        status: 'needsAction',
        updated: '2026-11-16T12:00:00.000Z',
      });

      const created = await definition.createIssue!(
        'New SP Task',
        { taskListId: 'list-abc' },
        mockHttp,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        'https://tasks.googleapis.com/tasks/v1/lists/list-abc/tasks',
        { title: 'New SP Task' },
      );
      expect(created.issueId).toBe('list-abc::new-task-1');
    });

    it('patches title, notes, due date, and completion status in updateIssue', async () => {
      mockHttp.patch.mockResolvedValue({});

      await definition.updateIssue!(
        'list-abc::task-1',
        {
          title: 'Updated title',
          body: 'Updated notes',
          state: 'completed',
          dueDay: '2026-12-01',
        },
        {},
        mockHttp,
      );

      expect(mockHttp.patch).toHaveBeenCalledWith(
        'https://tasks.googleapis.com/tasks/v1/lists/list-abc/tasks/task-1',
        expect.objectContaining({
          title: 'Updated title',
          notes: 'Updated notes',
          status: 'completed',
          due: '2026-12-01T00:00:00.000Z',
          completed: expect.any(String),
        }),
      );

      // Reopening clears completed timestamp
      await definition.updateIssue!(
        'list-abc::task-1',
        { state: 'needsAction', dueDay: null },
        {},
        mockHttp,
      );

      expect(mockHttp.patch).toHaveBeenLastCalledWith(
        'https://tasks.googleapis.com/tasks/v1/lists/list-abc/tasks/task-1',
        {
          status: 'needsAction',
          completed: null,
          due: null,
        },
      );
    });

    it('deletes a task by compound ID', async () => {
      mockHttp.delete.mockResolvedValueOnce({});

      await definition.deleteIssue!('list-abc::task-99', {}, mockHttp);
      expect(mockHttp.delete).toHaveBeenCalledWith(
        'https://tasks.googleapis.com/tasks/v1/lists/list-abc/tasks/task-99',
      );
    });
  });

  describe('fieldMappings and extractSyncValues', () => {
    const ctx = { issueId: 'list-1::t1' };

    it('maps isDone <-> state bidirectionally', () => {
      const mapping = definition.fieldMappings!.find((m) => m.taskField === 'isDone')!;
      expect(mapping.defaultDirection).toBe('both');
      expect(mapping.toIssueValue(true, ctx)).toBe('completed');
      expect(mapping.toIssueValue(false, ctx)).toBe('needsAction');
      expect(mapping.toTaskValue('completed', ctx)).toBe(true);
      expect(mapping.toTaskValue('needsAction', ctx)).toBe(false);
    });

    it('maps dueDay bidirectionally and marks dueWithTime mutually exclusive', () => {
      const mapping = definition.fieldMappings!.find((m) => m.taskField === 'dueDay')!;
      expect(mapping.defaultDirection).toBe('both');
      expect(mapping.mutuallyExclusive).toEqual(['dueWithTime']);
      expect(mapping.toIssueValue('2026-11-16', ctx)).toBe('2026-11-16');
      expect(mapping.toIssueValue('', ctx)).toBeNull();
      expect(mapping.toTaskValue('2026-11-16', ctx)).toBe('2026-11-16');
      expect(mapping.toTaskValue(undefined, ctx)).toBeUndefined();
    });

    it('extracts sync values for state, title, body, and dueDay', () => {
      const issue = {
        id: 'list-1::t1',
        title: 'Task',
        body: 'Note',
        state: 'needsAction',
        dueDay: '2026-11-16',
      };
      expect(definition.extractSyncValues!(issue)).toEqual({
        state: 'needsAction',
        title: 'Task',
        body: 'Note',
        dueDay: '2026-11-16',
      });
    });
  });
});

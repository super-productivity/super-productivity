import { describe, it, expect, vi } from 'vitest';
import type { PluginHttp } from '@super-productivity/plugin-api';
import {
  parseTeamIds,
  mapSearchResult,
  getWithRetry,
  searchTasksInTeam,
  getTeamIds,
  mapTaskToPluginIssue,
  ClickUpTask,
  ClickUpTaskReduced,
  ClickUpStatus,
} from './clickup-api';

const mockStatus = (overrides: Partial<ClickUpStatus> = {}): ClickUpStatus => ({
  status: 'open',
  type: 'open',
  orderindex: 0,
  color: '#000',
  ...overrides,
});

const mockTaskReduced = (
  overrides: Partial<ClickUpTaskReduced> = {},
): ClickUpTaskReduced => ({
  id: 'abc123',
  name: 'Test Task',
  status: mockStatus(),
  date_updated: '1600000000000',
  url: 'https://app.clickup.com/t/abc123',
  custom_id: null,
  ...overrides,
});

const mockTask = (overrides: Partial<ClickUpTask> = {}): ClickUpTask => ({
  ...mockTaskReduced(),
  date_created: '1500000000000',
  date_closed: null,
  creator: {
    id: 1,
    username: 'creator',
    color: null,
    email: 'creator@example.com',
    profilePicture: null,
  },
  assignees: [],
  tags: [],
  priority: null,
  ...overrides,
});

const mockHttp = (responses: Record<string, unknown> = {}): PluginHttp => ({
  get: vi.fn(async (url: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (url.includes(pattern)) return response;
    }
    throw new Error(`No mock for ${url}`);
  }),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
});

// --- parseTeamIds ---

describe('parseTeamIds', () => {
  it('should return empty array when teamIds is undefined', () => {
    expect(parseTeamIds({ apiKey: 'key' })).toEqual([]);
  });

  it('should return empty array when teamIds is empty string', () => {
    expect(parseTeamIds({ apiKey: 'key', teamIds: '' })).toEqual([]);
  });

  it('should parse comma-separated team IDs', () => {
    expect(parseTeamIds({ apiKey: 'key', teamIds: 'T1,T2,T3' })).toEqual([
      'T1',
      'T2',
      'T3',
    ]);
  });

  it('should trim whitespace', () => {
    expect(parseTeamIds({ apiKey: 'key', teamIds: ' T1 , T2 ' })).toEqual(['T1', 'T2']);
  });

  it('should filter empty segments', () => {
    expect(parseTeamIds({ apiKey: 'key', teamIds: 'T1,,T2,' })).toEqual(['T1', 'T2']);
  });
});

// --- mapSearchResult ---

describe('mapSearchResult', () => {
  it('should map task to search result with status type', () => {
    const task = mockTaskReduced({ id: '42', name: 'My Task' });
    const result = mapSearchResult(task);
    expect(result).toEqual({
      id: '42',
      title: 'My Task',
      url: 'https://app.clickup.com/t/abc123',
      status: 'open',
    });
  });

  it('should use status.type for closed detection, not status.status', () => {
    const task = mockTaskReduced({
      id: '99',
      name: 'Shipped Task',
      status: mockStatus({ status: 'Shipped', type: 'closed' }),
    });
    const result = mapSearchResult(task);
    expect(result.status).toBe('closed');
  });
});

// --- mapTaskToPluginIssue ---

describe('mapTaskToPluginIssue', () => {
  it('should map task fields correctly', () => {
    const task = mockTask({
      id: 'x1',
      name: 'Important Task',
      markdown_description: '# Hello',
      date_updated: '1700000000000',
      assignees: [
        {
          id: 1,
          username: 'alice',
          color: null,
          email: 'alice@example.com',
          profilePicture: null,
        },
        {
          id: 2,
          username: null,
          color: null,
          email: 'bob@example.com',
          profilePicture: null,
        },
      ],
      tags: [{ name: 'bug' }, { name: 'urgent' }],
      priority: { id: '1', priority: 'high', color: '#f00' },
      status: mockStatus({ status: 'in progress', type: 'custom' }),
    });

    const result = mapTaskToPluginIssue(task);

    expect(result.id).toBe('x1');
    expect(result.title).toBe('Important Task');
    expect(result.body).toBe('# Hello');
    // state maps to status.type for correct isDone detection
    expect(result.state).toBe('custom');
    expect(result.lastUpdated).toBe(1700000000000);
    expect(result.assignee).toBe('alice, bob@example.com');
    expect(result.labels).toEqual(['bug', 'urgent']);
    expect(result['statusName']).toBe('in progress');
    expect(result['statusType']).toBe('custom');
    expect(result['priority']).toBe('high');
    expect(result['description']).toBe('# Hello');
  });

  it('should fall back to description when markdown_description is null', () => {
    const task = mockTask({
      markdown_description: null,
      description: '<p>HTML desc</p>',
    });
    const result = mapTaskToPluginIssue(task);
    expect(result.body).toBe('<p>HTML desc</p>');
  });

  it('should handle empty assignees and tags', () => {
    const task = mockTask({ assignees: [], tags: [] });
    const result = mapTaskToPluginIssue(task);
    expect(result.assignee).toBe('');
    expect(result.labels).toEqual([]);
  });

  it('should use status.type=closed for custom closed statuses like "Shipped"', () => {
    const task = mockTask({
      status: mockStatus({ status: 'Shipped', type: 'closed' }),
    });
    const result = mapTaskToPluginIssue(task);
    // state should be 'closed' (from type), not 'Shipped' (from status name)
    expect(result.state).toBe('closed');
    // statusName should preserve the human-readable name for display
    expect(result['statusName']).toBe('Shipped');
  });

  it('should map state to open for open status type', () => {
    const task = mockTask({
      status: mockStatus({ status: 'To Do', type: 'open' }),
    });
    const result = mapTaskToPluginIssue(task);
    expect(result.state).toBe('open');
  });

  it('should handle undefined custom_id without error', () => {
    const task = mockTask({ custom_id: undefined });
    const result = mapTaskToPluginIssue(task);
    expect(result.title).toBe('Test Task');
  });

  it('should use "Unknown" for assignees without username or email', () => {
    const task = mockTask({
      assignees: [
        {
          id: 1,
          username: null,
          color: null,
          email: '' as string,
          profilePicture: null,
        },
      ],
    });
    const result = mapTaskToPluginIssue(task);
    expect(result.assignee).toBe('Unknown');
  });
});

// --- getWithRetry ---

describe('getWithRetry', () => {
  it('should return data on first success', async () => {
    const http = mockHttp({ '/task/1': { id: '1', name: 'Task' } });
    const result = await getWithRetry(http, 'https://api.clickup.com/api/v2/task/1');
    expect(result).toEqual({ id: '1', name: 'Task' });
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('should retry on 429 and succeed', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const http: PluginHttp = {
      get: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw { status: 429 };
        return { ok: true };
      }),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    const promise = getWithRetry(http, 'https://example.com/api');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(http.get).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('should throw non-429 errors immediately', async () => {
    const http: PluginHttp = {
      get: vi.fn(async () => {
        throw { status: 500, message: 'Server Error' };
      }),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await expect(getWithRetry(http, 'https://example.com/api')).rejects.toEqual({
      status: 500,
      message: 'Server Error',
    });
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('should throw after max retries on persistent 429', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const http: PluginHttp = {
      get: vi.fn(async () => {
        callCount++;
        throw { status: 429 };
      }),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    const promise = getWithRetry(http, 'https://example.com/api').catch((e) => e);

    // Advance through all retry delays
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(5000);
    }

    const result = await promise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('ClickUp: Max retries exceeded');
    expect(callCount).toBe(3);
    vi.useRealTimers();
  });
});

// --- searchTasksInTeam ---

describe('searchTasksInTeam', () => {
  const cfg = { apiKey: 'key', userId: '42' };

  it('should fetch tasks and pass userId as assignee filter', async () => {
    const tasks = [mockTask({ id: '1', name: 'Task A' })];
    const http = mockHttp({ '/team/T1/task': { tasks } });

    const result = await searchTasksInTeam('', 'T1', cfg, http);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
    expect(http.get).toHaveBeenCalledWith(
      expect.stringContaining('/team/T1/task'),
      expect.objectContaining({
        params: expect.objectContaining({ 'assignees[]': '42' }),
      }),
    );
  });

  it('should filter by search term (name)', async () => {
    const tasks = [
      mockTask({ id: '1', name: 'Fix bug' }),
      mockTask({ id: '2', name: 'Add feature' }),
    ];
    const http = mockHttp({ '/team/T1/task': { tasks } });

    const result = await searchTasksInTeam('bug', 'T1', cfg, http);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Fix bug');
  });

  it('should filter by search term (custom_id)', async () => {
    const tasks = [
      mockTask({ id: '1', name: 'Task A', custom_id: 'PROJ-123' }),
      mockTask({ id: '2', name: 'Task B', custom_id: null }),
    ];
    const http = mockHttp({ '/team/T1/task': { tasks } });

    const result = await searchTasksInTeam('PROJ-123', 'T1', cfg, http);
    expect(result).toHaveLength(1);
    expect(result[0].custom_id).toBe('PROJ-123');
  });

  it('should filter by search term (task id)', async () => {
    const tasks = [
      mockTask({ id: 'abc123', name: 'Task A' }),
      mockTask({ id: 'xyz789', name: 'Task B' }),
    ];
    const http = mockHttp({ '/team/T1/task': { tasks } });

    const result = await searchTasksInTeam('abc123', 'T1', cfg, http);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('abc123');
  });

  it('should return all tasks when search term is empty', async () => {
    const tasks = [
      mockTask({ id: '1', name: 'A' }),
      mockTask({ id: '2', name: 'B' }),
    ];
    const http = mockHttp({ '/team/T1/task': { tasks } });

    const result = await searchTasksInTeam('', 'T1', cfg, http);
    expect(result).toHaveLength(2);
  });

  it('should propagate errors so Promise.allSettled can handle per-team failures', async () => {
    const http: PluginHttp = {
      get: vi.fn(async () => {
        throw { status: 500, message: 'Server Error' };
      }),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    await expect(searchTasksInTeam('test', 'T1', cfg, http)).rejects.toEqual({
      status: 500,
      message: 'Server Error',
    });
  });

  it('should not pass assignee filter when userId is absent', async () => {
    const http = mockHttp({ '/team/T1/task': { tasks: [] } });

    await searchTasksInTeam('', 'T1', { apiKey: 'key' }, http);
    expect(http.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.not.objectContaining({ 'assignees[]': expect.anything() }),
      }),
    );
  });
});

// --- getTeamIds ---

describe('getTeamIds', () => {
  it('should return configured team IDs without API call', async () => {
    const http = mockHttp();
    const result = await getTeamIds({ apiKey: 'key', teamIds: 'T1,T2' }, http);
    expect(result).toEqual(['T1', 'T2']);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('should fetch teams from API when none configured', async () => {
    const http = mockHttp({
      '/team': { teams: [{ id: 'A1', name: 'Alpha' }, { id: 'B2', name: 'Beta' }] },
    });
    const result = await getTeamIds({ apiKey: 'key' }, http);
    expect(result).toEqual(['A1', 'B2']);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('should return empty array when API returns no teams', async () => {
    const http = mockHttp({ '/team': { teams: [] } });
    const result = await getTeamIds({ apiKey: 'key' }, http);
    expect(result).toEqual([]);
  });
});

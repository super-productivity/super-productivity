import { describe, it, expect, beforeAll, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;

beforeAll(async () => {
  (globalThis as unknown as { PluginAPI: unknown }).PluginAPI = {
    registerIssueProvider: vi.fn((def: IssueProviderPluginDefinition) => {
      definition = def;
    }),
    translate: (key: string) => key,
  };
  await import('./plugin');
});

const HOST = 'https://redmine.example.com';
const cfg = { host: `${HOST}/`, api_key: 'k', projectId: 'proj' };

type Responder = (url: string, params?: Record<string, string>) => unknown;

const createHttp = (
  respond: Responder,
): PluginHttp & { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> } =>
  ({
    get: vi.fn(async (url: string, opts?: { params?: Record<string, string> }) =>
      respond(url, opts?.params),
    ),
    post: vi.fn(async () => ({})),
  }) as unknown as PluginHttp & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };

const issue = (id: number, subject: string): Record<string, unknown> => ({
  id,
  subject,
  status: { id: 1, name: 'New' },
  updated_on: '2024-01-02T00:00:00Z',
});

describe('Redmine Plugin - searchIssues', () => {
  it('merges the exact id match with full-text results without duplicates', async () => {
    const http = createHttp((url, params) => {
      if (url === `${HOST}/projects/proj/issues.json`) {
        expect(params).toEqual(
          expect.objectContaining({ issue_id: '12', status_id: '*' }),
        );
        return { issues: [issue(12, 'Closed one')] };
      }
      return {
        results: [
          { id: 12, title: 'Bug #12 (Closed): Closed one', url: `${HOST}/issues/12` },
          { id: 120, title: 'Bug #120 (New): Other', url: `${HOST}/issues/120` },
        ],
      };
    });
    const res = await definition.searchIssues('#12', cfg, http);
    expect(res.map((r) => [r.id, r.title])).toEqual([
      ['12', '#12 Closed one'],
      ['120', '#120 Bug  (New): Other'],
    ]);
  });

  it('falls back to a subject filter for non-ASCII terms without results', async () => {
    const http = createHttp((url, params) => {
      if (url.endsWith('/search.json')) {
        return { results: [] };
      }
      expect(params?.['v[subject][]']).toBe('日本');
      return { issues: [issue(5, '日本語')] };
    });
    const res = await definition.searchIssues('日本', cfg, http);
    expect(res.map((r) => r.title)).toEqual(['#5 日本語']);
  });

  it('searches instance-wide without a project', async () => {
    const http = createHttp(() => ({ results: [] }));
    await definition.searchIssues('x', { ...cfg, projectId: '' }, http);
    expect(http.get.mock.calls[0][0]).toBe(`${HOST}/search.json`);
  });
});

describe('Redmine Plugin - backlog and issue', () => {
  it('defaults the backlog scope to assigned-to-me', async () => {
    const http = createHttp(() => ({ issues: [issue(1, 'A')] }));
    const res = await definition.getNewIssuesForBacklog!(cfg, http);
    expect(http.get.mock.calls[0][1].params).toEqual({
      limit: '100',
      assigned_to_id: 'me',
    });
    expect(res[0].title).toBe('#1 A');
  });

  it('does not expose a `state` so the host never derives isDone', async () => {
    const http = createHttp(() => ({
      issue: { ...issue(3, 'S'), status: { id: 5, name: 'Closed' }, spent_hours: 1.5 },
    }));
    const res = await definition.getById('3', cfg, http);
    expect(res.state).toBeUndefined();
    expect(res['status']).toBe('Closed');
    expect(res['timeSpent']).toBe('1h 30m');
    expect(res.url).toBe(`${HOST}/issues/3`);
  });
});

describe('Redmine Plugin - timeTracking', () => {
  it('posts a time entry in hours on the local start day', async () => {
    const http = createHttp(() => ({}));
    const started = new Date(2024, 4, 3, 23, 30).getTime();
    await definition.timeTracking!.logTime(
      '42',
      { started, timeSpentMs: 5400000, comment: 'c', activityId: 9 },
      cfg,
      http,
    );
    expect(http.post).toHaveBeenCalledWith(`${HOST}/time_entries.json`, {
      time_entry: {
        issue_id: 42,
        spent_on: '2024-05-03',
        hours: 1.5,
        activity_id: 9,
        comments: 'c',
      },
    });
  });

  it('sums the logged hours of the current user as ms', async () => {
    const http = createHttp(() => ({ time_entries: [{ hours: 1 }, { hours: 0.5 }] }));
    const ms = await definition.timeTracking!.getTimeLogged!('42', cfg, http);
    expect(ms).toBe(5400000);
  });
});

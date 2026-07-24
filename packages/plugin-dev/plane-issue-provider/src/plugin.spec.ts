import { describe, it, expect, beforeAll, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '@super-productivity/plugin-api';
import {
  buildBrowseUrl,
  displayKey,
  getApiBase,
  getUiBase,
  isDoneStateGroup,
  mapSearchHit,
  mapWorkItem,
} from './plane-helpers';

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

describe('Plane URL helpers', () => {
  it('defaults API and UI bases to Plane Cloud', () => {
    expect(getApiBase({})).toBe('https://api.plane.so');
    expect(getUiBase({})).toBe('https://app.plane.so');
  });

  it('uses custom host for self-hosted API and UI', () => {
    const cfg = { host: 'https://plane.example.com/' };
    expect(getApiBase(cfg)).toBe('https://plane.example.com');
    expect(getUiBase(cfg)).toBe('https://plane.example.com');
  });

  it('builds browse URLs', () => {
    expect(buildBrowseUrl({ workspaceSlug: 'acme', host: '' }, 'ENG', 42)).toBe(
      'https://app.plane.so/acme/browse/ENG-42',
    );
    expect(buildBrowseUrl({ workspaceSlug: '' }, 'ENG', 42)).toBe('');
  });

  it('formats display keys', () => {
    expect(displayKey('ENG', 7)).toBe('ENG-7');
  });
});

describe('Plane mapping', () => {
  it('maps search hits', () => {
    const mapped = mapSearchHit(
      {
        id: 'uuid-1',
        name: 'Fix login',
        sequence_id: 12,
        project__identifier: 'ENG',
      },
      { workspaceSlug: 'acme' },
    );
    expect(mapped.id).toBe('uuid-1');
    expect(mapped.title).toBe('ENG-12 Fix login');
    expect(mapped.url).toBe('https://app.plane.so/acme/browse/ENG-12');
  });

  it('maps work items with expanded state and assignees', () => {
    const mapped = mapWorkItem(
      {
        id: 'uuid-2',
        name: 'Ship it',
        sequence_id: 3,
        description_stripped: 'body',
        priority: 'high',
        target_date: '2026-08-01',
        updated_at: '2026-07-01T00:00:00Z',
        project: { identifier: 'ENG' },
        state: { name: 'Done', group: 'completed' },
        assignees: [{ display_name: 'Ada' }],
      },
      { workspaceSlug: 'acme' },
    );
    expect(mapped.summary).toBe('ENG-3 Ship it');
    expect(mapped.state).toBe('Done');
    expect(mapped.stateGroup).toBe('completed');
    expect(mapped.assignee).toBe('Ada');
    expect(mapped.due).toBe('2026-08-01');
    expect(isDoneStateGroup(mapped.stateGroup)).toBe(true);
  });

  it('treats cancelled as done and unstarted as not done', () => {
    expect(isDoneStateGroup('cancelled')).toBe(true);
    expect(isDoneStateGroup('unstarted')).toBe(false);
  });
});

describe('Plane plugin definition', () => {
  it('sends X-API-Key header', () => {
    expect(definition.getHeaders({ apiKey: 'plane_api_x' })).toEqual({
      'X-API-Key': 'plane_api_x',
      Accept: 'application/json',
    });
  });

  it('getIssueLink returns empty so adapter can fall back to getById url', () => {
    expect(definition.getIssueLink('uuid', {})).toBe('');
  });

  it('searchIssues calls the workspace search endpoint', async () => {
    const http = {
      get: vi.fn(async () => ({
        issues: [
          {
            id: 'uuid-1',
            name: 'Fix login',
            sequence_id: 12,
            project__identifier: 'ENG',
          },
        ],
      })),
    } as unknown as PluginHttp;

    const results = await definition.searchIssues(
      'login',
      { workspaceSlug: 'acme', projectId: 'proj-1', apiKey: 'k' },
      http,
    );

    expect(http.get).toHaveBeenCalledWith(
      'https://api.plane.so/api/v1/workspaces/acme/work-items/search/',
      {
        params: {
          search: 'login',
          limit: '50',
          project_id: 'proj-1',
        },
      },
    );
    expect(results[0]?.title).toBe('ENG-12 Fix login');
  });

  it('getNewIssuesForBacklog skips completed/cancelled state groups', async () => {
    const http = {
      get: vi.fn(async (url: string) => {
        if (url.includes('/projects/proj-1/') && !url.includes('work-items')) {
          return { identifier: 'ENG' };
        }
        return {
          results: [
            {
              id: 'open-1',
              name: 'Open',
              sequence_id: 1,
              state: { name: 'Todo', group: 'unstarted' },
            },
            {
              id: 'done-1',
              name: 'Done',
              sequence_id: 2,
              state: { name: 'Done', group: 'completed' },
            },
            {
              id: 'cancel-1',
              name: 'Cancelled',
              sequence_id: 3,
              state: { name: 'Cancelled', group: 'cancelled' },
            },
          ],
          next_page_results: false,
        };
      }),
    } as unknown as PluginHttp;

    const results = await definition.getNewIssuesForBacklog!(
      { workspaceSlug: 'acme', projectId: 'proj-1' },
      http,
    );

    expect(results.map((r) => r.id)).toEqual(['open-1']);
  });

  it('testConnection probes /users/me/', async () => {
    const http = {
      get: vi.fn(async () => ({ id: 'me' })),
    } as unknown as PluginHttp;
    await expect(definition.testConnection!({ apiKey: 'k' }, http)).resolves.toBe(true);
    expect(http.get).toHaveBeenCalledWith('https://api.plane.so/api/v1/users/me/');
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;

beforeAll(async () => {
  vi.stubGlobal('PluginAPI', {
    registerIssueProvider: (provider: IssueProviderPluginDefinition) => {
      definition = provider;
    },
    translate: (key: string) => key,
  });
  await import('./plugin');
});

afterAll(() => vi.unstubAllGlobals());

const makeIssue = (title = 'Some title') => ({
  id: 'linear-issue-id',
  identifier: 'PLAT-123',
  number: 123,
  title,
  url: 'https://linear.app/team/issue/PLAT-123',
  state: { name: 'In Progress', type: 'started' },
  updatedAt: '2026-01-01T12:00:00Z',
  createdAt: '2026-01-01T10:00:00Z',
  priority: 0,
});

const makeHttp = (issue: ReturnType<typeof makeIssue>): PluginHttp =>
  ({
    post: vi.fn(async () => ({
      data: {
        issue,
        viewer: { assignedIssues: { nodes: [issue] } },
      },
    })),
  }) as unknown as PluginHttp;

describe('Linear issue titles', () => {
  it('keeps the imported identifier when fetching the full issue', async () => {
    const issue = makeIssue();
    const http = makeHttp(issue);
    const searchResults = await definition.searchIssues('PLAT-123', {}, http);
    const backlogIssues = await definition.getNewIssuesForBacklog!({}, http);
    const refreshed = await definition.getById(issue.id, {}, http);

    expect(searchResults[0].title).toBe('PLAT-123 Some title');
    expect(backlogIssues[0].title).toBe(searchResults[0].title);
    expect(refreshed.title).toBe(searchResults[0].title);
  });

  it('keeps the identifier in the sync values after a remote rename', async () => {
    const issue = makeIssue();
    const http = makeHttp(issue);
    const previous = await definition.getById(issue.id, {}, http);
    issue.title = 'Renamed title';
    const refreshed = await definition.getById(issue.id, {}, http);

    expect(refreshed.title).toBe('PLAT-123 Renamed title');
    expect(refreshed.title).not.toBe(previous.title);
    expect(definition.extractSyncValues!(refreshed).title).toBe(refreshed.title);
  });

  it('does not accumulate identifiers on repeated refreshes', async () => {
    const issue = makeIssue();
    const http = makeHttp(issue);
    const first = await definition.getById(issue.id, {}, http);
    const second = await definition.getById(issue.id, {}, http);

    expect(first.title).toBe('PLAT-123 Some title');
    expect(second.title).toBe(first.title);
    expect(issue.title).toBe('Some title');
  });
});

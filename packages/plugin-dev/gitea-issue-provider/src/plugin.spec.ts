import { describe, it, expect, beforeAll, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
  PluginHttpOptions,
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

interface GiteaIssueFixture {
  id: number;
  number: number;
  html_url: string;
  title: string;
  state: string;
  labels: { name: string }[];
  repository: { full_name: string };
}

const makeIssue = (n: number): GiteaIssueFixture => ({
  id: n,
  number: n,
  html_url: `https://gitea.example/org/repo/issues/${n}`,
  title: `Issue ${n}`,
  state: 'open',
  labels: [],
  repository: { full_name: 'org/repo' },
});

const makeHttp = (
  pages: GiteaIssueFixture[][],
): { http: PluginHttp; urls: string[] } => {
  const urls: string[] = [];
  const http = {
    get: vi.fn(async (url: string, opts?: PluginHttpOptions) => {
      const qs = new URLSearchParams(opts?.params).toString();
      const full = qs ? `${url}?${qs}` : url;
      urls.push(full);
      if (full.includes('/user')) {
        return { id: 1, login: 'me', username: 'me', full_name: '', avatar_url: '' };
      }
      const match = /[?&]page=(\d+)/.exec(full);
      return match ? pages[Number(match[1]) - 1] ?? [] : pages[0] ?? [];
    }),
  } as unknown as PluginHttp;
  return { http, urls };
};

describe('Gitea Plugin - getNewIssuesForBacklog', () => {
  it('paginates until a page comes back empty and merges all issues', async () => {
    const pageOne = Array.from({ length: 100 }, (_, i) => makeIssue(i + 1));
    const pageTwo = Array.from({ length: 100 }, (_, i) => makeIssue(i + 101));
    const { http, urls } = makeHttp([pageOne, pageTwo, []]);

    const result = await definition.getNewIssuesForBacklog!(
      { host: 'https://gitea.example', repoFullname: 'org/repo', scope: 'all' },
      http,
    );

    expect(urls).toHaveLength(3);
    expect(result.map((r) => r.id)).toHaveLength(200);
    expect(result[0].title).toBe('#1 Issue 1');
    expect(result[199].title).toBe('#200 Issue 200');
  });

  it('does not call /user when scope is "all"', async () => {
    const { http, urls } = makeHttp([[makeIssue(1)], [], []]);

    await definition.getNewIssuesForBacklog!(
      { host: 'https://gitea.example', repoFullname: 'org/repo', scope: 'all' },
      http,
    );

    expect(urls.every((u) => !u.includes('/user'))).toBe(true);
    expect(urls.every((u) => u.includes('type=issues'))).toBe(true);
  });
});

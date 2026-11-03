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
    log: { err: vi.fn() },
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
  comments: number;
  created_at: string;
  updated_at: string;
  user: null;
}

const makeIssue = (n: number, repo = 'org/repo'): GiteaIssueFixture => ({
  id: n,
  number: n,
  html_url: `https://gitea.example/${repo}/issues/${n}`,
  title: `Issue ${n}`,
  state: 'open',
  labels: [],
  repository: { full_name: repo },
  comments: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  user: null,
});

// Serves `pages` for any list endpoint (page N → pages[N-1]), the current
// user for /user, and a single issue for /repos/{owner}/{repo}/issues/{n}.
const makeHttp = (pages: GiteaIssueFixture[][]): { http: PluginHttp; urls: string[] } => {
  const urls: string[] = [];
  const http = {
    get: vi.fn(async (url: string, opts?: PluginHttpOptions) => {
      const qs = new URLSearchParams(opts?.params).toString();
      const full = qs ? `${url}?${qs}` : url;
      urls.push(full);
      if (url.endsWith('/user')) {
        return { id: 1, login: 'me', username: 'me', full_name: '', avatar_url: '' };
      }
      const single = /\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(url);
      if (single) {
        return makeIssue(Number(single[2]), single[1]);
      }
      const match = /[?&]page=(\d+)/.exec(full);
      return match ? (pages[Number(match[1]) - 1] ?? []) : (pages[0] ?? []);
    }),
  } as unknown as PluginHttp;
  return { http, urls };
};

const perRepo = { host: 'https://gitea.example', repoFullname: 'org/repo', scope: 'all' };
const instanceWide = { host: 'https://gitea.example', scope: 'assigned-to-me' };

describe('Gitea Plugin - getNewIssuesForBacklog', () => {
  it('paginates until a page comes back empty and merges all issues', async () => {
    const pageOne = Array.from({ length: 50 }, (_, i) => makeIssue(i + 1));
    const pageTwo = Array.from({ length: 50 }, (_, i) => makeIssue(i + 51));
    const { http, urls } = makeHttp([pageOne, pageTwo, []]);

    const result = await definition.getNewIssuesForBacklog!(perRepo, http);

    expect(urls).toHaveLength(3);
    expect(result.map((r) => r.id)).toHaveLength(100);
    expect(result[0].title).toBe('#1 Issue 1');
    expect(result[99].title).toBe('#100 Issue 100');
  });

  it('does not call /user when scope is "all"', async () => {
    const { http, urls } = makeHttp([[makeIssue(1)], [], []]);

    await definition.getNewIssuesForBacklog!(perRepo, http);

    expect(urls.every((u) => !u.includes('/user'))).toBe(true);
    expect(urls.every((u) => u.includes('type=issues'))).toBe(true);
  });

  it('without a repo, searches the whole instance and prefixes ids with the repo', async () => {
    const { http, urls } = makeHttp([[makeIssue(1, 'a/x'), makeIssue(1, 'b/y')], []]);

    const result = await definition.getNewIssuesForBacklog!(instanceWide, http);

    expect(urls.every((u) => u.includes('/api/v1/repos/issues/search?'))).toBe(true);
    expect(urls[0]).toContain('assigned=true');
    expect(urls.some((u) => u.endsWith('/user'))).toBe(false);
    expect(result.map((r) => r.id)).toEqual(['a/x#1', 'b/y#1']);
    expect(result[0].title).toBe('a/x#1 Issue 1');
  });
});

describe('Gitea Plugin - searchIssues', () => {
  it('with a repo, queries that repo endpoint instead of filtering a global search', async () => {
    const { http, urls } = makeHttp([[makeIssue(3)]]);

    const result = await definition.searchIssues(
      'term',
      { ...perRepo, scope: 'created-by-me' },
      http,
    );

    const listUrl = urls.find((u) => !u.endsWith('/user'))!;
    expect(listUrl).toContain('/api/v1/repos/org/repo/issues?');
    expect(listUrl).toContain('q=term');
    expect(listUrl).toContain('created_by=me');
    expect(result.map((r) => r.id)).toEqual(['3']);
  });

  it('without a repo, searches the whole instance', async () => {
    const { http, urls } = makeHttp([[makeIssue(3, 'a/x')]]);

    const result = await definition.searchIssues(
      'term',
      { ...instanceWide, scope: 'created-by-me' },
      http,
    );

    expect(urls[0]).toContain('/api/v1/repos/issues/search?');
    expect(urls[0]).toContain('created=true');
    expect(result.map((r) => r.id)).toEqual(['a/x#3']);
  });
});

describe('Gitea Plugin - issue ids', () => {
  it('getById resolves a plain number against the configured repo', async () => {
    const { http, urls } = makeHttp([]);

    const issue = await definition.getById('7', perRepo, http);

    expect(urls[0]).toBe('https://gitea.example/api/v1/repos/org/repo/issues/7');
    expect(issue.id).toBe('7');
  });

  it('getById resolves an owner/repo#number id to that repo', async () => {
    const { http, urls } = makeHttp([]);

    const issue = await definition.getById('a/x#7', instanceWide, http);

    expect(urls[0]).toBe('https://gitea.example/api/v1/repos/a/x/issues/7');
    expect(issue.id).toBe('a/x#7');
  });

  it('getIssueLink handles both id forms', () => {
    expect(definition.getIssueLink('7', perRepo)).toBe(
      'https://gitea.example/org/repo/issues/7',
    );
    expect(definition.getIssueLink('a/x#7', instanceWide)).toBe(
      'https://gitea.example/a/x/issues/7',
    );
  });

  // Repository cleared on an existing provider: its tasks still carry plain
  // numeric ids that no longer resolve to any repo.
  it('rejects a plain numeric id when no repo is configured', async () => {
    const { http, urls } = makeHttp([]);

    await expect(definition.getById('7', instanceWide, http)).rejects.toThrow(
      'ERRORS.ID_WITHOUT_REPO',
    );
    expect(() => definition.getIssueLink('7', instanceWide)).toThrow(
      'ERRORS.ID_WITHOUT_REPO',
    );
    expect(urls).toHaveLength(0);
  });
});

describe('Gitea Plugin - host-wide scope guard', () => {
  // Without owner/created/assigned, /repos/issues/search covers every public
  // repository on the host, not the user's.
  const hostWideAll = { host: 'https://gitea.example', scope: 'all' };

  it('refuses scope "all" without a repo before any request', async () => {
    const { http, urls } = makeHttp([[makeIssue(1, 'a/x')]]);

    await expect(definition.searchIssues('x', hostWideAll, http)).rejects.toThrow(
      'ERRORS.HOST_WIDE_SCOPE',
    );
    await expect(definition.getNewIssuesForBacklog!(hostWideAll, http)).rejects.toThrow(
      'ERRORS.HOST_WIDE_SCOPE',
    );
    await expect(definition.testConnection!(hostWideAll, http)).rejects.toThrow(
      'ERRORS.HOST_WIDE_SCOPE',
    );
    expect(urls).toHaveLength(0);
  });
});

describe('Gitea Plugin - config', () => {
  it('repoFullname is optional and must be owner/repo when set', () => {
    const field = definition.configFields.find((f) => f.key === 'repoFullname')!;
    const pattern = new RegExp(field.pattern!);

    expect(field.required).toBeFalsy();
    expect(pattern.test('org/repo')).toBe(true);
    expect(pattern.test('justausername')).toBe(false);
    expect(pattern.test('a/b/c')).toBe(false);
  });

  it('testConnection without a repo checks the token user instead of a repo', async () => {
    const { http, urls } = makeHttp([]);

    expect(await definition.testConnection!(instanceWide, http)).toBe(true);
    expect(urls[0]).toBe('https://gitea.example/api/v1/user');
  });
});

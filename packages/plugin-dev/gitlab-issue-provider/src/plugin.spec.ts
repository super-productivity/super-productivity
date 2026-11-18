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

const API = 'https://gitlab.com/api/v4/projects/group%2Fsub%2Fproj';
const cfg = { project: 'group/sub/proj', token: 'tkn', scope: 'all' };

type Params = Record<string, string> | undefined;
type Responder = (url: string, params: Params) => unknown;

type MockHttp = PluginHttp & {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const createHttp = (respond: Responder): MockHttp =>
  ({
    get: vi.fn(async (url: string, opts?: { params?: Params }) =>
      respond(url, opts?.params),
    ),
    post: vi.fn(async () => ({})),
  }) as unknown as MockHttp;

const apiIssue = (iid: number, extra: Record<string, unknown> = {}) => ({
  iid,
  title: `Issue ${iid}`,
  description: 'desc',
  state: 'opened',
  created_at: '2026-01-08T03:00:00.000Z',
  updated_at: '2026-01-08T03:29:14.653Z',
  labels: [],
  web_url: `https://gitlab.com/group/sub/proj/-/issues/${iid}`,
  references: { full: `group/sub/proj#${iid}` },
  ...extra,
});

const note = (createdAt: string, username = 'other') => ({
  body: 'a comment',
  created_at: createdAt,
  author: { username, name: 'Other', avatar_url: 'https://a/b.png' },
});

describe('GitLab Plugin - manifest-facing config', () => {
  const field = (key: string) => definition.configFields.find((f) => f.key === key)!;

  it('exposes the legacy config keys', () => {
    expect(definition.configFields.map((f) => f.key)).toEqual([
      'project',
      'token',
      'tokenHelp',
      'scope',
      'gitlabBaseUrl',
      'filter',
      'isSubmitWorklogOnFinishDay',
    ]);
    expect(field('project').required).toBe(true);
    expect(field('token').type).toBe('password');
    expect(field('isSubmitWorklogOnFinishDay').type).toBe('checkbox');
  });

  it('sends the token as PRIVATE-TOKEN and nothing without a token', () => {
    expect(definition.getHeaders({ token: 'abc' })).toEqual({ 'PRIVATE-TOKEN': 'abc' });
    expect(definition.getHeaders({})).toEqual({});
  });

  describe('project pattern', () => {
    const isValid = (v: string): boolean => new RegExp(field('project').pattern!).test(v);

    it('compiles as a native pattern attribute (RegExp `v` flag, #9034)', () => {
      expect(() => new RegExp(`^(?:${field('project').pattern}$)`, 'v')).not.toThrow();
      expect(
        () => new RegExp(`^(?:${field('gitlabBaseUrl').pattern})$`, 'v'),
      ).not.toThrow();
    });

    it.each([
      'super-productivity/super-productivity',
      'group/subgroup/project',
      'my_group/my.project',
      'a.b-c/d_e',
      'group%2Fproject',
      'group%2fproject',
      'group%2Fsub%2Fproject',
      'group/foo--bar',
      '12345',
    ])('accepts "%s"', (value) => {
      expect(isValid(value)).toBe(true);
    });

    it.each([
      'My Group/My Gitlab',
      'group/Test Gitlab',
      'has space',
      ' leadingSpace',
      'trailingSpace ',
      'https://gitlab.com/foo/bar',
      'foo/bar?scope=all',
      'test_config', // bare slug, #8665
      'single',
      'foo--bar',
    ])('rejects "%s"', (value) => {
      expect(isValid(value)).toBe(false);
    });
  });
});

describe('GitLab Plugin - searchIssues', () => {
  it('fetches only the first page, never notes, and maps ids/titles (#9034)', async () => {
    const http = createHttp(() => [apiIssue(1), apiIssue(2)]);
    const res = await definition.searchIssues('bug', cfg, http);

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith(
      `${API}/issues?search=bug&scope=all&order_by=updated_at`,
      { params: { per_page: '100', page: '1' } },
    );
    expect(res.map((r) => r.id)).toEqual(['group/sub/proj#1', 'group/sub/proj#2']);
    expect(res[0].title).toBe('#1 Issue 1');
  });

  it('URL-encodes the search term so "#" and "&" do not break the query (#9907)', async () => {
    const http = createHttp(() => []);
    await definition.searchIssues('fix #42 & bug', cfg, http);
    expect(http.get.mock.calls[0][0]).toBe(
      `${API}/issues?search=fix%20%2342%20%26%20bug&scope=all&order_by=updated_at`,
    );
  });

  it('keeps a "#" in the custom filter from truncating the query (#10151)', async () => {
    const http = createHttp(() => []);
    await definition.searchIssues(
      'bug',
      { ...cfg, filter: 'labels=C#&state=opened' },
      http,
    );
    const url = new URL(http.get.mock.calls[0][0] as string);
    expect(url.searchParams.get('labels')).toBe('C#');
    expect(url.searchParams.get('state')).toBe('opened');
    expect(url.searchParams.get('search')).toBe('bug');
  });

  it('omits scope when unset and honours a custom base URL without trailing slash', async () => {
    const http = createHttp(() => []);
    await definition.searchIssues(
      '',
      { project: '42', gitlabBaseUrl: 'https://git.example.com' },
      http,
    );
    expect(http.get.mock.calls[0][0]).toBe(
      'https://git.example.com/api/v4/projects/42/issues?search=&order_by=updated_at',
    );
  });

  it('throws without a project', async () => {
    const http = createHttp(() => []);
    await expect(definition.searchIssues('x', {}, http)).rejects.toThrow();
    expect(http.get).not.toHaveBeenCalled();
  });
});

describe('GitLab Plugin - getNewIssuesForBacklog', () => {
  it('pages until a short page and requests opened issues with scope and filter', async () => {
    const full = Array.from({ length: 100 }, (_, i) => apiIssue(i + 1));
    const http = createHttp((_url, params) =>
      params?.page === '1' ? full : [apiIssue(101)],
    );
    const res = await definition.getNewIssuesForBacklog!(
      { ...cfg, scope: 'created-by-me', filter: 'labels=bug' },
      http,
    );

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      `${API}/issues?state=opened&order_by=updated_at&scope=created-by-me&labels=bug`,
      { params: { per_page: '100', page: '2' } },
    );
    expect(res).toHaveLength(101);
    expect(res[100].id).toBe('group/sub/proj#101');
  });

  it('stops after one request when the first page is short', async () => {
    const http = createHttp(() => [apiIssue(1)]);
    await definition.getNewIssuesForBacklog!({ ...cfg, scope: 'assigned-to-me' }, http);
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get.mock.calls[0][0]).toContain('&scope=assigned-to-me');
  });
});

describe('GitLab Plugin - getById', () => {
  it('uses the project and iid from the full-reference id and loads notes', async () => {
    const http = createHttp((url) =>
      url.endsWith('/notes')
        ? [note('2026-01-08T03:29:14.717Z')]
        : apiIssue(44, {
            weight: 3,
            due_date: '2026-02-03',
            assignee: { username: 'me', web_url: 'https://gitlab.com/me' },
          }),
    );
    const issue = await definition.getById('other/repo#44', cfg, http);

    expect(http.get.mock.calls[0][0]).toBe(
      'https://gitlab.com/api/v4/projects/other%2Frepo/issues/44',
    );
    expect(http.get.mock.calls[1][0]).toBe(
      'https://gitlab.com/api/v4/projects/other%2Frepo/issues/44/notes',
    );
    expect(issue).toMatchObject({
      id: 'group/sub/proj#44',
      title: '#44 Issue 44',
      body: 'desc',
      state: 'opened',
      assignee: 'me',
      lastUpdated: Date.UTC(2026, 0, 8, 3, 29, 14, 653),
      start: new Date(2026, 1, 3).getTime(),
      points: 3,
    });
    expect(issue.comments).toEqual([
      {
        author: 'other',
        body: 'a comment',
        created: Date.UTC(2026, 0, 8, 3, 29, 14, 717),
        avatarUrl: 'https://a/b.png',
      },
    ]);
  });

  it('keeps lastUpdated at updated_at even when a comment is later (no false update)', async () => {
    const http = createHttp((url) =>
      url.endsWith('/notes') ? [note('2026-01-08T03:29:14.717Z')] : apiIssue(42),
    );
    const issue = await definition.getById('group/sub/proj#42', cfg, http);
    expect(issue.lastUpdated).toBe(Date.UTC(2026, 0, 8, 3, 29, 14, 653));
  });

  it('marks closed issues with state "closed" and leaves no due date as undefined', async () => {
    const http = createHttp((url) =>
      url.endsWith('/notes') ? [] : apiIssue(1, { state: 'closed' }),
    );
    const issue = await definition.getById('group/sub/proj#1', cfg, http);
    expect(issue.state).toBe('closed');
    expect(issue.start).toBeUndefined();
    expect(issue.comments).toEqual([]);
  });

  it('rejects ids that are not "project#iid"', async () => {
    const http = createHttp(() => ({}));
    await expect(definition.getById('44', cfg, http)).rejects.toThrow(
      'Cannot parse GitLab project and issueId',
    );
  });
});

describe('GitLab Plugin - getIssueLink', () => {
  it('builds the link from a full-reference or legacy id', () => {
    expect(definition.getIssueLink('group/sub/proj#44', cfg)).toBe(
      'https://gitlab.com/group/sub/proj/-/issues/44',
    );
    expect(definition.getIssueLink('#44', cfg)).toBe(
      'https://gitlab.com/group/sub/proj/-/issues/44',
    );
    expect(definition.getIssueLink('44', cfg)).toBe(
      'https://gitlab.com/group/sub/proj/-/issues/44',
    );
  });

  it('uses the custom base URL, adding a missing trailing slash', () => {
    expect(
      definition.getIssueLink('g/p#1', {
        project: 'g/p',
        gitlabBaseUrl: 'https://git.x.io',
      }),
    ).toBe('https://git.x.io/g/p/-/issues/1');
    expect(
      definition.getIssueLink('g/p#1', {
        project: 'g/p',
        gitlabBaseUrl: 'https://git.x.io/',
      }),
    ).toBe('https://git.x.io/g/p/-/issues/1');
  });

  it("links to the issue's own project, not a numeric configured project ID", () => {
    expect(definition.getIssueLink('group/proj#44', { project: '12345' })).toBe(
      'https://gitlab.com/group/proj/-/issues/44',
    );
  });

  it('decodes a %2F-encoded configured project for legacy ids', () => {
    expect(definition.getIssueLink('#44', { project: 'group%2Fproj' })).toBe(
      'https://gitlab.com/group/proj/-/issues/44',
    );
  });

  it('is empty for a legacy id without a configured project', () => {
    expect(definition.getIssueLink('#1', {})).toBe('');
    expect(definition.getIssueLink('1', {})).toBe('');
  });
});

describe('GitLab Plugin - testConnection', () => {
  it('is true when the first page resolves to a list', async () => {
    expect(
      await definition.testConnection!(
        cfg,
        createHttp(() => []),
      ),
    ).toBe(true);
  });

  it('is false on request errors and non-list responses', async () => {
    const failing = createHttp(() => {
      throw new Error('401');
    });
    expect(await definition.testConnection!(cfg, failing)).toBe(false);
  });
});

describe('GitLab Plugin - timeTracking', () => {
  const tt = () => definition.timeTracking!;

  it('does not implement activities', () => {
    expect(tt().getActivities).toBeUndefined();
  });

  it('logs time via add_spent_time with a space-free duration, ignoring started', async () => {
    const http = createHttp(() => ({}));
    await tt().logTime(
      'other/repo#44',
      { started: 0, timeSpentMs: (83 * 60 + 40) * 1000, comment: 'Did things' },
      cfg,
      http,
    );
    expect(http.post).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/other%2Frepo/issues/44/add_spent_time',
      { duration: '1h23m', summary: 'Did things' },
    );
  });

  it('formats hour-only and minute-only durations and falls back to a default summary', async () => {
    const http = createHttp(() => ({}));
    await tt().logTime(
      'g/p#1',
      { started: 0, timeSpentMs: 2 * 3600000, comment: '' },
      cfg,
      http,
    );
    await tt().logTime(
      'g/p#1',
      { started: 0, timeSpentMs: 5 * 60000, comment: '' },
      cfg,
      http,
    );
    expect(http.post.mock.calls[0][1].duration).toBe('2h');
    expect(http.post.mock.calls[1][1].duration).toBe('5m');
    expect(http.post.mock.calls[0][1].summary).toMatch(
      /^Submitted via Super Productivity on /,
    );
  });

  it('sends nothing for less than a minute', async () => {
    const http = createHttp(() => ({}));
    await tt().logTime(
      'g/p#1',
      { started: 0, timeSpentMs: 59999, comment: '' },
      cfg,
      http,
    );
    expect(http.post).not.toHaveBeenCalled();
  });

  it('reads total_time_spent seconds from time_stats as ms', async () => {
    const http = createHttp(() => ({ total_time_spent: 5400 }));
    expect(await tt().getTimeLogged!('other/repo#44', cfg, http)).toBe(5400000);
    expect(http.get).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/other%2Frepo/issues/44/time_stats',
    );
  });

  it('treats null total_time_spent as 0', async () => {
    const http = createHttp(() => ({ total_time_spent: null }));
    expect(await tt().getTimeLogged!('g/p#1', cfg, http)).toBe(0);
  });
});

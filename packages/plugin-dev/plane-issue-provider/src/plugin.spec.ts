import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
  PluginIssue,
  PluginFieldMapping,
} from '@super-productivity/plugin-api';
import {
  apiRoot,
  assigneeNames,
  buildBrowseUrl,
  displayKey,
  getApiBase,
  getUiBase,
  isDoneStateGroup,
  LIST_FIELDS,
  mapListRow,
  mapSearchHit,
  mapWorkItem,
  targetDateToLocalMs,
  htmlToText,
  isOpenWorkItem,
  LIST_EXPAND,
  LIST_MAX_PAGES,
  normalizeHost,
  projectRoot,
  stateGroupOf,
  type PlaneWorkItem,
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

const BACKLOG_CFG = { apiKey: 'k', workspaceSlug: 'acme', projectId: 'proj-1' };

interface WorkItemRequest {
  url: string;
  params: Record<string, string>;
}

/**
 * Stand-in for the two endpoints the backlog listing touches, modelled on the real server
 * rather than on canned pages: it applies `order_by`, `fields`, `expand` and offset
 * paging to one flat item list, and rejects a cursor that is not in Plane's format.
 *
 * Every one of those is load-bearing. A double that hands back a friendlier shape than
 * the server lets production code that misreads the real one pass anyway — dropping
 * `state` from `fields` while still asking to expand it returns stateless rows, which
 * would quietly mark every work item open.
 */
const fakePlaneApi = (opts: {
  items: Array<Record<string, unknown>>;
  pageSize?: number;
}): { http: PluginHttp; workItemRequests: WorkItemRequest[] } => {
  const workItemRequests: WorkItemRequest[] = [];
  const pageSize = opts.pageSize ?? 100;

  const http = {
    get: vi.fn(async (url: string, o?: { params?: Record<string, string> }) => {
      if (!url.includes('/work-items/')) {
        return { id: 'proj-1', identifier: 'ENG' };
      }

      const params = o?.params || {};
      workItemRequests.push({ url, params });

      // Plane's cursor is `value:offset:is_prev`; anything else is a 400.
      let page = 0;
      if (params['cursor']) {
        const parts = params['cursor'].split(':');
        if (parts.length !== 3) {
          throw new Error("Cursor must be in the format 'value:offset:is_prev'");
        }
        page = Number(parts[1]);
      }

      // Ordering by a key with repeated values leaves the tied rows in an order the
      // database is free to choose per query. Rotating them by page reproduces the
      // symptom of Plane's OFFSET paging over a non-unique sort key.
      const ordered =
        params['order_by'] === 'sequence_id'
          ? [...opts.items].sort(
              (a, b) => Number(a['sequence_id']) - Number(b['sequence_id']),
            )
          : [...opts.items.slice(page), ...opts.items.slice(0, page)];

      const start = page * pageSize;
      // `fields` projects first and `expand` inflates only what survived it. A key
      // missing from `fields` is dropped outright — expanding it cannot bring it back.
      const projected = (params['fields'] || '').split(',').filter(Boolean);
      const expanded = (params['expand'] || '').split(',').filter(Boolean);
      const results = ordered.slice(start, start + pageSize).map((item) => {
        const row: Record<string, unknown> = projected.length
          ? Object.fromEntries(
              Object.entries(item).filter(([k]) => projected.includes(k)),
            )
          : { ...item };
        const state = row['state'] as { id?: string } | string | undefined;
        if (state && typeof state === 'object' && !expanded.includes('state')) {
          row['state'] = state.id ?? 'raw-uuid';
        }
        return row;
      });

      return {
        results,
        next_cursor: `${pageSize}:${page + 1}:0`,
        next_page_results: start + pageSize < ordered.length,
      };
    }),
  } as unknown as PluginHttp;
  return { http, workItemRequests };
};

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

  // Reverse-proxied instances legitimately live under a sub-path.
  it('keeps a sub-path on a self-hosted host', () => {
    expect(getApiBase({ host: 'https://example.com/plane/' })).toBe(
      'https://example.com/plane',
    );
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

describe('normalizeHost()', () => {
  it('treats an empty host as Plane Cloud', () => {
    expect(normalizeHost('')).toBe('');
    expect(normalizeHost(undefined)).toBe('');
    expect(normalizeHost('   ')).toBe('');
  });

  // Without a scheme every request URL becomes relative, which would send the
  // X-API-Key header to whatever origin the app itself is served from.
  it('rejects a bare hostname', () => {
    expect(() => normalizeHost('plane.example.com')).toThrowError(/full URL/);
  });

  it('rejects a non-http scheme', () => {
    expect(() => normalizeHost('ftp://plane.example.com')).toThrowError(/http or https/);
    expect(() => normalizeHost('javascript:alert(1)')).toThrowError(/http or https/);
  });

  // These would be attached to every request and copied into error logs.
  it('rejects embedded credentials', () => {
    expect(() => normalizeHost('https://user:pw@plane.example.com')).toThrowError(
      /credentials/,
    );
  });

  it('rejects a query string or fragment', () => {
    expect(() => normalizeHost('https://plane.example.com/?a=1')).toThrowError(/query/);
    expect(() => normalizeHost('https://plane.example.com/#x')).toThrowError(/query/);
  });

  it('accepts plain http for a local instance', () => {
    expect(normalizeHost('http://plane.lan:8080')).toBe('http://plane.lan:8080');
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
    const http = fakePlaneApi({
      items: [
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
          name: 'X',
          sequence_id: 3,
          state: { name: 'X', group: 'cancelled' },
        },
      ],
    });

    const results = await definition.getNewIssuesForBacklog!(BACKLOG_CFG, http.http);

    expect(results.map((r) => r.id)).toEqual(['open-1']);
  });

  // `/users/me/` only proves the API key parses. The workspace slug and the project
  // UUID are the fields users actually get wrong, and a green "test connection" that
  // then imports nothing is worse than a red one.
  it('testConnection probes the configured project', async () => {
    const http = {
      get: vi.fn(async () => ({ id: 'proj-1', identifier: 'ENG' })),
    } as unknown as PluginHttp;

    await expect(
      definition.testConnection!(
        { apiKey: 'k', workspaceSlug: 'acme', projectId: 'proj-1' },
        http,
      ),
    ).resolves.toBe(true);
    expect(http.get).toHaveBeenCalledWith(
      'https://api.plane.so/api/v1/workspaces/acme/projects/proj-1/',
    );
  });

  it('testConnection fails when the workspace or project does not exist', async () => {
    const http = {
      get: vi.fn(async () => {
        throw new Error('404');
      }),
    } as unknown as PluginHttp;

    await expect(
      definition.testConnection!(
        { apiKey: 'k', workspaceSlug: 'does-not-exist', projectId: 'nope' },
        http,
      ),
    ).resolves.toBe(false);
  });

  it('testConnection fails on a response without a project id', async () => {
    const http = { get: vi.fn(async () => ({})) } as unknown as PluginHttp;

    await expect(
      definition.testConnection!(
        { apiKey: 'k', workspaceSlug: 'acme', projectId: 'proj-1' },
        http,
      ),
    ).resolves.toBe(false);
  });
});

describe('Plane backlog listing', () => {
  const row = (i: number, group: string): Record<string, unknown> => ({
    id: `id-${i}`,
    name: `Item ${i}`,
    sequence_id: i + 1,
    state: { id: `state-${group}`, name: group === 'unstarted' ? 'Todo' : group, group },
  });

  // Regression for the shipped behaviour of PR #9282: it pulled two fixed pages and
  // filtered afterwards, so a project whose first 100 rows happened to be closed
  // returned an empty backlog with no indication anything had been dropped.
  it('imports every open item even when closed ones outnumber a page', async () => {
    const api = fakePlaneApi({
      // Insertion order puts a full page of closed items in front of every open one,
      // so a listing that reads a fixed couple of pages comes back empty.
      items: [
        ...Array.from({ length: 100 }, (_, i) => row(i, 'completed')),
        ...Array.from({ length: 50 }, (_, i) => row(100 + i, 'unstarted')),
      ],
    });

    const results = await definition.getNewIssuesForBacklog!(BACKLOG_CFG, api.http);

    expect(results.length).toBe(50);
    expect(results.every((r) => r.stateGroup === 'unstarted')).toBe(true);
  });

  it('orders by a unique key and projects the fields it needs', async () => {
    const api = fakePlaneApi({
      items: [row(0, 'backlog')],
    });

    await definition.getNewIssuesForBacklog!(BACKLOG_CFG, api.http);

    expect(api.workItemRequests[0]?.params).toEqual({
      per_page: '100',
      order_by: 'sequence_id',
      fields: LIST_FIELDS,
      expand: LIST_EXPAND,
    });
  });

  // Closed items are scattered through the ordering, not grouped at the end, so every
  // page has to be read before the listing is complete.
  it('reads every page and filters closed items across all of them', async () => {
    const api = fakePlaneApi({
      items: [row(0, 'started'), row(1, 'completed'), row(2, 'backlog')],
      pageSize: 2,
    });

    const results = await definition.getNewIssuesForBacklog!(BACKLOG_CFG, api.http);

    expect(results.map((r) => r.id)).toEqual(['id-0', 'id-2']);
    expect(api.workItemRequests.length).toBe(2);
  });

  // The whole reason for ordering by sequence_id: Plane pages by OFFSET and the list
  // endpoint sorts without a tiebreaker, so a key with repeated values lets a row appear
  // on two pages or on none. A unique key removes the possibility.
  it('returns each work item exactly once across page boundaries', async () => {
    const api = fakePlaneApi({
      items: Array.from({ length: 250 }, (_, i) => row(i, 'backlog')),
      pageSize: 100,
    });

    const results = await definition.getNewIssuesForBacklog!(BACKLOG_CFG, api.http);
    const ids = results.map((r) => r.id);

    expect(ids.length).toBe(250);
    expect(new Set(ids).size).toBe(250);
  });

  // The listing is bounded so a pathological project cannot hold a poll open forever.
  // Without a bound this fixture would page 60 times.
  it('stops at the page budget instead of paging without limit', async () => {
    const api = fakePlaneApi({
      items: Array.from({ length: 6000 }, (_, i) => row(i, 'backlog')),
      pageSize: 100,
    });

    const results = await definition.getNewIssuesForBacklog!(BACKLOG_CFG, api.http);

    expect(api.workItemRequests.length).toBe(LIST_MAX_PAGES);
    expect(results.length).toBe(LIST_MAX_PAGES * 100);
  });

  it('does not page past a truthy next_page_results with no cursor', async () => {
    const http = {
      get: vi.fn(async (url: string) =>
        url.includes('/work-items/')
          ? { results: [row(0, 'backlog')], next_page_results: true, next_cursor: '' }
          : { id: 'proj-1', identifier: 'ENG' },
      ),
    } as unknown as PluginHttp;

    const results = await definition.getNewIssuesForBacklog!(BACKLOG_CFG, http);

    expect(results.length).toBe(1);
    expect((http.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('shows the expanded state name', async () => {
    const api = fakePlaneApi({
      items: [row(0, 'unstarted')],
    });

    const [result] = await definition.getNewIssuesForBacklog!(BACKLOG_CFG, api.http);

    expect(result.status).toBe('Todo');
  });

  it('leaves the status empty rather than showing a uuid when state is not expanded', async () => {
    const api = fakePlaneApi({
      items: [{ id: 'id-0', name: 'Item 0', sequence_id: 1, state: 'a-raw-uuid' }],
    });

    const [result] = await definition.getNewIssuesForBacklog!(BACKLOG_CFG, api.http);

    expect(result.status).toBe('');
  });

  it('builds browse urls from the project identifier', async () => {
    const api = fakePlaneApi({
      items: [row(0, 'backlog')],
    });

    const [result] = await definition.getNewIssuesForBacklog!(BACKLOG_CFG, api.http);

    expect(result.url).toBe('https://app.plane.so/acme/browse/ENG-1');
    expect(result.title).toBe('ENG-1 Item 0');
  });
});

describe('isOpenWorkItem()', () => {
  const item = (group?: string): PlaneWorkItem =>
    ({
      id: 'a',
      name: 'a',
      sequence_id: 1,
      ...(group ? { state: { id: 's', name: group, group } } : {}),
    }) as PlaneWorkItem;

  it('counts backlog, unstarted and started as open', () => {
    expect(isOpenWorkItem(item('backlog'))).toBe(true);
    expect(isOpenWorkItem(item('unstarted'))).toBe(true);
    expect(isOpenWorkItem(item('started'))).toBe(true);
  });

  it('counts completed and cancelled as closed', () => {
    expect(isOpenWorkItem(item('completed'))).toBe(false);
    expect(isOpenWorkItem(item('cancelled'))).toBe(false);
  });

  // Plane allows a work item with no state at all (Issue.state is nullable). Hiding it
  // would lose real work; showing it costs one click if it turns out to be finished.
  it('counts an item with no state as open', () => {
    expect(isOpenWorkItem(item())).toBe(true);
  });

  // Rows fetched with a `fields` projection but no `expand` carry the group denormalized.
  it('reads the group from a denormalized state_group', () => {
    expect(
      isOpenWorkItem({
        id: 'a',
        name: 'a',
        sequence_id: 1,
        state_group: 'completed',
      } as PlaneWorkItem),
    ).toBe(false);
  });
});

describe('htmlToText()', () => {
  it('strips tags and keeps the prose', () => {
    expect(htmlToText('<p>Fix the <strong>login</strong> flow</p>')).toBe(
      'Fix the login flow',
    );
  });

  it('turns block boundaries into line breaks', () => {
    expect(htmlToText('<p>one</p><p>two</p>')).toBe('one\ntwo');
    expect(htmlToText('a<br>b')).toBe('a\nb');
  });

  it('decodes named, decimal and hex entities', () => {
    expect(htmlToText('<p>a &amp; b &lt;c&gt; &#39;d&#39; &#x2713;</p>')).toBe(
      "a & b <c> 'd' ✓",
    );
  });

  it('leaves an unknown entity alone rather than mangling it', () => {
    expect(htmlToText('<p>&notarealentity;</p>')).toBe('&notarealentity;');
  });

  it('drops script and style content entirely', () => {
    expect(htmlToText('<p>hi</p><script>alert(1)</script><style>p{}</style>')).toBe('hi');
  });

  it('returns an empty string for empty or tag-only html', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText('<p></p><p></p>')).toBe('');
  });
});

describe('getById()', () => {
  const ISSUE_CFG = { apiKey: 'k', workspaceSlug: 'acme', projectId: 'proj-1' };

  const fakeIssue = (
    overrides: Record<string, unknown>,
  ): { http: PluginHttp; calls: Array<[string, unknown]> } => {
    const calls: Array<[string, unknown]> = [];
    const http = {
      get: vi.fn(async (url: string, o?: unknown) => {
        calls.push([url, o]);
        return {
          id: 'uuid-9',
          name: 'Ship it',
          sequence_id: 7,
          project: { identifier: 'ENG' },
          state: { id: 's1', name: 'In Progress', group: 'started' },
          ...overrides,
        };
      }),
    } as unknown as PluginHttp;
    return { http, calls };
  };

  it('requests the work item with the relations it actually reads', async () => {
    const { http, calls } = fakeIssue({});

    await definition.getById('uuid-9', ISSUE_CFG, http);

    expect(calls[0][0]).toBe(
      'https://api.plane.so/api/v1/workspaces/acme/projects/proj-1/work-items/uuid-9/',
    );
    expect(calls[0][1]).toEqual({ params: { expand: 'state,assignees,project' } });
  });

  it('maps the expanded state, project and assignee', async () => {
    const { http } = fakeIssue({
      assignees: [{ display_name: 'Ada' }],
      target_date: '2026-08-01',
    });

    const issue = await definition.getById('uuid-9', ISSUE_CFG, http);

    expect(issue.summary).toBe('ENG-7 Ship it');
    expect(issue.state).toBe('In Progress');
    expect(issue.stateGroup).toBe('started');
    expect(issue.assignee).toBe('Ada');
    expect(issue.url).toBe('https://app.plane.so/acme/browse/ENG-7');
    expect(issue.due).toBe('2026-08-01');
  });

  // Self-hosted Plane excludes description_stripped from the serializer, so without the
  // html fallback the description is blank on every open-source instance.
  it('falls back to the html description when the stripped one is absent', async () => {
    const { http } = fakeIssue({
      description_html: '<p>Needs a <em>rewrite</em></p>',
    });

    const issue = await definition.getById('uuid-9', ISSUE_CFG, http);

    expect(issue.body).toBe('Needs a rewrite');
  });

  it('prefers the stripped description when Plane sends one', async () => {
    const { http } = fakeIssue({
      description_stripped: 'already plain',
      description_html: '<p>ignored</p>',
    });

    const issue = await definition.getById('uuid-9', ISSUE_CFG, http);

    expect(issue.body).toBe('already plain');
  });

  it('percent-encodes the issue id into the path', async () => {
    const { calls, http } = fakeIssue({});

    await definition.getById('a/../b', ISSUE_CFG, http);

    expect(calls[0][0]).toContain('/work-items/a%2F..%2Fb/');
  });
});

describe('targetDateToLocalMs()', () => {
  const originalTz = process.env.TZ;
  const asDay = (ms: number): string => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  };

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  // The whole point. `new Date('2026-08-03')` is midnight UTC, which is still 2 August
  // anywhere west of Greenwich — the task would be due a day early for every user in
  // the Americas. Guayaquil is the regression that motivated this; Berlin and Tokyo
  // prove the fix did not simply move the error to the other side.
  it.each([
    'America/Guayaquil',
    'Europe/Berlin',
    'Asia/Tokyo',
    'Pacific/Kiritimati',
    'UTC',
  ])('resolves to the same calendar day in %s', (tz) => {
    process.env.TZ = tz;
    const ms = targetDateToLocalMs('2026-08-03');
    expect(ms).not.toBeNull();
    expect(asDay(ms as number)).toBe('2026-08-03');
    expect(new Date(ms as number).getHours()).toBe(0);
  });

  it('returns null for a missing date', () => {
    expect(targetDateToLocalMs(null)).toBeNull();
    expect(targetDateToLocalMs(undefined)).toBeNull();
    expect(targetDateToLocalMs('')).toBeNull();
  });

  // The host accepts `start` on a bare `typeof === 'number'` check, and NaN passes it.
  // Anything that cannot be trusted to be a real date must come back as null, or the
  // task is persisted with a due day of "NaN-NaN-NaN".
  it.each([
    'not-a-date',
    '2026-8-3',
    '03-08-2026',
    '2026-08-03T10:00:00Z',
    '2026-08-03 ',
    '20260803',
    '9999-99-99',
  ])('rejects malformed input %p', (value) => {
    expect(targetDateToLocalMs(value)).toBeNull();
  });

  // JS rolls these forward rather than failing, which would schedule the task on a day
  // that appears nowhere in Plane.
  it.each(['2026-02-30', '2026-13-01', '2026-04-31'])(
    'rejects the impossible date %s instead of rolling it over',
    (value) => {
      expect(targetDateToLocalMs(value)).toBeNull();
    },
  );

  // A round-trip check alone is not enough: this value is what `new Date(NaN)` formats
  // to, so it round-trips to itself and would come back as NaN — which passes the host's
  // `typeof === 'number'` guard and lands in the task store as a due day of "NaN-NaN-NaN".
  it('rejects a value that impersonates the invalid-date formatting', () => {
    expect(targetDateToLocalMs('NaN-NaN-NaN')).toBeNull();
    expect(targetDateToLocalMs('Invalid Date')).toBeNull();
  });

  it('never returns NaN', () => {
    for (const v of ['x', '2026-02-30', '', '0000-00-00', 'NaN-NaN-NaN', '2026-08-03']) {
      const ms = targetDateToLocalMs(v);
      expect(ms === null || Number.isFinite(ms)).toBe(true);
    }
  });

  it('accepts a leap day in a leap year and rejects it otherwise', () => {
    expect(targetDateToLocalMs('2028-02-29')).not.toBeNull();
    expect(targetDateToLocalMs('2026-02-29')).toBeNull();
  });
});

describe('due date on mapped items', () => {
  const row = {
    id: 'id-1',
    name: 'Item',
    sequence_id: 9,
    state: { id: 's', name: 'Todo', group: 'unstarted' },
  };

  it('seeds start from target_date so the host derives a due day', () => {
    const mapped = mapListRow(
      { ...row, target_date: '2026-08-03' },
      { workspaceSlug: 'a' },
      'ENG',
    );
    expect(typeof mapped['start']).toBe('number');
    expect(new Date(mapped['start'] as number).getDate()).toBe(3);
    expect(mapped['due']).toBe('2026-08-03');
  });

  it('omits start entirely when the work item has no target date', () => {
    const mapped = mapListRow(
      { ...row, target_date: null },
      { workspaceSlug: 'a' },
      'ENG',
    );
    expect('start' in mapped).toBe(false);
  });

  it('omits start rather than passing NaN for a malformed target date', () => {
    const mapped = mapListRow(
      { ...row, target_date: 'whenever' } as unknown as PlaneWorkItem,
      { workspaceSlug: 'a' },
      'ENG',
    );
    expect('start' in mapped).toBe(false);
  });

  it('seeds start on the detail mapping too', () => {
    const issue = mapWorkItem(
      { ...row, target_date: '2026-08-03', project: { identifier: 'ENG' } },
      { workspaceSlug: 'a' },
    );
    expect(typeof issue['start']).toBe('number');
  });
});

describe('API url construction', () => {
  const CFG = { workspaceSlug: 'acme', projectId: 'proj-1' };

  it('builds the workspace and project roots', () => {
    expect(apiRoot(CFG)).toBe('https://api.plane.so/api/v1/workspaces/acme');
    expect(projectRoot(CFG)).toBe(
      'https://api.plane.so/api/v1/workspaces/acme/projects/proj-1',
    );
  });

  // Both segments are typed by the user — pasting a URL instead of a bare UUID must not
  // be able to reshape the path or reach a different endpoint.
  it('percent-encodes both user-entered path segments', () => {
    const url = projectRoot({ workspaceSlug: 'a/../b', projectId: '../../users/me' });
    expect(url).toBe(
      'https://api.plane.so/api/v1/workspaces/a%2F..%2Fb/projects/..%2F..%2Fusers%2Fme',
    );
    expect(url).not.toContain('/users/me');
  });

  it('refuses to build a url with the workspace or project missing', () => {
    expect(() => apiRoot({ projectId: 'p' })).toThrowError(/workspace slug/i);
    expect(() => apiRoot({ workspaceSlug: 'a' })).toThrowError(/project ID/i);
    expect(() => apiRoot({ workspaceSlug: '   ', projectId: 'p' })).toThrowError();
  });

  it('routes through a self-hosted host when one is configured', () => {
    expect(projectRoot({ ...CFG, host: 'https://plane.example.com' })).toBe(
      'https://plane.example.com/api/v1/workspaces/acme/projects/proj-1',
    );
  });
});

describe('stateGroupOf()', () => {
  // Plane Cloud annotates every row with `state_group`; the open-source server does not
  // (checked through v1.4.2). The expanded `state` is the portable source, so both
  // shapes have to resolve identically or self-hosted users silently get no done-sync.
  it('reads the Cloud-only denormalized field', () => {
    expect(stateGroupOf({ state_group: 'completed' } as PlaneWorkItem)).toBe('completed');
  });

  it('falls back to the expanded state, which self-hosted always sends', () => {
    expect(
      stateGroupOf({
        state: { id: 's', name: 'Done', group: 'completed' },
      } as PlaneWorkItem),
    ).toBe('completed');
  });

  it('returns an empty string when the state is a bare uuid or absent', () => {
    expect(stateGroupOf({ state: 'a-uuid' } as PlaneWorkItem)).toBe('');
    expect(stateGroupOf({} as PlaneWorkItem)).toBe('');
  });
});

describe('assigneeNames()', () => {
  it('prefers display name, then first name, then email', () => {
    expect(
      assigneeNames({
        assignees: [
          { display_name: 'ada', first_name: 'Ada', email: 'a@x' },
          { first_name: 'Grace', email: 'g@x' },
          { email: 'k@x' },
        ],
      } as PlaneWorkItem),
    ).toEqual(['ada', 'Grace', 'k@x']);
  });

  // Without `expand=assignees` the field is a list of bare uuids; showing those as names
  // would be worse than showing nothing.
  it('drops unexpanded uuid entries', () => {
    expect(
      assigneeNames({ assignees: ['uuid-1', 'uuid-2'] } as unknown as PlaneWorkItem),
    ).toEqual([]);
  });

  it('handles a missing or empty assignee list', () => {
    expect(assigneeNames({} as PlaneWorkItem)).toEqual([]);
    expect(assigneeNames({ assignees: [] } as unknown as PlaneWorkItem)).toEqual([]);
  });
});

describe('provider contract', () => {
  const fullIssue = (): PluginIssue =>
    mapWorkItem(
      {
        id: 'uuid',
        name: 'Ship it',
        sequence_id: 7,
        description_stripped: 'body text',
        priority: 'high',
        target_date: '2026-08-03',
        updated_at: '2026-07-01T00:00:00Z',
        project: { identifier: 'ENG' },
        state: { id: 's', name: 'In Progress', group: 'started' },
        assignees: [{ display_name: 'Ada' }],
      },
      { workspaceSlug: 'acme' },
    );

  // A display field naming a property the mapper never sets renders as an empty row and
  // fails silently — a typo here is invisible in review and in the running app.
  it('every issueDisplay field exists on a mapped issue', () => {
    const issue = fullIssue();
    for (const field of definition.issueDisplay) {
      expect(Object.prototype.hasOwnProperty.call(issue, field.field)).toBe(true);
    }
  });

  it('every issueDisplay link field points at a real url property', () => {
    const issue = fullIssue();
    for (const field of definition.issueDisplay) {
      if (field.type === 'link' && field.linkField) {
        expect(typeof issue[field.linkField]).toBe('string');
      }
    }
  });

  it('marks the three fields the integration cannot work without as required', () => {
    const required = definition.configFields
      .filter((f) => (f as { required?: boolean }).required)
      .map((f) => f.key);
    expect(required).toEqual(
      expect.arrayContaining(['apiKey', 'workspaceSlug', 'projectId']),
    );
  });

  it('keeps the api key in a masked field', () => {
    const apiKey = definition.configFields.find((f) => f.key === 'apiKey');
    expect(apiKey?.type).toBe('password');
  });

  it('sends the api key as the header Plane expects, and nothing else', () => {
    expect(definition.getHeaders({ apiKey: 'plane_api_secret' })).toEqual({
      'X-API-Key': 'plane_api_secret',
      Accept: 'application/json',
    });
  });

  it('does not blow up building headers before the key is entered', () => {
    expect(definition.getHeaders({})).toEqual({
      'X-API-Key': '',
      Accept: 'application/json',
    });
  });
});

describe('done-state field mapping', () => {
  const mapping = (): PluginFieldMapping =>
    (definition.fieldMappings as PluginFieldMapping[]).find(
      (m) => m.taskField === 'isDone',
    ) as PluginFieldMapping;

  // Super Productivity never writes to Plane, so the mapping must not default to a
  // direction that would try.
  it('is pull-only', () => {
    expect(mapping().defaultDirection).toBe('pullOnly');
  });

  it('marks a task done for both finished state groups and no others', () => {
    const toTask = mapping().toTaskValue as (v: unknown) => boolean;
    expect(toTask('completed')).toBe(true);
    expect(toTask('cancelled')).toBe(true);
    for (const open of ['backlog', 'unstarted', 'started', '', undefined, null]) {
      expect(toTask(open)).toBe(false);
    }
  });

  it('extracts the values the sync layer diffs on', () => {
    const issue = mapWorkItem(
      {
        id: 'u',
        name: 'n',
        sequence_id: 1,
        state: { id: 's', name: 'Done', group: 'completed' },
        description_stripped: 'b',
      },
      { workspaceSlug: 'a' },
    );
    expect(definition.extractSyncValues?.(issue)).toEqual({
      stateGroup: 'completed',
      title: 'n',
      body: 'b',
    });
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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

const API = 'https://cloud.example.com/index.php/apps/deck/api/v1.0';

const card = (id: number, extra: Record<string, unknown> = {}): unknown => ({
  id,
  title: `Card ${id}`,
  description: `Desc ${id}`,
  duedate: null,
  lastModified: 1700000000 + id,
  archived: false,
  done: null,
  labels: [],
  assignedUsers: [{ participant: { uid: 'me', displayname: 'Me' } }],
  ...extra,
});

const STACKS = [
  { id: 1, title: 'Todo', cards: [card(11), card(12, { archived: true })] },
  {
    id: 2,
    title: 'Doing',
    cards: [card(21, { assignedUsers: [] }), card(22, { done: '2024-01-01' })],
  },
  { id: 3, title: 'Done', cards: [card(31)] },
];

const baseCfg = {
  nextcloudBaseUrl: 'https://cloud.example.com/',
  username: 'me',
  password: 'pw',
  selectedBoardId: '7',
};

const createHttp = (): PluginHttp & {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
} =>
  ({
    get: vi.fn(async (url: string) => {
      if (url === `${API}/boards/7/stacks`) {
        return STACKS;
      }
      if (url === `${API}/boards/7`) {
        return { id: 7, title: 'Board', archived: false };
      }
      throw new Error('unexpected url ' + url);
    }),
    put: vi.fn(async () => ({})),
  }) as unknown as PluginHttp & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };

// The plugin caches board reads for a few seconds; jump past that per test
let now = new Date('2024-01-01T00:00:00Z').getTime();
beforeEach(() => {
  now += 60000;
  vi.useFakeTimers({ toFake: ['Date'], now });
});
afterEach(() => vi.useRealTimers());

const ids = (items: { id: string }[]): string[] => items.map((i) => i.id);

describe('Nextcloud Deck Plugin - open cards', () => {
  it('skips archived and done cards and the done stack', async () => {
    const res = await definition.getNewIssuesForBacklog!(
      { ...baseCfg, doneStackId: '3' },
      createHttp(),
    );
    expect(ids(res)).toEqual(['11', '21']);
  });

  it('only imports the selected stacks (legacy numeric ids too)', async () => {
    const res = await definition.getNewIssuesForBacklog!(
      { ...baseCfg, importStackIds: [2] },
      createHttp(),
    );
    expect(ids(res)).toEqual(['21']);
  });

  it('filters by assignee when enabled', async () => {
    const res = await definition.getNewIssuesForBacklog!(
      { ...baseCfg, filterByAssignee: true },
      createHttp(),
    );
    expect(ids(res)).toEqual(['11', '31']);
  });

  it('throws when no board is selected', async () => {
    await expect(
      definition.searchIssues('', { ...baseCfg, selectedBoardId: '' }, createHttp()),
    ).rejects.toThrow('ERRORS.NO_BOARD');
  });
});

describe('Nextcloud Deck Plugin - search and titles', () => {
  it('matches the card title, not the templated title', async () => {
    const res = await definition.searchIssues(
      'card 11',
      { ...baseCfg, titleTemplate: '[{BOARD}: {COLUMN}] {CARD_TITLE} #{ID}' },
      createHttp(),
    );
    expect(res.map((r) => r.title)).toEqual(['[Board: Todo] Card 11 #11']);
  });

  it('does not fetch the board without a {BOARD} placeholder', async () => {
    const http = createHttp();
    await definition.searchIssues('', baseCfg, http);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('maps getById with state, body, stack and the card link', async () => {
    const issue = await definition.getById('22', baseCfg, createHttp());
    expect(issue).toEqual(
      expect.objectContaining({
        id: '22',
        state: 'done',
        body: 'Desc 22',
        stackTitle: 'Doing',
        lastUpdated: 1700000022,
        url: 'https://cloud.example.com/apps/deck/board/7/card/22',
      }),
    );
  });
});

describe('Nextcloud Deck Plugin - updateIssue', () => {
  it('moves a completed card to the done stack before marking it done', async () => {
    const http = createHttp();
    await definition.updateIssue!(
      '11',
      { state: 'done' },
      { ...baseCfg, doneStackId: '3' },
      http,
    );
    expect(http.put).toHaveBeenNthCalledWith(
      1,
      `${API}/boards/7/stacks/1/cards/11/reorder`,
      { stackId: 3, order: 0 },
    );
    const [url, body] = http.put.mock.calls[1];
    expect(url).toBe(`${API}/boards/7/stacks/3/cards/11`);
    expect(body).toEqual(
      expect.objectContaining({ title: 'Card 11', description: 'Desc 11', owner: 'me' }),
    );
    expect(typeof body.done).toBe('string');
  });

  it('clears done without moving the card when reopened', async () => {
    const http = createHttp();
    await definition.updateIssue!(
      '22',
      { state: 'open' },
      { ...baseCfg, doneStackId: '3' },
      http,
    );
    expect(http.put).toHaveBeenCalledTimes(1);
    expect(http.put.mock.calls[0][0]).toBe(`${API}/boards/7/stacks/2/cards/22`);
    expect(http.put.mock.calls[0][1].done).toBeNull();
  });

  it('pushes the description and keeps the done state untouched', async () => {
    const http = createHttp();
    await definition.updateIssue!('22', { body: 'New' }, baseCfg, http);
    expect(http.put.mock.calls[0][1]).toEqual(
      expect.objectContaining({ description: 'New', done: '2024-01-01' }),
    );
  });
});

describe('Nextcloud Deck Plugin - board read cache', () => {
  it('shares one board download between consecutive getById calls', async () => {
    const http = createHttp();
    await definition.getById('11', baseCfg, http);
    await definition.getById('21', baseCfg, http);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache expired', async () => {
    const http = createHttp();
    await definition.getById('11', baseCfg, http);
    vi.setSystemTime(now + 6000);
    await definition.getById('11', baseCfg, http);
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('updateIssue reads fresh data instead of the cache', async () => {
    const http = createHttp();
    await definition.getById('11', baseCfg, http);
    await definition.updateIssue!('11', { state: 'done' }, baseCfg, http);
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('does not cache failed requests', async () => {
    const http = createHttp();
    http.get.mockRejectedValueOnce(new Error('offline'));
    await expect(definition.getById('11', baseCfg, http)).rejects.toThrow('offline');
    await expect(definition.getById('11', baseCfg, http)).resolves.toBeDefined();
  });
});

describe('Nextcloud Deck Plugin - updateIssue null description', () => {
  it('sends an empty string for a card without description', async () => {
    const http = createHttp();
    http.get.mockResolvedValueOnce([
      { id: 1, title: 'S', cards: [card(5, { description: null })] },
    ]);
    await definition.updateIssue!('5', { state: 'done' }, baseCfg, http);
    expect(http.put.mock.calls[0][1].description).toBe('');
  });
});

import { beforeAll, describe, expect, it, vi } from 'vitest';
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

const trelloCard = {
  id: 'card-id',
  idShort: 42,
  shortLink: 'abc123',
  name: 'Test card',
  desc: 'Card description',
  url: 'https://trello.com/c/abc123',
  due: null,
  closed: false,
  idBoard: 'board-id',
  idList: 'list-id',
  dateLastActivity: '2026-08-01T12:00:00.000Z',
};

describe('Trello issue provider write operations', () => {
  it('updates card status, title, and description', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const http = { put } as unknown as PluginHttp;

    await definition.updateIssue!(
      'abc123',
      {
        state: 'closed',
        title: 'Renamed card',
        body: 'Updated description',
      },
      {},
      http,
    );

    expect(put).toHaveBeenCalledWith('https://api.trello.com/1/cards/abc123', {
      closed: true,
      name: 'Renamed card',
      desc: 'Updated description',
    });
  });

  it('reopens a card when the issue state is open', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const http = { put } as unknown as PluginHttp;

    await definition.updateIssue!('abc123', { state: 'open' }, {}, http);

    expect(put).toHaveBeenCalledWith('https://api.trello.com/1/cards/abc123', {
      closed: false,
    });
  });

  it('creates a card in the configured default list', async () => {
    const post = vi.fn().mockResolvedValue(trelloCard);
    const http = { post } as unknown as PluginHttp;

    const result = await definition.createIssue!(
      'Test card',
      { defaultListId: 'list-id' },
      http,
    );

    expect(post).toHaveBeenCalledWith('https://api.trello.com/1/cards', {
      name: 'Test card',
      idList: 'list-id',
    });
    expect(result).toMatchObject({
      issueId: 'abc123',
      issueData: {
        id: 'abc123',
        title: 'Test card',
        body: 'Card description',
        state: 'open',
      },
    });
  });

  it('requires a default list when creating a card', async () => {
    const post = vi.fn();
    const http = { post } as unknown as PluginHttp;

    await expect(definition.createIssue!('Test card', {}, http)).rejects.toThrow(
      'ERRORS.DEFAULT_LIST_ID_REQUIRED',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('archives a card instead of deleting it permanently', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const http = { put } as unknown as PluginHttp;

    await definition.deleteIssue!('abc123', {}, http);

    expect(put).toHaveBeenCalledWith('https://api.trello.com/1/cards/abc123', {
      closed: true,
    });
  });

  it('exposes configurable mappings for status, title, and notes', () => {
    expect(definition.fieldMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskField: 'isDone',
          issueField: 'state',
          defaultDirection: 'pullOnly',
        }),
        expect.objectContaining({
          taskField: 'title',
          issueField: 'title',
          defaultDirection: 'pullOnly',
        }),
        expect.objectContaining({
          taskField: 'notes',
          issueField: 'body',
          defaultDirection: 'off',
        }),
      ]),
    );
  });
});

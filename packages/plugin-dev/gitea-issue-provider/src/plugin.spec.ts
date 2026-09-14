import { beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;

beforeAll(async () => {
  Object.defineProperty(globalThis, 'PluginAPI', {
    configurable: true,
    value: {
      registerIssueProvider: vi.fn((registered: IssueProviderPluginDefinition) => {
        definition = registered;
      }),
      translate: (key: string) => key,
    },
  });
  // The import executes the plugin registration boundary under the test API.
  await import('./plugin');
});

const createHttp = (get: Mock): PluginHttp =>
  ({
    get,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  }) as unknown as PluginHttp;

const config = {
  host: 'https://git.example.com',
  token: 'token',
  repoFullname: 'Fran/forge',
  scope: 'all',
};

describe('Gitea issue provider', () => {
  it('tests issue access instead of requiring repository metadata access', async () => {
    const get = vi.fn().mockResolvedValue([]);

    await expect(definition.testConnection!(config, createHttp(get))).resolves.toBe(true);

    expect(get).toHaveBeenCalledWith(
      'https://git.example.com/api/v1/repos/Fran/forge/issues?limit=1&state=open',
    );
  });

  it.each(['created-by-me', 'assigned-to-me'])(
    'rejects connection tests for scoped imports (%s)',
    async (scope) => {
      const get = vi.fn();

      await expect(
        definition.testConnection!({ ...config, scope }, createHttp(get)),
      ).rejects.toThrow('ERRORS.SCOPED_CONNECTION_TEST');

      expect(get).not.toHaveBeenCalled();
    },
  );

  it('warns that changing to a scoped import needs additional access', () => {
    const scopeField = definition.configFields.find((field) => field.key === 'scope');

    expect(scopeField?.description).toBe('CFG.SCOPE_DESCRIPTION');
  });

  it('rethrows connection errors so the app can display the reason', async () => {
    const error = Object.assign(
      new Error('[PluginHttp] Request failed with status 403'),
      {
        status: 403,
        error: { message: 'token does not have the required scope' },
      },
    );

    await expect(
      definition.testConnection!(config, createHttp(vi.fn().mockRejectedValue(error))),
    ).rejects.toBe(error);
  });

  it('uses repository metadata to scope the global issue search', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ id: 42, full_name: 'Fran/forge' })
      .mockResolvedValueOnce([
        {
          number: 7,
          title: 'Find Forgejo access',
          html_url: 'https://git.example.com/Fran/forge/issues/7',
          state: 'open',
          labels: [],
          repository: { full_name: 'Fran/forge' },
        },
      ]);

    const results = await definition.searchIssues('Forgejo', config, createHttp(get));

    expect(results).toEqual([
      {
        id: '7',
        title: '#7 Find Forgejo access',
        url: 'https://git.example.com/Fran/forge/issues/7',
        status: 'open',
        labels: [],
      },
    ]);
    expect(get).toHaveBeenNthCalledWith(
      2,
      'https://git.example.com/api/v1/repos/issues/search',
      {
        params: {
          limit: '100',
          state: 'open',
          q: 'Forgejo',
          priority_repo_id: '42',
        },
      },
    );
  });
});

import { loadGraphData } from './load-graph-data';

const fakeApi = (pages: Record<string, unknown>) => {
  const urls: string[] = [];
  const headers: unknown[] = [];
  const api = {
    request: jest.fn(async (url: string, opts?: { headers?: unknown }) => {
      urls.push(url);
      headers.push(opts?.headers);
      if (!(url in pages)) {
        throw new Error(`unexpected ${url}`);
      }
      return pages[url];
    }),
  } as unknown as Parameters<typeof loadGraphData>[0];
  return { api, urls, headers };
};

const LISTS = 'https://graph.microsoft.com/v1.0/me/todo/lists';
// the form Microsoft documents: literal $ options, %20 for spaces
const TASKS_QUERY = "$filter=status%20ne%20'completed'&$expand=checklistItems";

describe('loadGraphData', () => {
  it('reads every list page and every task page with the bearer token', async () => {
    const { api, urls, headers } = fakeApi({
      [LISTS]: { value: [{ id: 'A' }], '@odata.nextLink': `${LISTS}?$skip=1` },
      [`${LISTS}?$skip=1`]: { value: [{ id: 'B/2' }] },
      [`${LISTS}/A/tasks?${TASKS_QUERY}`]: {
        value: [{ id: 't1' }],
        '@odata.nextLink': `${LISTS}/A/tasks?$skip=1`,
      },
      [`${LISTS}/A/tasks?$skip=1`]: { value: [{ id: 't2' }] },
      [`${LISTS}/B%2F2/tasks?${TASKS_QUERY}`]: { value: [] },
    });

    const data = await loadGraphData(api, 'tok');

    expect(data).toEqual({
      lists: [{ id: 'A' }, { id: 'B/2' }],
      tasksByListId: { A: [{ id: 't1' }, { id: 't2' }], 'B/2': [] },
    });
    expect(urls).toHaveLength(5);
    expect(
      headers.every((h) => JSON.stringify(h) === '{"Authorization":"Bearer tok"}'),
    ).toBe(true);
  });

  it('refuses to send the token to a next page outside Graph', async () => {
    const { api, urls } = fakeApi({
      [LISTS]: {
        value: [],
        '@odata.nextLink': 'https://graph.microsoft.com.evil.example/x',
      },
    });
    await expect(loadGraphData(api, 'tok')).rejects.toThrow(
      'outside graph.microsoft.com',
    );
    expect(urls).toEqual([LISTS]);
  });

  describe('transient failures', () => {
    // the host error as it arrives through the iframe bridge: message only
    const bridgeError = (status: number): Error =>
      new Error(`[PluginHttp] Request failed with status ${status}`);

    /** Fails the lists request with `failures`, then serves an empty account. */
    const flakyApi = (failures: unknown[]) => {
      const remaining = [...failures];
      const request = jest.fn(async (url: string) => {
        if (remaining.length) {
          throw remaining.shift();
        }
        if (url !== LISTS) {
          throw new Error(`unexpected ${url}`);
        }
        return { value: [] };
      });
      return {
        api: { request } as unknown as Parameters<typeof loadGraphData>[0],
        request,
      };
    };

    it('retries 429 and 503 with a growing backoff, then succeeds', async () => {
      const { api, request } = flakyApi([bridgeError(429), bridgeError(503)]);
      const sleep = jest.fn(async () => {});

      await expect(loadGraphData(api, 'tok', { sleep })).resolves.toEqual({
        lists: [],
        tasksByListId: {},
      });
      expect(request).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls).toEqual([[2000], [4000]]);
    });

    it('reads the status from an in-process error object too', async () => {
      const inProcess = Object.assign(new Error('Gateway Timeout'), { status: 504 });
      const { api, request } = flakyApi([inProcess]);

      await loadGraphData(api, 'tok', { sleep: async () => {} });
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('gives up after 3 retries and surfaces the last error', async () => {
      const { api, request } = flakyApi([
        bridgeError(429),
        bridgeError(429),
        bridgeError(429),
        bridgeError(429),
      ]);
      const sleep = jest.fn(async () => {});

      await expect(loadGraphData(api, 'tok', { sleep })).rejects.toThrow('status 429');
      expect(request).toHaveBeenCalledTimes(4);
      expect(sleep.mock.calls).toEqual([[2000], [4000], [8000]]);
    });

    it.each([401, 403, 404, 500])('does not retry status %i', async (status) => {
      const { api, request } = flakyApi([bridgeError(status)]);
      const sleep = jest.fn(async () => {});

      await expect(loadGraphData(api, 'tok', { sleep })).rejects.toThrow(
        `status ${status}`,
      );
      expect(request).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('does not retry an error without a status', async () => {
      const { api, request } = flakyApi([new Error('[PluginHttp] request failed: x')]);

      await expect(loadGraphData(api, 'tok', { sleep: async () => {} })).rejects.toThrow(
        'request failed',
      );
      expect(request).toHaveBeenCalledTimes(1);
    });
  });
});

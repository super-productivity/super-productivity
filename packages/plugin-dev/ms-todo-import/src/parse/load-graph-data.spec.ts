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
});

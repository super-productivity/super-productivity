import { PluginAPI } from '@super-productivity/plugin-api';
import { RawGraphData, RawList, RawTask } from './from-graph';

export const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const LISTS_URL = `${GRAPH_ORIGIN}/v1.0/me/todo/lists`;
// written out rather than URLSearchParams: Graph documents literal `$` options
// and `%20` spaces, and `+` is not reliably read as a space in `$filter`
const TASKS_QUERY = "$filter=status%20ne%20'completed'&$expand=checklistItems";

type GraphRequestApi = Pick<PluginAPI, 'request'>;

interface GraphPage<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

/** Follows `@odata.nextLink` paging; the bearer token never leaves Graph's origin. */
const getAllPages = async <T>(
  api: GraphRequestApi,
  token: string,
  firstUrl: string,
): Promise<T[]> => {
  const items: T[] = [];
  let url: string | undefined = firstUrl;
  while (url) {
    if (!url.startsWith(`${GRAPH_ORIGIN}/`)) {
      throw new Error(
        'Microsoft Graph returned a next page outside graph.microsoft.com.',
      );
    }
    const page: GraphPage<T> = await api.request<GraphPage<T>>(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    items.push(...(page.value ?? []));
    url = page['@odata.nextLink'];
  }
  return items;
};

/**
 * Reads all lists and their open tasks (with steps) in sequence — one list at
 * a time keeps well under Graph's per-mailbox throttling limits.
 *
 * @see https://learn.microsoft.com/graph/api/todo-list-lists
 * @see https://learn.microsoft.com/graph/api/todotasklist-list-tasks
 */
export const loadGraphData = async (
  api: GraphRequestApi,
  token: string,
): Promise<RawGraphData> => {
  const lists = await getAllPages<RawList>(api, token, LISTS_URL);
  const tasksByListId: Record<string, RawTask[]> = {};
  for (const list of lists) {
    if (!list.id) {
      continue;
    }
    tasksByListId[list.id] = await getAllPages<RawTask>(
      api,
      token,
      `${LISTS_URL}/${encodeURIComponent(list.id)}/tasks?${TASKS_QUERY}`,
    );
  }
  return { lists, tasksByListId };
};

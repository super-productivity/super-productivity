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

export interface LoadGraphOptions {
  /** injectable for tests */
  sleep?: (ms: number) => Promise<void>;
}

/** Throttled (429) or temporarily unavailable (503, 504): worth another try. */
const RETRYABLE_STATUSES = new Set([429, 503, 504]);
export const MAX_RETRIES = 3;
/** Doubled per retry: 2 s, 4 s, 8 s. */
export const RETRY_BASE_DELAY_MS = 2000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The HTTP status of a failed `PluginAPI.request`. In-process the host error
 * carries `.status`; across the iframe bridge only its message survives
 * (`[PluginHttp] Request failed with status 429`). Neither path exposes
 * response headers, so `Retry-After` cannot be honored — a fixed backoff is.
 */
export const readHttpStatus = (e: unknown): number | null => {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === 'number') {
    return status;
  }
  const match = /\bstatus (\d{3})\b/.exec(e instanceof Error ? e.message : String(e));
  return match ? Number(match[1]) : null;
};

const requestWithRetry = async <T>(
  api: GraphRequestApi,
  token: string,
  url: string,
  sleep: (ms: number) => Promise<void>,
): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.request<T>(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      const status = readHttpStatus(e);
      if (attempt >= MAX_RETRIES || status === null || !RETRYABLE_STATUSES.has(status)) {
        throw e;
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
};

/** Follows `@odata.nextLink` paging; the bearer token never leaves Graph's origin. */
const getAllPages = async <T>(
  api: GraphRequestApi,
  token: string,
  firstUrl: string,
  sleep: (ms: number) => Promise<void>,
): Promise<T[]> => {
  const items: T[] = [];
  let url: string | undefined = firstUrl;
  while (url) {
    if (!url.startsWith(`${GRAPH_ORIGIN}/`)) {
      throw new Error(
        'Microsoft Graph returned a next page outside graph.microsoft.com.',
      );
    }
    const page: GraphPage<T> = await requestWithRetry<GraphPage<T>>(
      api,
      token,
      url,
      sleep,
    );
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
  { sleep = defaultSleep }: LoadGraphOptions = {},
): Promise<RawGraphData> => {
  const lists = await getAllPages<RawList>(api, token, LISTS_URL, sleep);
  const tasksByListId: Record<string, RawTask[]> = {};
  for (const list of lists) {
    if (!list.id) {
      continue;
    }
    tasksByListId[list.id] = await getAllPages<RawTask>(
      api,
      token,
      `${LISTS_URL}/${encodeURIComponent(list.id)}/tasks?${TASKS_QUERY}`,
      sleep,
    );
  }
  return { lists, tasksByListId };
};

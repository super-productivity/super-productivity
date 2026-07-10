import { PluginAPI } from '@super-productivity/plugin-api';
import { mergeSyncResponses, RawSyncResponse } from './from-api';

const SYNC_URL = 'https://api.todoist.com/api/v1/sync';
const RESOURCE_TYPES = ['projects', 'items', 'sections', 'notes'];

type TodoistRequestApi = Pick<PluginAPI, 'request'>;

const requestSync = (
  api: TodoistRequestApi,
  token: string,
  syncToken: string,
): Promise<RawSyncResponse> =>
  api.request<RawSyncResponse>(SYNC_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      sync_token: syncToken,
      resource_types: JSON.stringify(RESOURCE_TYPES),
    }).toString(),
  });

/**
 * Todoist can serve delayed full snapshots for large accounts. Always apply the
 * immediately-following incremental delta before previewing data so recent
 * creates, updates, and tombstones are represented in the import.
 *
 * @see https://developer.todoist.com/api/v1/#tag/Sync/Incremental-sync
 */
export const loadTodoistData = async (
  api: TodoistRequestApi,
  token: string,
): Promise<RawSyncResponse> => {
  const full = await requestSync(api, token, '*');
  if (!full.sync_token) {
    throw new Error('Todoist full sync did not return an incremental sync token.');
  }
  const incremental = await requestSync(api, token, full.sync_token);
  return mergeSyncResponses(full, incremental);
};

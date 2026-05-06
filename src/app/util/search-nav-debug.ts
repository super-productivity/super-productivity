import { Log } from '../core/log';

type SearchNavDebugPayload = Record<string, unknown>;

interface SearchNavDebugEntry extends SearchNavDebugPayload {
  at: string;
  event: string;
}

const DEBUG_FLAG = 'SP_SEARCH_NAV_DEBUG';
const MAX_ENTRIES = 100;
const DEBUG_CONTEXT = 'search-nav-debug';

let _entries: SearchNavDebugEntry[] = [];

const _isEnabled = (): boolean =>
  typeof window !== 'undefined' &&
  typeof localStorage !== 'undefined' &&
  localStorage.getItem(DEBUG_FLAG) === '1';

export const recordSearchNavDebug = (
  event: string,
  payload: SearchNavDebugPayload = {},
): void => {
  if (!_isEnabled()) {
    return;
  }

  const entry: SearchNavDebugEntry = {
    at: new Date().toISOString(),
    event,
    ...payload,
  };

  _entries = [..._entries.slice(-(MAX_ENTRIES - 1)), entry];
  (
    window as Window & {
      __spSearchNavDebug?: SearchNavDebugEntry[];
    }
  ).__spSearchNavDebug = _entries;

  Log.log(`[${DEBUG_CONTEXT}]`, entry);
};

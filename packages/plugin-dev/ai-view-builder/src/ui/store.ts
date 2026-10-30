import type { PluginAPI } from '@super-productivity/plugin-api';
import { parseSpec, ViewSpec } from '../core/spec';
import { DEFAULT_MODEL, MODELS } from '../core/edit-loop';

declare const PluginAPI: PluginAPI;

// One synced entry per view, so views edited on two devices do not collide.
// Bound: one entry per user-created view, each ≤ 64 KB (a typical spec is a
// few KB), plus the last few requests for context.

const VIEW_PREFIX = 'view:';
const SETTINGS_KEY = 'settings';
const MAX_VIEW_BYTES = 64 * 1024;
const MAX_REQUESTS = 10;

export interface StoredView {
  id: string;
  spec: ViewSpec;
  requests: string[];
  updatedAt: number;
}

export interface Settings {
  model: string;
  voiceConsent?: boolean;
}

export const newViewId = (): string => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `v${Date.now().toString(36)}${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
};

const parseStoredView = (raw: string): StoredView | null => {
  try {
    const parsed = JSON.parse(raw);
    const spec = parseSpec(parsed?.spec);
    if (!spec || typeof parsed.id !== 'string') return null;
    return {
      id: parsed.id,
      spec,
      requests: Array.isArray(parsed.requests)
        ? parsed.requests.filter((r: unknown) => typeof r === 'string')
        : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
};

export const loadViews = async (): Promise<StoredView[]> => {
  const keys = await PluginAPI.listSyncedDataKeys(VIEW_PREFIX);
  const views = await Promise.all(
    keys.map(async (key) => {
      const raw = await PluginAPI.loadSyncedData(key);
      return raw ? parseStoredView(raw) : null;
    }),
  );
  return views
    .filter((v): v is StoredView => !!v)
    .sort((a, b) => a.spec.title.localeCompare(b.spec.title));
};

export const saveView = async (view: StoredView): Promise<void> => {
  const record: StoredView = {
    ...view,
    requests: view.requests.slice(-MAX_REQUESTS),
    updatedAt: Date.now(),
  };
  const json = JSON.stringify(record);
  if (new TextEncoder().encode(json).length > MAX_VIEW_BYTES) {
    throw new Error('This view got too large to save. Remove some parts first.');
  }
  await PluginAPI.persistDataSynced(json, VIEW_PREFIX + view.id);
};

export const deleteView = async (id: string): Promise<void> => {
  // An empty entry is how plugin data is removed; it drops out of the key list.
  await PluginAPI.persistDataSynced('', VIEW_PREFIX + id);
};

export const loadSettings = async (): Promise<Settings> => {
  try {
    const raw = await PluginAPI.loadSyncedData(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ...parsed,
      model: MODELS.some((m) => m.id === parsed.model) ? parsed.model : DEFAULT_MODEL,
    };
  } catch {
    return { model: DEFAULT_MODEL };
  }
};

export const saveSettings = (settings: Settings): Promise<void> =>
  PluginAPI.persistDataSynced(JSON.stringify(settings), SETTINGS_KEY);

import type { PluginAPI, Project } from '@super-productivity/plugin-api';
import { TaskLike } from '../core/lines';
import { parseSettings } from '../core/settings';
import { Invoice, Settings } from '../core/types';

declare const PluginAPI: PluginAPI;

const SETTINGS_KEY = 'settings';
// One key per invoice: invoices issued on two devices never overwrite each other.
const INVOICE_PREFIX = 'invoice_';

export const host = (): PluginAPI => PluginAPI;

// The host commits writes in the background, and until then lists only
// committed keys (reads already return the pending value). Remember the keys
// this session wrote; otherwise a just-issued invoice would be missing from
// the list and its hours would show as unbilled again.
const writtenKeys = new Set<string>();

const write = async (key: string, data: string): Promise<void> => {
  writtenKeys.add(key);
  try {
    await PluginAPI.persistDataSynced(data, key);
  } catch (error) {
    // A rejected write (e.g. too large) never lands; don't list it.
    writtenKeys.delete(key);
    throw error;
  }
};

const listKeys = async (prefix: string): Promise<string[]> => {
  const keys = new Set(await PluginAPI.listSyncedDataKeys(prefix));
  for (const key of writtenKeys) {
    if (key.startsWith(prefix)) keys.add(key);
  }
  return [...keys];
};

export const loadSettings = async (): Promise<Settings> =>
  parseSettings(await PluginAPI.loadSyncedData(SETTINGS_KEY));

export const saveSettings = (settings: Settings): Promise<void> =>
  write(SETTINGS_KEY, JSON.stringify(settings));

export const loadInvoices = async (): Promise<Invoice[]> => {
  const keys = await listKeys(INVOICE_PREFIX);
  const raw = await Promise.all(keys.map((key) => PluginAPI.loadSyncedData(key)));
  // A record can vanish between listing and loading; deleted ones are empty.
  return raw
    .filter((data): data is string => !!data)
    .map((data) => JSON.parse(data) as Invoice)
    .sort((a, b) => b.seq - a.seq);
};

export const saveInvoice = (invoice: Invoice): Promise<void> =>
  write(INVOICE_PREFIX + invoice.id, JSON.stringify(invoice));

// The plugin API has no delete; an emptied key loads as empty and is skipped.
export const deleteInvoice = (id: string): Promise<void> =>
  write(INVOICE_PREFIX + id, '');

export const loadTasks = async (): Promise<TaskLike[]> => {
  const [active, archived] = await Promise.all([
    PluginAPI.getTasks(),
    PluginAPI.getArchivedTasks(),
  ]);
  return [...active, ...archived];
};

export const loadProjects = async (): Promise<Project[]> => PluginAPI.getAllProjects();

const BACKGROUND_TIMEOUT_MS = 10_000;

/** Sends a message to plugin.js (which can download files) and waits for its answer. */
export const sendToBackground = (message: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const messageId = `inv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onMessage = (event: MessageEvent): void => {
      const { type, messageId: id } = event.data ?? {};
      if (event.source !== window.parent || id !== messageId) return;
      if (type !== 'PLUGIN_MESSAGE_RESPONSE' && type !== 'PLUGIN_MESSAGE_ERROR') return;
      cleanup();
      if (type === 'PLUGIN_MESSAGE_RESPONSE') resolve(event.data.result);
      else reject(new Error(event.data.error || 'The plugin did not answer.'));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('The plugin did not answer.'));
    }, BACKGROUND_TIMEOUT_MS);
    const cleanup = (): void => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'PLUGIN_MESSAGE', messageId, message }, '*');
  });

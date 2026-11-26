// The iframe's links to the host: PluginAPI calls and messages to plugin.js.

import type { PluginAPI } from '@super-productivity/plugin-api';
import type { WriteApi } from '../core/apply';
import type { RequestFn } from '../core/claude';
import type { Settings } from '../core/settings';
import type { Named, Snapshot, TaskLike } from '../core/types';

declare const PluginAPI: PluginAPI;

export const host = (): PluginAPI => PluginAPI;

const BACKGROUND_TIMEOUT_MS = 10_000;

export const sendToBackground = (message: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const messageId = `aic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onMessage = (event: MessageEvent): void => {
      const { type, messageId: id } = event.data ?? {};
      if (event.source !== window.parent || id !== messageId) return;
      // Only the two answer types count; anything else with our id is not an answer.
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

export interface HostState {
  hasApiKey: boolean;
  settings: Settings;
  currentTaskId: string | null;
}

export const getHostState = (): Promise<HostState> =>
  sendToBackground({ type: 'getState' }) as Promise<HostState>;

export const getApiKey = async (): Promise<string | null> =>
  ((await sendToBackground({ type: 'getApiKey' })) as { apiKey: string | null }).apiKey;

const named = (list: { id: string; title: string }[]): Named[] =>
  list.map(({ id, title }) => ({ id, title }));

/** The user's data at the moment of asking. */
export const readSnapshot = async (
  selectionIds: string[],
  currentTaskId: string | null,
): Promise<Snapshot> => {
  if (!PluginAPI.getDayContext)
    throw new Error('Update Super Productivity to use this plugin.');
  const [tasks, projects, tags, day] = await Promise.all([
    PluginAPI.getTasks(),
    PluginAPI.getAllProjects(),
    PluginAPI.getAllTags(),
    PluginAPI.getDayContext(),
  ]);
  return {
    // The host passes more task fields (deadline, priority) than the Task type declares.
    tasks: tasks as unknown as TaskLike[],
    projects: named(projects),
    tags: named(tags),
    day: { ...day, nowMs: Date.now() },
    selectionIds,
    currentTaskId,
  };
};

export const requestFn: RequestFn = (url, options) => PluginAPI.request(url, options);

export const writeApi: WriteApi = {
  getTasks: async () => (await PluginAPI.getTasks()) as unknown as TaskLike[],
  addTask: (data) =>
    PluginAPI.addTask(data as unknown as Parameters<PluginAPI['addTask']>[0]),
  updateTask: (id, updates, options) => PluginAPI.updateTask(id, updates, options),
  deleteTask: (id) => PluginAPI.deleteTask(id),
};

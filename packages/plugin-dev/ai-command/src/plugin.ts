// Host half of AI Command (plugin.js). The panel runs in an iframe, which
// cannot reach secret storage or register shortcuts, so those live here and
// the panel asks over the plugin message channel. The side-panel button comes
// from the manifest's `sidePanel`.

import { PluginHooks, type PluginAPI } from '@super-productivity/plugin-api';
import { parseSettings, type Settings } from './core/settings';

declare const PluginAPI: PluginAPI;

const PLUGIN_ID = 'ai-command';
const API_KEY_SECRET = 'anthropicApiKey';
// Secrets are per device and never synced: "Apply without review" on one
// device must not turn it on for another (§ 8.1).
const SETTINGS_SECRET = 'settings';

// shortcut: an app start never resumes tracking (state-snapshot.service.ts
// clears currentTaskId), so null is right then. Enabling the plugin mid-tracking
// leaves the task unknown until the next currentTaskChange; read it once the
// API exposes the current task.
let currentTaskId: string | null = null;

const readSettings = async (): Promise<Settings> =>
  parseSettings(await PluginAPI.getSecret(SETTINGS_SECRET));

const saveSettings = async (patch: Partial<Settings>): Promise<Settings> => {
  const next = { ...(await readSettings()), ...patch };
  await PluginAPI.setSecret(SETTINGS_SECRET, JSON.stringify(next));
  return next;
};

type Message = { type?: string; apiKey?: unknown; settings?: unknown; panel?: unknown };

// What the panel showed, so closing and reopening it brings it back. Memory
// only: it holds task titles and is gone on app restart.
let panel: Record<string, unknown> = {};

const HANDLERS: Record<string, (msg: Message) => Promise<unknown>> = {
  getState: async () => ({
    hasApiKey: !!(await PluginAPI.getSecret(API_KEY_SECRET)),
    settings: await readSettings(),
    currentTaskId,
  }),
  // The key goes to the panel only to make the call; it is never rendered.
  getApiKey: async () => ({ apiKey: await PluginAPI.getSecret(API_KEY_SECRET) }),
  setApiKey: async (msg) => {
    const apiKey = typeof msg.apiKey === 'string' ? msg.apiKey.trim() : '';
    if (!apiKey) throw new Error('The API key is empty.');
    await PluginAPI.setSecret(API_KEY_SECRET, apiKey);
    return { ok: true };
  },
  clearApiKey: async () => {
    await PluginAPI.deleteSecret(API_KEY_SECRET);
    return { ok: true };
  },
  saveSettings: async (msg) => saveSettings((msg.settings || {}) as Partial<Settings>),
  getPanel: async () => panel,
  savePanel: async (msg) => {
    panel = { ...panel, ...(msg.panel as Record<string, unknown>) };
    return { ok: true };
  },
};

PluginAPI.onMessage?.(async (message: unknown) => {
  const msg = (message ?? {}) as Message;
  const handler = msg.type ? HANDLERS[msg.type] : undefined;
  if (!handler) throw new Error('Unknown message type');
  return handler(msg);
});

const open = (): void =>
  PluginAPI.dispatchAction({ type: '[Layout] Show PluginPanel', pluginId: PLUGIN_ID });

PluginAPI.registerShortcut({ id: 'open', label: 'Open AI Command', onExec: open });

PluginAPI.registerHook(PluginHooks.CURRENT_TASK_CHANGE, (payload) => {
  currentTaskId = payload.current?.id ?? null;
});

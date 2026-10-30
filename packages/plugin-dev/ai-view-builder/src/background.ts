// Background half of AI View Builder (plugin.js). The UI runs in an iframe,
// which cannot reach secret storage, so the API key lives here and the UI asks
// for it over the plugin message channel. It also owns the work-context button
// that shows a view inside any project or tag.

import {
  PluginHooks,
  type ActiveWorkContext,
  type PluginAPI,
  type WorkContextChangePayload,
} from '@super-productivity/plugin-api';

declare const PluginAPI: PluginAPI;

const API_KEY_SECRET = 'anthropicApiKey';
// Synced list of context ids where the view is shown in place of the task list.
const EMBEDS_KEY = 'embeds';

PluginAPI.onMessage?.(async (message: unknown) => {
  const msg = (message ?? {}) as { type?: string; apiKey?: unknown };
  if (msg.type === 'getApiKey') {
    return { apiKey: await PluginAPI.getSecret(API_KEY_SECRET) };
  }
  if (msg.type === 'setApiKey') {
    const apiKey = typeof msg.apiKey === 'string' ? msg.apiKey.trim() : '';
    if (!apiKey) throw new Error('API key must not be empty');
    await PluginAPI.setSecret(API_KEY_SECRET, apiKey);
    return { ok: true };
  }
  if (msg.type === 'clearApiKey') {
    await PluginAPI.deleteSecret(API_KEY_SECRET);
    return { ok: true };
  }
  throw new Error('Unknown message type');
});

let embeds = new Set<string>();

const loadEmbeds = async (): Promise<Set<string>> => {
  try {
    const raw = await PluginAPI.loadSyncedData(EMBEDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [],
    );
  } catch {
    return new Set();
  }
};

const showFor = (ctx: ActiveWorkContext | null): void => {
  if (ctx && embeds.has(ctx.id)) {
    PluginAPI.showInWorkContext();
  } else {
    PluginAPI.closeWorkContextView();
  }
};

const toggle = async (ctx: ActiveWorkContext): Promise<void> => {
  // Re-read first so a toggle from another device is not overwritten.
  embeds = await loadEmbeds();
  if (embeds.has(ctx.id)) {
    embeds.delete(ctx.id);
  } else {
    embeds.add(ctx.id);
  }
  showFor(ctx);
  await PluginAPI.persistDataSynced(JSON.stringify([...embeds]), EMBEDS_KEY);
};

PluginAPI.registerWorkContextHeaderButton({
  label: 'AI view',
  icon: 'auto_awesome',
  showFor: ['PROJECT', 'TAG', 'TODAY'],
  onClick: (ctx) => {
    void toggle(ctx);
  },
});

PluginAPI.registerHook(PluginHooks.WORK_CONTEXT_CHANGE, (payload) => {
  showFor(payload as WorkContextChangePayload);
});

PluginAPI.registerHook(PluginHooks.PERSISTED_DATA_CHANGED, async () => {
  embeds = await loadEmbeds();
  showFor(await PluginAPI.getActiveWorkContext());
});

void (async () => {
  embeds = await loadEmbeds();
  showFor(await PluginAPI.getActiveWorkContext());
})();

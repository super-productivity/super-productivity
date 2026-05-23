/**
 * Document-Mode background script. Runs once per plugin load in the host
 * page context. Responsible for:
 *  - Registering the work-context header button
 *  - Tracking which contexts have document mode enabled
 *  - Auto-showing / -closing the work-view embed on context navigation
 *
 * The TipTap editor itself lives in the iframe (src/ui/editor.ts). Both
 * scripts share a single persisted blob; this script owns the
 * `enabledCtxIds` field, the editor owns `docs`. Each one read-modify-writes
 * only its own slice so updates don't clobber each other.
 */

import {
  PluginHooks,
  type ActiveWorkContext,
  type PluginAPI,
  type WorkContextChangePayload,
} from '@super-productivity/plugin-api';

declare const PluginAPI: PluginAPI;

interface StoredState {
  version: number;
  docs: Record<string, unknown>;
  enabledCtxIds: string[];
}

const STORAGE_VERSION = 1;
const emptyState = (): StoredState => ({
  version: STORAGE_VERSION,
  docs: {},
  enabledCtxIds: [],
});

const loadState = async (): Promise<StoredState> => {
  try {
    const raw = await PluginAPI.loadSyncedData();
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      version: parsed.version ?? STORAGE_VERSION,
      docs: parsed.docs ?? {},
      enabledCtxIds: Array.isArray(parsed.enabledCtxIds) ? parsed.enabledCtxIds : [],
    };
  } catch (err) {
    PluginAPI.log.err('document-mode: failed to parse stored state', err);
    return emptyState();
  }
};

/**
 * Read-modify-write helper. Re-reads the blob from storage before mutating
 * so we don't overwrite changes made by the editor (which writes the `docs`
 * field on its own debounce schedule).
 */
const updateEnabledCtxIds = async (
  mutate: (ids: string[]) => string[],
): Promise<string[]> => {
  const current = await loadState();
  const next = mutate(current.enabledCtxIds);
  await PluginAPI.persistDataSynced(JSON.stringify({ ...current, enabledCtxIds: next }));
  return next;
};

let enabledIds = new Set<string>();

const init = async (): Promise<void> => {
  const state = await loadState();
  enabledIds = new Set(state.enabledCtxIds);

  // If the active context is already enabled, mount the embed immediately
  // so the user sees doc mode on app start without an extra click.
  const ctx = await PluginAPI.getActiveWorkContext();
  if (ctx && enabledIds.has(ctx.id)) {
    PluginAPI.showInWorkContext();
  }
};

const onContextChange = (ctx: WorkContextChangePayload): void => {
  if (ctx && enabledIds.has(ctx.id)) {
    PluginAPI.showInWorkContext();
  } else {
    PluginAPI.closeWorkContextView();
  }
};

const onButtonClick = async (ctx: ActiveWorkContext): Promise<void> => {
  const wasEnabled = enabledIds.has(ctx.id);
  if (wasEnabled) {
    enabledIds.delete(ctx.id);
    PluginAPI.closeWorkContextView();
  } else {
    enabledIds.add(ctx.id);
    PluginAPI.showInWorkContext();
  }
  try {
    await updateEnabledCtxIds((ids) => {
      const set = new Set(ids);
      if (wasEnabled) set.delete(ctx.id);
      else set.add(ctx.id);
      return [...set];
    });
  } catch (err) {
    PluginAPI.log.err('document-mode: failed to persist toggle', err);
  }
};

PluginAPI.registerWorkContextHeaderButton({
  label: 'Document Mode',
  icon: 'description',
  showFor: ['PROJECT', 'TODAY'],
  onClick: (ctx) => {
    void onButtonClick(ctx);
  },
});

// Known gap: no hook for remote PLUGIN_USER_DATA updates. An edit on
// another device arriving mid-session leaves this script's in-memory
// `enabledIds` and the iframe editor's `storedState` stale until a
// context switch or page reload. Acceptable while document-mode is
// alpha + opt-in per context; revisit if conflicts are reported.
// Tracked alongside Stage A in docs/plans/2026-05-23-stage-a-keyed-plugin-persistence.md.
PluginAPI.registerHook(PluginHooks.WORK_CONTEXT_CHANGE, (payload) => {
  onContextChange(payload as WorkContextChangePayload);
});

void init();

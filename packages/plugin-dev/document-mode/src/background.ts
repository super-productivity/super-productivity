/**
 * Document-Mode background script. Runs once per plugin load in the host
 * page context. Responsible for:
 *  - Running the legacy → keyed persistence migration on first load
 *  - Registering the work-context header button
 *  - Tracking which contexts have document mode enabled
 *  - Auto-showing / -closing the work-view embed on context navigation
 *
 * The TipTap editor itself lives in the iframe (src/ui/editor.ts). Each
 * persisted entity is now keyed independently (Stage A):
 *  - `meta`         — enabledCtxIds (owned by this script)
 *  - `doc:${ctxId}` — one entry per context (owned by the editor iframe)
 *  - `__meta__`     — migration stamp
 *
 * Splitting by entity means a concurrent toggle on one device and an edit
 * on another no longer LWW-collide at the blob level.
 */

import {
  PluginHooks,
  type ActiveWorkContext,
  type PluginAPI,
  type WorkContextChangePayload,
} from '@super-productivity/plugin-api';
import {
  loadEnabledCtxIds,
  migrateToKeyedPersistence,
  saveEnabledCtxIds,
} from './persistence';

declare const PluginAPI: PluginAPI;

/**
 * Read-modify-write helper. Re-reads the meta entry before mutating so we
 * don't overwrite a concurrent toggle that landed since our last read. The
 * editor iframe owns `doc:${ctxId}` entries; this script touches only `meta`.
 */
const updateEnabledCtxIds = async (
  mutate: (ids: string[]) => string[],
): Promise<string[]> => {
  const current = await loadEnabledCtxIds(PluginAPI);
  const next = mutate(current);
  await saveEnabledCtxIds(PluginAPI, next);
  return next;
};

let enabledIds = new Set<string>();

const init = async (): Promise<void> => {
  // Migration is idempotent and guarded by a stamp — safe to call on every
  // load. Must run before the first keyed read or we'd see "no data" for
  // every existing user.
  try {
    await migrateToKeyedPersistence(PluginAPI);
  } catch (err) {
    PluginAPI.log.err('document-mode: migration failed', err);
    // Continue anyway: a partial migration leaves the data in place
    // (corruption guard in persistence.ts) and the next session will retry.
  }

  enabledIds = new Set(await loadEnabledCtxIds(PluginAPI));

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

/**
 * React to `PERSISTED_DATA_CHANGED` (#7752) — fires when *any* of this
 * plugin's keyed entries change, including remote updates from another
 * device. Re-read the meta entry; if the active context's enabled-state
 * flipped, sync the work-view visibility. Idempotent on no-op re-fires.
 *
 * The fire is keyless: a remote edit to `doc:${ctxId}` also fires this,
 * after which `loadEnabledCtxIds` returns the same set we already have
 * and we noop. The editor iframe reacts to its own `doc:` changes via a
 * separate handler registered there.
 */
const onPersistedDataChanged = async (): Promise<void> => {
  let next: Set<string>;
  try {
    next = new Set(await loadEnabledCtxIds(PluginAPI));
  } catch (err) {
    PluginAPI.log.err('document-mode: enabled-ids reload failed', err);
    return;
  }
  // Skip the visibility reconcile when membership is identical — most fires
  // are doc edits, not meta toggles.
  let changed = next.size !== enabledIds.size;
  if (!changed) {
    for (const id of next) {
      if (!enabledIds.has(id)) {
        changed = true;
        break;
      }
    }
  }
  if (!changed) return;

  const ctx = await PluginAPI.getActiveWorkContext();
  const activeId = ctx?.id ?? null;
  const wasActiveEnabled = activeId !== null && enabledIds.has(activeId);
  const isActiveEnabled = activeId !== null && next.has(activeId);
  enabledIds = next;
  if (activeId === null) return;
  if (!wasActiveEnabled && isActiveEnabled) {
    PluginAPI.showInWorkContext();
  } else if (wasActiveEnabled && !isActiveEnabled) {
    PluginAPI.closeWorkContextView();
  }
};

PluginAPI.registerHook(PluginHooks.WORK_CONTEXT_CHANGE, (payload) => {
  onContextChange(payload as WorkContextChangePayload);
});
PluginAPI.registerHook(PluginHooks.PERSISTED_DATA_CHANGED, () => {
  void onPersistedDataChanged();
});

void init();

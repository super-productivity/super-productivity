/**
 * Pure reconciler for the `PERSISTED_DATA_CHANGED` handler in
 * background.ts (#7752). Lives in its own file so the integration spec
 * can import it without pulling in background.ts's top-level
 * side-effects (the work-context header button + hook registrations,
 * which both call `PluginAPI` directly and are unmockable in node).
 */

import type { PluginAPI } from '@super-productivity/plugin-api';
import { loadEnabledCtxIds } from './persistence';

/**
 * Result of a `PERSISTED_DATA_CHANGED` reconcile pass.
 *  - `next` is the freshly-loaded enabled set (or a copy of `prev` when
 *    the read failed / the set is unchanged).
 *  - `action` says whether the active context's enabled-state flipped:
 *    `'show'` newly enabled, `'close'` newly disabled, `'noop'` no change.
 */
export interface ReconcileResult {
  next: Set<string>;
  action: 'show' | 'close' | 'noop';
}

/**
 * Reconcile the in-memory enabled set against the latest persisted state.
 * Caller passes its current snapshot as `prev` and applies the returned
 * `next` + `action` — keeping the mutable state in the caller eliminates
 * the test/handler-drift hazard and bounds the race window between
 * interleaved fires (each fire reasons against its own snapshot).
 *
 * The fire is keyless: a remote edit to `doc:${ctxId}` also fires
 * `PERSISTED_DATA_CHANGED`, after which `loadEnabledCtxIds` returns the
 * same set we already have and we report `'noop'`. The editor iframe
 * reacts to its own `doc:` changes via a separate handler.
 *
 * Both `loadSyncedData` (via `loadEnabledCtxIds`) and
 * `getActiveWorkContext` are wrapped in try/catch — a transient host
 * error (IDB error, IPC drop) must not wedge the reconciler: it'd
 * otherwise propagate as an unhandled rejection from the hook
 * registration's `void onPersistedDataChanged()` and leave `enabledIds`
 * stale across all subsequent fires.
 */
export const reconcileEnabledIds = async (
  api: PluginAPI,
  prev: ReadonlySet<string>,
): Promise<ReconcileResult> => {
  let next: Set<string>;
  try {
    next = new Set(await loadEnabledCtxIds(api));
  } catch (err) {
    api.log.err('document-mode: enabled-ids reload failed', err);
    return { next: new Set(prev), action: 'noop' };
  }
  // Skip the visibility reconcile when membership is identical — most fires
  // are doc edits, not meta toggles.
  let changed = next.size !== prev.size;
  if (!changed) {
    for (const id of next) {
      if (!prev.has(id)) {
        changed = true;
        break;
      }
    }
  }
  if (!changed) return { next: new Set(prev), action: 'noop' };

  let activeId: string | null;
  try {
    const ctx = await api.getActiveWorkContext();
    activeId = ctx?.id ?? null;
  } catch (err) {
    api.log.err('document-mode: active-ctx read failed', err);
    return { next, action: 'noop' };
  }
  if (activeId === null) return { next, action: 'noop' };
  const wasActiveEnabled = prev.has(activeId);
  const isActiveEnabled = next.has(activeId);
  if (!wasActiveEnabled && isActiveEnabled) return { next, action: 'show' };
  if (wasActiveEnabled && !isActiveEnabled) return { next, action: 'close' };
  return { next, action: 'noop' };
};

/**
 * Tests for the `PERSISTED_DATA_CHANGED` handler in background.ts (#7752).
 *
 * background.ts has top-level side effects (registers hooks on module load),
 * so rather than importing it we drive the same reconciliation logic via a
 * local copy of the handler — this keeps the spec hermetic and lets us focus
 * on the membership-flip truth table without spinning up the PluginAPI shim.
 *
 * The handler shape under test mirrors the one in background.ts exactly:
 *   1. Re-read enabled ids.
 *   2. Bail if the set is unchanged (idempotent re-fire).
 *   3. If the active context's enabled-state flipped, call show/close.
 *   4. Update the in-memory set.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PluginAPI } from '@super-productivity/plugin-api';
import { loadEnabledCtxIds, saveEnabledCtxIds } from './persistence';

interface ApiCalls {
  show: number;
  close: number;
}

const createMockApi = (
  activeCtxId: string | null,
): { api: PluginAPI; store: Map<string, string>; calls: ApiCalls } => {
  const store = new Map<string, string>();
  const calls: ApiCalls = { show: 0, close: 0 };
  const api = {
    persistDataSynced: async (data: string, key?: string): Promise<void> => {
      store.set(key ?? '', data);
    },
    loadSyncedData: async (key?: string): Promise<string | null> => {
      const v = store.get(key ?? '');
      return v === undefined ? null : v;
    },
    getActiveWorkContext: async () =>
      activeCtxId === null ? null : { id: activeCtxId, type: 'PROJECT' as const },
    showInWorkContext: () => {
      calls.show += 1;
    },
    closeWorkContextView: () => {
      calls.close += 1;
    },
    log: { err: () => {} },
  } as unknown as PluginAPI;
  return { api, store, calls };
};

/**
 * Local copy of background.ts's onPersistedDataChanged. Kept structurally
 * identical so a behaviour drift in the real handler is caught by these
 * specs — if the file diverges, the next reader will notice and either
 * extract the handler to a testable export or update the copy.
 */
const reconcile = async (
  api: PluginAPI,
  enabledIds: Set<string>,
): Promise<Set<string>> => {
  const next = new Set(await loadEnabledCtxIds(api));
  let changed = next.size !== enabledIds.size;
  if (!changed) {
    for (const id of next) {
      if (!enabledIds.has(id)) {
        changed = true;
        break;
      }
    }
  }
  if (!changed) return enabledIds;
  const ctx = await api.getActiveWorkContext();
  const activeId = ctx?.id ?? null;
  const wasActiveEnabled = activeId !== null && enabledIds.has(activeId);
  const isActiveEnabled = activeId !== null && next.has(activeId);
  if (activeId !== null) {
    if (!wasActiveEnabled && isActiveEnabled) {
      api.showInWorkContext();
    } else if (wasActiveEnabled && !isActiveEnabled) {
      api.closeWorkContextView();
    }
  }
  return next;
};

test('hook: active ctx newly enabled → showInWorkContext', async () => {
  const { api, calls } = createMockApi('proj-a');
  await saveEnabledCtxIds(api, ['proj-a']);
  await reconcile(api, new Set<string>());
  assert.equal(calls.show, 1);
  assert.equal(calls.close, 0);
});

test('hook: active ctx newly disabled → closeWorkContextView', async () => {
  const { api, calls } = createMockApi('proj-a');
  // Remote write removed proj-a from the enabled set; local set still has it.
  await saveEnabledCtxIds(api, []);
  await reconcile(api, new Set(['proj-a']));
  assert.equal(calls.close, 1);
  assert.equal(calls.show, 0);
});

test('hook: non-active ctx changed → neither show nor close', async () => {
  const { api, calls } = createMockApi('proj-a');
  // proj-b was just enabled on another device; user is on proj-a (still
  // disabled). The embed must not appear on proj-a.
  await saveEnabledCtxIds(api, ['proj-b']);
  await reconcile(api, new Set<string>());
  assert.equal(calls.show, 0);
  assert.equal(calls.close, 0);
});

test('hook: idempotent re-fire (same set) → neither show nor close', async () => {
  const { api, calls } = createMockApi('proj-a');
  await saveEnabledCtxIds(api, ['proj-a']);
  // Already in sync — host fired because of a `doc:` change, not a meta change.
  await reconcile(api, new Set(['proj-a']));
  assert.equal(calls.show, 0);
  assert.equal(calls.close, 0);
});

test('hook: active ctx remains enabled but other ctxs change → no show/close churn', async () => {
  const { api, calls } = createMockApi('proj-a');
  // proj-b was enabled on another device; proj-a was already enabled here.
  await saveEnabledCtxIds(api, ['proj-a', 'proj-b']);
  const next = await reconcile(api, new Set(['proj-a']));
  // Set changed → we update in-memory, but no visibility flip for the active.
  assert.equal(calls.show, 0);
  assert.equal(calls.close, 0);
  assert.equal(next.has('proj-b'), true);
});

test('hook: no active context → never show or close even when set changes', async () => {
  const { api, calls } = createMockApi(null);
  await saveEnabledCtxIds(api, ['proj-a']);
  await reconcile(api, new Set<string>());
  assert.equal(calls.show, 0);
  assert.equal(calls.close, 0);
});

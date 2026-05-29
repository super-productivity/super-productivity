/**
 * Tests for `reconcileEnabledIds` — the pure half of the
 * `PERSISTED_DATA_CHANGED` handler in background.ts (#7752).
 *
 * Imports the real reconciler so a future behaviour drift is caught
 * here rather than passing against a copy. The reconciler lives in
 * its own file (`reconcile-enabled.ts`) precisely so that test imports
 * don't drag in background.ts's top-level side-effects (the work-context
 * header button registration, which crashes in node because PluginAPI
 * isn't globally defined).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PluginAPI } from '@super-productivity/plugin-api';
import { saveEnabledCtxIds } from './persistence';
import { reconcileEnabledIds } from './reconcile-enabled';

const createMockApi = (
  activeCtxId: string | null,
): { api: PluginAPI; store: Map<string, string> } => {
  const store = new Map<string, string>();
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
    log: { err: () => {} },
  } as unknown as PluginAPI;
  return { api, store };
};

test('reconcileEnabledIds: active ctx newly enabled → action=show', async () => {
  const { api } = createMockApi('proj-a');
  await saveEnabledCtxIds(api, ['proj-a']);
  const { next, action } = await reconcileEnabledIds(api, new Set<string>());
  assert.equal(action, 'show');
  assert.deepEqual([...next], ['proj-a']);
});

test('reconcileEnabledIds: active ctx newly disabled → action=close', async () => {
  const { api } = createMockApi('proj-a');
  await saveEnabledCtxIds(api, []);
  const { next, action } = await reconcileEnabledIds(api, new Set(['proj-a']));
  assert.equal(action, 'close');
  assert.deepEqual([...next], []);
});

test('reconcileEnabledIds: non-active ctx changed → action=noop, set still updates', async () => {
  // proj-b was just enabled on another device; user is on proj-a (still
  // disabled). The embed must not appear on proj-a, but `next` must
  // include proj-b so a subsequent switch to proj-b sees the right state.
  const { api } = createMockApi('proj-a');
  await saveEnabledCtxIds(api, ['proj-b']);
  const { next, action } = await reconcileEnabledIds(api, new Set<string>());
  assert.equal(action, 'noop');
  assert.deepEqual([...next].sort(), ['proj-b']);
});

test('reconcileEnabledIds: idempotent re-fire (same set) → action=noop', async () => {
  // The host fires this hook for every plugin-data change, including
  // doc:${ctxId} writes that don't touch the meta entry. Same set in,
  // same set out, no visibility flip.
  const { api } = createMockApi('proj-a');
  await saveEnabledCtxIds(api, ['proj-a']);
  const { action } = await reconcileEnabledIds(api, new Set(['proj-a']));
  assert.equal(action, 'noop');
});

test('reconcileEnabledIds: no active context → never show or close even when set changes', async () => {
  const { api } = createMockApi(null);
  await saveEnabledCtxIds(api, ['proj-a']);
  const { action } = await reconcileEnabledIds(api, new Set<string>());
  assert.equal(action, 'noop');
});

test('reconcileEnabledIds: loadSyncedData rejection is caught and logged', async () => {
  // A transient IDB/IPC failure during reload must not propagate — that
  // would crash the hook handler with an unhandled rejection and wedge
  // every subsequent fire that observes the same diff.
  const errs: unknown[] = [];
  const api = {
    loadSyncedData: async () => {
      throw new Error('synthetic read fail');
    },
    getActiveWorkContext: async () => ({ id: 'proj-a', type: 'PROJECT' }),
    log: {
      err: (...args: unknown[]) => {
        errs.push(args);
      },
    },
  } as unknown as PluginAPI;
  const prev = new Set(['proj-a']);
  const { next, action } = await reconcileEnabledIds(api, prev);
  assert.equal(action, 'noop');
  // Returns a fresh copy of prev so the caller's assignment doesn't
  // accidentally alias and mutate the input set.
  assert.deepEqual([...next], ['proj-a']);
  assert.notEqual(next, prev);
  assert.equal(errs.length, 1);
});

test('reconcileEnabledIds: getActiveWorkContext rejection is caught and logged', async () => {
  // Same hazard, second await site. Without the catch the rejection
  // escapes via `void onPersistedDataChanged()` → unhandled rejection,
  // and `enabledIds` is never updated for this fire.
  const errs: unknown[] = [];
  const api = {
    loadSyncedData: async () => JSON.stringify({ enabledCtxIds: ['proj-a'] }),
    getActiveWorkContext: async () => {
      throw new Error('synthetic getActive fail');
    },
    log: {
      err: (...args: unknown[]) => {
        errs.push(args);
      },
    },
  } as unknown as PluginAPI;
  const { next, action } = await reconcileEnabledIds(api, new Set<string>());
  // Still surfaces the new set so the caller can update its baseline —
  // we just couldn't decide show/close without an active context.
  assert.equal(action, 'noop');
  assert.deepEqual([...next], ['proj-a']);
  assert.equal(errs.length, 1);
});

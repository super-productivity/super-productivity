/**
 * Tests for the keyed-persistence helpers and the legacy → keyed migration.
 * Run with `npm test` (see scripts/test.js) — esbuild transpiles + bundles
 * each spec, and `node --test` executes it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PluginAPI } from '@super-productivity/plugin-api';
import {
  docKey,
  loadContextDoc,
  loadEnabledCtxIds,
  migrateToKeyedPersistence,
  saveContextDoc,
  saveEnabledCtxIds,
} from './persistence';

/**
 * In-memory mock of the host's plugin storage. Mirrors the keyed semantics:
 * each (pluginId, key?) tuple is a distinct entry, an empty payload
 * tombstones an entry (treated as missing on read).
 */
const createMockApi = (): {
  api: PluginAPI;
  store: Map<string, string>;
  writes: { key: string | undefined; data: string }[];
} => {
  // Single entityId space (pluginId-scoped — the test plugin id is implied).
  // Key "" means the legacy keyless entry.
  const store = new Map<string, string>();
  const writes: { key: string | undefined; data: string }[] = [];
  const api = {
    persistDataSynced: async (data: string, key?: string): Promise<void> => {
      writes.push({ key, data });
      const k = key ?? '';
      // Plugin-side tombstone convention: an empty payload means "ignore".
      // We model this on the host by storing the empty string; the read
      // side returns null for empty entries so callers see "no data".
      store.set(k, data);
    },
    loadSyncedData: async (key?: string): Promise<string | null> => {
      const k = key ?? '';
      const v = store.get(k);
      if (v === undefined) return null;
      if (v === '') return ''; // explicit tombstone — still readable as empty
      return v;
    },
  } as unknown as PluginAPI;
  return { api, store, writes };
};

/* -------------------------------------------------------------------------- */
/* Read/write helpers                                                          */
/* -------------------------------------------------------------------------- */

test('docKey: composes "doc:<ctxId>"', () => {
  assert.equal(docKey('project-1'), 'doc:project-1');
  assert.equal(docKey('TODAY'), 'doc:TODAY');
});

test('loadEnabledCtxIds: returns [] when meta is missing', async () => {
  const { api } = createMockApi();
  assert.deepEqual(await loadEnabledCtxIds(api), []);
});

test('loadEnabledCtxIds: returns the saved ids', async () => {
  const { api } = createMockApi();
  await saveEnabledCtxIds(api, ['p1', 'p2']);
  assert.deepEqual(await loadEnabledCtxIds(api), ['p1', 'p2']);
});

test('loadEnabledCtxIds: tolerates corrupt meta (returns [])', async () => {
  const { api, store } = createMockApi();
  store.set('meta', '{not json');
  assert.deepEqual(await loadEnabledCtxIds(api), []);
});

test('loadContextDoc: returns null when the entry is missing', async () => {
  const { api } = createMockApi();
  assert.equal(await loadContextDoc(api, 'p1'), null);
});

test('loadContextDoc: round-trips the doc value', async () => {
  const { api } = createMockApi();
  const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
  await saveContextDoc(api, 'p1', doc);
  assert.deepEqual(await loadContextDoc(api, 'p1'), doc);
});

test('saveContextDoc: writes under doc:<ctxId>', async () => {
  const { api, store } = createMockApi();
  await saveContextDoc(api, 'TODAY', { type: 'doc' });
  assert.equal(store.get('doc:TODAY'), JSON.stringify({ type: 'doc' }));
});

/* -------------------------------------------------------------------------- */
/* Migration                                                                   */
/* -------------------------------------------------------------------------- */

test('migration: no-op when already stamped', async () => {
  const { api, store, writes } = createMockApi();
  store.set('__meta__', JSON.stringify({ migrated: 1 }));
  // Even if a legacy blob exists, we don't touch it once the stamp says we're
  // done — a re-migration could overwrite later edits to the keyed entries.
  store.set('', JSON.stringify({ docs: { p1: { type: 'doc' } } }));

  await migrateToKeyedPersistence(api);

  assert.deepEqual(writes, []);
  assert.equal(store.has('doc:p1'), false);
});

test('migration: stamps success on a fresh install (no legacy data)', async () => {
  const { api, store } = createMockApi();
  await migrateToKeyedPersistence(api);
  assert.equal(store.get('__meta__'), JSON.stringify({ migrated: 1 }));
  assert.equal(store.has('meta'), false);
  assert.equal(store.has(''), false);
});

test('migration: splits legacy blob into keyed entries + meta', async () => {
  const { api, store } = createMockApi();
  const legacy = {
    version: 1,
    docs: {
      p1: { type: 'doc', content: [{ type: 'paragraph' }] },
      TODAY: { type: 'doc', content: [{ type: 'heading' }] },
    },
    enabledCtxIds: ['p1'],
  };
  store.set('', JSON.stringify(legacy));

  await migrateToKeyedPersistence(api);

  assert.equal(store.get('doc:p1'), JSON.stringify(legacy.docs.p1));
  assert.equal(store.get('doc:TODAY'), JSON.stringify(legacy.docs.TODAY));
  assert.equal(store.get('meta'), JSON.stringify({ enabledCtxIds: ['p1'] }));
  // Legacy entry tombstoned (empty payload).
  assert.equal(store.get(''), '');
  // Final stamp.
  assert.equal(store.get('__meta__'), JSON.stringify({ migrated: 1 }));
});

test('migration: handles a legacy blob with no enabledCtxIds', async () => {
  const { api, store } = createMockApi();
  store.set('', JSON.stringify({ docs: { p1: { type: 'doc' } } }));

  await migrateToKeyedPersistence(api);

  assert.equal(store.get('meta'), JSON.stringify({ enabledCtxIds: [] }));
  assert.equal(store.get('doc:p1'), JSON.stringify({ type: 'doc' }));
});

test('migration: refuses to tombstone a corrupt legacy blob (preserves data for recovery)', async () => {
  const { api, store, writes } = createMockApi();
  store.set('', '{not json');

  await migrateToKeyedPersistence(api);

  // Corrupt legacy stays in place; no keyed entries; no success stamp.
  assert.equal(store.get(''), '{not json');
  assert.equal(store.has('__meta__'), false);
  assert.equal(store.has('meta'), false);
  // We attempted (intent stamp) but bailed before tombstoning.
  const sawAttemptedStamp = writes.some(
    (w) =>
      w.key === '__meta__' &&
      typeof w.data === 'string' &&
      w.data.includes('"migrated":0'),
  );
  // The attempt stamp wasn't written either — we bailed BEFORE stamping
  // attempt, because parsing failed.
  assert.equal(sawAttemptedStamp, false);
});

test('migration: skips an oversized legacy doc and leaves legacy intact for recovery', async () => {
  // One context's stored doc is so big that the keyed write throws (mock
  // simulates the host's MAX_PLUGIN_DATA_SIZE check). The migration must
  // not abort the whole run — the other docs must still land — and must
  // NOT tombstone or stamp success, so a future build with a larger cap
  // (or after the user prunes the doc) can recover.
  const { store, writes } = createMockApi();
  const api = {
    persistDataSynced: async (data: string, key?: string): Promise<void> => {
      // Simulate host-side cap: throw for the oversized doc.
      if (data.length > 10_000) {
        throw new Error('Plugin data exceeds maximum size');
      }
      writes.push({ key, data });
      store.set(key ?? '', data);
    },
    loadSyncedData: async (key?: string): Promise<string | null> => {
      const v = store.get(key ?? '');
      return v === undefined ? null : v;
    },
  } as unknown as PluginAPI;
  const big = 'x'.repeat(20_000);
  store.set(
    '',
    JSON.stringify({
      docs: { small: { type: 'doc' }, big: { type: 'doc', text: big } },
      enabledCtxIds: ['small'],
    }),
  );

  await migrateToKeyedPersistence(api);

  // Small doc migrated; big doc absent.
  assert.equal(store.get('doc:small'), JSON.stringify({ type: 'doc' }));
  assert.equal(store.has('doc:big'), false);
  // Meta lands (it's small).
  assert.equal(store.get('meta'), JSON.stringify({ enabledCtxIds: ['small'] }));
  // Legacy NOT tombstoned — original bytes preserved.
  assert.equal(
    store.get(''),
    JSON.stringify({
      docs: { small: { type: 'doc' }, big: { type: 'doc', text: big } },
      enabledCtxIds: ['small'],
    }),
  );
  // Migration NOT stamped successful — next session retries.
  const stampRaw = store.get('__meta__');
  const stamp = stampRaw ? (JSON.parse(stampRaw) as { migrated: number }) : null;
  assert.notEqual(stamp?.migrated, 1);
});

test('migration: idempotent re-run after crash mid-loop', async () => {
  const { api, store } = createMockApi();
  store.set('', JSON.stringify({ docs: { p1: { type: 'doc' } }, enabledCtxIds: ['p1'] }));
  // Simulate a previous attempt that stamped intent but never reached
  // success — e.g. the iframe was torn down mid-loop.
  store.set('__meta__', JSON.stringify({ migrated: 0 }));

  await migrateToKeyedPersistence(api);

  assert.equal(store.get('doc:p1'), JSON.stringify({ type: 'doc' }));
  assert.equal(store.get('meta'), JSON.stringify({ enabledCtxIds: ['p1'] }));
  assert.equal(store.get(''), '');
  assert.equal(store.get('__meta__'), JSON.stringify({ migrated: 1 }));
});

test('migration: re-running after success is a no-op even with replayed legacy data', async () => {
  // Simulate: A migrates, B (offline, old build) replays a legacy edit on top
  // of A's tombstone, A's local stamp still says migrated:1. A must NOT
  // re-migrate (it would overwrite its keyed entries with B's older shape).
  const { api, store, writes } = createMockApi();
  store.set('__meta__', JSON.stringify({ migrated: 1 }));
  store.set('', JSON.stringify({ docs: { p1: { type: 'paragraph' } } }));
  store.set('doc:p1', JSON.stringify({ type: 'doc', content: [{ type: 'heading' }] }));

  await migrateToKeyedPersistence(api);

  assert.deepEqual(writes, []);
  assert.equal(
    store.get('doc:p1'),
    JSON.stringify({ type: 'doc', content: [{ type: 'heading' }] }),
  );
});

test('migration: stamps intent FIRST, then splits, then tombstones, then stamps success', async () => {
  // Order matters for crash recovery: the intent stamp must be the first
  // write so that a crash between "stamp" and "split" still leaves the
  // marker that says "we tried; retry on resume."
  const { api, store, writes } = createMockApi();
  store.set('', JSON.stringify({ docs: { p1: { type: 'doc' } }, enabledCtxIds: [] }));

  await migrateToKeyedPersistence(api);

  const order = writes.map((w) => w.key ?? '<legacy>');
  // First write: intent stamp.
  assert.equal(order[0], '__meta__');
  assert.match(writes[0].data, /"migrated":0/);
  // Last write: success stamp.
  assert.equal(order[order.length - 1], '__meta__');
  assert.match(writes[writes.length - 1].data, /"migrated":1/);
  // Tombstone happens before the success stamp.
  const tombstoneIdx = writes.findIndex((w) => w.key === undefined && w.data === '');
  const successIdx = writes.findIndex(
    (w, i) => w.key === '__meta__' && i > 0 && w.data.includes('"migrated":1'),
  );
  assert.ok(tombstoneIdx > 0, 'expected a tombstone write');
  assert.ok(successIdx > tombstoneIdx, 'success stamp must come after tombstone');
});

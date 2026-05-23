import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import {
  MAX_PLUGIN_DATA_SIZE,
  MIN_PLUGIN_PERSIST_INTERVAL_MS,
} from './plugin-persistence.model';
import { upsertPluginUserData, deletePluginUserData } from './store/plugin.actions';
import { selectPluginUserDataFeatureState } from './store/plugin-user-data.reducer';
import { COMPRESS_THRESHOLD, SENTINEL, encodeForPersist } from './util/plugin-data-codec';

/**
 * Drain enough microtasks for the per-entity commit chain to settle. The
 * chain is `Promise.resolve().catch().then(() => _encodeAndDispatch())` plus
 * one `await` inside _encodeAndDispatch — three turns max — but a few extra
 * yields are free and survive any future chain tweak.
 */
const drainAsync = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('PluginUserPersistenceService', () => {
  let service: PluginUserPersistenceService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PluginUserPersistenceService,
        provideMockStore({
          selectors: [{ selector: selectPluginUserDataFeatureState, value: [] }],
        }),
      ],
    });

    store = TestBed.inject(MockStore);
    service = TestBed.inject(PluginUserPersistenceService);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('persistPluginUserData', () => {
    it('should dispatch upsertPluginUserData with the raw input (below codec threshold)', async () => {
      const pluginId = 'test-plugin';
      const data = 'test data';
      await service.persistPluginUserData(pluginId, data);

      expect(dispatchSpy).toHaveBeenCalledWith(
        upsertPluginUserData({ pluginUserData: { id: pluginId, data } }),
      );
    });

    it('should dispatch compressed data when the payload is above the codec threshold', async () => {
      const pluginId = 'test-plugin';
      // ~2 KB of repetitive JSON — well above the 1 KB threshold, gzips small.
      const data = JSON.stringify({
        items: Array.from({ length: 40 }, (_, i) => ({
          id: i,
          name: `repeating-value-${i % 3}`,
        })),
      });
      expect(data.length).toBeGreaterThan(COMPRESS_THRESHOLD);

      await service.persistPluginUserData(pluginId, data);

      const dispatched = dispatchSpy.calls.mostRecent().args[0] as ReturnType<
        typeof upsertPluginUserData
      >;
      expect(dispatched.type).toBe(upsertPluginUserData.type);
      const stored = dispatched.pluginUserData.data;
      expect(stored.startsWith(SENTINEL)).toBe(true);
      expect(stored.length).toBeLessThan(data.length);
    });

    it('should throw error when data exceeds MAX_PLUGIN_DATA_SIZE', () => {
      const pluginId = 'test-plugin';
      const largeData = 'x'.repeat(MAX_PLUGIN_DATA_SIZE + 1000);

      // Size check is synchronous: throws before any async work begins.
      expect(() => service.persistPluginUserData(pluginId, largeData)).toThrowError(
        /Plugin data exceeds maximum size/,
      );
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should coalesce a rapid second call instead of dropping it', async () => {
      const baseTime = Date.now();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(baseTime));
      try {
        const pluginId = 'test-plugin';

        await service.persistPluginUserData(pluginId, 'first');
        expect(dispatchSpy).toHaveBeenCalledTimes(1);

        // A call inside the rate-limit window must not throw and must not be
        // dropped — it is held until the window opens.
        expect(() => service.persistPluginUserData(pluginId, 'second')).not.toThrow();
        expect(dispatchSpy).toHaveBeenCalledTimes(1);

        jasmine.clock().tick(MIN_PLUGIN_PERSIST_INTERVAL_MS);
        // setTimeout fires → _flushPendingData → _commit kicks off async
        // compress+dispatch. Drain microtasks to let it settle.
        await drainAsync();
        expect(dispatchSpy).toHaveBeenCalledTimes(2);
        expect(dispatchSpy).toHaveBeenCalledWith(
          upsertPluginUserData({
            pluginUserData: { id: pluginId, data: 'second' },
          }),
        );
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('should keep only the most recent of several coalesced calls', async () => {
      const baseTime = Date.now();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(baseTime));
      try {
        const pluginId = 'test-plugin';

        await service.persistPluginUserData(pluginId, 'v1');
        service.persistPluginUserData(pluginId, 'v2'); // coalesced
        service.persistPluginUserData(pluginId, 'v3'); // coalesced, replaces v2
        expect(dispatchSpy).toHaveBeenCalledTimes(1);

        jasmine.clock().tick(MIN_PLUGIN_PERSIST_INTERVAL_MS);
        await drainAsync();
        expect(dispatchSpy).toHaveBeenCalledTimes(2);
        expect(dispatchSpy).toHaveBeenCalledWith(
          upsertPluginUserData({ pluginUserData: { id: pluginId, data: 'v3' } }),
        );
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('should allow different plugins to persist data without rate limiting each other', async () => {
      const plugin1 = 'plugin-1';
      const plugin2 = 'plugin-2';
      const data = 'test data';

      await Promise.all([
        service.persistPluginUserData(plugin1, data),
        service.persistPluginUserData(plugin2, data),
      ]);

      expect(dispatchSpy).toHaveBeenCalledTimes(2);
    });

    it('should accept data at exactly MAX_PLUGIN_DATA_SIZE', () => {
      const pluginId = 'test-plugin';
      const exactLimitData = 'x'.repeat(MAX_PLUGIN_DATA_SIZE - 10);

      // The sync size check is what we care about here; the async commit
      // races with test teardown but is harmless.
      expect(() => service.persistPluginUserData(pluginId, exactLimitData)).not.toThrow();
    });

    it('should dispatch distinct ops for distinct composite ids of one plugin', async () => {
      const baseTime = Date.now();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(baseTime));
      try {
        // Two keys for the same plugin compose into distinct entity ids, so
        // they bypass each other's rate-limit window and emit two separate
        // upsert ops — the per-entity LWW guarantee Stage A is built on.
        await Promise.all([
          service.persistPluginUserData('plugin-a:doc-1', 'one'),
          service.persistPluginUserData('plugin-a:doc-2', 'two'),
        ]);

        expect(dispatchSpy).toHaveBeenCalledTimes(2);
        expect(dispatchSpy).toHaveBeenCalledWith(
          upsertPluginUserData({
            pluginUserData: { id: 'plugin-a:doc-1', data: 'one' },
          }),
        );
        expect(dispatchSpy).toHaveBeenCalledWith(
          upsertPluginUserData({
            pluginUserData: { id: 'plugin-a:doc-2', data: 'two' },
          }),
        );
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('should rate-limit each composite id independently', async () => {
      const baseTime = Date.now();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(baseTime));
      try {
        // First persist on each key dispatches immediately; second on each
        // is coalesced. After ticking the window, the coalesced writes
        // flush, giving 4 dispatches total — proving keys are not
        // serialized against one another.
        await service.persistPluginUserData('plugin-a:doc-1', 'a1');
        await service.persistPluginUserData('plugin-a:doc-2', 'b1');
        service.persistPluginUserData('plugin-a:doc-1', 'a2'); // coalesced
        service.persistPluginUserData('plugin-a:doc-2', 'b2'); // coalesced
        expect(dispatchSpy).toHaveBeenCalledTimes(2);

        jasmine.clock().tick(MIN_PLUGIN_PERSIST_INTERVAL_MS);
        await drainAsync();
        expect(dispatchSpy).toHaveBeenCalledTimes(4);
      } finally {
        jasmine.clock().uninstall();
      }
    });
  });

  describe('loadPluginUserData', () => {
    it('should decompress and return data for an existing plugin', async () => {
      const pluginId = 'test-plugin';
      const original = JSON.stringify({
        items: Array.from({ length: 40 }, (_, i) => ({
          id: i,
          name: `repeating-value-${i % 3}`,
        })),
      });
      const stored = await encodeForPersist(original);
      expect(stored.startsWith(SENTINEL)).toBe(true);

      store.overrideSelector(selectPluginUserDataFeatureState, [
        { id: pluginId, data: stored },
      ]);

      const result = await service.loadPluginUserData(pluginId);
      expect(result).toBe(original);
    });

    it('should pass through legacy uncompressed data', async () => {
      const pluginId = 'test-plugin';
      const legacy = 'stored data';

      store.overrideSelector(selectPluginUserDataFeatureState, [
        { id: pluginId, data: legacy },
      ]);

      const result = await service.loadPluginUserData(pluginId);
      expect(result).toBe(legacy);
    });

    it('should return null for non-existent plugin', async () => {
      store.overrideSelector(selectPluginUserDataFeatureState, []);

      const result = await service.loadPluginUserData('non-existent');

      expect(result).toBeNull();
    });

    it('should return a pending coalesced write before it is committed', async () => {
      const baseTime = Date.now();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(baseTime));
      try {
        const pluginId = 'test-plugin';
        store.overrideSelector(selectPluginUserDataFeatureState, [
          { id: pluginId, data: 'committed' },
        ]);

        await service.persistPluginUserData(pluginId, 'committed');
        service.persistPluginUserData(pluginId, 'pending'); // coalesced

        const result = await service.loadPluginUserData(pluginId);
        expect(result).toBe('pending');
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('should return only the matching composite id, not a sibling key', async () => {
      // Verifies that a keyed load resolves by exact entityId — no prefix
      // fallback to the legacy entry.
      store.overrideSelector(selectPluginUserDataFeatureState, [
        { id: 'plugin-a', data: 'legacy' },
        { id: 'plugin-a:doc-1', data: 'one' },
        { id: 'plugin-a:doc-2', data: 'two' },
      ]);

      expect(await service.loadPluginUserData('plugin-a')).toBe('legacy');
      expect(await service.loadPluginUserData('plugin-a:doc-1')).toBe('one');
      expect(await service.loadPluginUserData('plugin-a:doc-2')).toBe('two');
      expect(await service.loadPluginUserData('plugin-a:doc-missing')).toBeNull();
    });
  });

  describe('removePluginUserData', () => {
    it('should dispatch one delete per matching entry (legacy + keyed)', async () => {
      // Stage A Phase 3: a single uninstall of `plugin-a` must emit one
      // delete op per existing entry under that plugin's prefix, so remote
      // replicas don't keep the keyed entries after the legacy delete
      // replays. `plugin-b`'s entries must be untouched.
      store.overrideSelector(selectPluginUserDataFeatureState, [
        { id: 'plugin-a', data: 'legacy-a' },
        { id: 'plugin-a:doc-1', data: 'one' },
        { id: 'plugin-a:doc-2', data: 'two' },
        { id: 'plugin-b', data: 'legacy-b' },
        { id: 'plugin-b:doc-1', data: 'b1' },
      ]);

      await service.removePluginUserData('plugin-a');

      const deleteCalls = dispatchSpy.calls
        .allArgs()
        .filter(([action]) => action.type === deletePluginUserData.type)
        .map(([action]) => (action as ReturnType<typeof deletePluginUserData>).pluginId);

      expect(deleteCalls.sort()).toEqual(
        ['plugin-a', 'plugin-a:doc-1', 'plugin-a:doc-2'].sort(),
      );
    });

    it('should not match plugin ids that merely share a prefix', async () => {
      // 'plugin-abc' shares the literal 'plugin-a' prefix but isn't part of
      // 'plugin-a's keyspace. The `:` delimiter is what disambiguates.
      store.overrideSelector(selectPluginUserDataFeatureState, [
        { id: 'plugin-a', data: 'a' },
        { id: 'plugin-abc', data: 'abc' },
        { id: 'plugin-abc:doc', data: 'abc-doc' },
      ]);

      await service.removePluginUserData('plugin-a');

      const deleteCalls = dispatchSpy.calls
        .allArgs()
        .filter(([action]) => action.type === deletePluginUserData.type)
        .map(([action]) => (action as ReturnType<typeof deletePluginUserData>).pluginId);

      expect(deleteCalls).toEqual(['plugin-a']);
    });

    it('should be a no-op when the plugin has no entries in state', async () => {
      // No matching state means there is nothing for remote replicas to
      // resolve, so we suppress the phantom delete op the pre-Stage-A
      // implementation used to emit.
      await service.removePluginUserData('absent-plugin');

      const deleteCalls = dispatchSpy.calls
        .allArgs()
        .filter(([action]) => action.type === deletePluginUserData.type);
      expect(deleteCalls).toEqual([]);
    });

    it('should cancel a pending coalesced write across all matching keys', async () => {
      const baseTime = Date.now();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(baseTime));
      try {
        // Two keys both have committed entries (so they appear in state)
        // *and* a follow-up coalesced write. The cancel must drop both
        // coalesced writes; the deletes must still fire.
        store.overrideSelector(selectPluginUserDataFeatureState, [
          { id: 'plugin-a:doc-1', data: 'committed-1' },
          { id: 'plugin-a:doc-2', data: 'committed-2' },
        ]);
        await service.persistPluginUserData('plugin-a:doc-1', 'committed-1');
        await service.persistPluginUserData('plugin-a:doc-2', 'committed-2');
        service.persistPluginUserData('plugin-a:doc-1', 'pending-1'); // coalesced
        service.persistPluginUserData('plugin-a:doc-2', 'pending-2'); // coalesced

        // remove's sync portion cancels the pendings immediately. Its async
        // portion does: await firstValueFrom -> dispatch loop -> await
        // setTimeout(0). Drain microtasks first so the trailing setTimeout
        // is *scheduled*, then tick so it fires, then drain again so the
        // await resolves.
        const removePromise = service.removePluginUserData('plugin-a');
        await drainAsync();
        jasmine.clock().tick(MIN_PLUGIN_PERSIST_INTERVAL_MS * 2);
        await drainAsync();
        await removePromise;

        // The pending 'pending-1' / 'pending-2' coalesced writes must not
        // have resurfaced as upserts after the cancellation.
        const upsertedValues = dispatchSpy.calls
          .allArgs()
          .filter(([a]) => a.type === upsertPluginUserData.type)
          .map(
            ([a]) => (a as ReturnType<typeof upsertPluginUserData>).pluginUserData.data,
          );
        expect(upsertedValues).not.toContain('pending-1');
        expect(upsertedValues).not.toContain('pending-2');
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('should not resurrect data when removed during an in-flight commit', async () => {
      const pluginId = 'test-plugin';
      // The entry must be in state for `remove` to dispatch a delete — but
      // the resurrection guard is independent of state membership: it relies
      // on the generation counter inside _encodeAndDispatch.
      store.overrideSelector(selectPluginUserDataFeatureState, [
        { id: pluginId, data: 'previously-committed' },
      ]);
      // A payload above the codec threshold forces async compression, so
      // the commit's dispatch happens after at least one microtask turn —
      // wide enough for a synchronous remove to land in between.
      const data = 'x'.repeat(COMPRESS_THRESHOLD + 100);

      const persistPromise = service.persistPluginUserData(pluginId, data);

      // remove() runs while compression is still pending. Its synchronous
      // _cancelPendingForPlugin bumps the generation; its async portion
      // resolves after the commit's await.
      const removePromise = service.removePluginUserData(pluginId);

      await persistPromise;
      await removePromise;
      await drainAsync();

      const upsertCalls = dispatchSpy.calls
        .allArgs()
        .filter(([action]) => action.type === upsertPluginUserData.type);
      const deleteCalls = dispatchSpy.calls
        .allArgs()
        .filter(([action]) => action.type === deletePluginUserData.type);
      expect(upsertCalls.length).toBe(0);
      expect(deleteCalls.length).toBe(1);
    });
  });
});

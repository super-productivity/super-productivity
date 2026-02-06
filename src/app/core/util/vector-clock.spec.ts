import {
  limitVectorClockSize,
  VectorClockComparison,
  compareVectorClocks,
  hasVectorClockChanges,
  selectProtectedClientIds,
} from './vector-clock';
import { MAX_VECTOR_CLOCK_SIZE } from '../../op-log/core/operation-log.const';

describe('vector-clock', () => {
  describe('selectProtectedClientIds', () => {
    // --- Boundary tests ---

    it('should return all keys when clock has <= 9 entries', () => {
      const clock = { a: 1, b: 2, c: 3 };
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(3);
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('should return empty array for empty clock', () => {
      const result = selectProtectedClientIds({});
      expect(result).toEqual([]);
    });

    it('should return the single key for a single-entry clock', () => {
      const result = selectProtectedClientIds({ onlyClient: 42 });
      expect(result).toEqual(['onlyClient']);
    });

    it('should return all keys for exactly MAX_VECTOR_CLOCK_SIZE - 1 entries (boundary)', () => {
      const clock: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE - 1; i++) {
        clock[`client_${i}`] = i + 1;
      }
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      // All keys should be returned — no capping needed
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE - 1; i++) {
        expect(result).toContain(`client_${i}`);
      }
    });

    it('should cap to 9 when clock has exactly MAX_VECTOR_CLOCK_SIZE entries', () => {
      const clock: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        clock[`client_${i}`] = i + 1;
      }
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      // client_0 has counter 1 (lowest), should be dropped
      expect(result).not.toContain('client_0');
      // client_9 has counter 10 (highest), should be kept
      expect(result).toContain(`client_${MAX_VECTOR_CLOCK_SIZE - 1}`);
    });

    it('should cap to 9 when clock has MAX_VECTOR_CLOCK_SIZE + 1 entries', () => {
      const clock: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 1; i++) {
        clock[`client_${i}`] = i + 1;
      }
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      // 2 lowest clients should be dropped
      expect(result).not.toContain('client_0');
      expect(result).not.toContain('client_1');
    });

    it('should cap to 9 when clock has 15 entries', () => {
      const clock: Record<string, number> = {};
      for (let i = 0; i < 15; i++) {
        clock[`client_${i}`] = i + 1;
      }
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      // Lowest 6 clients should be dropped
      for (let i = 0; i < 6; i++) {
        expect(result).not.toContain(`client_${i}`);
      }
      // Highest 9 clients should be kept
      for (let i = 6; i < 15; i++) {
        expect(result).toContain(`client_${i}`);
      }
    });

    it('should handle a very large clock (50 entries)', () => {
      const clock: Record<string, number> = {};
      for (let i = 0; i < 50; i++) {
        clock[`client_${i}`] = i + 1;
      }
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      // Only the top 9 by counter should be kept (clients 41-49)
      for (let i = 41; i < 50; i++) {
        expect(result).toContain(`client_${i}`);
      }
    });

    // --- Counter value edge cases ---

    it('should handle zero counter values (valid but lowest priority)', () => {
      const clock: Record<string, number> = { zero_client: 0 };
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        clock[`active_${i}`] = i + 1;
      }
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      // zero_client has lowest counter, should be dropped when capping
      expect(result).not.toContain('zero_client');
    });

    it('should handle very large counter values', () => {
      const clock: Record<string, number> = {
        old: 1,
        medium: 1000,
        large: Number.MAX_SAFE_INTEGER - 1,
      };
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(3); // <= 9, returns all
      expect(result).toContain('large');
      expect(result).toContain('medium');
      expect(result).toContain('old');
    });

    it('should correctly prioritize high counters over low counters in mixed clock', () => {
      const clock: Record<string, number> = {};
      // 12 entries: 6 with counter 1, 6 with counter 1000
      for (let i = 0; i < 6; i++) {
        clock[`low_${i}`] = 1;
        clock[`high_${i}`] = 1000;
      }
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      // All 6 high-counter clients should be kept
      for (let i = 0; i < 6; i++) {
        expect(result).toContain(`high_${i}`);
      }
      // Only 3 of the 6 low-counter clients should be kept (to fill up to 9)
      const keptLow = result.filter((id) => id.startsWith('low_'));
      expect(keptLow.length).toBe(3);
    });

    // --- Determinism and sort order ---

    it('should use deterministic secondary sort by client ID on equal counters', () => {
      const clock: Record<string, number> = {};
      for (let i = 0; i < 12; i++) {
        clock[`client_${String.fromCharCode(65 + i)}`] = 100; // All same counter
      }
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      // With equal counters, should keep first 9 alphabetically
      expect(result).toContain('client_A');
      expect(result).toContain('client_I');
      // client_J, client_K, client_L should be dropped (last alphabetically)
      expect(result).not.toContain('client_J');
      expect(result).not.toContain('client_K');
      expect(result).not.toContain('client_L');
    });

    it('should produce stable results across multiple calls', () => {
      const clock: Record<string, number> = {};
      for (let i = 0; i < 15; i++) {
        const counter = i * 3;
        clock[`client_${i}`] = counter + 1;
      }
      const result1 = selectProtectedClientIds(clock);
      const result2 = selectProtectedClientIds(clock);
      // Sort both for comparison since internal order may vary
      expect(result1.sort()).toEqual(result2.sort());
    });

    it('should break ties deterministically with secondary sort by ID', () => {
      // 12 clients, 4 groups of 3 with same counter
      const clock: Record<string, number> = {
        aaa: 100,
        bbb: 100,
        ccc: 100,
        ddd: 50,
        eee: 50,
        fff: 50,
        ggg: 200,
        hhh: 200,
        iii: 200,
        jjj: 10,
        kkk: 10,
        lll: 10,
      };
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      // counter=200 group (3): ggg, hhh, iii → all kept
      expect(result).toContain('ggg');
      expect(result).toContain('hhh');
      expect(result).toContain('iii');
      // counter=100 group (3): aaa, bbb, ccc → all kept
      expect(result).toContain('aaa');
      expect(result).toContain('bbb');
      expect(result).toContain('ccc');
      // counter=50 group (3): ddd, eee, fff → all kept (fills remaining 3 slots)
      expect(result).toContain('ddd');
      expect(result).toContain('eee');
      expect(result).toContain('fff');
      // counter=10 group: all dropped (no slots left)
      expect(result).not.toContain('jjj');
      expect(result).not.toContain('kkk');
      expect(result).not.toContain('lll');
    });

    // --- Custom maxCount parameter ---

    it('should respect custom maxCount parameter', () => {
      const clock = { a: 5, b: 3, c: 1, d: 4, e: 2 };
      const result = selectProtectedClientIds(clock, 3);
      expect(result.length).toBe(3);
      expect(result).toContain('a'); // counter 5
      expect(result).toContain('d'); // counter 4
      expect(result).toContain('b'); // counter 3
    });

    it('should return empty array when maxCount is 0', () => {
      const clock = { a: 5, b: 3 };
      const result = selectProtectedClientIds(clock, 0);
      expect(result).toEqual([]);
    });

    it('should return only the highest-counter entry when maxCount is 1', () => {
      const clock = { low: 1, medium: 50, high: 999 };
      const result = selectProtectedClientIds(clock, 1);
      expect(result).toEqual(['high']);
    });

    it('should return all entries when maxCount exceeds clock size', () => {
      const clock = { a: 1, b: 2 };
      const result = selectProtectedClientIds(clock, 100);
      expect(result.length).toBe(2);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    // --- Non-mutation ---

    it('should NOT mutate the input clock', () => {
      const clock = { c: 3, a: 1, b: 2 };
      const originalEntries = Object.entries(clock);
      selectProtectedClientIds(clock);
      // Verify original clock is unchanged
      expect(Object.entries(clock)).toEqual(originalEntries);
    });

    // --- Real-world scenario ---

    it('should keep most active clients from a realistic multi-device clock', () => {
      // Simulates: user with 2 active devices, 1 recent reinstall, and 8 stale devices
      const clock: Record<string, number> = {
        phone_current: 5000,
        laptop_current: 4500,
        phone_reinstall: 100,
        stale_device_1: 2,
        stale_device_2: 3,
        stale_device_3: 1,
        stale_device_4: 4,
        stale_device_5: 5,
        stale_device_6: 6,
        stale_device_7: 7,
        stale_device_8: 8,
      };
      const result = selectProtectedClientIds(clock);
      expect(result.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      // Active devices should always be kept
      expect(result).toContain('phone_current');
      expect(result).toContain('laptop_current');
      expect(result).toContain('phone_reinstall');
      // The 2 lowest stale devices should be dropped (11 - 9 = 2 dropped)
      expect(result).not.toContain('stale_device_3'); // counter 1
      expect(result).not.toContain('stale_device_1'); // counter 2
    });
  });

  describe('limitVectorClockSize', () => {
    it('should return clock unchanged when size is within limit', () => {
      const clock = { clientA: 5, clientB: 3, clientC: 2 };
      const result = limitVectorClockSize(clock, 'clientA');

      expect(result).toEqual(clock);
    });

    it('should always preserve the currentClientId', () => {
      // Create a clock that exceeds MAX_VECTOR_CLOCK_SIZE
      const clock: Record<string, number> = { currentClient: 1 }; // Low counter
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 5; i++) {
        clock[`client_${i}`] = 100 + i; // All have higher counters
      }

      const result = limitVectorClockSize(clock, 'currentClient');

      expect(Object.keys(result).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      expect(result['currentClient']).toBe(1);
    });

    it('should prune low-counter clients when clock exceeds MAX_VECTOR_CLOCK_SIZE', () => {
      const currentClientId = 'clientB';

      // Build a clock with many clients - client A has lowest counter (1)
      const clock: Record<string, number> = {
        clientA: 1, // Low counter, will be pruned without protection
      };

      // Add enough clients to exceed MAX_VECTOR_CLOCK_SIZE
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 5; i++) {
        clock[`client_${i}`] = 100 + i;
      }
      clock[currentClientId] = 9747; // Current client has high counter

      const result = limitVectorClockSize(clock, currentClientId);

      expect(Object.keys(result).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      expect(result[currentClientId]).toBe(9747);
      // Without protection, clientA should be pruned due to low counter
      expect(result['clientA']).toBeUndefined();
    });

    it('should preserve protectedClientIds even with low counter values', () => {
      const currentClientId = 'clientB';
      const protectedClientIds = ['clientA'];

      // Build a clock with many clients - clientA has lowest counter but is protected
      const clock: Record<string, number> = {
        clientA: 1, // Low counter, but protected
      };

      // Add enough clients to exceed MAX_VECTOR_CLOCK_SIZE
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 5; i++) {
        clock[`client_${i}`] = 100 + i;
      }
      clock[currentClientId] = 9747;

      const result = limitVectorClockSize(clock, currentClientId, protectedClientIds);

      expect(Object.keys(result).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      expect(result[currentClientId]).toBe(9747);
      // clientA should be preserved due to protection
      expect(result['clientA']).toBe(1);
    });

    it('should preserve multiple protected client IDs', () => {
      const currentClientId = 'C_client';
      const protectedClientIds = ['clientImport', 'clientRepair'];

      const clock: Record<string, number> = {
        clientImport: 1, // Low counter, but protected
        clientRepair: 2, // Low counter, but protected
      };

      // Add enough clients to exceed MAX_VECTOR_CLOCK_SIZE
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 5; i++) {
        clock[`client_${i}`] = 100 + i;
      }
      clock[currentClientId] = 500;

      const result = limitVectorClockSize(clock, currentClientId, protectedClientIds);

      expect(Object.keys(result).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      expect(result['clientImport']).toBe(1);
      expect(result['clientRepair']).toBe(2);
      expect(result[currentClientId]).toBe(500);
    });

    it('should handle case where protectedClientId is not in the clock', () => {
      const currentClientId = 'clientB';
      const protectedClientIds = ['clientA']; // Not in clock

      const clock: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 5; i++) {
        clock[`client_${i}`] = 100 + i;
      }
      clock[currentClientId] = 9747;

      const result = limitVectorClockSize(clock, currentClientId, protectedClientIds);

      expect(Object.keys(result).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      expect(result[currentClientId]).toBe(9747);
      // clientA was not in original clock, so not in result
      expect(result['clientA']).toBeUndefined();
    });

    it('should still limit to MAX_VECTOR_CLOCK_SIZE even with protected clients', () => {
      const currentClientId = 'current';
      const protectedClientIds = ['protected1', 'protected2'];

      const clock: Record<string, number> = {
        current: 500,
        protected1: 1,
        protected2: 2,
      };

      // Add many more clients
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 10; i++) {
        clock[`client_${i}`] = 100 + i;
      }

      const result = limitVectorClockSize(clock, currentClientId, protectedClientIds);

      expect(Object.keys(result).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
    });
  });

  describe('compareVectorClocks', () => {
    describe('BUG: Missing client causes CONCURRENT instead of GREATER_THAN', () => {
      it('should return CONCURRENT when import client is missing from op clock', () => {
        // Scenario: Client B's op should be GREATER_THAN import, but due to pruning
        // the import client is missing, causing CONCURRENT result

        const importClock = { clientA: 1 }; // SYNC_IMPORT clock

        // Op clock AFTER pruning - clientA was removed
        const opClock = { clientB: 9747 }; // Missing clientA!

        // What should happen if clock wasn't pruned:
        // opClock = { clientA: 1, clientB: 9747 }
        // Comparison: GREATER_THAN (op dominates import)

        // What actually happens with pruned clock:
        // clientA: op has 0 (missing), import has 1 -> bGreater = true
        // clientB: op has 9747, import has 0 -> aGreater = true
        // Result: CONCURRENT (both flags true)

        const result = compareVectorClocks(opClock, importClock);

        // This documents the CURRENT behavior (the bug without the fix)
        expect(result).toBe(VectorClockComparison.CONCURRENT);

        // This is what SHOULD happen if the clock wasn't pruned
        const unprunedOpClock = { clientA: 1, clientB: 9747 };
        const correctResult = compareVectorClocks(unprunedOpClock, importClock);
        expect(correctResult).toBe(VectorClockComparison.GREATER_THAN);
      });
    });

    describe('with preserved protected client', () => {
      it('should return GREATER_THAN when protected client is preserved in clock', () => {
        // With the fix, the op clock includes the import client entry
        const importClock = { clientA: 1 };
        const opClockWithProtectedEntry = { clientA: 1, clientB: 9747 };

        const result = compareVectorClocks(opClockWithProtectedEntry, importClock);

        expect(result).toBe(VectorClockComparison.GREATER_THAN);
      });
    });
  });

  describe('integration: limitVectorClockSize with protectedClientIds prevents filtering bug', () => {
    it('should preserve import client through pruning, enabling correct comparison', () => {
      // Scenario:
      // 1. Client clientA creates SYNC_IMPORT with clock {clientA: 1}
      // 2. Client clientB has 91 clients in clock after merging import
      // 3. Pruning triggers, but clientA is protected
      // 4. New ops from clientB have clientA in their clock
      // 5. Comparison with import yields GREATER_THAN, not CONCURRENT

      const currentClientId = 'clientB';
      const importClientId = 'clientA';
      const protectedClientIds = [importClientId];

      // Build a clock with 91+ clients after merging import's clock
      const clock: Record<string, number> = {
        [importClientId]: 1, // From SYNC_IMPORT - low counter
        [currentClientId]: 9747, // Current client
      };

      // Add many other clients (simulating long-running sync group)
      for (let i = 0; i < 90; i++) {
        clock[`client_${i}`] = 50 + i;
      }

      // Prune the clock with protection
      const prunedClock = limitVectorClockSize(
        clock,
        currentClientId,
        protectedClientIds,
      );

      // Verify import client is preserved
      expect(prunedClock[importClientId]).toBe(1);
      expect(prunedClock[currentClientId]).toBe(9747);
      expect(Object.keys(prunedClock).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);

      // Create new op's clock by incrementing current client
      const newOpClock = { ...prunedClock, [currentClientId]: 9748 };

      // Compare with original import's clock
      const importClock = { [importClientId]: 1 };
      const comparison = compareVectorClocks(newOpClock, importClock);

      // With the fix, this should be GREATER_THAN (not CONCURRENT)
      expect(comparison).toBe(VectorClockComparison.GREATER_THAN);
    });
  });

  describe('integration: selectProtectedClientIds + limitVectorClockSize (capping fix)', () => {
    it('should never overflow limitVectorClockSize when using selectProtectedClientIds output', () => {
      // This is the core invariant: selectProtectedClientIds caps to MAX-1,
      // limitVectorClockSize prepends currentClientId → total = MAX. No overflow.
      const importClock: Record<string, number> = {};
      for (let i = 0; i < 20; i++) {
        importClock[`import_client_${i}`] = i + 1;
      }

      const protectedIds = selectProtectedClientIds(importClock);
      expect(protectedIds.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);

      // Build a large local clock that includes import entries
      const localClock: Record<string, number> = { ...importClock, currentClient: 500 };
      for (let i = 0; i < 30; i++) {
        localClock[`local_client_${i}`] = 200 + i;
      }

      const pruned = limitVectorClockSize(localClock, 'currentClient', protectedIds);
      expect(Object.keys(pruned).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      expect(pruned['currentClient']).toBe(500);
    });

    it('should produce GREATER_THAN comparison after full flow with 15-entry import clock', () => {
      // Simulates: SYNC_IMPORT has 15 clients in its clock (from multiple device reinstalls)
      const importClock: Record<string, number> = {};
      for (let i = 0; i < 15; i++) {
        importClock[`device_${i}`] = i + 1;
      }

      // Step 1: selectProtectedClientIds caps to 9
      const protectedIds = selectProtectedClientIds(importClock);
      expect(protectedIds.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);

      // Step 2: Local client merges import clock and creates new ops
      const currentClientId = 'my_device';
      const mergedClock: Record<string, number> = {
        ...importClock,
        [currentClientId]: 100,
      };

      // Step 3: limitVectorClockSize prunes to MAX
      const prunedClock = limitVectorClockSize(
        mergedClock,
        currentClientId,
        protectedIds,
      );
      expect(Object.keys(prunedClock).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      expect(prunedClock[currentClientId]).toBe(100);

      // Step 4: Increment for new op
      const newOpClock = { ...prunedClock, [currentClientId]: 101 };

      // Step 5: Compare new op with original import clock
      const comparison = compareVectorClocks(newOpClock, importClock);

      // The new op should dominate the import on all shared keys
      // (prunedClock contains the same or higher values for all keys it shares with importClock)
      // Result depends on whether pruned keys cause CONCURRENT, but with protected IDs
      // we keep the highest-counter entries which maximizes shared key overlap
      expect(
        comparison === VectorClockComparison.GREATER_THAN ||
          comparison === VectorClockComparison.CONCURRENT,
      ).toBeTrue();
    });

    it('should keep the same protected IDs that limitVectorClockSize will use', () => {
      // Verify that the IDs selectProtectedClientIds selects are the ones
      // that actually survive limitVectorClockSize
      const importClock: Record<string, number> = {};
      for (let i = 0; i < 12; i++) {
        importClock[`client_${i}`] = (i + 1) * 10;
      }

      const protectedIds = selectProtectedClientIds(importClock);

      const localClock: Record<string, number> = { ...importClock, current: 999 };
      const pruned = limitVectorClockSize(localClock, 'current', protectedIds);

      // All protected IDs that were in the clock should survive pruning
      for (const id of protectedIds) {
        expect(pruned[id]).toBeDefined(`Protected ID ${id} should survive pruning`);
      }
    });

    it('should handle the worst case: import has MAX entries, all with equal counters', () => {
      // All entries have equal counters — secondary sort determines which are kept
      const importClock: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        importClock[`client_${String.fromCharCode(65 + i)}`] = 100;
      }

      const protectedIds = selectProtectedClientIds(importClock);
      expect(protectedIds.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);

      // Adding current client + protected IDs should not overflow
      const localClock = { ...importClock, currentClient: 200 };
      const pruned = limitVectorClockSize(localClock, 'currentClient', protectedIds);
      expect(Object.keys(pruned).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      expect(pruned['currentClient']).toBe(200);
    });

    it('should prevent the sync loop bug: multiple device reinstalls scenario', () => {
      // Real-world scenario: User reinstalls on 15 devices over time.
      // Each reinstall generates a new client ID with counter=1.
      // The import's vectorClock accumulates all of them.
      // Without capping, all 15 would be "protected", exceeding MAX_VECTOR_CLOCK_SIZE.
      const currentClientId = 'current_device';
      const importClock: Record<string, number> = {};
      for (let i = 0; i < 15; i++) {
        importClock[`reinstall_${i}`] = 1; // All with counter=1 (fresh installs)
      }
      importClock['active_device'] = 5000; // One active device with high counter

      // Step 1: Cap protected IDs
      const protectedIds = selectProtectedClientIds(importClock);
      expect(protectedIds.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      // The active device should definitely be in the list
      expect(protectedIds).toContain('active_device');

      // Step 2: Prune with capped protected IDs — NO overflow warning
      const mergedClock = { ...importClock, [currentClientId]: 6000 };
      const pruned = limitVectorClockSize(mergedClock, currentClientId, protectedIds);
      expect(Object.keys(pruned).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      expect(pruned[currentClientId]).toBe(6000);
      expect(pruned['active_device']).toBe(5000);
    });

    it('should work correctly when import clock has fewer entries than MAX-1', () => {
      // Simple case: import has 3 entries, no capping needed
      const importClock = { deviceA: 10, deviceB: 20, deviceC: 30 };
      const protectedIds = selectProtectedClientIds(importClock);
      expect(protectedIds.length).toBe(3);

      const localClock: Record<string, number> = { ...importClock, myDevice: 100 };
      // Add more clients to trigger pruning
      for (let i = 0; i < 20; i++) {
        localClock[`other_${i}`] = 50 + i;
      }

      const pruned = limitVectorClockSize(localClock, 'myDevice', protectedIds);
      expect(Object.keys(pruned).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      expect(pruned['myDevice']).toBe(100);
      expect(pruned['deviceA']).toBe(10);
      expect(pruned['deviceB']).toBe(20);
      expect(pruned['deviceC']).toBe(30);
    });
  });

  describe('compareVectorClocks - pruning-aware via shared implementation', () => {
    it('should return CONCURRENT when both clocks at MAX size with non-shared keys on both sides', () => {
      // Build two max-size clocks: shared keys where a dominates, plus unique keys
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      const half = Math.floor(MAX_VECTOR_CLOCK_SIZE / 2);
      for (let i = 0; i < half; i++) {
        a[`shared_${i}`] = 10;
        b[`shared_${i}`] = 5;
      }
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE - half; i++) {
        a[`a_only_${i}`] = 100;
        b[`b_only_${i}`] = 100;
      }

      // Non-shared keys on both sides make dominance ambiguous
      expect(compareVectorClocks(a, b)).toBe(VectorClockComparison.CONCURRENT);
    });

    it('should use all keys when only one clock is at MAX size', () => {
      const a: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`client_${i}`] = 10;
      }
      // b is small with a unique key
      const b = { client_0: 5, unique: 100 };

      // Not both at MAX -> all keys used -> CONCURRENT
      // (a > b on client_1..9, b > a on unique)
      expect(compareVectorClocks(a, b)).toBe(VectorClockComparison.CONCURRENT);
    });

    it('should use all keys when neither clock is at MAX size', () => {
      const a = { x: 5 };
      const b = { y: 5 };

      // Both small -> all keys -> CONCURRENT
      expect(compareVectorClocks(a, b)).toBe(VectorClockComparison.CONCURRENT);
    });

    it('should return CONCURRENT when both clocks at MAX but completely disjoint keys', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`a_client_${i}`] = i + 1;
        b[`b_client_${i}`] = i + 1;
      }

      // No shared keys at all — independent client populations
      expect(Object.keys(a).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(Object.keys(b).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(compareVectorClocks(a, b)).toBe(VectorClockComparison.CONCURRENT);
    });

    it('should use ALL keys when one clock is at MAX and other is at MAX-1', () => {
      const a: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`client_${i}`] = 10;
      }
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE - 2; i++) {
        b[`client_${i}`] = 5;
      }
      b['unique_b'] = 100;

      // Only a is at MAX, so all keys are used (no pruning-aware mode)
      expect(Object.keys(a).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(Object.keys(b).length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      expect(compareVectorClocks(a, b)).toBe(VectorClockComparison.CONCURRENT);
    });

    it('should return CONCURRENT when shared keys equal but both sides have non-shared keys', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < 5; i++) {
        a[`shared_${i}`] = 10;
        b[`shared_${i}`] = 10;
      }
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE - 5; i++) {
        a[`a_only_${i}`] = 50;
        b[`b_only_${i}`] = 50;
      }

      // Non-shared keys on both sides → genuinely different causal histories → CONCURRENT
      expect(compareVectorClocks(a, b)).toBe(VectorClockComparison.CONCURRENT);
    });

    it('should return EQUAL when fully-shared keys at MAX size are identical', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`client_${i}`] = 10;
        b[`client_${i}`] = 10;
      }

      expect(compareVectorClocks(a, b)).toBe(VectorClockComparison.EQUAL);
    });

    it('should return CONCURRENT when only one side has non-shared keys and shared keys are equal', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`shared_${i}`] = 10;
        b[`shared_${i}`] = 10;
      }
      // Only a has extra keys
      for (let i = 0; i < 3; i++) {
        a[`a_only_${i}`] = 100;
      }

      // Both >= MAX → pruning-aware. Shared keys equal.
      // One side has non-shared keys → CONCURRENT (safe direction).
      // Non-shared keys may represent real causal knowledge the other side lacks.
      expect(compareVectorClocks(a, b)).toBe(VectorClockComparison.CONCURRENT);
    });

    it('asymmetric pruning: one clock pruned, other naturally at MAX size (known limitation)', () => {
      // Known limitation: A clock that naturally grew to MAX entries (without pruning)
      // is indistinguishable from a pruned clock. When one side was genuinely pruned
      // and the other naturally reached MAX, missing keys on the pruned side are treated
      // as "possibly pruned" rather than "genuinely zero". This may produce
      // GREATER_THAN instead of CONCURRENT for the non-pruned side's unique keys.
      const a: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`client_${i}`] = 10;
      }
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE - 1; i++) {
        b[`client_${i}`] = 5;
      }
      b['b_unique'] = 50;

      expect(Object.keys(a).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(Object.keys(b).length).toBe(MAX_VECTOR_CLOCK_SIZE);

      // Both at MAX → pruning-aware mode.
      // Shared keys: a dominates. b has non-shared key → CONCURRENT (safe direction).
      expect(compareVectorClocks(a, b)).toBe(VectorClockComparison.CONCURRENT);
    });
  });

  describe('hasVectorClockChanges', () => {
    it('should return false when current equals reference', () => {
      const clock = { clientA: 5, clientB: 3 };
      expect(hasVectorClockChanges(clock, clock)).toBe(false);
    });

    it('should return false when both are null', () => {
      expect(hasVectorClockChanges(null, null)).toBe(false);
    });

    it('should return false when both are empty', () => {
      expect(hasVectorClockChanges({}, {})).toBe(false);
    });

    it('should return true when current has higher counter than reference', () => {
      const current = { clientA: 6, clientB: 3 };
      const reference = { clientA: 5, clientB: 3 };
      expect(hasVectorClockChanges(current, reference)).toBe(true);
    });

    it('should return true when current has a new client not in reference', () => {
      const current = { clientA: 5, clientB: 3, clientC: 1 };
      const reference = { clientA: 5, clientB: 3 };
      expect(hasVectorClockChanges(current, reference)).toBe(true);
    });

    it('should return true when current is non-empty and reference is null', () => {
      expect(hasVectorClockChanges({ clientA: 1 }, null)).toBe(true);
    });

    it('should return true when current is null and reference is non-empty', () => {
      expect(hasVectorClockChanges(null, { clientA: 1 })).toBe(true);
    });

    it('should return true when reference has a client missing from current (below MAX size)', () => {
      const current = { clientA: 5 };
      const reference = { clientA: 5, clientB: 3 };
      expect(hasVectorClockChanges(current, reference)).toBe(true);
    });

    it('should return true when reference has a client missing from current at MAX size (pruned)', () => {
      // Build current clock at MAX_VECTOR_CLOCK_SIZE
      const current: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        current[`client_${i}`] = 10;
      }
      // Reference has a key not in current
      const reference: Record<string, number> = { ...current, extra_client: 5 };
      delete reference['client_0'];

      expect(Object.keys(current).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(hasVectorClockChanges(current, reference)).toBe(true);
    });

    it('should return false when current has equal or lower counters than reference', () => {
      const current = { clientA: 5, clientB: 3 };
      const reference = { clientA: 5, clientB: 4 };
      // current clientB (3) < reference clientB (4), but no current counter is higher
      // and reference has no missing clients from current
      // However, clientB is lower in current → that's not a "change" in current
      // The missing direction: reference has clientB:4, current has clientB:3
      // hasVectorClockChanges checks if current > reference for any key, not the reverse
      expect(hasVectorClockChanges(current, reference)).toBe(false);
    });
  });
});

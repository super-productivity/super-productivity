import {
  limitVectorClockSize,
  VectorClockComparison,
  compareVectorClocks,
} from './vector-clock';
import { MAX_VECTOR_CLOCK_SIZE } from '../../op-log/core/operation-log.const';

describe('vector-clock', () => {
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
});

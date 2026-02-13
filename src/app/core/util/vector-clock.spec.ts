import {
  limitVectorClockSize,
  VectorClockComparison,
  compareVectorClocks,
  hasVectorClockChanges,
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
        clientA: 1, // Low counter, will be pruned
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

    it('should limit to MAX_VECTOR_CLOCK_SIZE entries', () => {
      const currentClientId = 'current';

      const clock: Record<string, number> = {
        current: 500,
      };

      // Add many more clients
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 10; i++) {
        clock[`client_${i}`] = 100 + i;
      }

      const result = limitVectorClockSize(clock, currentClientId);

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

    describe('with preserved client entry', () => {
      it('should return GREATER_THAN when client entry is preserved in clock', () => {
        const importClock = { clientA: 1 };
        const opClockWithEntry = { clientA: 1, clientB: 9747 };

        const result = compareVectorClocks(opClockWithEntry, importClock);

        expect(result).toBe(VectorClockComparison.GREATER_THAN);
      });
    });
  });

  describe('compareVectorClocks - standard comparison via shared implementation', () => {
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
      // (a > b on client_1..29, b > a on unique)
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

      // Only a is at MAX, so all keys are used
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

    it('should return GREATER_THAN when one side exceeds MAX (never pruned) with extra keys', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`shared_${i}`] = 10;
        b[`shared_${i}`] = 10;
      }
      // Only a has extra keys → a has MORE than MAX entries, so was never pruned
      for (let i = 0; i < 3; i++) {
        a[`a_only_${i}`] = 100;
      }

      // a > MAX entries → not possibly pruned → normal comparison mode.
      // a has all of b's keys with equal values PLUS extra keys with values > 0.
      // Result: GREATER_THAN (a dominates b).
      expect(compareVectorClocks(a, b)).toBe(VectorClockComparison.GREATER_THAN);
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

      // Both at MAX with different unique keys → CONCURRENT.
      // Shared keys: a dominates. b has non-shared key → CONCURRENT (safe direction).
      expect(compareVectorClocks(a, b)).toBe(VectorClockComparison.CONCURRENT);
    });
  });

  describe('compareVectorClocks - null/empty parity with shared implementation', () => {
    it('should return EQUAL for {} vs {a: 0} (parity with shared impl)', () => {
      // Regression: client previously returned LESS_THAN due to isVectorClockEmpty short-circuit.
      // Shared impl treats missing keys as 0, so {} and {a: 0} are EQUAL.
      expect(compareVectorClocks({}, { a: 0 })).toBe(VectorClockComparison.EQUAL);
    });

    it('should return EQUAL for {a: 0} vs {}', () => {
      expect(compareVectorClocks({ a: 0 }, {})).toBe(VectorClockComparison.EQUAL);
    });

    it('should return EQUAL for null vs {}', () => {
      expect(compareVectorClocks(null, {})).toBe(VectorClockComparison.EQUAL);
    });

    it('should return EQUAL for undefined vs {}', () => {
      expect(compareVectorClocks(undefined, {})).toBe(VectorClockComparison.EQUAL);
    });

    it('should return EQUAL for null vs null', () => {
      expect(compareVectorClocks(null, null)).toBe(VectorClockComparison.EQUAL);
    });

    it('should return LESS_THAN for null vs {a: 1}', () => {
      expect(compareVectorClocks(null, { a: 1 })).toBe(VectorClockComparison.LESS_THAN);
    });

    it('should return GREATER_THAN for {a: 1} vs null', () => {
      expect(compareVectorClocks({ a: 1 }, null)).toBe(
        VectorClockComparison.GREATER_THAN,
      );
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

    it('should return true when reference has a client missing from current', () => {
      const current = { clientA: 5 };
      const reference = { clientA: 5, clientB: 3 };
      expect(hasVectorClockChanges(current, reference)).toBe(true);
    });

    it('should return true when reference has a client missing from current at MAX size', () => {
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

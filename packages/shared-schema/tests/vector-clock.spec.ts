import { describe, it, expect } from 'vitest';
import {
  compareVectorClocks,
  mergeVectorClocks,
  limitVectorClockSize,
  MAX_VECTOR_CLOCK_SIZE,
} from '../src/vector-clock';

describe('compareVectorClocks', () => {
  describe('basic cases', () => {
    it('should return EQUAL for identical clocks', () => {
      const clock = { a: 1, b: 2 };
      expect(compareVectorClocks(clock, clock)).toBe('EQUAL');
    });

    it('should return EQUAL for two empty clocks', () => {
      expect(compareVectorClocks({}, {})).toBe('EQUAL');
    });

    it('should return LESS_THAN when a is strictly behind b', () => {
      const a = { x: 1, y: 2 };
      const b = { x: 2, y: 3 };
      expect(compareVectorClocks(a, b)).toBe('LESS_THAN');
    });

    it('should return GREATER_THAN when a is strictly ahead of b', () => {
      const a = { x: 5, y: 10 };
      const b = { x: 3, y: 7 };
      expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');
    });

    it('should return CONCURRENT when neither dominates', () => {
      const a = { x: 3, y: 1 };
      const b = { x: 1, y: 3 };
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should return LESS_THAN when a has subset of keys (missing key = 0)', () => {
      const a = { x: 1 };
      const b = { x: 1, y: 2 };
      expect(compareVectorClocks(a, b)).toBe('LESS_THAN');
    });

    it('should return GREATER_THAN when a has superset of keys', () => {
      const a = { x: 1, y: 2 };
      const b = { x: 1 };
      expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');
    });
  });

  describe('pruning-aware mode', () => {
    const buildMaxClock = (prefix: string, startVal: number): Record<string, number> => {
      const clock: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        clock[`${prefix}_${i}`] = startVal + i;
      }
      return clock;
    };

    it('should return CONCURRENT when both clocks at MAX and both have non-shared keys', () => {
      // Build two max-size clocks with some shared and some unique keys
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};

      // 5 shared keys where a dominates
      for (let i = 0; i < 5; i++) {
        a[`shared_${i}`] = 10;
        b[`shared_${i}`] = 5;
      }
      // Fill remaining slots with unique keys
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE - 5; i++) {
        a[`a_only_${i}`] = 100;
        b[`b_only_${i}`] = 100;
      }

      // Even though shared keys show a dominance, non-shared keys on both sides
      // mean we can't safely declare dominance.
      expect(Object.keys(a).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(Object.keys(b).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should return CONCURRENT when shared keys are equal but both sides have non-shared keys', () => {
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

      // Non-shared keys on both sides prove genuinely different causal histories
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should return CONCURRENT when shared keys are genuinely concurrent', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};

      // Shared keys where a wins some, b wins others
      for (let i = 0; i < 3; i++) {
        a[`shared_a_wins_${i}`] = 10;
        b[`shared_a_wins_${i}`] = 5;
      }
      for (let i = 0; i < 3; i++) {
        a[`shared_b_wins_${i}`] = 5;
        b[`shared_b_wins_${i}`] = 10;
      }
      // Fill remaining with unique keys
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE - 6; i++) {
        a[`a_only_${i}`] = 100;
        b[`b_only_${i}`] = 100;
      }

      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should use ALL keys when only one clock is at MAX_VECTOR_CLOCK_SIZE', () => {
      const a: Record<string, number> = {};
      // a has MAX keys
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`client_${i}`] = 10;
      }
      // b has fewer keys, with one key not in a
      const b: Record<string, number> = { client_0: 5, extra_client: 100 };

      // Since only a is at MAX, all keys are used
      // a has client_0..client_9 at 10, extra_client at 0 (missing)
      // b has client_0 at 5, extra_client at 100, client_1..9 at 0
      // a > b on client_0..9, b > a on extra_client => CONCURRENT
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should use ALL keys when neither clock is at MAX_VECTOR_CLOCK_SIZE', () => {
      const a = { x: 5 };
      const b = { y: 5 };

      // Both small clocks, all keys used
      // a: x=5, y=0 -> aGreater on x
      // b: x=0, y=5 -> bGreater on y
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should return CONCURRENT when both clocks at MAX but completely disjoint keys', () => {
      const a = buildMaxClock('a_client', 1);
      const b = buildMaxClock('b_client', 1);

      // No shared keys at all — independent client populations
      expect(Object.keys(a).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(Object.keys(b).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should use ALL keys when one clock is at MAX and other is at MAX-1', () => {
      // a has exactly MAX entries
      const a: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`client_${i}`] = 10;
      }
      // b has MAX-1 entries with one unique key
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE - 2; i++) {
        b[`client_${i}`] = 5;
      }
      b['unique_b'] = 100;

      // Only a is at MAX, so all keys are used (no pruning-aware mode)
      // a > b on shared client keys, b > a on unique_b => CONCURRENT
      expect(Object.keys(a).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(Object.keys(b).length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should return CONCURRENT when both clocks exceed MAX and both have non-shared keys', () => {
      // This tests the >= condition — clocks larger than MAX (e.g., from merge before pruning)
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < 3; i++) {
        a[`shared_${i}`] = 10;
        b[`shared_${i}`] = 5;
      }
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`a_only_${i}`] = 100;
        b[`b_only_${i}`] = 100;
      }

      // Both exceed MAX with unique keys on both sides → cannot safely declare dominance
      expect(Object.keys(a).length).toBeGreaterThan(MAX_VECTOR_CLOCK_SIZE);
      expect(Object.keys(b).length).toBeGreaterThan(MAX_VECTOR_CLOCK_SIZE);
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should return EQUAL when fully-shared keys at MAX size are identical', () => {
      // Both clocks have the exact same keys — no non-shared keys
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`client_${i}`] = 10;
        b[`client_${i}`] = 10;
      }

      expect(Object.keys(a).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(Object.keys(b).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(compareVectorClocks(a, b)).toBe('EQUAL');
    });

    it('should preserve shared-key result when only one side has non-shared keys', () => {
      // a has all of b's keys plus extras, shared keys show a dominates
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`shared_${i}`] = 10;
        b[`shared_${i}`] = 5;
      }
      // Only a has extra keys (b has none unique)
      for (let i = 0; i < 3; i++) {
        a[`a_only_${i}`] = 100;
      }
      // b needs to reach MAX size too for pruning-aware mode
      // Since b already has MAX_VECTOR_CLOCK_SIZE shared keys, it's at MAX
      // a has MAX + 3 keys

      expect(Object.keys(a).length).toBeGreaterThan(MAX_VECTOR_CLOCK_SIZE);
      expect(Object.keys(b).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      // Both >= MAX → pruning-aware mode. Shared keys: a dominates.
      // Only a has non-shared keys (bOnlyCount=0), so no escalation to CONCURRENT.
      expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');
    });

    it('should return LESS_THAN when only b side has non-shared keys and shared keys show b dominates', () => {
      // Symmetric case of the GREATER_THAN test above: b dominates on shared keys,
      // only b has non-shared keys (aOnlyCount=0), so no escalation to CONCURRENT.
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`shared_${i}`] = 5;
        b[`shared_${i}`] = 10;
      }
      // Only b has extra keys
      for (let i = 0; i < 3; i++) {
        b[`b_only_${i}`] = 100;
      }

      expect(Object.keys(a).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(Object.keys(b).length).toBeGreaterThan(MAX_VECTOR_CLOCK_SIZE);
      // Both >= MAX → pruning-aware mode. Shared keys: b dominates.
      // Only b has non-shared keys (aOnlyCount=0), so no escalation to CONCURRENT.
      expect(compareVectorClocks(a, b)).toBe('LESS_THAN');
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
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('asymmetric pruning: one clock pruned, other naturally at MAX size (known limitation)', () => {
      // Known limitation: A clock that naturally grew to MAX entries (without pruning)
      // is indistinguishable from a pruned clock. When one side was genuinely pruned
      // and the other naturally reached MAX, missing keys on the pruned side are treated
      // as "possibly pruned" rather than "genuinely zero". This may produce
      // GREATER_THAN instead of CONCURRENT for the non-pruned side's unique keys.

      // Clock A: naturally has exactly MAX active clients (no pruning occurred)
      const a: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`client_${i}`] = 10;
      }

      // Clock B: was pruned to MAX, shares most keys but has one unique key
      // (replacing client_9 with b_unique simulates pruning that dropped client_9
      // and kept a different client)
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE - 1; i++) {
        b[`client_${i}`] = 5;
      }
      b['b_unique'] = 50;

      expect(Object.keys(a).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(Object.keys(b).length).toBe(MAX_VECTOR_CLOCK_SIZE);

      // Both at MAX → pruning-aware mode.
      // Shared keys: a dominates (10 > 5 for client_0..client_8).
      // b has non-shared key b_unique → escalated to CONCURRENT.
      // This is the safe direction: LWW conflict resolution will handle it.
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });
  });
});

describe('limitVectorClockSize', () => {
  it('should return unchanged when within limit', () => {
    const clock = { a: 1, b: 2, c: 3 };
    const result = limitVectorClockSize(clock);
    expect(result).toBe(clock); // Same reference
  });

  it('should return unchanged when exactly at limit', () => {
    const clock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
      clock[`client_${i}`] = i + 1;
    }
    const result = limitVectorClockSize(clock);
    expect(result).toBe(clock);
  });

  it('should prune to MAX keeping highest-counter clients', () => {
    const clock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 5; i++) {
      clock[`client_${i}`] = i + 1;
    }

    const result = limitVectorClockSize(clock);
    expect(Object.keys(result).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // The lowest-counter clients should be pruned
    // client_0 (1), client_1 (2), ..., client_4 (5) should be pruned
    for (let i = 0; i < 5; i++) {
      expect(result[`client_${i}`]).toBeUndefined();
    }
    // Higher-counter clients should be kept
    for (let i = 5; i < MAX_VECTOR_CLOCK_SIZE + 5; i++) {
      expect(result[`client_${i}`]).toBe(i + 1);
    }
  });

  it('should preserve specified client IDs even with low counters', () => {
    const clock: Record<string, number> = { lowClient: 1 };
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 5; i++) {
      clock[`high_${i}`] = 100 + i;
    }

    const result = limitVectorClockSize(clock, ['lowClient']);
    expect(Object.keys(result).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    expect(result['lowClient']).toBe(1);
  });

  it('should handle empty preserveClientIds', () => {
    const clock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 3; i++) {
      clock[`client_${i}`] = i + 1;
    }

    const result = limitVectorClockSize(clock, []);
    expect(Object.keys(result).length).toBe(MAX_VECTOR_CLOCK_SIZE);
  });

  it('should handle preserveClientIds not present in clock', () => {
    const clock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 3; i++) {
      clock[`client_${i}`] = i + 1;
    }

    const result = limitVectorClockSize(clock, ['nonexistent']);
    expect(Object.keys(result).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    expect(result['nonexistent']).toBeUndefined();
  });

  it('should cap at MAX_VECTOR_CLOCK_SIZE even when preserveClientIds exceeds MAX', () => {
    // Build a clock with many entries including 15 "preserved" clients
    const clock: Record<string, number> = {};
    const preserveIds: string[] = [];
    for (let i = 0; i < 15; i++) {
      const id = `preserved_${i}`;
      clock[id] = i + 1;
      preserveIds.push(id);
    }
    // Add more clients with higher counters
    for (let i = 0; i < 20; i++) {
      clock[`high_${i}`] = 200 + i;
    }

    const result = limitVectorClockSize(clock, preserveIds);
    expect(Object.keys(result).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // Only the first MAX_VECTOR_CLOCK_SIZE preserved IDs should be kept
    // (Set insertion order determines which ones)
    let preservedCount = 0;
    for (const id of preserveIds) {
      if (result[id] !== undefined) {
        preservedCount++;
      }
    }
    expect(preservedCount).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
  });
});

describe('mergeVectorClocks', () => {
  it('should merge by taking max of each key', () => {
    const a = { x: 3, y: 1 };
    const b = { x: 1, y: 5 };
    expect(mergeVectorClocks(a, b)).toEqual({ x: 3, y: 5 });
  });

  it('should include keys only present in one clock', () => {
    const a = { x: 3 };
    const b = { y: 5 };
    expect(mergeVectorClocks(a, b)).toEqual({ x: 3, y: 5 });
  });

  it('should handle one empty clock', () => {
    const a = { x: 3, y: 1 };
    expect(mergeVectorClocks(a, {})).toEqual({ x: 3, y: 1 });
    expect(mergeVectorClocks({}, a)).toEqual({ x: 3, y: 1 });
  });

  it('should handle both empty clocks', () => {
    expect(mergeVectorClocks({}, {})).toEqual({});
  });
});

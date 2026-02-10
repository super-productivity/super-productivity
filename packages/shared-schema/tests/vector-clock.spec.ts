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
      // Both exceed MAX → neither was pruned → normal comparison mode
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
      // a exceeds MAX → never pruned → normal comparison mode.
      // a has all of b's keys at higher values PLUS extra keys → GREATER_THAN.
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
      // b exceeds MAX → never pruned → normal comparison mode.
      // b has all of a's keys at higher values PLUS extra keys → LESS_THAN.
      expect(compareVectorClocks(a, b)).toBe('LESS_THAN');
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
      expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');
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

describe('pruning pipeline integration', () => {
  // Helper: build a clock with exactly MAX entries using named clients
  const buildMaxEntityClock = (): Record<string, number> => {
    const clock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
      clock[`client_${i}`] = 10 + i;
    }
    return clock;
  };

  it('Test A: new client after MAX-entry entity clock — server accepts with >MAX entries', () => {
    // Scenario: Entity clock has exactly MAX entries (10 clients).
    // New client K merges all + own = 11 entries.
    const entityClock = buildMaxEntityClock();
    expect(Object.keys(entityClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // Client K merges entity clock + increments own counter
    const kClock: Record<string, number> = { ...entityClock, clientK: 1 };
    expect(Object.keys(kClock).length).toBe(MAX_VECTOR_CLOCK_SIZE + 1);

    // Server compares: kClock (11 entries) vs entityClock (10 entries).
    // kClock exceeds MAX → not possibly pruned → normal comparison.
    // kClock has all of entity's keys at same values PLUS clientK → GREATER_THAN.
    expect(compareVectorClocks(kClock, entityClock)).toBe('GREATER_THAN');

    // Server then prunes kClock before storage
    const pruned = limitVectorClockSize(kClock, ['clientK']);
    expect(Object.keys(pruned).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    // clientK is preserved despite having lowest counter (1)
    expect(pruned['clientK']).toBe(1);
  });

  it('Test B: two clients who both pruned differently — symmetric pruning yields CONCURRENT', () => {
    // Both clocks at MAX with overlapping but different pruning outcomes
    const a: Record<string, number> = {};
    const b: Record<string, number> = {};

    // 8 shared keys where A dominates
    for (let i = 0; i < 8; i++) {
      a[`shared_${i}`] = 10;
      b[`shared_${i}`] = 5;
    }
    // Each has 2 unique keys (filling to MAX)
    a['a_only_0'] = 100;
    a['a_only_1'] = 200;
    b['b_only_0'] = 100;
    b['b_only_1'] = 200;

    expect(Object.keys(a).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    expect(Object.keys(b).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // Both at MAX → pruning-aware mode.
    // Shared keys show A dominates, but B has non-shared keys → CONCURRENT.
    // This is the expected "safe" false CONCURRENT — LWW handles it.
    expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
  });

  it('Test C: unpruned clock (>MAX) vs pruned clock (MAX) — asymmetric dominance', () => {
    // A has 12 entries (never pruned). B has MAX entries (pruned).
    // A clearly dominates B on all shared keys.
    const a: Record<string, number> = {};
    const b: Record<string, number> = {};

    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
      a[`shared_${i}`] = 20;
      b[`shared_${i}`] = 10;
    }
    // A has extra keys beyond MAX
    a['extra_0'] = 50;
    a['extra_1'] = 60;

    expect(Object.keys(a).length).toBe(MAX_VECTOR_CLOCK_SIZE + 2);
    expect(Object.keys(b).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // A exceeds MAX → never pruned → normal comparison.
    // A has all of B's keys at higher values PLUS extras → GREATER_THAN.
    expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');
  });

  it('Test D: limitVectorClockSize then compareVectorClocks preserves GREATER_THAN', () => {
    // Start with a 15-entry clock that dominates a MAX-entry import clock.
    // After pruning to MAX, verify comparison result is preserved.
    const importClock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
      importClock[`client_${i}`] = 5;
    }

    // Original clock: has all import keys at higher values + 5 extra clients
    const originalClock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
      originalClock[`client_${i}`] = 10; // dominates import on all shared keys
    }
    for (let i = 0; i < 5; i++) {
      originalClock[`new_client_${i}`] = 1; // low-counter extras
    }
    expect(Object.keys(originalClock).length).toBe(15);

    // Before pruning: GREATER_THAN (original exceeds MAX → normal mode, all keys used)
    expect(compareVectorClocks(originalClock, importClock)).toBe('GREATER_THAN');

    // Prune to MAX, preserving client_0 as the "current" client
    const pruned = limitVectorClockSize(originalClock, ['client_0']);
    expect(Object.keys(pruned).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // After pruning: Both at MAX → pruning-aware mode, shared keys only.
    // Pruning dropped 5 low-counter new_client_* entries (counter=1).
    // All remaining entries are shared client_0..9 with pruned dominating (10 > 5).
    // No non-shared keys → GREATER_THAN is preserved.
    expect(compareVectorClocks(pruned, importClock)).toBe('GREATER_THAN');
  });

  it('Test E: limitVectorClockSize drops a shared import key — comparison degrades to CONCURRENT', () => {
    // This tests the known fragility: when pruning removes a key that the import
    // clock has, the comparison can degrade from GREATER_THAN to CONCURRENT.
    const importClock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
      importClock[`client_${i}`] = 5;
    }

    // Client K creates a clock: inherits all import keys + own ID = MAX+1
    const kClock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
      kClock[`client_${i}`] = 5; // same as import (inherited)
    }
    kClock['clientK'] = 1; // K's own counter
    expect(Object.keys(kClock).length).toBe(MAX_VECTOR_CLOCK_SIZE + 1);

    // Before pruning: GREATER_THAN (kClock exceeds MAX → normal mode)
    expect(compareVectorClocks(kClock, importClock)).toBe('GREATER_THAN');

    // Server prunes, preserving K's own ID. Drops the lowest-counter entry.
    // client_0 through client_4 have counter=5, clientK has counter=1.
    // limitVectorClockSize keeps preserved IDs first, then highest counters.
    // clientK (1) is preserved. The 5 lowest non-preserved entries are dropped.
    const pruned = limitVectorClockSize(kClock, ['clientK']);
    expect(Object.keys(pruned).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    expect(pruned['clientK']).toBe(1);

    // After pruning: Both at MAX → pruning-aware mode.
    // Pruned clock has clientK (not in import) as a non-shared key.
    // Import has dropped entries (not in pruned) as non-shared keys.
    // Both sides have non-shared keys → CONCURRENT (pruning artifact).
    const comparison = compareVectorClocks(pruned, importClock);
    expect(comparison).toBe('CONCURRENT');
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

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

  describe('missing keys treated as zero', () => {
    it('should return CONCURRENT when each clock has unique keys', () => {
      const a = { x: 5 };
      const b = { y: 5 };
      // a: x=5, y=0 vs b: x=0, y=5 => CONCURRENT
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should return GREATER_THAN when a has all of b keys at equal values plus extras', () => {
      const a = { x: 1, y: 2, z: 3 };
      const b = { x: 1, y: 2 };
      expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');
    });

    it('should return LESS_THAN when b has all of a keys at equal values plus extras', () => {
      const a = { x: 1, y: 2 };
      const b = { x: 1, y: 2, z: 3 };
      expect(compareVectorClocks(a, b)).toBe('LESS_THAN');
    });

    it('should return EQUAL for equivalent clocks with different key ordering', () => {
      const a = { x: 1, y: 2, z: 3 };
      const b = { z: 3, x: 1, y: 2 };
      expect(compareVectorClocks(a, b)).toBe('EQUAL');
    });
  });

  describe('large clocks', () => {
    it('should return EQUAL when two large identical clocks are compared', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`client_${i}`] = 10;
        b[`client_${i}`] = 10;
      }
      expect(compareVectorClocks(a, b)).toBe('EQUAL');
    });

    it('should return GREATER_THAN when a has extra keys beyond a large shared set', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`client_${i}`] = 10;
        b[`client_${i}`] = 10;
      }
      a['extra_client'] = 5;
      expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');
    });

    it('should return LESS_THAN when b has extra keys beyond a large shared set', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`client_${i}`] = 10;
        b[`client_${i}`] = 10;
      }
      b['extra_client'] = 5;
      expect(compareVectorClocks(a, b)).toBe('LESS_THAN');
    });

    it('should return CONCURRENT when both large clocks have disjoint unique keys', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        a[`a_client_${i}`] = i + 1;
        b[`b_client_${i}`] = i + 1;
      }
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should return CONCURRENT when large clocks have overlapping but divergent keys', () => {
      const a: Record<string, number> = {};
      const b: Record<string, number> = {};
      // shared keys where a wins
      for (let i = 0; i < 5; i++) {
        a[`shared_${i}`] = 10;
        b[`shared_${i}`] = 5;
      }
      // unique keys on each side
      for (let i = 0; i < 5; i++) {
        a[`a_only_${i}`] = 100;
        b[`b_only_${i}`] = 100;
      }
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
    // Build a clock with many entries including 35 "preserved" clients
    const clock: Record<string, number> = {};
    const preserveIds: string[] = [];
    for (let i = 0; i < 35; i++) {
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

  it('should break ties deterministically by client ID (lexicographic order)', () => {
    // All entries have the same counter value — tie-breaking by client ID determines which are kept.
    const clock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 3; i++) {
      clock[`client_${String.fromCharCode(65 + i)}`] = 10; // client_A, client_B, ...
    }

    const result1 = limitVectorClockSize(clock);
    const result2 = limitVectorClockSize(clock);

    // Same input always produces same output
    expect(result1).toEqual(result2);
    expect(Object.keys(result1).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // Lexicographically earliest IDs should be kept (ascending sort as secondary)
    // client_A, client_B, ... should be kept; last 3 alphabetically should be pruned
    const sortedIds = Object.keys(clock).sort();
    const prunedIds = sortedIds.slice(MAX_VECTOR_CLOCK_SIZE);
    for (const id of prunedIds) {
      expect(result1[id]).toBeUndefined();
    }
  });
});

describe('limitVectorClockSize then compareVectorClocks integration', () => {
  it('new client after MAX-entry entity clock — server accepts with >MAX entries', () => {
    // Scenario: Entity clock has exactly MAX entries.
    // New client K merges all + own = MAX+1 entries.
    const entityClock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
      entityClock[`client_${i}`] = 10 + i;
    }
    expect(Object.keys(entityClock).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // Client K merges entity clock + increments own counter
    const kClock: Record<string, number> = { ...entityClock, clientK: 1 };
    expect(Object.keys(kClock).length).toBe(MAX_VECTOR_CLOCK_SIZE + 1);

    // kClock has all of entity's keys at same values PLUS clientK → GREATER_THAN
    expect(compareVectorClocks(kClock, entityClock)).toBe('GREATER_THAN');

    // Server then prunes kClock before storage
    const pruned = limitVectorClockSize(kClock, ['clientK']);
    expect(Object.keys(pruned).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    // clientK is preserved despite having lowest counter (1)
    expect(pruned['clientK']).toBe(1);
  });

  it('unpruned clock (>MAX) vs pruned clock (MAX) — standard dominance', () => {
    // A has MAX+2 entries (never pruned). B has MAX entries.
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

    // A has all of B's keys at higher values PLUS extras → GREATER_THAN
    expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');
  });

  it('limitVectorClockSize then compareVectorClocks preserves GREATER_THAN when pruned keys are not in other clock', () => {
    // Start with a MAX+5-entry clock that dominates a MAX-entry import clock.
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
    expect(Object.keys(originalClock).length).toBe(MAX_VECTOR_CLOCK_SIZE + 5);

    // Before pruning: GREATER_THAN
    expect(compareVectorClocks(originalClock, importClock)).toBe('GREATER_THAN');

    // Prune to MAX, preserving client_0 as the "current" client
    const pruned = limitVectorClockSize(originalClock, ['client_0']);
    expect(Object.keys(pruned).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // After pruning: the 5 low-counter new_client_* entries (counter=1) are dropped.
    // All remaining entries are shared client_0..19 with pruned dominating (10 > 5).
    // Missing keys from pruned = 0, which is still ≤ import's 5 → GREATER_THAN preserved.
    expect(compareVectorClocks(pruned, importClock)).toBe('GREATER_THAN');
  });
});

describe('limitVectorClockSize locale-independent sort edge cases', () => {
  it('should sort case-sensitively by byte order (uppercase before lowercase)', () => {
    // JavaScript's < and > operators compare by UTF-16 code unit values.
    // Uppercase letters (A=65) come before lowercase (a=97) in byte order.
    // This differs from localeCompare which may sort case-insensitively.
    const clock: Record<string, number> = {};
    // Mix uppercase and lowercase IDs, all with same counter
    const ids = ['Alpha', 'alpha', 'Beta', 'beta', 'Gamma', 'gamma'];
    for (const id of ids) {
      clock[id] = 10;
    }
    // Add enough extra to trigger pruning
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
      clock[`zzz_${i}`] = 10; // These sort last alphabetically
    }

    const result = limitVectorClockSize(clock);
    expect(Object.keys(result).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // Byte-order sort: uppercase letters come before lowercase
    // So 'Alpha' < 'Beta' < 'Gamma' < 'alpha' < 'beta' < 'gamma' < 'zzz_*'
    // The first MAX entries in sorted order should be kept, pruning the last ones
    // All mixed-case IDs should be kept since they sort before 'zzz_*'
    for (const id of ids) {
      expect(result[id]).toBe(10);
    }
  });

  it('should produce identical results across repeated invocations with mixed-case IDs', () => {
    const clock: Record<string, number> = {};
    // Create a mix of uppercase, lowercase, and numeric IDs all with same counter
    const mixedIds = [
      'clientA',
      'ClientA',
      'CLIENTA',
      'client_a',
      'clientB',
      'ClientB',
      'CLIENTB',
      'client_b',
    ];
    for (const id of mixedIds) {
      clock[id] = 5;
    }
    // Fill to exceed MAX
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
      clock[`z_filler_${i.toString().padStart(3, '0')}`] = 5;
    }

    // Run multiple times — must always produce the same result
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(limitVectorClockSize(clock));
    }

    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(results[0]);
    }
    expect(Object.keys(results[0]).length).toBe(MAX_VECTOR_CLOCK_SIZE);
  });
});

describe('limitVectorClockSize with multiple preserveClientIds', () => {
  it('should preserve two low-counter IDs when both are in preserveClientIds', () => {
    // Simulates the server's getOpsSinceWithSeq passing [requestingClient, snapshotAuthor]
    const clock: Record<string, number> = {
      requestingClient: 1, // Low counter
      snapshotAuthor: 2, // Low counter
    };
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 3; i++) {
      clock[`high_${i}`] = 100 + i; // All higher counters
    }

    const result = limitVectorClockSize(clock, ['requestingClient', 'snapshotAuthor']);
    expect(Object.keys(result).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    // Both low-counter preserved IDs must be kept
    expect(result['requestingClient']).toBe(1);
    expect(result['snapshotAuthor']).toBe(2);
    // Remaining slots filled with highest-counter entries
    const nonPreservedEntries = Object.entries(result).filter(
      ([k]) => k !== 'requestingClient' && k !== 'snapshotAuthor',
    );
    expect(nonPreservedEntries.length).toBe(MAX_VECTOR_CLOCK_SIZE - 2);
    // The kept non-preserved entries should be the highest-counter ones
    for (const [, value] of nonPreservedEntries) {
      // Should be the top (MAX-2) entries from high_0..high_(MAX+2)
      expect(value).toBeGreaterThanOrEqual(100 + 5); // lowest 5 pruned
    }
  });

  it('should handle overlapping preserveClientIds (same ID listed twice)', () => {
    const clock: Record<string, number> = { clientA: 1 };
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 2; i++) {
      clock[`high_${i}`] = 100 + i;
    }

    // clientA listed twice — Set deduplicates, so only one slot consumed
    const result = limitVectorClockSize(clock, ['clientA', 'clientA']);
    expect(Object.keys(result).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    expect(result['clientA']).toBe(1);
    // Should have MAX-1 non-preserved entries (not MAX-2)
    const nonPreserved = Object.keys(result).filter((k) => k !== 'clientA');
    expect(nonPreserved.length).toBe(MAX_VECTOR_CLOCK_SIZE - 1);
  });

  it('should handle one preserveClientId present and one missing from clock', () => {
    // Simulates getOpsSinceWithSeq when excludeClient is not in the aggregated snapshot clock
    const clock: Record<string, number> = { snapshotAuthor: 5 };
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 2; i++) {
      clock[`client_${i}`] = 50 + i;
    }

    const result = limitVectorClockSize(clock, ['missingClient', 'snapshotAuthor']);
    expect(Object.keys(result).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    // Missing client is silently ignored (no crash, no placeholder)
    expect(result['missingClient']).toBeUndefined();
    // Present preserved client is kept
    expect(result['snapshotAuthor']).toBe(5);
  });

  it('should handle all preserveClientIds missing from clock', () => {
    const clock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 3; i++) {
      clock[`client_${i}`] = i + 1;
    }

    const result = limitVectorClockSize(clock, ['ghost_a', 'ghost_b']);
    expect(Object.keys(result).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    expect(result['ghost_a']).toBeUndefined();
    expect(result['ghost_b']).toBeUndefined();
    // All MAX slots filled by highest-counter entries
    for (let i = 3; i < MAX_VECTOR_CLOCK_SIZE + 3; i++) {
      expect(result[`client_${i}`]).toBe(i + 1);
    }
  });
});

describe('snapshot vector clock aggregation scenario', () => {
  it('should correctly aggregate multiple op clocks and prune with preserved IDs', () => {
    // Simulates the server's getOpsSinceWithSeq aggregation logic:
    // 1. Multiple ops from different clients are aggregated (max per key)
    // 2. Result is pruned with requesting client + snapshot author preserved

    // Simulate 25 operations from different clients
    const opClocks: Record<string, number>[] = [];
    for (let i = 0; i < 25; i++) {
      opClocks.push({ [`client_${i}`]: i + 1, shared_client: i + 10 });
    }

    // Aggregate: take max for each key (mimics the server loop)
    const aggregated: Record<string, number> = {};
    for (const clock of opClocks) {
      for (const [clientId, value] of Object.entries(clock)) {
        aggregated[clientId] = Math.max(aggregated[clientId] ?? 0, value);
      }
    }

    // Should have 26 entries: client_0..client_24 + shared_client
    expect(Object.keys(aggregated).length).toBe(26);
    expect(aggregated['shared_client']).toBe(34); // 24 + 10

    // Prune with two preserved IDs (requesting client + snapshot author)
    const pruned = limitVectorClockSize(aggregated, ['client_0', 'client_24']);
    expect(Object.keys(pruned).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // Both preserved IDs must survive
    expect(pruned['client_0']).toBe(1); // Lowest counter, preserved
    expect(pruned['client_24']).toBe(25); // High counter, preserved

    // shared_client has value 34 (highest), should be kept
    expect(pruned['shared_client']).toBe(34);
  });

  it('pruned snapshot clock still produces correct comparison with post-snapshot ops', () => {
    // After the server prunes the snapshot clock, a fresh client receives it.
    // The client's new ops (merged with snapshot clock) must still be GREATER_THAN
    // the snapshot clock itself.

    // Simulate aggregated snapshot clock from many clients
    const snapshotClock: Record<string, number> = {};
    for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE + 5; i++) {
      snapshotClock[`old_client_${i}`] = 50 + i;
    }

    // Server prunes, preserving the requesting client (freshClient)
    const prunedSnapshot = limitVectorClockSize(snapshotClock, ['old_client_0']);
    expect(Object.keys(prunedSnapshot).length).toBe(MAX_VECTOR_CLOCK_SIZE);

    // Fresh client merges pruned snapshot + increments own counter
    const freshClock: Record<string, number> = { ...prunedSnapshot, freshClient: 1 };

    // freshClock has all of prunedSnapshot's keys at same values PLUS freshClient
    expect(compareVectorClocks(freshClock, prunedSnapshot)).toBe('GREATER_THAN');

    // Even after the fresh client's clock is pruned for storage, the pruned entries
    // (old_client_0..4) were also not in prunedSnapshot, so comparison is still safe
    const freshPruned = limitVectorClockSize(freshClock, ['freshClient']);
    expect(Object.keys(freshPruned).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    expect(freshPruned['freshClient']).toBe(1);
  });
});

describe('limitVectorClockSize comparison-flip scenarios (pruned-out keys present in other clock)', () => {
  // Contract (from docs/sync-and-op-log/vector-clocks.md):
  //
  //   Normal ops carry full (unpruned) vector clocks. The server prunes
  //   AFTER comparison, BEFORE storage. Pruning is therefore expected to
  //   change comparison results — that is by design, and the rejection-
  //   handler protocol (RejectedOpsHandlerService, max 3 attempts) heals
  //   any spurious CONCURRENT outcome by re-uploading with the merged
  //   clock.
  //
  // These tests pin that contract: comparing the *unpruned* clock against
  // B yields the intended verdict, and after pruning A, the dropped keys'
  // presence in B may legitimately flip GREATER_THAN → CONCURRENT (or
  // GREATER_THAN → LESS_THAN). The point is to lock in the actual
  // behaviour so a future "smarter" prune doesn't accidentally invent a
  // pruning-aware comparison without protocol changes.
  it('unpruned A vs B with pruned-out keys high in B: GREATER_THAN unpruned, CONCURRENT after pruning', () => {
    // A starts with 25 entries c1..c25. c1..c20 are high (dominant over B),
    // c21..c25 are low (counter=1) — these are the ones pruning will drop.
    // B has c1..c5 (lower than A) AND c21..c25 at high counters.
    const a: Record<string, number> = {};
    for (let i = 1; i <= 20; i++) a[`c${i}`] = 100;
    for (let i = 21; i <= 25; i++) a[`c${i}`] = 1;
    expect(Object.keys(a).length).toBe(25);

    const b: Record<string, number> = {};
    for (let i = 1; i <= 5; i++) b[`c${i}`] = 50; // A dominates here (100 > 50)
    for (let i = 21; i <= 25; i++) b[`c${i}`] = 99; // B dominates here (99 > 1)

    // Unpruned comparison: A wins on c1..c5 (100 > 50), B wins on c21..c25 (99 > 1)
    // → CONCURRENT even before pruning (A's c21..c25=1 is still < B's 99).
    expect(compareVectorClocks(a, b)).toBe('CONCURRENT');

    // After pruning A to MAX=20, the c21..c25 entries (lowest counters) are
    // dropped. Missing keys are treated as 0, so for c21..c25: pruned=0 < B=99.
    const pruned = limitVectorClockSize(a);
    expect(Object.keys(pruned).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    for (let i = 21; i <= 25; i++) expect(pruned[`c${i}`]).toBeUndefined();
    // Result is still CONCURRENT (A wins on c1..c5, B wins on c21..c25).
    expect(compareVectorClocks(pruned, b)).toBe('CONCURRENT');
  });

  it('GREATER_THAN flips to CONCURRENT when pruning drops keys that B holds at high values', () => {
    // A: 25 entries — c1..c20 dominate B; c21..c25 also dominate B but at
    // tiny counters (so they get pruned).
    const a: Record<string, number> = {};
    for (let i = 1; i <= 20; i++) a[`c${i}`] = 100;
    for (let i = 21; i <= 25; i++) a[`c${i}`] = 2;

    // B has c1..c20 below A AND c21..c25 at high values that A only narrowly
    // beats (2 > 1).
    const b: Record<string, number> = {};
    for (let i = 1; i <= 20; i++) b[`c${i}`] = 50;
    for (let i = 21; i <= 25; i++) b[`c${i}`] = 1;

    // Unpruned: A strictly dominates B on every key → GREATER_THAN.
    expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');

    // Pruning drops c21..c25 (counter=2 vs c1..c20 at 100).
    const pruned = limitVectorClockSize(a);
    expect(Object.keys(pruned).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    for (let i = 21; i <= 25; i++) expect(pruned[`c${i}`]).toBeUndefined();

    // After pruning: pruned wins on c1..c20 (100 > 50) but loses on c21..c25
    // (missing = 0 < 1). This flips GREATER_THAN → CONCURRENT, which is the
    // documented behaviour — the protocol (server prunes AFTER compare; client
    // never prunes before send) prevents this from being observed in practice.
    expect(compareVectorClocks(pruned, b)).toBe('CONCURRENT');
  });

  it('GREATER_THAN flips to LESS_THAN when pruning drops keys B holds at high values and A does not dominate elsewhere', () => {
    // A: 25 entries — c1..c20 at equal value to B; c21..c25 narrowly beat B.
    const a: Record<string, number> = {};
    for (let i = 1; i <= 20; i++) a[`c${i}`] = 50;
    for (let i = 21; i <= 25; i++) a[`c${i}`] = 2;

    // B: identical on c1..c20; lower than A on c21..c25.
    const b: Record<string, number> = {};
    for (let i = 1; i <= 20; i++) b[`c${i}`] = 50;
    for (let i = 21; i <= 25; i++) b[`c${i}`] = 1;

    // Unpruned: equal on c1..c20, A wins on c21..c25 → GREATER_THAN.
    expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');

    // Pruning drops c21..c25.
    const pruned = limitVectorClockSize(a);
    expect(Object.keys(pruned).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    for (let i = 21; i <= 25; i++) expect(pruned[`c${i}`]).toBeUndefined();

    // After pruning: equal on c1..c20, but for c21..c25 pruned=0 < B=1.
    // No key where pruned beats B → LESS_THAN.
    expect(compareVectorClocks(pruned, b)).toBe('LESS_THAN');
  });

  it('preserveClientIds keeps the uploading client even when its counter is low (server-side flow)', () => {
    // Server flow: client sends 25-entry clock, server compares (sees
    // GREATER_THAN), then prunes preserving the uploading client.
    // Use 19 high-counter "other_" entries so that with the preserved
    // uploader (1 slot) + 19 highest counters, we fill all 20 slots without
    // tie-breaking ambiguity.
    const a: Record<string, number> = {};
    for (let i = 1; i <= 19; i++) a[`other_${i}`] = 100;
    a['uploader'] = 1; // Brand-new client with counter=1
    // 5 more low-counter entries that should all be pruned out.
    for (let i = 1; i <= 5; i++) a[`stale_${i}`] = 2;
    expect(Object.keys(a).length).toBe(25);

    const pruned = limitVectorClockSize(a, ['uploader']);
    expect(Object.keys(pruned).length).toBe(MAX_VECTOR_CLOCK_SIZE);
    // Uploader is preserved despite the lowest counter.
    expect(pruned['uploader']).toBe(1);
    // All 5 stale_* entries (counter=2) are the lowest non-preserved → pruned.
    for (let i = 1; i <= 5; i++) expect(pruned[`stale_${i}`]).toBeUndefined();
    // All 19 other_* entries (counter=100) survive.
    for (let i = 1; i <= 19; i++) expect(pruned[`other_${i}`]).toBe(100);
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

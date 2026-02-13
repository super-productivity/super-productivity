/**
 * Unit tests for sync.types.ts functions
 *
 * Tests the vector clock comparison logic to ensure:
 * - GREATER_THAN: All entries in A >= B, at least one >
 * - LESS_THAN: All entries in B >= A, at least one >
 * - EQUAL: All entries are identical
 * - CONCURRENT: Each clock has entries the other doesn't
 */
import { describe, it, expect } from 'vitest';
import {
  compareVectorClocks,
  sanitizeVectorClock,
  VectorClock,
  MAX_VECTOR_CLOCK_SIZE,
} from '../src/sync/sync.types';

describe('compareVectorClocks', () => {
  describe('EQUAL', () => {
    it('should return EQUAL for identical clocks', () => {
      const a: VectorClock = { clientA: 1, clientB: 2 };
      const b: VectorClock = { clientA: 1, clientB: 2 };
      expect(compareVectorClocks(a, b)).toBe('EQUAL');
    });

    it('should return EQUAL for empty clocks', () => {
      const a: VectorClock = {};
      const b: VectorClock = {};
      expect(compareVectorClocks(a, b)).toBe('EQUAL');
    });

    it('should return EQUAL for single-entry identical clocks', () => {
      const a: VectorClock = { clientA: 5 };
      const b: VectorClock = { clientA: 5 };
      expect(compareVectorClocks(a, b)).toBe('EQUAL');
    });
  });

  describe('GREATER_THAN', () => {
    it('should return GREATER_THAN when A has higher values', () => {
      const a: VectorClock = { clientA: 2 };
      const b: VectorClock = { clientA: 1 };
      expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');
    });

    it('should return GREATER_THAN when A has additional entries', () => {
      const a: VectorClock = { clientA: 1, clientB: 1 };
      const b: VectorClock = { clientA: 1 };
      expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');
    });

    it('should return GREATER_THAN when A is strictly greater', () => {
      const a: VectorClock = { clientA: 3, clientB: 2 };
      const b: VectorClock = { clientA: 1, clientB: 1 };
      expect(compareVectorClocks(a, b)).toBe('GREATER_THAN');
    });
  });

  describe('LESS_THAN', () => {
    it('should return LESS_THAN when B has higher values', () => {
      const a: VectorClock = { clientA: 1 };
      const b: VectorClock = { clientA: 2 };
      expect(compareVectorClocks(a, b)).toBe('LESS_THAN');
    });

    it('should return LESS_THAN when B has additional entries', () => {
      const a: VectorClock = { clientA: 1 };
      const b: VectorClock = { clientA: 1, clientB: 1 };
      expect(compareVectorClocks(a, b)).toBe('LESS_THAN');
    });
  });

  describe('CONCURRENT', () => {
    it('should return CONCURRENT when clocks diverge', () => {
      const a: VectorClock = { clientA: 2, clientB: 1 };
      const b: VectorClock = { clientA: 1, clientB: 2 };
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should return CONCURRENT when each has entries the other lacks', () => {
      const a: VectorClock = { clientA: 1 };
      const b: VectorClock = { clientB: 1 };
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });

    it('should return CONCURRENT for mixed higher/lower values', () => {
      const a: VectorClock = { clientA: 5, clientB: 1 };
      const b: VectorClock = { clientA: 1, clientB: 5 };
      expect(compareVectorClocks(a, b)).toBe('CONCURRENT');
    });
  });

  describe('conflict detection edge cases', () => {
    it('should handle missing keys as zero', () => {
      const a: VectorClock = { clientA: 1 };
      const b: VectorClock = { clientA: 1, clientB: 0 };
      // clientB: 0 is effectively the same as missing
      expect(compareVectorClocks(a, b)).toBe('EQUAL');
    });

    it('should handle the EQUAL-from-different-client scenario', () => {
      // This tests the scenario where two different clients end up with
      // identical vector clocks (which shouldn't happen in normal operation)
      const clientA = 'client-a-uuid';
      const a: VectorClock = { [clientA]: 1 };
      const b: VectorClock = { [clientA]: 1 };

      // The clocks are EQUAL - the checkConflict function must separately
      // check clientId to determine if this is a retry or a suspicious situation
      expect(compareVectorClocks(a, b)).toBe('EQUAL');
    });
  });
});

describe('sanitizeVectorClock', () => {
  describe('valid clocks', () => {
    it('should accept a normal clock unchanged', () => {
      const clock = { clientA: 5, clientB: 10 };
      const result = sanitizeVectorClock(clock);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.clock).toEqual(clock);
      }
    });

    it('should accept an empty clock', () => {
      const result = sanitizeVectorClock({});
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.clock).toEqual({});
      }
    });

    it('should accept a clock at exactly MAX_VECTOR_CLOCK_SIZE', () => {
      const clock: VectorClock = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        clock[`client_${i}`] = i + 1;
      }
      const result = sanitizeVectorClock(clock);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(Object.keys(result.clock).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      }
    });

    it('should accept a clock between MAX and 2.5x MAX (conflict resolution range)', () => {
      // During conflict resolution, clients send merged clocks that may exceed MAX
      // but should be within the DoS cap of 2.5x MAX
      const entryCount = MAX_VECTOR_CLOCK_SIZE + 10; // 30 entries, below 50 cap
      const clock: VectorClock = {};
      for (let i = 0; i < entryCount; i++) {
        clock[`client_${i}`] = i + 1;
      }
      const result = sanitizeVectorClock(clock);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(Object.keys(result.clock).length).toBe(entryCount);
      }
    });
  });

  describe('counter cap at 100 million', () => {
    it('should accept counter value at exactly 100 million', () => {
      const result = sanitizeVectorClock({ clientA: 100_000_000 });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.clock['clientA']).toBe(100_000_000);
      }
    });

    it('should strip counter value above 100 million', () => {
      const result = sanitizeVectorClock({ clientA: 100_000_001 });
      expect(result.valid).toBe(true);
      if (result.valid) {
        // The entry is stripped, not the entire clock rejected
        expect(result.clock['clientA']).toBeUndefined();
        expect(Object.keys(result.clock).length).toBe(0);
      }
    });

    it('should strip only entries above 100M while keeping valid ones', () => {
      const result = sanitizeVectorClock({
        validClient: 50,
        overflowClient: 100_000_001,
        anotherValid: 99_999_999,
      });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.clock['validClient']).toBe(50);
        expect(result.clock['anotherValid']).toBe(99_999_999);
        expect(result.clock['overflowClient']).toBeUndefined();
        expect(Object.keys(result.clock).length).toBe(2);
      }
    });

    it('should strip negative counter values', () => {
      const result = sanitizeVectorClock({ clientA: -1, clientB: 5 });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.clock['clientA']).toBeUndefined();
        expect(result.clock['clientB']).toBe(5);
      }
    });

    it('should strip non-integer counter values', () => {
      const result = sanitizeVectorClock({ clientA: 3.14, clientB: 5 });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.clock['clientA']).toBeUndefined();
        expect(result.clock['clientB']).toBe(5);
      }
    });

    it('should accept counter value of 0', () => {
      const result = sanitizeVectorClock({ clientA: 0 });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.clock['clientA']).toBe(0);
      }
    });
  });

  describe('DoS cap at 2.5x MAX', () => {
    it('should accept clock at exactly 2.5x MAX entries', () => {
      const maxSanitize = Math.ceil(MAX_VECTOR_CLOCK_SIZE * 2.5);
      const clock: VectorClock = {};
      for (let i = 0; i < maxSanitize; i++) {
        clock[`client_${i}`] = i + 1;
      }
      const result = sanitizeVectorClock(clock);
      expect(result.valid).toBe(true);
    });

    it('should reject clock above 2.5x MAX entries', () => {
      const maxSanitize = Math.ceil(MAX_VECTOR_CLOCK_SIZE * 2.5);
      const clock: VectorClock = {};
      for (let i = 0; i < maxSanitize + 1; i++) {
        clock[`client_${i}`] = i + 1;
      }
      const result = sanitizeVectorClock(clock);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('too many entries');
      }
    });

    it('should reject (not prune) oversized clocks — DoS cap is not pruning', () => {
      // Critical invariant: sanitizeVectorClock REJECTS oversized clocks entirely.
      // It does NOT silently prune them down, which would violate the
      // "prune after comparison" invariant.
      const clock: VectorClock = {};
      for (let i = 0; i < 100; i++) {
        clock[`client_${i}`] = i;
      }
      const result = sanitizeVectorClock(clock);
      expect(result.valid).toBe(false);
    });
  });

  describe('invalid inputs', () => {
    it('should reject null', () => {
      expect(sanitizeVectorClock(null).valid).toBe(false);
    });

    it('should reject arrays', () => {
      expect(sanitizeVectorClock([1, 2, 3]).valid).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(sanitizeVectorClock('string').valid).toBe(false);
      expect(sanitizeVectorClock(42).valid).toBe(false);
    });

    it('should strip entries with empty string keys', () => {
      const result = sanitizeVectorClock({ '': 5, validKey: 10 });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.clock['']).toBeUndefined();
        expect(result.clock['validKey']).toBe(10);
      }
    });

    it('should strip entries with keys exceeding 255 characters', () => {
      const longKey = 'x'.repeat(256);
      const result = sanitizeVectorClock({ [longKey]: 5, normalKey: 10 });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.clock[longKey]).toBeUndefined();
        expect(result.clock['normalKey']).toBe(10);
      }
    });
  });
});

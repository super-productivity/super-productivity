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
import { compareVectorClocks, VectorClock } from '../src/sync/sync.types';

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

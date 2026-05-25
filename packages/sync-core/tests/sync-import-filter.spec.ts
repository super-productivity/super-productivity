import { describe, expect, it } from 'vitest';
import { classifyOpAgainstSyncImport } from '../src/sync-import-filter';
import type { SyncImportFilterClockSource } from '../src/sync-import-filter';

const clockSource = (
  clientId: string,
  vectorClock: Record<string, number>,
): SyncImportFilterClockSource => ({
  clientId,
  vectorClock,
});

describe('classifyOpAgainstSyncImport', () => {
  it('keeps GREATER_THAN ops', () => {
    expect(
      classifyOpAgainstSyncImport(
        clockSource('clientA', { clientA: 2, clientB: 1 }),
        clockSource('clientB', { clientA: 1, clientB: 1 }),
      ),
    ).toEqual({
      shouldKeep: true,
      comparison: 'GREATER_THAN',
      reason: 'greater-than',
    });
  });

  it('keeps EQUAL ops', () => {
    expect(
      classifyOpAgainstSyncImport(
        clockSource('clientA', { clientA: 1, clientB: 1 }),
        clockSource('clientB', { clientA: 1, clientB: 1 }),
      ),
    ).toEqual({
      shouldKeep: true,
      comparison: 'EQUAL',
      reason: 'equal',
    });
  });

  it('keeps CONCURRENT same-client ops with a greater own counter', () => {
    expect(
      classifyOpAgainstSyncImport(
        clockSource('clientB', { clientB: 6, clientC: 1 }),
        clockSource('clientB', { clientA: 10, clientB: 5 }),
      ),
    ).toEqual({
      shouldKeep: true,
      comparison: 'CONCURRENT',
      reason: 'same-client-post-import',
    });
  });

  it('invalidates CONCURRENT same-client ops with an equal own counter', () => {
    expect(
      classifyOpAgainstSyncImport(
        clockSource('clientB', { clientB: 5, clientC: 1 }),
        clockSource('clientB', { clientA: 10, clientB: 5 }),
      ),
    ).toEqual({
      shouldKeep: false,
      comparison: 'CONCURRENT',
      reason: 'concurrent',
    });
  });

  it('keeps CONCURRENT different-client ops that know the import client counter', () => {
    expect(
      classifyOpAgainstSyncImport(
        clockSource('clientA', { clientA: 1, clientB: 5 }),
        clockSource('clientB', { clientB: 5, clientC: 10 }),
      ),
    ).toEqual({
      shouldKeep: true,
      comparison: 'CONCURRENT',
      reason: 'knows-import-counter',
    });
  });

  it('invalidates CONCURRENT different-client ops when the import client counter is 0', () => {
    expect(
      classifyOpAgainstSyncImport(
        clockSource('clientA', { clientA: 1, clientB: 0 }),
        clockSource('clientB', { clientB: 0, clientC: 10 }),
      ),
    ).toEqual({
      shouldKeep: false,
      comparison: 'CONCURRENT',
      reason: 'concurrent',
    });
  });

  it('invalidates other CONCURRENT ops', () => {
    expect(
      classifyOpAgainstSyncImport(
        clockSource('clientA', { clientA: 1 }),
        clockSource('clientB', { clientB: 5 }),
      ),
    ).toEqual({
      shouldKeep: false,
      comparison: 'CONCURRENT',
      reason: 'concurrent',
    });
  });

  it('invalidates LESS_THAN ops', () => {
    expect(
      classifyOpAgainstSyncImport(
        clockSource('clientA', { clientA: 1 }),
        clockSource('clientB', { clientA: 2, clientB: 1 }),
      ),
    ).toEqual({
      shouldKeep: false,
      comparison: 'LESS_THAN',
      reason: 'less-than',
    });
  });

  describe('edge cases', () => {
    it('treats two empty vector clocks as EQUAL and keeps the op', () => {
      expect(
        classifyOpAgainstSyncImport(
          clockSource('clientA', {}),
          clockSource('clientB', {}),
        ),
      ).toEqual({
        shouldKeep: true,
        comparison: 'EQUAL',
        reason: 'equal',
      });
    });

    it('keeps an op when only the import clock is empty (any positive op clock dominates)', () => {
      expect(
        classifyOpAgainstSyncImport(
          clockSource('clientA', { clientA: 1 }),
          clockSource('clientB', {}),
        ),
      ).toEqual({
        shouldKeep: true,
        comparison: 'GREATER_THAN',
        reason: 'greater-than',
      });
    });

    it('invalidates an op when only the op clock is empty (import dominates)', () => {
      expect(
        classifyOpAgainstSyncImport(
          clockSource('clientA', {}),
          clockSource('clientB', { clientB: 1 }),
        ),
      ).toEqual({
        shouldKeep: false,
        comparison: 'LESS_THAN',
        reason: 'less-than',
      });
    });

    it('keeps the op when import clock has the import client at 0 and op dominates that key', () => {
      // Op clock includes the import client at 0 alongside other clients.
      // Op: {clientA: 2, clientB: 0, clientC: 1}; import (clientB): {clientB: 0}.
      // Comparison: op has clientA=2 (b=0), clientC=1 (b=0), clientB=0 (b=0) → GREATER_THAN.
      expect(
        classifyOpAgainstSyncImport(
          clockSource('clientA', { clientA: 2, clientB: 0, clientC: 1 }),
          clockSource('clientB', { clientB: 0 }),
        ),
      ).toEqual({
        shouldKeep: true,
        comparison: 'GREATER_THAN',
        reason: 'greater-than',
      });
    });

    it('invalidates a CONCURRENT op when the op carries clientB:0 but the import client counter is 0', () => {
      // The knows-import-counter branch requires importClientCounter > 0.
      // Even if the op clock explicitly lists the import client at 0
      // (alongside other clients), that does not "know" the import.
      expect(
        classifyOpAgainstSyncImport(
          clockSource('clientA', { clientA: 1, clientB: 0 }),
          clockSource('clientB', { clientB: 0, clientC: 5 }),
        ),
      ).toEqual({
        shouldKeep: false,
        comparison: 'CONCURRENT',
        reason: 'concurrent',
      });
    });

    it('invalidates a same-client op whose own counter is LESS than the import counter', () => {
      // Same client as the import, but op.clientB=3 < import.clientB=5.
      // op also has a separate fresh key clientC:1 → CONCURRENT vs import.
      // same-client-post-import requires op own counter > import counter; here
      // it's strictly less → falls through to the concurrent rejection.
      expect(
        classifyOpAgainstSyncImport(
          clockSource('clientB', { clientB: 3, clientC: 1 }),
          clockSource('clientB', { clientA: 10, clientB: 5 }),
        ),
      ).toEqual({
        shouldKeep: false,
        comparison: 'CONCURRENT',
        reason: 'concurrent',
      });
    });

    it('invalidates a same-client op whose own counter equals the import counter (strict >, not >=)', () => {
      // Pins the strict-greater-than boundary in the same-client branch.
      expect(
        classifyOpAgainstSyncImport(
          clockSource('clientB', { clientB: 5, clientC: 1 }),
          clockSource('clientB', { clientA: 10, clientB: 5 }),
        ),
      ).toEqual({
        shouldKeep: false,
        comparison: 'CONCURRENT',
        reason: 'concurrent',
      });
    });

    it('keeps a different-client op when its knowledge of the import counter exceeds it (strictly greater)', () => {
      // Pins the >= boundary in the knows-import-counter branch: op.clientB=6
      // exceeds importClientCounter=5.
      expect(
        classifyOpAgainstSyncImport(
          clockSource('clientA', { clientA: 1, clientB: 6 }),
          clockSource('clientB', { clientB: 5, clientC: 10 }),
        ),
      ).toEqual({
        shouldKeep: true,
        comparison: 'CONCURRENT',
        reason: 'knows-import-counter',
      });
    });
  });
});

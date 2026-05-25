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
});

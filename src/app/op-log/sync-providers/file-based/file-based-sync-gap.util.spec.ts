import {
  detectDownloadGap,
  GapDetectionInput,
  GapDetectionRemote,
} from './file-based-sync-gap.util';

describe('detectDownloadGap', () => {
  // Reader A last committed the file at syncVersion 3 after both clients synced.
  const LAST_SEEN = { clientA: 3, clientB: 1 };

  // A contiguous tail at the version A expects: no version, emptiness, or
  // trimming heuristic fires, so only the clock-based checks decide.
  const input = (
    remote: Partial<GapDetectionRemote>,
    overrides: Partial<GapDetectionInput> = {},
  ): GapDetectionInput => ({
    remote: {
      syncVersion: 4,
      vectorClock: LAST_SEEN,
      clientId: 'client-b',
      recentOps: [{}],
      oldestOpSyncVersion: 4,
      ...remote,
    },
    sinceSeq: 3,
    excludeClient: 'client-a',
    previousExpectedVersion: 3,
    lastSeenClock: LAST_SEEN,
    hasSnapshot: true,
    ...overrides,
  });

  describe('lineage break', () => {
    // B kept its local data (USE_LOCAL) from before A's last two ops, so its
    // clock is concurrent with what A last saw.
    const REPLACED_CLOCK = { clientA: 1, clientB: 3 };

    it('flags a concurrent clock written by another client', () => {
      const result = detectDownloadGap(input({ vectorClock: REPLACED_CLOCK }));

      expect(result.needsGapDetection).toBeTrue();
      expect(result.reason).toContain('lineage break');
    });

    it('exempts a file whose last writer is the reading client itself', () => {
      const result = detectDownloadGap(
        input({ vectorClock: REPLACED_CLOCK, clientId: 'client-a' }),
      );

      expect(result.needsGapDetection).toBeFalse();
    });
  });

  it('does not flag an ordinary dominating upload without a snapshot base', () => {
    // B merged A's clock and appended one op: a normal descendant write.
    const result = detectDownloadGap(input({ vectorClock: { clientA: 3, clientB: 2 } }));

    expect(result.needsGapDetection).toBeFalse();
  });
});

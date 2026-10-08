import { OperationLogEntry } from '../../core/operation.types';
import {
  detectDownloadGap,
  GapDetectionInput,
  GapDetectionRemote,
  getOpLogBaselineClock,
  OpLogClockSource,
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

  describe('snapshot base without a recorded clock (#10258)', () => {
    // B replaced the remote (Keep local) and appended a tail op on top.
    const BASE = { clientA: 3, clientB: 2 };
    const replaced = { vectorClock: { clientA: 3, clientB: 3 }, snapshotBaseClock: BASE };

    it('flags a base the local op-log clock does not cover', () => {
      const result = detectDownloadGap(
        input(replaced, { lastSeenClock: undefined, localClock: LAST_SEEN }),
      );

      expect(result.needsGapDetection).toBeTrue();
      expect(result.reason).toContain('unseen causal base');
    });

    it('does not flag a base the local clock covers, even with local edits on top', () => {
      const result = detectDownloadGap(
        input(replaced, {
          lastSeenClock: undefined,
          localClock: { clientA: 5, clientB: 2 },
        }),
      );

      expect(result.needsGapDetection).toBeFalse();
    });

    it('judges by the recorded clock once there is one', () => {
      const result = detectDownloadGap(
        input(replaced, { lastSeenClock: BASE, localClock: LAST_SEEN }),
      );

      expect(result.needsGapDetection).toBeFalse();
    });

    it('does not flag without any baseline', () => {
      const result = detectDownloadGap(input(replaced, { lastSeenClock: undefined }));

      expect(result.needsGapDetection).toBeFalse();
    });
  });
});

describe('getOpLogBaselineClock (#10258)', () => {
  const CLOCK = { clientA: 4, clientB: 2 };
  const store = (latest?: Partial<OperationLogEntry>): OpLogClockSource => ({
    getVectorClock: async () => ({ ...CLOCK }),
    getLatestFullStateOpEntry: async () => latest as OperationLogEntry | undefined,
  });

  it('returns the op-log clock while no file clock is recorded', async () => {
    expect(await getOpLogBaselineClock(store(), 3, undefined)).toEqual(CLOCK);
  });

  it('returns nothing once a file clock is recorded or on a seq-0 download', async () => {
    expect(await getOpLogBaselineClock(store(), 3, { clientA: 1 })).toBeUndefined();
    expect(await getOpLogBaselineClock(store(), 0, undefined)).toBeUndefined();
  });

  it('returns nothing while a local full-state op (restore, clean slate) is unsynced', async () => {
    expect(
      await getOpLogBaselineClock(store({ source: 'local' }), 3, undefined),
    ).toBeUndefined();
  });

  it('returns the clock once that full-state op is synced or came from remote', async () => {
    expect(
      await getOpLogBaselineClock(store({ source: 'local', syncedAt: 1 }), 3, undefined),
    ).toEqual(CLOCK);
    expect(
      await getOpLogBaselineClock(store({ source: 'remote' }), 3, undefined),
    ).toEqual(CLOCK);
  });
});

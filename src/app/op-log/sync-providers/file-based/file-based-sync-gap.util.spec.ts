import { OperationLogEntry } from '../../core/operation.types';
import {
  appendRecentOpsAtBatchBoundary,
  areOwnUploadsMissing,
  detectDownloadGap,
  GapDetectionInput,
  GapDetectionRemote,
  getOpLogBaselineClock,
  isSingleFileBufferPossiblyTrimmed,
  isSplitBufferPossiblyTrimmed,
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
    isPossiblyTrimmed: false,
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

describe('detectDownloadGap: oldest batch at sinceSeq+1 (#10973)', () => {
  // Reader B is at cursor 3; the oldest retained op belongs to batch 4.
  const input = (
    remote: Partial<GapDetectionRemote>,
    overrides: Partial<GapDetectionInput> = {},
  ): GapDetectionInput => ({
    remote: {
      syncVersion: 9,
      vectorClock: { clientA: 9 },
      clientId: 'client-a',
      recentOps: [{}, {}],
      oldestOpSyncVersion: 4,
      ...remote,
    },
    sinceSeq: 3,
    excludeClient: 'client-b',
    previousExpectedVersion: 3,
    lastSeenClock: { clientA: 3 },
    hasSnapshot: true,
    isPossiblyTrimmed: true,
    ...overrides,
  });

  it('flags an uncertified oldest batch in a possibly trimmed buffer', () => {
    // An older writer cut per op: batch 4 may have lost its head.
    const result = detectDownloadGap(input({}));

    expect(result.needsGapDetection).toBeTrue();
    expect(result.reason).toContain('possibly partial oldest batch');
  });

  it('trusts a writer that certified the oldest batch complete', () => {
    const result = detectDownloadGap(input({ oldestBatchComplete: true }));

    expect(result.needsGapDetection).toBeFalse();
  });

  it('does not flag a buffer that was never trimmed', () => {
    const result = detectDownloadGap(input({}, { isPossiblyTrimmed: false }));

    expect(result.needsGapDetection).toBeFalse();
  });

  it('does not flag a reader that already holds the oldest batch', () => {
    const result = detectDownloadGap(
      input(
        {},
        { sinceSeq: 4, previousExpectedVersion: 4, lastSeenClock: { clientA: 4 } },
      ),
    );

    expect(result.needsGapDetection).toBeFalse();
  });

  it('does not flag a seq-0 download', () => {
    const result = detectDownloadGap(
      input({}, { sinceSeq: 0, previousExpectedVersion: 0, lastSeenClock: undefined }),
    );

    expect(result.needsGapDetection).toBeFalse();
  });

  it('never suppresses the proven trim gap, certified or not (SPAP-33)', () => {
    for (const oldestBatchComplete of [true, undefined]) {
      for (const isPossiblyTrimmed of [true, false]) {
        const result = detectDownloadGap(
          input({ oldestOpSyncVersion: 6, oldestBatchComplete }, { isPossiblyTrimmed }),
        );
        expect(result.needsGapDetection).toBeTrue();
        expect(result.reason).toContain('partial trimming');
      }
    }
  });
});

describe('possibly trimmed buffer heuristics (#10973)', () => {
  it('single file: only a buffer at the cap can have been trimmed', () => {
    const ops = (n: number): { recentOps: unknown[] } => ({
      recentOps: new Array(n).fill({}),
    });
    expect(isSingleFileBufferPossiblyTrimmed(ops(2000))).toBeTrue();
    expect(isSingleFileBufferPossiblyTrimmed(ops(1999))).toBeFalse();
  });

  it('split: only a batch at or below the compaction snapshot can have been cut', () => {
    const file = (
      oldestOpSyncVersion: number | undefined,
    ): Parameters<typeof isSplitBufferPossiblyTrimmed>[0] => ({
      oldestOpSyncVersion,
      snapshotRef: { syncVersion: 7 },
    });
    expect(isSplitBufferPossiblyTrimmed(file(5))).toBeTrue();
    expect(isSplitBufferPossiblyTrimmed(file(7))).toBeTrue();
    expect(isSplitBufferPossiblyTrimmed(file(8))).toBeFalse();
    expect(isSplitBufferPossiblyTrimmed(file(undefined))).toBeFalse();
  });
});

describe('appendRecentOpsAtBatchBoundary (#10973)', () => {
  type Op = { sv?: number };
  const batch = (sv: number | undefined, count: number): Op[] =>
    Array.from({ length: count }, () => ({ sv }));
  const svs = (ops: Op[]): (number | undefined)[] => ops.map((op) => op.sv);
  const prev = (
    recentOps: Op[],
    oldestBatchComplete?: boolean,
  ): { recentOps: Op[]; oldestBatchComplete?: boolean } => ({
    recentOps,
    oldestBatchComplete,
  });

  it('keeps everything under the cap and inherits the certification', () => {
    const existing = [...batch(1, 2), ...batch(2, 2)];
    for (const was of [true, false, undefined]) {
      const { fields, trimmedCount } = appendRecentOpsAtBatchBoundary(
        prev(existing, was),
        batch(3, 1),
        10,
      );
      expect(svs(fields.recentOps)).toEqual([1, 1, 2, 2, 3]);
      expect(fields.oldestOpSyncVersion).toBe(1);
      expect(fields.oldestBatchComplete).toBe(was === true ? true : undefined);
      expect(trimmedCount).toBe(0);
    }
  });

  it('certifies a buffer that starts with this batch', () => {
    for (const previous of [null, undefined, prev([])]) {
      const { fields } = appendRecentOpsAtBatchBoundary(previous, batch(5, 3), 10);
      expect(fields.recentOps.length).toBe(3);
      expect(fields.oldestOpSyncVersion).toBe(5);
      expect(fields.oldestBatchComplete).toBeTrue();
    }
  });

  it('drops the rest of a batch the cap would cut into', () => {
    // A per-op slice(-5) would keep [2, 2, 3, 3, 3]: half of batch 2.
    const existing = [...batch(1, 1), ...batch(2, 4)];
    const { fields, trimmedCount } = appendRecentOpsAtBatchBoundary(
      prev(existing),
      batch(3, 3),
      5,
    );

    expect(svs(fields.recentOps)).toEqual([3, 3, 3]);
    expect(fields.oldestOpSyncVersion).toBe(3);
    expect(fields.oldestBatchComplete).toBeTrue();
    expect(trimmedCount).toBe(5);
  });

  it('keeps the oldest batch when the cap falls exactly on its start', () => {
    const existing = [...batch(1, 2), ...batch(2, 2)];
    const { fields } = appendRecentOpsAtBatchBoundary(prev(existing), batch(3, 3), 5);

    expect(svs(fields.recentOps)).toEqual([2, 2, 3, 3, 3]);
    expect(fields.oldestBatchComplete).toBeTrue();
  });

  it('keeps a new batch larger than the cap whole', () => {
    const { fields, trimmedCount } = appendRecentOpsAtBatchBoundary(
      prev(batch(1, 2), true),
      batch(2, 6),
      5,
    );

    expect(svs(fields.recentOps)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(fields.oldestOpSyncVersion).toBe(2);
    expect(fields.oldestBatchComplete).toBeTrue();
    expect(trimmedCount).toBe(2);
  });

  it('drops an over-cap batch once a newer batch arrives', () => {
    const { fields } = appendRecentOpsAtBatchBoundary(
      prev([...batch(1, 1), ...batch(2, 6)], true),
      batch(3, 2),
      5,
    );

    expect(svs(fields.recentOps)).toEqual([3, 3]);
    expect(fields.oldestBatchComplete).toBeTrue();
  });

  it('treats legacy ops without sv as one batch', () => {
    const existing = [...batch(undefined, 3), ...batch(4, 1)];
    const { fields } = appendRecentOpsAtBatchBoundary(prev(existing), batch(5, 2), 4);

    expect(svs(fields.recentOps)).toEqual([4, 5, 5]);
  });

  it('does not mutate its inputs', () => {
    const existing = batch(1, 3);
    const added = batch(2, 3);

    appendRecentOpsAtBatchBoundary(prev(existing), added, 4);

    expect(existing.length).toBe(3);
    expect(added.length).toBe(3);
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

describe('areOwnUploadsMissing', () => {
  // Client A last saw its own upload at counter 5 in a file based on BASE.
  const BASE = { clientA: 2, clientB: 1 };
  const LAST_SEEN = { clientA: 5, clientB: 1 };

  it('flags a stale-base write that dropped this client’s uploads (#10916)', () => {
    const remote = { vectorClock: { clientA: 2, clientB: 3 }, snapshotBaseClock: BASE };
    expect(areOwnUploadsMissing(remote, 'clientA', LAST_SEEN)).toBe(true);
  });

  it('flags a file without a base: an old writer cannot be told apart', () => {
    const remote = { vectorClock: { clientA: 2, clientB: 3 } };
    expect(areOwnUploadsMissing(remote, 'clientA', LAST_SEEN)).toBe(true);
  });

  it('does not flag a full-state replacement with a base this client has not seen', () => {
    const remote = {
      vectorClock: { clientB: 9 },
      snapshotBaseClock: { clientB: 9 },
    };
    expect(areOwnUploadsMissing(remote, 'clientA', LAST_SEEN)).toBe(false);
  });

  it('does not flag a remote that still covers this client’s uploads', () => {
    const remote = { vectorClock: { clientA: 5, clientB: 3 }, snapshotBaseClock: BASE };
    expect(areOwnUploadsMissing(remote, 'clientA', LAST_SEEN)).toBe(false);
  });

  it('does not flag without a last-seen clock or client id', () => {
    const remote = { vectorClock: { clientB: 3 }, snapshotBaseClock: BASE };
    expect(areOwnUploadsMissing(remote, 'clientA', undefined)).toBe(false);
    expect(areOwnUploadsMissing(remote, undefined, LAST_SEEN)).toBe(false);
  });
});

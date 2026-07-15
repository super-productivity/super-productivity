import {
  FileBasedSyncTestHarness,
  HarnessClient,
} from '../helpers/file-based-sync-test-harness';
import { FILE_BASED_SYNC_CONSTANTS } from '../../../sync-providers/file-based/file-based-sync.types';
import {
  FileSnapshotOpDownloadResponse,
  SyncOperation,
} from '../../../sync-providers/provider.interface';
import { UploadRevToMatchMismatchAPIError } from '../../../core/errors/sync-errors';

/**
 * Regression coverage for issue #9040: split-file compaction must not strand the
 * ops pointer at a snapshot that no concurrent-safe file preserves.
 *
 * ## The race (file-based providers have NO cross-device lock)
 *
 * `_uploadOpsSplit` writes the snapshot, then commits `sync-ops.json` conditionally
 * (the single-winner gate). Before #9040 the snapshot went to the FIXED
 * `sync-state.json` via an unconditional force-write, so the LOSER of the ops race
 * could still clobber the WINNER's snapshot, leaving the winning ops pointer
 * referencing a snapshot absent from both `sync-state.json` and its `.bak` → an
 * unrecoverable gap for a fresh client.
 *
 * ## The fix
 *
 * The snapshot is now written to a generation+client-unique IMMUTABLE file
 * (`sync-state__<syncVersion>__<clientId>.json`) recorded in `snapshotRef.file`. A
 * concurrent compactor writes a DIFFERENT immutable file, so it can never clobber
 * the winner's referenced snapshot. These tests assert a fresh client always
 * hydrates the committed generation regardless of interleave.
 */
describe('File-Based Sync Integration - Concurrent Split Compaction (#9040)', () => {
  const C = FILE_BASED_SYNC_CONSTANTS;
  let harness: FileBasedSyncTestHarness;

  beforeEach(() => {
    harness = FileBasedSyncTestHarness.create({ isUseSplitSyncFiles: true });
  });

  afterEach(() => {
    harness.reset();
  });

  const addTaskOp = (client: HarnessClient, id: string): SyncOperation =>
    client.createOp('Task', id, 'CRT', 'TaskActionTypes.ADD_TASK', { title: id });

  /**
   * Seeds a compacted folder whose ops buffer sits EXACTLY at the cap, so the next
   * single-op sync from any client triggers a fresh compaction
   * (needsCompaction = combinedOps.length > MAX_RECENT_OPS) using a real ops rev —
   * the only path where the conditional ops PUT yields a single winner.
   */
  const seedFolderAtCap = async (): Promise<void> => {
    const seed = harness.createClient('seed-client');
    await seed.uploadOps([addTaskOp(seed, 'seed-0')]);
    const fill: SyncOperation[] = [];
    for (let i = 0; i < C.MAX_RECENT_OPS - 1; i++) {
      fill.push(addTaskOp(seed, `fill-${i}`));
    }
    // Op-only sync (combined = 1 + (MAX_RECENT_OPS - 1) = MAX_RECENT_OPS, NOT
    // greater, so no compaction): the buffer now sits precisely at the cap.
    await seed.uploadOps(fill);
  };

  /**
   * Spies the shared provider so the FIRST `uploadFile` whose (path, isForce)
   * matches `match` parks BEFORE executing, until the returned `release` fires.
   * Lets a test drive a deterministic interleave of two concurrent compactions.
   */
  const gateFirstUpload = (
    match: (path: string, isForce: boolean) => boolean,
  ): { atGate: Promise<void>; release: () => void } => {
    let release: () => void = () => {};
    const released = new Promise<void>((r) => (release = r));
    let reached: () => void = () => {};
    const atGate = new Promise<void>((r) => (reached = r));
    let armed = true;

    const provider = harness.getProvider();
    const realUploadFile = provider.uploadFile.bind(provider);
    spyOn(provider, 'uploadFile').and.callFake(
      async (path: string, data: string, rev: string | null, isForce?: boolean) => {
        if (armed && match(path, !!isForce)) {
          armed = false;
          reached();
          await released;
        }
        return realUploadFile(path, data, rev, isForce);
      },
    );
    return { atGate, release };
  };

  const downloadFresh = async (): Promise<FileSnapshotOpDownloadResponse> => {
    const fresh = harness.createClient('fresh-client');
    return (await fresh.downloadOps(0)) as FileSnapshotOpDownloadResponse;
  };

  it('harmful interleave: loser clobbers sync-state.json but cannot strand the immutable snapshot', async () => {
    const provider = harness.getProvider();
    await seedFolderAtCap();

    // Control: the seeded folder is healthy and fully hydratable BEFORE the race,
    // so any later gap is attributable to the concurrent compaction, not setup.
    const probe = (await harness
      .createClient('probe-client')
      .downloadOps(0)) as FileSnapshotOpDownloadResponse;
    expect(probe.gapDetected).toBeFalsy();
    expect(probe.snapshotState).toBeDefined();

    // Park the loser at its sync-state.json.bak write — its backup has already read
    // the OLD snapshot, so `.bak` will hold a stale generation. Then run the winner
    // to completion and resume the loser to clobber + lose the ops race.
    const { atGate, release } = gateFirstUpload((path) => path === C.STATE_BACKUP_FILE);
    const winner = harness.createClient('winner-client');
    const loser = harness.createClient('loser-client');

    const loserPromise = loser.uploadOps([addTaskOp(loser, 'loser-op')]);
    await atGate;
    await winner.uploadOps([addTaskOp(winner, 'winner-op')]);
    release();
    await expectAsync(loserPromise).toBeRejectedWithError(
      UploadRevToMatchMismatchAPIError,
    );

    // The winner's immutable snapshot (syncVersion 3) survives the loser's clobber,
    // and the superseded predecessor (seed's syncVersion 1) was garbage-collected.
    expect(provider.hasFile('sync-state__3__winner-client.json')).toBe(true);
    expect(provider.hasFile('sync-state__1__seed-client.json')).toBe(false);

    const download = await downloadFresh();
    expect(download.gapDetected).toBeFalsy();
    expect(download.snapshotState).toBeDefined();
  });

  it('benign interleave: loser holding a stale rev loses the ops race, fresh client still hydrates', async () => {
    await seedFolderAtCap();
    const winner = harness.createClient('winner-client');
    const loser = harness.createClient('loser-client');

    // Loser downloads (caching the pre-compaction ops rev), then the winner
    // compacts + commits. The loser's later compaction backs up the winner's
    // snapshot and loses the conditional ops PUT — order-independence guard.
    await loser.downloadOps(0);
    await winner.uploadOps([addTaskOp(winner, 'winner-op')]);
    await expectAsync(
      loser.uploadOps([addTaskOp(loser, 'loser-op')]),
    ).toBeRejectedWithError(UploadRevToMatchMismatchAPIError);

    const download = await downloadFresh();
    expect(download.gapDetected).toBeFalsy();
    expect(download.snapshotState).toBeDefined();
  });

  it('fresh-folder concurrent compaction: create-if-absent picks one winner, no strand', async () => {
    const provider = harness.getProvider();

    // Both clients compact a fresh folder (no snapshot yet). Park the loser just
    // before it creates sync-ops.json; the winner then creates it first and wins
    // the create-if-absent gate, so the loser's create fails.
    const { atGate, release } = gateFirstUpload(
      (path, isForce) => path === C.OPS_FILE && !isForce,
    );
    const winner = harness.createClient('winner-client');
    const loser = harness.createClient('loser-client');

    const loserPromise = loser.uploadOps([addTaskOp(loser, 'loser-op')]);
    await atGate;
    await winner.uploadOps([addTaskOp(winner, 'winner-op')]);
    release();
    await expectAsync(loserPromise).toBeRejectedWithError(
      UploadRevToMatchMismatchAPIError,
    );

    const download = await downloadFresh();
    expect(download.gapDetected).toBeFalsy();
    expect(download.snapshotState).toBeDefined();
    // The winner's immutable snapshot (syncVersion 1) survives the loser's clobber.
    expect(provider.hasFile('sync-state__1__winner-client.json')).toBe(true);
  });
});

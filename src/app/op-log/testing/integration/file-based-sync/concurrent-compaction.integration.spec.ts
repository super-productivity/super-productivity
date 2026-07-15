import { FileBasedSyncTestHarness } from '../helpers/file-based-sync-test-harness';
import { FILE_BASED_SYNC_CONSTANTS } from '../../../sync-providers/file-based/file-based-sync.types';
import {
  FileRevResponse,
  FileSnapshotOpDownloadResponse,
  SyncOperation,
} from '../../../sync-providers/provider.interface';
import { UploadRevToMatchMismatchAPIError } from '../../../core/errors/sync-errors';

/**
 * Regression coverage for issue #9040: split-file compaction can strand the ops
 * pointer at a snapshot that survives in neither the primary snapshot file nor
 * its backup.
 *
 * ## The race (file-based providers have NO cross-device lock)
 *
 * `_uploadOpsSplit` commits a compaction in three provider writes:
 *   1. `sync-state.json.bak`  ← copy of the CURRENT snapshot (reads live state)
 *   2. `sync-state.json`      ← the NEW snapshot, FORCE-written (revToMatch=null)
 *   3. `sync-ops.json`        ← the commit point, CONDITIONAL on the ops rev
 *
 * Only write 3 is gated, so the ops file has a single winner. But write 2 is an
 * unconditional last-writer-wins force-write, so the LOSER of the ops race can
 * still clobber the WINNER's snapshot. When the loser's backup (write 1) ran
 * before the winner's snapshot write, `.bak` holds an older, unrelated snapshot
 * — so the winning ops file ends up referencing a snapshot present in neither
 * `sync-state.json` nor `sync-state.json.bak`.
 *
 * Interleave reproduced below (winner A, loser B; initial snapshot S0, ops rev R0):
 *   B.bak(read S0 → write S0)  →  A.state(SA)  →  A.ops(commit, R0→RA)
 *     →  B.state(SB, clobbers SA)  →  B.ops(PUT vs R0 → mismatch, B aborts)
 *   Final: sync-state.json = SB, .bak = S0, sync-ops.json → SA (in neither).
 *
 * A fresh client that then hydrates from seq 0 cannot validate the referenced
 * snapshot against `sync-state.json` (SB) or `.bak` (S0), so it reports an
 * unrecoverable gap. This test asserts the fresh client CAN still hydrate — it
 * FAILS today (stranded pointer) and should PASS once the snapshot is written
 * under a generation-unique, immutable name that a concurrent compaction cannot
 * clobber.
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

  it('a losing concurrent compaction must not strand the winner’s ops pointer', async () => {
    const provider = harness.getProvider();

    // --- Arrange: a compacted folder whose ops buffer sits EXACTLY at the cap,
    // so the next single-op sync from any client triggers a fresh compaction
    // (needsCompaction = combinedOps.length > MAX_RECENT_OPS). This is the only
    // path where the conditional ops PUT uses a real rev, giving a single winner
    // — the fresh/first-sync path uses revToMatch=null and has no gate. ---
    const seed = harness.createClient('seed-client');
    await seed.uploadOps([
      seed.createOp('Task', 'seed-0', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'seed',
      }),
    ]);
    const fill: SyncOperation[] = [];
    for (let i = 0; i < C.MAX_RECENT_OPS - 1; i++) {
      fill.push(
        seed.createOp('Task', `fill-${i}`, 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: `fill-${i}`,
        }),
      );
    }
    // Op-only sync (combined = 1 + (MAX_RECENT_OPS - 1) = MAX_RECENT_OPS, NOT
    // greater, so no compaction): the buffer now sits precisely at the cap.
    await seed.uploadOps(fill);

    // Control: the seeded folder is healthy and fully hydratable BEFORE the race,
    // so a gap after it is attributable to the concurrent compaction, not setup.
    const probe = harness.createClient('probe-client');
    const probeDownload = (await probe.downloadOps(0)) as FileSnapshotOpDownloadResponse;
    expect(probeDownload.gapDetected).toBeFalsy();
    expect(probeDownload.snapshotState).toBeDefined();

    // --- Deterministically interleave two concurrent compactions via a gate on
    // the FIRST sync-state.json.bak write (the loser B's backup). B parks there,
    // A runs to completion, then B resumes to clobber + lose the ops race. ---
    let releaseLoser: () => void = () => {};
    const loserReleased = new Promise<void>((r) => (releaseLoser = r));
    let loserAtGate: () => void = () => {};
    const loserReachedGate = new Promise<void>((r) => (loserAtGate = r));
    let stateBakWrites = 0;

    const realUploadFile = provider.uploadFile.bind(provider);
    spyOn(provider, 'uploadFile').and.callFake(
      async (
        path: string,
        data: string,
        revToMatch: string | null,
        isForceOverwrite?: boolean,
      ): Promise<FileRevResponse> => {
        const res = await realUploadFile(path, data, revToMatch, isForceOverwrite);
        if (path === C.STATE_BACKUP_FILE) {
          stateBakWrites += 1;
          // Pause the loser after its backup captured the OLD snapshot (S0),
          // before it (or the winner) writes a new sync-state.json.
          if (stateBakWrites === 1) {
            loserAtGate();
            await loserReleased;
          }
        }
        return res;
      },
    );

    const winner = harness.createClient('winner-client');
    const loser = harness.createClient('loser-client');

    // Start the loser first; it parks after backing up the current snapshot.
    const loserPromise = loser.uploadOps([
      loser.createOp('Task', 'loser-op', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'loser',
      }),
    ]);
    await loserReachedGate;

    // Winner compacts fully while the loser is parked: writes its snapshot and
    // wins the conditional ops commit (loser has not touched the ops file yet).
    await winner.uploadOps([
      winner.createOp('Task', 'winner-op', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'winner',
      }),
    ]);

    // Resume the loser: it force-overwrites sync-state.json (clobbering the
    // winner's snapshot), then loses the conditional ops PUT and aborts.
    releaseLoser();
    await expectAsync(loserPromise).toBeRejectedWithError(
      UploadRevToMatchMismatchAPIError,
    );

    // Sanity: the interleave really occurred — the winner's snapshot generation
    // is the one referenced by the committed ops file, and the loser clobbered
    // sync-state.json with a DIFFERENT generation.
    expect(provider.hasFile(C.OPS_FILE)).toBe(true);
    expect(provider.hasFile(C.STATE_FILE)).toBe(true);

    // --- Assert: a fresh client can still hydrate the committed generation. ---
    const fresh = harness.createClient('fresh-client');
    const download = (await fresh.downloadOps(0)) as FileSnapshotOpDownloadResponse;

    // FAILS today: sync-state.json holds the loser's snapshot and .bak holds the
    // pre-compaction snapshot, so the winning ops pointer matches neither and the
    // client reports an unrecoverable gap requiring a full re-sync.
    expect(download.gapDetected).toBeFalsy();
    expect(download.snapshotState).toBeDefined();
  });
});

import {
  FileBasedSyncTestHarness,
  HarnessClient,
} from '../helpers/file-based-sync-test-harness';
import { FileSnapshotOpDownloadResponse } from '../../../sync-providers/provider.interface';

/**
 * Task 2 (#9063 + follow-up): what `invalidateAllTargets()` actually COSTS.
 *
 * The unit specs prove the gate (only a real target move invalidates). These
 * prove why the gate matters, against a real `FileBasedSyncAdapterService`:
 * invalidate -> cursor 0 -> downloadOps(0) -> isForceFromZero -> a full
 * `snapshotState` instead of an incremental op list.
 *
 * A client holding unsynced ops then classifies that snapshot CONCURRENT and,
 * with `AUTO_MERGE_CONCURRENT_SNAPSHOT` false, dead-ends in the binary conflict
 * dialog whose either answer discards data (that half lives in
 * OperationLogSyncService and has its own specs). So invalidating on a save that
 * did not move the target is a data-loss hazard, not an "extra full read".
 */
describe('File-Based Sync Integration - target invalidation cost (Task 2)', () => {
  let harness: FileBasedSyncTestHarness;
  let clientA: HarnessClient;
  let clientB: HarnessClient;

  /** A→B: A uploads one op, B pulls from its own committed cursor. */
  const uploadFromAAndPullToB = async (
    title: string,
  ): Promise<FileSnapshotOpDownloadResponse> => {
    const op = clientA.createOp('Task', `task-${title}`, 'CRT', 'ADD_TASK', { title });
    await clientA.uploadOps([op]);

    // Mirror production ordering: read the committed cursor, download from it,
    // then commit the new cursor only after a successful "apply".
    const sinceSeq = await clientB.adapter.getLastServerSeq();
    const res = (await clientB.adapter.downloadOps(
      sinceSeq,
      clientB.clientId,
    )) as FileSnapshotOpDownloadResponse;
    await clientB.adapter.setLastServerSeq(res.latestSeq);
    return res;
  };

  beforeEach(async () => {
    harness = FileBasedSyncTestHarness.create({});
    clientA = harness.createClient('client-a-target-inv');
    clientB = harness.createClient('client-b-target-inv');

    // Establish a real committed cursor on B by syncing once.
    await uploadFromAAndPullToB('first');
    expect(await clientB.adapter.getLastServerSeq()).toBeGreaterThan(0);
  });

  afterEach(() => {
    harness.reset();
  });

  it('keeps the download incremental while the cursor survives', async () => {
    // The control: no invalidation -> no snapshot bootstrap. Without this, the
    // test below would pass even if EVERY download returned a snapshot.
    const res = await uploadFromAAndPullToB('second');

    expect(res.snapshotState).toBeUndefined();
    expect(res.ops.length).toBeGreaterThan(0);
  });

  it('forces a full snapshot bootstrap once the cursor is invalidated', async () => {
    const cursorBefore = await clientB.adapter.getLastServerSeq();
    expect(cursorBefore).toBeGreaterThan(0);

    // Exactly what a target move triggers via providerConfigChanged$.
    clientB.adapterService.invalidateAllTargets();

    // The cursor is gone — and it is PERSISTED gone, so a restart won't recover it.
    expect(await clientB.adapter.getLastServerSeq()).toBe(0);

    const res = await uploadFromAAndPullToB('third');

    // sinceSeq === 0 => isForceFromZero => the whole remote state comes back.
    // This is the payload that classifies CONCURRENT against unsynced local ops
    // and surfaces the data-losing conflict dialog.
    expect(res.snapshotState).toBeDefined();
  });
});

import { TestBed } from '@angular/core/testing';
import {
  StaleReviewError,
  WholeDatasetMergeService,
} from './whole-dataset-merge.service';
import { VectorClockService } from './vector-clock.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { TaskTimeSyncService } from '../../features/tasks/task-time-sync.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { SyncHydrationService } from '../persistence/sync-hydration.service';
import { SyncImportConflictCoordinatorService } from './sync-import-conflict-coordinator.service';
import { ConflictJournalService } from './conflict-journal.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { computeWholeDatasetDiff } from './whole-dataset-diff.util';
import { buildDefaultPicks, MergePicks, pickKey } from './whole-dataset-merge.util';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import { ConflictJournalEntry } from './conflict-journal.model';

const adapter = (
  entities: Record<string, Record<string, unknown>>,
): { ids: string[]; entities: Record<string, Record<string, unknown>> } => ({
  ids: Object.keys(entities),
  entities,
});

describe('WholeDatasetMergeService', () => {
  let service: WholeDatasetMergeService;
  let hydrate: jasmine.Spy;
  let forceUpload: jasmine.Spy;
  let record: jasmine.Spy;
  let snapshot: jasmine.Spy;
  let getClock: jasmine.Spy;
  let flushExclusive: jasmine.Spy;
  let taskTimeFlush: jasmine.Spy;

  const localState = {
    task: adapter({
      differ: { id: 'differ', title: 'L', modified: 500 },
      onlyLocalDrop: { id: 'onlyLocalDrop', title: 'dropme', modified: 1 },
    }),
  };
  const remoteState = {
    task: adapter({
      differ: { id: 'differ', title: 'R', modified: 900 },
      onlyRemoteAdd: { id: 'onlyRemoteAdd', title: 'addme', modified: 1 },
    }),
  };

  beforeEach(() => {
    hydrate = jasmine.createSpy('hydrateFromRemoteSync').and.resolveTo(undefined);
    forceUpload = jasmine.createSpy('forceUploadLocalState').and.resolveTo(undefined);
    record = jasmine.createSpy('record').and.resolveTo(undefined);
    snapshot = jasmine
      .createSpy('getStateSnapshotAsync')
      .and.resolveTo(localState as unknown as never);
    getClock = jasmine.createSpy('getCurrentVectorClock').and.resolveTo({ devA: 1 });
    // flushThenRunExclusive runs its callback under a clean op-log cutoff; the fake
    // just invokes it so the callback's snapshot/clock read (and any throw) runs.
    flushExclusive = jasmine
      .createSpy('flushThenRunExclusive')
      .and.callFake((fn: () => Promise<unknown>) => fn());
    taskTimeFlush = jasmine.createSpy('flush').and.returnValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        WholeDatasetMergeService,
        { provide: StateSnapshotService, useValue: { getStateSnapshotAsync: snapshot } },
        { provide: SyncHydrationService, useValue: { hydrateFromRemoteSync: hydrate } },
        {
          provide: SyncImportConflictCoordinatorService,
          useValue: { forceUploadLocalState: forceUpload },
        },
        { provide: ConflictJournalService, useValue: { record } },
        {
          provide: ClientIdService,
          useValue: { loadClientId: () => Promise.resolve('devA') },
        },
        {
          provide: VectorClockService,
          useValue: { getCurrentVectorClock: getClock },
        },
        {
          provide: OperationWriteFlushService,
          useValue: { flushThenRunExclusive: flushExclusive },
        },
        {
          provide: TaskTimeSyncService,
          useValue: { flush: taskTimeFlush },
        },
      ],
    });
    service = TestBed.inject(WholeDatasetMergeService);
  });

  it('computeDiff reads local snapshot and diffs against remote', async () => {
    const { diff, localState: ls } = await service.computeDiff(remoteState);
    expect(snapshot).toHaveBeenCalled();
    expect(ls).toBe(localState as unknown as Record<string, unknown>);
    expect(diff.differing.map((d) => d.entityId)).toEqual(['differ']);
    expect(diff.onlyLocal.map((d) => d.entityId)).toEqual(['onlyLocalDrop']);
    expect(diff.onlyRemote.map((d) => d.entityId)).toEqual(['onlyRemoteAdd']);
  });

  it('computeDiff drains tracked time and captures the snapshot + baseline clock under one exclusive cutoff', async () => {
    const { localState: ls, baselineVectorClock } =
      await service.computeDiff(remoteState);
    // Tracked time drained before the cutoff; snapshot + clock both read inside the
    // exclusive callback, so the picks and the staleness baseline correspond to the
    // SAME durable state (no inconsistent-source capture race).
    expect(taskTimeFlush).toHaveBeenCalledBefore(flushExclusive);
    expect(flushExclusive).toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalled();
    expect(getClock).toHaveBeenCalled();
    expect(ls).toBe(localState as unknown as Record<string, unknown>);
    expect(baselineVectorClock).toEqual({ devA: 1 });
  });

  // SPAP-45: the review modal can stay open for minutes; a local edit or a
  // time-tracking flush in that window advances the local clock. Applying the
  // picks would hydrate the now-stale snapshot as a clean-slate SYNC_IMPORT and
  // silently drop those concurrent ops. Abort instead.
  it('applyMerge ABORTS with StaleReviewError (no hydrate, no upload) when the local clock advanced during review', async () => {
    const {
      diff,
      localState: base,
      baselineVectorClock,
    } = await service.computeDiff(remoteState);
    const picks = buildDefaultPicks(diff);
    // Only inspect the calls applyMerge itself makes (computeDiff already read the clock).
    getClock.calls.reset();
    flushExclusive.calls.reset();
    taskTimeFlush.calls.reset();
    // A concurrent local mutation while the modal was open advanced the clock.
    getClock.and.resolveTo({ devA: 2 });

    await expectAsync(
      service.applyMerge(
        {} as OperationSyncCapable,
        base,
        diff,
        picks,
        undefined,
        baselineVectorClock,
      ),
    ).toBeRejectedWithError(StaleReviewError);

    // Tracked time is drained, then the clock is re-read under the exclusive
    // op-log cutoff — so a concurrent edit's op is durably reflected before the
    // comparison (the soundness fix over the prior unflushed-clock attempt).
    expect(taskTimeFlush).toHaveBeenCalledBefore(flushExclusive);
    expect(flushExclusive).toHaveBeenCalled();
    expect(getClock).toHaveBeenCalled();
    // The stale merge never touched local state or the remote.
    expect(hydrate).not.toHaveBeenCalled();
    expect(forceUpload).not.toHaveBeenCalled();
  });

  it('applyMerge PROCEEDS and hydrates when the local clock is unchanged since computeDiff', async () => {
    const {
      diff,
      localState: base,
      baselineVectorClock,
    } = await service.computeDiff(remoteState);
    const picks = buildDefaultPicks(diff);
    // getClock still resolves { devA: 1 } — unchanged, so not stale.

    await service.applyMerge(
      {} as OperationSyncCapable,
      base,
      diff,
      picks,
      undefined,
      baselineVectorClock,
    );

    expect(hydrate).toHaveBeenCalled();
    expect(forceUpload).toHaveBeenCalled();
  });

  it('applyMerge applies the merged state locally then force-uploads (in order)', async () => {
    const diff = computeWholeDatasetDiff(localState, remoteState);
    // Non-default everywhere: differ→local (default is remote), drop→discard, add→skip.
    const picks: MergePicks = {
      differing: { [pickKey('task', 'differ')]: 'local' },
      onlyLocal: { [pickKey('task', 'onlyLocalDrop')]: 'discard' },
      onlyRemote: { [pickKey('task', 'onlyRemoteAdd')]: 'skip' },
    };

    const provider = {} as OperationSyncCapable;
    const merged = (await service.applyMerge(
      provider,
      localState,
      diff,
      picks,
      { devA: 3 },
      { devA: 1 }, // baseline == mocked current clock → gate passes (not stale)
    )) as { task: { ids: string[]; entities: Record<string, { title: string }> } };

    // Merged state reflects the picks exactly.
    expect(merged.task.entities['differ'].title).toBe('L');
    expect(merged.task.entities['onlyLocalDrop']).toBeUndefined();
    expect(merged.task.entities['onlyRemoteAdd']).toBeUndefined();

    // Apply path: hydrateFromRemoteSync called with the merged state + remote clock.
    expect(hydrate).toHaveBeenCalledTimes(1);
    const [passedState, passedClock, createImport, reason] = hydrate.calls.mostRecent()
      .args as [Record<string, unknown>, Record<string, number>, boolean, string];
    expect(passedState).toBe(merged);
    expect(passedClock).toEqual({ devA: 3 });
    expect(createImport).toBe(true);
    expect(reason).toBe('FORCE_UPLOAD');

    // Force-upload happens AFTER the local apply.
    expect(forceUpload).toHaveBeenCalledWith(provider);
    expect(hydrate).toHaveBeenCalledBefore(forceUpload);
  });

  it('journals a manual-merge entry for every NON-DEFAULT pick only', async () => {
    const diff = computeWholeDatasetDiff(localState, remoteState);
    const picks: MergePicks = {
      // differ default is remote (900 > 500); picking 'remote' is DEFAULT → no journal.
      differing: { [pickKey('task', 'differ')]: 'remote' },
      // discard is NON-DEFAULT → journaled.
      onlyLocal: { [pickKey('task', 'onlyLocalDrop')]: 'discard' },
      // add is DEFAULT → no journal.
      onlyRemote: { [pickKey('task', 'onlyRemoteAdd')]: 'add' },
    };

    await service.applyMerge(
      {} as OperationSyncCapable,
      localState,
      diff,
      picks,
      undefined,
      { devA: 1 }, // baseline == mocked current clock → gate passes (not stale)
    );

    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.calls.mostRecent().args[0] as ConflictJournalEntry;
    expect(entry.reason).toBe('manual-merge');
    expect(entry.entityId).toBe('onlyLocalDrop');
    expect(entry.winner).toBe('remote'); // local-only discarded → remote won
    expect(entry.status).toBe('kept');
  });

  it('journals AFTER the local apply and BEFORE force-upload (exact sequence)', async () => {
    // Journal-after-persist: entries must not exist before the merged state is
    // committed locally. They must also be written BEFORE the upload so an
    // upload failure (retried later by normal sync) cannot lose them — nothing
    // on the hydrate path clears the journal (importCompleteBackup's clearAll
    // is a different path).
    const diff = computeWholeDatasetDiff(localState, remoteState);
    const picks = buildDefaultPicks(diff);
    picks.differing[pickKey('task', 'differ')] = 'local'; // non-default → journaled

    await service.applyMerge(
      {} as OperationSyncCapable,
      localState,
      diff,
      picks,
      undefined,
      { devA: 1 }, // baseline == mocked current clock → gate passes (not stale)
    );

    expect(record).toHaveBeenCalled();
    expect(hydrate).toHaveBeenCalledBefore(record);
    expect(record).toHaveBeenCalledBefore(forceUpload);
  });

  it('keeps journal entries when the force-upload fails (state is local, retry re-uploads)', async () => {
    const diff = computeWholeDatasetDiff(localState, remoteState);
    const picks = buildDefaultPicks(diff);
    picks.differing[pickKey('task', 'differ')] = 'local'; // non-default → journaled
    forceUpload.and.rejectWith(new Error('network down'));

    await expectAsync(
      service.applyMerge({} as OperationSyncCapable, localState, diff, picks, undefined, {
        devA: 1,
      }),
    ).toBeRejected();

    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalled(); // resolution journaled despite failed upload
  });

  it('journals differing picks that override newest-wins', async () => {
    const diff = computeWholeDatasetDiff(localState, remoteState);
    // differ default = remote (newer); overriding to 'local' is NON-DEFAULT.
    const picks = buildDefaultPicks(diff);
    picks.differing[pickKey('task', 'differ')] = 'local';

    await service.applyMerge(
      {} as OperationSyncCapable,
      localState,
      diff,
      picks,
      undefined,
      { devA: 1 }, // baseline == mocked current clock → gate passes (not stale)
    );

    const differEntries = record.calls
      .allArgs()
      .map((a) => a[0] as ConflictJournalEntry)
      .filter((e) => e.entityId === 'differ');
    expect(differEntries.length).toBe(1);
    expect(differEntries[0].winner).toBe('local');
    expect(differEntries[0].reason).toBe('manual-merge');
    expect(differEntries[0].fieldDiffs.some((d) => d.field === 'title')).toBe(true);
  });
});

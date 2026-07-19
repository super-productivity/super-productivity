import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import {
  StaleReviewError,
  WholeDatasetMergeService,
} from './whole-dataset-merge.service';
import { VectorClockService } from './vector-clock.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { LockService } from './lock.service';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { SyncHydrationService } from '../persistence/sync-hydration.service';
import { SyncImportConflictCoordinatorService } from './sync-import-conflict-coordinator.service';
import { ConflictJournalService } from './conflict-journal.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { TaskTimeSyncService } from '../../features/tasks/task-time-sync.service';
import { buildDefaultPicks } from './whole-dataset-merge.util';
import { OperationSyncCapable } from '../sync-providers/provider.interface';

/**
 * Real-op integration test for the whole-dataset "Review differences" staleness
 * gate.
 *
 * The co-located unit spec proves the gate's branch LOGIC, but it does so through a
 * jasmine-spied `getCurrentVectorClock` and a faked `flushThenRunExclusive` — so it
 * cannot prove the two things the guard's soundness actually rests on: that a real
 * persisted op advances what the clock source returns, and that the real op-log
 * cutoff runs the comparison. The repo's sync rules require exactly that ("begin
 * with a reproducible failure ... not a mocked seam"; "confirm the fix actually
 * fires on a real op").
 *
 * So this test wires the REAL clock source (`VectorClockService` +
 * `OperationLogStoreService` over fake-indexeddb) and the REAL cutoff
 * (`OperationWriteFlushService` + `LockService` + `OperationCaptureService`), and
 * drives staleness with a genuinely persisted vector-clock advance rather than a spy
 * flip. Only the DESTRUCTIVE downstream (local hydrate, force-upload, journal) is
 * stubbed — those are precisely the effects the gate must PREVENT, asserted
 * never-called on the stale path.
 */
describe('WholeDatasetMergeService — stale-review gate (real op-log)', () => {
  let service: WholeDatasetMergeService;
  let store: OperationLogStoreService;
  let hydrate: jasmine.Spy;
  let forceUpload: jasmine.Spy;

  // Local vs remote snapshots that differ on exactly one entity, so buildDefaultPicks
  // yields a real (non-empty) merge that WOULD hydrate + upload if the gate let it.
  const localState = {
    task: { ids: ['t1'], entities: { t1: { id: 't1', title: 'L', modified: 500 } } },
  };
  const remoteState = {
    task: { ids: ['t1'], entities: { t1: { id: 't1', title: 'R', modified: 900 } } },
  };

  beforeEach(async () => {
    hydrate = jasmine.createSpy('hydrateFromRemoteSync').and.resolveTo(undefined);
    forceUpload = jasmine.createSpy('forceUploadLocalState').and.resolveTo(undefined);

    TestBed.configureTestingModule({
      providers: [
        WholeDatasetMergeService,
        // REAL clock source + REAL op-log cutoff — the machinery the gate depends on.
        VectorClockService,
        OperationLogStoreService,
        OperationWriteFlushService,
        LockService,
        OperationCaptureService,
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: { loadClientId: () => Promise.resolve('devA') },
        },
        // The local reviewable snapshot the diff + merged state are built from.
        {
          provide: StateSnapshotService,
          useValue: { getStateSnapshotAsync: () => Promise.resolve(localState) },
        },
        // DESTRUCTIVE downstream — stubbed so the test can assert the gate PREVENTS
        // it on the stale path (and lets it run on the clean path).
        { provide: SyncHydrationService, useValue: { hydrateFromRemoteSync: hydrate } },
        {
          provide: SyncImportConflictCoordinatorService,
          useValue: { forceUploadLocalState: forceUpload },
        },
        {
          provide: ConflictJournalService,
          useValue: { record: () => Promise.resolve() },
        },
        {
          provide: ClientIdService,
          useValue: { loadClientId: () => Promise.resolve('devA') },
        },
        { provide: TaskTimeSyncService, useValue: { flush: () => undefined } },
      ],
    });

    service = TestBed.inject(WholeDatasetMergeService);
    store = TestBed.inject(OperationLogStoreService);

    // Establish a known baseline as a REAL persisted clock (IndexedDB write via the
    // real store); each test overwrites this so the persistent fake-indexeddb DB
    // never leaks state across tests.
    await store.setVectorClock({ devA: 1 });
  });

  it('ABORTS with StaleReviewError when a real persisted op advances the clock during review — no hydrate, no upload, racing op survives', async () => {
    // Open review: capture diff + baseline through the REAL cutoff + REAL clock.
    const {
      diff,
      localState: base,
      baselineVectorClock,
    } = await service.computeDiff(remoteState);
    expect(baselineVectorClock).toEqual({ devA: 1 });
    const picks = buildDefaultPicks(diff);

    // A genuine concurrent local op lands while the modal is open: persist a REAL
    // vector-clock advance to the op-log store (what an UpdateTask op does durably).
    await store.setVectorClock({ devA: 2 });

    // Apply: the REAL gate re-reads the REAL advanced clock under the REAL cutoff and
    // must abort BEFORE touching local state or the remote.
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

    expect(hydrate).not.toHaveBeenCalled();
    expect(forceUpload).not.toHaveBeenCalled();
    // The racing op was not swallowed by a dominating SYNC_IMPORT clock: the advanced
    // clock is still the durable truth, so it will replay/sync normally.
    expect(await store.getVectorClock()).toEqual({ devA: 2 });
  });

  it('PROCEEDS (real hydrate + upload) when no real op advanced the clock during review', async () => {
    const {
      diff,
      localState: base,
      baselineVectorClock,
    } = await service.computeDiff(remoteState);
    const picks = buildDefaultPicks(diff);

    // No op persisted during "review": the real clock still equals the baseline.
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
});

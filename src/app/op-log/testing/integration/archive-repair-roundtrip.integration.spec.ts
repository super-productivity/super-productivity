import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { ArchiveOperationHandler } from '../../apply/archive-operation-handler.service';
import { ArchiveService } from '../../../features/archive/archive.service';
import { TaskArchiveService } from '../../../features/archive/task-archive.service';
import { TimeTrackingService } from '../../../features/time-tracking/time-tracking.service';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { OpType } from '../../core/operation.types';
import { PersistentAction } from '../../core/persistent-action.interface';
import { ArchiveModel } from '../../../features/archive/archive.model';

/**
 * Integration test for archive data surviving the REPAIR-op round-trip,
 * exercised against real IndexedDB.
 *
 * Guards the *consumer* side of the bug where a data repair on one client
 * wiped archived tasks on every *other* client. The *producer* side
 * (`validateAndRepairCurrentState()` calling `getStateSnapshotAsync()`) is
 * guarded by the unit spec `validate-state.service.spec.ts`; these tests do
 * not exercise `validateAndRepairCurrentState()` itself. The bug had two parts:
 *
 * 1. `validateAndRepairCurrentState()` built the REPAIR op from the synchronous
 *    `getStateSnapshot()`, which hardcodes empty archives (archiveYoung/archiveOld
 *    live in IndexedDB, not NgRx state).
 * 2. Other clients applied that REPAIR op via `ArchiveOperationHandler`, whose
 *    empty-archive guard only covered SYNC_IMPORT/BACKUP_IMPORT — so a REPAIR op
 *    with empty archives overwrote (wiped) the local archive.
 *
 * These tests wire the *real* `StateSnapshotService`, `ArchiveDbAdapter`,
 * `ArchiveStoreService` and `ArchiveOperationHandler` against real IndexedDB,
 * so they exercise the actual archive read/write seams — not mocks.
 *
 * The complementary unit spec `validate-state.service.spec.ts` proves that
 * `validateAndRepairCurrentState()` itself now calls `getStateSnapshotAsync()`.
 */
describe('Archive REPAIR round-trip integration', () => {
  let storeService: OperationLogStoreService;
  let stateSnapshot: StateSnapshotService;
  let archiveDb: ArchiveDbAdapter;
  let archiveHandler: ArchiveOperationHandler;

  // Cast: the archive round-trip only reads `task.ids`; entity contents are
  // stored/loaded as an opaque blob, so minimal task stubs are sufficient.
  const archiveModel = (taskIds: string[]): ArchiveModel =>
    ({
      task: {
        ids: taskIds,
        entities: Object.fromEntries(
          taskIds.map((id) => [id, { id, title: `Archived ${id}`, isDone: true }]),
        ),
      },
      timeTracking: { project: {}, tag: {} },
      lastTimeTrackingFlush: 0,
    }) as unknown as ArchiveModel;

  /** Builds the action `OperationApplierService` dispatches when applying a REPAIR op. */
  const repairApplyAction = (appDataComplete: unknown): PersistentAction =>
    ({
      ...loadAllData({ appDataComplete: appDataComplete as never }),
      meta: { isPersistent: true, isRemote: true, opType: OpType.Repair },
    }) as unknown as PersistentAction;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        OperationLogStoreService,
        StateSnapshotService,
        ArchiveDbAdapter,
        ArchiveOperationHandler,
        // Lazy deps of ArchiveOperationHandler — never reached by the loadAllData
        // path, stubbed so construction does not pull their real dependency trees.
        { provide: ArchiveService, useValue: {} },
        { provide: TaskArchiveService, useValue: {} },
        { provide: TimeTrackingService, useValue: {} },
      ],
    });

    storeService = TestBed.inject(OperationLogStoreService);
    stateSnapshot = TestBed.inject(StateSnapshotService);
    archiveDb = TestBed.inject(ArchiveDbAdapter);
    archiveHandler = TestBed.inject(ArchiveOperationHandler);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    // Archive stores are SUP_OPS singletons shared across tests — reset explicitly.
    await archiveDb.saveArchiveYoung(archiveModel([]));
    await archiveDb.saveArchiveOld(archiveModel([]));
  });

  it('getStateSnapshotAsync() includes IndexedDB archives; getStateSnapshot() returns them empty', async () => {
    await archiveDb.saveArchiveYoung(archiveModel(['y1', 'y2']));
    await archiveDb.saveArchiveOld(archiveModel(['o1']));

    // The sync snapshot hardcodes empty archives — this is what made REPAIR ops
    // built from it wipe other clients.
    const syncSnap = stateSnapshot.getStateSnapshot();
    expect(syncSnap.archiveYoung.task.ids).toEqual([]);
    expect(syncSnap.archiveOld.task.ids).toEqual([]);

    // The async snapshot loads the real archives — the REPAIR op now relies on this.
    const asyncSnap = await stateSnapshot.getStateSnapshotAsync();
    expect(asyncSnap.archiveYoung.task.ids).toEqual(['y1', 'y2']);
    expect(asyncSnap.archiveOld.task.ids).toEqual(['o1']);
  });

  it('archive round-trips from client A IndexedDB through a REPAIR op into client B IndexedDB', async () => {
    // --- Client A has archived tasks ---
    await archiveDb.saveArchiveYoung(archiveModel(['y1', 'y2']));
    await archiveDb.saveArchiveOld(archiveModel(['o1']));

    // Client A builds the REPAIR op payload from the async snapshot (the fix).
    const repairAppData = await stateSnapshot.getStateSnapshotAsync();

    // --- Handoff: client B is a fresh client with no archive ---
    await archiveDb.saveArchiveYoung(archiveModel([]));
    await archiveDb.saveArchiveOld(archiveModel([]));
    expect((await archiveDb.loadArchiveYoung())!.task.ids).toEqual([]);
    expect((await archiveDb.loadArchiveOld())!.task.ids).toEqual([]);

    // --- Client B applies the REPAIR op ---
    await archiveHandler.handleOperation(repairApplyAction(repairAppData));

    // --- Client B now has client A's archive ---
    expect((await archiveDb.loadArchiveYoung())!.task.ids).toEqual(['y1', 'y2']);
    expect((await archiveDb.loadArchiveOld())!.task.ids).toEqual(['o1']);
  });

  it('a REPAIR op built from the sync snapshot has empty archives and no longer wipes a client that has data', async () => {
    // --- Client B already has archived tasks ---
    await archiveDb.saveArchiveYoung(archiveModel(['keep-young-1']));
    await archiveDb.saveArchiveOld(archiveModel(['keep-old-1']));

    // A pre-fix REPAIR op, built from the sync snapshot, carries empty archives.
    const buggyAppData = stateSnapshot.getStateSnapshot();
    expect(buggyAppData.archiveYoung.task.ids).toEqual([]);
    expect(buggyAppData.archiveOld.task.ids).toEqual([]);

    await archiveHandler.handleOperation(repairApplyAction(buggyAppData));

    // The empty-archive guard preserves the local archive instead of wiping it.
    expect((await archiveDb.loadArchiveYoung())!.task.ids).toEqual(['keep-young-1']);
    expect((await archiveDb.loadArchiveOld())!.task.ids).toEqual(['keep-old-1']);
  });
});

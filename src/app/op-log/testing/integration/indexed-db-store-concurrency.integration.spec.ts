import { TestBed } from '@angular/core/testing';
import { ActionType, EntityType, Operation, OpType } from '../../core/operation.types';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ArchiveStoreService } from '../../persistence/archive-store.service';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../../util/client-id.provider';
import { ArchiveModel } from '../../../features/archive/archive.model';

/** Concurrent op-log and archive writes through the default IndexedDB adapters. */
const mockClientIdProvider: ClientIdProvider = {
  loadClientId: () => Promise.resolve('testClient'),
  getOrGenerateClientId: () => Promise.resolve('testClient'),
  clearCache: () => {},
};

const makeOp = (id: string, overrides: Partial<Operation> = {}): Operation => ({
  id,
  actionType: '[Task] Update' as ActionType,
  opType: OpType.Update,
  entityType: 'TASK' as EntityType,
  entityId: id,
  payload: {},
  clientId: 'testClient',
  vectorClock: { testClient: 1 },
  timestamp: 1,
  schemaVersion: 1,
  ...overrides,
});

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

/** Structured clone rejects functions, aborting the archive transaction. */
const unstorableArchive = (): ArchiveModel =>
  ({ fn: () => undefined }) as unknown as ArchiveModel;

describe('Op-log + archive store concurrency (IndexedDB)', () => {
  let opLogStore: OperationLogStoreService;
  let archiveStore: ArchiveStoreService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        OperationLogStoreService,
        ArchiveStoreService,
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
      ],
    });
    opLogStore = TestBed.inject(OperationLogStoreService);
    archiveStore = TestBed.inject(ArchiveStoreService);
    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    await archiveStore._clearAllDataForTesting();
  });

  it('op-log appends racing archive flushes all land (no lost ops)', async () => {
    // Start the op-log and archive writes concurrently.
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      work.push(opLogStore.appendBatch([makeOp(`batch-${i}-a`), makeOp(`batch-${i}-b`)]));
      work.push(
        archiveStore.saveArchivesAtomic(archiveModel([`y${i}`]), archiveModel([])),
      );
      work.push(opLogStore.append(makeOp(`single-${i}`)));
    }
    await Promise.all(work);

    const ops = await opLogStore.getOpsAfterSeq(0);
    expect(ops.length).toBe(30);
    const young = await archiveStore.loadArchiveYoung();
    expect(young?.task.ids).toEqual(['y9']);
  });

  it('a failing archive transaction rolls back alone, not a concurrent op append', async () => {
    // The archive tx writes ARCHIVE_YOUNG, then fails on ARCHIVE_OLD → ROLLBACK
    // while the append below is in flight on another connection.
    const failing = archiveStore
      .saveArchivesAtomic(archiveModel(['y']), unstorableArchive())
      .then(
        () => 'committed' as const,
        () => 'rolled-back' as const,
      );
    const append = opLogStore.append(makeOp('survivor'));
    const [outcome] = await Promise.all([failing, append]);

    expect(outcome).toBe('rolled-back');
    // The archive's own first write was rolled back with it…
    expect(await archiveStore.loadArchiveYoung()).toBeUndefined();
    // …and the concurrent append was not.
    expect((await opLogStore.getOpsAfterSeq(0)).map((e) => e.op.id)).toEqual([
      'survivor',
    ]);
  });

  it('hasSyncedOps() is false on a never-synced client with only local ops (#8312)', async () => {
    await opLogStore.append(makeOp('local-only'), 'local');
    // A record without syncedAt is absent from the bySyncedAt index.
    expect(await opLogStore.hasSyncedOps()).toBeFalse();
    await opLogStore.append(makeOp('remote-op', { clientId: 'other' }), 'remote');
    expect(await opLogStore.hasSyncedOps()).toBeTrue();
  });
});

import { TestBed } from '@angular/core/testing';
import { RepairOperationService } from './repair-operation.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { DbKey, OpLogDbAdapter } from '../persistence/op-log-db-adapter';
import { SINGLETON_KEY, STORE_NAMES } from '../persistence/db-keys.const';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { SnackService } from '../../core/snack/snack.service';
import { TranslateService } from '@ngx-translate/core';
import { RepairSummary } from '../core/operation.types';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import { DEFAULT_TASK } from '../../features/tasks/task.model';

/**
 * Regression tests for #8939: the REPAIR clock must be derived from the
 * DURABLE vector clock at write time, not from the per-tab in-memory cache.
 *
 * The in-memory clock cache can be stale when another tab advanced the durable
 * clock (Web Locks serialize writers across tabs, but each tab keeps its own
 * cache). Before the fix, createRepairOperation incremented the stale cached
 * clock and OVERWROTE the durable clock with it — regressing this client's
 * counter and making already-used counters reusable by the next capture.
 */
describe('RepairOperationService clock derivation (#8939)', () => {
  let service: RepairOperationService;
  let opLogStore: OperationLogStoreService;

  const mockClientIdProvider: ClientIdProvider = {
    loadClientId: () => Promise.resolve('testClient'),
    getOrGenerateClientId: () => Promise.resolve('testClient'),
    clearCache: () => {},
  };

  const repairedState = {
    task: { entities: {}, ids: [] },
    project: { entities: {}, ids: [] },
  };

  const repairSummary: RepairSummary = {
    entityStateFixed: 1,
    orphanedEntitiesRestored: 0,
    invalidReferencesRemoved: 0,
    relationshipsFixed: 0,
    structureRepaired: 0,
    typeErrorsFixed: 0,
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        RepairOperationService,
        OperationLogStoreService,
        VectorClockService,
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        {
          provide: TranslateService,
          useValue: jasmine.createSpyObj('TranslateService', ['instant']),
        },
        {
          provide: StateSnapshotService,
          useValue: jasmine.createSpyObj('StateSnapshotService', [
            'getStateSnapshotAsync',
          ]),
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });

    service = TestBed.inject(RepairOperationService);
    opLogStore = TestBed.inject(OperationLogStoreService);
    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
  });

  /** Writes the durable clock directly, bypassing this instance's cache — as another tab would. */
  const advanceDurableClockBehindCache = async (
    clock: Record<string, number>,
  ): Promise<void> => {
    const adapter = (opLogStore as unknown as { _adapter: OpLogDbAdapter })._adapter;
    await adapter.transaction([STORE_NAMES.VECTOR_CLOCK], 'readwrite', async (tx) => {
      await tx.put(
        STORE_NAMES.VECTOR_CLOCK,
        { clock, lastUpdate: Date.now() },
        SINGLETON_KEY,
      );
    });
  };

  it('derives the repair clock from the durable clock even when the in-memory cache is stale', async () => {
    // Durable clock + this tab's cache both at {testClient: 3}.
    await opLogStore.setVectorClock({ testClient: 3 });

    // Another tab advances the durable clock; our cache still says 3.
    await advanceDurableClockBehindCache({ testClient: 9, otherTab: 2 });

    await service.createRepairOperation(repairedState, repairSummary, 'testClient');

    opLogStore.clearVectorClockCache();
    const durable = await opLogStore.getVectorClock();
    // Pre-fix: repair derived {testClient: 4} from the stale cache and
    // overwrote the durable clock with it — regressing 9 → 4, so the next
    // capture would reuse counters 5–9 already shipped by the other tab.
    expect(durable).toEqual({ testClient: 10, otherTab: 2 });

    // The written REPAIR op must carry the rebased clock (it is what uploads).
    const ops = await opLogStore.getOpsAfterSeq(0);
    expect(ops.length).toBe(1);
    expect(ops[0].op.vectorClock).toEqual({ testClient: 10, otherTab: 2 });

    // The state cache must record the clock actually written, not the stale one.
    expect((await opLogStore.loadStateCache())?.vectorClock).toEqual({
      testClient: 10,
      otherTab: 2,
    });
  });

  for (const failedStore of [STORE_NAMES.ARCHIVE_YOUNG, STORE_NAMES.ARCHIVE_OLD]) {
    it(`rolls back the repair, clock and both archives when ${failedStore} fails`, async () => {
      const archive = (id: string): ArchiveModel => ({
        task: {
          ids: [id],
          entities: { [id]: { ...DEFAULT_TASK, id, projectId: 'INBOX' } },
        },
        timeTracking: { project: {}, tag: {} },
      });
      const before = {
        ...repairedState,
        archiveYoung: archive('before-young'),
        archiveOld: archive('before-old'),
      };
      const after = {
        ...repairedState,
        archiveYoung: archive('after-young'),
        archiveOld: archive('after-old'),
      };
      await service.createRepairOperation(before, repairSummary, 'testClient');
      const pendingBefore = await opLogStore.getUnsynced();
      const clockBefore = await opLogStore.getVectorClock();
      const cacheBefore = await opLogStore.loadStateCache();
      const adapter = (opLogStore as unknown as { _adapter: OpLogDbAdapter })._adapter;
      const transaction = adapter.transaction.bind(adapter);
      const fail = spyOn(adapter, 'transaction').and.callFake((stores, mode, callback) =>
        transaction(stores, mode, (tx) =>
          callback(
            new Proxy(tx, {
              get: (target, property): unknown => {
                if (property === 'put') {
                  return async (name: string, value: unknown, key?: DbKey) => {
                    await target.put(name, value, key);
                    if (name === failedStore) throw new Error('injected archive failure');
                  };
                }
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
          ),
        ),
      );

      await expectAsync(
        service.createRepairOperation(after, repairSummary, 'testClient'),
      ).toBeRejectedWithError('injected archive failure');
      opLogStore.clearVectorClockCache();
      expect(await opLogStore.getVectorClock()).toEqual(clockBefore);
      expect(await opLogStore.getUnsynced()).toEqual(pendingBefore);
      expect(await opLogStore.loadStateCache()).toEqual(cacheBefore);
      expect((await opLogStore.getLatestFullStateOp())?.id).toBe(pendingBefore[0].op.id);
      for (const [name, data] of [
        [STORE_NAMES.ARCHIVE_YOUNG, before.archiveYoung],
        [STORE_NAMES.ARCHIVE_OLD, before.archiveOld],
      ] as const) {
        expect(await adapter.get(name, SINGLETON_KEY)).toEqual({
          id: SINGLETON_KEY,
          data,
        });
      }

      // The aborted transaction does not consume the counter or strand retry.
      fail.and.callThrough();
      await service.createRepairOperation(after, repairSummary, 'testClient');
      expect(await opLogStore.getVectorClock()).toEqual({ testClient: 2 });
      expect(await opLogStore.getUnsynced()).toHaveSize(2);
      expect(await adapter.get(STORE_NAMES.ARCHIVE_YOUNG, SINGLETON_KEY)).toEqual({
        id: SINGLETON_KEY,
        data: after.archiveYoung,
      });
      expect(await adapter.get(STORE_NAMES.ARCHIVE_OLD, SINGLETON_KEY)).toEqual({
        id: SINGLETON_KEY,
        data: after.archiveOld,
      });
    });
  }
});

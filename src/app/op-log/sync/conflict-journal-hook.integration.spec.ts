import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { ConflictResolutionService } from './conflict-resolution.service';
import { ConflictJournalService } from './conflict-journal.service';
import { OperationApplierService } from '../apply/operation-applier.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { SnackService } from '../../core/snack/snack.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { OperationLogEffects } from '../capture/operation-log.effects';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../core/entity-registry';
import { toEntityKey } from '../util/entity-key.util';
import {
  ActionType,
  EntityConflict,
  EntityType,
  OpType,
  Operation,
  VectorClock,
} from '../core/operation.types';

/**
 * SPAP-13 — Verifies the observe-only journal hook end-to-end through the real
 * ConflictResolutionService:
 *  - a genuine CONCURRENT conflict is journaled exactly once;
 *  - one-sided / sequential (GREATER_THAN + LESS_THAN) / EQUAL scenarios are
 *    NEVER even detected as conflicts, so ZERO entries are written;
 *  - journaling does not change which op LWW picks (observe-only).
 */
describe('ConflictResolution → ConflictJournal hook (integration)', () => {
  let service: ConflictResolutionService;
  let journal: ConflictJournalService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockOperationApplier: jasmine.SpyObj<OperationApplierService>;

  const ENTITY_TYPE = 'TASK' as EntityType;
  const ENTITY_ID = 'task-1';
  const KEY = toEntityKey(ENTITY_TYPE, ENTITY_ID);

  const op = (over: Partial<Operation> = {}): Operation => ({
    id: `op-${Math.random().toString(36).slice(2)}`,
    actionType: '[Task] Update' as ActionType,
    opType: OpType.Update,
    entityType: ENTITY_TYPE,
    entityId: ENTITY_ID,
    payload: { task: { id: ENTITY_ID, title: 'x' } },
    clientId: 'A',
    vectorClock: { A: 1 },
    timestamp: 1000,
    schemaVersion: 1,
    ...over,
  });

  interface Ctx {
    localPendingOpsByEntity: Map<string, Operation[]>;
    appliedFrontierByEntity: Map<string, VectorClock>;
    snapshotVectorClock: VectorClock | undefined;
    snapshotEntityKeys: Set<string> | undefined;
    hasNoSnapshotClock: boolean;
  }

  const ctx = (over: Partial<Ctx> = {}): Ctx => ({
    localPendingOpsByEntity: new Map(),
    appliedFrontierByEntity: new Map(),
    snapshotVectorClock: undefined,
    snapshotEntityKeys: undefined,
    hasNoSnapshotClock: true,
    ...over,
  });

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['select']);
    mockStore.select.and.returnValue(of(undefined));

    mockOperationApplier = jasmine.createSpyObj('OperationApplierService', [
      'applyOperations',
    ]);
    mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'appendBatchSkipDuplicates',
      'appendMixedSourceBatchSkipDuplicates',
      'appendWithVectorClockUpdate',
      'markApplied',
      'markRejected',
      'markFailed',
      'getUnsyncedByEntity',
      'mergeRemoteOpClocks',
      'markReducersCommittedAndMergeClocks',
    ]);
    mockOpLogStore.mergeRemoteOpClocks.and.resolveTo(undefined);
    mockOpLogStore.markReducersCommittedAndMergeClocks.and.resolveTo(undefined);
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(async (batches) => ({
      written: batches.flatMap((batch) =>
        batch.ops.map((batchOp, index) => ({
          seq: index + 1,
          op: batchOp,
          source: batch.source,
        })),
      ),
      skippedCount: 0,
    }));
    mockOpLogStore.getUnsyncedByEntity.and.resolveTo(new Map());
    mockOpLogStore.appendWithVectorClockUpdate.and.resolveTo(undefined);
    mockOpLogStore.markRejected.and.resolveTo(undefined);
    mockOpLogStore.appendBatchSkipDuplicates.and.callFake((ops: Operation[]) =>
      Promise.resolve({
        seqs: ops.map((_, i) => i + 1),
        writtenOps: ops,
        skippedCount: 0,
      }),
    );

    const mockValidate = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepairCurrentState',
    ]);
    mockValidate.validateAndRepairCurrentState.and.resolveTo(true);

    const mockEffects = jasmine.createSpyObj('OperationLogEffects', [
      'processDeferredActions',
    ]);
    mockEffects.processDeferredActions.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        ConflictResolutionService,
        { provide: Store, useValue: mockStore },
        { provide: OperationApplierService, useValue: mockOperationApplier },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        { provide: ValidateStateService, useValue: mockValidate },
        { provide: OperationLogEffects, useValue: mockEffects },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: { loadClientId: () => Promise.resolve('A') },
        },
        { provide: ENTITY_REGISTRY, useValue: buildEntityRegistry() },
      ],
    });

    service = TestBed.inject(ConflictResolutionService);
    journal = TestBed.inject(ConflictJournalService);
  });

  it('journals exactly ONE entry for a genuine CONCURRENT conflict', async () => {
    // local frontier {A:1}, remote {B:1} → CONCURRENT.
    const remoteOp = op({ clientId: 'B', vectorClock: { B: 1 }, timestamp: 1000 });
    const localOp = op({
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: { task: { id: ENTITY_ID, title: 'Local' } },
    });

    const detection = await service.checkOpForConflicts(
      remoteOp,
      ctx({
        localPendingOpsByEntity: new Map([[KEY, [localOp]]]),
        appliedFrontierByEntity: new Map([[KEY, { A: 1 }]]),
        hasNoSnapshotClock: false,
        snapshotVectorClock: { A: 1 },
        snapshotEntityKeys: new Set([KEY]),
      }),
    );

    expect(detection.conflicts.length).toBe(1);

    await service.autoResolveConflictsLWW(detection.conflicts);

    const entries = await journal.list('history');
    expect(entries.length).toBe(1);
    expect(entries[0].entityId).toBe(ENTITY_ID);
    expect(entries[0].reason).toBe('newer'); // local ts newer, same field
  });

  describe('regression guard: NON-conflicts are never detected → ZERO journal entries', () => {
    const nonConflictCases: Array<{ name: string; run: () => Promise<unknown> }> = [
      {
        name: 'sequential GREATER_THAN (local dominates)',
        run: () =>
          service.checkOpForConflicts(
            op({ clientId: 'B', vectorClock: { A: 1 } }),
            ctx({
              localPendingOpsByEntity: new Map([[KEY, [op({ vectorClock: { A: 2 } })]]]),
              appliedFrontierByEntity: new Map([[KEY, { A: 2 }]]),
              hasNoSnapshotClock: false,
              snapshotVectorClock: { A: 2 },
              snapshotEntityKeys: new Set([KEY]),
            }),
          ),
      },
      {
        name: 'sequential LESS_THAN (remote dominates)',
        run: () =>
          service.checkOpForConflicts(
            op({ clientId: 'B', vectorClock: { A: 2 } }),
            ctx({
              localPendingOpsByEntity: new Map([[KEY, [op({ vectorClock: { A: 1 } })]]]),
              appliedFrontierByEntity: new Map([[KEY, { A: 1 }]]),
              hasNoSnapshotClock: false,
              snapshotVectorClock: { A: 1 },
              snapshotEntityKeys: new Set([KEY]),
            }),
          ),
      },
      {
        name: 'EQUAL duplicate',
        run: () =>
          service.checkOpForConflicts(
            op({ clientId: 'B', vectorClock: { A: 1 } }),
            ctx({
              localPendingOpsByEntity: new Map([[KEY, [op({ vectorClock: { A: 1 } })]]]),
              appliedFrontierByEntity: new Map([[KEY, { A: 1 }]]),
              hasNoSnapshotClock: false,
              snapshotVectorClock: { A: 1 },
              snapshotEntityKeys: new Set([KEY]),
            }),
          ),
      },
      {
        name: 'one-sided edit (no pending local ops, no local state)',
        run: () =>
          service.checkOpForConflicts(
            op({ clientId: 'B', vectorClock: { B: 1 } }),
            ctx({ snapshotEntityKeys: new Set() }),
          ),
      },
    ];

    nonConflictCases.forEach(({ name, run }) => {
      it(`${name} → no conflict, zero entries`, async () => {
        const result = (await run()) as { conflicts: EntityConflict[] };
        expect(result.conflicts).toEqual([]);
        expect((await journal.list('history')).length).toBe(0);
      });
    });
  });

  it('observe-only: winner ops are identical whether journaling succeeds or throws', async () => {
    const buildConflict = (): EntityConflict => ({
      entityType: ENTITY_TYPE,
      entityId: ENTITY_ID,
      localOps: [
        op({
          id: 'local-1',
          clientId: 'A',
          vectorClock: { A: 1 },
          timestamp: 2000,
          payload: { task: { id: ENTITY_ID, title: 'Local' } },
        }),
      ],
      remoteOps: [
        op({
          id: 'remote-1',
          clientId: 'B',
          vectorClock: { B: 1 },
          timestamp: 1000,
          payload: { task: { id: ENTITY_ID, title: 'Remote' } },
        }),
      ],
      suggestedResolution: 'manual',
    });

    // Control run: journaling works normally.
    await service.autoResolveConflictsLWW([buildConflict()]);
    const controlRejected = mockOpLogStore.markRejected.calls.allArgs();
    const controlAppended = mockOpLogStore.appendWithVectorClockUpdate.calls
      .allArgs()
      .map(([o]) => (o as Operation).entityId);

    mockOpLogStore.markRejected.calls.reset();
    mockOpLogStore.appendWithVectorClockUpdate.calls.reset();

    // Sabotaged run: force record() to reject — resolution must be unaffected.
    spyOn(journal, 'record').and.rejectWith(new Error('journal boom'));

    await service.autoResolveConflictsLWW([buildConflict()]);
    const sabotagedRejected = mockOpLogStore.markRejected.calls.allArgs();
    const sabotagedAppended = mockOpLogStore.appendWithVectorClockUpdate.calls
      .allArgs()
      .map(([o]) => (o as Operation).entityId);

    expect(sabotagedRejected).toEqual(controlRejected);
    expect(sabotagedAppended).toEqual(controlAppended);
  });
});

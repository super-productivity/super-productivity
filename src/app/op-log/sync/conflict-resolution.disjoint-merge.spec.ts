import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ConflictResolutionService } from './conflict-resolution.service';
import { ConflictJournalService } from './conflict-journal.service';
import { Store } from '@ngrx/store';
import { OperationApplierService } from '../apply/operation-applier.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { SnackService } from '../../core/snack/snack.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { OperationLogEffects } from '../capture/operation-log.effects';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../core/entity-registry';
import { ActionType, EntityConflict, OpType, Operation } from '../core/operation.types';
import {
  compareVectorClocks,
  incrementVectorClock,
  mergeVectorClocks,
  VectorClockComparison,
} from '../../core/util/vector-clock';
import {
  synthesizeMergedEntity,
  isDisjointMergeEligible,
} from './conflict-disjoint-merge.util';

/**
 * SPAP-14 — disjoint-field auto-merge acceptance tests.
 *
 * (a) title-vs-notes concurrent edit → merged entity keeps BOTH; journal
 *     merged/disjoint-merge/info; not in unreviewed.
 * (b) title-vs-title (same field) → LWW unchanged; journal unreviewed.
 * (c) disjoint real fields + both bumped a NOISE field → still merges; noise
 *     field resolved deterministically.
 * (d) edit-vs-delete → delete wins, NO merge.
 * (e) two-client convergence: both orderings yield identical entity + dominating
 *     clocks.
 */
describe('ConflictResolutionService — SPAP-14 disjoint-field merge', () => {
  let service: ConflictResolutionService;
  let journal: ConflictJournalService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockOperationApplier: jasmine.SpyObj<OperationApplierService>;

  const CLIENT_ID = 'client-local';

  const op = (over: Partial<Operation> = {}): Operation => ({
    id: `op-${Math.random().toString(36).slice(2)}`,
    clientId: 'A',
    actionType: '[Task] Update' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: 'task-1',
    payload: { task: { id: 'task-1', changes: {} } },
    vectorClock: { A: 1 },
    timestamp: 1000,
    schemaVersion: 1,
    ...over,
  });

  const conflictOf = (localOps: Operation[], remoteOps: Operation[]): EntityConflict => ({
    entityType: 'TASK',
    entityId: 'task-1',
    localOps,
    remoteOps,
    suggestedResolution: 'manual',
  });

  const mergedOpArgs = (): Operation | undefined =>
    mockOpLogStore.appendWithVectorClockUpdate.calls
      .allArgs()
      .map(([o]) => o as Operation)
      .find((o) => o.entityId === 'task-1' && o.opType === OpType.Update);

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['select']);
    mockStore.select.and.returnValue(of(undefined));

    mockOperationApplier = jasmine.createSpyObj('OperationApplierService', [
      'applyOperations',
    ]);
    mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'appendBatchSkipDuplicates',
      'appendWithVectorClockUpdate',
      'markApplied',
      'markRejected',
      'markFailed',
      'getUnsyncedByEntity',
      'mergeRemoteOpClocks',
    ]);
    mockOpLogStore.mergeRemoteOpClocks.and.resolveTo(undefined);
    mockOpLogStore.getUnsyncedByEntity.and.resolveTo(new Map());
    mockOpLogStore.markRejected.and.resolveTo(undefined);
    mockOpLogStore.markApplied.and.resolveTo(undefined);
    mockOpLogStore.appendWithVectorClockUpdate.and.resolveTo(1);
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
          useValue: { loadClientId: () => Promise.resolve(CLIENT_ID) },
        },
        { provide: ENTITY_REGISTRY, useValue: buildEntityRegistry() },
      ],
    });

    service = TestBed.inject(ConflictResolutionService);
    journal = TestBed.inject(ConflictJournalService);
  });

  // ── (a) title vs notes → merge both ────────────────────────────────────────
  it('(a) merges concurrent title-vs-notes edits into one op keeping BOTH', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'Local title', notes: 'base notes' }),
    );

    const localOp = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteOp = op({
      id: 'remote-1',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { notes: 'Remote notes' } } },
    });

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]);

    // A single synthesized merged op carries BOTH changes.
    const merged = mergedOpArgs();
    expect(merged).toBeDefined();
    const payload = merged!.payload as Record<string, unknown>;
    expect(payload['title']).toBe('Local title');
    expect(payload['notes']).toBe('Remote notes');

    // BOTH original ops are superseded (rejected).
    const rejected = mockOpLogStore.markRejected.calls.allArgs().flat(2);
    expect(rejected).toContain('local-1');
    expect(rejected).toContain('remote-1');

    // Merged clock dominates both original ops.
    expect(compareVectorClocks(merged!.vectorClock, { A: 1 })).toBe(
      VectorClockComparison.GREATER_THAN,
    );
    expect(compareVectorClocks(merged!.vectorClock, { B: 1 })).toBe(
      VectorClockComparison.GREATER_THAN,
    );

    // Journal: merged / disjoint-merge / info, and NOT counted as unreviewed.
    const entries = await journal.list('history');
    expect(entries.length).toBe(1);
    expect(entries[0].winner).toBe('merged');
    expect(entries[0].reason).toBe('disjoint-merge');
    expect(entries[0].status).toBe('info');
    expect((await journal.list('unreviewed')).length).toBe(0);
  });

  // ── (b) title vs title → LWW unchanged ─────────────────────────────────────
  it('(b) leaves same-field (title-vs-title) conflicts to LWW (journal unreviewed)', async () => {
    mockStore.select.and.returnValue(of({ id: 'task-1', title: 'Local title' }));

    const localOp = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteOp = op({
      id: 'remote-1',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { title: 'Remote title' } } },
    });

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]);

    const entries = await journal.list('history');
    expect(entries.length).toBe(1);
    expect(entries[0].reason).toBe('newer'); // local ts newer, same field
    expect(entries[0].winner).toBe('local');
    expect(entries[0].status).toBe('unreviewed');
    expect((await journal.list('unreviewed')).length).toBe(1);
  });

  // ── (c) disjoint real fields + both bumped a noise field → still merges ─────
  it('(c) merges when disjoint real fields also both bump a NOISE field (deterministic tiebreak)', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'Local title', notes: 'base', modified: 1111 }),
    );

    const localOp = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000, // older → loses the noise tiebreak
      payload: {
        task: { id: 'task-1', changes: { title: 'Local title', modified: 1111 } },
      },
    });
    const remoteOp = op({
      id: 'remote-1',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 2000, // newer → wins the noise tiebreak
      payload: {
        task: { id: 'task-1', changes: { notes: 'Remote notes', modified: 2222 } },
      },
    });

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]);

    const merged = mergedOpArgs();
    expect(merged).toBeDefined();
    const payload = merged!.payload as Record<string, unknown>;
    expect(payload['title']).toBe('Local title');
    expect(payload['notes']).toBe('Remote notes');
    // The noise field resolves to the greater-(timestamp) side, NOT simply the
    // local current-state value.
    expect(payload['modified']).toBe(2222);

    const entries = await journal.list('history');
    expect(entries[0].reason).toBe('disjoint-merge');
    expect(entries[0].status).toBe('info');
  });

  // ── (d) edit vs delete → delete wins, NO merge ─────────────────────────────
  it('(d) never merges an edit-vs-delete conflict (delete-wins path unchanged)', async () => {
    const localOp = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteDelete = op({
      id: 'remote-1',
      clientId: 'B',
      opType: OpType.Delete,
      vectorClock: { B: 1 },
      timestamp: 2000, // delete newer → wins
      payload: { task: { id: 'task-1' } },
    });

    // Sanity: eligibility must reject a delete-containing conflict outright.
    expect(
      isDisjointMergeEligible({
        localOps: [localOp],
        remoteOps: [remoteDelete],
        payloadKey: 'task',
      }),
    ).toBe(false);

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteDelete])]);

    const entries = await journal.list('history');
    expect(entries.length).toBe(1);
    expect(entries[0].reason).toBe('delete-wins');
    expect(entries[0].reason).not.toBe('disjoint-merge');
    // No synthesized merged UPDATE op was created for this entity.
    expect(mergedOpArgs()).toBeUndefined();
  });

  // ── (e) two-client convergence ─────────────────────────────────────────────
  describe('(e) two-client convergence', () => {
    const base = { id: 'task-1', title: 'base', notes: 'base', modified: 100 };
    // side1 authored by client A; side2 authored by client B.
    const side1Changes = { title: 'A-title', modified: 1500 };
    const side2Changes = { notes: 'B-notes', modified: 1600 };
    const side1Meta = { timestamp: 1500, clientId: 'A' };
    const side2Meta = { timestamp: 1600, clientId: 'B' };
    const currentA = { ...base, ...side1Changes };
    const currentB = { ...base, ...side2Changes };

    it('both clients synthesize the byte-identical merged entity (either ordering)', () => {
      // Client A: local = side1, remote = side2.
      const mergedA = synthesizeMergedEntity(
        currentA,
        side1Changes,
        side2Changes,
        side1Meta,
        side2Meta,
      );
      // Client B: local = side2, remote = side1 (mirror).
      const mergedB = synthesizeMergedEntity(
        currentB,
        side2Changes,
        side1Changes,
        side2Meta,
        side1Meta,
      );

      expect(mergedA).toEqual(mergedB);
      // Explicit expected entity: both real fields kept; noise → newer (side2).
      expect(mergedA).toEqual({
        id: 'task-1',
        title: 'A-title',
        notes: 'B-notes',
        modified: 1600,
      });
    });

    it('both merged clocks dominate BOTH original ops', () => {
      const clockSide1 = { clientA: 2 };
      const clockSide2 = { clientB: 2 };
      const merge = (...cs: Array<Record<string, number>>): Record<string, number> =>
        cs.reduce((acc, c) => mergeVectorClocks(acc, c), {});

      const clockA = incrementVectorClock(merge(clockSide1, clockSide2), 'clientA');
      const clockB = incrementVectorClock(merge(clockSide1, clockSide2), 'clientB');

      for (const clk of [clockA, clockB]) {
        expect(compareVectorClocks(clk, clockSide1)).toBe(
          VectorClockComparison.GREATER_THAN,
        );
        expect(compareVectorClocks(clk, clockSide2)).toBe(
          VectorClockComparison.GREATER_THAN,
        );
      }
      // The two independently-synthesized merged ops are concurrent by clock,
      // but carry identical payloads (previous test) → resolve by ordinary LWW,
      // never re-merging, so entity state converges.
      expect(compareVectorClocks(clockA, clockB)).toBe(VectorClockComparison.CONCURRENT);
    });
  });

  // ── (e2e) full two-client round-trip: both clients merge independently to the
  //    IDENTICAL entity, then the two merged ops meet and are NOT re-merge-
  //    eligible (→ ordinary LWW on identical payloads → convergence, no ping-pong).
  describe('(e2e) two-client sync round-trip convergence', () => {
    const resolveAsClient = async (
      clientId: string,
      currentState: Record<string, unknown>,
      conflict: EntityConflict,
    ): Promise<{ synthesized?: Operation }> => {
      TestBed.resetTestingModule();

      const store = jasmine.createSpyObj('Store', ['select']);
      store.select.and.returnValue(of(currentState));

      const applier = jasmine.createSpyObj('OperationApplierService', [
        'applyOperations',
      ]);
      applier.applyOperations.and.resolveTo({ appliedOps: [] });

      const opLogStore = jasmine.createSpyObj('OperationLogStoreService', [
        'appendBatchSkipDuplicates',
        'appendWithVectorClockUpdate',
        'markApplied',
        'markRejected',
        'markFailed',
        'getUnsyncedByEntity',
        'mergeRemoteOpClocks',
      ]);
      opLogStore.mergeRemoteOpClocks.and.resolveTo(undefined);
      opLogStore.getUnsyncedByEntity.and.resolveTo(new Map());
      opLogStore.markRejected.and.resolveTo(undefined);
      opLogStore.markApplied.and.resolveTo(undefined);
      opLogStore.markFailed.and.resolveTo(undefined);
      opLogStore.appendWithVectorClockUpdate.and.resolveTo(1);
      opLogStore.appendBatchSkipDuplicates.and.callFake((ops: Operation[]) =>
        Promise.resolve({
          seqs: ops.map((_, i) => i + 1),
          writtenOps: ops,
          skippedCount: 0,
        }),
      );

      const validate = jasmine.createSpyObj('ValidateStateService', [
        'validateAndRepairCurrentState',
      ]);
      validate.validateAndRepairCurrentState.and.resolveTo(true);

      const effects = jasmine.createSpyObj('OperationLogEffects', [
        'processDeferredActions',
      ]);
      effects.processDeferredActions.and.resolveTo();

      TestBed.configureTestingModule({
        providers: [
          ConflictResolutionService,
          { provide: Store, useValue: store },
          { provide: OperationApplierService, useValue: applier },
          { provide: OperationLogStoreService, useValue: opLogStore },
          {
            provide: SnackService,
            useValue: jasmine.createSpyObj('SnackService', ['open']),
          },
          { provide: ValidateStateService, useValue: validate },
          { provide: OperationLogEffects, useValue: effects },
          {
            provide: CLIENT_ID_PROVIDER,
            useValue: { loadClientId: () => Promise.resolve(clientId) },
          },
          { provide: ENTITY_REGISTRY, useValue: buildEntityRegistry() },
        ],
      });

      const svc = TestBed.inject(ConflictResolutionService);
      await svc.autoResolveConflictsLWW([conflict]);

      const synthesized = opLogStore.appendWithVectorClockUpdate.calls
        .allArgs()
        .map(([o]) => o as Operation)
        .find((o) => o.entityId === 'task-1' && o.opType === OpType.Update);
      return { synthesized };
    };

    const entityOf = (o: Operation): Record<string, unknown> => {
      const p = o.payload as Record<string, unknown>;
      return { title: p['title'], notes: p['notes'] };
    };

    it('both clients synthesize the identical merged entity, and the two merged ops do not re-merge (converge)', async () => {
      const titleOp = op({
        id: 'op-A',
        clientId: 'clientA',
        vectorClock: { clientA: 1 },
        timestamp: 2000,
        payload: { task: { id: 'task-1', changes: { title: 'A-title' } } },
      });
      const notesOp = op({
        id: 'op-B',
        clientId: 'clientB',
        vectorClock: { clientB: 1 },
        timestamp: 3000,
        payload: { task: { id: 'task-1', changes: { notes: 'B-notes' } } },
      });

      const a1 = await resolveAsClient(
        'clientA',
        { id: 'task-1', title: 'A-title', notes: 'base' },
        conflictOf([titleOp], [notesOp]),
      );
      const b1 = await resolveAsClient(
        'clientB',
        { id: 'task-1', title: 'base', notes: 'B-notes' },
        conflictOf([notesOp], [titleOp]),
      );

      expect(a1.synthesized).toBeDefined();
      expect(b1.synthesized).toBeDefined();
      expect(entityOf(a1.synthesized!)).toEqual({ title: 'A-title', notes: 'B-notes' });
      expect(entityOf(a1.synthesized!)).toEqual(entityOf(b1.synthesized!));

      const mA = a1.synthesized!;
      const mB = b1.synthesized!;
      expect(
        isDisjointMergeEligible({ localOps: [mA], remoteOps: [mB], payloadKey: 'task' }),
      ).toBe(false);
      expect(
        isDisjointMergeEligible({ localOps: [mB], remoteOps: [mA], payloadKey: 'task' }),
      ).toBe(false);
    });
  });
});

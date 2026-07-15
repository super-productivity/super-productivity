import { TestBed } from '@angular/core/testing';
import { SyncConflictBannerService } from './sync-conflict-banner.service';
import {
  ConflictResolutionService,
  getLatestTaskProjectMoveEntityIds,
} from './conflict-resolution.service';
import { Store } from '@ngrx/store';
import { OperationApplierService } from '../apply/operation-applier.service';
import { HydrationStateService } from '../apply/hydration-state.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { SnackService } from '../../core/snack/snack.service';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { ValidateStateService } from '../validation/validate-state.service';
import { of } from 'rxjs';
import {
  ActionType,
  EntityConflict,
  extractActionPayload,
  isLwwUpdatePayload,
  OpType,
  Operation,
} from '../core/operation.types';
import {
  compareVectorClocks,
  VectorClock,
  VectorClockComparison,
} from '../../core/util/vector-clock';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { MAX_VECTOR_CLOCK_SIZE } from '../core/operation-log.const';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../core/entity-registry';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { OperationLogEffects } from '../capture/operation-log.effects';
import { IncompleteRemoteOperationsError } from '../core/errors/sync-errors';
import { ConflictJournalService } from './conflict-journal.service';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';

describe('ConflictResolutionService', () => {
  let service: ConflictResolutionService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockOperationApplier: jasmine.SpyObj<OperationApplierService>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockValidateStateService: jasmine.SpyObj<ValidateStateService>;
  let mockHydrationStateService: jasmine.SpyObj<HydrationStateService>;
  let mockClientIdProvider: { loadClientId: jasmine.Spy };
  let mockEntityRegistry: ReturnType<typeof buildEntityRegistry>;
  let mockOperationLogEffects: jasmine.SpyObj<OperationLogEffects>;

  const TEST_CLIENT_ID = 'test-client-123';

  const createMockOp = (id: string, clientId: string): Operation => ({
    id,
    clientId,
    actionType: 'test' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: 'task-1',
    // Use different payloads for different clients to avoid auto-resolution as identical
    payload: { source: clientId },
    vectorClock: { [clientId]: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  const getMixedLocalOps = (): readonly Operation[] =>
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
      .allArgs()
      .flatMap(([batches]) =>
        batches.filter((batch) => batch.source === 'local').flatMap((batch) => batch.ops),
      );

  const getMixedRemoteOps = (): readonly Operation[] =>
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
      .allArgs()
      .flatMap(([batches]) =>
        batches
          .filter((batch) => batch.source === 'remote')
          .flatMap((batch) => batch.ops),
      );

  const getFirstMixedLocalOp = (): Operation => {
    const op = getMixedLocalOps()[0];
    if (!op) {
      throw new Error('Expected a local operation in the mixed-resolution batch');
    }
    return op;
  };

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['select']);
    // Default: select returns of(undefined) - can be overridden in specific tests
    mockStore.select.and.returnValue(of(undefined));

    mockOperationApplier = jasmine.createSpyObj('OperationApplierService', [
      'applyOperations',
    ]);
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'hasOp',
      'append',
      'appendBatchSkipDuplicates',
      'appendMixedSourceBatchSkipDuplicates',
      'mergeRemoteOpClocks',
      'markReducersCommittedAndMergeClocks',
      'markApplied',
      'markRejected',
      'markFailed',
      'getUnsyncedByEntity',
      'getOpById',
      'getVectorClock',
    ]);
    mockOpLogStore.mergeRemoteOpClocks.and.resolveTo(undefined);
    mockOpLogStore.markReducersCommittedAndMergeClocks.and.resolveTo(undefined);
    mockSnackService = jasmine.createSpyObj('SnackService', [
      'open',
      'hasPendingPersistentAction',
    ]);
    mockSnackService.hasPendingPersistentAction.and.returnValue(false);
    mockValidateStateService = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepairCurrentState',
    ]);
    mockHydrationStateService = jasmine.createSpyObj('HydrationStateService', [
      'startApplyingRemoteOps',
      'startPostSyncCooldown',
      'endApplyingRemoteOps',
    ]);
    mockOperationLogEffects = jasmine.createSpyObj('OperationLogEffects', [
      'processDeferredActions',
    ]);
    mockClientIdProvider = {
      loadClientId: jasmine
        .createSpy('loadClientId')
        .and.returnValue(Promise.resolve(TEST_CLIENT_ID)),
    };
    mockEntityRegistry = buildEntityRegistry();

    TestBed.configureTestingModule({
      providers: [
        ConflictResolutionService,
        { provide: Store, useValue: mockStore },
        { provide: OperationApplierService, useValue: mockOperationApplier },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: SnackService, useValue: mockSnackService },
        { provide: ValidateStateService, useValue: mockValidateStateService },
        { provide: HydrationStateService, useValue: mockHydrationStateService },
        { provide: OperationLogEffects, useValue: mockOperationLogEffects },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        { provide: ENTITY_REGISTRY, useValue: mockEntityRegistry },
      ],
    });
    service = TestBed.inject(ConflictResolutionService);

    // Default mock behaviors
    mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });
    mockOperationLogEffects.processDeferredActions.and.resolveTo();
    mockValidateStateService.validateAndRepairCurrentState.and.resolveTo(true);
    mockOpLogStore.getUnsyncedByEntity.and.resolveTo(new Map());
    mockOpLogStore.getOpById.and.resolveTo(undefined);
    mockOpLogStore.getVectorClock.and.resolveTo({});
    // By default, appendBatchSkipDuplicates writes all ops (no duplicates)
    mockOpLogStore.appendBatchSkipDuplicates.and.callFake((ops: Operation[]) =>
      Promise.resolve({
        seqs: ops.map((_, i) => i + 1),
        writtenOps: ops,
        skippedCount: 0,
      }),
    );
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(async (batches) => ({
      written: batches.flatMap((batch) =>
        batch.ops.map((op, index) => ({
          seq: index + 1,
          op,
          source: batch.source,
        })),
      ),
      skippedCount: 0,
    }));
  });

  describe('getCurrentEntityState', () => {
    it('should use injected registry selector factory for ISSUE_PROVIDER', async () => {
      const expectedEntity = { id: 'issue-provider-1' };
      const selector = (_state: object): unknown => expectedEntity;
      const selectorFactoryCalls: Array<[string, null]> = [];
      const selectorFactory = (id: string, key: null): ((state: object) => unknown) => {
        selectorFactoryCalls.push([id, key]);
        return selector;
      };

      const issueProviderConfig = mockEntityRegistry.ISSUE_PROVIDER;
      expect(issueProviderConfig).toBeDefined();
      if (!issueProviderConfig) {
        return;
      }
      issueProviderConfig.selectById = selectorFactory;
      mockStore.select.and.returnValue(of(expectedEntity));

      const result = await service.getCurrentEntityState(
        'ISSUE_PROVIDER',
        'issue-provider-1',
      );

      expect(result).toBe(expectedEntity);
      expect(selectorFactoryCalls).toEqual([['issue-provider-1', null]]);
      expect(mockStore.select.calls.mostRecent().args[0]).toBe(selector);
    });
  });

  describe('isIdenticalConflict', () => {
    it('should detect identical conflict when both sides DELETE', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [{ ...createMockOp('local-1', 'local'), opType: OpType.Delete }],
        remoteOps: [{ ...createMockOp('remote-1', 'remote'), opType: OpType.Delete }],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });

    it('should detect identical conflict when both sides have same UPDATE payload', () => {
      const payload = { title: 'Same Title', notes: 'Same Notes' };
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          { ...createMockOp('local-1', 'local'), opType: OpType.Update, payload },
        ],
        remoteOps: [
          { ...createMockOp('remote-1', 'remote'), opType: OpType.Update, payload },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });

    it('should NOT detect identical conflict when payloads differ', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          {
            ...createMockOp('local-1', 'local'),
            opType: OpType.Update,
            payload: { title: 'Local Title' },
          },
        ],
        remoteOps: [
          {
            ...createMockOp('remote-1', 'remote'),
            opType: OpType.Update,
            payload: { title: 'Remote Title' },
          },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });

    it('should NOT detect identical conflict when opTypes differ', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [{ ...createMockOp('local-1', 'local'), opType: OpType.Update }],
        remoteOps: [{ ...createMockOp('remote-1', 'remote'), opType: OpType.Delete }],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });

    it('should NOT detect identical conflict when multiple ops with different counts', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          { ...createMockOp('local-1', 'local'), opType: OpType.Update },
          { ...createMockOp('local-2', 'local'), opType: OpType.Update },
        ],
        remoteOps: [{ ...createMockOp('remote-1', 'remote'), opType: OpType.Update }],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });

    it('should detect identical conflict with multiple DELETE ops on both sides', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          { ...createMockOp('local-1', 'local'), opType: OpType.Delete },
          { ...createMockOp('local-2', 'local'), opType: OpType.Delete },
        ],
        remoteOps: [
          { ...createMockOp('remote-1', 'remote'), opType: OpType.Delete },
          { ...createMockOp('remote-2', 'remote'), opType: OpType.Delete },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });

    it('should handle nested object payloads correctly', () => {
      const payload = {
        title: 'Test',
        nested: { deep: { value: 123 }, array: [1, 2, 3] },
      };
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          { ...createMockOp('local-1', 'local'), opType: OpType.Update, payload },
        ],
        remoteOps: [
          { ...createMockOp('remote-1', 'remote'), opType: OpType.Update, payload },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });

    it('should return false for empty ops', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [],
        remoteOps: [{ ...createMockOp('remote-1', 'remote'), opType: OpType.Delete }],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });
  });
  describe('isIdenticalConflict edge cases', () => {
    it('should NOT detect arrays with different order as identical', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          {
            ...createMockOp('local-1', 'local'),
            opType: OpType.Update,
            payload: { tagIds: ['a', 'b', 'c'] },
          },
        ],
        remoteOps: [
          {
            ...createMockOp('remote-1', 'remote'),
            opType: OpType.Update,
            payload: { tagIds: ['c', 'b', 'a'] },
          },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });

    it('should handle null payload values correctly', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          {
            ...createMockOp('local-1', 'local'),
            opType: OpType.Update,
            payload: { notes: null },
          },
        ],
        remoteOps: [
          {
            ...createMockOp('remote-1', 'remote'),
            opType: OpType.Update,
            payload: { notes: null },
          },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });

    it('should NOT treat null and undefined as identical', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          {
            ...createMockOp('local-1', 'local'),
            opType: OpType.Update,
            payload: { notes: null },
          },
        ],
        remoteOps: [
          {
            ...createMockOp('remote-1', 'remote'),
            opType: OpType.Update,
            payload: { notes: undefined },
          },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });

    it('should handle empty objects as identical', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          {
            ...createMockOp('local-1', 'local'),
            opType: OpType.Update,
            payload: {},
          },
        ],
        remoteOps: [
          {
            ...createMockOp('remote-1', 'remote'),
            opType: OpType.Update,
            payload: {},
          },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });
  });
  describe('autoResolveConflictsLWW', () => {
    // Helper to create ops with specific timestamps
    const createOpWithTimestamp = (
      id: string,
      clientId: string,
      timestamp: number,
      opType: OpType = OpType.Update,
      entityId: string = 'task-1',
    ): Operation => ({
      id,
      clientId,
      actionType: 'test' as ActionType,
      opType,
      entityType: 'TASK',
      entityId,
      payload: { source: clientId, timestamp },
      vectorClock: { [clientId]: 1 },
      timestamp,
      schemaVersion: 1,
    });

    const createProjectDelete = (
      id: string,
      clientId: string,
      timestamp: number,
      marked: boolean = true,
    ): Operation => ({
      ...createOpWithTimestamp(id, clientId, timestamp, OpType.Delete, 'project-1'),
      actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
      entityType: 'PROJECT',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      payload: {
        actionPayload: {
          projectId: 'project-1',
          noteIds: ['note-1'],
          allTaskIds: ['task-1'],
          ...(marked ? { projectDeleteWins: true } : {}),
        },
        entityChanges: [],
      },
    });

    // Helper to create conflict with suggestedResolution
    const createConflict = (
      entityId: string,
      localOps: Operation[],
      remoteOps: Operation[],
    ): EntityConflict => ({
      entityType: 'TASK',
      entityId,
      localOps,
      remoteOps,
      suggestedResolution: 'manual', // LWW will override this
    });

    beforeEach(() => {
      // Default mock behaviors for LWW tests
      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.callFake((op: Operation) => Promise.resolve(1));
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });
    });

    it('should auto-resolve conflict as remote when remote timestamp is newer', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
          [createOpWithTimestamp('remote-1', 'client-b', now)],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      // Remote ops should be appended via batch
      expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        [jasmine.objectContaining({ id: 'remote-1' })],
        'remote',
        jasmine.any(Object),
      );
      // Local ops should be rejected
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1']);
      // SPAP-15: the generic count snack was replaced by the journal-driven
      // summary banner. These ops carry no real field changes (noise), so
      // nothing unreviewed is journaled and no snack fires.
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    it('should auto-resolve conflict as local when local timestamp is newer', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-1', 'client-a', now)],
          [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
        ),
      ];

      await service.autoResolveConflictsLWW(conflicts);

      // Both local and remote ops should be rejected
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1']);
      // Remote loser and its compensation are persisted atomically, then rejected.
      expect(getMixedRemoteOps()).toEqual(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-1' })]),
      );
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-1']);
      // SPAP-15: count snack replaced by the journal-driven summary banner;
      // noise-only resolutions journal nothing unreviewed, so no snack fires.
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    it('shows a content-conflict banner (not the generic snack) when a discarded edit touched task content (#8694)', async () => {
      const bannerService = TestBed.inject(BannerService);
      const openBannerSpy = spyOn(bannerService, 'open');
      const now = Date.now();
      // Remote wins (newer) -> the local title edit is discarded = content loss.
      // Use the real captured payload shape: { actionPayload, entityChanges: [] }.
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [
            {
              ...createOpWithTimestamp('local-1', 'client-a', now - 1000),
              payload: {
                actionPayload: {
                  task: { id: 'task-1', changes: { title: 'My local title' } },
                },
                entityChanges: [],
              },
            },
          ],
          [
            {
              ...createOpWithTimestamp('remote-1', 'client-b', now),
              payload: {
                actionPayload: {
                  task: { id: 'task-1', changes: { title: 'Remote title' } },
                },
                entityChanges: [],
              },
            },
          ],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      expect(openBannerSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({ id: BannerId.SyncConflictContentResolved }),
      );
      // The generic "N local/remote wins" count snack must NOT fire for content loss.
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    it('escapes task titles before putting them in the innerHTML banner (XSS guard)', async () => {
      const bannerService = TestBed.inject(BannerService);
      const openBannerSpy = spyOn(bannerService, 'open');
      // The banner renders msg via [innerHTML]; a title synced from another
      // device must not be able to inject markup.
      mockStore.select.and.returnValue(of({ title: '<img src=x onerror=alert(1)>' }));
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [
            {
              ...createOpWithTimestamp('local-1', 'client-a', now - 1000),
              payload: {
                actionPayload: { task: { id: 'task-1', changes: { notes: 'edited' } } },
                entityChanges: [],
              },
            },
          ],
          [
            {
              ...createOpWithTimestamp('remote-1', 'client-b', now),
              payload: {
                actionPayload: { task: { id: 'task-1', changes: { notes: 'other' } } },
                entityChanges: [],
              },
            },
          ],
        ),
      ];
      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      const bannerArg = openBannerSpy.calls.mostRecent().args[0];
      const taskList = bannerArg.translateParams?.taskList as string;
      expect(taskList).not.toContain('<img');
      expect(taskList).toContain('&lt;img');
    });

    it('names the discarded title when the title itself conflicted (#8694 review)', async () => {
      const bannerService = TestBed.inject(BannerService);
      const openBannerSpy = spyOn(bannerService, 'open');
      // Kept (current) title comes from the store = the winning value; the
      // discarded value must still be surfaced so double-check is actionable.
      mockStore.select.and.returnValue(of({ title: 'Remote title' }));
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [
            {
              ...createOpWithTimestamp('local-1', 'client-a', now - 1000),
              payload: {
                actionPayload: {
                  task: { id: 'task-1', changes: { title: 'My local title' } },
                },
                entityChanges: [],
              },
            },
          ],
          [
            {
              ...createOpWithTimestamp('remote-1', 'client-b', now),
              payload: {
                actionPayload: {
                  task: { id: 'task-1', changes: { title: 'Remote title' } },
                },
                entityChanges: [],
              },
            },
          ],
        ),
      ];
      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      const taskList = openBannerSpy.calls.mostRecent().args[0].translateParams
        ?.taskList as string;
      expect(taskList).toContain('"Remote title"');
      expect(taskList).toContain('"My local title"');
    });

    it('escapes the discarded title too (XSS guard on the new field)', async () => {
      const bannerService = TestBed.inject(BannerService);
      const openBannerSpy = spyOn(bannerService, 'open');
      mockStore.select.and.returnValue(of({ title: 'Kept' }));
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [
            {
              ...createOpWithTimestamp('local-1', 'client-a', now - 1000),
              payload: {
                actionPayload: {
                  task: {
                    id: 'task-1',
                    changes: { title: '<img src=x onerror=alert(1)>' },
                  },
                },
                entityChanges: [],
              },
            },
          ],
          [
            {
              ...createOpWithTimestamp('remote-1', 'client-b', now),
              payload: {
                actionPayload: { task: { id: 'task-1', changes: { title: 'Kept' } } },
                entityChanges: [],
              },
            },
          ],
        ),
      ];
      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      const taskList = openBannerSpy.calls.mostRecent().args[0].translateParams
        ?.taskList as string;
      expect(taskList).not.toContain('<img');
      expect(taskList).toContain('&lt;img');
    });

    it('surfaces the journal-driven summary banner (not the content banner or count snack) for routine field resolutions (SPAP-15)', async () => {
      const bannerService = TestBed.inject(BannerService);
      const openBannerSpy = spyOn(bannerService, 'open');
      const now = Date.now();
      // Remote wins -> discarded local op only rescheduled (dueDay) = routine.
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [
            {
              ...createOpWithTimestamp('local-1', 'client-a', now - 1000),
              payload: {
                actionPayload: {
                  task: { id: 'task-1', changes: { dueDay: '2026-07-02' } },
                },
                entityChanges: [],
              },
            },
          ],
          [
            {
              ...createOpWithTimestamp('remote-1', 'client-b', now),
              payload: {
                actionPayload: { task: { id: 'task-1', changes: { dueDay: null } } },
                entityChanges: [],
              },
            },
          ],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      // A dueDay reschedule is a real (non-noise) discarded edit → journaled
      // unreviewed → the summary banner (NOT the named content banner) surfaces
      // it, and the old count snack is gone.
      expect(mockSnackService.open).not.toHaveBeenCalled();
      expect(openBannerSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({ id: BannerId.SyncConflictsAutoResolved }),
      );
    });

    it('should auto-resolve as remote when timestamps are equal (tie-breaker)', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-1', 'client-a', now)],
          [createOpWithTimestamp('remote-1', 'client-b', now)],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      // Remote wins on tie - should apply remote ops via batch
      expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        [jasmine.objectContaining({ id: 'remote-1' })],
        'remote',
        jasmine.any(Object),
      );
      // Local ops should be rejected
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1']);
    });

    it('should not duplicate already rejected local ops while adding superseded pending ops', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
          [createOpWithTimestamp('remote-1', 'client-b', now)],
        ),
      ];
      mockOpLogStore.getUnsyncedByEntity.and.resolveTo(
        new Map([
          [
            'TASK:task-1',
            [
              createOpWithTimestamp('local-1', 'client-a', now - 1000),
              createOpWithTimestamp('local-2', 'client-a', now - 500),
            ],
          ],
        ]),
      );

      await service.autoResolveConflictsLWW(conflicts);

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1', 'local-2']);
    });

    it('should handle multiple conflicts in single batch', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [
            createOpWithTimestamp(
              'local-1',
              'client-a',
              now - 1000,
              OpType.Update,
              'task-1',
            ),
          ],
          [createOpWithTimestamp('remote-1', 'client-b', now, OpType.Update, 'task-1')],
        ),
        createConflict(
          'task-2',
          [createOpWithTimestamp('local-2', 'client-a', now, OpType.Update, 'task-2')],
          [
            createOpWithTimestamp(
              'remote-2',
              'client-b',
              now - 1000,
              OpType.Update,
              'task-2',
            ),
          ],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: [conflicts[0].remoteOps[0]],
      });

      await service.autoResolveConflictsLWW(conflicts);

      // First conflict: remote wins (newer timestamp) and shares the atomic
      // resolution batch with the second conflict's loser/compensation pair.
      expect(getMixedRemoteOps()).toEqual(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-1' })]),
      );

      // Second conflict: local wins (newer timestamp)
      // Remote loser and its compensation are persisted atomically, then rejected.
      expect(getMixedRemoteOps()).toEqual(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-2' })]),
      );

      // SPAP-15: the generic count snack was removed. Both conflicts here carry
      // no real field changes (noise), so nothing unreviewed is journaled and
      // neither the snack nor the summary banner fires.
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    it('should piggyback non-conflicting ops with conflict resolution', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
          [createOpWithTimestamp('remote-1', 'client-b', now)],
        ),
      ];
      const nonConflicting = [
        createOpWithTimestamp('non-conflict-1', 'client-b', now, OpType.Update, 'task-2'),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: [...conflicts[0].remoteOps, ...nonConflicting],
      });

      await service.autoResolveConflictsLWW(conflicts, nonConflicting);

      // Non-conflicting op should also be appended (via batch with the remote-wins ops)
      expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'non-conflict-1' })]),
        'remote',
        jasmine.any(Object),
      );
    });

    it('should return early if no conflicts and no non-conflicting ops', async () => {
      await service.autoResolveConflictsLWW([]);

      expect(mockOpLogStore.appendBatchSkipDuplicates).not.toHaveBeenCalled();
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    it('should validate state after resolution', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
          [createOpWithTimestamp('remote-1', 'client-b', now)],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      expect(mockValidateStateService.validateAndRepairCurrentState).toHaveBeenCalled();
    });

    it('should use max timestamp when multiple ops exist on one side', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          // Local has older first op but newer second op
          [
            createOpWithTimestamp('local-1', 'client-a', now - 2000),
            createOpWithTimestamp('local-2', 'client-a', now),
          ],
          // Remote has one op in between
          [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
        ),
      ];

      await service.autoResolveConflictsLWW(conflicts);

      // Local wins because max(local timestamps) > max(remote timestamps)
      // Both local ops should be rejected (old ones replaced by new update op)
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1', 'local-2']);
      // Remote ops should be appended then rejected
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-1']);
    });

    describe('edge cases', () => {
      it('should handle conflict with empty localOps array gracefully', async () => {
        // Edge case: conflict struct with empty localOps (shouldn't happen but defensive)
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [], // Empty!
            remoteOps: [createOpWithTimestamp('remote-1', 'client-b', now)],
            suggestedResolution: 'manual',
          },
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        // Math.max() with empty array returns -Infinity, so remote should always win
        await expectAsync(service.autoResolveConflictsLWW(conflicts)).toBeResolved();

        // Remote should win (any timestamp > -Infinity)
        expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
          jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-1' })]),
          'remote',
          jasmine.any(Object),
        );
      });

      it('should handle conflict with empty remoteOps array gracefully', async () => {
        // Edge case: conflict struct with empty remoteOps (shouldn't happen but defensive)
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
            remoteOps: [], // Empty!
            suggestedResolution: 'manual',
          },
        ];

        // Math.max() with empty array returns -Infinity, so local should always win
        await expectAsync(service.autoResolveConflictsLWW(conflicts)).toBeResolved();

        // Local wins (any timestamp > -Infinity)
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1']);
        // No remote ops to append
      });

      it('should resolve DELETE vs UPDATE conflict using LWW when DELETE is newer', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [
              {
                ...createOpWithTimestamp('local-del', 'client-a', now),
                opType: OpType.Delete,
              },
            ],
            [
              {
                ...createOpWithTimestamp('remote-upd', 'client-b', now - 1000),
                opType: OpType.Update,
              },
            ],
          ),
        ];

        const result = await service.autoResolveConflictsLWW(conflicts);

        // Local DELETE wins (newer timestamp)
        // Both originals are obsolete, but a replacement DELETE with a clock
        // dominating both sides must remain pending for upload.
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-del']);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-upd']);
        const replacementDelete = getFirstMixedLocalOp();
        expect(replacementDelete.opType).toBe(OpType.Delete);
        expect(replacementDelete.actionType).toBe(conflicts[0].localOps[0].actionType);
        expect(replacementDelete.payload).toEqual(conflicts[0].localOps[0].payload);
        expect(replacementDelete.vectorClock['client-a']).toBeGreaterThanOrEqual(1);
        expect(replacementDelete.vectorClock['client-b']).toBeGreaterThanOrEqual(1);
        expect(replacementDelete.vectorClock[TEST_CLIENT_ID]).toBeGreaterThanOrEqual(1);
        expect(result.localWinOpsCreated).toBe(1);
      });

      it('should resolve UPDATE vs DELETE conflict using LWW when UPDATE is newer', async () => {
        const now = Date.now();
        mockStore.select.and.returnValue(
          of({ id: 'task-1', title: 'Local winning task' }),
        );
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [
              {
                ...createOpWithTimestamp('local-upd', 'client-a', now),
                opType: OpType.Update,
              },
            ],
            [
              {
                ...createOpWithTimestamp('remote-del', 'client-b', now - 1000),
                opType: OpType.Delete,
              },
            ],
          ),
        ];

        await service.autoResolveConflictsLWW(conflicts);

        // Local UPDATE wins (newer timestamp)
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-upd']);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-del']);
        expect(
          (getFirstMixedLocalOp().payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();
      });

      it('should recreate a locally-winning UPDATE over a concurrent remote DELETE on a client-ID tie (#9024)', async () => {
        const now = Date.now();
        mockStore.select.and.returnValue(
          of({ id: 'task-1', title: 'Local winning task' }),
        );
        // Exact-timestamp tie against a remote DELETE. Local's clientId
        // (client-z) is the larger, so the deterministic tiebreak makes the
        // local UPDATE win — reaching the SAME delete-recreation path as the
        // "UPDATE is newer" case above, just via the tie rather than the
        // timestamp. Guards that the #9024 tiebreak doesn't bypass entity
        // recreation when the loser was a delete.
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [
              {
                ...createOpWithTimestamp('local-upd', 'client-z', now),
                opType: OpType.Update,
              },
            ],
            [
              {
                ...createOpWithTimestamp('remote-del', 'client-a', now),
                opType: OpType.Delete,
              },
            ],
          ),
        ];

        await service.autoResolveConflictsLWW(conflicts);

        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-upd']);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-del']);
        expect(
          (getFirstMixedLocalOp().payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();
      });

      it('should resolve DELETE vs UPDATE conflict when DELETE is older (remote UPDATE wins)', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [
              {
                ...createOpWithTimestamp('local-del', 'client-a', now - 1000),
                opType: OpType.Delete,
              },
            ],
            [
              {
                ...createOpWithTimestamp('remote-upd', 'client-b', now),
                opType: OpType.Update,
              },
            ],
          ),
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        await service.autoResolveConflictsLWW(conflicts);

        // Remote UPDATE wins (newer timestamp) - entity should be restored
        expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
          jasmine.arrayContaining([
            jasmine.objectContaining({ id: 'remote-upd', opType: OpType.Update }),
          ]),
          'remote',
          jasmine.any(Object),
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-del']);
      });

      it('keeps a marked local project deletion when a concurrent update is newer', async () => {
        const localDelete = createProjectDelete(
          'local-project-delete',
          'client-a',
          1_000,
        );
        const remoteUpdate: Operation = {
          ...createOpWithTimestamp(
            'remote-project-update',
            'client-b',
            2_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        const conflict: EntityConflict = {
          entityType: 'PROJECT',
          entityId: 'project-1',
          localOps: [localDelete],
          remoteOps: [remoteUpdate],
          suggestedResolution: 'manual',
        };

        const result = await service.autoResolveConflictsLWW([conflict]);

        const replacementDelete = getFirstMixedLocalOp();
        expect(replacementDelete.opType).toBe(OpType.Delete);
        expect(replacementDelete.actionType).toBe(ActionType.TASK_SHARED_DELETE_PROJECT);
        expect(replacementDelete.payload).toEqual(localDelete.payload);
        expect(replacementDelete.timestamp).toBe(localDelete.timestamp);
        expect(replacementDelete.vectorClock['client-a']).toBeGreaterThanOrEqual(1);
        expect(replacementDelete.vectorClock['client-b']).toBeGreaterThanOrEqual(1);
        expect(replacementDelete.vectorClock[TEST_CLIENT_ID]).toBeGreaterThanOrEqual(1);
        expect(result.localWinOpsCreated).toBe(1);
      });

      it('applies a marked remote project deletion even when the local update is newer', async () => {
        const localUpdate: Operation = {
          ...createOpWithTimestamp(
            'local-project-update',
            'client-a',
            2_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        const remoteDelete = createProjectDelete(
          'remote-project-delete',
          'client-b',
          1_000,
        );
        const conflict: EntityConflict = {
          entityType: 'PROJECT',
          entityId: 'project-1',
          localOps: [localUpdate],
          remoteOps: [remoteDelete],
          suggestedResolution: 'manual',
        };
        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: [remoteDelete],
        });

        const result = await service.autoResolveConflictsLWW([conflict]);

        expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
          [remoteDelete],
          'remote',
          { pendingApply: true },
        );
        expect(getMixedLocalOps()).toEqual([]);
        const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
          .args[0] as Operation[];
        expect(appliedOps).toContain(remoteDelete);
        expect(result.localWinOpsCreated).toBe(0);
      });

      it('keeps timestamp LWW for a migrated project deletion without the marker', async () => {
        const localDelete = createProjectDelete(
          'legacy-project-delete',
          'client-a',
          1_000,
          false,
        );
        const remoteUpdate: Operation = {
          ...createOpWithTimestamp(
            'remote-project-update',
            'client-b',
            2_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        const conflict: EntityConflict = {
          entityType: 'PROJECT',
          entityId: 'project-1',
          localOps: [localDelete],
          remoteOps: [remoteUpdate],
          suggestedResolution: 'manual',
        };
        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: [remoteUpdate],
        });

        await service.autoResolveConflictsLWW([conflict]);

        expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
          [remoteUpdate],
          'remote',
          { pendingApply: true },
        );
      });

      it('unions allTaskIds/noteIds across multiple concurrent marked deletes (#8997)', async () => {
        // Concurrent tabs each captured a deleteProject with a different cascade
        // set; the local store applied BOTH. The single replacement must carry
        // the union or another client keeps entities only the other delete removed.
        const makeDelete = (
          id: string,
          taskIds: string[],
          noteIds: string[],
        ): Operation => ({
          ...createOpWithTimestamp(id, 'client-a', 1_000, OpType.Delete, 'project-1'),
          actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
          entityType: 'PROJECT',
          schemaVersion: CURRENT_SCHEMA_VERSION,
          payload: {
            actionPayload: {
              projectId: 'project-1',
              noteIds,
              allTaskIds: taskIds,
              projectDeleteWins: true,
            },
            entityChanges: [],
          },
        });
        const deleteA = makeDelete('local-delete-a', ['task-1'], ['note-1']);
        const deleteB = makeDelete('local-delete-b', ['task-2'], ['note-2']);
        const remoteUpdate: Operation = {
          ...createOpWithTimestamp(
            'remote-project-update',
            'client-b',
            2_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        const conflict: EntityConflict = {
          entityType: 'PROJECT',
          entityId: 'project-1',
          localOps: [deleteA, deleteB],
          remoteOps: [remoteUpdate],
          suggestedResolution: 'manual',
        };

        await service.autoResolveConflictsLWW([conflict]);

        const replacementPayload = getFirstMixedLocalOp().payload as {
          actionPayload: { allTaskIds: string[]; noteIds: string[] };
        };
        expect(new Set(replacementPayload.actionPayload.allTaskIds)).toEqual(
          new Set(['task-1', 'task-2']),
        );
        expect(new Set(replacementPayload.actionPayload.noteIds)).toEqual(
          new Set(['note-1', 'note-2']),
        );
      });

      it('ignores the marker when entityId does not match the authenticated projectId', async () => {
        // Tampered/replayed delete retargeted onto a live entity: marker present
        // but op.entityId ('project-1') != payload.projectId ('project-original').
        // Must NOT win delete-wins; falls back to timestamp LWW, so the newer
        // local update wins and the retargeted delete is not applied.
        const retargetedDelete: Operation = {
          ...createProjectDelete('remote-retargeted-delete', 'client-b', 1_000),
          payload: {
            actionPayload: {
              projectId: 'project-original',
              noteIds: [],
              allTaskIds: [],
              projectDeleteWins: true,
            },
            entityChanges: [],
          },
        };
        const localUpdate: Operation = {
          ...createOpWithTimestamp(
            'local-project-update',
            'client-a',
            2_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        const conflict: EntityConflict = {
          entityType: 'PROJECT',
          entityId: 'project-1',
          localOps: [localUpdate],
          remoteOps: [retargetedDelete],
          suggestedResolution: 'manual',
        };
        mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

        await service.autoResolveConflictsLWW([conflict]);

        // Delete-wins did NOT fire (would apply the delete as a remote winner).
        expect(mockOpLogStore.appendBatchSkipDuplicates).not.toHaveBeenCalledWith(
          [retargetedDelete],
          'remote',
          { pendingApply: true },
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith([
          'remote-retargeted-delete',
        ]);
      });

      it('restamps a converted remote update to the current schema version (#8990)', async () => {
        // Conversion wraps an older-schema remote update in the v3-only
        // replacement envelope; the stored row's version must match its
        // semantics or a future export/re-upload would leak replace payloads
        // behind the v2 gate.
        const localDelete: Operation = {
          ...createOpWithTimestamp('local-del', 'client-a', 1_000, OpType.Delete),
          payload: {
            task: { id: 'task-1', title: 'Deleted task', subTaskIds: [] },
          },
        };
        const remoteUpdate: Operation = {
          ...createOpWithTimestamp('remote-upd', 'client-b', 2_000),
          schemaVersion: CURRENT_SCHEMA_VERSION - 1,
          payload: {
            task: { id: 'task-1', changes: { title: 'Remote title' } },
          },
        };
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localDelete], [remoteUpdate]),
        ]);

        const appendedOps = mockOpLogStore.appendBatchSkipDuplicates.calls
          .allArgs()
          .flatMap(([ops]) => ops);
        const convertedOp = appendedOps.find((op) => op.id === remoteUpdate.id);
        expect(convertedOp).withContext('converted remote winner').toBeDefined();
        expect((convertedOp!.payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe(
          'replace',
        );
        expect(convertedOp!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      });

      it('should apply one multi-entity remote op then compensate only local-winning entities (#8956)', async () => {
        const remoteMultiOp: Operation = {
          ...createOpWithTimestamp('remote-multi', 'client-b', 2000),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          opType: OpType.Delete,
          entityId: 'task-1',
          entityIds: ['task-1', 'task-2'],
          payload: { taskIds: ['task-1', 'task-2'] },
        };
        const localTask1 = createOpWithTimestamp('local-task-1', 'client-a', 1000);
        const localTask2 = {
          ...createOpWithTimestamp(
            'local-task-2',
            'client-a',
            3000,
            OpType.Update,
            'task-2',
          ),
          payload: { localOpaqueChange: true },
        };
        const conflicts: EntityConflict[] = [
          createConflict('task-1', [localTask1], [remoteMultiOp]),
          createConflict('task-2', [localTask2], [remoteMultiOp]),
        ];
        const pendingRemoteWinner = createOpWithTimestamp(
          'pending-task-1',
          'client-a',
          900,
        );
        const pendingLocalWinner = createOpWithTimestamp(
          'pending-task-2',
          'client-a',
          2900,
          OpType.Update,
          'task-2',
        );
        mockOpLogStore.getUnsyncedByEntity.and.resolveTo(
          new Map([
            ['TASK:task-1', [pendingRemoteWinner]],
            ['TASK:task-2', [pendingLocalWinner]],
          ]),
        );
        mockStore.select.and.returnValue(
          of({ id: 'task-2', title: 'Local winning task' }),
        );
        const journal = (
          service as unknown as { conflictJournal: ConflictJournalService }
        ).conflictJournal;
        spyOn(journal, 'record').and.resolveTo();
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        await service.autoResolveConflictsLWW(conflicts);

        const remoteMixedOps = getMixedRemoteOps().filter(
          (op) => op.id === remoteMultiOp.id,
        );
        expect(remoteMixedOps.length).toBe(1);
        const remoteMixedBatch = mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
          .allArgs()
          .flatMap(([batches]) => batches)
          .find((batch) => batch.ops.some((op) => op.id === remoteMultiOp.id));
        expect(remoteMixedBatch?.options).toEqual({ pendingApply: true });
        expect(
          mockOpLogStore.appendBatchSkipDuplicates.calls
            .allArgs()
            .flatMap(([ops]) => ops)
            .some((op) => op.id === remoteMultiOp.id),
        ).toBeFalse();

        const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
          .args[0] as Operation[];
        expect(appliedOps[0].id).toBe(remoteMultiOp.id);
        expect(appliedOps[1].actionType).toBe('[TASK] LWW Update');
        expect(appliedOps[1].entityId).toBe('task-2');
        expect(
          (appliedOps[1].payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();

        const rejectedIds = mockOpLogStore.markRejected.calls
          .allArgs()
          .flatMap(([ids]) => ids);
        expect(rejectedIds).toContain('pending-task-1');
        expect(rejectedIds).toContain('local-task-2');
        expect(rejectedIds).not.toContain('pending-task-2');
        expect(rejectedIds).not.toContain(remoteMultiOp.id);
        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [jasmine.any(Number)],
          [remoteMultiOp],
        );
        expect(journal.record).toHaveBeenCalledTimes(2);
      });

      it('applies a remote multi-entity op for unaffected siblings and compensates the local winner', async () => {
        const remoteMultiOp: Operation = {
          ...createOpWithTimestamp('remote-multi', 'client-b', 1000),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          opType: OpType.Delete,
          entityId: 'task-1',
          entityIds: ['task-1', 'task-2'],
          payload: {
            actionPayload: { taskIds: ['task-1', 'task-2'] },
            entityChanges: [],
          },
        };
        const localTask1 = createOpWithTimestamp(
          'local-task-1',
          'client-a',
          2000,
          OpType.Update,
          'task-1',
        );
        mockStore.select.and.returnValue(
          of({ id: 'task-1', title: 'Local winning task' }),
        );
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localTask1], [remoteMultiOp]),
        ]);

        expect(getMixedRemoteOps()).toEqual([remoteMultiOp]);
        const compensationOp = getFirstMixedLocalOp();
        expect(compensationOp.entityId).toBe('task-1');
        expect(
          (compensationOp.payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();
        const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
          .args[0] as Operation[];
        expect(appliedOps.map((op) => op.id)).toEqual([
          remoteMultiOp.id,
          compensationOp.id,
        ]);
      });

      it('quarantines a failed local compensation without rejecting originals', async () => {
        const remoteMultiOp: Operation = {
          ...createOpWithTimestamp('remote-multi', 'client-b', 2_000),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          opType: OpType.Delete,
          entityId: 'task-1',
          entityIds: ['task-1', 'task-2'],
          payload: { taskIds: ['task-1', 'task-2'] },
        };
        const localTask1 = createOpWithTimestamp('local-task-1', 'client-a', 1_000);
        const localTask2 = createOpWithTimestamp(
          'local-task-2',
          'client-a',
          3_000,
          OpType.Update,
          'task-2',
        );
        mockStore.select.and.returnValue(
          of({ id: 'task-2', title: 'Local winning task' }),
        );
        const reducerError = new Error('compensation reducer failed');
        let failedCompensation: Operation | undefined;
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          const compensation = ops[1];
          if (!compensation) {
            throw new Error('Expected a local compensation operation.');
          }
          failedCompensation = compensation;
          const reducerFailures = [{ op: compensation, error: reducerError }];
          await options?.onReducersCommitted?.([remoteMultiOp], reducerFailures);
          return { appliedOps: [remoteMultiOp], reducerFailures };
        });

        await expectAsync(
          service.autoResolveConflictsLWW([
            createConflict('task-1', [localTask1], [remoteMultiOp]),
            createConflict('task-2', [localTask2], [remoteMultiOp]),
          ]),
        ).toBeRejectedWithError(IncompleteRemoteOperationsError);

        expect(failedCompensation).toBeDefined();
        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [jasmine.any(Number)],
          [remoteMultiOp],
          [failedCompensation!.id],
        );
        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
      });

      it('recreates a winning parent’s subtasks lost to the remote bulk-delete cascade (#8956)', async () => {
        // Remote bulk delete of task-1 (a parent) + task-2. Applying it cascade-
        // deletes task-1's subtask sub-1 (handleDeleteTasks expands parent →
        // subTaskIds). task-1 wins LWW locally (newer edit), so the parent is
        // recreated — but without recreating sub-1 the subtree is lost forever.
        const remoteMultiOp: Operation = {
          ...createOpWithTimestamp('remote-multi', 'client-b', 1000),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          opType: OpType.Delete,
          entityId: 'task-1',
          entityIds: ['task-1', 'task-2'],
          payload: {
            actionPayload: { taskIds: ['task-1', 'task-2'] },
            entityChanges: [],
          },
        };
        const localParentEdit = createOpWithTimestamp(
          'local-parent-edit',
          'client-a',
          2000,
          OpType.Update,
          'task-1',
        );
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) => {
          if (props?.id === 'task-1') {
            return of({ id: 'task-1', title: 'Winning parent', subTaskIds: ['sub-1'] });
          }
          if (props?.id === 'sub-1') {
            return of({
              id: 'sub-1',
              title: 'Surviving subtask',
              parentId: 'task-1',
              subTaskIds: [],
            });
          }
          return of(undefined);
        });
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localParentEdit], [remoteMultiOp]),
        ]);

        const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
          .args[0] as Operation[];
        expect(appliedOps[0].id).toBe(remoteMultiOp.id);

        const lwwOps = appliedOps.filter(
          (op) => op.actionType === toLwwUpdateActionType('TASK'),
        );
        const parentOp = lwwOps.find((op) => op.entityId === 'task-1');
        const subtaskOp = lwwOps.find((op) => op.entityId === 'sub-1');
        expect(parentOp).withContext('parent recreate op').toBeDefined();
        expect(subtaskOp).withContext('subtask recreate op').toBeDefined();

        // The subtask recreate must be flagged so bulk hydration does not skip it
        // as an in-batch delete, and must carry the subtask's full snapshot.
        expect(
          (subtaskOp!.payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();
        expect(extractActionPayload(subtaskOp!.payload)['title']).toBe(
          'Surviving subtask',
        );
        // The remote delete cascade must be undone by an op that dominates it, so
        // the subtree also survives on every other client that applied the delete.
        expect(
          compareVectorClocks(subtaskOp!.vectorClock, remoteMultiOp.vectorClock),
        ).toBe(VectorClockComparison.GREATER_THAN);
        // Parent recreate applies before its subtask recreate.
        expect(appliedOps.indexOf(parentOp!)).toBeLessThan(
          appliedOps.indexOf(subtaskOp!),
        );
      });

      it('recreates subtasks when a single-entity remote delete loses outright (#8956)', async () => {
        // The pure loser is never applied live, but every client that already
        // applied it — and this client's own status-blind hydration replay of
        // the durable loser row — cascade-deleted the winning parent's
        // subtasks. The compensation batch must recreate them too.
        const remoteDelete: Operation = {
          ...createOpWithTimestamp(
            'remote-delete',
            'client-b',
            1_000,
            OpType.Delete,
            'task-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE,
        };
        const localParentEdit = createOpWithTimestamp(
          'local-parent-edit',
          'client-a',
          2_000,
          OpType.Update,
          'task-1',
        );
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) => {
          if (props?.id === 'task-1') {
            return of({ id: 'task-1', title: 'Winning parent', subTaskIds: ['sub-1'] });
          }
          if (props?.id === 'sub-1') {
            return of({
              id: 'sub-1',
              title: 'Surviving subtask',
              parentId: 'task-1',
              subTaskIds: [],
            });
          }
          return of(undefined);
        });

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localParentEdit], [remoteDelete]),
        ]);

        const localOps = getMixedLocalOps();
        const parentOp = localOps.find((op) => op.entityId === 'task-1');
        const subtaskOp = localOps.find((op) => op.entityId === 'sub-1');
        expect(parentOp).withContext('parent compensation op').toBeDefined();
        expect(subtaskOp).withContext('subtask recreate op').toBeDefined();
        expect(
          (subtaskOp!.payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();
        expect(extractActionPayload(subtaskOp!.payload)['title']).toBe(
          'Surviving subtask',
        );
        expect(
          compareVectorClocks(subtaskOp!.vectorClock, remoteDelete.vectorClock),
        ).toBe(VectorClockComparison.GREATER_THAN);
        // Loser + compensations are persisted (after the loser, so seq-ordered
        // hydration replays the cascade first, then the recreations) — but
        // nothing applies live; this client's state already holds the subtree.
        expect(getMixedRemoteOps().map(({ id }) => id)).toEqual([remoteDelete.id]);
        expect(mockOperationApplier.applyOperations).not.toHaveBeenCalled();
      });

      it('recreates project tasks when a remote deleteProject loses outright (#8997)', async () => {
        const remoteProjectDelete: Operation = {
          ...createOpWithTimestamp(
            'remote-project-delete',
            'client-b',
            1_000,
            OpType.Delete,
            'project-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
          entityType: 'PROJECT',
          payload: {
            actionPayload: {
              projectId: 'project-1',
              allTaskIds: ['regular-task', 'locally-gone', 'regular-task', 42],
              noteIds: [],
            },
            entityChanges: [],
          },
        };
        const localProjectEdit: Operation = {
          ...createOpWithTimestamp(
            'local-project-edit',
            'client-a',
            2_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) => {
          if (props?.id === 'project-1') {
            return of({
              id: 'project-1',
              title: 'Winning project',
              taskIds: ['regular-task'],
              backlogTaskIds: ['backlog-task'],
            });
          }
          if (props?.id === 'regular-task') {
            return of({
              id: 'regular-task',
              title: 'Regular task',
              projectId: 'project-1',
              subTaskIds: ['subtask'],
            });
          }
          if (props?.id === 'backlog-task') {
            return of({
              id: 'backlog-task',
              title: 'Backlog task',
              projectId: 'project-1',
              subTaskIds: [],
            });
          }
          if (props?.id === 'subtask') {
            return of({
              id: 'subtask',
              title: 'Subtask',
              projectId: 'project-1',
              parentId: 'regular-task',
              subTaskIds: [],
            });
          }
          return of(undefined);
        });

        await service.autoResolveConflictsLWW([
          {
            entityType: 'PROJECT',
            entityId: 'project-1',
            localOps: [localProjectEdit],
            remoteOps: [remoteProjectDelete],
            suggestedResolution: 'manual',
          },
        ]);

        const localOps = getMixedLocalOps();
        expect(localOps[0].entityType).toBe('PROJECT');
        expect(localOps[0].entityId).toBe('project-1');
        const projectCompensations = localOps.filter((op) => op.entityType === 'PROJECT');
        expect(projectCompensations.length).toBe(2);
        expect(
          compareVectorClocks(
            projectCompensations[1].vectorClock,
            projectCompensations[0].vectorClock,
          ),
        ).toBe(VectorClockComparison.GREATER_THAN);
        expect(
          extractActionPayload(projectCompensations[1].payload)['backlogTaskIds'],
        ).toEqual(['backlog-task']);
        const taskRecreations = localOps.filter((op) => op.entityType === 'TASK');
        // Backlog and subtask are absent from the stale remote payload, but the
        // winning project snapshot and its current root relationships include
        // them. Recovery must mirror the replay-time delete cascade.
        expect(taskRecreations.map(({ entityId }) => entityId)).toEqual([
          'regular-task',
          'backlog-task',
          'subtask',
          'regular-task',
        ]);
        expect(
          (taskRecreations[3].payload as { lwwUpdateMode?: string }).lwwUpdateMode,
        ).toBe('patch');
        expect(extractActionPayload(taskRecreations[3].payload)).toEqual({
          id: 'regular-task',
          projectId: 'project-1',
          parentId: undefined,
          subTaskIds: ['subtask'],
        });
        for (const recreationOp of taskRecreations) {
          expect(
            (recreationOp.payload as { recreatesEntityAfterDelete?: boolean })
              .recreatesEntityAfterDelete,
          )
            .withContext(`recreate flag on ${recreationOp.entityId}`)
            .toBeTrue();
          expect(
            compareVectorClocks(
              recreationOp.vectorClock,
              remoteProjectDelete.vectorClock,
            ),
          )
            .withContext(`clock domination for ${recreationOp.entityId}`)
            .toBe(VectorClockComparison.GREATER_THAN);
        }
        expect(extractActionPayload(taskRecreations[0].payload)['title']).toBe(
          'Regular task',
        );
        expect(getMixedRemoteOps().map(({ id }) => id)).toEqual([remoteProjectDelete.id]);
        expect(mockOperationApplier.applyOperations).not.toHaveBeenCalled();
      });

      it('recreates notes, sections and repeat-cfgs of a losing deleteProject (#9037)', async () => {
        const remoteProjectDelete: Operation = {
          ...createOpWithTimestamp(
            'remote-project-delete',
            'client-b',
            1_000,
            OpType.Delete,
            'project-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
          entityType: 'PROJECT',
          payload: {
            actionPayload: {
              projectId: 'project-1',
              allTaskIds: [],
              noteIds: ['noteA'],
            },
            entityChanges: [],
          },
        };
        const localProjectEdit: Operation = {
          ...createOpWithTimestamp(
            'local-project-edit',
            'client-a',
            2_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        const noteSel = mockEntityRegistry.NOTE!.selectEntities;
        const sectionSel = mockEntityRegistry.SECTION!.selectEntities;
        const cfgSel = mockEntityRegistry.TASK_REPEAT_CFG!.selectEntities;
        mockStore.select.and.callFake((selector: unknown, props?: { id: string }) => {
          if (props?.id === 'project-1') {
            return of({
              id: 'project-1',
              title: 'Winning project',
              taskIds: [],
              backlogTaskIds: [],
            });
          }
          if (selector === noteSel) {
            return of({
              noteA: { id: 'noteA', content: 'Kept note', modified: 5_000 },
            });
          }
          if (selector === sectionSel) {
            return of({
              sectionA: {
                id: 'sectionA',
                title: 'Project section',
                contextType: WorkContextType.PROJECT,
                contextId: 'project-1',
                taskIds: [],
              },
              // Belongs to a different project — must NOT be recreated.
              sectionOther: {
                id: 'sectionOther',
                title: 'Other section',
                contextType: WorkContextType.PROJECT,
                contextId: 'project-2',
                taskIds: [],
              },
            });
          }
          if (selector === cfgSel) {
            return of({
              cfgA: { id: 'cfgA', title: 'Repeat', projectId: 'project-1' },
              // Different project — must NOT be recreated.
              cfgOther: { id: 'cfgOther', title: 'Other', projectId: 'project-2' },
            });
          }
          return of(undefined);
        });

        await service.autoResolveConflictsLWW([
          {
            entityType: 'PROJECT',
            entityId: 'project-1',
            localOps: [localProjectEdit],
            remoteOps: [remoteProjectDelete],
            suggestedResolution: 'manual',
          },
        ]);

        const localOps = getMixedLocalOps();
        const projectComps = localOps.filter((op) => op.entityType === 'PROJECT');
        const noteRecreations = localOps.filter((op) => op.entityType === 'NOTE');
        const sectionRecreations = localOps.filter((op) => op.entityType === 'SECTION');
        const cfgRecreations = localOps.filter(
          (op) => op.entityType === 'TASK_REPEAT_CFG',
        );

        expect(noteRecreations.map(({ entityId }) => entityId)).toEqual(['noteA']);
        expect(sectionRecreations.map(({ entityId }) => entityId)).toEqual(['sectionA']);
        expect(cfgRecreations.map(({ entityId }) => entityId)).toEqual(['cfgA']);

        for (const op of [...noteRecreations, ...sectionRecreations, ...cfgRecreations]) {
          expect(
            (op.payload as { recreatesEntityAfterDelete?: boolean })
              .recreatesEntityAfterDelete,
          )
            .withContext(`recreate flag on ${op.entityType}:${op.entityId}`)
            .toBeTrue();
          expect((op.payload as { lwwUpdateMode?: string }).lwwUpdateMode)
            .withContext(`replace mode on ${op.entityType}:${op.entityId}`)
            .toBe('replace');
          expect(compareVectorClocks(op.vectorClock, remoteProjectDelete.vectorClock))
            .withContext(`clock domination for ${op.entityType}:${op.entityId}`)
            .toBe(VectorClockComparison.GREATER_THAN);
        }
        // The note carries `modified`, so its own timestamp is preserved (protects a
        // concurrent note edit). Sections/cfgs have no `modified`, so they fall back
        // to the project compensation timestamp.
        expect(noteRecreations[0].timestamp).toBe(5_000);
        expect(sectionRecreations[0].timestamp).toBe(projectComps[0].timestamp);
        expect(cfgRecreations[0].timestamp).toBe(projectComps[0].timestamp);
        expect(extractActionPayload(noteRecreations[0].payload)['id']).toBe('noteA');
      });

      it('skips notes/sections/cfgs concurrently deleted in-batch and strips dead section taskIds (#9037)', async () => {
        const remoteProjectDelete: Operation = {
          ...createOpWithTimestamp(
            'remote-project-delete',
            'client-b',
            1_000,
            OpType.Delete,
            'project-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
          entityType: 'PROJECT',
          payload: {
            actionPayload: {
              projectId: 'project-1',
              allTaskIds: ['task-live'],
              noteIds: ['noteKeep', 'noteGone'],
            },
            entityChanges: [],
          },
        };
        const localProjectEdit: Operation = {
          ...createOpWithTimestamp(
            'local-project-edit',
            'client-a',
            2_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        // Concurrent non-conflicting deletes from a third device, not yet applied
        // to the pre-batch store this recovery reads.
        const concurrentNoteDelete: Operation = {
          ...createOpWithTimestamp(
            'del-note',
            'client-c',
            1_500,
            OpType.Delete,
            'noteGone',
          ),
          entityType: 'NOTE',
          actionType: ActionType.TASK_SHARED_DELETE,
        };
        const concurrentSectionDelete: Operation = {
          ...createOpWithTimestamp(
            'del-sec',
            'client-c',
            1_500,
            OpType.Delete,
            'sectionGone',
          ),
          entityType: 'SECTION',
          actionType: ActionType.TASK_SHARED_DELETE,
        };
        const concurrentTaskDelete: Operation = {
          ...createOpWithTimestamp(
            'del-task',
            'client-c',
            1_500,
            OpType.Delete,
            'task-gone',
          ),
          entityType: 'TASK',
          actionType: ActionType.TASK_SHARED_DELETE,
        };
        const noteSel = mockEntityRegistry.NOTE!.selectEntities;
        const sectionSel = mockEntityRegistry.SECTION!.selectEntities;
        const cfgSel = mockEntityRegistry.TASK_REPEAT_CFG!.selectEntities;
        mockStore.select.and.callFake((selector: unknown, props?: { id: string }) => {
          if (props?.id === 'project-1') {
            return of({
              id: 'project-1',
              title: 'Winning project',
              taskIds: ['task-live'],
              backlogTaskIds: [],
            });
          }
          if (props?.id === 'task-live') {
            return of({
              id: 'task-live',
              title: 'Live task',
              projectId: 'project-1',
              subTaskIds: [],
            });
          }
          if (selector === noteSel) {
            return of({
              noteKeep: { id: 'noteKeep', content: 'Keep', modified: 5_000 },
              noteGone: { id: 'noteGone', content: 'Gone', modified: 5_000 },
            });
          }
          if (selector === sectionSel) {
            return of({
              sectionKeep: {
                id: 'sectionKeep',
                title: 'Keep',
                contextType: WorkContextType.PROJECT,
                contextId: 'project-1',
                taskIds: ['task-live', 'task-gone'],
              },
              sectionGone: {
                id: 'sectionGone',
                title: 'Gone',
                contextType: WorkContextType.PROJECT,
                contextId: 'project-1',
                taskIds: [],
              },
            });
          }
          if (selector === cfgSel) {
            return of({});
          }
          return of(undefined);
        });

        await service.autoResolveConflictsLWW(
          [
            {
              entityType: 'PROJECT',
              entityId: 'project-1',
              localOps: [localProjectEdit],
              remoteOps: [remoteProjectDelete],
              suggestedResolution: 'manual',
            },
          ],
          [concurrentNoteDelete, concurrentSectionDelete, concurrentTaskDelete],
        );

        const localOps = getMixedLocalOps();
        const noteRecreations = localOps.filter((op) => op.entityType === 'NOTE');
        const sectionRecreations = localOps.filter((op) => op.entityType === 'SECTION');

        // note-gone / section-gone were concurrently deleted → not resurrected.
        expect(noteRecreations.map(({ entityId }) => entityId)).toEqual(['noteKeep']);
        expect(sectionRecreations.map(({ entityId }) => entityId)).toEqual([
          'sectionKeep',
        ]);
        // The surviving section drops its ref to the concurrently-deleted task.
        expect(extractActionPayload(sectionRecreations[0].payload)['taskIds']).toEqual([
          'task-live',
        ]);
      });

      it('does not resurrect a task deleted by a concurrent non-conflicting op (#8997 review)', async () => {
        // Device A wins a project rename vs Device B's deleteProject(P) (loses
        // LWW). In the SAME sync batch, Device C's independent deleteTask lands
        // as a non-conflicting op. The recovery reads task presence from the
        // pre-batch store, so it must skip a task another device is concurrently
        // deleting — otherwise its recreation (carrying a borrowed newer
        // timestamp) resurrects the task on every client that applied C's
        // delete, and diverges from this client, whose own delete wins locally.
        const remoteProjectDelete: Operation = {
          ...createOpWithTimestamp(
            'remote-project-delete',
            'client-b',
            1_000,
            OpType.Delete,
            'project-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
          entityType: 'PROJECT',
          payload: {
            actionPayload: {
              projectId: 'project-1',
              allTaskIds: ['regular-task'],
              noteIds: [],
            },
            entityChanges: [],
          },
        };
        const localProjectEdit: Operation = {
          ...createOpWithTimestamp(
            'local-project-edit',
            'client-a',
            2_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        const concurrentBacklogDelete: Operation = {
          ...createOpWithTimestamp(
            'remote-delete-backlog',
            'client-c',
            1_500,
            OpType.Delete,
            'backlog-task',
          ),
          actionType: ActionType.TASK_SHARED_DELETE,
        };
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) => {
          if (props?.id === 'project-1') {
            return of({
              id: 'project-1',
              title: 'Winning project',
              taskIds: ['regular-task'],
              backlogTaskIds: ['backlog-task'],
            });
          }
          if (props?.id === 'regular-task') {
            return of({
              id: 'regular-task',
              title: 'Regular task',
              projectId: 'project-1',
              subTaskIds: [],
            });
          }
          // Still present in the pre-batch store: C's delete has not applied yet.
          if (props?.id === 'backlog-task') {
            return of({
              id: 'backlog-task',
              title: 'Backlog task',
              projectId: 'project-1',
              subTaskIds: [],
            });
          }
          return of(undefined);
        });

        await service.autoResolveConflictsLWW(
          [
            {
              entityType: 'PROJECT',
              entityId: 'project-1',
              localOps: [localProjectEdit],
              remoteOps: [remoteProjectDelete],
              suggestedResolution: 'manual',
            },
          ],
          [concurrentBacklogDelete],
        );

        const taskRecreations = getMixedLocalOps().filter(
          (op) => op.entityType === 'TASK',
        );
        expect(taskRecreations.map(({ entityId }) => entityId))
          .withContext('recovery must not recreate a concurrently-deleted task')
          .not.toContain('backlog-task');
        // The genuinely-present task is still recovered.
        expect(taskRecreations.map(({ entityId }) => entityId)).toContain('regular-task');
      });

      it('does not resurrect tasks removed by a concurrent bulk deleteTasks (#8997 review)', async () => {
        // Same split-brain as the single-delete case above, but Device C removes
        // the tasks with a bulk deleteTasks (TASK_SHARED_DELETE_MULTIPLE). Such
        // an op carries every id in `entityIds` and only the FIRST in
        // `entityId`, with an empty `entityChanges`. Recovery must skip ALL of
        // them; otherwise every id after the first is recreated (with a borrowed
        // newer timestamp) and resurrected on every client that applied C's
        // delete, while this client's own bulk delete wins locally.
        const remoteProjectDelete: Operation = {
          ...createOpWithTimestamp(
            'remote-project-delete',
            'client-b',
            1_000,
            OpType.Delete,
            'project-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
          entityType: 'PROJECT',
          payload: {
            actionPayload: {
              projectId: 'project-1',
              allTaskIds: ['regular-task', 'backlog-task-1', 'backlog-task-2'],
              noteIds: [],
            },
            entityChanges: [],
          },
        };
        const localProjectEdit: Operation = {
          ...createOpWithTimestamp(
            'local-project-edit',
            'client-a',
            2_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        const concurrentBulkDelete: Operation = {
          ...createOpWithTimestamp(
            'remote-bulk-delete',
            'client-c',
            1_500,
            OpType.Delete,
            // A bulk delete op's primary entityId is the first of entityIds.
            'backlog-task-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          entityIds: ['backlog-task-1', 'backlog-task-2'],
          payload: {
            actionPayload: { taskIds: ['backlog-task-1', 'backlog-task-2'] },
            entityChanges: [],
          },
        };
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) => {
          if (props?.id === 'project-1') {
            return of({
              id: 'project-1',
              title: 'Winning project',
              taskIds: ['regular-task'],
              backlogTaskIds: ['backlog-task-1', 'backlog-task-2'],
            });
          }
          if (props?.id === 'regular-task') {
            return of({
              id: 'regular-task',
              title: 'Regular task',
              projectId: 'project-1',
              subTaskIds: [],
            });
          }
          // Both bulk-deleted tasks are still present in the pre-batch store:
          // C's delete has not applied yet.
          if (props?.id === 'backlog-task-1' || props?.id === 'backlog-task-2') {
            return of({
              id: props.id,
              title: props.id,
              projectId: 'project-1',
              subTaskIds: [],
            });
          }
          return of(undefined);
        });

        await service.autoResolveConflictsLWW(
          [
            {
              entityType: 'PROJECT',
              entityId: 'project-1',
              localOps: [localProjectEdit],
              remoteOps: [remoteProjectDelete],
              suggestedResolution: 'manual',
            },
          ],
          [concurrentBulkDelete],
        );

        const recreatedIds = getMixedLocalOps()
          .filter((op) => op.entityType === 'TASK')
          .map(({ entityId }) => entityId);
        expect(recreatedIds)
          .withContext('recovery must skip the first id of a concurrent bulk delete')
          .not.toContain('backlog-task-1');
        expect(recreatedIds)
          .withContext('recovery must skip every trailing id of a concurrent bulk delete')
          .not.toContain('backlog-task-2');
        // The genuinely-present task is still recovered.
        expect(recreatedIds).toContain('regular-task');
      });

      it('does not recreate a task whose own conflict a remote delete won (#8997 review)', async () => {
        // The concurrent task delete arrives as its OWN conflict (this client
        // had a competing edit that lost LWW), not as a non-conflicting op, so
        // it is invisible to the nonConflictingOps scan. Project recovery must
        // still skip it: the delete just won and is applied this batch, so a
        // recreation would fight a resolution that already stood.
        const remoteProjectDelete: Operation = {
          ...createOpWithTimestamp(
            'remote-project-delete',
            'client-b',
            1_000,
            OpType.Delete,
            'project-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
          entityType: 'PROJECT',
          payload: {
            actionPayload: {
              projectId: 'project-1',
              allTaskIds: ['regular-task', 'contested-task'],
              noteIds: [],
            },
            entityChanges: [],
          },
        };
        const localProjectEdit: Operation = {
          ...createOpWithTimestamp(
            'local-project-edit',
            'client-a',
            2_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        // Task conflict: this client's edit (older) loses to client-c's delete.
        const localTaskEdit: Operation = {
          ...createOpWithTimestamp(
            'local-task-edit',
            'client-a',
            500,
            OpType.Update,
            'contested-task',
          ),
          actionType: ActionType.TASK_SHARED_UPDATE,
          payload: {
            actionPayload: { task: { id: 'contested-task', changes: { title: 'Mine' } } },
            entityChanges: [],
          },
        };
        const remoteTaskDelete: Operation = {
          ...createOpWithTimestamp(
            'remote-task-delete',
            'client-c',
            3_000,
            OpType.Delete,
            'contested-task',
          ),
          actionType: ActionType.TASK_SHARED_DELETE,
        };
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) => {
          if (props?.id === 'project-1') {
            return of({
              id: 'project-1',
              title: 'Winning project',
              taskIds: ['regular-task', 'contested-task'],
              backlogTaskIds: [],
            });
          }
          if (props?.id === 'regular-task') {
            return of({
              id: 'regular-task',
              title: 'Regular task',
              projectId: 'project-1',
              subTaskIds: [],
            });
          }
          // Still present in the pre-batch store: client-c's delete is only
          // applied as this batch resolves.
          if (props?.id === 'contested-task') {
            return of({
              id: 'contested-task',
              title: 'Contested task',
              projectId: 'project-1',
              subTaskIds: [],
            });
          }
          return of(undefined);
        });

        await service.autoResolveConflictsLWW([
          {
            entityType: 'PROJECT',
            entityId: 'project-1',
            localOps: [localProjectEdit],
            remoteOps: [remoteProjectDelete],
            suggestedResolution: 'manual',
          },
          {
            entityType: 'TASK',
            entityId: 'contested-task',
            localOps: [localTaskEdit],
            remoteOps: [remoteTaskDelete],
            suggestedResolution: 'manual',
          },
        ]);

        const recreatedIds = getMixedLocalOps()
          .filter(
            (op) =>
              op.entityType === 'TASK' &&
              isLwwUpdatePayload(op.payload) &&
              op.payload.recreatesEntityAfterDelete === true,
          )
          .map(({ entityId }) => entityId);
        expect(recreatedIds)
          .withContext('recovery must not recreate a task whose delete just won LWW')
          .not.toContain('contested-task');
        // The uncontested task is still recovered.
        expect(recreatedIds).toContain('regular-task');
      });

      it('recreates project tasks with each task’s own modified timestamp, not the project’s (#8997 review)', async () => {
        // The project edit is much newer (9000) than the task's last change
        // (4321). Borrowing the project timestamp would let the recreation win
        // a CONCURRENT content edit on another device and clobber it; the task's
        // own `modified` keeps that edit winning by LWW.
        const remoteProjectDelete: Operation = {
          ...createOpWithTimestamp(
            'remote-project-delete',
            'client-b',
            1_000,
            OpType.Delete,
            'project-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
          entityType: 'PROJECT',
          payload: {
            actionPayload: {
              projectId: 'project-1',
              allTaskIds: ['regular-task'],
              noteIds: [],
            },
            entityChanges: [],
          },
        };
        const localProjectEdit: Operation = {
          ...createOpWithTimestamp(
            'local-project-edit',
            'client-a',
            9_000,
            OpType.Update,
            'project-1',
          ),
          entityType: 'PROJECT',
        };
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) => {
          if (props?.id === 'project-1') {
            return of({
              id: 'project-1',
              title: 'Winning project',
              taskIds: ['regular-task'],
              backlogTaskIds: [],
            });
          }
          if (props?.id === 'regular-task') {
            return of({
              id: 'regular-task',
              title: 'Regular task',
              projectId: 'project-1',
              subTaskIds: [],
              modified: 4_321,
            });
          }
          return of(undefined);
        });

        await service.autoResolveConflictsLWW([
          {
            entityType: 'PROJECT',
            entityId: 'project-1',
            localOps: [localProjectEdit],
            remoteOps: [remoteProjectDelete],
            suggestedResolution: 'manual',
          },
        ]);

        const taskRecreation = getMixedLocalOps().find(
          (op) =>
            op.entityType === 'TASK' &&
            op.entityId === 'regular-task' &&
            (op.payload as { lwwUpdateMode?: string }).lwwUpdateMode !== 'patch',
        );
        expect(taskRecreation?.timestamp)
          .withContext('recreation uses the task’s own modified, not the project edit')
          .toBe(4_321);
      });

      it('preserves the recreation guard when a task recreation wins again (#8997)', async () => {
        const localTaskRecreation: Operation = {
          ...createOpWithTimestamp(
            'local-project-task-recreation',
            'client-a',
            2_000,
            OpType.Update,
            'task-1',
          ),
          actionType: '[TASK] LWW Update' as ActionType,
          payload: {
            actionPayload: {
              id: 'task-1',
              title: 'Winning task',
              projectId: 'project-1',
              subTaskIds: ['sub-1'],
            },
            entityChanges: [],
            lwwUpdateMode: 'replace',
            recreatesEntityAfterDelete: true,
          },
        };
        const remoteTaskEdit: Operation = {
          ...createOpWithTimestamp(
            'remote-task-edit',
            'client-b',
            1_000,
            OpType.Update,
            'task-1',
          ),
        };
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) => {
          if (props?.id === 'task-1') {
            return of({
              id: 'task-1',
              title: 'Winning task',
              projectId: 'project-1',
              subTaskIds: ['sub-1'],
            });
          }
          if (props?.id === 'sub-1') {
            return of({
              id: 'sub-1',
              title: 'Surviving subtask',
              projectId: 'project-1',
              parentId: 'task-1',
              subTaskIds: [],
            });
          }
          if (props?.id === 'project-1') {
            return of({
              id: 'project-1',
              taskIds: ['regular-task'],
              backlogTaskIds: ['older-backlog-task', 'task-1'],
            });
          }
          return of(undefined);
        });

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localTaskRecreation], [remoteTaskEdit]),
        ]);

        const replacementTaskOp = getMixedLocalOps().find(
          (op) => op.entityType === 'TASK' && op.entityId === 'task-1',
        );
        expect(replacementTaskOp).toBeDefined();
        expect(
          (replacementTaskOp!.payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();
        const subtaskFollowUp = getMixedLocalOps().find(
          (op) => op.entityType === 'TASK' && op.entityId === 'sub-1',
        );
        expect(subtaskFollowUp).toBeDefined();
        expect(
          (subtaskFollowUp!.payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();
        const projectFollowUp = getMixedLocalOps().find(
          (op) => op.entityType === 'PROJECT' && op.entityId === 'project-1',
        );
        expect(projectFollowUp).toBeDefined();
        expect(extractActionPayload(projectFollowUp!.payload)['backlogTaskIds']).toEqual([
          'older-backlog-task',
          'task-1',
        ]);
        expect(
          compareVectorClocks(
            projectFollowUp!.vectorClock,
            replacementTaskOp!.vectorClock,
          ),
        ).toBe(VectorClockComparison.GREATER_THAN);
      });

      it('recreates a remote move winner after a project recovery row is rejected (#8997)', async () => {
        const localTaskRecreation: Operation = {
          ...createOpWithTimestamp(
            'local-project-task-recreation',
            'client-a',
            1_000,
            OpType.Update,
            'task-1',
          ),
          actionType: '[TASK] LWW Update' as ActionType,
          payload: {
            actionPayload: {
              id: 'task-1',
              title: 'Local winning content',
              projectId: 'project-1',
              parentId: null,
              subTaskIds: ['sub-1'],
            },
            entityChanges: [],
            lwwUpdateMode: 'replace',
            recreatesEntityAfterDelete: true,
          },
        };
        const remoteMove: Operation = {
          ...createOpWithTimestamp(
            'remote-parent-move',
            'client-b',
            2_000,
            OpType.Update,
            'task-1',
          ),
          actionType: ActionType.TASK_SHARED_MOVE_TO_PROJECT,
          payload: {
            actionPayload: {
              task: {
                id: 'task-1',
                title: 'Remote stale preimage',
                projectId: 'project-1',
                parentId: null,
                subTaskIds: ['sub-1'],
                subTasks: [
                  {
                    id: 'sub-1',
                    title: 'Child task',
                    projectId: 'project-1',
                    parentId: 'task-1',
                    subTaskIds: [],
                  },
                ],
              },
              targetProjectId: 'project-2',
            },
            entityChanges: [],
          },
        };
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) => {
          if (props?.id === 'sub-1') {
            return of({
              id: 'sub-1',
              title: 'Child task',
              projectId: 'project-1',
              parentId: 'task-1',
              subTaskIds: [],
            });
          }
          if (props?.id === 'project-2') {
            return of({
              id: 'project-2',
              taskIds: ['older-task'],
              backlogTaskIds: [],
            });
          }
          return of(undefined);
        });

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localTaskRecreation], [remoteMove]),
        ]);

        expect(getMixedRemoteOps().map(({ id }) => id)).toContain(remoteMove.id);
        const localOps = getMixedLocalOps();
        const parentOps = localOps.filter(({ entityId }) => entityId === 'task-1');
        expect(parentOps.length).toBe(2);
        expect(extractActionPayload(parentOps[0].payload)['projectId']).toBe('project-2');
        expect(extractActionPayload(parentOps[0].payload)['title']).toBe(
          'Local winning content',
        );
        expect(extractActionPayload(parentOps[1].payload)).toEqual({
          id: 'task-1',
          projectId: 'project-2',
          parentId: null,
          subTaskIds: ['sub-1'],
        });
        expect(
          (parentOps[0].payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();
        const childOp = localOps.find(({ entityId }) => entityId === 'sub-1');
        expect(extractActionPayload(childOp!.payload)['projectId']).toBe('project-2');
        const projectOp = localOps.find(
          ({ entityType, entityId }) =>
            entityType === 'PROJECT' && entityId === 'project-2',
        );
        expect(extractActionPayload(projectOp!.payload)['taskIds']).toEqual([
          'older-task',
          'task-1',
        ]);
      });

      it('does not recreate a project recovery task when remote archive wins (#8997)', async () => {
        const localTaskRecreation: Operation = {
          ...createOpWithTimestamp(
            'local-project-task-recreation',
            'client-a',
            1_000,
            OpType.Update,
            'task-1',
          ),
          actionType: '[TASK] LWW Update' as ActionType,
          payload: {
            actionPayload: {
              id: 'task-1',
              title: 'Task',
              projectId: 'project-1',
              subTaskIds: [],
            },
            entityChanges: [],
            lwwUpdateMode: 'replace',
            recreatesEntityAfterDelete: true,
          },
        };
        const remoteArchive: Operation = {
          ...createOpWithTimestamp(
            'remote-archive',
            'client-b',
            2_000,
            OpType.Update,
            'task-1',
          ),
          actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
          payload: {
            actionPayload: { tasks: [{ id: 'task-1', title: 'Task' }] },
            entityChanges: [],
          },
        };

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localTaskRecreation], [remoteArchive]),
        ]);

        expect(getMixedLocalOps()).toEqual([]);
      });

      it('reconstructs a supported remote task field update', async () => {
        const localTaskRecreation: Operation = {
          ...createOpWithTimestamp(
            'local-project-task-recreation',
            'client-a',
            1_000,
            OpType.Update,
            'task-1',
          ),
          actionType: toLwwUpdateActionType('TASK'),
          payload: {
            actionPayload: {
              id: 'task-1',
              title: 'Local title',
              projectId: 'project-1',
              subTaskIds: [],
            },
            entityChanges: [],
            lwwUpdateMode: 'replace',
            recreatesEntityAfterDelete: true,
          },
        };
        const remoteUpdate: Operation = {
          ...createOpWithTimestamp(
            'remote-task-update',
            'client-b',
            2_000,
            OpType.Update,
            'task-1',
          ),
          actionType: ActionType.TASK_SHARED_UPDATE,
          payload: {
            actionPayload: {
              task: { id: 'task-1', changes: { title: 'Remote title' } },
            },
            entityChanges: [],
          },
        };

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localTaskRecreation], [remoteUpdate]),
        ]);

        const compensation = getMixedLocalOps().find(
          ({ entityType, entityId }) => entityType === 'TASK' && entityId === 'task-1',
        );
        expect(compensation).toBeDefined();
        expect(extractActionPayload(compensation!.payload)['title']).toBe('Remote title');
      });

      [
        {
          name: 'convertToSubTask',
          actionType: ActionType.TASK_SHARED_CONVERT_TO_SUB,
          actionPayload: {
            taskId: 'task-1',
            targetParentId: 'parent-1',
            afterTaskId: null,
          },
        },
        {
          name: 'scheduleTaskWithTime',
          actionType: ActionType.TASK_SHARED_SCHEDULE_WITH_TIME,
          actionPayload: {
            task: { id: 'task-1', title: 'Remote stale preimage' },
            dueWithTime: 1_000,
          },
        },
        {
          name: 'applyShortSyntax',
          actionType: ActionType.TASK_SHARED_APPLY_SHORT_SYNTAX,
          actionPayload: {
            task: { id: 'task-1', title: 'Remote stale preimage' },
            taskChanges: { title: 'Remote' },
          },
        },
      ].forEach(({ name, actionType, actionPayload }) => {
        it(`does not incorrectly reconstruct opaque ${name} winners`, async () => {
          const localTaskRecreation: Operation = {
            ...createOpWithTimestamp(
              'local-project-task-recreation',
              'client-a',
              1_000,
              OpType.Update,
              'task-1',
            ),
            actionType: toLwwUpdateActionType('TASK'),
            payload: {
              actionPayload: {
                id: 'task-1',
                title: 'Local title',
                projectId: 'project-1',
                subTaskIds: [],
              },
              entityChanges: [],
              lwwUpdateMode: 'replace',
              recreatesEntityAfterDelete: true,
            },
          };
          const remoteUpdate: Operation = {
            ...createOpWithTimestamp(
              `remote-${name}`,
              'client-b',
              2_000,
              OpType.Update,
              'task-1',
            ),
            actionType,
            payload: { actionPayload, entityChanges: [] },
          };

          await service.autoResolveConflictsLWW([
            createConflict('task-1', [localTaskRecreation], [remoteUpdate]),
          ]);

          expect(getMixedLocalOps()).toEqual([]);
          const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
            .args[0] as Operation[];
          expect(appliedOps.map(({ id }) => id)).toContain(remoteUpdate.id);
        });
      });

      it('restores exact sibling order when a subtask recreation is rewritten (#8997)', async () => {
        const rewrittenSubtask: Operation = {
          ...createOpWithTimestamp(
            'rewritten-subtask-recreation',
            'client-a',
            2_000,
            OpType.Update,
            'sub-1',
          ),
          actionType: '[TASK] LWW Update' as ActionType,
          payload: {
            actionPayload: {
              id: 'sub-1',
              title: 'First subtask',
              projectId: 'project-1',
              parentId: 'parent-1',
              subTaskIds: [],
            },
            entityChanges: [],
            lwwUpdateMode: 'replace',
            recreatesEntityAfterDelete: true,
          },
        };
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) =>
          of(
            props?.id === 'parent-1'
              ? {
                  id: 'parent-1',
                  title: 'Parent',
                  projectId: 'project-1',
                  parentId: null,
                  subTaskIds: ['sub-1', 'sub-2'],
                }
              : undefined,
          ),
        );

        const followUpOps =
          await service.createTaskRecreationFollowUpOps(rewrittenSubtask);

        expect(followUpOps.length).toBe(1);
        expect(followUpOps[0].entityType).toBe('TASK');
        expect(followUpOps[0].entityId).toBe('parent-1');
        expect(extractActionPayload(followUpOps[0].payload)['subTaskIds']).toEqual([
          'sub-1',
          'sub-2',
        ]);
        expect(extractActionPayload(followUpOps[0].payload)['title']).toBeUndefined();
        expect(
          (followUpOps[0].payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();
        expect(
          compareVectorClocks(followUpOps[0].vectorClock, rewrittenSubtask.vectorClock),
        ).toBe(VectorClockComparison.GREATER_THAN);
      });

      it('recreates subtasks when every entity of a remote bulk delete loses (#8956)', async () => {
        const remoteMultiOp: Operation = {
          ...createOpWithTimestamp('remote-multi', 'client-b', 1_000),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          opType: OpType.Delete,
          entityId: 'task-1',
          entityIds: ['task-1', 'task-2'],
          payload: {
            actionPayload: { taskIds: ['task-1', 'task-2'] },
            entityChanges: [],
          },
        };
        const localParentEdit = createOpWithTimestamp(
          'local-parent-edit',
          'client-a',
          2_000,
          OpType.Update,
          'task-1',
        );
        const localSiblingEdit = createOpWithTimestamp(
          'local-sibling-edit',
          'client-a',
          3_000,
          OpType.Update,
          'task-2',
        );
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) => {
          if (props?.id === 'task-1') {
            return of({ id: 'task-1', title: 'Winning parent', subTaskIds: ['sub-1'] });
          }
          if (props?.id === 'task-2') {
            return of({ id: 'task-2', title: 'Winning sibling', subTaskIds: [] });
          }
          if (props?.id === 'sub-1') {
            return of({
              id: 'sub-1',
              title: 'Surviving subtask',
              parentId: 'task-1',
              subTaskIds: [],
            });
          }
          return of(undefined);
        });

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localParentEdit], [remoteMultiOp]),
          createConflict('task-2', [localSiblingEdit], [remoteMultiOp]),
        ]);

        const subtaskOps = getMixedLocalOps().filter((op) => op.entityId === 'sub-1');
        expect(subtaskOps.length).withContext('exactly one subtask recreate op').toBe(1);
        expect(
          (subtaskOps[0].payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();
        expect(mockOperationApplier.applyOperations).not.toHaveBeenCalled();
      });

      it('recreates subtree snapshots when a remote parent update beats a local bulk delete', async () => {
        const parentSnapshot = {
          id: 'task-1',
          title: 'Deleted parent',
          subTaskIds: ['sub-1'],
        };
        const subtaskSnapshot = {
          id: 'sub-1',
          title: 'Deleted subtask',
          parentId: 'task-1',
          subTaskIds: [],
        };
        const localBulkDelete: Operation = {
          ...createOpWithTimestamp(
            'local-bulk-delete',
            'client-a',
            1000,
            OpType.Delete,
            'task-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          entityIds: ['task-1'],
          payload: {
            actionPayload: {
              taskIds: ['task-1'],
              tasks: [parentSnapshot, subtaskSnapshot],
            },
            entityChanges: [],
          },
        };
        const remoteParentUpdate: Operation = {
          ...createOpWithTimestamp(
            'remote-parent-update',
            'client-b',
            2000,
            OpType.Update,
            'task-1',
          ),
          payload: {
            task: { id: 'task-1', changes: { title: 'Remote parent' } },
          },
        };
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localBulkDelete], [remoteParentUpdate]),
        ]);

        const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
          .args[0] as Operation[];
        const parentOp = appliedOps.find((op) => op.entityId === 'task-1');
        const subtaskOp = appliedOps.find((op) => op.entityId === 'sub-1');
        expect(parentOp?.actionType).toBe(toLwwUpdateActionType('TASK'));
        expect(subtaskOp).withContext('subtask recreate op').toBeDefined();
        expect(extractActionPayload(subtaskOp!.payload)).toEqual(subtaskSnapshot);
        expect(
          (subtaskOp!.payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeTrue();
        expect(appliedOps.indexOf(parentOp!)).toBeLessThan(
          appliedOps.indexOf(subtaskOp!),
        );
      });

      it('does not recreate a child removed by the winning remote parent state', async () => {
        const localBulkDelete: Operation = {
          ...createOpWithTimestamp(
            'local-bulk-delete',
            'client-a',
            1_000,
            OpType.Delete,
            'task-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          entityIds: ['task-1'],
          payload: {
            actionPayload: {
              taskIds: ['task-1'],
              tasks: [
                {
                  id: 'task-1',
                  title: 'Deleted parent',
                  subTaskIds: ['sub-1'],
                },
                {
                  id: 'sub-1',
                  title: 'Removed child',
                  parentId: 'task-1',
                  subTaskIds: [],
                },
              ],
            },
            entityChanges: [],
          },
        };
        const remoteParentUpdate: Operation = {
          ...createOpWithTimestamp(
            'remote-parent-update',
            'client-b',
            2_000,
            OpType.Update,
            'task-1',
          ),
          payload: {
            task: { id: 'task-1', changes: { subTaskIds: [] } },
          },
        };
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localBulkDelete], [remoteParentUpdate]),
        ]);

        const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
          .args[0] as Operation[];
        expect(appliedOps.some((op) => op.entityId === 'sub-1')).toBeFalse();
      });

      it('does not recreate a subtask the local device deleted itself (#8956)', async () => {
        // Same shape as above, but sub-1 was also deleted locally (not present in
        // current state), so it must stay deleted rather than be resurrected.
        const remoteMultiOp: Operation = {
          ...createOpWithTimestamp('remote-multi', 'client-b', 1000),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          opType: OpType.Delete,
          entityId: 'task-1',
          entityIds: ['task-1', 'task-2'],
          payload: {
            actionPayload: { taskIds: ['task-1', 'task-2'] },
            entityChanges: [],
          },
        };
        const localParentEdit = createOpWithTimestamp(
          'local-parent-edit',
          'client-a',
          2000,
          OpType.Update,
          'task-1',
        );
        mockStore.select.and.callFake((_selector: unknown, props?: { id: string }) => {
          if (props?.id === 'task-1') {
            return of({ id: 'task-1', title: 'Winning parent', subTaskIds: ['sub-1'] });
          }
          // sub-1 is gone locally → undefined
          return of(undefined);
        });
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localParentEdit], [remoteMultiOp]),
        ]);

        const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
          .args[0] as Operation[];
        const lwwOps = appliedOps.filter(
          (op) => op.actionType === toLwwUpdateActionType('TASK'),
        );
        expect(lwwOps.some((op) => op.entityId === 'sub-1')).toBeFalse();
      });

      it('persists but does not replay a local delete winner already effected by a remote multi-delete', async () => {
        const remoteMultiDelete: Operation = {
          ...createOpWithTimestamp('remote-delete', 'client-b', 2000),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          opType: OpType.Delete,
          entityId: 'task-1',
          entityIds: ['task-1', 'task-2'],
          payload: {
            actionPayload: { taskIds: ['task-1', 'task-2'] },
            entityChanges: [],
          },
        };
        const localTask1 = createOpWithTimestamp(
          'local-task-1',
          'client-a',
          1000,
          OpType.Update,
          'task-1',
        );
        const localTask2Delete: Operation = {
          ...createOpWithTimestamp(
            'local-task-2-delete',
            'client-a',
            3000,
            OpType.Delete,
            'task-2',
          ),
          actionType: ActionType.TASK_SHARED_DELETE,
          payload: {
            actionPayload: {
              task: { id: 'task-2', title: 'Deleted locally', subTaskIds: [] },
            },
            entityChanges: [],
          },
        };
        mockStore.select.and.returnValue(of(undefined));
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localTask1], [remoteMultiDelete]),
          createConflict('task-2', [localTask2Delete], [remoteMultiDelete]),
        ]);

        const replacementDelete = getFirstMixedLocalOp();
        expect(replacementDelete.opType).toBe(OpType.Delete);
        expect(replacementDelete.actionType).toBe(ActionType.TASK_SHARED_DELETE);
        expect(
          (replacementDelete.payload as { recreatesEntityAfterDelete?: boolean })
            .recreatesEntityAfterDelete,
        ).toBeUndefined();
        const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
          .args[0] as Operation[];
        expect(appliedOps).toEqual([remoteMultiDelete]);
      });

      it('preserves unaffected siblings from a partially rejected local bulk delete', async () => {
        const localBulkDelete: Operation = {
          ...createOpWithTimestamp(
            'local-delete-multiple',
            'client-a',
            1000,
            OpType.Delete,
            'task-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          entityIds: ['task-1', 'task-2'],
          payload: {
            actionPayload: {
              taskIds: ['task-1', 'task-2'],
              tasks: [
                { id: 'task-1', title: 'Task one' },
                {
                  id: 'task-2',
                  title: 'Task two',
                  subTaskIds: ['task-2-child'],
                },
                {
                  id: 'task-2-child',
                  title: 'Task two child',
                  parentId: 'task-2',
                },
              ],
            },
            entityChanges: [
              {
                entityType: 'TASK',
                entityId: 'task-1',
                opType: OpType.Delete,
                changes: {},
              },
              {
                entityType: 'TASK',
                entityId: 'task-2',
                opType: OpType.Delete,
                changes: {},
              },
            ],
          },
        };
        const remoteTask1 = {
          ...createOpWithTimestamp(
            'remote-task-1',
            'client-b',
            2000,
            OpType.Update,
            'task-1',
          ),
          actionType: toLwwUpdateActionType('TASK'),
          payload: {
            actionPayload: { id: 'task-1', title: 'Remote winner' },
            entityChanges: [],
            lwwUpdateMode: 'replace' as const,
          },
        };
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        const result = await service.autoResolveConflictsLWW([
          createConflict('task-1', [localBulkDelete], [remoteTask1]),
        ]);

        const replacementDelete = getFirstMixedLocalOp();
        expect(result.localWinOpsCreated).toBe(1);
        expect(replacementDelete.actionType).toBe(ActionType.TASK_SHARED_DELETE_MULTIPLE);
        expect(replacementDelete.entityId).toBe('task-2');
        expect(replacementDelete.entityIds).toEqual(['task-2']);
        expect(extractActionPayload(replacementDelete.payload)['taskIds']).toEqual([
          'task-2',
        ]);
        expect(
          (
            extractActionPayload(replacementDelete.payload)['tasks'] as Array<{
              id: string;
            }>
          ).map(({ id }) => id),
        ).toEqual(['task-2', 'task-2-child']);
        expect(
          (
            replacementDelete.payload as { entityChanges?: Array<{ entityId: string }> }
          ).entityChanges?.map(({ entityId }) => entityId),
        ).toEqual(['task-2']);
        expect(replacementDelete.vectorClock['client-b']).toBeGreaterThanOrEqual(1);
        expect(
          compareVectorClocks(replacementDelete.vectorClock, localBulkDelete.vectorClock),
        ).toBe(VectorClockComparison.GREATER_THAN);
      });

      it('preserves unaffected siblings from non-task bulk deletes', async () => {
        const localBulkDelete: Operation = {
          ...createOpWithTimestamp(
            'local-tag-delete-multiple',
            'client-a',
            1000,
            OpType.Delete,
            'tag-1',
          ),
          actionType: ActionType.TAG_DELETE_MULTIPLE,
          entityType: 'TAG',
          entityIds: ['tag-1', 'tag-2'],
          payload: {
            actionPayload: { ids: ['tag-1', 'tag-2'] },
            entityChanges: [],
          },
        };
        const remoteWinner: Operation = {
          ...createOpWithTimestamp(
            'remote-tag-1',
            'client-b',
            2000,
            OpType.Update,
            'tag-1',
          ),
          entityType: 'TAG',
        };

        await service.autoResolveConflictsLWW([
          {
            entityType: 'TAG',
            entityId: 'tag-1',
            localOps: [localBulkDelete],
            remoteOps: [remoteWinner],
            suggestedResolution: 'manual',
          },
        ]);

        const replacementDelete = getFirstMixedLocalOp();
        expect(replacementDelete.actionType).toBe(ActionType.TAG_DELETE_MULTIPLE);
        expect(replacementDelete.entityId).toBe('tag-2');
        expect(replacementDelete.entityIds).toEqual(['tag-2']);
        expect(extractActionPayload(replacementDelete.payload)['ids']).toEqual(['tag-2']);
      });

      it('fails closed for a non-decomposable local bulk update', async () => {
        const localBulkUpdate: Operation = {
          ...createOpWithTimestamp(
            'local-bulk-update',
            'client-a',
            1000,
            OpType.Update,
            'task-1',
          ),
          actionType: ActionType.TASK_SHARED_UPDATE_MULTIPLE,
          entityIds: ['task-1', 'task-2'],
          payload: {
            actionPayload: {
              tasks: [
                { id: 'task-1', changes: { title: 'Local one' } },
                { id: 'task-2', changes: { title: 'Local two' } },
              ],
            },
            entityChanges: [],
          },
        };
        const remoteWinner = createOpWithTimestamp(
          'remote-task-1',
          'client-b',
          2000,
          OpType.Update,
          'task-1',
        );
        await expectAsync(
          service.autoResolveConflictsLWW([
            createConflict('task-1', [localBulkUpdate], [remoteWinner]),
          ]),
        ).toBeRejectedWithError(
          /Cannot safely auto-resolve local multi-entity operation/,
        );
        expect(
          mockOpLogStore.appendMixedSourceBatchSkipDuplicates,
        ).not.toHaveBeenCalled();
      });

      it('should not apply a multi-entity remote op when local wins every entity', async () => {
        const remoteMultiOp: Operation = {
          ...createOpWithTimestamp('remote-multi', 'client-b', 1000),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          opType: OpType.Delete,
          entityId: 'task-1',
          entityIds: ['task-1', 'task-2'],
          payload: { taskIds: ['task-1', 'task-2'] },
        };
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-task-1', 'client-a', 2000)],
            [remoteMultiOp],
          ),
          createConflict(
            'task-2',
            [
              createOpWithTimestamp(
                'local-task-2',
                'client-a',
                3000,
                OpType.Update,
                'task-2',
              ),
            ],
            [remoteMultiOp],
          ),
        ];
        mockStore.select.and.returnValue(of({ title: 'Local winning task' }));

        await service.autoResolveConflictsLWW(conflicts);

        expect(getMixedRemoteOps()).toEqual([remoteMultiOp]);
        expect(getMixedLocalOps().length).toBe(2);
        expect(mockOperationApplier.applyOperations).not.toHaveBeenCalled();
      });

      it('fails closed when a multi-entity remote update wins', async () => {
        const remoteMultiOp: Operation = {
          ...createOpWithTimestamp(
            'remote-multi',
            'client-b',
            2000,
            OpType.Update,
            'task-1',
          ),
          actionType: ActionType.TASK_SHARED_UPDATE_MULTIPLE,
          entityIds: ['task-1', 'task-2'],
          payload: {
            actionPayload: {
              tasks: [
                { id: 'task-1', changes: { title: 'Remote winning title' } },
                { id: 'task-2', changes: { title: 'Other remote title' } },
              ],
            },
            entityChanges: [
              {
                entityType: 'TASK',
                entityId: 'task-1',
                opType: OpType.Update,
                changes: { title: 'Remote winning title' },
              },
              {
                entityType: 'TASK',
                entityId: 'task-2',
                opType: OpType.Update,
                changes: { title: 'Other remote title' },
              },
            ],
          },
        };
        const localDelete: Operation = {
          ...createOpWithTimestamp(
            'local-delete',
            'client-a',
            1000,
            OpType.Delete,
            'task-1',
          ),
          actionType: ActionType.TASK_SHARED_DELETE,
          payload: {
            task: { id: 'task-1', title: 'Deleted locally', notes: 'Keep me' },
          },
        };
        const localTask2 = createOpWithTimestamp(
          'local-task-2',
          'client-a',
          1000,
          OpType.Update,
          'task-2',
        );
        await expectAsync(
          service.autoResolveConflictsLWW([
            createConflict('task-1', [localDelete], [remoteMultiOp]),
            createConflict('task-2', [localTask2], [remoteMultiOp]),
          ]),
        ).toBeRejectedWithError(
          /Cannot safely auto-resolve remote multi-entity operation/,
        );
        expect(
          mockOpLogStore.appendMixedSourceBatchSkipDuplicates,
        ).not.toHaveBeenCalled();
        expect(mockOperationApplier.applyOperations).not.toHaveBeenCalled();
      });

      it('should extract entity from DELETE payload when UPDATE wins but entity not in store', () => {
        // This tests the helper method that extracts entity state from DELETE operations
        // Used when remote DELETE is applied first, then local UPDATE wins LWW
        const taskEntity = {
          id: 'task-1',
          title: 'Test Task',
          projectId: 'project-1',
          tagIds: [],
        };

        const conflict: EntityConflict = createConflict(
          'task-1',
          [
            {
              ...createOpWithTimestamp('local-upd', 'client-a', Date.now()),
              opType: OpType.Update,
              payload: { task: taskEntity },
            },
          ],
          [
            {
              ...createOpWithTimestamp('remote-del', 'client-b', Date.now() - 1000),
              opType: OpType.Delete,
              payload: { task: taskEntity }, // DELETE payload contains the deleted entity
            },
          ],
        );

        // Call the private extraction method
        const extractedEntity = (service as any)._extractEntityFromDeleteOperation(
          conflict,
        );

        // Verify it extracted the entity from the DELETE operation's payload
        expect(extractedEntity).toEqual(taskEntity);
      });

      it('should return undefined when no DELETE operation in conflict', () => {
        const conflict: EntityConflict = createConflict(
          'task-1',
          [
            {
              ...createOpWithTimestamp('local-upd', 'client-a', Date.now()),
              opType: OpType.Update,
            },
          ],
          [
            {
              ...createOpWithTimestamp('remote-upd', 'client-b', Date.now() - 1000),
              opType: OpType.Update,
            },
          ],
        );

        const extractedEntity = (service as any)._extractEntityFromDeleteOperation(
          conflict,
        );

        expect(extractedEntity).toBeUndefined();
      });

      it('should handle CREATE vs CREATE conflict using LWW', async () => {
        // Two clients create entity with same ID (rare but possible)
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-same-id',
            [
              {
                ...createOpWithTimestamp('local-create', 'client-a', now - 1000),
                opType: OpType.Create,
                entityId: 'task-same-id',
                payload: { title: 'Local Version' },
              },
            ],
            [
              {
                ...createOpWithTimestamp('remote-create', 'client-b', now),
                opType: OpType.Create,
                entityId: 'task-same-id',
                payload: { title: 'Remote Version' },
              },
            ],
          ),
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        await service.autoResolveConflictsLWW(conflicts);

        // Remote CREATE wins (newer timestamp)
        expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
          jasmine.arrayContaining([
            jasmine.objectContaining({ id: 'remote-create', opType: OpType.Create }),
          ]),
          'remote',
          jasmine.any(Object),
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-create']);
      });

      it('should handle MOV (Move) operation conflicts using LWW', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [
              {
                ...createOpWithTimestamp('local-mov', 'client-a', now),
                opType: OpType.Move,
                payload: { fromIndex: 0, toIndex: 5 },
              },
            ],
            remoteOps: [
              {
                ...createOpWithTimestamp('remote-mov', 'client-b', now - 1000),
                opType: OpType.Move,
                payload: { fromIndex: 0, toIndex: 10 },
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        await service.autoResolveConflictsLWW(conflicts);

        // Local MOV wins (newer timestamp)
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-mov']);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-mov']);
      });

      it('should fail closed for BATCH conflicts that cannot be compensated atomically', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [
              {
                ...createOpWithTimestamp('local-batch', 'client-a', now - 1000),
                opType: OpType.Batch,
                entityIds: ['task-1', 'task-2', 'task-3'],
                payload: { changes: [{ done: true }] },
              },
            ],
            remoteOps: [
              {
                ...createOpWithTimestamp('remote-batch', 'client-b', now),
                opType: OpType.Batch,
                entityIds: ['task-1', 'task-2'],
                payload: { changes: [{ done: false }] },
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        await expectAsync(
          service.autoResolveConflictsLWW(conflicts),
        ).toBeRejectedWithError(
          /Cannot safely auto-resolve remote multi-entity operation/,
        );
        expect(mockOpLogStore.appendBatchSkipDuplicates).not.toHaveBeenCalled();
        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
      });

      it('should handle singleton entity (GLOBAL_CONFIG) conflicts', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'GLOBAL_CONFIG',
            entityId: 'GLOBAL_CONFIG', // Singleton ID
            localOps: [
              {
                id: 'local-config',
                clientId: 'clientA',
                actionType: 'updateGlobalConfig' as ActionType,
                opType: OpType.Update,
                entityType: 'GLOBAL_CONFIG',
                entityId: 'GLOBAL_CONFIG',
                payload: { theme: 'dark' },
                vectorClock: { clientA: 1 },
                timestamp: now,
                schemaVersion: 1,
              },
            ],
            remoteOps: [
              {
                id: 'remote-config',
                clientId: 'clientB',
                actionType: 'updateGlobalConfig' as ActionType,
                opType: OpType.Update,
                entityType: 'GLOBAL_CONFIG',
                entityId: 'GLOBAL_CONFIG',
                payload: { theme: 'light' },
                vectorClock: { clientB: 1 },
                timestamp: now - 1000,
                schemaVersion: 1,
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        await service.autoResolveConflictsLWW(conflicts);

        // Local wins (newer timestamp)
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-config']);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-config']);
      });

      it('should handle PLANNER entity conflicts', async () => {
        const now = Date.now();
        const dayId = '2024-01-15';
        const conflicts: EntityConflict[] = [
          {
            entityType: 'PLANNER',
            entityId: dayId,
            localOps: [
              {
                id: 'local-planner',
                clientId: 'clientA',
                actionType: 'updatePlanner' as ActionType,
                opType: OpType.Update,
                entityType: 'PLANNER',
                entityId: dayId,
                payload: { scheduledTaskIds: ['task-1', 'task-2'] },
                vectorClock: { clientA: 1 },
                timestamp: now - 1000,
                schemaVersion: 1,
              },
            ],
            remoteOps: [
              {
                id: 'remote-planner',
                clientId: 'clientB',
                actionType: 'updatePlanner' as ActionType,
                opType: OpType.Update,
                entityType: 'PLANNER',
                entityId: dayId,
                payload: { scheduledTaskIds: ['task-3', 'task-4'] },
                vectorClock: { clientB: 1 },
                timestamp: now,
                schemaVersion: 1,
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        await service.autoResolveConflictsLWW(conflicts);

        // Remote wins (newer timestamp)
        expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
          jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-planner' })]),
          'remote',
          jasmine.any(Object),
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-planner']);
      });

      it('should handle BOARD entity conflicts', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'BOARD',
            entityId: 'board-1',
            localOps: [
              {
                id: 'local-board',
                clientId: 'clientA',
                actionType: 'updateBoard' as ActionType,
                opType: OpType.Update,
                entityType: 'BOARD',
                entityId: 'board-1',
                payload: { title: 'Local Board' },
                vectorClock: { clientA: 1 },
                timestamp: now,
                schemaVersion: 1,
              },
            ],
            remoteOps: [
              {
                id: 'remote-board',
                clientId: 'clientB',
                actionType: 'updateBoard' as ActionType,
                opType: OpType.Update,
                entityType: 'BOARD',
                entityId: 'board-1',
                payload: { title: 'Remote Board' },
                vectorClock: { clientB: 1 },
                timestamp: now - 1000,
                schemaVersion: 1,
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        await service.autoResolveConflictsLWW(conflicts);

        // Local wins (newer timestamp)
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-board']);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-board']);
      });

      it('should handle REMINDER entity conflicts', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'REMINDER',
            entityId: 'reminder-1',
            localOps: [
              {
                id: 'local-reminder',
                clientId: 'clientA',
                actionType: 'updateReminder' as ActionType,
                opType: OpType.Update,
                entityType: 'REMINDER',
                entityId: 'reminder-1',
                payload: { title: 'Local Reminder', remindAt: now + 3600000 },
                vectorClock: { clientA: 1 },
                timestamp: now - 500,
                schemaVersion: 1,
              },
            ],
            remoteOps: [
              {
                id: 'remote-reminder',
                clientId: 'clientB',
                actionType: 'updateReminder' as ActionType,
                opType: OpType.Update,
                entityType: 'REMINDER',
                entityId: 'reminder-1',
                payload: { title: 'Remote Reminder', remindAt: now + 7200000 },
                vectorClock: { clientB: 1 },
                timestamp: now,
                schemaVersion: 1,
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        await service.autoResolveConflictsLWW(conflicts);

        // Remote wins (newer timestamp)
        expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
          jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-reminder' })]),
          'remote',
          jasmine.any(Object),
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-reminder']);
      });

      // Regression test: PLUGIN_USER_DATA was previously registered as
      // `'virtual'` and silently bypassed LWW. The migration to `'array'`
      // (entity-registry.ts:325-330) wired it through the array branch;
      // this test asserts the wiring actually fires for real conflicts.
      it('should handle PLUGIN_USER_DATA entity conflicts', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'PLUGIN_USER_DATA',
            entityId: 'doc-mode',
            localOps: [
              {
                id: 'local-plugin-data',
                clientId: 'clientA',
                actionType: '[Plugin] Upsert User Data' as ActionType,
                opType: OpType.Update,
                entityType: 'PLUGIN_USER_DATA',
                entityId: 'doc-mode',
                payload: { id: 'doc-mode', data: 'local-blob' },
                vectorClock: { clientA: 1 },
                timestamp: now - 500,
                schemaVersion: 1,
              },
            ],
            remoteOps: [
              {
                id: 'remote-plugin-data',
                clientId: 'clientB',
                actionType: '[Plugin] Upsert User Data' as ActionType,
                opType: OpType.Update,
                entityType: 'PLUGIN_USER_DATA',
                entityId: 'doc-mode',
                payload: { id: 'doc-mode', data: 'remote-blob' },
                vectorClock: { clientB: 1 },
                timestamp: now,
                schemaVersion: 1,
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        await service.autoResolveConflictsLWW(conflicts);

        // Remote wins (newer timestamp). Whole-blob LWW: this is the
        // gap Stage A closes — fine for same-entity, lossy across
        // different sub-keys of the same blob. The acceptance is in the
        // re-bundling decision, not in this test.
        expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
          jasmine.arrayContaining([
            jasmine.objectContaining({ id: 'remote-plugin-data' }),
          ]),
          'remote',
          jasmine.any(Object),
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-plugin-data']);
      });

      it('should handle mixed entity types in conflicts batch', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [createOpWithTimestamp('local-task', 'client-a', now - 1000)],
            remoteOps: [createOpWithTimestamp('remote-task', 'client-b', now)],
            suggestedResolution: 'manual',
          },
          {
            entityType: 'PROJECT',
            entityId: 'project-1',
            localOps: [
              {
                ...createOpWithTimestamp('local-project', 'client-a', now),
                entityType: 'PROJECT',
                entityId: 'project-1',
              },
            ],
            remoteOps: [
              {
                ...createOpWithTimestamp('remote-project', 'client-b', now - 1000),
                entityType: 'PROJECT',
                entityId: 'project-1',
              },
            ],
            suggestedResolution: 'manual',
          },
          {
            entityType: 'TAG',
            entityId: 'tag-1',
            localOps: [
              {
                ...createOpWithTimestamp('local-tag', 'client-a', now - 500),
                entityType: 'TAG',
                entityId: 'tag-1',
              },
            ],
            remoteOps: [
              {
                ...createOpWithTimestamp('remote-tag', 'client-b', now - 500),
                entityType: 'TAG',
                entityId: 'tag-1',
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: [conflicts[0].remoteOps[0], conflicts[2].remoteOps[0]],
        });

        const bannerSpy = spyOn(
          TestBed.inject(SyncConflictBannerService),
          'maybeShowSummaryBanner',
        ).and.resolveTo();

        await service.autoResolveConflictsLWW(conflicts);

        // Task: remote wins (newer), Tag: remote wins (tie goes to remote).
        // Both share the atomic resolution append with the local PROJECT win.
        expect(getMixedRemoteOps()).toEqual(
          jasmine.arrayContaining([
            jasmine.objectContaining({ id: 'remote-task' }),
            jasmine.objectContaining({ id: 'remote-tag' }),
          ]),
        );

        // All local ops from conflicts get rejected in one batch
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith([
          'local-task',
          'local-project',
          'local-tag',
        ]);

        // Project: local wins - remote op rejected separately
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-project']);

        // SPAP-15: the mixed-result count notification is now the journal-driven
        // summary banner (win-count VALUES are covered by
        // sync-conflict-banner.service.spec).
        expect(bannerSpy).toHaveBeenCalled();
      });
    });

    describe('return value (localWinOpsCreated)', () => {
      // Helper to create a mock local-win update operation
      const createMockLocalWinOp = (entityId: string): Operation => ({
        id: `lww-update-${entityId}`,
        clientId: 'client-a',
        actionType: '[TASK] LWW Update' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId,
        payload: { title: 'Local Win State' },
        vectorClock: { clientA: 2, clientB: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      });

      it('should return { localWinOpsCreated: 0 } when no conflicts', async () => {
        const result = await service.autoResolveConflictsLWW([]);

        // Early-exit path: no validation runs.
        expect(result).toEqual({ localWinOpsCreated: 0 });
      });

      it('should return { localWinOpsCreated: 0 } when only non-conflicting ops', async () => {
        const now = Date.now();
        const nonConflicting = [
          createOpWithTimestamp('nc-1', 'client-b', now, OpType.Update, 'task-99'),
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: nonConflicting,
        });

        const result = await service.autoResolveConflictsLWW([], nonConflicting);

        expect(result).toEqual({ localWinOpsCreated: 0 });
      });

      it('should return { localWinOpsCreated: 0 } when remote wins all conflicts', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [createOpWithTimestamp('remote-1', 'client-b', now)],
          ),
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        const result = await service.autoResolveConflictsLWW(conflicts);

        expect(result).toEqual({ localWinOpsCreated: 0 });
      });

      it('should return { localWinOpsCreated: 1 } when local wins one conflict', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now)],
            [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
          ),
        ];

        // Spy on the private method to return a mock local-win op
        spyOn<any>(service, '_createLocalWinUpdateOp').and.returnValue(
          Promise.resolve(createMockLocalWinOp('task-1')),
        );

        const result = await service.autoResolveConflictsLWW(conflicts);

        expect(result).toEqual({ localWinOpsCreated: 1 });
      });

      it('should return correct count when multiple local wins', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now)],
            [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
          ),
          createConflict(
            'task-2',
            [createOpWithTimestamp('local-2', 'client-a', now, OpType.Update, 'task-2')],
            [
              createOpWithTimestamp(
                'remote-2',
                'client-b',
                now - 1000,
                OpType.Update,
                'task-2',
              ),
            ],
          ),
        ];

        // Spy on the private method to return mock local-win ops
        spyOn<any>(service, '_createLocalWinUpdateOp').and.callFake(
          (conflict: EntityConflict) =>
            Promise.resolve(createMockLocalWinOp(conflict.entityId)),
        );

        const result = await service.autoResolveConflictsLWW(conflicts);

        expect(result).toEqual({ localWinOpsCreated: 2 });
      });

      it('should return correct count for mixed local/remote wins', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          // Remote wins this one
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [createOpWithTimestamp('remote-1', 'client-b', now)],
          ),
          // Local wins this one
          createConflict(
            'task-2',
            [createOpWithTimestamp('local-2', 'client-a', now, OpType.Update, 'task-2')],
            [
              createOpWithTimestamp(
                'remote-2',
                'client-b',
                now - 1000,
                OpType.Update,
                'task-2',
              ),
            ],
          ),
          // Remote wins this one
          createConflict(
            'task-3',
            [
              createOpWithTimestamp(
                'local-3',
                'client-a',
                now - 500,
                OpType.Update,
                'task-3',
              ),
            ],
            [createOpWithTimestamp('remote-3', 'client-b', now, OpType.Update, 'task-3')],
          ),
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: [conflicts[0].remoteOps[0], conflicts[2].remoteOps[0]],
        });

        // Spy on the private method to return mock local-win op (only called for task-2)
        spyOn<any>(service, '_createLocalWinUpdateOp').and.callFake(
          (conflict: EntityConflict) =>
            Promise.resolve(createMockLocalWinOp(conflict.entityId)),
        );

        const result = await service.autoResolveConflictsLWW(conflicts);

        // Only 1 local win out of 3 conflicts
        expect(result).toEqual({ localWinOpsCreated: 1 });
      });

      it('should keep originals recoverable when applying a mixed resolution fails', async () => {
        const now = Date.now();
        const remoteWinner = createOpWithTimestamp('remote-winner', 'client-b', now);
        const remoteLoser = createOpWithTimestamp(
          'remote-loser',
          'client-b',
          now - 1000,
          OpType.Update,
          'task-2',
        );
        const localWinOp = createMockLocalWinOp('task-2');
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-loser', 'client-a', now - 1000)],
            [remoteWinner],
          ),
          createConflict(
            'task-2',
            [
              createOpWithTimestamp(
                'local-winner',
                'client-a',
                now,
                OpType.Update,
                'task-2',
              ),
            ],
            [remoteLoser],
          ),
        ];
        const callOrder: string[] = [];
        spyOn<any>(service, '_createLocalWinUpdateOp').and.resolveTo(localWinOp);
        mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(
          async (batches) => {
            callOrder.push('persist-mixed-resolution');
            return {
              written: batches.flatMap((batch) =>
                batch.ops.map((op, index) => ({
                  seq: index + 1,
                  op,
                  source: batch.source,
                })),
              ),
              skippedCount: 0,
            };
          },
        );
        mockOpLogStore.markRejected.and.callFake(async () => {
          callOrder.push('mark-rejected');
        });
        mockOperationApplier.applyOperations.and.callFake(async () => {
          callOrder.push('apply-remote');
          throw new Error('remote archive apply failed');
        });

        await expectAsync(
          service.autoResolveConflictsLWW(conflicts),
        ).toBeRejectedWithError('remote archive apply failed');

        expect(callOrder).toEqual(['persist-mixed-resolution', 'apply-remote']);
      });

      it('atomically persists a final remote winner after an older loser and its compensation', async () => {
        const localOp = createOpWithTimestamp(
          'local-op',
          'client-a',
          2000,
          OpType.Update,
          'task-1',
        );
        const remoteLoser = createOpWithTimestamp(
          'remote-loser',
          'client-b',
          1000,
          OpType.Update,
          'task-1',
        );
        const remoteWinner = createOpWithTimestamp(
          'remote-winner',
          'client-b',
          3000,
          OpType.Update,
          'task-1',
        );
        mockStore.select.and.returnValue(of({ id: 'task-1', title: 'Local state' }));

        await service.autoResolveConflictsLWW([
          createConflict('task-1', [localOp], [remoteLoser]),
          createConflict('task-1', [localOp], [remoteWinner]),
        ]);

        expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).toHaveBeenCalledTimes(
          1,
        );
        const persistedBatches =
          mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls.mostRecent().args[0];
        expect(persistedBatches.map((batch) => batch.source)).toEqual([
          'remote',
          'local',
          'remote',
        ]);
        expect(persistedBatches[0].ops.map((op) => op.id)).toEqual(['remote-loser']);
        expect(persistedBatches[1].ops.length).toBe(1);
        expect(persistedBatches[1].ops[0].entityId).toBe('task-1');
        expect(persistedBatches[2].ops.map((op) => op.id)).toEqual(['remote-winner']);
        expect(persistedBatches[2].options).toEqual({ pendingApply: true });
        expect(
          mockOpLogStore.appendBatchSkipDuplicates.calls
            .allArgs()
            .flatMap(([ops]) => ops)
            .some((op) => op.id === remoteWinner.id),
        ).toBeFalse();
      });

      it('replays skipped mixed rows in durable sequence order', async () => {
        const remoteMultiOp: Operation = {
          ...createOpWithTimestamp('remote-multi', 'client-b', 2_000),
          actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
          opType: OpType.Delete,
          entityId: 'task-1',
          entityIds: ['task-1', 'task-2'],
          payload: { taskIds: ['task-1', 'task-2'] },
        };
        const finalRemoteWinner = createOpWithTimestamp(
          'remote-final',
          'client-b',
          4_000,
          OpType.Update,
          'task-3',
        );
        const durableRemoteMulti = {
          ...remoteMultiOp,
          payload: { persisted: 'multi' },
        };
        const durableFinalRemoteWinner = {
          ...finalRemoteWinner,
          payload: { persisted: 'winner' },
        };
        const conflicts = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-task-1', 'client-a', 1_000)],
            [remoteMultiOp],
          ),
          createConflict(
            'task-2',
            [
              createOpWithTimestamp(
                'local-task-2',
                'client-a',
                3_000,
                OpType.Update,
                'task-2',
              ),
            ],
            [remoteMultiOp],
          ),
          createConflict(
            'task-3',
            [
              createOpWithTimestamp(
                'local-task-3',
                'client-a',
                1_000,
                OpType.Update,
                'task-3',
              ),
            ],
            [finalRemoteWinner],
          ),
        ];
        mockStore.select.and.returnValue(
          of({ id: 'task-2', title: 'Local winning task' }),
        );
        mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(
          async (batches) => ({
            written: batches
              .filter((batch) => batch.source === 'local')
              .flatMap((batch) =>
                batch.ops.map((op) => ({ seq: 50, op, source: 'local' as const })),
              ),
            skippedCount: batches
              .filter((batch) => batch.source === 'remote')
              .reduce((count, batch) => count + batch.ops.length, 0),
          }),
        );
        mockOpLogStore.getOpById.and.callFake(async (id) => {
          if (id === remoteMultiOp.id) {
            return {
              seq: 41,
              op: durableRemoteMulti,
              appliedAt: 1,
              source: 'remote',
              applicationStatus: 'pending',
            };
          }
          if (id === finalRemoteWinner.id) {
            return {
              seq: 42,
              op: durableFinalRemoteWinner,
              appliedAt: 1,
              source: 'remote',
              applicationStatus: 'pending',
            };
          }
          return undefined;
        });
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        await service.autoResolveConflictsLWW(conflicts);

        const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
          .args[0] as Operation[];
        expect(appliedOps[0]).toBe(durableRemoteMulti);
        expect(appliedOps[1]).toBe(durableFinalRemoteWinner);
        expect(appliedOps[2].actionType).toBe('[TASK] LWW Update');
        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [41, 42],
          [durableRemoteMulti, durableFinalRemoteWinner],
        );
      });

      it('applies a reused pending non-conflicting row before fresh higher-seq rows (#8990)', async () => {
        // A prior failed attempt left 'reused-create' durable as pending at
        // seq 40. This attempt appends a fresh remote winner at seq 60.
        // Status-blind hydration replays by seq, so live apply must run the
        // reused row FIRST even though STEP 3 queues it after the resolution
        // rows.
        const localLoser = createOpWithTimestamp('local-loser', 'client-a', 1_000);
        const remoteWinner = createOpWithTimestamp(
          'remote-winner',
          'client-b',
          2_000,
          OpType.Update,
          'task-1',
        );
        const reusedCreate = createOpWithTimestamp(
          'reused-create',
          'client-b',
          500,
          OpType.Create,
          'task-9',
        );
        mockOpLogStore.appendBatchSkipDuplicates.and.callFake(
          async (ops: Operation[]) => {
            const writtenOps = ops.filter((op) => op.id !== reusedCreate.id);
            return {
              seqs: writtenOps.map((_, i) => 60 + i),
              writtenOps,
              skippedCount: ops.length - writtenOps.length,
            };
          },
        );
        mockOpLogStore.getOpById.and.callFake(async (id) =>
          id === reusedCreate.id
            ? {
                seq: 40,
                op: reusedCreate,
                appliedAt: 1,
                source: 'remote',
                applicationStatus: 'pending',
              }
            : undefined,
        );
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        await service.autoResolveConflictsLWW(
          [createConflict('task-1', [localLoser], [remoteWinner])],
          [reusedCreate],
        );

        const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
          .args[0] as Operation[];
        expect(appliedOps.map(({ id }) => id)).toEqual([
          reusedCreate.id,
          remoteWinner.id,
        ]);
      });

      it('should not reject or apply remote rows when local-win compensation cannot persist', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-winner', 'client-a', now)],
            [createOpWithTimestamp('remote-loser', 'client-b', now - 1000)],
          ),
        ];
        const persistenceError = new Error('compensation persistence failed');
        spyOn<any>(service, '_createLocalWinUpdateOp').and.resolveTo(
          createMockLocalWinOp('task-1'),
        );
        mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.rejectWith(
          persistenceError,
        );

        await expectAsync(service.autoResolveConflictsLWW(conflicts)).toBeRejectedWith(
          persistenceError,
        );

        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
        expect(mockOperationApplier.applyOperations).not.toHaveBeenCalled();
        expect(mockOpLogStore.appendBatchSkipDuplicates).not.toHaveBeenCalled();
      });

      it('should return 0 when local wins but entity not found', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now)],
            [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
          ),
        ];

        // Spy on the private method to return undefined (entity not found)
        spyOn<any>(service, '_createLocalWinUpdateOp').and.returnValue(
          Promise.resolve(undefined),
        );

        const result = await service.autoResolveConflictsLWW(conflicts);

        // No op created because entity not found
        expect(result).toEqual({ localWinOpsCreated: 0 });
      });
    });

    describe('vector clock update', () => {
      it('should atomically append remote losers before local-win compensation', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now)],
            [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
          ),
        ];

        // Mock the private method to return a local-win op
        const mockLocalWinOp: Operation = {
          id: 'lww-update-task-1',
          clientId: 'client-a',
          actionType: '[TASK] LWW Update' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Local Win State' },
          vectorClock: { clientA: 2, clientB: 1 },
          timestamp: now,
          schemaVersion: 1,
        };
        spyOn<any>(service, '_createLocalWinUpdateOp').and.returnValue(
          Promise.resolve(mockLocalWinOp),
        );

        await service.autoResolveConflictsLWW(conflicts);

        const batches =
          mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls.mostRecent().args[0];
        expect(batches.map((batch) => batch.source)).toEqual(['remote', 'local']);
        expect(batches[1].ops).toEqual([
          jasmine.objectContaining({
            id: 'lww-update-task-1',
            actionType: '[TASK] LWW Update' as ActionType,
          }),
        ]);
      });

      it('should create a dominating GLOBAL_CONFIG:tasks compensation for a migrated local row', async () => {
        const migratedLocalOp: Operation = {
          id: 'legacy-local-config_tasks',
          actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
          opType: OpType.Update,
          entityType: 'GLOBAL_CONFIG',
          entityId: 'tasks',
          entityIds: ['tasks'],
          payload: {
            actionPayload: {
              sectionKey: 'tasks',
              sectionCfg: { isConfirmBeforeDelete: true },
            },
            entityChanges: [],
          },
          clientId: 'localClient',
          vectorClock: { localClient: 4 },
          timestamp: 2_000,
          schemaVersion: 2,
        };
        const currentRemoteOp: Operation = {
          id: 'remote-current-tasks',
          actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
          opType: OpType.Update,
          entityType: 'GLOBAL_CONFIG',
          entityId: 'tasks',
          entityIds: ['tasks'],
          payload: {
            actionPayload: {
              sectionKey: 'tasks',
              sectionCfg: { isConfirmBeforeDelete: false },
            },
            entityChanges: [],
          },
          clientId: 'remoteClient',
          vectorClock: { remoteClient: 3 },
          timestamp: 1_000,
          schemaVersion: 2,
        };
        mockClientIdProvider.loadClientId.and.resolveTo('localClient');
        mockStore.select.and.returnValue(
          of({
            misc: { unrelatedMiscSetting: 'keep-me' },
            tasks: { isConfirmBeforeDelete: true },
          }),
        );

        const result = await service.autoResolveConflictsLWW([
          {
            entityType: 'GLOBAL_CONFIG',
            entityId: 'tasks',
            localOps: [migratedLocalOp],
            remoteOps: [currentRemoteOp],
            suggestedResolution: 'manual',
          },
        ]);

        const compensation = getFirstMixedLocalOp();
        expect(result.localWinOpsCreated).toBe(1);
        expect(getMixedRemoteOps()).toEqual([currentRemoteOp]);
        expect(compensation).toEqual(
          jasmine.objectContaining({
            actionType: '[GLOBAL_CONFIG] LWW Update' as ActionType,
            entityType: 'GLOBAL_CONFIG',
            entityId: 'tasks',
            vectorClock: { localClient: 5, remoteClient: 3 },
          }),
        );
        expect(
          compareVectorClocks(compensation.vectorClock, migratedLocalOp.vectorClock),
        ).toBe(VectorClockComparison.GREATER_THAN);
        expect(
          compareVectorClocks(compensation.vectorClock, currentRemoteOp.vectorClock),
        ).toBe(VectorClockComparison.GREATER_THAN);
      });

      it('should merge remote-winner clocks before apply and checkpoint them with reducer status', async () => {
        // REGRESSION TEST: Bug where remote ops applied via conflict resolution
        // didn't have their clocks merged into the local clock store.
        // Without clock merge, subsequent local ops would have clocks that are
        // CONCURRENT with the applied remote ops instead of GREATER_THAN.
        const now = Date.now();
        const remoteOp = createOpWithTimestamp('remote-1', 'client-b', now);
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [remoteOp],
          ),
        ];

        mockOpLogStore.hasOp.and.resolveTo(false);
        mockOpLogStore.append.and.resolveTo(1);
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: [remoteOp] };
        });
        mockOpLogStore.markApplied.and.resolveTo(undefined);
        mockOpLogStore.markRejected.and.resolveTo(undefined);

        await service.autoResolveConflictsLWW(conflicts);

        expect(mockOpLogStore.mergeRemoteOpClocks).toHaveBeenCalledWith([remoteOp]);
        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [1],
          [remoteOp],
        );
      });

      it('should keep original operations recoverable when a remote winner reducer fails', async () => {
        const now = Date.now();
        const remoteOp = createOpWithTimestamp('remote-1', 'client-b', now);
        const reducerError = new Error('Reducer failed');
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [remoteOp],
          ),
        ];

        mockOpLogStore.hasOp.and.resolveTo(false);
        mockOpLogStore.append.and.resolveTo(1);
        mockOperationApplier.applyOperations.and.callFake(async (_ops, options) => {
          const reducerFailures = [{ op: remoteOp, error: reducerError }];
          await options?.onReducersCommitted?.([], reducerFailures);
          return { appliedOps: [], reducerFailures };
        });

        await expectAsync(
          service.autoResolveConflictsLWW(conflicts),
        ).toBeRejectedWithError(IncompleteRemoteOperationsError);

        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
        expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
        expect(mockOpLogStore.markFailed).not.toHaveBeenCalled();
      });

      it('should retry an existing pending remote winner after its reducer recovers', async () => {
        const now = Date.now();
        const localOp = createOpWithTimestamp('local-1', 'client-a', now - 1000);
        const remoteOp = createOpWithTimestamp('remote-1', 'client-b', now);
        const redeliveredRemoteOp = {
          ...remoteOp,
          payload: { changedAfterPersistence: true },
          vectorClock: { clientB: 99 },
        };
        const reducerError = new Error('Reducer failed');
        const conflicts: EntityConflict[] = [
          createConflict('task-1', [localOp], [remoteOp]),
        ];
        const retryConflicts: EntityConflict[] = [
          createConflict('task-1', [localOp], [redeliveredRemoteOp]),
        ];
        let appendAttempt = 0;
        mockOpLogStore.appendBatchSkipDuplicates.and.callFake(async () => {
          appendAttempt++;
          return appendAttempt === 1
            ? { seqs: [7], writtenOps: [remoteOp], skippedCount: 0 }
            : { seqs: [], writtenOps: [], skippedCount: 1 };
        });
        mockOpLogStore.getOpById.and.resolveTo({
          seq: 7,
          op: remoteOp,
          appliedAt: now,
          source: 'remote',
          applicationStatus: 'pending',
        });
        let applyAttempt = 0;
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          applyAttempt++;
          if (applyAttempt === 1) {
            const reducerFailures = [{ op: remoteOp, error: reducerError }];
            await options?.onReducersCommitted?.([], reducerFailures);
            return { appliedOps: [], reducerFailures };
          }
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        await expectAsync(
          service.autoResolveConflictsLWW(conflicts),
        ).toBeRejectedWithError(IncompleteRemoteOperationsError);
        const retryResult = await service.autoResolveConflictsLWW(retryConflicts);

        expect(retryResult).toEqual({ localWinOpsCreated: 0 });
        expect(mockOperationApplier.applyOperations).toHaveBeenCalledTimes(2);
        expect(mockOperationApplier.applyOperations.calls.argsFor(1)[0]).toEqual([
          remoteOp,
        ]);
        expect(mockOpLogStore.markApplied).toHaveBeenCalledWith([7]);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith([localOp.id]);
      });

      it('should fall back to LWW when a synthetic merge reducer fails', async () => {
        const now = Date.now();
        const localOp = createOpWithTimestamp('local-1', 'client-a', now - 1000);
        const remoteOp = createOpWithTimestamp('remote-1', 'client-b', now);
        const mergedOp = createOpWithTimestamp('merged-1', TEST_CLIENT_ID, now + 1);
        const conflict = createConflict('task-1', [localOp], [remoteOp]);
        const serviceInternals = service as unknown as {
          _journalMergedResolution: () => Promise<unknown>;
          _journalResolution: () => Promise<unknown>;
          _resolveConflictsWithLWW: (
            conflicts: EntityConflict[],
            disableDisjointMerge?: boolean,
          ) => Promise<unknown>;
        };
        spyOn(serviceInternals, '_journalMergedResolution').and.resolveTo();
        spyOn(serviceInternals, '_journalResolution').and.resolveTo();
        spyOn(serviceInternals, '_resolveConflictsWithLWW').and.callFake(
          async (_conflicts, disableDisjointMerge = false) =>
            disableDisjointMerge
              ? {
                  lwwResolutions: [{ conflict, winner: 'remote' }],
                  mergedResolutions: [],
                  lwwPlans: [{ conflict }],
                }
              : {
                  lwwResolutions: [],
                  mergedResolutions: [
                    {
                      conflict,
                      mergedOp,
                      plan: { conflict },
                    },
                  ],
                  lwwPlans: [],
                },
        );
        mockOpLogStore.appendBatchSkipDuplicates.and.resolveTo({
          seqs: [],
          writtenOps: [],
          skippedCount: 1,
        });
        mockOpLogStore.getOpById.and.resolveTo({
          seq: 7,
          op: remoteOp,
          appliedAt: now,
          source: 'remote',
          applicationStatus: 'pending',
        });
        let applyAttempt = 0;
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          applyAttempt++;
          if (applyAttempt === 1) {
            const reducerFailures = [
              { op: mergedOp, error: new Error('synthetic reducer failed') },
            ];
            await options?.onReducersCommitted?.([], reducerFailures);
            return { appliedOps: [], reducerFailures };
          }
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });

        const result = await service.autoResolveConflictsLWW([conflict]);

        expect(result).toEqual({ localWinOpsCreated: 0 });
        const mergeRemoteBatch =
          mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls.argsFor(0)[0][0];
        expect(mergeRemoteBatch).toEqual(
          jasmine.objectContaining({
            source: 'remote',
            options: { pendingApply: true },
          }),
        );
        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [],
          [],
          [mergedOp.id],
        );
        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [7],
          [remoteOp],
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith([localOp.id]);
        expect(serviceInternals._journalMergedResolution).not.toHaveBeenCalled();
        expect(serviceInternals._journalResolution).toHaveBeenCalled();
      });

      it('should keep deferred user actions outside a failed merge fallback rejection', async () => {
        const now = Date.now();
        const localOp = createOpWithTimestamp('local-1', 'client-a', now - 1000);
        const remoteOp = createOpWithTimestamp('remote-1', 'client-b', now);
        const mergedOp = createOpWithTimestamp('merged-1', TEST_CLIENT_ID, now + 1);
        const deferredOp = createOpWithTimestamp(
          'deferred-user-op',
          TEST_CLIENT_ID,
          now + 2,
        );
        const conflict = createConflict('task-1', [localOp], [remoteOp]);
        const serviceInternals = service as unknown as {
          _journalMergedResolution: () => Promise<unknown>;
          _journalResolution: () => Promise<unknown>;
          _resolveConflictsWithLWW: (
            conflicts: EntityConflict[],
            disableDisjointMerge?: boolean,
          ) => Promise<unknown>;
        };
        spyOn(serviceInternals, '_journalMergedResolution').and.resolveTo();
        spyOn(serviceInternals, '_journalResolution').and.resolveTo();
        spyOn(serviceInternals, '_resolveConflictsWithLWW').and.callFake(
          async (_conflicts, disableDisjointMerge = false) =>
            disableDisjointMerge
              ? {
                  lwwResolutions: [{ conflict, winner: 'remote' }],
                  mergedResolutions: [],
                  lwwPlans: [{ conflict }],
                }
              : {
                  lwwResolutions: [],
                  mergedResolutions: [{ conflict, mergedOp, plan: { conflict } }],
                  lwwPlans: [],
                },
        );
        mockOpLogStore.appendBatchSkipDuplicates.and.resolveTo({
          seqs: [],
          writtenOps: [],
          skippedCount: 1,
        });
        mockOpLogStore.getOpById.and.resolveTo({
          seq: 7,
          op: remoteOp,
          appliedAt: now,
          source: 'remote',
          applicationStatus: 'pending',
        });
        const callOrder: string[] = [];
        let deferredWasPersisted = false;
        let applyAttempt = 0;
        mockHydrationStateService.startApplyingRemoteOps.and.callFake(() => {
          callOrder.push('window-start');
        });
        mockHydrationStateService.startPostSyncCooldown.and.callFake(() => {
          callOrder.push('cooldown-start');
        });
        mockHydrationStateService.endApplyingRemoteOps.and.callFake(() => {
          callOrder.push('window-end');
        });
        mockOpLogStore.getUnsyncedByEntity.and.callFake(async () =>
          deferredWasPersisted ? new Map([['TASK:task-1', [deferredOp]]]) : new Map(),
        );
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          applyAttempt++;
          callOrder.push(`apply-${applyAttempt}`);
          if (applyAttempt === 1) {
            const reducerFailures = [
              { op: mergedOp, error: new Error('synthetic reducer failed') },
            ];
            await options?.onReducersCommitted?.([], reducerFailures);
            return { appliedOps: [], reducerFailures };
          }
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: ops };
        });
        mockOperationLogEffects.processDeferredActions.and.callFake(async () => {
          callOrder.push('process-deferred');
          deferredWasPersisted = true;
        });

        await service.autoResolveConflictsLWW([conflict]);

        const rejectedIds = mockOpLogStore.markRejected.calls
          .allArgs()
          .flatMap(([ids]) => ids);
        expect(rejectedIds).not.toContain(deferredOp.id);
        expect(callOrder).toEqual([
          'window-start',
          'apply-1',
          'apply-2',
          'cooldown-start',
          'window-end',
          'process-deferred',
        ]);
        expect(mockHydrationStateService.startApplyingRemoteOps).toHaveBeenCalledTimes(1);
        expect(mockHydrationStateService.endApplyingRemoteOps).toHaveBeenCalledTimes(1);
      });

      it('should process deferred actions after merging remote clocks when caller holds lock', async () => {
        const now = Date.now();
        const remoteOp = createOpWithTimestamp('remote-1', 'client-b', now);
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [remoteOp],
          ),
        ];
        const callOrder: string[] = [];

        mockOpLogStore.hasOp.and.resolveTo(false);
        mockOpLogStore.mergeRemoteOpClocks.and.callFake(async () => {
          callOrder.push('mergeRemoteOpClocks');
        });
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          callOrder.push('applyOperations');
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: [remoteOp] };
        });
        mockOpLogStore.markReducersCommittedAndMergeClocks.and.callFake(async () => {
          callOrder.push('checkpointReducersAndClocks');
        });
        mockOpLogStore.markApplied.and.callFake(async () => {
          callOrder.push('markApplied');
        });
        mockOpLogStore.markRejected.and.resolveTo(undefined);
        mockOperationLogEffects.processDeferredActions.and.callFake(async () => {
          callOrder.push('processDeferredActions');
        });

        await service.autoResolveConflictsLWW(conflicts, [], {
          callerHoldsOperationLogLock: true,
        });

        expect(mockOperationApplier.applyOperations).toHaveBeenCalledWith(
          [remoteOp],
          jasmine.objectContaining({
            skipDeferredLocalActions: true,
            onReducersCommitted: jasmine.any(Function),
          }),
        );
        expect(mockOperationLogEffects.processDeferredActions).toHaveBeenCalledWith({
          callerHoldsOperationLogLock: true,
        });
        expect(callOrder).toEqual([
          'mergeRemoteOpClocks',
          'applyOperations',
          'checkpointReducersAndClocks',
          'markApplied',
          'processDeferredActions',
        ]);
      });

      it('should checkpoint clocks for non-conflicting ops piggybacked through conflict resolution', async () => {
        const now = Date.now();
        const conflictRemoteOp = createOpWithTimestamp('remote-1', 'client-b', now);
        const nonConflictingOp = createOpWithTimestamp(
          'nc-1',
          'client-c',
          now,
          OpType.Update,
          'other-task',
        );
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [conflictRemoteOp],
          ),
        ];

        mockOpLogStore.hasOp.and.resolveTo(false);
        mockOpLogStore.append.and.resolveTo(1);
        mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
          await options?.onReducersCommitted?.(ops);
          return { appliedOps: [conflictRemoteOp, nonConflictingOp] };
        });
        mockOpLogStore.markApplied.and.resolveTo(undefined);
        mockOpLogStore.markRejected.and.resolveTo(undefined);

        await service.autoResolveConflictsLWW(conflicts, [nonConflictingOp]);

        // Both conflict-winning remote ops AND non-conflicting ops should be merged
        expect(mockOpLogStore.mergeRemoteOpClocks).toHaveBeenCalledWith([
          conflictRemoteOp,
          nonConflictingOp,
        ]);
        expect(mockOpLogStore.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
          [1, 1],
          [conflictRemoteOp, nonConflictingOp],
        );
      });
    });

    // =========================================================================
    // Issue #6343: Atomic duplicate skipping (replaces issue #6213 retry logic)
    // =========================================================================
    describe('atomic duplicate skipping (issue #6343)', () => {
      it('should skip duplicates silently during conflict resolution', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [createOpWithTimestamp('remote-1', 'client-b', now)],
          ),
        ];

        // Simulate: remote op already exists (skipped as duplicate)
        mockOpLogStore.appendBatchSkipDuplicates.and.returnValue(
          Promise.resolve({ seqs: [], writtenOps: [], skippedCount: 1 }),
        );
        mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

        // Should complete successfully - no retry needed
        await service.autoResolveConflictsLWW(conflicts);

        // Should call appendBatchSkipDuplicates exactly once per batch (no retry)
        expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalled();
      });

      it('should propagate non-duplicate errors', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [createOpWithTimestamp('remote-1', 'client-b', now)],
          ),
        ];

        mockOpLogStore.appendBatchSkipDuplicates.and.rejectWith(
          new Error('Some other database error'),
        );

        await expectAsync(
          service.autoResolveConflictsLWW(conflicts),
        ).toBeRejectedWithError(/Some other database error/);
      });
    });
  });

  describe('_deepEqual', () => {
    // Access private method for testing
    const deepEqual = (a: unknown, b: unknown): boolean =>
      (service as any)._deepEqual(a, b);

    it('should return true for identical primitives', () => {
      expect(deepEqual(1, 1)).toBe(true);
      expect(deepEqual('hello', 'hello')).toBe(true);
      expect(deepEqual(true, true)).toBe(true);
      expect(deepEqual(null, null)).toBe(true);
    });

    it('should return false for different primitives', () => {
      expect(deepEqual(1, 2)).toBe(false);
      expect(deepEqual('hello', 'world')).toBe(false);
      expect(deepEqual(true, false)).toBe(false);
    });

    it('should return true for identical objects', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(
        deepEqual({ nested: { value: 'test' } }, { nested: { value: 'test' } }),
      ).toBe(true);
    });

    it('should return true for identical arrays', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(deepEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
    });

    describe('circular reference protection', () => {
      it('should return false for objects with circular references', () => {
        const warnSpy = spyOn(console, 'warn');
        const obj1: Record<string, unknown> = { a: 1 };
        obj1['self'] = obj1; // Create circular reference

        const obj2: Record<string, unknown> = { a: 1 };
        obj2['self'] = obj2; // Create circular reference

        const result = deepEqual(obj1, obj2);

        expect(result).toBe(false);
        expect(warnSpy).toHaveBeenCalled();
        const warnCalls = warnSpy.calls.allArgs();
        // OpLog.warn calls console.warn with prefix '[ol]' as first arg, message as second
        const hasCircularWarning = warnCalls.some((args) =>
          args.some(
            (arg) => typeof arg === 'string' && arg.includes('circular reference'),
          ),
        );
        expect(hasCircularWarning).toBe(true);
      });

      it('should return false for arrays with circular references', () => {
        const warnSpy = spyOn(console, 'warn');
        const arr1: unknown[] = [1, 2];
        arr1.push(arr1); // Create circular reference

        const arr2: unknown[] = [1, 2];
        arr2.push(arr2); // Create circular reference

        const result = deepEqual(arr1, arr2);

        expect(result).toBe(false);
        expect(warnSpy).toHaveBeenCalled();
      });
    });

    describe('depth limit protection', () => {
      it('should return false for deeply nested objects exceeding max depth', () => {
        const warnSpy = spyOn(console, 'warn');

        // Create object with depth > 50
        let obj1: Record<string, unknown> = { value: 'deep' };
        let obj2: Record<string, unknown> = { value: 'deep' };
        for (let i = 0; i < 60; i++) {
          obj1 = { nested: obj1 };
          obj2 = { nested: obj2 };
        }

        const result = deepEqual(obj1, obj2);

        expect(result).toBe(false);
        expect(warnSpy).toHaveBeenCalled();
        const warnCalls = warnSpy.calls.allArgs();
        // OpLog.warn calls console.warn with prefix '[ol]' as first arg, message as second
        const hasDepthWarning = warnCalls.some((args) =>
          args.some(
            (arg) => typeof arg === 'string' && arg.includes('exceeded max depth'),
          ),
        );
        expect(hasDepthWarning).toBe(true);
      });
    });
  });

  describe('_suggestResolution', () => {
    // Access private method for testing
    const callSuggestResolution = (
      localOps: Operation[],
      remoteOps: Operation[],
    ): 'local' | 'remote' | 'manual' => {
      return (service as any)._suggestResolution(localOps, remoteOps);
    };

    const createOp = (partial: Partial<Operation>): Operation => ({
      id: 'op-1',
      actionType: '[Test] Action' as ActionType,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'entity-1',
      payload: {},
      clientId: 'client-1',
      vectorClock: { client1: 1 },
      timestamp: Date.now(),
      schemaVersion: 1,
      ...partial,
    });

    it('should suggest remote when local ops are empty', () => {
      const remoteOps = [createOp({ id: 'remote-1' })];
      expect(callSuggestResolution([], remoteOps)).toBe('remote');
    });

    it('should suggest local when remote ops are empty', () => {
      const localOps = [createOp({ id: 'local-1' })];
      expect(callSuggestResolution(localOps, [])).toBe('local');
    });

    it('should suggest newer side when timestamps differ by more than 1 hour', () => {
      const now = Date.now();
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const twoHoursAgo = now - TWO_HOURS_MS;

      const localOps = [createOp({ id: 'local-1', timestamp: now })];
      const remoteOps = [createOp({ id: 'remote-1', timestamp: twoHoursAgo })];

      // Local is newer
      expect(callSuggestResolution(localOps, remoteOps)).toBe('local');

      // Flip: remote is newer
      const localOpsOld = [createOp({ id: 'local-1', timestamp: twoHoursAgo })];
      const remoteOpsNew = [createOp({ id: 'remote-1', timestamp: now })];
      expect(callSuggestResolution(localOpsOld, remoteOpsNew)).toBe('remote');
    });

    it('should prefer update over delete (local delete, remote update)', () => {
      const now = Date.now();
      const localOps = [
        createOp({ id: 'local-1', opType: OpType.Delete, timestamp: now }),
      ];
      const remoteOps = [
        createOp({ id: 'remote-1', opType: OpType.Update, timestamp: now }),
      ];

      expect(callSuggestResolution(localOps, remoteOps)).toBe('remote');
    });

    it('should prefer update over delete (remote delete, local update)', () => {
      const now = Date.now();
      const localOps = [
        createOp({ id: 'local-1', opType: OpType.Update, timestamp: now }),
      ];
      const remoteOps = [
        createOp({ id: 'remote-1', opType: OpType.Delete, timestamp: now }),
      ];

      expect(callSuggestResolution(localOps, remoteOps)).toBe('local');
    });

    it('should prefer create over update', () => {
      const now = Date.now();
      const localOps = [
        createOp({ id: 'local-1', opType: OpType.Create, timestamp: now }),
      ];
      const remoteOps = [
        createOp({ id: 'remote-1', opType: OpType.Update, timestamp: now }),
      ];

      expect(callSuggestResolution(localOps, remoteOps)).toBe('local');

      // Flip
      const localOps2 = [
        createOp({ id: 'local-1', opType: OpType.Update, timestamp: now }),
      ];
      const remoteOps2 = [
        createOp({ id: 'remote-1', opType: OpType.Create, timestamp: now }),
      ];
      expect(callSuggestResolution(localOps2, remoteOps2)).toBe('remote');
    });

    it('should return manual for close timestamps with same op types', () => {
      const now = Date.now();
      const FIVE_MINUTES_MS = 5 * 60 * 1000;
      const fiveMinutesAgo = now - FIVE_MINUTES_MS;

      const localOps = [
        createOp({ id: 'local-1', opType: OpType.Update, timestamp: now }),
      ];
      const remoteOps = [
        createOp({ id: 'remote-1', opType: OpType.Update, timestamp: fiveMinutesAgo }),
      ];

      expect(callSuggestResolution(localOps, remoteOps)).toBe('manual');
    });

    it('should auto-resolve when both have delete ops (outcome is identical)', () => {
      const now = Date.now();
      const localOps = [
        createOp({ id: 'local-1', opType: OpType.Delete, timestamp: now }),
      ];
      const remoteOps = [
        createOp({ id: 'remote-1', opType: OpType.Delete, timestamp: now }),
      ];

      // Both want to delete - auto-resolve to local (could be either, outcome is same)
      expect(callSuggestResolution(localOps, remoteOps)).toBe('local');
    });
  });

  // =========================================================================
  // Clock skew edge cases
  // =========================================================================
  // These tests verify LWW conflict resolution handles edge cases where
  // clients have significant clock differences.

  describe('clock skew edge cases', () => {
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

    const createOpWithTimestamp = (
      id: string,
      clientId: string,
      timestamp: number,
      opType: OpType = OpType.Update,
      entityId: string = 'task-1',
    ): Operation => ({
      id,
      actionType: '[Task] Update Task' as ActionType,
      opType,
      entityType: 'TASK',
      entityId,
      payload: { source: clientId, timestamp },
      clientId,
      timestamp,
      vectorClock: { [clientId]: 1 },
      schemaVersion: 1,
    });

    it('should handle timestamps in far future (client clock ahead)', async () => {
      const now = Date.now();
      const futureTime = now + ONE_YEAR_MS; // 1 year in future

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
          remoteOps: [createOpWithTimestamp('remote-1', 'client-b', futureTime)],
          suggestedResolution: 'remote',
        },
      ];

      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.resolveTo(1);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: [conflicts[0].remoteOps[0]],
      });

      // Remote wins because its timestamp is newer (even if unrealistic)
      await service.autoResolveConflictsLWW(conflicts);

      expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-1' })]),
        'remote',
        jasmine.any(Object),
      );
    });

    it('should handle timestamps in far past (client clock behind)', async () => {
      const now = Date.now();
      const pastTime = now - ONE_YEAR_MS; // 1 year in past

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
          remoteOps: [createOpWithTimestamp('remote-1', 'client-b', pastTime)],
          suggestedResolution: 'local',
        },
      ];

      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.resolveTo(1);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

      // Local wins because its timestamp is newer
      await service.autoResolveConflictsLWW(conflicts);

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-1']);
    });

    it('should handle zero timestamps gracefully', async () => {
      const now = Date.now();

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
          remoteOps: [createOpWithTimestamp('remote-1', 'client-b', 0)],
          suggestedResolution: 'local',
        },
      ];

      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.resolveTo(1);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

      // Local wins (0 is earlier than now)
      await service.autoResolveConflictsLWW(conflicts);

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-1']);
    });

    it('should handle negative timestamps gracefully (system clock errors)', async () => {
      const now = Date.now();

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
          remoteOps: [createOpWithTimestamp('remote-1', 'client-b', -1000)],
          suggestedResolution: 'local',
        },
      ];

      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.resolveTo(1);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

      // Should not throw, local wins
      await service.autoResolveConflictsLWW(conflicts);

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-1']);
    });

    it('should use client ID as stable tie-breaker for identical timestamps', async () => {
      const now = Date.now();

      // Both have exactly the same timestamp
      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          // Remote's clientId (client-b) is lexicographically larger, so the
          // deterministic tiebreak makes remote win the exact-timestamp tie.
          localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
          remoteOps: [createOpWithTimestamp('remote-1', 'client-b', now)],
          suggestedResolution: 'remote', // Remote wins on tie
        },
      ];

      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.resolveTo(1);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: [conflicts[0].remoteOps[0]],
      });

      await service.autoResolveConflictsLWW(conflicts);

      // Remote should win on tie
      expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-1' })]),
        'remote',
        jasmine.any(Object),
      );
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1']);
    });

    it('should let local win the tie when its client ID is larger', async () => {
      const now = Date.now();

      // Same exact-millisecond tie, but now LOCAL's clientId (client-z) is the
      // larger, so the deterministic tiebreak flips the winner to local. This is
      // the direction the pre-existing tie tests never exercised (#9024): both
      // devices see the sides swapped yet pick the same physical client, so they
      // converge instead of each keeping the other's value.
      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOpWithTimestamp('local-1', 'client-z', now)],
          remoteOps: [createOpWithTimestamp('remote-1', 'client-a', now)],
          suggestedResolution: 'remote',
        },
      ];

      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.resolveTo(1);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

      await service.autoResolveConflictsLWW(conflicts);

      // Local wins the tie → the remote op is rejected (mirrors the local-win
      // timestamp cases in this block).
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-1']);
    });
  });

  // =========================================================================
  // Archive conflict resolution (Bug B prevention)
  // =========================================================================
  describe('archive conflict resolution', () => {
    const createOpWithTimestamp = (
      id: string,
      clientId: string,
      timestamp: number,
      opType: OpType = OpType.Update,
      entityId: string = 'task-1',
    ): Operation => ({
      id,
      clientId,
      actionType: 'test' as ActionType,
      opType,
      entityType: 'TASK',
      entityId,
      payload: { source: clientId, timestamp },
      vectorClock: { [clientId]: 1 },
      timestamp,
      schemaVersion: 1,
    });

    const createArchiveOp = (
      id: string,
      clientId: string,
      timestamp: number,
      entityId: string = 'task-1',
      entityIds: string[] = ['task-1'],
    ): Operation => ({
      id,
      clientId,
      actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId,
      entityIds,
      payload: {
        actionPayload: {
          tasks: entityIds.map((eid) => ({ id: eid, title: `Task ${eid}` })),
        },
        entityChanges: [],
      },
      vectorClock: { [clientId]: 1 },
      timestamp,
      schemaVersion: 1,
    });

    const createConflict = (
      entityId: string,
      localOps: Operation[],
      remoteOps: Operation[],
    ): EntityConflict => ({
      entityType: 'TASK',
      entityId,
      localOps,
      remoteOps,
      suggestedResolution: 'manual',
    });

    beforeEach(() => {
      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.callFake((op: Operation) => Promise.resolve(1));
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
    });

    it('should resolve remote moveToArchive as winner over local UPDATE (regardless of timestamps)', async () => {
      const now = Date.now();
      // Local UPDATE has NEWER timestamp, but remote archive should still win
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-upd', 'client-a', now)],
          [createArchiveOp('remote-archive', 'client-b', now - 5000)],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      // Remote archive should win — applied as remote op
      expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-archive' })]),
        'remote',
        jasmine.any(Object),
      );
      // Local ops should be rejected
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-upd']);
    });

    it('should resolve local moveToArchive as winner over remote UPDATE (regardless of timestamps)', async () => {
      const now = Date.now();
      // Remote UPDATE has NEWER timestamp, but local archive should still win
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createArchiveOp('local-archive', 'client-a', now - 5000)],
          [createOpWithTimestamp('remote-upd', 'client-b', now)],
        ),
      ];

      await service.autoResolveConflictsLWW(conflicts);

      // Local archive wins — remote op should be rejected
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-upd']);
      // Local archive op should be rejected (will be replaced by new archive op)
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-archive']);
      // New archive op should be appended
      expect(getMixedLocalOps()).toContain(
        jasmine.objectContaining({
          actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        }),
      );
    });

    it('should create replacement archive op with merged clock when local archive wins', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createArchiveOp('local-archive', 'client-a', now - 5000)],
          [createOpWithTimestamp('remote-upd', 'client-b', now)],
        ),
      ];

      await service.autoResolveConflictsLWW(conflicts);

      const appendedOp = getFirstMixedLocalOp();
      // Merged clock should include entries from both sides and be incremented
      expect(appendedOp.vectorClock['client-a']).toBeGreaterThanOrEqual(1);
      expect(appendedOp.vectorClock['client-b']).toBeGreaterThanOrEqual(1);
      expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeGreaterThanOrEqual(1);
    });

    it('should preserve original payload and entityIds in replacement archive op', async () => {
      const now = Date.now();
      const archiveOp = createArchiveOp('local-archive', 'client-a', now, 'task-1', [
        'task-1',
        'task-2',
        'task-3',
      ]);
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [archiveOp],
          [createOpWithTimestamp('remote-upd', 'client-b', now + 5000)],
        ),
      ];

      await service.autoResolveConflictsLWW(conflicts);

      const appendedOp = getFirstMixedLocalOp();
      expect(appendedOp.payload).toEqual(archiveOp.payload);
      expect(appendedOp.entityIds).toEqual(['task-1', 'task-2', 'task-3']);
      expect(appendedOp.entityId).toBe('task-1');
      expect(appendedOp.timestamp).toBe(now);
    });

    it('should still use normal LWW timestamp comparison for non-archive conflicts', async () => {
      const now = Date.now();
      // Normal UPDATE vs UPDATE conflict — no archive involved
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-upd', 'client-a', now)],
          [createOpWithTimestamp('remote-upd', 'client-b', now - 1000)],
        ),
      ];

      await service.autoResolveConflictsLWW(conflicts);

      // Local wins by timestamp — normal LWW behavior
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-upd']);
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-upd']);
    });

    it('should preserve the local winner operation footprint in its LWW op', async () => {
      const now = Date.now();
      const localOp = createOpWithTimestamp('local-upd', 'client-a', now);
      localOp.actionType = ActionType.TASK_SHARED_UPDATE;
      localOp.entityIds = ['task-1', 'subtask-1'];
      localOp.payload = {
        actionPayload: {
          task: { id: 'task-1', changes: { projectId: 'project-2' } },
          projectMoveSubTaskIds: ['subtask-1'],
        },
        entityChanges: [],
      };
      mockStore.select.and.returnValue(
        of({ id: 'task-1', title: 'Local winner', projectId: 'project-2' }),
      );

      const lwwOp = await (service as any)._createLocalWinUpdateOp(
        createConflict(
          'task-1',
          [localOp],
          [createOpWithTimestamp('remote-upd', 'client-b', now - 1000)],
        ),
      );

      expect(lwwOp.entityIds).toEqual(['task-1', 'subtask-1']);
    });

    it('should not create local-win op when clientId is unavailable', async () => {
      const now = Date.now();
      mockClientIdProvider.loadClientId.and.returnValue(Promise.resolve(null));

      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createArchiveOp('local-archive', 'client-a', now)],
          [createOpWithTimestamp('remote-upd', 'client-b', now + 5000)],
        ),
      ];

      const result = await service.autoResolveConflictsLWW(conflicts);

      // No local-win op should be created (clientId unavailable)
      expect(getMixedLocalOps()).toEqual([]);
      expect(result.localWinOpsCreated).toBe(0);
    });

    it('should handle local ops with both moveToArchive and regular update in same conflict', async () => {
      const now = Date.now();
      // Local side has a regular update AND a moveToArchive for the same entity
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [
            createOpWithTimestamp('local-upd', 'client-a', now - 10000),
            createArchiveOp('local-archive', 'client-a', now),
          ],
          [createOpWithTimestamp('remote-upd', 'client-b', now + 5000)],
        ),
      ];

      await service.autoResolveConflictsLWW(conflicts);

      // Archive should still win — both local ops rejected, archive re-created
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith([
        'local-upd',
        'local-archive',
      ]);
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-upd']);
      expect(getMixedLocalOps()).toContain(
        jasmine.objectContaining({
          actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        }),
      );
    });

    it('should use normal LWW for archive vs DELETE conflict (archive is not special against DELETE)', async () => {
      const now = Date.now();
      // Local archive, remote DELETE — archive special-casing only applies against
      // field-level UPDATEs, not DELETEs. DELETE conflicts use normal LWW.
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createArchiveOp('local-archive', 'client-a', now)],
          [
            {
              ...createOpWithTimestamp('remote-del', 'client-b', now - 1000),
              opType: OpType.Delete,
            },
          ],
        ),
      ];

      await service.autoResolveConflictsLWW(conflicts);

      // Archive should still win — it has moveToArchive, so archive-wins logic kicks in
      // regardless of remote op type
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-del']);
      expect(getMixedLocalOps()).toContain(
        jasmine.objectContaining({
          actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        }),
      );
    });

    it('should resolve as remote when both sides have moveToArchive', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createArchiveOp('local-archive', 'client-a', now)],
          [createArchiveOp('remote-archive', 'client-b', now - 1000)],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      // Remote archive wins (both have archive → remote preferred)
      expect(mockOpLogStore.appendBatchSkipDuplicates).toHaveBeenCalledWith(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-archive' })]),
        'remote',
        jasmine.any(Object),
      );
    });

    it('should prevent entity resurrection when multiple conflicts exist for same entity with local archive', async () => {
      const now = Date.now();
      // Two conflicts for the same entity (task-1):
      // - Conflict 1: local archive vs remote field update
      // - Conflict 2: local field update vs remote field update (no archive in THIS conflict)
      // Pre-scan detects that task-1 has a local archive across ALL conflicts.
      // Conflict 2 must NOT apply remote ops (which would resurrect the archived entity).
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createArchiveOp('local-archive', 'client-a', now)],
          [createOpWithTimestamp('remote-status-update', 'client-b', now + 5000)],
        ),
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-title-update', 'client-a', now - 1000)],
          [createOpWithTimestamp('remote-notes-update', 'client-b', now + 5000)],
        ),
      ];

      const result = await service.autoResolveConflictsLWW(conflicts);

      // Archive-win op should be created (from Conflict 1)
      expect(result.localWinOpsCreated).toBe(1);
      expect(getMixedLocalOps()).toContain(
        jasmine.objectContaining({
          actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        }),
      );

      // No remote ops should be applied to the store — both conflicts resolve
      // as local-wins, so allOpsToApply is empty and applyOperations is never called.
      // This prevents remote-notes-update from resurrecting the entity via addOne().
      expect(mockOperationApplier.applyOperations).not.toHaveBeenCalled();

      // Both sets of remote ops should be rejected (stored for history but not applied)
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(
        jasmine.arrayContaining(['remote-status-update', 'remote-notes-update']),
      );
    });
  });

  describe('no client-side vector clock pruning in conflict resolution', () => {
    const createOpWithLargeClock = (
      id: string,
      clientId: string,
      timestamp: number,
      vectorClock: VectorClock,
      entityId: string = 'task-1',
    ): Operation => ({
      id,
      clientId,
      actionType: 'test' as ActionType,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId,
      payload: { source: clientId },
      vectorClock,
      timestamp,
      schemaVersion: 1,
    });

    const createLargeClock = (
      prefix: string,
      count: number,
      valueStart: number = 1,
    ): VectorClock => {
      const clock: VectorClock = {};
      for (let i = 1; i <= count; i++) {
        clock[`${prefix}-${i}`] = valueStart + i - 1;
      }
      return clock;
    };

    beforeEach(() => {
      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.callFake((op: Operation) => Promise.resolve(1));
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
    });

    it('should NOT prune local-win update op clock (server handles pruning)', async () => {
      const now = Date.now();
      const localClock = createLargeClock('local', 16, 1);
      const remoteClock = createLargeClock('remote', 16, 10);

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOpWithLargeClock('local-1', 'client-a', now, localClock)],
          remoteOps: [
            createOpWithLargeClock('remote-1', 'client-b', now - 1000, remoteClock),
          ],
          suggestedResolution: 'manual',
        },
      ];

      mockStore.select.and.returnValue(of({ id: 'task-1', title: 'Test Task' }));

      await service.autoResolveConflictsLWW(conflicts);

      expect(getMixedLocalOps().length).toBeGreaterThan(0);
      const appendedOp = getFirstMixedLocalOp();
      // All keys preserved — no client-side pruning (server handles it)
      expect(Object.keys(appendedOp.vectorClock).length).toBeGreaterThan(
        MAX_VECTOR_CLOCK_SIZE,
      );
      expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
    });

    it('should NOT prune archive-win op clock (server handles pruning)', async () => {
      const now = Date.now();
      const archiveClock = createLargeClock('archive', 16, 1);
      const remoteClock = createLargeClock('remote', 16, 10);

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [
            {
              id: 'local-archive',
              clientId: 'client-a',
              actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
              opType: OpType.Update,
              entityType: 'TASK',
              entityId: 'task-1',
              entityIds: ['task-1'],
              payload: {
                actionPayload: { tasks: [{ id: 'task-1' }] },
                entityChanges: [],
              },
              vectorClock: archiveClock,
              timestamp: now,
              schemaVersion: 1,
            },
          ],
          remoteOps: [
            createOpWithLargeClock('remote-upd', 'client-b', now + 5000, remoteClock),
          ],
          suggestedResolution: 'manual',
        },
      ];

      await service.autoResolveConflictsLWW(conflicts);

      expect(getMixedLocalOps().length).toBeGreaterThan(0);
      const appendedOp = getFirstMixedLocalOp();
      // All keys preserved — no client-side pruning (server handles it)
      expect(Object.keys(appendedOp.vectorClock).length).toBeGreaterThan(
        MAX_VECTOR_CLOCK_SIZE,
      );
      expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
    });

    it('should preserve all client IDs in unpruned local-win op clock', async () => {
      const protectedId = 'protected-sync-import-client';

      const now = Date.now();
      const localClock: VectorClock = { [protectedId]: 1 };
      for (let i = 1; i <= 5; i++) {
        localClock[`high-local-${i}`] = i * 100;
      }
      const remoteClock = createLargeClock('remote', 5, 50);

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOpWithLargeClock('local-1', 'client-a', now, localClock)],
          remoteOps: [
            createOpWithLargeClock('remote-1', 'client-b', now - 1000, remoteClock),
          ],
          suggestedResolution: 'manual',
        },
      ];

      mockStore.select.and.returnValue(of({ id: 'task-1', title: 'Test Task' }));

      await service.autoResolveConflictsLWW(conflicts);

      const appendedOp = getFirstMixedLocalOp();
      // No client-side pruning — all keys preserved including protected client
      expect(appendedOp.vectorClock[protectedId]).toBeDefined();
      expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
    });
  });

  describe('archive-wins rule', () => {
    it('should resolve local moveToArchive winning over remote UPDATE with later timestamp', async () => {
      const localArchiveOp: Operation = {
        id: 'local-archive-1',
        clientId: TEST_CLIENT_ID,
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { task: { id: 'task-1', title: 'Archived Task' } },
        vectorClock: { [TEST_CLIENT_ID]: 1 },
        timestamp: 1000,
        schemaVersion: 1,
      };

      const remoteUpdateOp: Operation = {
        id: 'remote-update-1',
        clientId: 'remoteClient',
        actionType: 'test-update' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { source: 'remoteClient' },
        vectorClock: { remoteClient: 1 },
        timestamp: 2000, // Later timestamp — would win under normal LWW
        schemaVersion: 1,
      };

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [localArchiveOp],
          remoteOps: [remoteUpdateOp],
          suggestedResolution: 'manual',
        },
      ];

      mockStore.select.and.returnValue(of(undefined));

      const result = await service.autoResolveConflictsLWW(conflicts);

      // Local archive wins — a new op should be created
      expect(result.localWinOpsCreated).toBe(1);
      expect(getMixedLocalOps().length).toBeGreaterThan(0);
    });

    it('should resolve remote moveToArchive winning over local UPDATE with later timestamp', async () => {
      const localUpdateOp: Operation = {
        id: 'local-update-1',
        clientId: TEST_CLIENT_ID,
        actionType: 'test-update' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { source: TEST_CLIENT_ID },
        vectorClock: { [TEST_CLIENT_ID]: 1 },
        timestamp: 2000, // Later timestamp — would win under normal LWW
        schemaVersion: 1,
      };

      const remoteArchiveOp: Operation = {
        id: 'remote-archive-1',
        clientId: 'remoteClient',
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { task: { id: 'task-1', title: 'Archived Task' } },
        vectorClock: { remoteClient: 1 },
        timestamp: 1000,
        schemaVersion: 1,
      };

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [localUpdateOp],
          remoteOps: [remoteArchiveOp],
          suggestedResolution: 'manual',
        },
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: [remoteArchiveOp],
      });

      const result = await service.autoResolveConflictsLWW(conflicts);

      // Remote archive wins — no local-win op created
      expect(result.localWinOpsCreated).toBe(0);
      // Remote archive op should be applied
      expect(mockOperationApplier.applyOperations).toHaveBeenCalled();
      // Local op should be rejected
      expect(mockOpLogStore.markRejected).toHaveBeenCalled();
    });

    it('should resolve local moveToArchive winning over remote DELETE with later timestamp', async () => {
      const localArchiveOp: Operation = {
        id: 'local-archive-1',
        clientId: TEST_CLIENT_ID,
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { task: { id: 'task-1', title: 'Archived Task' } },
        vectorClock: { [TEST_CLIENT_ID]: 1 },
        timestamp: 1000,
        schemaVersion: 1,
      };

      const remoteDeleteOp: Operation = {
        id: 'remote-delete-1',
        clientId: 'remoteClient',
        actionType: 'test-delete' as ActionType,
        opType: OpType.Delete,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { source: 'remoteClient' },
        vectorClock: { remoteClient: 1 },
        timestamp: 2000, // Later timestamp — would win under normal LWW
        schemaVersion: 1,
      };

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [localArchiveOp],
          remoteOps: [remoteDeleteOp],
          suggestedResolution: 'manual',
        },
      ];

      mockStore.select.and.returnValue(of(undefined));

      const result = await service.autoResolveConflictsLWW(conflicts);

      // Local archive wins over remote DELETE
      expect(result.localWinOpsCreated).toBe(1);
      expect(getMixedLocalOps().length).toBeGreaterThan(0);
    });
  });

  describe('checkOpForConflicts', () => {
    const buildCtx = (overrides: {
      localPendingOpsByEntity?: Map<string, Operation[]>;
      appliedFrontierByEntity?: Map<string, VectorClock>;
      snapshotVectorClock?: VectorClock;
      snapshotEntityKeys?: Set<string>;
      hasNoSnapshotClock?: boolean;
    }): {
      localPendingOpsByEntity: Map<string, Operation[]>;
      appliedFrontierByEntity: Map<string, VectorClock>;
      snapshotVectorClock: VectorClock | undefined;
      snapshotEntityKeys: Set<string>;
      hasNoSnapshotClock: boolean;
    } => ({
      localPendingOpsByEntity: overrides.localPendingOpsByEntity ?? new Map(),
      appliedFrontierByEntity: overrides.appliedFrontierByEntity ?? new Map(),
      snapshotVectorClock: overrides.snapshotVectorClock,
      snapshotEntityKeys: overrides.snapshotEntityKeys ?? new Set(),
      hasNoSnapshotClock: overrides.hasNoSnapshotClock ?? true,
    });

    it('should mark CONCURRENT remote op as superseded when entity no longer in state', async () => {
      // Scenario: Client A archived a task (already synced), Client B sends a
      // concurrent update. Client A has no pending ops, but local frontier
      // shows CONCURRENT clocks. Entity is gone from NgRx store.
      const remoteOp: Operation = {
        ...createMockOp('remote-1', 'clientB'),
        entityId: 'task-1',
        vectorClock: { clientB: 1 },
      };

      // Local frontier has {clientA: 1} from an already-synced archive op,
      // producing CONCURRENT with remote's {clientB: 1}
      const appliedFrontierByEntity = new Map<string, VectorClock>();
      appliedFrontierByEntity.set('TASK:task-1', { clientA: 1 });

      // Entity no longer in state (archived/deleted)
      mockStore.select.and.returnValue(of(undefined));

      const result = await service.checkOpForConflicts(
        remoteOp,
        buildCtx({ appliedFrontierByEntity }),
      );

      expect(result.isSupersededOrDuplicate).toBe(true);
      expect(result.conflicts).toEqual([]);
    });

    it('should skip an atomic multi-entity operation when any entity is superseded', async () => {
      const remoteOp: Operation = {
        ...createMockOp('remote-multi-delete', 'clientB'),
        actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
        opType: OpType.Delete,
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
        payload: {
          actionPayload: { taskIds: ['task-1', 'task-2'] },
          entityChanges: [],
        },
        vectorClock: { clientB: 1 },
      };
      const appliedFrontierByEntity = new Map<string, VectorClock>([
        ['TASK:task-1', { clientA: 1 }],
        ['TASK:task-2', { clientA: 1 }],
      ]);
      const localPendingOpsByEntity = new Map<string, Operation[]>([
        [
          'TASK:task-2',
          [
            {
              ...createMockOp('local-task-2', 'clientA'),
              entityId: 'task-2',
              vectorClock: { clientA: 1 },
            },
          ],
        ],
      ]);
      mockStore.select.and.returnValue(of(undefined));

      const result = await service.checkOpForConflicts(
        remoteOp,
        buildCtx({ localPendingOpsByEntity, appliedFrontierByEntity }),
      );

      expect(result).toEqual({ isSupersededOrDuplicate: true, conflicts: [] });
    });

    it('should skip a multi-entity operation when every entity is superseded', async () => {
      const remoteOp: Operation = {
        ...createMockOp('remote-tag-order', 'clientB'),
        actionType: ActionType.TAG_UPDATE_ORDER,
        entityType: 'TAG',
        entityId: 'tag-1',
        entityIds: ['tag-1', 'tag-2'],
        payload: {
          actionPayload: { ids: ['tag-1', 'tag-2'] },
          entityChanges: [],
        },
        vectorClock: { clientA: 1, clientB: 1 },
      };
      const appliedFrontierByEntity = new Map<string, VectorClock>([
        ['TAG:tag-1', { clientA: 2, clientB: 1 }],
        ['TAG:tag-2', { clientA: 2, clientB: 1 }],
      ]);

      const result = await service.checkOpForConflicts(
        remoteOp,
        buildCtx({ appliedFrontierByEntity }),
      );

      expect(result.isSupersededOrDuplicate).toBe(true);
      expect(result.conflicts).toEqual([]);
    });

    it('should NOT mark CONCURRENT remote op as superseded when entity still in state', async () => {
      // Same CONCURRENT scenario, but entity still exists (no archive/delete)
      const remoteOp: Operation = {
        ...createMockOp('remote-1', 'clientB'),
        entityId: 'task-1',
        vectorClock: { clientB: 1 },
      };

      const appliedFrontierByEntity = new Map<string, VectorClock>();
      appliedFrontierByEntity.set('TASK:task-1', { clientA: 1 });

      // Entity still exists in state
      mockStore.select.and.returnValue(of({ id: 'task-1', title: 'Still here' }));

      const result = await service.checkOpForConflicts(
        remoteOp,
        buildCtx({ appliedFrontierByEntity }),
      );

      expect(result.isSupersededOrDuplicate).toBe(false);
      expect(result.conflicts).toEqual([]);
    });

    it('should mark CONCURRENT remote op as superseded when entity state is null', async () => {
      // Some selectors may return null instead of undefined for missing entities
      const remoteOp: Operation = {
        ...createMockOp('remote-1', 'clientB'),
        entityId: 'task-1',
        vectorClock: { clientB: 1 },
      };

      const appliedFrontierByEntity = new Map<string, VectorClock>();
      appliedFrontierByEntity.set('TASK:task-1', { clientA: 1 });

      mockStore.select.and.returnValue(of(null));

      const result = await service.checkOpForConflicts(
        remoteOp,
        buildCtx({ appliedFrontierByEntity }),
      );

      expect(result.isSupersededOrDuplicate).toBe(true);
      expect(result.conflicts).toEqual([]);
    });

    it('should NOT check entity state for LESS_THAN remote op with no pending ops', async () => {
      // LESS_THAN means remote is newer — should apply normally without entity check
      const remoteOp: Operation = {
        ...createMockOp('remote-1', 'clientA'),
        entityId: 'task-1',
        vectorClock: { clientA: 2 },
      };

      // Local frontier has {clientA: 1}, remote has {clientA: 2} = LESS_THAN
      const appliedFrontierByEntity = new Map<string, VectorClock>();
      appliedFrontierByEntity.set('TASK:task-1', { clientA: 1 });

      const result = await service.checkOpForConflicts(
        remoteOp,
        buildCtx({ appliedFrontierByEntity }),
      );

      expect(result.isSupersededOrDuplicate).toBe(false);
      expect(result.conflicts).toEqual([]);
      // Should NOT have called store.select for entity state check
      expect(mockStore.select).not.toHaveBeenCalled();
    });

    it('should report a conflict for every affected entity in a multi-entity op (#8956)', async () => {
      const remoteOp: Operation = {
        ...createMockOp('remote-multi', 'clientB'),
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
        vectorClock: { clientB: 1 },
      };
      const localTask1 = {
        ...createMockOp('local-1', 'clientA'),
        entityId: 'task-1',
        vectorClock: { clientA: 1 },
      };
      const localTask2 = {
        ...createMockOp('local-2', 'clientA'),
        entityId: 'task-2',
        vectorClock: { clientA: 1 },
      };
      const localPendingOpsByEntity = new Map<string, Operation[]>([
        ['TASK:task-1', [localTask1]],
        ['TASK:task-2', [localTask2]],
      ]);
      const appliedFrontierByEntity = new Map<string, VectorClock>([
        ['TASK:task-1', { clientA: 1 }],
        ['TASK:task-2', { clientA: 1 }],
      ]);

      const result = await service.checkOpForConflicts(
        remoteOp,
        buildCtx({ localPendingOpsByEntity, appliedFrontierByEntity }),
      );

      expect(result.conflicts.map((conflict) => conflict.entityId)).toEqual([
        'task-1',
        'task-2',
      ]);
    });

    it('should detect CONCURRENT conflict when pending local ops exist', async () => {
      const remoteOp: Operation = {
        ...createMockOp('remote-1', 'clientB'),
        entityId: 'task-1',
        vectorClock: { clientB: 1 },
      };

      const localOp: Operation = {
        ...createMockOp('local-1', 'clientA'),
        entityId: 'task-1',
        vectorClock: { clientA: 1 },
      };

      const localPendingOpsByEntity = new Map<string, Operation[]>();
      localPendingOpsByEntity.set('TASK:task-1', [localOp]);

      const appliedFrontierByEntity = new Map<string, VectorClock>();
      appliedFrontierByEntity.set('TASK:task-1', { clientA: 1 });

      const result = await service.checkOpForConflicts(
        remoteOp,
        buildCtx({ localPendingOpsByEntity, appliedFrontierByEntity }),
      );

      expect(result.isSupersededOrDuplicate).toBe(false);
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].entityId).toBe('task-1');
      // Should NOT have called store.select — pending ops exist, so normal conflict path
      expect(mockStore.select).not.toHaveBeenCalled();
    });

    it('should keep concurrent additive task-time deltas non-conflicting', async () => {
      const remoteOp: Operation = {
        ...createMockOp('remote-time', 'clientB'),
        actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
        entityId: 'task-1',
        payload: { taskId: 'task-1', date: '2024-01-15', duration: 3000 },
        vectorClock: { clientB: 1 },
      };
      const localOp: Operation = {
        ...createMockOp('local-time', 'clientA'),
        actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
        entityId: 'task-1',
        payload: { taskId: 'task-1', date: '2024-01-15', duration: 2000 },
        vectorClock: { clientA: 1 },
      };
      const localPendingOpsByEntity = new Map<string, Operation[]>([
        ['TASK:task-1', [localOp]],
      ]);

      const result = await service.checkOpForConflicts(
        remoteOp,
        buildCtx({ localPendingOpsByEntity }),
      );

      expect(result).toEqual({ isSupersededOrDuplicate: false, conflicts: [] });
    });

    it('should use entityId fallback when entityIds is an empty array', async () => {
      // Regression test: entityIds: [] is truthy in JS, so the old || fallback
      // would use the empty array instead of falling back to entityId.
      const remoteOp: Operation = {
        ...createMockOp('remote-1', 'clientB'),
        entityId: 'task-1',
        entityIds: [],
        vectorClock: { clientB: 1 },
      };

      const localOp: Operation = {
        ...createMockOp('local-1', 'clientA'),
        entityId: 'task-1',
        vectorClock: { clientA: 1 },
      };

      const localPendingOpsByEntity = new Map<string, Operation[]>();
      localPendingOpsByEntity.set('TASK:task-1', [localOp]);

      const appliedFrontierByEntity = new Map<string, VectorClock>();
      appliedFrontierByEntity.set('TASK:task-1', { clientA: 1 });

      const result = await service.checkOpForConflicts(
        remoteOp,
        buildCtx({ localPendingOpsByEntity, appliedFrontierByEntity }),
      );

      // With the fix, entityId 'task-1' is resolved and a conflict is detected.
      // Without the fix, entityIds: [] would be used as-is, skipping the entity entirely.
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].entityId).toBe('task-1');
    });

    it('should check both entityId and entityIds when both are present', async () => {
      const remoteOp: Operation = {
        ...createMockOp('remote-1', 'clientB'),
        entityId: 'task-1',
        entityIds: ['task-2'],
        vectorClock: { clientB: 1 },
      };
      const localOp: Operation = {
        ...createMockOp('local-1', 'clientA'),
        entityId: 'task-1',
        vectorClock: { clientA: 1 },
      };
      const localPendingOpsByEntity = new Map<string, Operation[]>([
        ['TASK:task-1', [localOp]],
      ]);

      const result = await service.checkOpForConflicts(
        remoteOp,
        buildCtx({ localPendingOpsByEntity }),
      );

      expect(result.conflicts[0]?.entityId).toBe('task-1');
    });
  });

  describe('_convertToLWWUpdatesIfNeeded', () => {
    const createOpWithTimestamp = (
      id: string,
      clientId: string,
      timestamp: number,
      opType: OpType = OpType.Update,
      entityId: string = 'task-1',
    ): Operation => ({
      id,
      clientId,
      actionType: 'test' as ActionType,
      opType,
      entityType: 'TASK',
      entityId,
      payload: { source: clientId },
      vectorClock: { [clientId]: 1 },
      timestamp,
      schemaVersion: 1,
    });

    const createConflict = (
      entityId: string,
      localOps: Operation[],
      remoteOps: Operation[],
    ): EntityConflict => ({
      entityType: 'TASK',
      entityId,
      localOps,
      remoteOps,
      suggestedResolution: 'manual',
    });

    it('should return remote ops unchanged when no local DELETE exists', () => {
      const remoteOp = {
        ...createOpWithTimestamp('remote-upd', 'client-b', Date.now()),
        opType: OpType.Update,
      };
      const conflict = createConflict(
        'task-1',
        [
          {
            ...createOpWithTimestamp('local-upd', 'client-a', Date.now() - 1000),
            opType: OpType.Update,
          },
        ],
        [remoteOp],
      );

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);
      expect(result).toEqual([remoteOp]);
    });

    it('should convert remote UPDATE to LWW Update with merged entity when local DELETE has flat payload', () => {
      const fullEntity = {
        id: 'task-1',
        title: 'Original Title',
        projectId: 'proj-1',
        tagIds: ['tag-1'],
        dueDay: '2025-01-15',
      };

      const conflict = createConflict(
        'task-1',
        [
          {
            ...createOpWithTimestamp('local-del', 'client-a', Date.now() - 1000),
            opType: OpType.Delete,
            payload: { task: fullEntity },
          },
        ],
        [
          {
            ...createOpWithTimestamp('remote-upd', 'client-b', Date.now()),
            opType: OpType.Update,
            payload: { task: { id: 'task-1', changes: { title: 'Updated Title' } } },
          },
        ],
      );

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);

      expect(result.length).toBe(1);
      expect(result[0].actionType).toBe('[TASK] LWW Update');
      expect(extractActionPayload(result[0].payload)).toEqual({
        id: 'task-1',
        title: 'Updated Title',
        projectId: 'proj-1',
        tagIds: ['tag-1'],
        dueDay: '2025-01-15',
      });
    });

    it('should convert remote UPDATE to LWW Update with merged entity when local DELETE has MultiEntityPayload', () => {
      const fullEntity = {
        id: 'task-1',
        title: 'Original Title',
        projectId: 'proj-1',
        tagIds: ['tag-1'],
        dueDay: '2025-01-15',
      };

      const conflict = createConflict(
        'task-1',
        [
          {
            ...createOpWithTimestamp('local-del', 'client-a', Date.now() - 1000),
            opType: OpType.Delete,
            payload: {
              actionPayload: { task: fullEntity },
              entityChanges: [],
            },
          },
        ],
        [
          {
            ...createOpWithTimestamp('remote-upd', 'client-b', Date.now()),
            opType: OpType.Update,
            payload: {
              actionPayload: {
                task: { id: 'task-1', changes: { title: 'Updated Title' } },
              },
              entityChanges: [],
            },
          },
        ],
      );

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);

      expect(result.length).toBe(1);
      expect(result[0].actionType).toBe('[TASK] LWW Update');
      expect(extractActionPayload(result[0].payload)).toEqual({
        id: 'task-1',
        title: 'Updated Title',
        projectId: 'proj-1',
        tagIds: ['tag-1'],
        dueDay: '2025-01-15',
      });
    });

    it('should preserve all base entity fields when UPDATE only changes one field', () => {
      const fullEntity = {
        id: 'task-1',
        title: 'Original',
        notes: 'Some notes',
        projectId: 'proj-1',
        tagIds: ['tag-1', 'tag-2'],
        dueDay: '2025-06-01',
        timeEstimate: 3600000,
      };

      const conflict = createConflict(
        'task-1',
        [
          {
            ...createOpWithTimestamp('local-del', 'client-a', Date.now() - 1000),
            opType: OpType.Delete,
            payload: { task: fullEntity },
          },
        ],
        [
          {
            ...createOpWithTimestamp('remote-upd', 'client-b', Date.now()),
            opType: OpType.Update,
            payload: { task: { id: 'task-1', changes: { title: 'New Title' } } },
          },
        ],
      );

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);

      const payload = extractActionPayload(result[0].payload);
      expect(payload['notes']).toBe('Some notes');
      expect(payload['projectId']).toBe('proj-1');
      expect(payload['tagIds']).toEqual(['tag-1', 'tag-2']);
      expect(payload['dueDay']).toBe('2025-06-01');
      expect(payload['timeEstimate']).toBe(3600000);
      expect(payload['title']).toBe('New Title');
    });

    it('should not convert non-UPDATE remote ops even when local DELETE exists', () => {
      const conflict = createConflict(
        'task-1',
        [
          {
            ...createOpWithTimestamp('local-del', 'client-a', Date.now() - 1000),
            opType: OpType.Delete,
            payload: { task: { id: 'task-1', title: 'Deleted' } },
          },
        ],
        [
          {
            ...createOpWithTimestamp('remote-create', 'client-b', Date.now()),
            opType: OpType.Create,
            payload: { task: { id: 'task-1', title: 'Created' } },
          },
        ],
      );

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);

      expect(result.length).toBe(1);
      expect(result[0].opType).toBe(OpType.Create);
      expect(result[0].actionType).toBe('test');
    });

    it('should not convert a winning remote archive when local DELETE exists', () => {
      const archivePayload = {
        actionPayload: {
          tasks: [{ id: 'task-1', title: 'Archived task' }],
        },
        entityChanges: [],
      };
      const conflict = createConflict(
        'task-1',
        [
          {
            ...createOpWithTimestamp('local-del', 'client-a', Date.now() - 1000),
            opType: OpType.Delete,
            payload: { task: { id: 'task-1', title: 'Deleted task' } },
          },
        ],
        [
          {
            ...createOpWithTimestamp('remote-archive', 'client-b', Date.now()),
            actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
            opType: OpType.Update,
            payload: archivePayload,
          },
        ],
      );

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);

      expect(result[0].actionType).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
      expect(result[0].payload).toBe(archivePayload);
    });

    it('should return remote op unchanged when base entity cannot be extracted', () => {
      // Rewriting actionType to LWW Update with an unmerged NgRx UPDATE payload
      // would no-op at the consumer (lwwUpdateMetaReducer bails when entityData
      // has no top-level id). The fallback now leaves the op alone instead of
      // pretending to convert it.
      const conflict = createConflict(
        'task-1',
        [
          {
            ...createOpWithTimestamp('local-del', 'client-a', Date.now() - 1000),
            opType: OpType.Delete,
            payload: {},
          },
        ],
        [
          {
            ...createOpWithTimestamp('remote-upd', 'client-b', Date.now()),
            opType: OpType.Update,
            payload: { task: { id: 'task-1', changes: { title: 'Updated' } } },
          },
        ],
      );

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);

      expect(result[0].actionType).toBe('test');
      expect(result[0].payload).toEqual({
        task: { id: 'task-1', changes: { title: 'Updated' } },
      });
    });

    it('should handle flat UPDATE payload format (no changes wrapper)', () => {
      const fullEntity = {
        id: 'task-1',
        title: 'Original',
        projectId: 'proj-1',
      };

      const conflict = createConflict(
        'task-1',
        [
          {
            ...createOpWithTimestamp('local-del', 'client-a', Date.now() - 1000),
            opType: OpType.Delete,
            payload: { task: fullEntity },
          },
        ],
        [
          {
            ...createOpWithTimestamp('remote-upd', 'client-b', Date.now()),
            opType: OpType.Update,
            payload: { task: { id: 'task-1', title: 'Flat Update' } },
          },
        ],
      );

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);

      expect(extractActionPayload(result[0].payload)).toEqual({
        id: 'task-1',
        title: 'Flat Update',
        projectId: 'proj-1',
      });
    });

    it('should fall back when local DELETE is bulk deleteTasks (only taskIds, no entity)', () => {
      // deleteTasks action payload: { taskIds: string[] } — no full entity
      const conflict = createConflict(
        'task-1',
        [
          {
            ...createOpWithTimestamp('local-del', 'client-a', Date.now() - 1000),
            opType: OpType.Delete,
            payload: { taskIds: ['task-1', 'task-2'] },
          },
        ],
        [
          {
            ...createOpWithTimestamp('remote-upd', 'client-b', Date.now()),
            opType: OpType.Update,
            payload: { task: { id: 'task-1', changes: { title: 'Updated' } } },
          },
        ],
      );

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);

      expect(result.length).toBe(1);
      // Fallback returns the remote op unchanged — original actionType + payload preserved.
      expect(result[0].actionType).toBe('test');
      expect(result[0].payload).toEqual({
        task: { id: 'task-1', changes: { title: 'Updated' } },
      });
    });

    it('should fall back when local DELETE payload has no recognizable entity structure', () => {
      const conflict = createConflict(
        'task-1',
        [
          {
            ...createOpWithTimestamp('local-del', 'client-a', Date.now() - 1000),
            opType: OpType.Delete,
            payload: { someUnrelatedKey: 'value' },
          },
        ],
        [
          {
            ...createOpWithTimestamp('remote-upd', 'client-b', Date.now()),
            opType: OpType.Update,
            payload: { task: { id: 'task-1', changes: { notes: 'New notes' } } },
          },
        ],
      );

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);

      // Fallback returns the remote op unchanged — original actionType + payload preserved.
      expect(result[0].actionType).toBe('test');
      expect(result[0].payload).toEqual({
        task: { id: 'task-1', changes: { notes: 'New notes' } },
      });
    });

    it('should produce merged entity with top-level id when base entity is available', () => {
      // This verifies the happy path produces a payload that
      // lwwUpdateMetaReducer can consume (requires top-level `id`)
      const fullEntity = {
        id: 'task-1',
        title: 'Original',
        projectId: 'proj-1',
      };

      const conflict = createConflict(
        'task-1',
        [
          {
            ...createOpWithTimestamp('local-del', 'client-a', Date.now() - 1000),
            opType: OpType.Delete,
            payload: { task: fullEntity },
          },
        ],
        [
          {
            ...createOpWithTimestamp('remote-upd', 'client-b', Date.now()),
            opType: OpType.Update,
            payload: { task: { id: 'task-1', changes: { title: 'New' } } },
          },
        ],
      );

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);

      // Merged payload has top-level `id` — required by lwwUpdateMetaReducer
      const payload = extractActionPayload(result[0].payload);
      expect(payload['id']).toBe('task-1');
      expect(typeof payload['id']).toBe('string');
    });
  });

  describe('_extractEntityFromPayload', () => {
    it('should extract entity from flat payload using entity key', () => {
      const entity = { id: 'task-1', title: 'Test' };
      const payload = { task: entity };

      const result = (service as any)._extractEntityFromPayload(payload, 'TASK');
      expect(result).toEqual(entity);
    });

    it('should extract entity from MultiEntityPayload format', () => {
      const entity = { id: 'task-1', title: 'Test' };
      const payload = {
        actionPayload: { task: entity },
        entityChanges: [],
      };

      const result = (service as any)._extractEntityFromPayload(payload, 'TASK');
      expect(result).toEqual(entity);
    });

    it('should fall back to payload itself when it has an id property', () => {
      const payload = { id: 'task-1', title: 'Direct Entity' };

      const result = (service as any)._extractEntityFromPayload(payload, 'TASK');
      expect(result).toEqual(payload);
    });

    it('should return undefined when entity key is not found and payload has no id', () => {
      const payload = { unrelatedKey: 'value' };

      const result = (service as any)._extractEntityFromPayload(payload, 'TASK');
      expect(result).toBeUndefined();
    });

    it('should return undefined for null payload values under entity key', () => {
      const payload = { task: null };

      const result = (service as any)._extractEntityFromPayload(payload, 'TASK');
      expect(result).toBeUndefined();
    });
  });

  describe('_extractUpdateChanges', () => {
    it('should extract changes from NgRx adapter format (id + changes)', () => {
      const payload = {
        task: { id: 'task-1', changes: { title: 'New', notes: 'Updated' } },
      };

      const result = (service as any)._extractUpdateChanges(payload, 'TASK');
      expect(result).toEqual({ title: 'New', notes: 'Updated' });
    });

    it('should extract changes from flat format (exclude id)', () => {
      const payload = { task: { id: 'task-1', title: 'New', notes: 'Updated' } };

      const result = (service as any)._extractUpdateChanges(payload, 'TASK');
      expect(result).toEqual({ title: 'New', notes: 'Updated' });
    });

    it('should handle MultiEntityPayload wrapping NgRx adapter format', () => {
      const payload = {
        actionPayload: {
          task: { id: 'task-1', changes: { title: 'New' } },
        },
        entityChanges: [],
      };

      const result = (service as any)._extractUpdateChanges(payload, 'TASK');
      expect(result).toEqual({ title: 'New' });
    });

    it('should handle MultiEntityPayload wrapping flat format', () => {
      const payload = {
        actionPayload: {
          task: { id: 'task-1', title: 'New' },
        },
        entityChanges: [],
      };

      const result = (service as any)._extractUpdateChanges(payload, 'TASK');
      expect(result).toEqual({ title: 'New' });
    });

    it('should return empty object when entity key is not in payload', () => {
      const payload = { wrongKey: { id: 'task-1', title: 'New' } };

      const result = (service as any)._extractUpdateChanges(payload, 'TASK');
      expect(result).toEqual({});
    });
  });

  describe('_extractEntityFromDeleteOperation with MultiEntityPayload', () => {
    const createOpWithTimestamp = (
      id: string,
      clientId: string,
      timestamp: number,
    ): Operation => ({
      id,
      clientId,
      actionType: 'test' as ActionType,
      opType: OpType.Delete,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: {},
      vectorClock: { [clientId]: 1 },
      timestamp,
      schemaVersion: 1,
    });

    it('should extract entity from MultiEntityPayload format in DELETE operation', () => {
      const taskEntity = {
        id: 'task-1',
        title: 'Test Task',
        projectId: 'project-1',
      };

      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [],
        remoteOps: [
          {
            ...createOpWithTimestamp('remote-del', 'client-b', Date.now()),
            payload: {
              actionPayload: { task: taskEntity },
              entityChanges: [],
            },
          },
        ],
        suggestedResolution: 'manual',
      };

      const result = (service as any)._extractEntityFromDeleteOperation(conflict);
      expect(result).toEqual(taskEntity);
    });

    it('should extract entity from flat payload format in DELETE operation', () => {
      const taskEntity = {
        id: 'task-1',
        title: 'Test Task',
        projectId: 'project-1',
      };

      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [],
        remoteOps: [
          {
            ...createOpWithTimestamp('remote-del', 'client-b', Date.now()),
            payload: { task: taskEntity },
          },
        ],
        suggestedResolution: 'manual',
      };

      const result = (service as any)._extractEntityFromDeleteOperation(conflict);
      expect(result).toEqual(taskEntity);
    });
  });

  describe('_adjustForClockCorruption', () => {
    /**
     * Tests for the clock corruption recovery mechanism.
     *
     * The method detects potential per-entity clock corruption when:
     * - Entity has pending local ops (we made changes)
     * - But has no snapshot clock AND empty local frontier
     * - This suggests the clock data was lost/corrupted
     *
     * When corruption is suspected, LESS_THAN and GREATER_THAN are converted
     * to CONCURRENT to force conflict resolution (safer than silently skipping).
     */

    const adjustForClockCorruption = (
      comparison: VectorClockComparison,
      entityKey: string,
      ctx: {
        localOpsForEntity: Operation[];
        hasNoSnapshotClock: boolean;
        localFrontierIsEmpty: boolean;
      },
    ): VectorClockComparison => {
      return (service as any)._adjustForClockCorruption(comparison, entityKey, ctx);
    };

    describe('when NO corruption suspected (normal case)', () => {
      it('should return LESS_THAN unchanged', () => {
        const result = adjustForClockCorruption(
          VectorClockComparison.LESS_THAN,
          'TASK:task-1',
          {
            localOpsForEntity: [], // No pending ops - no corruption possible
            hasNoSnapshotClock: false,
            localFrontierIsEmpty: false,
          },
        );
        expect(result).toBe(VectorClockComparison.LESS_THAN);
      });

      it('should return GREATER_THAN unchanged', () => {
        const result = adjustForClockCorruption(
          VectorClockComparison.GREATER_THAN,
          'TASK:task-1',
          {
            localOpsForEntity: [], // No pending ops
            hasNoSnapshotClock: true,
            localFrontierIsEmpty: true,
          },
        );
        expect(result).toBe(VectorClockComparison.GREATER_THAN);
      });

      it('should return CONCURRENT unchanged', () => {
        const result = adjustForClockCorruption(
          VectorClockComparison.CONCURRENT,
          'TASK:task-1',
          {
            localOpsForEntity: [],
            hasNoSnapshotClock: false,
            localFrontierIsEmpty: false,
          },
        );
        expect(result).toBe(VectorClockComparison.CONCURRENT);
      });

      it('should return EQUAL unchanged', () => {
        const result = adjustForClockCorruption(
          VectorClockComparison.EQUAL,
          'TASK:task-1',
          {
            localOpsForEntity: [],
            hasNoSnapshotClock: true,
            localFrontierIsEmpty: true,
          },
        );
        expect(result).toBe(VectorClockComparison.EQUAL);
      });

      it('should NOT adjust when entity has pending ops but HAS snapshot clock', () => {
        const localOp = createMockOp('op-1', 'client-a');
        const result = adjustForClockCorruption(
          VectorClockComparison.LESS_THAN,
          'TASK:task-1',
          {
            localOpsForEntity: [localOp],
            hasNoSnapshotClock: false, // Has snapshot clock - no corruption
            localFrontierIsEmpty: true,
          },
        );
        expect(result).toBe(VectorClockComparison.LESS_THAN);
      });

      it('should NOT adjust when entity has pending ops but HAS local frontier', () => {
        const localOp = createMockOp('op-1', 'client-a');
        const result = adjustForClockCorruption(
          VectorClockComparison.GREATER_THAN,
          'TASK:task-1',
          {
            localOpsForEntity: [localOp],
            hasNoSnapshotClock: true,
            localFrontierIsEmpty: false, // Has frontier - no corruption
          },
        );
        expect(result).toBe(VectorClockComparison.GREATER_THAN);
      });
    });

    describe('when clock corruption IS suspected', () => {
      /**
       * Corruption is suspected when ALL three conditions are met:
       * 1. Entity has pending local ops
       * 2. No snapshot clock exists
       * 3. Local frontier is empty
       */

      beforeEach(() => {
        // Prevent devError from throwing (it calls alert + confirm → throws if confirm returns true)
        if (!jasmine.isSpy(window.alert)) {
          spyOn(window, 'alert');
        }
        if (!jasmine.isSpy(window.confirm)) {
          spyOn(window, 'confirm').and.returnValue(false);
        } else {
          (window.confirm as jasmine.Spy).and.returnValue(false);
        }
      });

      it('should convert LESS_THAN to CONCURRENT', () => {
        const localOp = createMockOp('op-1', 'client-a');
        const result = adjustForClockCorruption(
          VectorClockComparison.LESS_THAN,
          'TASK:task-1',
          {
            localOpsForEntity: [localOp],
            hasNoSnapshotClock: true,
            localFrontierIsEmpty: true,
          },
        );
        expect(result).toBe(VectorClockComparison.CONCURRENT);
      });

      it('should convert GREATER_THAN to CONCURRENT', () => {
        const localOp = createMockOp('op-1', 'client-a');
        const result = adjustForClockCorruption(
          VectorClockComparison.GREATER_THAN,
          'TASK:task-1',
          {
            localOpsForEntity: [localOp],
            hasNoSnapshotClock: true,
            localFrontierIsEmpty: true,
          },
        );
        expect(result).toBe(VectorClockComparison.CONCURRENT);
      });

      it('should NOT change CONCURRENT (already safest)', () => {
        const localOp = createMockOp('op-1', 'client-a');
        const result = adjustForClockCorruption(
          VectorClockComparison.CONCURRENT,
          'TASK:task-1',
          {
            localOpsForEntity: [localOp],
            hasNoSnapshotClock: true,
            localFrontierIsEmpty: true,
          },
        );
        expect(result).toBe(VectorClockComparison.CONCURRENT);
      });

      it('should NOT change EQUAL (duplicates are safe to skip)', () => {
        const localOp = createMockOp('op-1', 'client-a');
        const result = adjustForClockCorruption(
          VectorClockComparison.EQUAL,
          'TASK:task-1',
          {
            localOpsForEntity: [localOp],
            hasNoSnapshotClock: true,
            localFrontierIsEmpty: true,
          },
        );
        expect(result).toBe(VectorClockComparison.EQUAL);
      });

      it('should handle multiple pending ops', () => {
        const op1 = createMockOp('op-1', 'client-a');
        const op2 = createMockOp('op-2', 'client-a');
        const result = adjustForClockCorruption(
          VectorClockComparison.LESS_THAN,
          'TASK:task-1',
          {
            localOpsForEntity: [op1, op2],
            hasNoSnapshotClock: true,
            localFrontierIsEmpty: true,
          },
        );
        expect(result).toBe(VectorClockComparison.CONCURRENT);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BUG CONFIRMATION TEST (Issue #6571)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bug #6571: LWW apply failure does not throw', () => {
    const now = Date.now();

    const createOpForBug = (
      id: string,
      clientId: string,
      timestamp: number,
    ): Operation => ({
      id,
      clientId,
      actionType: 'test' as ActionType,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { source: clientId },
      vectorClock: { [clientId]: 1 },
      timestamp,
      schemaVersion: 1,
    });

    beforeEach(() => {
      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.callFake(() => Promise.resolve(1));
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOpLogStore.markFailed.and.resolveTo(undefined);
    });

    it('should throw when applyOperations has a failedOp', async () => {
      const localOp = createOpForBug('local-1', 'client-a', now - 1000);
      const remoteOp = createOpForBug('remote-1', 'client-b', now);

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [localOp],
          remoteOps: [remoteOp],
          suggestedResolution: 'manual',
        },
      ];

      mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return {
          appliedOps: [],
          failedOp: { op: remoteOp, error: new Error('Apply failed for task-1') },
        };
      });

      // FIXED: Should throw on apply failure (parity with applyNonConflictingOps)
      await expectAsync(service.autoResolveConflictsLWW(conflicts)).toBeRejectedWithError(
        'Apply failed for task-1',
      );

      expect(mockOpLogStore.markFailed).toHaveBeenCalled();
      expect(mockSnackService.open).toHaveBeenCalled();
    });

    // Issue #7700: the deferred-actions flush must run even on the apply-
    // failure path. Pre-fix, replayOperationBatch's finally took care of
    // this; with the fix, the host explicitly calls
    // _processDeferredActionsAfterRemoteApply before the throw. If the
    // failure path ever forgets to flush, deferred local actions linger
    // in the buffer until the NEXT sync — surfacing as ghost ops with
    // stale clocks. This test pins the flush.
    it('should process deferred actions before throwing on failedOp (callerHoldsOperationLogLock=true)', async () => {
      const localOp = createOpForBug('local-1', 'client-a', now - 1000);
      const remoteOp = createOpForBug('remote-1', 'client-b', now);

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [localOp],
          remoteOps: [remoteOp],
          suggestedResolution: 'manual',
        },
      ];

      const callOrder: string[] = [];
      mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
        callOrder.push('applyOperations');
        await options?.onReducersCommitted?.(ops);
        return {
          appliedOps: [],
          failedOp: { op: remoteOp, error: new Error('Apply failed for task-1') },
        };
      });
      mockOpLogStore.markFailed.and.callFake(async () => {
        callOrder.push('markFailed');
      });
      mockOperationLogEffects.processDeferredActions.and.callFake(async () => {
        callOrder.push('processDeferredActions');
      });

      await expectAsync(
        service.autoResolveConflictsLWW(conflicts, [], {
          callerHoldsOperationLogLock: true,
        }),
      ).toBeRejectedWithError('Apply failed for task-1');

      // Deferred flush must happen BEFORE the throw, and must thread the
      // caller-holds-lock flag through so writeOperation skips the inner
      // sp_op_log acquisition.
      expect(mockOperationLogEffects.processDeferredActions).toHaveBeenCalledWith({
        callerHoldsOperationLogLock: true,
      });
      expect(callOrder).toContain('processDeferredActions');
      expect(callOrder.indexOf('processDeferredActions')).toBeGreaterThan(
        callOrder.indexOf('applyOperations'),
      );
    });

    it('should preserve the incomplete-remote error when the deferred drain also fails', async () => {
      const localOp = createOpForBug('local-1', 'client-a', now - 1000);
      const remoteOp = createOpForBug('remote-1', 'client-b', now);
      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [localOp],
          remoteOps: [remoteOp],
          suggestedResolution: 'manual',
        },
      ];
      mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return {
          appliedOps: [],
          failedOp: { op: remoteOp, error: new Error('archive failed') },
        };
      });
      mockOperationLogEffects.processDeferredActions.and.rejectWith(
        new Error('deferred drain failed'),
      );

      let thrown: unknown;
      try {
        await service.autoResolveConflictsLWW(conflicts);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(IncompleteRemoteOperationsError);
      expect((thrown as Error).message).toBe('archive failed');
    });

    it('should not start apply or drain deferred actions when the pre-apply clock merge fails', async () => {
      const localOp = createOpForBug('local-1', 'client-a', now - 1000);
      const remoteOp = createOpForBug('remote-1', 'client-b', now);
      const clockError = new Error('clock merge failed');
      mockOpLogStore.mergeRemoteOpClocks.and.rejectWith(clockError);

      await expectAsync(
        service.autoResolveConflictsLWW([
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [localOp],
            remoteOps: [remoteOp],
            suggestedResolution: 'manual',
          },
        ]),
      ).toBeRejectedWith(clockError);

      expect(mockOperationApplier.applyOperations).not.toHaveBeenCalled();
      expect(mockOpLogStore.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
      expect(mockOperationLogEffects.processDeferredActions).not.toHaveBeenCalled();
    });

    it('should drain deferred actions when the atomic reducer+clock checkpoint fails after pre-merge', async () => {
      const localOp = createOpForBug('local-1', 'client-a', now - 1000);
      const remoteOp = createOpForBug('remote-1', 'client-b', now);
      const checkpointError = new Error('checkpoint failed');
      mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      });
      mockOpLogStore.markReducersCommittedAndMergeClocks.and.rejectWith(checkpointError);

      await expectAsync(
        service.autoResolveConflictsLWW([
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [localOp],
            remoteOps: [remoteOp],
            suggestedResolution: 'manual',
          },
        ]),
      ).toBeRejectedWith(checkpointError);

      expect(mockOperationLogEffects.processDeferredActions).toHaveBeenCalled();
    });

    it('should drain deferred actions when reducer dispatch fails after pre-merge', async () => {
      const localOp = createOpForBug('local-1', 'client-a', now - 1000);
      const remoteOp = createOpForBug('remote-1', 'client-b', now);
      const dispatchError = new Error('dispatcher failed');
      mockOperationApplier.applyOperations.and.rejectWith(dispatchError);

      await expectAsync(
        service.autoResolveConflictsLWW([
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [localOp],
            remoteOps: [remoteOp],
            suggestedResolution: 'manual',
          },
        ]),
      ).toBeRejectedWith(dispatchError);

      expect(mockOperationLogEffects.processDeferredActions).toHaveBeenCalled();
    });

    it('should drain deferred actions when bookkeeping fails after the atomic checkpoint', async () => {
      const localOp = createOpForBug('local-1', 'client-a', now - 1000);
      const remoteOp = createOpForBug('remote-1', 'client-b', now);
      const markAppliedError = new Error('mark applied failed');
      mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      });
      mockOpLogStore.markApplied.and.rejectWith(markAppliedError);

      await expectAsync(
        service.autoResolveConflictsLWW([
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [localOp],
            remoteOps: [remoteOp],
            suggestedResolution: 'manual',
          },
        ]),
      ).toBeRejectedWith(markAppliedError);

      expect(mockOperationLogEffects.processDeferredActions).toHaveBeenCalled();
    });

    it('should preserve a bookkeeping error when the deferred drain also fails', async () => {
      const localOp = createOpForBug('local-1', 'client-a', now - 1000);
      const remoteOp = createOpForBug('remote-1', 'client-b', now);
      const markAppliedError = new Error('mark applied failed');
      mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
        await options?.onReducersCommitted?.(ops);
        return { appliedOps: ops };
      });
      mockOpLogStore.markApplied.and.rejectWith(markAppliedError);
      mockOperationLogEffects.processDeferredActions.and.rejectWith(
        new Error('deferred drain failed'),
      );

      await expectAsync(
        service.autoResolveConflictsLWW([
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [localOp],
            remoteOps: [remoteOp],
            suggestedResolution: 'manual',
          },
        ]),
      ).toBeRejectedWith(markAppliedError);
    });
  });

  describe('LWW Update payload always has top-level id (#7330)', () => {
    // The lwwUpdateMetaReducer bails with "Entity data has no id" when an LWW
    // Update payload lacks a top-level id. createLWWUpdateOp is the choke point
    // for two of three LWW Update producers (_createLocalWinUpdateOp and the
    // superseded-operation-resolver). Both pass the canonical entityId — so the
    // payload should always carry it, even when entityState was malformed.

    it('should backfill payload.id from entityId when entityState lacks id', () => {
      const entityStateWithoutId = { title: 'Local winner', projectId: 'proj-1' };
      const op = service.createLWWUpdateOp(
        'TASK',
        'task-canonical',
        entityStateWithoutId,
        TEST_CLIENT_ID,
        { [TEST_CLIENT_ID]: 1 },
        Date.now(),
      );

      expect(extractActionPayload(op.payload)['id']).toBe('task-canonical');
      expect((op.payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe('replace');
    });

    it('should overwrite a mismatched payload.id with the canonical entityId', () => {
      const entityStateWithStaleId = {
        id: 'wrong-id',
        title: 'Local winner',
      };
      const op = service.createLWWUpdateOp(
        'TASK',
        'task-canonical',
        entityStateWithStaleId,
        TEST_CLIENT_ID,
        { [TEST_CLIENT_ID]: 1 },
        Date.now(),
      );

      expect(extractActionPayload(op.payload)['id']).toBe('task-canonical');
    });

    it('should handle non-object entityState by producing { id } payload', () => {
      // Defensive: producers should never pass non-objects, but if they do
      // we still want a usable payload rather than something the reducer rejects.
      const op = service.createLWWUpdateOp(
        'TASK',
        'task-canonical',
        undefined,
        TEST_CLIENT_ID,
        { [TEST_CLIENT_ID]: 1 },
        Date.now(),
      );

      expect(extractActionPayload(op.payload)['id']).toBe('task-canonical');
    });

    it('should preserve and normalize an explicit operation footprint', () => {
      const op = service.createLWWUpdateOp(
        'TASK',
        'task-canonical',
        { title: 'Local winner' },
        TEST_CLIENT_ID,
        { [TEST_CLIENT_ID]: 1 },
        Date.now(),
        'replace',
        ['subtask-1', 'task-canonical', 'subtask-1'],
      );

      expect(op.entityIds).toEqual(['task-canonical', 'subtask-1']);
      // The same footprint must also ride inside the authenticated payload so
      // remote clients don't have to trust the plaintext envelope.
      // GHSA-8pxh-mgc7-gp3g.
      expect(
        (op.payload as { projectMoveFootprint?: readonly string[] }).projectMoveFootprint,
      ).toEqual(['task-canonical', 'subtask-1']);
    });

    it('should omit projectMoveFootprint when no footprint is supplied', () => {
      const op = service.createLWWUpdateOp(
        'TASK',
        'task-canonical',
        { title: 'Local winner' },
        TEST_CLIENT_ID,
        { [TEST_CLIENT_ID]: 1 },
        Date.now(),
      );

      expect(op.entityIds).toBeUndefined();
      expect(
        (op.payload as { projectMoveFootprint?: readonly string[] }).projectMoveFootprint,
      ).toBeUndefined();
    });

    describe('getLatestTaskProjectMoveEntityIds (authenticated footprint source)', () => {
      const lwwMoveOp = (overrides: Partial<Operation>): Operation =>
        ({
          id: 'op-x',
          actionType: toLwwUpdateActionType('TASK'),
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'taskT',
          payload: {
            actionPayload: { id: 'taskT' },
            entityChanges: [],
            lwwUpdateMode: 'replace',
          },
          clientId: 'c',
          vectorClock: { c: 1 },
          timestamp: 1,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          ...overrides,
        }) as Operation;

      it('reuses the footprint from the authenticated payload, ignoring a tampered entityIds envelope (GHSA-8pxh-mgc7-gp3g)', () => {
        // A compromised server appended 'victim' to a remote LWW op's plaintext
        // entityIds envelope. Re-derivation must launder nothing: the merged op's
        // footprint comes from the authenticated payload.projectMoveFootprint.
        const op = lwwMoveOp({
          entityIds: ['taskT', 'victim'],
          payload: {
            actionPayload: { id: 'taskT' },
            entityChanges: [],
            lwwUpdateMode: 'replace',
            projectMoveFootprint: ['taskT', 'sub1'],
          } as unknown as Operation['payload'],
        });

        expect(getLatestTaskProjectMoveEntityIds([op])).toEqual(['taskT', 'sub1']);
      });

      it('returns undefined for a legacy LWW op with entityIds but no authenticated footprint (no laundering)', () => {
        const op = lwwMoveOp({ entityIds: ['taskT', 'victim'] });

        expect(getLatestTaskProjectMoveEntityIds([op])).toBeUndefined();
      });

      it('takes the raw TASK_SHARED_UPDATE footprint ROOT from the authenticated payload, not the tampered entityId envelope (GHSA-8pxh-mgc7-gp3g)', () => {
        // A raw TASK_SHARED_UPDATE op's entityId is NOT bound to payload.id by the
        // decrypt gate (that gate only covers LWW ops). A compromised server
        // retargets the plaintext envelope entityId to 'victim' while the
        // authenticated payload still moves the real task 'taskT'. The footprint
        // root must come from the authenticated payload.task.id.
        const op = {
          id: 'op-upd',
          actionType: ActionType.TASK_SHARED_UPDATE,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'victim',
          payload: {
            actionPayload: {
              task: { id: 'taskT', changes: { projectId: 'proj-2' } },
              projectMoveSubTaskIds: ['sub1'],
            },
            entityChanges: [],
          },
          clientId: 'c',
          vectorClock: { c: 1 },
          timestamp: 1,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        } as unknown as Operation;

        const result = getLatestTaskProjectMoveEntityIds([op]);
        expect(result).toEqual(['taskT', 'sub1']);
        expect(result).not.toContain('victim');
      });
    });

    it('should ensure _convertToLWWUpdatesIfNeeded merged payload has id even when base entity lacks id', () => {
      // Edge case: a malformed local DELETE payload whose embedded entity
      // somehow lacks an id (e.g. corruption). The merged LWW Update payload
      // should still carry id from conflict.entityId.
      const localClientId = 'client-a';
      const remoteClientId = 'client-b';
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        suggestedResolution: 'manual',
        localOps: [
          {
            id: 'local-del',
            clientId: localClientId,
            actionType: 'test' as ActionType,
            opType: OpType.Delete,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { task: { title: 'No id here', projectId: 'proj-1' } },
            vectorClock: { [localClientId]: 1 },
            timestamp: Date.now() - 1000,
            schemaVersion: 1,
          },
        ],
        remoteOps: [
          {
            id: 'remote-upd',
            clientId: remoteClientId,
            actionType: 'test' as ActionType,
            opType: OpType.Update,
            entityType: 'TASK',
            entityId: 'task-1',
            payload: { task: { id: 'task-1', changes: { title: 'New title' } } },
            vectorClock: { [remoteClientId]: 1 },
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ],
      };

      const result = (service as any)._convertToLWWUpdatesIfNeeded(conflict);

      expect(result.length).toBe(1);
      expect(result[0].actionType).toBe('[TASK] LWW Update');
      const payload = extractActionPayload(result[0].payload);
      expect(payload['id']).toBe('task-1');
      expect(payload['title']).toBe('New title');
      expect(payload['projectId']).toBe('proj-1');
    });

    // Singletons (GLOBAL_CONFIG, app-state, time-tracking) use entityId='*'
    // as a sentinel. Injecting `id: '*'` into the payload would pollute the
    // singleton feature state — which has no `id` field — when the consumer
    // reducer spreads entityData into the feature state.
    it('should NOT inject id when entityId is the singleton sentinel "*"', () => {
      const singletonState = { sync: { syncProvider: null }, misc: { foo: 'bar' } };
      const op = service.createLWWUpdateOp(
        'GLOBAL_CONFIG',
        '*',
        singletonState,
        TEST_CLIENT_ID,
        { [TEST_CLIENT_ID]: 1 },
        Date.now(),
      );

      expect(extractActionPayload(op.payload)['id']).toBeUndefined();
      // Original action payload shape is preserved (no synthetic field injected).
      expect(extractActionPayload(op.payload)).toEqual(singletonState);
    });
  });
});

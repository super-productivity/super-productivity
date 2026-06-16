import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, Store } from '@ngrx/store';
import type { DeferredLocalActionsPort } from '@sp/sync-core';
import { Observable, of } from 'rxjs';
import { OperationLogEffects } from './operation-log.effects';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { LockService } from '../sync/lock.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { SnackService } from '../../core/snack/snack.service';
import { ImmediateUploadService } from '../sync/immediate-upload.service';
import { ActionType, OpType } from '../core/operation.types';
import { PersistentAction } from '../core/persistent-action.interface';
import { COMPACTION_THRESHOLD } from '../core/operation-log.const';
import {
  bufferDeferredAction,
  clearDeferredActions,
} from './operation-capture.meta-reducer';
import { ClientIdService } from '../../core/util/client-id.service';
import { OperationCaptureService } from './operation-capture.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { T } from '../../t.const';
import { updateGlobalConfigSection } from '../../features/config/store/global-config.actions';

describe('OperationLogEffects', () => {
  let effects: OperationLogEffects;
  let actions$: Observable<Action>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLockService: jasmine.SpyObj<LockService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockCompactionService: jasmine.SpyObj<OperationLogCompactionService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockStore: jasmine.SpyObj<Store>;
  let mockImmediateUploadService: jasmine.SpyObj<ImmediateUploadService>;
  let mockClientIdService: jasmine.SpyObj<ClientIdService>;
  let mockOperationCaptureService: jasmine.SpyObj<OperationCaptureService>;

  const createPersistentAction = (
    type: string,
    isRemote: boolean = false,
    payload: Record<string, unknown> = {},
  ): PersistentAction => ({
    type,
    meta: {
      isPersistent: true,
      isRemote,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'task-1',
    },
    ...payload,
  });

  beforeEach(() => {
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'append',
      'appendWithVectorClockUpdate',
      'getCompactionCounter',
      'clearVectorClockCache',
    ]);
    mockLockService = jasmine.createSpyObj('LockService', ['request']);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockCompactionService = jasmine.createSpyObj('OperationLogCompactionService', [
      'compact',
      'emergencyCompact',
    ]);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    mockImmediateUploadService = jasmine.createSpyObj('ImmediateUploadService', [
      'trigger',
    ]);
    mockClientIdService = jasmine.createSpyObj('ClientIdService', [
      'getOrGenerateClientId',
    ]);
    mockOperationCaptureService = jasmine.createSpyObj('OperationCaptureService', [
      'extractEntityChanges',
      'decrementPending',
    ]);

    // Default mock implementations
    mockLockService.request.and.callFake(async <T>(_name: string, fn: () => Promise<T>) =>
      fn(),
    );
    mockOpLogStore.append.and.returnValue(Promise.resolve(1));
    mockOpLogStore.appendWithVectorClockUpdate.and.returnValue(Promise.resolve(1));
    mockOpLogStore.getCompactionCounter.and.returnValue(Promise.resolve(0));
    mockVectorClockService.getCurrentVectorClock.and.returnValue(
      Promise.resolve({ testClient: 5 }),
    );
    mockCompactionService.compact.and.returnValue(Promise.resolve());
    mockCompactionService.emergencyCompact.and.returnValue(Promise.resolve(true));
    mockStore.select.and.returnValue(of({})); // Return empty state observable
    mockClientIdService.getOrGenerateClientId.and.returnValue(
      Promise.resolve('testClient'),
    );
    mockOperationCaptureService.extractEntityChanges.and.returnValue([]);

    TestBed.configureTestingModule({
      providers: [
        OperationLogEffects,
        provideMockActions(() => actions$),
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LockService, useValue: mockLockService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: OperationLogCompactionService, useValue: mockCompactionService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: Store, useValue: mockStore },
        { provide: ImmediateUploadService, useValue: mockImmediateUploadService },
        { provide: ClientIdService, useValue: mockClientIdService },
        { provide: OperationCaptureService, useValue: mockOperationCaptureService },
      ],
    });

    effects = TestBed.inject(OperationLogEffects);

    // Clear deferred actions buffer to ensure test isolation
    clearDeferredActions();
  });

  afterEach(() => {
    // Clean up deferred actions buffer after each test
    clearDeferredActions();
  });

  describe('persistOperation$', () => {
    it('should persist operation for persistent action', (done) => {
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledWith(
            jasmine.objectContaining({
              actionType: ActionType.TASK_SHARED_UPDATE,
              opType: OpType.Update,
              entityType: 'TASK',
              clientId: 'testClient',
            }),
            'local',
          );
          done();
        },
      });
    });

    it('should skip remote actions', (done) => {
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE, true);
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          expect(mockOpLogStore.appendWithVectorClockUpdate).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should skip non-persistent actions', (done) => {
      const action = { type: '[Task] Regular Action' };
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          expect(mockOpLogStore.appendWithVectorClockUpdate).not.toHaveBeenCalled();
          done();
        },
      });
    });

    // NOTE: Tests for isApplyingRemoteOps filtering were removed because that behavior
    // was intentionally changed. The effect no longer filters by isApplyingRemoteOps()
    // due to a race condition (see comment in operation-log.effects.ts).
    // Sync timing is now handled by the meta-reducer buffering mechanism.

    it('should acquire lock before writing operation', (done) => {
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          expect(mockLockService.request).toHaveBeenCalledWith(
            'sp_op_log',
            jasmine.any(Function),
          );
          done();
        },
      });
    });

    it('should load clientId only after acquiring operation log lock', (done) => {
      const callOrder: string[] = [];
      mockLockService.request.and.callFake(
        async <T>(_name: string, fn: () => Promise<T>) => {
          callOrder.push('lock');
          return fn();
        },
      );
      mockClientIdService.getOrGenerateClientId.and.callFake(async () => {
        callOrder.push('clientId');
        return 'testClient';
      });
      mockOpLogStore.appendWithVectorClockUpdate.and.callFake(async () => {
        callOrder.push('append');
        return 1;
      });

      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          expect(callOrder).toEqual(['lock', 'clientId', 'append']);
          done();
        },
      });
    });

    it('should capture the post-rotation clientId when a destructive replacement rotates it while this op is queued (#7709)', (done) => {
      // Simulates the race the fix at operation-log.effects.ts closes: a
      // clean-slate / backup-import is already holding the operation-log lock
      // and rotates the clientId inside runDestructiveStateReplacement. A
      // queued op waiting behind that lock must read the rotated id, not the
      // pre-rotation id captured before lock acquisition.
      let persistedClientId = 'oldClient';

      mockLockService.request.and.callFake(
        async <T>(_name: string, fn: () => Promise<T>) => {
          // The destructive replacement that we're racing has already mutated
          // ClientIdService's persisted state by the time we acquire the lock.
          persistedClientId = 'newClient';
          return fn();
        },
      );
      mockClientIdService.getOrGenerateClientId.and.callFake(
        async () => persistedClientId,
      );

      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledWith(
            jasmine.objectContaining({ clientId: 'newClient' }),
            'local',
          );
          // Negative assertion: if clientId were read before lock acquisition,
          // we'd see 'oldClient'. The fix prevents that.
          expect(mockOpLogStore.appendWithVectorClockUpdate).not.toHaveBeenCalledWith(
            jasmine.objectContaining({ clientId: 'oldClient' }),
            jasmine.anything(),
          );
          done();
        },
      });
    });

    it('should increment vector clock', (done) => {
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          expect(mockVectorClockService.getCurrentVectorClock).toHaveBeenCalled();
          const appendCall =
            mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent();
          const operation = appendCall.args[0];
          expect(operation.vectorClock['testClient']).toBe(6); // Incremented from 5
          done();
        },
      });
    });

    // Note: Tests for incrementVectorClockForLocalChange have been removed.
    // Vector clock updates are now handled atomically within appendWithVectorClockUpdate.

    it('should trigger compaction when threshold reached', fakeAsync(() => {
      // Counter starts at threshold - 1, after increment it reaches threshold
      mockOpLogStore.getCompactionCounter.and.returnValue(
        Promise.resolve(COMPACTION_THRESHOLD - 1),
      );
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe();

      tick(100);
      expect(mockCompactionService.compact).toHaveBeenCalled();
    }));

    it('should not trigger compaction when below threshold', (done) => {
      // Counter starts at threshold - 2, after increment it's still below threshold
      mockOpLogStore.getCompactionCounter.and.returnValue(
        Promise.resolve(COMPACTION_THRESHOLD - 2),
      );
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          expect(mockCompactionService.compact).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should include payload from action', (done) => {
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE, false, {
        title: 'Updated Title',
        done: true,
      });
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          const appendCall =
            mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent();
          const operation = appendCall.args[0];
          // Payload now uses MultiEntityPayload structure with actionPayload and entityChanges
          expect(operation.payload).toEqual({
            actionPayload: { title: 'Updated Title', done: true },
            entityChanges: jasmine.any(Array),
          });
          done();
        },
      });
    });

    it('should persist sync updates that only change local schedule settings for local replay', (done) => {
      const action = updateGlobalConfigSection({
        sectionKey: 'sync',
        sectionCfg: {
          syncInterval: 300000,
          isManualSyncOnly: true,
        },
      });
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          expect(mockOperationCaptureService.extractEntityChanges).toHaveBeenCalled();
          expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledWith(
            jasmine.objectContaining({
              actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
              payload: {
                actionPayload: {
                  sectionKey: 'sync',
                  sectionCfg: {
                    syncInterval: 300000,
                    isManualSyncOnly: true,
                  },
                },
                entityChanges: [],
              },
            }),
            'local',
          );
          expect(mockImmediateUploadService.trigger).toHaveBeenCalled();
          done();
        },
      });
    });

    it('should keep local schedule settings in persisted sync updates', (done) => {
      const action = updateGlobalConfigSection({
        sectionKey: 'sync',
        sectionCfg: {
          syncInterval: 300000,
          isManualSyncOnly: true,
          isCompressionEnabled: true,
        },
      });
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          const operation =
            mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent().args[0];

          expect(operation.actionType).toBe(ActionType.GLOBAL_CONFIG_UPDATE_SECTION);
          expect(operation.payload).toEqual({
            actionPayload: {
              sectionKey: 'sync',
              sectionCfg: {
                syncInterval: 300000,
                isManualSyncOnly: true,
                isCompressionEnabled: true,
              },
            },
            entityChanges: [],
          });
          done();
        },
      });
    });

    it('should persist planTasksForToday replay date fields in actionPayload', (done) => {
      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task-1'],
        today: '2024-06-14',
        startOfNextDayDiffMs: 4 * 60 * 60 * 1000,
      });
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          const operation =
            mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent().args[0];

          expect(operation.actionType).toBe(ActionType.TASK_SHARED_PLAN_FOR_TODAY);
          expect(operation.payload).toEqual({
            actionPayload: {
              taskIds: ['task-1'],
              today: '2024-06-14',
              startOfNextDayDiffMs: 4 * 60 * 60 * 1000,
            },
            entityChanges: [],
          });
          done();
        },
      });
    });

    it('should persist doneOn but not rewrite dueDay for done task updates', (done) => {
      const now = new Date(2024, 5, 15, 2, 0, 0, 0);
      jasmine.clock().install();
      jasmine.clock().mockDate(now);

      const action = TaskSharedActions.updateTask({
        task: { id: 'task-1', changes: { isDone: true } },
      });
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          try {
            const operation =
              mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent().args[0];

            expect(operation.timestamp).toBe(now.getTime());
            expect(operation.payload).toEqual({
              actionPayload: {
                task: {
                  id: 'task-1',
                  changes: {
                    isDone: true,
                    doneOn: now.getTime(),
                  },
                },
              },
              entityChanges: [],
            });
            done();
          } finally {
            jasmine.clock().uninstall();
          }
        },
        error: (err) => {
          jasmine.clock().uninstall();
          done.fail(err);
        },
      });
    });

    it('should notify user on persistence error', (done) => {
      mockOpLogStore.appendWithVectorClockUpdate.and.rejectWith(
        new Error('Write failed'),
      );
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          expect(mockSnackService.open).toHaveBeenCalledWith(
            jasmine.objectContaining({
              type: 'ERROR',
            }),
          );
          done();
        },
      });
    });

    it('should handle quota exceeded error with emergency compaction and retry', fakeAsync(() => {
      const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
      // First call fails with quota error, second call (retry) succeeds
      let callCount = 0;
      mockOpLogStore.appendWithVectorClockUpdate.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(quotaError);
        }
        return Promise.resolve(1);
      });
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe();

      tick(100);
      expect(mockCompactionService.emergencyCompact).toHaveBeenCalled();
      // Should have tried to append twice (initial + retry after compaction)
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(2);
    }));

    it('re-extracts the SAME action on the quota-exceeded retry, never a second op (#8307)', fakeAsync(() => {
      // Regression (#8307, now structural): the positional dequeue is gone.
      // entityChanges is recomputed by the pure, idempotent extractEntityChanges()
      // on every write, so the quota retry re-extracts THIS action's changes and
      // can never steal the next pending action's entry the way the old
      // double-dequeue did.
      const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
      let appendCount = 0;
      mockOpLogStore.appendWithVectorClockUpdate.and.callFake(() => {
        appendCount++;
        if (appendCount === 1) {
          return Promise.reject(quotaError);
        }
        return Promise.resolve(1);
      });

      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe();

      tick(100);
      // Append ran twice (initial + retry). Extraction ran once per write and
      // always against the same action — no positional queue to mis-consume.
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(2);
      expect(mockOperationCaptureService.extractEntityChanges).toHaveBeenCalledTimes(2);
      expect(mockOperationCaptureService.extractEntityChanges).toHaveBeenCalledWith(
        action,
      );
    }));

    it('should use updated clientId after backup import generates new one', (done) => {
      const action1 = createPersistentAction(ActionType.TASK_SHARED_ADD);
      const action2 = createPersistentAction(ActionType.TASK_SHARED_UPDATE);

      // First operation uses original client ID
      actions$ = of(action1);
      effects.persistOperation$.subscribe({
        complete: () => {
          const firstOp =
            mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent().args[0];
          expect(firstOp.clientId).toBe('testClient');

          // Simulate a backup import rotating the client ID (BackupService's
          // destructive replacement persists a fresh id; the next read of
          // getOrGenerateClientId() picks it up after the cache is cleared).
          mockClientIdService.getOrGenerateClientId.and.returnValue(
            Promise.resolve('newImportClient'),
          );

          // Second operation should pick up the new client ID
          actions$ = of(action2);
          effects.persistOperation$.subscribe({
            complete: () => {
              const secondOp =
                mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent().args[0];
              expect(secondOp.clientId).toBe('newImportClient');
              done();
            },
          });
        },
      });
    });

    it('should show error when retry after emergency compaction fails with quota error', fakeAsync(() => {
      const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
      // All attempts fail with quota error (nested quota failure)
      mockOpLogStore.appendWithVectorClockUpdate.and.returnValue(
        Promise.reject(quotaError),
      );
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe();

      tick(100);
      // Emergency compaction should be attempted
      expect(mockCompactionService.emergencyCompact).toHaveBeenCalled();
      // User should be notified of quota exceeded
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
        }),
      );
    }));

    it('should abort immediately when quota error during retry (circuit breaker)', fakeAsync(() => {
      const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
      // First call fails with quota, emergency compaction succeeds, retry also fails with quota
      mockOpLogStore.appendWithVectorClockUpdate.and.callFake(() => {
        return Promise.reject(quotaError);
      });
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe();

      tick(100);
      // Should have tried twice (initial + one retry after compaction)
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(2);
      // Should not trigger recursive compaction
      expect(mockCompactionService.emergencyCompact).toHaveBeenCalledTimes(1);
      // User should see error snackbar
      expect(mockSnackService.open).toHaveBeenCalled();
    }));

    it('should show error when emergency compaction itself fails', fakeAsync(() => {
      const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
      mockOpLogStore.appendWithVectorClockUpdate.and.returnValue(
        Promise.reject(quotaError),
      );
      // Emergency compaction fails
      mockCompactionService.emergencyCompact.and.returnValue(Promise.resolve(false));
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe();

      tick(100);
      expect(mockCompactionService.emergencyCompact).toHaveBeenCalled();
      // No retry after failed compaction
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(1);
      // User should be notified
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
        }),
      );
    }));

    it('should handle Firefox-style quota error name', fakeAsync(() => {
      const firefoxQuotaError = new DOMException(
        'Quota exceeded',
        'NS_ERROR_DOM_QUOTA_REACHED',
      );
      let callCount = 0;
      mockOpLogStore.appendWithVectorClockUpdate.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(firefoxQuotaError);
        }
        return Promise.resolve(1);
      });
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe();

      tick(100);
      // Should recognize Firefox quota error and trigger compaction
      expect(mockCompactionService.emergencyCompact).toHaveBeenCalled();
    }));

    it('should handle legacy Safari quota error code', fakeAsync(() => {
      // Create a mock error object that simulates legacy Safari's quota error
      // DOMException.code is read-only, so we create a custom error object
      const safariQuotaError = Object.create(DOMException.prototype, {
        name: { value: 'UnknownError', enumerable: true },
        message: { value: 'Quota exceeded', enumerable: true },
        code: { value: 22, enumerable: true },
      }) as DOMException;

      let callCount = 0;
      mockOpLogStore.appendWithVectorClockUpdate.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(safariQuotaError);
        }
        return Promise.resolve(1);
      });
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe();

      tick(100);
      // Should recognize Safari quota error and trigger compaction
      expect(mockCompactionService.emergencyCompact).toHaveBeenCalled();
    }));

    it('should not treat regular DOMException as quota error', fakeAsync(() => {
      const regularError = new DOMException('Read failed', 'NotReadableError');
      mockOpLogStore.appendWithVectorClockUpdate.and.returnValue(
        Promise.reject(regularError),
      );
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe();

      tick(100);
      // Should NOT trigger emergency compaction for non-quota errors
      expect(mockCompactionService.emergencyCompact).not.toHaveBeenCalled();
      // Should still show error snackbar
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
        }),
      );
    }));

    it('should show success message after recovery from quota exceeded', fakeAsync(() => {
      const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
      let callCount = 0;
      mockOpLogStore.appendWithVectorClockUpdate.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(quotaError);
        }
        return Promise.resolve(1);
      });
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe();

      tick(100);
      // Should show success message after recovery
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'SUCCESS',
        }),
      );
    }));
  });

  describe('compaction failures', () => {
    it('should track compaction failures', (done) => {
      // Counter starts at threshold - 1, after increment it reaches threshold
      mockOpLogStore.getCompactionCounter.and.returnValue(
        Promise.resolve(COMPACTION_THRESHOLD - 1),
      );
      mockCompactionService.compact.and.returnValue(Promise.reject(new Error('Failed')));

      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe({
        complete: () => {
          // Wait for async compaction to be triggered - devError throws so we need async check
          setTimeout(() => {
            expect(mockCompactionService.compact).toHaveBeenCalled();
            done();
          }, 50);
        },
      });
    });

    it('should reset failure count on successful compaction', fakeAsync(() => {
      // Counter starts at threshold - 1, after increment it reaches threshold
      mockOpLogStore.getCompactionCounter.and.returnValue(
        Promise.resolve(COMPACTION_THRESHOLD - 1),
      );
      mockCompactionService.compact.and.returnValue(Promise.resolve());

      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      actions$ = of(action);

      effects.persistOperation$.subscribe();

      tick(100);
      // No snackbar for successful compaction
      const allCalls = mockSnackService.open.calls.all();
      const errorCalls = allCalls.filter((call) => {
        const arg = call.args[0];
        return (
          typeof arg === 'object' && arg !== null && 'type' in arg && arg.type === 'ERROR'
        );
      });
      expect(errorCalls.length).toBe(0);
    }));
  });

  describe('processDeferredActions', () => {
    /**
     * Tests for processing deferred actions that were buffered during sync.
     * When users interact with the app during sync replay, those actions
     * are buffered by the meta-reducer. This method processes them after
     * sync completes with fresh vector clocks.
     */

    it('should expose deferred action flushing through DeferredLocalActionsPort', async () => {
      const port: DeferredLocalActionsPort = effects;
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      bufferDeferredAction(action);

      await port.processDeferredActions();

      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledWith(
        jasmine.objectContaining({
          actionType: ActionType.TASK_SHARED_UPDATE,
          clientId: 'testClient',
        }),
        'local',
      );
    });

    it('should do nothing when no deferred actions are buffered', async () => {
      await effects.processDeferredActions();

      expect(mockOpLogStore.appendWithVectorClockUpdate).not.toHaveBeenCalled();
    });

    it('should process a single deferred action', async () => {
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      bufferDeferredAction(action);

      await effects.processDeferredActions();

      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledWith(
        jasmine.objectContaining({
          actionType: ActionType.TASK_SHARED_UPDATE,
          clientId: 'testClient',
        }),
        'local',
      );
    });

    it('should process multiple deferred actions in order', async () => {
      const action1 = createPersistentAction(ActionType.TASK_SHARED_ADD);
      const action2 = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      const action3 = createPersistentAction(ActionType.TASK_SHARED_DELETE);

      bufferDeferredAction(action1);
      bufferDeferredAction(action2);
      bufferDeferredAction(action3);

      await effects.processDeferredActions();

      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(3);

      const calls = mockOpLogStore.appendWithVectorClockUpdate.calls.all();
      expect(calls[0].args[0].actionType).toBe(ActionType.TASK_SHARED_ADD);
      expect(calls[1].args[0].actionType).toBe(ActionType.TASK_SHARED_UPDATE);
      expect(calls[2].args[0].actionType).toBe(ActionType.TASK_SHARED_DELETE);
    });

    it('should clear buffer after processing', async () => {
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      bufferDeferredAction(action);

      await effects.processDeferredActions();

      // Call again - should not process anything (buffer cleared)
      mockOpLogStore.appendWithVectorClockUpdate.calls.reset();
      await effects.processDeferredActions();

      expect(mockOpLogStore.appendWithVectorClockUpdate).not.toHaveBeenCalled();
    });

    it('should continue processing remaining actions when one fails', async () => {
      const action1 = createPersistentAction(ActionType.TASK_SHARED_ADD);
      const action2 = createPersistentAction(ActionType.TASK_SHARED_UPDATE);

      bufferDeferredAction(action1);
      bufferDeferredAction(action2);

      // First action fails, second succeeds
      let callCount = 0;
      mockOpLogStore.appendWithVectorClockUpdate.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('First action failed'));
        }
        return Promise.resolve(1);
      });

      // Should not throw - errors are logged but don't stop processing
      await expectAsync(effects.processDeferredActions()).toBeResolved();

      // Both actions should have been attempted
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(2);
    });

    it('should use fresh vector clock for deferred actions', async () => {
      // Set up vector clock to return a specific value
      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ testClient: 100, otherClient: 50 }),
      );

      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      bufferDeferredAction(action);

      await effects.processDeferredActions();

      const appendCall = mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent();
      const operation = appendCall.args[0];

      // Vector clock should be incremented from current value (includes remote ops)
      expect(operation.vectorClock['testClient']).toBe(101);
      expect(operation.vectorClock['otherClient']).toBe(50);
    });

    it('should not acquire nested lock when caller already holds operation log lock', async () => {
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      bufferDeferredAction(action);

      await effects.processDeferredActions({ callerHoldsOperationLogLock: true });

      expect(mockLockService.request).not.toHaveBeenCalled();
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledWith(
        jasmine.objectContaining({
          actionType: ActionType.TASK_SHARED_UPDATE,
          clientId: 'testClient',
        }),
        'local',
      );
    });

    it('should not run emergency compaction while caller already holds operation log lock', async () => {
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      bufferDeferredAction(action);
      mockOpLogStore.appendWithVectorClockUpdate.and.rejectWith(
        new DOMException('Quota exceeded', 'QuotaExceededError'),
      );

      await effects.processDeferredActions({ callerHoldsOperationLogLock: true });

      expect(mockCompactionService.emergencyCompact).not.toHaveBeenCalled();
      expect(mockLockService.request).not.toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
      expect(mockLockService.request).toHaveBeenCalledWith(
        'sp_quota_exceeded',
        jasmine.any(Function),
      );
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.STORAGE_QUOTA_EXCEEDED,
        }),
      );
    });

    // #7700: when callerHoldsOperationLogLock=true and quota fires, the
    // bail path skips emergency compaction (would deadlock against the
    // held sp_op_log) BUT must NOT silently treat the failed write as
    // a success — pre-this-commit, handleQuotaExceeded returned without
    // throwing, the retry loop saw success=true, and the deferred action
    // vanished. Now it throws so the retry loop surfaces the failure as
    // DEFERRED_ACTION_FAILED after retries exhaust.
    it('should surface DEFERRED_ACTION_FAILED when quota fires under caller-holds-lock', async () => {
      const action = createPersistentAction(ActionType.TASK_SHARED_UPDATE);
      bufferDeferredAction(action);
      mockOpLogStore.appendWithVectorClockUpdate.and.rejectWith(
        new DOMException('Quota exceeded', 'QuotaExceededError'),
      );

      await effects.processDeferredActions({ callerHoldsOperationLogLock: true });

      // 1. The bail path actually ran (proves handleQuotaExceeded was invoked
      //    AND took the caller-holds-lock branch — not some other code path).
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.STORAGE_QUOTA_EXCEEDED,
        }),
      );
      // 2. Dedupe: even though the retry loop calls handleQuotaExceeded 3
      //    times, STORAGE_QUOTA_EXCEEDED snack must fire ONLY ONCE.
      //    Without the dedupe (lastStorageQuotaSnackAt window) the user
      //    would see 3 identical sticky snacks per quota event.
      const storageQuotaSnackCalls = mockSnackService.open.calls
        .allArgs()
        .filter(
          ([arg]) => (arg as { msg?: string })?.msg === T.F.SYNC.S.STORAGE_QUOTA_EXCEEDED,
        );
      expect(storageQuotaSnackCalls.length).toBe(1);
      // 3. The retry loop saw the throw and actually retried — appendWith*
      //    was attempted MAX_RETRIES=3 times, not once. Pre-fix the loop
      //    would have broken on attempt #1 with success=true.
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledTimes(3);
      // 4. DEFERRED_ACTION_FAILED fires ONLY when the retry loop's
      //    failedCount > 0 after all retries — the loud-fail outcome.
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.F.SYNC.S.DEFERRED_ACTION_FAILED,
        }),
      );
    });
  });
});

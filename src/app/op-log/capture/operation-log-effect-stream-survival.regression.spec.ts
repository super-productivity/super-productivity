/**
 * Regression test for issue #8306.
 *
 * Pre-fix bug: a single `LockAcquisitionTimeoutError` during op capture errored
 * the whole `persistOperation$` effect stream. Because the inner `writeOperation`
 * rethrew straight into `concatMap`:
 *   1. concatMap tore down — every action buffered behind the failed one was
 *      silently dropped (no op written, no snackbar for them);
 *   2. the positional capture queue leaked the failed action's entry, so
 *      `flushPendingWrites()` could never reach 0 and every subsequent sync
 *      failed after its 30s timeout (permanent wedge);
 *   3. after NgRx's default 10 resubscribes the effect died silently until the
 *      app was reloaded.
 *
 * Fix (this PR, bundled with #8318):
 *   - the effect wraps each write in `writeOperationFromEffect`, which catches so
 *     one failed write can never tear down the shared stream;
 *   - the FIFO queue is replaced by a pending counter decremented in a `finally`,
 *     so a thrown write can never leak the flush signal.
 *
 * These tests drive the REAL `persistOperation$` effect and the REAL
 * `OperationCaptureService` counter; only the LockService is mocked so a write
 * can be forced to time out deterministically.
 */
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, Store } from '@ngrx/store';
import { ReplaySubject } from 'rxjs';
import { OperationLogEffects } from './operation-log.effects';
import { OperationCaptureService } from './operation-capture.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { LockService } from '../sync/lock.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { SnackService } from '../../core/snack/snack.service';
import { ImmediateUploadService } from '../sync/immediate-upload.service';
import { ActionType, OpType, Operation } from '../core/operation.types';
import { PersistentAction } from '../core/persistent-action.interface';
import { ClientIdService } from '../../core/util/client-id.service';
import { SuperSyncStatusService } from '../sync/super-sync-status.service';
import { LockAcquisitionTimeoutError } from '../core/errors/sync-errors';
import { LOCK_NAMES } from '../core/operation-log.const';
import { T } from '../../t.const';

describe('regression #8306: persistOperation$ stream survives write failures', () => {
  let effects: OperationLogEffects;
  let captureService: OperationCaptureService;
  let lockRequest: jasmine.Spy;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;
  let snackSpy: jasmine.SpyObj<SnackService>;
  let actions$: ReplaySubject<Action>;

  const createAction = (entityId: string): PersistentAction => ({
    type: ActionType.TASK_SHARED_UPDATE,
    meta: {
      isPersistent: true,
      isRemote: false,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId,
    },
  });

  /** Simulate the meta-reducer (increment) + dispatch (effect path). */
  const dispatch = (action: PersistentAction): void => {
    captureService.incrementPending(action);
    actions$.next(action);
  };

  const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('waitFor timed out');
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  beforeEach(() => {
    actions$ = new ReplaySubject<Action>(1);

    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'appendWithVectorClockOverwrite',
      'getCompactionCounter',
      'clearVectorClockCache',
    ]);
    opLogStoreSpy.appendWithVectorClockOverwrite.and.resolveTo(1);
    opLogStoreSpy.getCompactionCounter.and.resolveTo(0);

    const vectorClockSpy = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    vectorClockSpy.getCurrentVectorClock.and.resolveTo({ testClient: 5 });

    const compactionSpy = jasmine.createSpyObj('OperationLogCompactionService', [
      'compact',
      'emergencyCompact',
    ]);
    compactionSpy.compact.and.resolveTo();
    compactionSpy.emergencyCompact.and.resolveTo(true);

    snackSpy = jasmine.createSpyObj('SnackService', ['open']);

    const storeSpy = jasmine.createSpyObj('Store', ['dispatch', 'select']);

    const immediateUploadSpy = jasmine.createSpyObj('ImmediateUploadService', [
      'trigger',
    ]);
    const clientIdSpy = jasmine.createSpyObj('ClientIdService', [
      'getOrGenerateClientId',
    ]);
    clientIdSpy.getOrGenerateClientId.and.resolveTo('testClient');

    const lockServiceSpy = jasmine.createSpyObj('LockService', ['request']);
    lockRequest = lockServiceSpy.request;
    // Default: lock granted — run the callback.
    lockRequest.and.callFake(async <U>(_name: string, cb: () => Promise<U>) => cb());

    const superSyncStatusSpy = jasmine.createSpyObj('SuperSyncStatusService', [
      'updatePendingOpsStatus',
    ]);

    TestBed.configureTestingModule({
      providers: [
        OperationLogEffects,
        provideMockActions(() => actions$),
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        { provide: LockService, useValue: lockServiceSpy },
        { provide: VectorClockService, useValue: vectorClockSpy },
        { provide: OperationLogCompactionService, useValue: compactionSpy },
        { provide: SnackService, useValue: snackSpy },
        { provide: Store, useValue: storeSpy },
        { provide: ImmediateUploadService, useValue: immediateUploadSpy },
        { provide: ClientIdService, useValue: clientIdSpy },
        { provide: SuperSyncStatusService, useValue: superSyncStatusSpy },
        // REAL capture service — we assert its pending counter directly.
      ],
    });

    effects = TestBed.inject(OperationLogEffects);
    captureService = TestBed.inject(OperationCaptureService);
    captureService.clear();
  });

  afterEach(() => captureService.clear());

  /**
   * Defect #1 + #3: one failed write must not tear down the stream — later
   * actions still persist, and the effect never resubscribes/dies.
   */
  it('keeps persisting later actions after a lock-timeout failure', async () => {
    // First OPERATION_LOG request times out; all later ones succeed.
    let opLogRequests = 0;
    lockRequest.and.callFake(async <U>(name: string, cb: () => Promise<U>) => {
      if (name === LOCK_NAMES.OPERATION_LOG) {
        opLogRequests++;
        if (opLogRequests === 1) {
          throw new LockAcquisitionTimeoutError(name, 1000);
        }
      }
      return cb();
    });

    let streamErrored = false;
    const sub = effects.persistOperation$.subscribe({
      error: () => (streamErrored = true),
    });

    dispatch(createAction('task-fail'));
    dispatch(createAction('task-ok'));

    // Both processed once the counter drains back to 0.
    await waitFor(() => captureService.getPendingCount() === 0);

    // The stream survived the first failure...
    expect(streamErrored).toBe(false);
    // ...the failed action was NOT written, the later one WAS.
    expect(opLogStoreSpy.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(1);
    const writtenOp = opLogStoreSpy.appendWithVectorClockOverwrite.calls.mostRecent()
      .args[0] as Operation;
    expect(writtenOp.entityId).toBe('task-ok');
    // The user was told the failed write needs a reload.
    expect(snackSpy.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: 'ERROR', msg: T.F.SYNC.S.PERSIST_FAILED }),
    );

    sub.unsubscribe();
  });

  /**
   * Defect #2: a thrown write must not leak the pending counter, otherwise
   * flushPendingWrites() wedges forever. The `finally` decrement guarantees the
   * counter returns to 0 even when every write times out.
   */
  it('drains the pending counter even when the write always times out', async () => {
    lockRequest.and.callFake(async <U>(name: string, _cb: () => Promise<U>) => {
      if (name === LOCK_NAMES.OPERATION_LOG) {
        throw new LockAcquisitionTimeoutError(name, 1000);
      }
      return _cb();
    });

    const sub = effects.persistOperation$.subscribe();

    dispatch(createAction('task-1'));
    dispatch(createAction('task-2'));
    dispatch(createAction('task-3'));

    // Despite every write throwing, the counter must reach 0 (no leak).
    await waitFor(() => captureService.getPendingCount() === 0);

    expect(captureService.getPendingCount()).toBe(0);
    expect(opLogStoreSpy.appendWithVectorClockOverwrite).not.toHaveBeenCalled();

    sub.unsubscribe();
  });

  /**
   * Defect #3 explicitly: more than NgRx's default 10 consecutive write errors
   * must not kill the effect. Pre-fix, the 11th error exceeded the resubscribe
   * limit and persistOperation$ died silently; a write dispatched afterwards
   * was never persisted. With the per-write catch the stream never errors, so a
   * write after 11 failures still lands.
   */
  it('survives more than 10 consecutive failures (effect does not die)', async () => {
    const FAILURES = 11;
    let opLogRequests = 0;
    lockRequest.and.callFake(async <U>(name: string, cb: () => Promise<U>) => {
      if (name === LOCK_NAMES.OPERATION_LOG) {
        opLogRequests++;
        if (opLogRequests <= FAILURES) {
          throw new LockAcquisitionTimeoutError(name, 1000);
        }
      }
      return cb();
    });

    let streamErrored = false;
    const sub = effects.persistOperation$.subscribe({
      error: () => (streamErrored = true),
    });

    for (let i = 0; i < FAILURES; i++) {
      dispatch(createAction(`fail-${i}`));
    }
    dispatch(createAction('survivor'));

    await waitFor(() => captureService.getPendingCount() === 0);

    expect(streamErrored).toBe(false);
    expect(opLogStoreSpy.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(1);
    const writtenOp = opLogStoreSpy.appendWithVectorClockOverwrite.calls.mostRecent()
      .args[0] as Operation;
    expect(writtenOp.entityId).toBe('survivor');

    sub.unsubscribe();
  });
});

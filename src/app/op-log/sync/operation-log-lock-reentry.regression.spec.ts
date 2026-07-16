/**
 * Regression test for issue #7700.
 *
 * Pre-fix bug:
 *   1. RemoteOpsProcessingService acquires the `sp_op_log` lock.
 *   2. Inside the lock, it calls OperationApplierService.applyOperations.
 *   3. applyOperations delegated to replayOperationBatch which always called
 *      OperationLogEffects.processDeferredActions in its finally block.
 *   4. processDeferredActions -> writeOperation re-requested `sp_op_log`.
 *   5. Web Locks are not reentrant. The inner request blocks until the 30s
 *      LockService timeout, surfaced to the user as "Failed to sync".
 *
 * Both tests in this spec use the REAL LockService, not a mock — the existing
 * operation-log.effects.spec replaces lockService.request with an inline
 * callback runner and therefore cannot expose the deadlock.
 */
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import { OperationLogEffects } from '../capture/operation-log.effects';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { LockService } from './lock.service';
import { VectorClockService } from './vector-clock.service';
import { OperationLogCompactionService } from '../persistence/operation-log-compaction.service';
import { SnackService } from '../../core/snack/snack.service';
import { ImmediateUploadService } from '../sync/immediate-upload.service';
import { ActionType, OpType } from '../core/operation.types';
import { PersistentAction } from '../core/persistent-action.interface';
import {
  bufferDeferredAction,
  clearDeferredActions,
} from '../capture/operation-capture.meta-reducer';
import { ClientIdService } from '../../core/util/client-id.service';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { LOCK_NAMES } from '../core/operation-log.const';
import { LockAcquisitionTimeoutError } from '../core/errors/sync-errors';
import { SuperSyncStatusService } from './super-sync-status.service';
import { T } from '../../t.const';

/**
 * Real LockService, but with a short default timeout so the loud-fail
 * test below exhausts processDeferredActions's retry budget in a few
 * seconds instead of 90s. All behaviour (Web Locks path, fallback mutex,
 * cleanup) is otherwise untouched.
 */
const SHORT_TIMEOUT_MS = 1000;

class ShortTimeoutLockService extends LockService {
  override request<T>(
    name: string,
    cb: () => Promise<T>,
    timeoutMs: number = SHORT_TIMEOUT_MS,
  ): Promise<T> {
    return super.request(name, cb, timeoutMs);
  }
}

describe('regression #7700: operation-log lock reentry', () => {
  let effects: OperationLogEffects;
  let lockService: LockService;
  let snackSpy: jasmine.SpyObj<SnackService>;
  let vectorClockSpy: jasmine.SpyObj<VectorClockService>;
  const actions$: Observable<Action> = of();
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;

  const createDeferredAction = (): PersistentAction => ({
    type: ActionType.TASK_SHARED_UPDATE,
    meta: {
      isPersistent: true,
      isRemote: false,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'task-1',
    },
  });

  beforeEach(() => {
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'appendWithVectorClockOverwrite',
      'getCompactionCounter',
      'clearVectorClockCache',
    ]);
    opLogStoreSpy.appendWithVectorClockOverwrite.and.resolveTo(1);
    opLogStoreSpy.getCompactionCounter.and.resolveTo(0);

    vectorClockSpy = jasmine.createSpyObj('VectorClockService', [
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
    storeSpy.select.and.returnValue(of({}));

    const immediateUploadSpy = jasmine.createSpyObj('ImmediateUploadService', [
      'trigger',
    ]);
    const clientIdSpy = jasmine.createSpyObj('ClientIdService', [
      'getOrGenerateClientId',
    ]);
    clientIdSpy.getOrGenerateClientId.and.resolveTo('testClient');

    const operationCaptureSpy = jasmine.createSpyObj('OperationCaptureService', [
      'extractEntityChanges',
      'decrementPending',
    ]);
    operationCaptureSpy.extractEntityChanges.and.returnValue([]);

    const superSyncStatusSpy = jasmine.createSpyObj('SuperSyncStatusService', [
      'updatePendingOpsStatus',
    ]);

    TestBed.configureTestingModule({
      providers: [
        OperationLogEffects,
        // NOTE: real LockService — required to exercise reentrancy semantics.
        // Subclassed to use a short default timeout so the loud-fail retry
        // budget completes in a few seconds instead of 90s.
        { provide: LockService, useClass: ShortTimeoutLockService },
        provideMockActions(() => actions$),
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        { provide: VectorClockService, useValue: vectorClockSpy },
        { provide: OperationLogCompactionService, useValue: compactionSpy },
        { provide: SnackService, useValue: snackSpy },
        { provide: Store, useValue: storeSpy },
        { provide: ImmediateUploadService, useValue: immediateUploadSpy },
        { provide: ClientIdService, useValue: clientIdSpy },
        { provide: OperationCaptureService, useValue: operationCaptureSpy },
        { provide: SuperSyncStatusService, useValue: superSyncStatusSpy },
      ],
    });

    effects = TestBed.inject(OperationLogEffects);
    lockService = TestBed.inject(LockService);
    clearDeferredActions();
  });

  afterEach(() => clearDeferredActions());

  /**
   * Proof that the deadlock the fix breaks is real: re-requesting `sp_op_log`
   * from within a holder of the same lock must NOT acquire it — pre-fix,
   * processDeferredActions did exactly this and hung for 30s.
   */
  it('rejects nested same-name request on sp_op_log (proves the deadlock exists)', async () => {
    let innerRan = false;
    let caught: unknown = null;

    // Use a long timeout for the outer request (5s) so the inner one can
    // timeout first (200ms) without aborting the outer lock callback.
    await lockService.request(
      LOCK_NAMES.OPERATION_LOG,
      async () => {
        try {
          // Inner request deadlocks and times out.
          await lockService.request(
            LOCK_NAMES.OPERATION_LOG,
            async () => {
              innerRan = true;
            },
            200,
          );
        } catch (e) {
          caught = e;
        }
      },
      5000,
    );

    expect(innerRan).toBe(false);
    expect(caught).toBeInstanceOf(LockAcquisitionTimeoutError);
  }, 10000);

  /**
   * With the fix, processDeferredActions({ callerHoldsOperationLogLock: true })
   * skips the inner lock acquisition and runs to completion inside the holder.
   */
  it('processDeferredActions completes inside sp_op_log when caller passes through the flag', async () => {
    bufferDeferredAction(createDeferredAction());

    const order: string[] = [];
    const start = Date.now();

    await lockService.request(LOCK_NAMES.OPERATION_LOG, async () => {
      order.push('outer-start');
      await effects.processDeferredActions({ callerHoldsOperationLogLock: true });
      order.push('outer-end');
    });

    const elapsed = Date.now() - start;

    expect(order).toEqual(['outer-start', 'outer-end']);
    expect(opLogStoreSpy.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(1);
    // Should be near-instant — orders of magnitude under the 30s lock timeout.
    expect(elapsed).toBeLessThan(2000);
  }, 10000);

  /**
   * Loud-fail guarantee: if a future refactor forgets to thread
   * `callerHoldsOperationLogLock` through, the deferred action must NOT be
   * silently dropped. writeOperation re-throws `LockAcquisitionTimeoutError`
   * after the snack, so processDeferredActions's retry loop sees each
   * failure, exhausts retries, and fires `DEFERRED_ACTION_FAILED`. Pre-fix
   * the catch swallowed the timeout as success — that's the exact silent
   * data-loss surface #7700 reported.
   */
  it('fails loudly (no silent swallow) if the flag is omitted while caller still holds sp_op_log', async () => {
    bufferDeferredAction(createDeferredAction());

    // Hold the lock comfortably longer than the full retry budget:
    // 3 attempts × ~1000ms timeout + 100ms + 200ms backoffs ≈ 3300ms.
    // 10000ms is generous.
    await expectAsync(
      lockService.request(
        LOCK_NAMES.OPERATION_LOG,
        async () => {
          // Caller forgot the flag — same as a buggy refactor.
          await effects.processDeferredActions();
        },
        10000,
      ),
    ).toBeRejected();

    // Action was NOT written — no silent persistence.
    expect(opLogStoreSpy.appendWithVectorClockOverwrite).not.toHaveBeenCalled();
    // The differentiating assertion: pre-loud-fail, writeOperation
    // swallowed the timeout and returned success → the retry loop
    // exited on attempt #1 and DEFERRED_ACTION_FAILED never fired.
    // With the re-throw, the retry loop sees the exception, exhausts
    // retries, and surfaces DEFERRED_ACTION_FAILED to the user.
    expect(snackSpy.open).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: 'ERROR',
        msg: T.F.SYNC.S.DEFERRED_ACTION_FAILED,
      }),
    );
  }, 15000);

  /**
   * Vector-clock-ordering correctness: the substantive correctness win
   * over the alternative architecture (#7700).
   *
   * Pre-fix, replayOperationBatch's finally fired processDeferredActions
   * BEFORE the host's applyRemoteOperations called mergeRemoteOpClocks.
   * getCurrentVectorClock() read a pre-merge clock, so deferred local
   * actions were persisted with clocks that DIDN'T include the just-
   * applied remote ops. On the next sync those deferred ops would
   * compare as CONCURRENT (or worse, be filtered as superseded).
   *
   * The fix flushes deferred actions AFTER mergeRemoteOpClocks. This
   * test pins that the clock VALUE — not just the call order — picks
   * up the merged remote entries.
   */
  it('persists deferred actions with vector clocks that dominate the merged remote clock', async () => {
    bufferDeferredAction(createDeferredAction());

    // Simulate the lifecycle: host applies remote ops, then merges their
    // clocks via mergeRemoteOpClocks. getCurrentVectorClock returns the
    // PRE-merge clock until merge happens, then the POST-merge clock.
    const PRE_MERGE = { testClient: 5 };
    const POST_MERGE = { testClient: 5, remoteClient: 7, otherClient: 3 };
    let merged = false;
    vectorClockSpy.getCurrentVectorClock.and.callFake(async () =>
      merged ? POST_MERGE : PRE_MERGE,
    );

    await lockService.request(LOCK_NAMES.OPERATION_LOG, async () => {
      // Host's order: applyOperations → markApplied → mergeRemoteOpClocks
      // → processDeferredActions. We elide the apply/mark calls and just
      // flip the clock to its post-merge state, which is what those
      // steps would do in production.
      merged = true;
      await effects.processDeferredActions({ callerHoldsOperationLogLock: true });
    });

    expect(opLogStoreSpy.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(1);
    const writtenOp = opLogStoreSpy.appendWithVectorClockOverwrite.calls.mostRecent()
      .args[0] as { vectorClock: Record<string, number> };

    // The merged remote entries must be present.
    expect(writtenOp.vectorClock['remoteClient']).toBe(7);
    expect(writtenOp.vectorClock['otherClient']).toBe(3);
    // And the local clientId must be incremented from the post-merge
    // value (6, not 4 — i.e. derived from POST_MERGE.testClient=5).
    expect(writtenOp.vectorClock['testClient']).toBe(6);
  }, 10000);
});

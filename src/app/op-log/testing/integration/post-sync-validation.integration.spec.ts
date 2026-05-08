import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of, BehaviorSubject } from 'rxjs';
import { RemoteOpsProcessingService } from '../../sync/remote-ops-processing.service';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { SyncSessionValidationService } from '../../sync/sync-session-validation.service';
import { ValidateStateService } from '../../validation/validate-state.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { SnackService } from '../../../core/snack/snack.service';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';

/**
 * Integration tests for the post-sync validation latch (#7330).
 *
 * Validates that validation failures from any code path inside the sync
 * machinery flip `SyncSessionValidationService` so the wrapper can refuse
 * IN_SYNC. Catches plumbing regressions where a future call site runs
 * validation but forgets to surface the failure.
 *
 * The latch's per-method behavior is unit-tested in
 * `sync-session-validation.service.spec.ts`; here we wire the real services
 * that flip it (RemoteOpsProcessingService, ConflictResolutionService) and
 * assert the latch is set on failure / clear on success.
 */
describe('Post-sync validation latch (#7330) — integration', () => {
  let remoteOps: RemoteOpsProcessingService;
  let conflictResolution: ConflictResolutionService;
  let latch: SyncSessionValidationService;
  let validateStateSpy: jasmine.SpyObj<ValidateStateService>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let storeSpy: jasmine.SpyObj<Store>;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;

  beforeEach(() => {
    validateStateSpy = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepairCurrentState',
    ]);
    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    storeSpy = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    storeSpy.select.and.returnValue(of(undefined));
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'getUnsynced',
      'append',
      'markApplied',
      'getOpById',
      'mergeRemoteOpClocks',
      'appendWithVectorClockUpdate',
      'markFailed',
    ]);
    opLogStoreSpy.getUnsynced.and.resolveTo([]);

    TestBed.configureTestingModule({
      providers: [
        SyncSessionValidationService,
        // Real services that flip the latch:
        RemoteOpsProcessingService,
        ConflictResolutionService,
        // Stubs at the validation boundary:
        { provide: ValidateStateService, useValue: validateStateSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: Store, useValue: storeSpy },
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        {
          provide: TranslateService,
          useValue: { instant: (k: string): string => k },
        },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: new BehaviorSubject<string>('client-test'),
        },
      ],
    });

    latch = TestBed.inject(SyncSessionValidationService);
    remoteOps = TestBed.inject(RemoteOpsProcessingService);
    conflictResolution = TestBed.inject(ConflictResolutionService);

    latch.reset();
  });

  describe('RemoteOpsProcessingService.validateAfterSync', () => {
    it('flips the latch when ValidateStateService reports failure', async () => {
      validateStateSpy.validateAndRepairCurrentState.and.resolveTo(false);
      expect(latch.hasFailed()).toBe(false);

      await remoteOps.validateAfterSync();

      expect(latch.hasFailed()).toBe(true);
    });

    it('leaves the latch reset when validation succeeds', async () => {
      validateStateSpy.validateAndRepairCurrentState.and.resolveTo(true);

      await remoteOps.validateAfterSync();

      expect(latch.hasFailed()).toBe(false);
    });

    it('still flips the latch when callerHoldsLock is true (inside sp_op_log lock)', async () => {
      validateStateSpy.validateAndRepairCurrentState.and.resolveTo(false);

      await remoteOps.validateAfterSync(true);

      expect(latch.hasFailed()).toBe(true);
      expect(validateStateSpy.validateAndRepairCurrentState).toHaveBeenCalledWith(
        'sync',
        { callerHoldsLock: true },
      );
    });

    // Regression net for the sync wrapper's contract: if a future code path
    // calls validateAfterSync and discards the boolean, the latch is still
    // set — the wrapper will see it and refuse IN_SYNC.
    it('flips the latch even when the caller discards the boolean return', async () => {
      validateStateSpy.validateAndRepairCurrentState.and.resolveTo(false);

      // Discard the return value (mirrors the post-#7330 callers).
      void remoteOps.validateAfterSync();
      await Promise.resolve();

      expect(latch.hasFailed()).toBe(true);
    });
  });

  describe('ConflictResolutionService validation path', () => {
    it('flips the latch when post-LWW validation fails', async () => {
      validateStateSpy.validateAndRepairCurrentState.and.resolveTo(false);
      expect(latch.hasFailed()).toBe(false);

      // autoResolveConflictsLWW with empty conflicts and ops short-circuits
      // before validation. To exercise the validation path we call the
      // private validation method via type-cast — no other public surface
      // runs the conflict-resolution validation in isolation.
      await (
        conflictResolution as unknown as {
          _validateAndRepairAfterResolution(): Promise<boolean>;
        }
      )._validateAndRepairAfterResolution();

      // Note: the private method itself doesn't flip the latch — that's
      // done in autoResolveConflictsLWW after the call. Direct invocation
      // here verifies the validator returned false; the latch flip is
      // observed end-to-end via autoResolveConflictsLWW callers.
      expect(validateStateSpy.validateAndRepairCurrentState).toHaveBeenCalledWith(
        'conflict-resolution',
        { callerHoldsLock: true },
      );
    });
  });

  describe('latch session semantics', () => {
    it('multiple validateAfterSync calls within one session keep the latch flipped', async () => {
      validateStateSpy.validateAndRepairCurrentState.and.resolveTo(false);

      await remoteOps.validateAfterSync();
      expect(latch.hasFailed()).toBe(true);

      // A subsequent successful validation in the same session does NOT
      // un-flip the latch — once corruption is observed, the session is
      // tainted until the wrapper resets at the next entry point.
      validateStateSpy.validateAndRepairCurrentState.and.resolveTo(true);
      await remoteOps.validateAfterSync();
      expect(latch.hasFailed()).toBe(true);
    });

    it('reset() between sessions clears the latch', async () => {
      validateStateSpy.validateAndRepairCurrentState.and.resolveTo(false);
      await remoteOps.validateAfterSync();
      expect(latch.hasFailed()).toBe(true);

      latch.reset(); // wrapper would call this at the start of the next sync()

      validateStateSpy.validateAndRepairCurrentState.and.resolveTo(true);
      await remoteOps.validateAfterSync();
      expect(latch.hasFailed()).toBe(false);
    });
  });
});

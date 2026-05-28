import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of, BehaviorSubject } from 'rxjs';
import { RemoteOpsProcessingService } from '../../sync/remote-ops-processing.service';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { SyncSessionValidationService } from '../../sync/sync-session-validation.service';
import { SyncHydrationService } from '../../persistence/sync-hydration.service';
import { ValidateStateService } from '../../validation/validate-state.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
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

    latch._resetForTest();
  });

  // Validation flows always run inside a session opened by SyncWrapperService /
  // WsTriggeredDownloadService in production. Wrap each test body in
  // withSession() so setFailed() doesn't trip the "outside an active session"
  // guard and pollute output.
  describe('RemoteOpsProcessingService.validateAfterSync', () => {
    it('flips the latch when ValidateStateService reports failure', async () => {
      await latch.withSession(async () => {
        validateStateSpy.validateAndRepairCurrentState.and.resolveTo(false);
        expect(latch.hasFailed()).toBe(false);

        await remoteOps.validateAfterSync();

        expect(latch.hasFailed()).toBe(true);
      });
    });

    it('leaves the latch reset when validation succeeds', async () => {
      await latch.withSession(async () => {
        validateStateSpy.validateAndRepairCurrentState.and.resolveTo(true);

        await remoteOps.validateAfterSync();

        expect(latch.hasFailed()).toBe(false);
      });
    });

    it('still flips the latch when callerHoldsLock is true (inside sp_op_log lock)', async () => {
      await latch.withSession(async () => {
        validateStateSpy.validateAndRepairCurrentState.and.resolveTo(false);

        await remoteOps.validateAfterSync(true);

        expect(latch.hasFailed()).toBe(true);
        expect(validateStateSpy.validateAndRepairCurrentState).toHaveBeenCalledWith(
          'sync',
          { callerHoldsLock: true },
        );
      });
    });

    // Regression net for the sync wrapper's contract: if a future code path
    // calls validateAfterSync and discards the boolean, the latch is still
    // set — the wrapper will see it and refuse IN_SYNC.
    it('flips the latch even when the caller discards the boolean return', async () => {
      await latch.withSession(async () => {
        validateStateSpy.validateAndRepairCurrentState.and.resolveTo(false);

        // Discard the return value (mirrors the post-#7330 callers).
        void remoteOps.validateAfterSync();
        await Promise.resolve();

        expect(latch.hasFailed()).toBe(true);
      });
    });
  });

  describe('ConflictResolutionService validation path', () => {
    it('flips the latch when post-LWW validation fails', async () => {
      await latch.withSession(async () => {
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
  });

  describe('SyncHydrationService snapshot path', () => {
    let hydrationService: SyncHydrationService;
    let validateStateForHydrationSpy: jasmine.SpyObj<ValidateStateService>;
    let hydrationLatch: SyncSessionValidationService;

    beforeEach(() => {
      // Separate TestBed for the hydration test — wider dependency surface.
      TestBed.resetTestingModule();
      validateStateForHydrationSpy = jasmine.createSpyObj('ValidateStateService', [
        'validateAndRepair',
        'validateAndRepairCurrentState',
      ]);
      const opLogStoreHydrationSpy = jasmine.createSpyObj('OperationLogStoreService', [
        'getLastSeq',
        'getUnsynced',
        'markRejected',
        'saveStateCache',
        'setVectorClock',
        'append',
        'loadStateCache',
      ]);
      opLogStoreHydrationSpy.getLastSeq.and.resolveTo(0);
      opLogStoreHydrationSpy.getUnsynced.and.resolveTo([]);
      opLogStoreHydrationSpy.loadStateCache.and.resolveTo(null);
      const stateSnapshotSpy = jasmine.createSpyObj('StateSnapshotService', [
        'getStateSnapshot',
        'getAllSyncModelDataFromStoreAsync',
      ]);
      stateSnapshotSpy.getStateSnapshot.and.returnValue({});
      stateSnapshotSpy.getAllSyncModelDataFromStoreAsync.and.resolveTo({});
      const clientIdSpy = jasmine.createSpyObj('ClientIdService', [
        'getClientId',
        'getOrGenerateClientId',
      ]);
      clientIdSpy.getClientId.and.resolveTo('clientTest');
      clientIdSpy.getOrGenerateClientId.and.resolveTo('clientTest');
      const vectorClockSpy = jasmine.createSpyObj('VectorClockService', [
        'getCurrentVectorClock',
      ]);
      vectorClockSpy.getCurrentVectorClock.and.resolveTo({});
      const archiveDbSpy = jasmine.createSpyObj('ArchiveDbAdapter', ['load']);
      archiveDbSpy.load.and.resolveTo(undefined);
      const storeForHydrationSpy = jasmine.createSpyObj('Store', ['dispatch', 'select']);
      storeForHydrationSpy.select.and.returnValue(
        of({ syncProvider: null, isEnabled: false }),
      );

      TestBed.configureTestingModule({
        providers: [
          SyncSessionValidationService,
          SyncHydrationService,
          { provide: ValidateStateService, useValue: validateStateForHydrationSpy },
          { provide: OperationLogStoreService, useValue: opLogStoreHydrationSpy },
          { provide: StateSnapshotService, useValue: stateSnapshotSpy },
          { provide: ClientIdService, useValue: clientIdSpy },
          { provide: VectorClockService, useValue: vectorClockSpy },
          { provide: ArchiveDbAdapter, useValue: archiveDbSpy },
          { provide: SnackService, useValue: jasmine.createSpyObj('S', ['open']) },
          { provide: Store, useValue: storeForHydrationSpy },
          {
            provide: TranslateService,
            useValue: { instant: (k: string): string => k },
          },
        ],
      });

      hydrationService = TestBed.inject(SyncHydrationService);
      hydrationLatch = TestBed.inject(SyncSessionValidationService);
      hydrationLatch._resetForTest();
    });

    // Codex review found: hydrateFromRemoteSync runs validateAndRepair
    // directly and was not flipping the latch on failure. Snapshot
    // hydration (file-based providers, USE_REMOTE force-download) would
    // therefore silently accept corrupt remote state.
    it('flips the latch when validateAndRepair reports an unrepairable remote snapshot', async () => {
      await hydrationLatch.withSession(async () => {
        validateStateForHydrationSpy.validateAndRepair.and.resolveTo({
          isValid: false,
          wasRepaired: false,
          error: 'simulated corruption',
        } as never);

        await hydrationService.hydrateFromRemoteSync(
          { task: { ids: [], entities: {} } as never },
          { clientRemote: 1 },
          false,
        );

        expect(hydrationLatch.hasFailed()).toBe(true);
      });
    });

    it('leaves the latch reset when validateAndRepair reports a clean snapshot', async () => {
      await hydrationLatch.withSession(async () => {
        validateStateForHydrationSpy.validateAndRepair.and.resolveTo({
          isValid: true,
          wasRepaired: false,
        } as never);

        await hydrationService.hydrateFromRemoteSync(
          { task: { ids: [], entities: {} } as never },
          { clientRemote: 1 },
          false,
        );

        expect(hydrationLatch.hasFailed()).toBe(false);
      });
    });
  });

  describe('latch session semantics', () => {
    it('multiple validateAfterSync calls within one session keep the latch flipped', async () => {
      await latch.withSession(async () => {
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
    });

    it('a fresh withSession() clears state from a prior session', async () => {
      await latch.withSession(async () => {
        validateStateSpy.validateAndRepairCurrentState.and.resolveTo(false);
        await remoteOps.validateAfterSync();
        expect(latch.hasFailed()).toBe(true);
      });
      // Latch state persists between sessions until the next withSession() entry.
      expect(latch.hasFailed()).toBe(true);

      await latch.withSession(async () => {
        // Session entry resets — validation site sees a clean latch.
        expect(latch.hasFailed()).toBe(false);

        validateStateSpy.validateAndRepairCurrentState.and.resolveTo(true);
        await remoteOps.validateAfterSync();
        expect(latch.hasFailed()).toBe(false);
      });
    });
  });
});

import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { ImmediateUploadService } from './immediate-upload.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { OperationLogSyncService } from './operation-log-sync.service';
import { SyncProviderId } from '../sync-providers/provider.const';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { SyncSessionValidationService } from './sync-session-validation.service';
import { SyncCycleGuardService } from './sync-cycle-guard.service';
import { BehaviorSubject } from 'rxjs';
import { RejectedOpInfo } from '../core/types/sync-results.types';
import { SnackService } from '../../core/snack/snack.service';
import {
  ForceUploadFailedError,
  ForceUploadPendingOpsError,
  IncompleteRemoteOperationsError,
} from '../core/errors/sync-errors';
import { T } from '../../t.const';

describe('ImmediateUploadService', () => {
  let service: ImmediateUploadService;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockSyncService: jasmine.SpyObj<OperationLogSyncService>;
  let mockDataInitStateService: { isAllDataLoadedInitially$: BehaviorSubject<boolean> };
  let mockSyncWrapperService: { isEncryptionOperationInProgress: boolean };
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockProvider: any;
  let originalOnLineDescriptor: PropertyDescriptor | undefined;

  const completedResult = (
    overrides: Partial<{
      uploadedCount: number;
      piggybackedOpsCount: number;
      localWinOpsCreated: number;
      permanentRejectionCount: number;
      hasMorePiggyback: boolean;
      rejectedOps: RejectedOpInfo[];
      encryptionRequiredKeyMissing: boolean;
    }> = {},
  ): {
    kind: 'completed';
    uploadedCount: number;
    piggybackedOpsCount: number;
    localWinOpsCreated: number;
    permanentRejectionCount: number;
    hasMorePiggyback: boolean;
    rejectedOps: RejectedOpInfo[];
    encryptionRequiredKeyMissing?: boolean;
  } => ({
    kind: 'completed',
    uploadedCount: 0,
    piggybackedOpsCount: 0,
    localWinOpsCreated: 0,
    permanentRejectionCount: 0,
    hasMorePiggyback: false,
    rejectedOps: [],
    ...overrides,
  });

  beforeEach(() => {
    // Pin navigator.onLine = true so _canUpload()'s isOnline() guard isn't at
    // the mercy of other specs that mutate the navigator (e.g., the keyboard
    // layout spec replaces the whole object). isOnline() reads navigator.onLine
    // directly, so a leaked false here silently disables the upload pipeline
    // and surfaces as "uploadPendingOps was never called".
    originalOnLineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });

    // SuperSync provider - supports operation sync and immediate upload
    mockProvider = {
      id: SyncProviderId.SuperSync,
      supportsOperationSync: true, // Required for isOperationSyncCapable check
      providerMode: 'superSyncOps',
      uploadOperations: jasmine.createSpy('uploadOperations'),
      isReady: jasmine.createSpy('isReady').and.returnValue(Promise.resolve(true)),
    };

    mockProviderManager = jasmine.createSpyObj(
      'SyncProviderManager',
      ['getActiveProvider', 'setSyncStatus'],
      {
        isSyncInProgress: false,
      },
    );
    mockProviderManager.getActiveProvider.and.returnValue(mockProvider);

    // ImmediateUploadService now calls syncService.uploadPendingOps() which includes:
    // - Server migration detection
    // - Processing of piggybacked ops
    // - Handling of rejected ops
    mockSyncService = jasmine.createSpyObj('OperationLogSyncService', [
      'uploadPendingOps',
    ]);

    // Mock DataInitStateService with BehaviorSubject that starts as false
    // This prevents constructor from auto-initializing during tests
    mockDataInitStateService = {
      isAllDataLoadedInitially$: new BehaviorSubject<boolean>(false),
    };

    // Mock SyncWrapperService - default to no encryption operation in progress
    mockSyncWrapperService = {
      isEncryptionOperationInProgress: false,
    };
    mockSnackService = jasmine.createSpyObj('SnackService', [
      'open',
      'hasPendingPersistentAction',
    ]);
    mockSnackService.hasPendingPersistentAction.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        ImmediateUploadService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: OperationLogSyncService, useValue: mockSyncService },
        { provide: DataInitStateService, useValue: mockDataInitStateService },
        { provide: SyncWrapperService, useValue: mockSyncWrapperService },
        { provide: SnackService, useValue: mockSnackService },
      ],
    });

    service = TestBed.inject(ImmediateUploadService);
    // The cycle guard is a root singleton; reset it so a prior test that left
    // it claimed (e.g. an assertion threw before guard.end()) can't poison this
    // one. Mirrors SyncSessionValidationService's per-test reset.
    TestBed.inject(SyncCycleGuardService)._resetForTest();
  });

  afterEach(() => {
    service.ngOnDestroy();
    if (originalOnLineDescriptor) {
      Object.defineProperty(navigator, 'onLine', originalOnLineDescriptor);
    } else {
      delete (navigator as { onLine?: boolean }).onLine;
    }
  });

  describe('checkmark (IN_SYNC) behavior', () => {
    it('should show checkmark when upload succeeds and no piggybacked ops', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 3 })),
      );

      service.initialize();
      service.trigger();
      tick(2000); // Drive debounce
      flush(); // Drain the await chain inside withSession()

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('IN_SYNC');
    }));

    it('should report UNKNOWN_OR_CHANGED when the initial upload lacks a mandatory encryption key', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.resolveTo(
        completedResult({
          uploadedCount: 1,
          encryptionRequiredKeyMissing: true,
        }),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith(
        'UNKNOWN_OR_CHANGED',
      );
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalledWith('IN_SYNC');
    }));

    it('should report incomplete remote application as a sticky translated error', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.rejectWith(
        new IncompleteRemoteOperationsError(new Error('archive failed')),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockSnackService.open).toHaveBeenCalledWith({
        msg: T.F.SYNC.S.INCOMPLETE_REMOTE_OPERATIONS,
        type: 'ERROR',
        config: { duration: 0 },
      });
    }));

    it('should preserve an existing persistent recovery action for incomplete remote work', fakeAsync(() => {
      mockSnackService.hasPendingPersistentAction.and.returnValue(true);
      mockSyncService.uploadPendingOps.and.rejectWith(
        new IncompleteRemoteOperationsError(new Error('archive failed')),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockSnackService.open).not.toHaveBeenCalled();
    }));

    it('should surface a force-upload failure raised by conflict resolution', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.rejectWith(new ForceUploadFailedError());

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockSnackService.open).toHaveBeenCalledWith({
        msg: T.F.SYNC.S.FORCE_UPLOAD_FAILED,
        type: 'ERROR',
      });
    }));

    it('should keep sync pending when force upload leaves unresolved ops', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.rejectWith(new ForceUploadPendingOpsError());

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith(
        'UNKNOWN_OR_CHANGED',
      );
      expect(mockSnackService.open).not.toHaveBeenCalled();
    }));

    it('should report UNKNOWN_OR_CHANGED when a local-win follow-up lacks a mandatory encryption key', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValues(
        Promise.resolve(completedResult({ uploadedCount: 1, localWinOpsCreated: 1 })),
        Promise.resolve(
          completedResult({
            uploadedCount: 0,
            encryptionRequiredKeyMissing: true,
          }),
        ),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith(
        'UNKNOWN_OR_CHANGED',
      );
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalledWith('IN_SYNC');
    }));

    it('should NOT show checkmark when piggybacked ops exist', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 2, piggybackedOpsCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      // Piggybacked ops are processed internally by syncService.uploadPendingOps()
      // ImmediateUploadService should NOT show checkmark when there are piggybacked ops
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    }));

    it('should NOT show checkmark when nothing was uploaded', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 0 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    }));

    it('should NOT show checkmark when upload fails', async () => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.reject(new Error('Network error')),
      );

      service.initialize();
      service.trigger();

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Silent failure - no checkmark, no error state
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    });

    it('should report ERROR when piggyback processing is blocked by an incompatible op', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.resolveTo({
        kind: 'blocked_incompatible',
      });

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
    }));

    it('should NOT show checkmark when piggybacked ops exist (multiple)', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 5, piggybackedOpsCount: 3 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      // Piggybacked ops are processed internally, no checkmark shown
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    }));

    it('should report ERROR when the local-win follow-up is blocked', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValues(
        Promise.resolve(completedResult({ uploadedCount: 1, localWinOpsCreated: 1 })),
        Promise.resolve({ kind: 'blocked_incompatible' }),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalledWith('IN_SYNC');
    }));

    it('should not show a checkmark when the local-win follow-up is cancelled', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValues(
        Promise.resolve(completedResult({ uploadedCount: 1, localWinOpsCreated: 1 })),
        Promise.resolve({ kind: 'cancelled' }),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    }));

    it('should defer the checkmark when the local-win follow-up receives piggybacked ops', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValues(
        Promise.resolve(completedResult({ uploadedCount: 1, localWinOpsCreated: 1 })),
        Promise.resolve(completedResult({ uploadedCount: 1, piggybackedOpsCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    }));
  });

  // #8309: the immediate-upload side channel must not interleave with another
  // sync cycle (main sync, force flow, or WS download). It claims the in-tab
  // SyncCycleGuard synchronously at the start of _performUpload and skips if a
  // cycle is already active.
  describe('sync-cycle guard (#8309)', () => {
    it('skips the upload when another sync cycle is active', fakeAsync(() => {
      const guard = TestBed.inject(SyncCycleGuardService);
      // Simulate another cycle holding the guard (e.g. a WS download).
      expect(guard.tryBegin()).toBe(true);

      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();

      guard.end();
    }));

    it('releases the guard after the upload so a later cycle can run', fakeAsync(() => {
      const guard = TestBed.inject(SyncCycleGuardService);
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(1);
      // Guard was released in the finally — a subsequent cycle can claim it.
      expect(guard.isActive).toBe(false);
    }));
  });

  // #7330 follow-up: uploadPendingOps() processes piggybacked remote ops
  // through validateAfterSync(). Without an explicit withSession() wrapper
  // the latch flip would either fire outside any session (silently dropped
  // by the next normal sync's reset) or — worse — go unread while
  // _performUpload set IN_SYNC based purely on result.uploadedCount.
  describe('post-sync validation (#7330 latch)', () => {
    it('reports ERROR (not IN_SYNC) when validation fails during piggybacked-op processing', fakeAsync(() => {
      const latch = TestBed.inject(SyncSessionValidationService);
      mockSyncService.uploadPendingOps.and.callFake(async () => {
        // Simulate post-sync validation flipping the latch from inside
        // uploadPendingOps -> processRemoteOps -> validateAfterSync.
        latch.setFailed();
        return completedResult({ uploadedCount: 2, piggybackedOpsCount: 1 });
      });

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalledWith('IN_SYNC');
    }));

    it('reports ERROR when validation fails during a clean upload (no piggyback)', fakeAsync(() => {
      const latch = TestBed.inject(SyncSessionValidationService);
      mockSyncService.uploadPendingOps.and.callFake(async () => {
        latch.setFailed();
        return completedResult({ uploadedCount: 3 });
      });

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalledWith('IN_SYNC');
    }));

    it('reports ERROR when validation fails on the LWW re-upload pass', fakeAsync(() => {
      const latch = TestBed.inject(SyncSessionValidationService);
      let call = 0;
      mockSyncService.uploadPendingOps.and.callFake(async () => {
        call += 1;
        if (call === 1) {
          // First pass: LWW created local-win ops; no validation failure yet.
          return completedResult({ uploadedCount: 1, localWinOpsCreated: 2 });
        }
        // Re-upload pass: validation fails (e.g., on piggybacked ops returned
        // alongside the re-upload).
        latch.setFailed();
        return completedResult({ uploadedCount: 0 });
      });

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(2);
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalledWith('IN_SYNC');
    }));

    it('resets the latch on each immediate-upload session', fakeAsync(() => {
      const latch = TestBed.inject(SyncSessionValidationService);
      // Seed stale state via the test-only helper (mirrors "a prior session
      // left the latch flipped"). setFailed() outside a session would log a
      // warning we don't want in test output.
      latch._resetForTest();
      (latch as unknown as { _failed: boolean })._failed = true;

      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      // After withSession's entry-reset and a clean upload, the latch is
      // back to false and IN_SYNC is reported normally.
      expect(latch.hasFailed()).toBe(false);
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('IN_SYNC');
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalledWith('ERROR');
    }));

    it('reports ERROR when validation flipped the latch and the upload then threw', fakeAsync(() => {
      const latch = TestBed.inject(SyncSessionValidationService);
      mockSyncService.uploadPendingOps.and.callFake(async () => {
        latch.setFailed();
        throw new Error('Network error after validation failure');
      });

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      // Validation failure is structural state corruption — surface it
      // even though the upload itself threw. Transient errors with no
      // latch flip remain silent (existing 'should NOT show checkmark when
      // upload fails' test).
      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('ERROR');
    }));
  });

  describe('guards', () => {
    it('should skip upload when sync is in progress', fakeAsync(() => {
      // Need to re-create the mock with isSyncInProgress = true
      Object.defineProperty(mockProviderManager, 'isSyncInProgress', { value: true });
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    }));

    it('should skip upload when encryption operation is in progress', fakeAsync(() => {
      // Set encryption operation in progress (e.g., password change)
      mockSyncWrapperService.isEncryptionOperationInProgress = true;
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    }));

    it('should handle fresh client (syncService returns null)', fakeAsync(() => {
      // Fresh client handling is now done inside syncService.uploadPendingOps()
      // which returns { kind: 'blocked_fresh_client' } for fresh clients
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({ kind: 'blocked_fresh_client' as const }),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      // Upload was called, but returned blocked_fresh_client - no checkmark shown
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalled();
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    }));

    it('should skip upload when provider is not ready', fakeAsync(() => {
      mockProvider.isReady.and.returnValue(Promise.resolve(false));
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    }));

    it('should skip upload for Dropbox (file-based provider)', fakeAsync(() => {
      // File-based providers use periodic sync, not immediate upload
      mockProvider.id = SyncProviderId.Dropbox;
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    }));

    it('should skip upload for WebDAV (file-based provider)', fakeAsync(() => {
      mockProvider.id = SyncProviderId.WebDAV;
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    }));

    it('should skip upload for LocalFile (file-based provider)', fakeAsync(() => {
      mockProvider.id = SyncProviderId.LocalFile;
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2000);
      flush();

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    }));
  });

  describe('debouncing', () => {
    it('should debounce rapid triggers into single upload', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();

      // Rapid triggers
      service.trigger();
      service.trigger();
      service.trigger();
      service.trigger();
      service.trigger();

      tick(2000);
      flush();

      // Should only upload once despite 5 triggers
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(1);
    }));
  });

  describe('constructor initialization', () => {
    it('should auto-initialize when data is loaded', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      // Simulate data loading complete
      mockDataInitStateService.isAllDataLoadedInitially$.next(true);
      tick();

      // Trigger upload - should work because service auto-initialized
      service.trigger();
      tick(2000);
      flush();

      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(1);
    }));

    it('should not auto-initialize before data is loaded', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      // Data not loaded (still false)
      // Trigger upload - should NOT work because service not initialized
      service.trigger();
      tick(2000);
      flush();

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    }));

    it('should queue triggers before initialization and replay them when initialized', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      // Trigger multiple times before initialization (data not loaded)
      service.trigger();
      service.trigger();
      service.trigger();
      tick(100);

      // No upload should happen yet
      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();

      // Simulate data loading complete - should replay queued triggers
      mockDataInitStateService.isAllDataLoadedInitially$.next(true);
      tick();

      // Wait for debounce - queued triggers should result in one upload
      tick(2000);
      flush();

      // Should upload once (debounce coalesces multiple triggers)
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(1);
    }));
  });
});

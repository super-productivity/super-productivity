import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ImmediateUploadService } from './immediate-upload.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { OperationLogSyncService } from './operation-log-sync.service';
import { SyncProviderId } from '../sync-providers/provider.const';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { BehaviorSubject } from 'rxjs';
import { RejectedOpInfo } from '../core/types/sync-results.types';

describe('ImmediateUploadService', () => {
  let service: ImmediateUploadService;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockSyncService: jasmine.SpyObj<OperationLogSyncService>;
  let mockDataInitStateService: { isAllDataLoadedInitially$: BehaviorSubject<boolean> };
  let mockSyncWrapperService: { isEncryptionOperationInProgress: boolean };
  let mockProvider: any;

  const completedResult = (
    overrides: Partial<{
      uploadedCount: number;
      piggybackedOpsCount: number;
      localWinOpsCreated: number;
      permanentRejectionCount: number;
      hasMorePiggyback: boolean;
      rejectedOps: RejectedOpInfo[];
    }> = {},
  ): {
    kind: 'completed';
    uploadedCount: number;
    piggybackedOpsCount: number;
    localWinOpsCreated: number;
    permanentRejectionCount: number;
    hasMorePiggyback: boolean;
    rejectedOps: RejectedOpInfo[];
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
    // SuperSync provider - supports operation sync and immediate upload
    mockProvider = {
      id: SyncProviderId.SuperSync,
      supportsOperationSync: true, // Required for isOperationSyncCapable check
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

    TestBed.configureTestingModule({
      providers: [
        ImmediateUploadService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: OperationLogSyncService, useValue: mockSyncService },
        { provide: DataInitStateService, useValue: mockDataInitStateService },
        { provide: SyncWrapperService, useValue: mockSyncWrapperService },
      ],
    });

    service = TestBed.inject(ImmediateUploadService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  describe('checkmark (IN_SYNC) behavior', () => {
    it('should show checkmark when upload succeeds and no piggybacked ops', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 3 })),
      );

      service.initialize();
      service.trigger();
      tick(2100); // Debounce (2000ms) + processing

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('IN_SYNC');
    }));

    it('should NOT show checkmark when piggybacked ops exist', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 2, piggybackedOpsCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2100);

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
      tick(2100);

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

    it('should NOT show checkmark when piggybacked ops exist (multiple)', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 5, piggybackedOpsCount: 3 })),
      );

      service.initialize();
      service.trigger();
      tick(2100);

      // Piggybacked ops are processed internally, no checkmark shown
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
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
      tick(2100);

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
      tick(2100);

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
      tick(2100);

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
      tick(2100);

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
      tick(2100);

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    }));

    it('should skip upload for WebDAV (file-based provider)', fakeAsync(() => {
      mockProvider.id = SyncProviderId.WebDAV;
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2100);

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    }));

    it('should skip upload for LocalFile (file-based provider)', fakeAsync(() => {
      mockProvider.id = SyncProviderId.LocalFile;
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      service.initialize();
      service.trigger();
      tick(2100);

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

      tick(2100);

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
      tick(2100);

      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(1);
    }));

    it('should not auto-initialize before data is loaded', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve(completedResult({ uploadedCount: 1 })),
      );

      // Data not loaded (still false)
      // Trigger upload - should NOT work because service not initialized
      service.trigger();
      tick(2100);

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
      tick(2100);

      // Should upload once (debounce coalesces multiple triggers)
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(1);
    }));
  });
});

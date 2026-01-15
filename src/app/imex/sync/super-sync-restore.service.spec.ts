import { TestBed } from '@angular/core/testing';
import { SuperSyncRestoreService } from './super-sync-restore.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { SnackService } from '../../core/snack/snack.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { RestorePoint } from '../../op-log/sync-providers/provider.interface';
import { T } from '../../t.const';

describe('SuperSyncRestoreService', () => {
  let service: SuperSyncRestoreService;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockBackupService: jasmine.SpyObj<BackupService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockProvider: any;

  beforeEach(() => {
    mockProvider = {
      id: SyncProviderId.SuperSync,
      isReady: jasmine.createSpy('isReady').and.returnValue(Promise.resolve(true)),
      getRestorePoints: jasmine.createSpy('getRestorePoints'),
      getStateAtSeq: jasmine.createSpy('getStateAtSeq'),
    };

    mockProviderManager = jasmine.createSpyObj('SyncProviderManager', [
      'getActiveProvider',
    ]);
    mockProviderManager.getActiveProvider.and.returnValue(mockProvider);

    mockBackupService = jasmine.createSpyObj('BackupService', ['importCompleteBackup']);

    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      providers: [
        SuperSyncRestoreService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: BackupService, useValue: mockBackupService },
        { provide: SnackService, useValue: mockSnackService },
      ],
    });

    service = TestBed.inject(SuperSyncRestoreService);
  });

  describe('isAvailable', () => {
    it('should return true when SuperSync is active and ready', async () => {
      mockProvider.isReady.and.returnValue(Promise.resolve(true));

      const result = await service.isAvailable();

      expect(result).toBe(true);
      expect(mockProvider.isReady).toHaveBeenCalled();
    });

    it('should return false when SuperSync is not ready', async () => {
      mockProvider.isReady.and.returnValue(Promise.resolve(false));

      const result = await service.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false when SuperSync is not the active provider', async () => {
      mockProviderManager.getActiveProvider = jasmine.createSpy().and.returnValue({
        id: SyncProviderId.WebDAV,
      });

      const result = await service.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false when no provider is active', async () => {
      mockProviderManager.getActiveProvider = jasmine.createSpy().and.returnValue(null);

      const result = await service.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('getRestorePoints', () => {
    const mockRestorePoints: RestorePoint[] = [
      {
        serverSeq: 100,
        timestamp: Date.now() - 3600000,
        type: 'SYNC_IMPORT',
        clientId: 'client-1',
      },
      {
        serverSeq: 50,
        timestamp: Date.now() - 7200000,
        type: 'BACKUP_IMPORT',
        clientId: 'client-2',
      },
    ];

    it('should return restore points from the provider', async () => {
      mockProvider.getRestorePoints.and.returnValue(Promise.resolve(mockRestorePoints));

      const result = await service.getRestorePoints();

      expect(result).toEqual(mockRestorePoints);
      expect(mockProvider.getRestorePoints).toHaveBeenCalledWith(30);
    });

    it('should pass custom limit to provider', async () => {
      mockProvider.getRestorePoints.and.returnValue(Promise.resolve([]));

      await service.getRestorePoints(10);

      expect(mockProvider.getRestorePoints).toHaveBeenCalledWith(10);
    });

    it('should throw error when SuperSync is not active', async () => {
      mockProviderManager.getActiveProvider = jasmine.createSpy().and.returnValue(null);

      await expectAsync(service.getRestorePoints()).toBeRejectedWithError(
        'Super Sync is not the active sync provider',
      );
    });

    it('should throw error when different provider is active', async () => {
      mockProviderManager.getActiveProvider = jasmine.createSpy().and.returnValue({
        id: SyncProviderId.Dropbox,
      });

      await expectAsync(service.getRestorePoints()).toBeRejectedWithError(
        'Super Sync is not the active sync provider',
      );
    });
  });

  describe('restoreToPoint', () => {
    const mockState = {
      project: { entities: {} },
      task: { entities: {} },
    } as any;

    beforeEach(() => {
      mockProvider.getStateAtSeq.and.returnValue(
        Promise.resolve({
          state: mockState,
          serverSeq: 100,
          generatedAt: Date.now(),
        }),
      );
      mockBackupService.importCompleteBackup.and.returnValue(Promise.resolve());
    });

    it('should fetch state and import backup successfully', async () => {
      await service.restoreToPoint(100);

      expect(mockProvider.getStateAtSeq).toHaveBeenCalledWith(100);
      expect(mockBackupService.importCompleteBackup).toHaveBeenCalledWith(
        mockState as any,
        true, // isSkipLegacyWarnings
        true, // isSkipReload
        true, // isForceConflict
      );
      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'SUCCESS',
        msg: T.F.SYNC.S.RESTORE_SUCCESS,
      });
    });

    it('should show error snack and rethrow on failure', async () => {
      const error = new Error('Network error');
      mockProvider.getStateAtSeq.and.returnValue(Promise.reject(error));

      await expectAsync(service.restoreToPoint(100)).toBeRejectedWith(error);

      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.F.SYNC.S.RESTORE_ERROR,
      });
    });

    it('should show error when import fails', async () => {
      const error = new Error('Import failed');
      mockBackupService.importCompleteBackup.and.returnValue(Promise.reject(error));

      await expectAsync(service.restoreToPoint(100)).toBeRejectedWith(error);

      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.F.SYNC.S.RESTORE_ERROR,
      });
    });

    it('should throw when SuperSync is not active', async () => {
      mockProviderManager.getActiveProvider = jasmine.createSpy().and.returnValue(null);

      await expectAsync(service.restoreToPoint(100)).toBeRejectedWithError(
        'Super Sync is not the active sync provider',
      );
    });
  });

  describe('service instantiation', () => {
    it('should instantiate without errors', () => {
      expect(service).toBeTruthy();
    });

    it('should use injected services for operations', async () => {
      // Access the service multiple times
      await service.isAvailable();
      await service.isAvailable();

      // The same mocks are used for both calls
      expect(mockProviderManager.getActiveProvider).toHaveBeenCalledTimes(2);
    });
  });
});

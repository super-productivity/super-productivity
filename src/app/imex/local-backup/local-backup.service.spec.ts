import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { LocalBackupService } from './local-backup.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { SnackService } from '../../core/snack/snack.service';
import { TranslateService } from '@ngx-translate/core';
import { ArchiveModel } from '../../features/archive/archive.model';
import { initialTimeTrackingState } from '../../features/time-tracking/store/time-tracking.reducer';
import { CapacitorPlatformService } from '../../core/platform/capacitor-platform.service';
import { AppDataComplete } from '../../op-log/model/model-config';

const BACKUP_INTERVAL = 5 * 60 * 1000;

type LocalBackupServiceWithPrivate = {
  _backup: () => Promise<void>;
};

type LocalBackupServiceWithBackupIos = {
  _backupIOS: (data: AppDataComplete) => Promise<void>;
};

describe('LocalBackupService', () => {
  let service: LocalBackupService;
  let stateSnapshotServiceSpy: jasmine.SpyObj<StateSnapshotService>;
  let globalConfigServiceSpy: jasmine.SpyObj<GlobalConfigService>;
  let backupServiceSpy: jasmine.SpyObj<BackupService>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let translateServiceSpy: jasmine.SpyObj<TranslateService>;
  let platformServiceSpy: jasmine.SpyObj<CapacitorPlatformService>;

  const DEFAULT_ARCHIVE: ArchiveModel = {
    task: { ids: [], entities: {} },
    timeTracking: initialTimeTrackingState,
    lastTimeTrackingFlush: 0,
  };

  const mockArchiveYoung: ArchiveModel = {
    task: {
      ids: ['archivedTask1'],
      entities: {
        archivedTask1: {
          id: 'archivedTask1',
          title: 'Archived Task',
          tagIds: ['tag1'],
          isDone: true,
        } as any,
      },
    },
    timeTracking: initialTimeTrackingState,
    lastTimeTrackingFlush: 1000,
  };

  const mockArchiveOld: ArchiveModel = {
    task: {
      ids: ['oldArchivedTask1'],
      entities: {
        oldArchivedTask1: {
          id: 'oldArchivedTask1',
          title: 'Old Archived Task',
          tagIds: ['tag2'],
          isDone: true,
        } as any,
      },
    },
    timeTracking: initialTimeTrackingState,
    lastTimeTrackingFlush: 500,
  };

  beforeEach(() => {
    stateSnapshotServiceSpy = jasmine.createSpyObj('StateSnapshotService', [
      'getAllSyncModelDataFromStore',
      'getAllSyncModelDataFromStoreAsync',
    ]);
    globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg$: of({ localBackup: { isEnabled: false } }),
    });
    backupServiceSpy = jasmine.createSpyObj('BackupService', ['importCompleteBackup']);
    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    translateServiceSpy = jasmine.createSpyObj('TranslateService', ['instant']);
    platformServiceSpy = jasmine.createSpyObj('CapacitorPlatformService', ['isIOS']);
    platformServiceSpy.isIOS.and.returnValue(false);

    // Mock sync method to return empty archives (current buggy behavior)
    stateSnapshotServiceSpy.getAllSyncModelDataFromStore.and.returnValue({
      task: {
        ids: ['task1'],
        entities: { task1: { id: 'task1', title: 'Active Task' } },
      },
      project: { ids: [], entities: {} },
      tag: { ids: [], entities: {} },
      archiveYoung: DEFAULT_ARCHIVE,
      archiveOld: DEFAULT_ARCHIVE,
    } as any);

    // Mock async method to return real archives
    stateSnapshotServiceSpy.getAllSyncModelDataFromStoreAsync.and.returnValue(
      Promise.resolve({
        task: {
          ids: ['task1'],
          entities: { task1: { id: 'task1', title: 'Active Task' } },
        },
        project: { ids: [], entities: {} },
        tag: { ids: [], entities: {} },
        archiveYoung: mockArchiveYoung,
        archiveOld: mockArchiveOld,
      } as any),
    );

    TestBed.configureTestingModule({
      providers: [
        LocalBackupService,
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: StateSnapshotService, useValue: stateSnapshotServiceSpy },
        { provide: BackupService, useValue: backupServiceSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: TranslateService, useValue: translateServiceSpy },
        { provide: CapacitorPlatformService, useValue: platformServiceSpy },
      ],
    });

    service = TestBed.inject(LocalBackupService);
  });

  describe('backup data should include archives', () => {
    it('should use async method to get data with archives (not sync method)', async () => {
      // This test verifies that the service uses getAllSyncModelDataFromStoreAsync()
      // which loads archives from IndexedDB, not the sync method which returns empty archives.

      // Call the internal backup method via reflection (it's private)
      await (service as unknown as LocalBackupServiceWithPrivate)._backup();

      // Verify the ASYNC method was called (which includes real archives)
      expect(
        stateSnapshotServiceSpy.getAllSyncModelDataFromStoreAsync,
      ).toHaveBeenCalled();

      // Verify the SYNC method was NOT called (which returns empty archives)
      expect(stateSnapshotServiceSpy.getAllSyncModelDataFromStore).not.toHaveBeenCalled();
    });

    it('should include archive data in backup (not empty DEFAULT_ARCHIVE)', async () => {
      (
        service as unknown as {
          _platformService: Pick<CapacitorPlatformService, 'isIOS'>;
        }
      )._platformService = { isIOS: () => true };
      const backupIosSpy = spyOn(
        service as unknown as LocalBackupServiceWithBackupIos,
        '_backupIOS',
      ).and.resolveTo();

      await (service as unknown as LocalBackupServiceWithPrivate)._backup();

      expect(backupIosSpy).toHaveBeenCalledTimes(1);
      const backupData = backupIosSpy.calls.mostRecent().args[0];

      expect(backupData.archiveYoung.task.ids).toEqual(['archivedTask1']);
      expect(backupData.archiveOld.task.ids).toEqual(['oldArchivedTask1']);
      expect(backupData.archiveYoung.task.entities['archivedTask1']).toEqual(
        jasmine.objectContaining({
          id: 'archivedTask1',
          title: 'Archived Task',
        }),
      );
      expect(backupData.archiveOld.task.entities['oldArchivedTask1']).toEqual(
        jasmine.objectContaining({
          id: 'oldArchivedTask1',
          title: 'Old Archived Task',
        }),
      );
    });
  });

  describe('automatic backup timer', () => {
    it('should stop creating automatic backups when disabled after being enabled', fakeAsync(() => {
      const cfg$ = new BehaviorSubject({
        localBackup: { isEnabled: true },
      });
      globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
        cfg$,
      });

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          LocalBackupService,
          { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
          { provide: StateSnapshotService, useValue: stateSnapshotServiceSpy },
          { provide: BackupService, useValue: backupServiceSpy },
          { provide: SnackService, useValue: snackServiceSpy },
          { provide: TranslateService, useValue: translateServiceSpy },
          { provide: CapacitorPlatformService, useValue: platformServiceSpy },
        ],
      });
      service = TestBed.inject(LocalBackupService);
      spyOn(
        service as unknown as LocalBackupServiceWithPrivate,
        '_backup',
      ).and.resolveTo();

      service.init();
      tick(BACKUP_INTERVAL);

      expect(
        (service as unknown as LocalBackupServiceWithPrivate)._backup,
      ).toHaveBeenCalledTimes(1);

      cfg$.next({ localBackup: { isEnabled: false } });
      tick(BACKUP_INTERVAL);

      expect(
        (service as unknown as LocalBackupServiceWithPrivate)._backup,
      ).toHaveBeenCalledTimes(1);
    }));
  });

  describe('import backup', () => {
    it('should import with force conflict to reset vector clock', async () => {
      backupServiceSpy.importCompleteBackup.and.resolveTo();

      await (service as any)._importBackup(JSON.stringify({ task: { ids: [] } }));

      expect(backupServiceSpy.importCompleteBackup).toHaveBeenCalledWith(
        jasmine.any(Object),
        false,
        true,
        true,
      );
    });
  });
});

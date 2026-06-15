import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
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
import { T } from '../../t.const';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { Action } from '@ngrx/store';
import { DEFAULT_MAX_BACKUP_FILES } from '../../../../electron/shared-with-frontend/backup-file-cleanup.util';
import { LS } from '../../core/persistence/storage-keys.const';

const BACKUP_INTERVAL = 5 * 60 * 1000;
const DATA_CHANGE_DEBOUNCE = 30 * 1000;

type LocalBackupServiceWithPrivate = {
  _backup: () => Promise<void>;
};

type LocalBackupServiceWithBackupIos = {
  _backupIOS: (data: AppDataComplete) => Promise<void>;
};

type LocalBackupServiceWithBackupElectron = {
  _backupElectron: (data: AppDataComplete) => Promise<void>;
};

type LocalBackupServiceWithPlatformFlags = {
  _isAndroidWebView: boolean;
};

describe('LocalBackupService', () => {
  let service: LocalBackupService;
  let stateSnapshotServiceSpy: jasmine.SpyObj<StateSnapshotService>;
  let globalConfigServiceSpy: jasmine.SpyObj<GlobalConfigService>;
  let backupServiceSpy: jasmine.SpyObj<BackupService>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let translateServiceSpy: jasmine.SpyObj<TranslateService>;
  let platformServiceSpy: jasmine.SpyObj<CapacitorPlatformService>;
  let originalElectronApi: typeof window.ea | undefined;

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
    originalElectronApi = window.ea;
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
        // Default is an inert stream; the data-change trigger specs override.
        { provide: LOCAL_ACTIONS, useValue: new Subject<Action>() },
      ],
    });

    service = TestBed.inject(LocalBackupService);
  });

  afterEach(() => {
    window.ea = originalElectronApi as typeof window.ea;
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

    it('should pass the configured desktop backup file limit to Electron', async () => {
      (window as unknown as { ea: { backupAppData: jasmine.Spy } }).ea = {
        backupAppData: jasmine.createSpy('backupAppData'),
      };

      globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
        cfg$: of({ localBackup: { isEnabled: true, maxBackupFiles: 7 } }),
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
          { provide: LOCAL_ACTIONS, useValue: new Subject<Action>() },
        ],
      });
      service = TestBed.inject(LocalBackupService);

      const backupData =
        (await stateSnapshotServiceSpy.getAllSyncModelDataFromStoreAsync()) as AppDataComplete;
      await (service as unknown as LocalBackupServiceWithBackupElectron)._backupElectron(
        backupData,
      );

      expect(window.ea.backupAppData).toHaveBeenCalledOnceWith({
        data: jasmine.objectContaining({
          task: jasmine.objectContaining({ ids: ['task1'] }),
        }),
        maxBackupFiles: 7,
      });
    });

    it('should use the default desktop backup file limit for legacy config', async () => {
      (window as unknown as { ea: { backupAppData: jasmine.Spy } }).ea = {
        backupAppData: jasmine.createSpy('backupAppData'),
      };

      const backupData =
        (await stateSnapshotServiceSpy.getAllSyncModelDataFromStoreAsync()) as AppDataComplete;
      await (service as unknown as LocalBackupServiceWithBackupElectron)._backupElectron(
        backupData,
      );

      expect(window.ea.backupAppData).toHaveBeenCalledOnceWith({
        data: jasmine.any(Object),
        maxBackupFiles: DEFAULT_MAX_BACKUP_FILES,
      });
    });
  });

  describe('empty-state guard (#7901)', () => {
    const setIosPlatform = (): jasmine.Spy => {
      (
        service as unknown as {
          _platformService: Pick<CapacitorPlatformService, 'isIOS'>;
        }
      )._platformService = { isIOS: () => true };
      return spyOn(
        service as unknown as LocalBackupServiceWithBackupIos,
        '_backupIOS',
      ).and.resolveTo();
    };

    it('should NOT write a backup when the store has no meaningful data', async () => {
      // Simulates a post-eviction boot: empty store (no tasks, only INBOX
      // project, only system tags, no notes). hasMeaningfulStateData → false.
      stateSnapshotServiceSpy.getAllSyncModelDataFromStoreAsync.and.resolveTo({
        task: { ids: [], entities: {} },
        project: { ids: [], entities: {} },
        tag: { ids: [], entities: {} },
        note: { ids: [], entities: {} },
        archiveYoung: DEFAULT_ARCHIVE,
        archiveOld: DEFAULT_ARCHIVE,
      } as any);
      const backupIosSpy = setIosPlatform();

      await (service as unknown as LocalBackupServiceWithPrivate)._backup();

      expect(backupIosSpy).not.toHaveBeenCalled();
    });

    it('should write a backup when the store has meaningful data', async () => {
      // Default mock has task1 → hasMeaningfulStateData → true.
      const backupIosSpy = setIosPlatform();

      await (service as unknown as LocalBackupServiceWithPrivate)._backup();

      expect(backupIosSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('iOS backup ring (#7901)', () => {
    const PRIMARY = 'super-productivity-backup.json';
    const PREV = 'super-productivity-backup.prev.json';

    type LocalBackupServiceWithIosRing = {
      _readIOSFileOrNull: (path: string) => Promise<string | null>;
      _writeIOSFile: (path: string, data: string) => Promise<void>;
    };

    beforeEach(() => {
      (
        service as unknown as {
          _platformService: Pick<CapacitorPlatformService, 'isIOS'>;
        }
      )._platformService = { isIOS: () => true };
    });

    it('promotes the existing backup to the prev slot before overwriting', async () => {
      const existing = JSON.stringify({ task: { ids: ['existing'] } });
      spyOn(
        service as unknown as LocalBackupServiceWithIosRing,
        '_readIOSFileOrNull',
      ).and.resolveTo(existing);
      const writeSpy = spyOn(
        service as unknown as LocalBackupServiceWithIosRing,
        '_writeIOSFile',
      ).and.resolveTo();

      await (service as unknown as LocalBackupServiceWithPrivate)._backup();

      // First write promotes the existing blob to prev, second writes the new primary.
      expect(writeSpy).toHaveBeenCalledTimes(2);
      expect(writeSpy.calls.first().args).toEqual([PREV, existing]);
      expect(writeSpy.calls.mostRecent().args[0]).toBe(PRIMARY);
    });

    it('skips promotion when there is no existing backup yet', async () => {
      spyOn(
        service as unknown as LocalBackupServiceWithIosRing,
        '_readIOSFileOrNull',
      ).and.resolveTo(null);
      const writeSpy = spyOn(
        service as unknown as LocalBackupServiceWithIosRing,
        '_writeIOSFile',
      ).and.resolveTo();

      await (service as unknown as LocalBackupServiceWithPrivate)._backup();

      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(writeSpy.calls.mostRecent().args[0]).toBe(PRIMARY);
    });

    it('loadBackupIOS resolves to "" (never throws) when no usable backup exists', async () => {
      // Guards the fire-and-forget startup path from an unhandled rejection.
      spyOn(
        service as unknown as LocalBackupServiceWithIosRing,
        '_readIOSFileOrNull',
      ).and.resolveTo(null);

      await expectAsync(service.loadBackupIOS()).toBeResolvedTo('');
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
          { provide: LOCAL_ACTIONS, useValue: new Subject<Action>() },
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

  describe('near-empty overwrite guard (A3, #7925)', () => {
    type LocalBackupServiceWithA3 = {
      _isNearEmptyOverwrite: (
        newData: AppDataComplete,
        existingRaw: string | null,
      ) => boolean;
    };

    type LocalBackupServiceWithIosRing = {
      _readIOSFileOrNull: (path: string) => Promise<string | null>;
      _writeIOSFile: (path: string, data: string) => Promise<void>;
    };

    const makeData = (taskCount: number): AppDataComplete =>
      ({
        task: {
          ids: Array.from({ length: taskCount }, (_, i) => `t${i}`),
          entities: {},
        },
        archiveYoung: { task: { ids: [], entities: {} } },
        archiveOld: { task: { ids: [], entities: {} } },
      }) as unknown as AppDataComplete;

    const makeStoredBackup = (activeTasks: number, archivedTasks: number = 0): string =>
      JSON.stringify({
        task: {
          ids: Array.from({ length: activeTasks }, (_, i) => `t${i}`),
          entities: {},
        },
        archiveYoung: {
          task: {
            ids: Array.from({ length: archivedTasks }, (_, i) => `a${i}`),
            entities: {},
          },
        },
        archiveOld: { task: { ids: [], entities: {} } },
      });

    describe('_isNearEmptyOverwrite (pure)', () => {
      it('blocks when new < 3 tasks AND existing >= 10 tasks', () => {
        const guard = (service as unknown as LocalBackupServiceWithA3)
          ._isNearEmptyOverwrite;
        expect(guard.call(service, makeData(0), makeStoredBackup(10))).toBe(true);
        expect(guard.call(service, makeData(2), makeStoredBackup(10))).toBe(true);
        expect(guard.call(service, makeData(2), makeStoredBackup(50))).toBe(true);
      });

      it('counts archived tasks toward the "substantial" threshold', () => {
        // 4 active + 8 archived = 12 → still substantial.
        const guard = (service as unknown as LocalBackupServiceWithA3)
          ._isNearEmptyOverwrite;
        expect(guard.call(service, makeData(1), makeStoredBackup(4, 8))).toBe(true);
      });

      it('allows when the new snapshot is not near-empty', () => {
        const guard = (service as unknown as LocalBackupServiceWithA3)
          ._isNearEmptyOverwrite;
        expect(guard.call(service, makeData(3), makeStoredBackup(100))).toBe(false);
        expect(guard.call(service, makeData(10), makeStoredBackup(10))).toBe(false);
      });

      it('allows when the existing backup is not substantial', () => {
        // A legitimate fresh-start scenario: existing has only a few tasks too.
        const guard = (service as unknown as LocalBackupServiceWithA3)
          ._isNearEmptyOverwrite;
        expect(guard.call(service, makeData(1), makeStoredBackup(9))).toBe(false);
        expect(guard.call(service, makeData(0), makeStoredBackup(0))).toBe(false);
      });

      it('allows when there is no existing backup or it is corrupt', () => {
        // First-ever write must not be blocked, and a corrupt slot must not
        // pretend to be a substantial backup.
        const guard = (service as unknown as LocalBackupServiceWithA3)
          ._isNearEmptyOverwrite;
        expect(guard.call(service, makeData(0), null)).toBe(false);
        expect(guard.call(service, makeData(0), '')).toBe(false);
        expect(guard.call(service, makeData(0), '{broken')).toBe(false);
      });
    });

    describe('integration via _backupIOS', () => {
      beforeEach(() => {
        (
          service as unknown as {
            _platformService: Pick<CapacitorPlatformService, 'isIOS'>;
          }
        )._platformService = { isIOS: () => true };
      });

      it('skips the overwrite when a near-empty snapshot would clobber a substantial backup', async () => {
        stateSnapshotServiceSpy.getAllSyncModelDataFromStoreAsync.and.resolveTo(
          makeData(1) as any,
        );
        spyOn(
          service as unknown as LocalBackupServiceWithIosRing,
          '_readIOSFileOrNull',
        ).and.resolveTo(makeStoredBackup(20));
        const writeSpy = spyOn(
          service as unknown as LocalBackupServiceWithIosRing,
          '_writeIOSFile',
        ).and.resolveTo();

        await (service as unknown as LocalBackupServiceWithPrivate)._backup();

        // Guard fired before any write — neither the prev promotion nor the
        // primary overwrite happened, so the good backup is preserved.
        expect(writeSpy).not.toHaveBeenCalled();
      });

      it('writes normally when the new snapshot is not near-empty', async () => {
        stateSnapshotServiceSpy.getAllSyncModelDataFromStoreAsync.and.resolveTo(
          makeData(5) as any,
        );
        spyOn(
          service as unknown as LocalBackupServiceWithIosRing,
          '_readIOSFileOrNull',
        ).and.resolveTo(makeStoredBackup(20));
        const writeSpy = spyOn(
          service as unknown as LocalBackupServiceWithIosRing,
          '_writeIOSFile',
        ).and.resolveTo();

        await (service as unknown as LocalBackupServiceWithPrivate)._backup();

        // Prev-promotion + primary write = 2 calls.
        expect(writeSpy).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('debounced data-change trigger (A2, #7925)', () => {
    const setup = (
      isEnabled: boolean,
    ): { actions$: Subject<Action>; backupSpy: jasmine.Spy } => {
      const actions$ = new Subject<Action>();
      const cfg$ = new BehaviorSubject({ localBackup: { isEnabled } });
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
          { provide: LOCAL_ACTIONS, useValue: actions$ },
        ],
      });
      service = TestBed.inject(LocalBackupService);
      const backupSpy = spyOn(
        service as unknown as LocalBackupServiceWithPrivate,
        '_backup',
      ).and.resolveTo();
      service.init();
      return { actions$, backupSpy };
    };

    it('fires one backup after the debounce settles, regardless of action count', fakeAsync(() => {
      const { actions$, backupSpy } = setup(true);

      actions$.next({ type: 'SomeAction' });
      actions$.next({ type: 'AnotherAction' });
      actions$.next({ type: 'YetAnother' });

      // Inside the debounce window — no backup yet.
      tick(DATA_CHANGE_DEBOUNCE - 1);
      expect(backupSpy).not.toHaveBeenCalled();

      // Window settles — exactly one backup.
      tick(1);
      expect(backupSpy).toHaveBeenCalledTimes(1);
    }));

    it('resets the debounce on each new action', fakeAsync(() => {
      const { actions$, backupSpy } = setup(true);

      actions$.next({ type: 'A' });
      tick(DATA_CHANGE_DEBOUNCE - 1);
      // New action just before the window closes — debounce resets.
      actions$.next({ type: 'B' });
      tick(DATA_CHANGE_DEBOUNCE - 1);
      expect(backupSpy).not.toHaveBeenCalled();

      tick(1);
      expect(backupSpy).toHaveBeenCalledTimes(1);
    }));

    it('does not fire when isEnabled is false', fakeAsync(() => {
      const { actions$, backupSpy } = setup(false);

      actions$.next({ type: 'SomeAction' });
      tick(DATA_CHANGE_DEBOUNCE);
      tick(BACKUP_INTERVAL);

      expect(backupSpy).not.toHaveBeenCalled();
    }));
  });

  describe('informed mobile restore prompt (#7901)', () => {
    type LocalBackupServiceWithPrompt = {
      _restoreMobilePromptMsg: (backupData: string) => string;
    };

    it('names the task and project counts when the backup parses', () => {
      translateServiceSpy.instant.and.returnValue('msg');
      const backupData = JSON.stringify({
        task: { ids: ['a', 'b'], entities: {} },
        project: { ids: ['p1'], entities: {} },
      });

      (service as unknown as LocalBackupServiceWithPrompt)._restoreMobilePromptMsg(
        backupData,
      );

      expect(translateServiceSpy.instant).toHaveBeenCalledWith(
        T.CONFIRM.RESTORE_FILE_BACKUP_MOBILE,
        { tasks: 2, projects: 1 },
      );
    });

    it('falls back to the generic prompt for an unparseable backup', () => {
      translateServiceSpy.instant.and.returnValue('msg');

      (service as unknown as LocalBackupServiceWithPrompt)._restoreMobilePromptMsg(
        '{corrupt',
      );

      expect(translateServiceSpy.instant).toHaveBeenCalledWith(
        T.CONFIRM.RESTORE_FILE_BACKUP_ANDROID,
      );
    });
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

  describe('restoreLatestMobileBackupFromSettings()', () => {
    const setAndroidMode = (): void => {
      (service as unknown as LocalBackupServiceWithPlatformFlags)._isAndroidWebView =
        true;
    };

    beforeEach(() => {
      backupServiceSpy.importCompleteBackup.and.resolveTo();
      (window.confirm as jasmine.Spy).calls.reset();
      snackServiceSpy.open.calls.reset();
      translateServiceSpy.instant.and.callFake((key: string) => key);
    });

    it('should restore the latest Android backup after confirmation', async () => {
      setAndroidMode();
      const backupData = JSON.stringify({
        task: { ids: ['task1'], entities: {} },
        project: { ids: ['project1'], entities: {} },
      });
      spyOn(service, 'loadBackupAndroid').and.resolveTo(backupData);
      (window.confirm as jasmine.Spy).and.returnValue(true);

      await service.restoreLatestMobileBackupFromSettings();

      expect(translateServiceSpy.instant).toHaveBeenCalledWith(
        T.CONFIRM.RESTORE_FILE_BACKUP_MOBILE_FROM_SETTINGS,
        { tasks: 1, projects: 1 },
      );
      expect(window.confirm).toHaveBeenCalledWith(
        T.CONFIRM.RESTORE_FILE_BACKUP_MOBILE_FROM_SETTINGS,
      );
      expect(backupServiceSpy.importCompleteBackup).toHaveBeenCalledWith(
        jasmine.objectContaining({
          task: jasmine.objectContaining({ ids: ['task1'] }),
          project: jasmine.objectContaining({ ids: ['project1'] }),
        }),
        false,
        true,
        true,
      );
      expect(snackServiceSpy.open).toHaveBeenCalledWith({
        type: 'SUCCESS',
        msg: T.GCF.AUTO_BACKUPS.S_RESTORE_SUCCESS,
      });
    });

    it('should not show a success snackbar when the import fails', async () => {
      setAndroidMode();
      spyOn(service, 'loadBackupAndroid').and.resolveTo(
        JSON.stringify({ task: { ids: ['task1'], entities: {} } }),
      );
      (window.confirm as jasmine.Spy).and.returnValue(true);
      backupServiceSpy.importCompleteBackup.and.rejectWith(new Error('boom'));

      await service.restoreLatestMobileBackupFromSettings();

      expect(snackServiceSpy.open).not.toHaveBeenCalledWith({
        type: 'SUCCESS',
        msg: T.GCF.AUTO_BACKUPS.S_RESTORE_SUCCESS,
      });
    });

    it('should show a snackbar when no Android backup exists', async () => {
      setAndroidMode();
      spyOn(service, 'loadBackupAndroid').and.resolveTo('');

      await service.restoreLatestMobileBackupFromSettings();

      expect(snackServiceSpy.open).toHaveBeenCalledWith({
        type: 'WARNING',
        msg: T.GCF.AUTO_BACKUPS.S_NO_BACKUP_AVAILABLE,
      });
      expect(window.confirm).not.toHaveBeenCalled();
      expect(backupServiceSpy.importCompleteBackup).not.toHaveBeenCalled();
    });

    [
      {
        label: 'corrupt',
        backupData: '{broken',
      },
      {
        label: 'data-less',
        backupData: JSON.stringify({
          task: { ids: [], entities: {} },
          project: { ids: [], entities: {} },
          tag: { ids: [], entities: {} },
          note: { ids: [], entities: {} },
        }),
      },
    ].forEach(({ label, backupData }) => {
      it(`should not restore a ${label} Android backup`, async () => {
        setAndroidMode();
        spyOn(service, 'loadBackupAndroid').and.resolveTo(backupData);

        await service.restoreLatestMobileBackupFromSettings();

        expect(snackServiceSpy.open).toHaveBeenCalledWith({
          type: 'WARNING',
          msg: T.GCF.AUTO_BACKUPS.S_NO_BACKUP_AVAILABLE,
        });
        expect(window.confirm).not.toHaveBeenCalled();
        expect(backupServiceSpy.importCompleteBackup).not.toHaveBeenCalled();
      });
    });

    it('should not import when the restore confirmation is cancelled', async () => {
      setAndroidMode();
      spyOn(service, 'loadBackupAndroid').and.resolveTo(
        JSON.stringify({ task: { ids: ['task1'], entities: {} } }),
      );
      (window.confirm as jasmine.Spy).and.returnValue(false);

      await service.restoreLatestMobileBackupFromSettings();

      expect(window.confirm).toHaveBeenCalled();
      expect(backupServiceSpy.importCompleteBackup).not.toHaveBeenCalled();
    });
  });

  describe('askForFileStoreBackupIfAvailable() — mobile auto-restore (#7901)', () => {
    const setAndroidMode = (): void => {
      (service as unknown as LocalBackupServiceWithPlatformFlags)._isAndroidWebView =
        true;
    };

    beforeEach(() => {
      backupServiceSpy.importCompleteBackup.and.resolveTo();
      (window.confirm as jasmine.Spy).calls.reset();
      snackServiceSpy.open.calls.reset();
      translateServiceSpy.instant.and.callFake((key: string) => key);
      platformServiceSpy.isIOS.and.returnValue(false);
    });

    it('auto-restores a usable backup without confirmation and shows a snack', async () => {
      setAndroidMode();
      const backupData = JSON.stringify({
        task: { ids: ['task1'], entities: {} },
        project: { ids: ['project1'], entities: {} },
      });
      spyOn(service, 'loadBackupAndroid').and.resolveTo(backupData);

      await service.askForFileStoreBackupIfAvailable();

      // No dismissable gate — recovery just happens.
      expect(window.confirm).not.toHaveBeenCalled();
      expect(backupServiceSpy.importCompleteBackup).toHaveBeenCalledWith(
        jasmine.objectContaining({
          task: jasmine.objectContaining({ ids: ['task1'] }),
          project: jasmine.objectContaining({ ids: ['project1'] }),
        }),
        false,
        true,
        true,
      );
      expect(snackServiceSpy.open).toHaveBeenCalledWith({
        type: 'SUCCESS',
        msg: T.GCF.AUTO_BACKUPS.S_AUTO_RESTORED,
        translateParams: { tasks: 1, projects: 1 },
      });
    });

    it('does not show the auto-restore snack when the import fails', async () => {
      setAndroidMode();
      spyOn(service, 'loadBackupAndroid').and.resolveTo(
        JSON.stringify({ task: { ids: ['task1'], entities: {} } }),
      );
      backupServiceSpy.importCompleteBackup.and.rejectWith(new Error('boom'));

      await service.askForFileStoreBackupIfAvailable();

      expect(snackServiceSpy.open).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ msg: T.GCF.AUTO_BACKUPS.S_AUTO_RESTORED }),
      );
    });

    it('falls back to the informed prompt for a non-empty but unusable backup', async () => {
      setAndroidMode();
      spyOn(service, 'loadBackupAndroid').and.resolveTo('{corrupt');
      (window.confirm as jasmine.Spy).and.returnValue(false);

      await service.askForFileStoreBackupIfAvailable();

      expect(window.confirm).toHaveBeenCalled();
      expect(backupServiceSpy.importCompleteBackup).not.toHaveBeenCalled();
    });

    it('does NOT auto-restore a data-less (valid JSON) backup — falls back to prompt', async () => {
      setAndroidMode();
      spyOn(service, 'loadBackupAndroid').and.resolveTo(
        JSON.stringify({
          task: { ids: [], entities: {} },
          project: { ids: [], entities: {} },
          tag: { ids: [], entities: {} },
          note: { ids: [], entities: {} },
        }),
      );
      (window.confirm as jasmine.Spy).and.returnValue(false);

      await service.askForFileStoreBackupIfAvailable();

      // isUsableBackupStr is false → never silently imported.
      expect(window.confirm).toHaveBeenCalled();
      expect(backupServiceSpy.importCompleteBackup).not.toHaveBeenCalled();
      expect(snackServiceSpy.open).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ msg: T.GCF.AUTO_BACKUPS.S_AUTO_RESTORED }),
      );
    });

    it('does NOT auto-restore a SYNC-configured backup — falls back to prompt (#7901)', async () => {
      setAndroidMode();
      // Usable data, but the backup shows sync was enabled: auto-restoring would
      // re-baseline the sync account and could drop other devices' work, so it
      // must require explicit confirmation.
      spyOn(service, 'loadBackupAndroid').and.resolveTo(
        JSON.stringify({
          task: { ids: ['task1'], entities: {} },
          project: { ids: ['project1'], entities: {} },
          globalConfig: { sync: { isEnabled: true, syncProvider: 'WebDAV' } },
        }),
      );
      (window.confirm as jasmine.Spy).and.returnValue(false);

      await service.askForFileStoreBackupIfAvailable();

      expect(window.confirm).toHaveBeenCalled();
      expect(backupServiceSpy.importCompleteBackup).not.toHaveBeenCalled();
      expect(snackServiceSpy.open).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ msg: T.GCF.AUTO_BACKUPS.S_AUTO_RESTORED }),
      );
    });

    it('auto-restores a usable backup whose sync is explicitly disabled', async () => {
      setAndroidMode();
      spyOn(service, 'loadBackupAndroid').and.resolveTo(
        JSON.stringify({
          task: { ids: ['task1'], entities: {} },
          globalConfig: { sync: { isEnabled: false, syncProvider: null } },
        }),
      );

      await service.askForFileStoreBackupIfAvailable();

      expect(window.confirm).not.toHaveBeenCalled();
      expect(backupServiceSpy.importCompleteBackup).toHaveBeenCalled();
    });

    it('does nothing (no prompt, no import) when no backup exists', async () => {
      setAndroidMode();
      spyOn(service, 'loadBackupAndroid').and.resolveTo('');

      await service.askForFileStoreBackupIfAvailable();

      expect(window.confirm).not.toHaveBeenCalled();
      expect(backupServiceSpy.importCompleteBackup).not.toHaveBeenCalled();
      expect(snackServiceSpy.open).not.toHaveBeenCalled();
    });
  });

  describe('getLastBackupTime() (#7901)', () => {
    afterEach(() => {
      localStorage.removeItem(LS.LAST_LOCAL_BACKUP);
    });

    it('returns null when no backup has been recorded', () => {
      localStorage.removeItem(LS.LAST_LOCAL_BACKUP);
      expect(service.getLastBackupTime()).toBeNull();
    });

    it('records the time after a meaningful backup and reads it back', async () => {
      (service as unknown as LocalBackupServiceWithPlatformFlags)._isAndroidWebView =
        true;
      // Resolves true = a real write happened, which is what advances the time.
      spyOn(
        service as unknown as { _backupAndroid: () => Promise<boolean> },
        '_backupAndroid',
      ).and.resolveTo(true);

      await (service as unknown as LocalBackupServiceWithPrivate)._backup();

      const ts = service.getLastBackupTime();
      expect(ts).not.toBeNull();
      expect(Math.abs((ts as number) - Date.now())).toBeLessThan(5000);
    });

    it('does NOT record the time when the A3 guard skips the write (#7925)', async () => {
      localStorage.removeItem(LS.LAST_LOCAL_BACKUP);
      (service as unknown as LocalBackupServiceWithPlatformFlags)._isAndroidWebView =
        true;
      // Resolves false = the near-empty-over-substantial guard skipped the write,
      // so the "last backup" time must stay put (the older backup is still current).
      spyOn(
        service as unknown as { _backupAndroid: () => Promise<boolean> },
        '_backupAndroid',
      ).and.resolveTo(false);

      await (service as unknown as LocalBackupServiceWithPrivate)._backup();

      expect(service.getLastBackupTime()).toBeNull();
    });
  });
});

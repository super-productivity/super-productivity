import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { SyncHydrationService } from '../../persistence/sync-hydration.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { LockService } from '../../sync/lock.service';
import { LOCK_NAMES } from '../../core/operation-log.const';
import { ClientIdService } from '../../../core/util/client-id.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { ValidateStateService } from '../../validation/validate-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { selectSyncConfig } from '../../../features/config/store/global-config.reducer';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { ArchiveModel } from '../../../features/time-tracking/time-tracking.model';
import { ArchiveCompressionService } from '../../../features/archive/archive-compression.service';

describe('Sync hydration archive race integration', () => {
  let hydration: SyncHydrationService;
  let lockService: LockService;
  let archiveDb: ArchiveDbAdapter;
  let opLogStore: OperationLogStoreService;
  let archiveCompression: ArchiveCompressionService;

  const archiveModel = (taskIds: string[]): ArchiveModel =>
    ({
      task: {
        ids: taskIds,
        entities: Object.fromEntries(
          taskIds.map((id) => [id, { id, title: `Archived ${id}`, isDone: true }]),
        ),
      },
      timeTracking: { project: {}, tag: {} },
      lastTimeTrackingFlush: 0,
    }) as unknown as ArchiveModel;

  beforeEach(async () => {
    const clientIdService = jasmine.createSpyObj<ClientIdService>('ClientIdService', [
      'getOrGenerateClientId',
    ]);
    clientIdService.getOrGenerateClientId.and.resolveTo('localClient');
    const vectorClockService = jasmine.createSpyObj<VectorClockService>(
      'VectorClockService',
      ['getCurrentVectorClock'],
    );
    vectorClockService.getCurrentVectorClock.and.resolveTo({ localClient: 1 });
    const validateStateService = jasmine.createSpyObj<ValidateStateService>(
      'ValidateStateService',
      ['validateAndRepair'],
    );
    validateStateService.validateAndRepair.and.resolveTo({
      isValid: true,
      wasRepaired: false,
    });

    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        SyncHydrationService,
        OperationLogStoreService,
        StateSnapshotService,
        ArchiveDbAdapter,
        ArchiveCompressionService,
        LockService,
        { provide: ClientIdService, useValue: clientIdService },
        { provide: VectorClockService, useValue: vectorClockService },
        { provide: ValidateStateService, useValue: validateStateService },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    });

    const store = TestBed.inject(MockStore);
    store.overrideSelector(selectSyncConfig, {
      ...DEFAULT_GLOBAL_CONFIG.sync,
      isEnabled: true,
    });
    hydration = TestBed.inject(SyncHydrationService);
    lockService = TestBed.inject(LockService);
    archiveDb = TestBed.inject(ArchiveDbAdapter);
    opLogStore = TestBed.inject(OperationLogStoreService);
    archiveCompression = TestBed.inject(ArchiveCompressionService);

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    await archiveDb.saveArchiveYoung(archiveModel(['initial']));
    await archiveDb.saveArchiveOld(archiveModel([]));
  });

  it('prevents archive compression from overwriting downloaded archives with a stale read', async () => {
    let signalLocalRead!: () => void;
    const localRead = new Promise<void>((resolve) => {
      signalLocalRead = resolve;
    });
    let releaseLocalSave!: () => void;
    const localSaveMayContinue = new Promise<void>((resolve) => {
      releaseLocalSave = resolve;
    });

    const realSaveArchivesAtomic = archiveDb.saveArchivesAtomic.bind(archiveDb);
    spyOn(archiveDb, 'saveArchivesAtomic').and.callFake(async (young, old) => {
      signalLocalRead();
      await localSaveMayContinue;
      await realSaveArchivesAtomic(young, old);
    });

    const localMutation = archiveCompression.compressArchive(Date.now());
    await localRead;

    const realSaveArchiveYoung = archiveDb.saveArchiveYoung.bind(archiveDb);
    let remoteWriteStarted = false;
    spyOn(archiveDb, 'saveArchiveYoung').and.callFake(async (archive) => {
      if (archive.task.ids.includes('remote')) remoteWriteStarted = true;
      await realSaveArchiveYoung(archive);
    });

    const realLockRequest = lockService.request.bind(lockService);
    let signalHydrationLockRequest!: () => void;
    const hydrationLockRequested = new Promise<void>((resolve) => {
      signalHydrationLockRequest = resolve;
    });
    spyOn(lockService, 'request').and.callFake(
      <T>(
        lockName: string,
        callback: () => Promise<T>,
        timeoutMs?: number,
      ): Promise<T> => {
        if (lockName === LOCK_NAMES.TASK_ARCHIVE) signalHydrationLockRequest();
        return realLockRequest(lockName, callback, timeoutMs);
      },
    );

    const remoteArchive = archiveModel(['remote']);
    const hydrationPromise = hydration.hydrateFromRemoteSync(
      {
        globalConfig: DEFAULT_GLOBAL_CONFIG,
        archiveYoung: remoteArchive,
        archiveOld: archiveModel([]),
      },
      { remote: 1 },
      false,
    );

    await hydrationLockRequested;
    expect(remoteWriteStarted).toBeFalse();

    releaseLocalSave();
    await Promise.all([localMutation, hydrationPromise]);

    expect(remoteWriteStarted).toBeTrue();
    expect((await archiveDb.loadArchiveYoung())!.task.ids).toEqual(['remote']);
    const stateCache = await opLogStore.loadStateCache();
    const cachedState = stateCache?.state as { archiveYoung: ArchiveModel } | undefined;
    expect(cachedState?.archiveYoung.task.ids).toEqual(['remote']);
  });

  it('prevents archive compression from overwriting an op-log state replacement', async () => {
    let signalLocalRead!: () => void;
    const localRead = new Promise<void>((resolve) => {
      signalLocalRead = resolve;
    });
    let releaseLocalSave!: () => void;
    const localSaveMayContinue = new Promise<void>((resolve) => {
      releaseLocalSave = resolve;
    });

    const realSaveArchivesAtomic = archiveDb.saveArchivesAtomic.bind(archiveDb);
    spyOn(archiveDb, 'saveArchivesAtomic').and.callFake(async (young, old) => {
      signalLocalRead();
      await localSaveMayContinue;
      await realSaveArchivesAtomic(young, old);
    });

    const localMutation = archiveCompression.compressArchive(Date.now());
    await localRead;

    const realLockRequest = lockService.request.bind(lockService);
    let signalReplacementLockRequest!: () => void;
    const replacementLockRequested = new Promise<void>((resolve) => {
      signalReplacementLockRequest = resolve;
    });
    spyOn(lockService, 'request').and.callFake(
      <T>(
        lockName: string,
        callback: () => Promise<T>,
        timeoutMs?: number,
      ): Promise<T> => {
        if (lockName === LOCK_NAMES.TASK_ARCHIVE) signalReplacementLockRequest();
        return realLockRequest(lockName, callback, timeoutMs);
      },
    );

    const remoteArchive = archiveModel(['replacement']);
    const replacement = opLogStore.runRemoteStateReplacement({
      baselineState: {
        globalConfig: DEFAULT_GLOBAL_CONFIG,
        archiveYoung: remoteArchive,
        archiveOld: archiveModel([]),
      },
      vectorClock: { remote: 2 },
      schemaVersion: 1,
      snapshotEntityKeys: [],
      archiveYoung: remoteArchive,
      archiveOld: archiveModel([]),
    });

    await replacementLockRequested;
    expect((await archiveDb.loadArchiveYoung())!.task.ids).toEqual(['initial']);

    releaseLocalSave();
    await Promise.all([localMutation, replacement]);

    expect((await archiveDb.loadArchiveYoung())!.task.ids).toEqual(['replacement']);
    const stateCache = await opLogStore.loadStateCache();
    const cachedState = stateCache?.state as { archiveYoung: ArchiveModel } | undefined;
    expect(cachedState?.archiveYoung.task.ids).toEqual(['replacement']);
  });
});

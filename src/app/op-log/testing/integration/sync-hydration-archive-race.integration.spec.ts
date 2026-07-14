import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { LockService } from '../../sync/lock.service';
import { LOCK_NAMES } from '../../core/operation-log.const';
import { ClientIdService } from '../../../core/util/client-id.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { ArchiveModel } from '../../../features/time-tracking/time-tracking.model';
import { ArchiveCompressionService } from '../../../features/archive/archive-compression.service';

/**
 * Guards this PR's fix: archive read-modify-write (compression) must serialize
 * against the op-log full-state replacement writer via LOCK_NAMES.TASK_ARCHIVE,
 * so a stale local read can never save over a downloaded/replaced archive.
 *
 * The sibling race on the SyncHydrationService.hydrateFromRemoteSync path is
 * fixed and covered separately in PR #9010 (fix/8960-hydration-race), which adds
 * the hydration-side TASK_ARCHIVE lock and its own sync-hydration.service.spec.
 */
describe('Archive compression vs op-log state replacement race', () => {
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
      'loadClientId',
      'getOrGenerateClientId',
      'clearCache',
    ]);
    clientIdService.loadClientId.and.resolveTo('localClient');
    clientIdService.getOrGenerateClientId.and.resolveTo('localClient');

    TestBed.configureTestingModule({
      providers: [
        provideMockStore(),
        OperationLogStoreService,
        ArchiveDbAdapter,
        ArchiveCompressionService,
        LockService,
        { provide: ClientIdService, useValue: clientIdService },
      ],
    });

    lockService = TestBed.inject(LockService);
    archiveDb = TestBed.inject(ArchiveDbAdapter);
    opLogStore = TestBed.inject(OperationLogStoreService);
    archiveCompression = TestBed.inject(ArchiveCompressionService);

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    await archiveDb.saveArchiveYoung(archiveModel(['initial']));
    await archiveDb.saveArchiveOld(archiveModel([]));
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

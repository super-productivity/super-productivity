import { TestBed } from '@angular/core/testing';
import { ArchiveCompressionService } from './archive-compression.service';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { ArchiveModel } from './archive.model';
import { LockService } from '../../op-log/sync/lock.service';
import { LOCK_NAMES } from '../../op-log/core/operation-log.const';

const emptyArchive = (): ArchiveModel => ({
  task: { ids: [], entities: {} },
  timeTracking: { project: {}, tag: {} },
  lastTimeTrackingFlush: 0,
});

describe('ArchiveCompressionService', () => {
  let service: ArchiveCompressionService;
  let archiveDbAdapterMock: jasmine.SpyObj<ArchiveDbAdapter>;
  let lockServiceMock: jasmine.SpyObj<LockService>;

  beforeEach(() => {
    archiveDbAdapterMock = jasmine.createSpyObj<ArchiveDbAdapter>('ArchiveDbAdapter', [
      'loadArchiveYoung',
      'loadArchiveOld',
      'saveArchiveYoung',
      'saveArchiveOld',
      'saveArchivesAtomic',
    ]);
    archiveDbAdapterMock.loadArchiveYoung.and.resolveTo(emptyArchive());
    archiveDbAdapterMock.loadArchiveOld.and.resolveTo(emptyArchive());
    archiveDbAdapterMock.saveArchiveYoung.and.resolveTo(undefined);
    archiveDbAdapterMock.saveArchiveOld.and.resolveTo(undefined);
    archiveDbAdapterMock.saveArchivesAtomic.and.resolveTo(undefined);
    lockServiceMock = jasmine.createSpyObj<LockService>('LockService', ['request']);
    lockServiceMock.request.and.callFake(async (_name, callback) => callback());

    TestBed.configureTestingModule({
      providers: [
        ArchiveCompressionService,
        { provide: ArchiveDbAdapter, useValue: archiveDbAdapterMock },
        { provide: LockService, useValue: lockServiceMock },
      ],
    });

    service = TestBed.inject(ArchiveCompressionService);
  });

  // Issue #8843: compressArchive wrote archiveYoung and archiveOld as two
  // independent transactions. A crash between them left a half-compressed
  // archive, and since compression is op-replayed on other clients, a torn
  // local result diverged from replicas. Both archives must be written in a
  // single atomic transaction via the existing saveArchivesAtomic API.
  describe('compressArchive atomic write (#8843)', () => {
    it('persists both archives via saveArchivesAtomic', async () => {
      await service.compressArchive(Date.now());

      expect(archiveDbAdapterMock.saveArchivesAtomic).toHaveBeenCalledTimes(1);
      const [youngArg, oldArg] =
        archiveDbAdapterMock.saveArchivesAtomic.calls.mostRecent().args;
      expect(youngArg.task).toEqual({ ids: [], entities: {} });
      expect(oldArg.task).toEqual({ ids: [], entities: {} });
    });

    it('does not write the archives as two independent transactions', async () => {
      await service.compressArchive(Date.now());

      expect(archiveDbAdapterMock.saveArchiveYoung).not.toHaveBeenCalled();
      expect(archiveDbAdapterMock.saveArchiveOld).not.toHaveBeenCalled();
    });

    it('serializes the complete read-modify-write behind TASK_ARCHIVE', async () => {
      const callOrder: string[] = [];
      lockServiceMock.request.and.callFake(
        async <T>(_name: string, callback: () => Promise<T>): Promise<T> => {
          callOrder.push('lock-start');
          const result = await callback();
          callOrder.push('lock-end');
          return result;
        },
      );
      archiveDbAdapterMock.loadArchiveYoung.and.callFake(async () => {
        callOrder.push('load-young');
        return emptyArchive();
      });
      archiveDbAdapterMock.loadArchiveOld.and.callFake(async () => {
        callOrder.push('load-old');
        return emptyArchive();
      });
      archiveDbAdapterMock.saveArchivesAtomic.and.callFake(async () => {
        callOrder.push('save');
      });

      await service.compressArchive(Date.now());

      expect(lockServiceMock.request).toHaveBeenCalledOnceWith(
        LOCK_NAMES.TASK_ARCHIVE,
        jasmine.any(Function),
      );
      expect(callOrder[0]).toBe('lock-start');
      expect(callOrder.at(-1)).toBe('lock-end');
      expect(callOrder.indexOf('load-young')).toBeGreaterThan(0);
      expect(callOrder.indexOf('load-old')).toBeGreaterThan(0);
      expect(callOrder.indexOf('save')).toBeLessThan(callOrder.indexOf('lock-end'));
    });
  });
});

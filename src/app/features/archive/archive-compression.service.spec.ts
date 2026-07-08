import { TestBed } from '@angular/core/testing';
import { ArchiveCompressionService } from './archive-compression.service';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { ArchiveModel } from './archive.model';

const emptyArchive = (): ArchiveModel => ({
  task: { ids: [], entities: {} },
  timeTracking: { project: {}, tag: {} },
  lastTimeTrackingFlush: 0,
});

describe('ArchiveCompressionService', () => {
  let service: ArchiveCompressionService;
  let archiveDbAdapterMock: jasmine.SpyObj<ArchiveDbAdapter>;

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

    TestBed.configureTestingModule({
      providers: [
        ArchiveCompressionService,
        { provide: ArchiveDbAdapter, useValue: archiveDbAdapterMock },
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
  });
});

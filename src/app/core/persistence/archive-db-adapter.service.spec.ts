import { TestBed } from '@angular/core/testing';
import { ArchiveDbAdapter } from './archive-db-adapter.service';
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';

describe('ArchiveDbAdapter', () => {
  let adapter: ArchiveDbAdapter;
  let archiveStoreMock: jasmine.SpyObj<ArchiveStoreService>;

  beforeEach(() => {
    archiveStoreMock = jasmine.createSpyObj<ArchiveStoreService>('ArchiveStoreService', [
      'loadArchiveYoung',
      'saveArchiveYoung',
      'loadArchiveOld',
      'saveArchiveOld',
      'saveArchivesAtomic',
    ]);

    TestBed.configureTestingModule({
      providers: [
        ArchiveDbAdapter,
        { provide: ArchiveStoreService, useValue: archiveStoreMock },
      ],
    });

    adapter = TestBed.inject(ArchiveDbAdapter);
  });

  // Regression coverage for issue #7487: a malformed archive blob (missing `task`,
  // `task: null`, or non-array `task.ids`) was being written verbatim by
  // SyncHydrationService and crashed every subsequent reader on `archive.task.entities`.
  // The adapter now normalizes these shapes at the read boundary.
  describe('issue #7487 — normalize malformed archives', () => {
    it('returns undefined verbatim when nothing is stored', async () => {
      archiveStoreMock.loadArchiveYoung.and.resolveTo(undefined);

      const result = await adapter.loadArchiveYoung();

      expect(result).toBeUndefined();
    });

    it('returns valid archives unchanged', async () => {
      const valid: ArchiveModel = {
        task: { ids: ['t1'], entities: { t1: { id: 't1' } as any } },
        timeTracking: { project: {}, tag: {} },
        lastTimeTrackingFlush: 123,
      };
      archiveStoreMock.loadArchiveYoung.and.resolveTo(valid);

      const result = await adapter.loadArchiveYoung();

      expect(result).toBe(valid);
    });

    it('repairs missing task field while preserving timeTracking', async () => {
      const corrupt = {
        timeTracking: { project: { p1: { foo: 'bar' } }, tag: {} },
        lastTimeTrackingFlush: 99,
      } as unknown as ArchiveModel;
      archiveStoreMock.loadArchiveYoung.and.resolveTo(corrupt);

      const result = await adapter.loadArchiveYoung();

      expect(result).toBeDefined();
      expect(result!.task).toEqual({ ids: [], entities: {} });
      expect(result!.timeTracking).toEqual(corrupt.timeTracking);
      expect(result!.lastTimeTrackingFlush).toBe(99);
    });

    it('repairs task: null', async () => {
      archiveStoreMock.loadArchiveOld.and.resolveTo({
        task: null,
        timeTracking: { project: {}, tag: {} },
      } as unknown as ArchiveModel);

      const result = await adapter.loadArchiveOld();

      expect(result!.task).toEqual({ ids: [], entities: {} });
    });

    it('repairs non-array task.ids', async () => {
      archiveStoreMock.loadArchiveYoung.and.resolveTo({
        task: { ids: 'not-an-array', entities: {} },
        timeTracking: { project: {}, tag: {} },
      } as unknown as ArchiveModel);

      const result = await adapter.loadArchiveYoung();

      expect(result!.task).toEqual({ ids: [], entities: {} });
    });

    it('repairs missing task.entities', async () => {
      archiveStoreMock.loadArchiveYoung.and.resolveTo({
        task: { ids: [] },
        timeTracking: { project: {}, tag: {} },
      } as unknown as ArchiveModel);

      const result = await adapter.loadArchiveYoung();

      expect(result!.task).toEqual({ ids: [], entities: {} });
    });

    it('repairs missing timeTracking while preserving valid task', async () => {
      const validTask = { ids: ['t1'], entities: { t1: { id: 't1' } as any } };
      archiveStoreMock.loadArchiveYoung.and.resolveTo({
        task: validTask,
      } as unknown as ArchiveModel);

      const result = await adapter.loadArchiveYoung();

      expect(result!.task).toBe(validTask);
      expect(result!.timeTracking).toEqual({ project: {}, tag: {} });
    });

    it('repairs timeTracking with missing tag bucket', async () => {
      archiveStoreMock.loadArchiveOld.and.resolveTo({
        task: { ids: [], entities: {} },
        timeTracking: { project: {} },
      } as unknown as ArchiveModel);

      const result = await adapter.loadArchiveOld();

      expect(result!.timeTracking).toEqual({ project: {}, tag: {} });
    });
  });
});

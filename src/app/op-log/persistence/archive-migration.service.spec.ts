/* eslint-disable @typescript-eslint/naming-convention */
import { TestBed } from '@angular/core/testing';
import { ArchiveMigrationService } from './archive-migration.service';
import { ArchiveStoreService } from './archive-store.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';

describe('ArchiveMigrationService', () => {
  let service: ArchiveMigrationService;
  let mockArchiveStore: jasmine.SpyObj<ArchiveStoreService>;
  let mockLegacyPfDb: jasmine.SpyObj<LegacyPfDbService>;

  const createEmptyArchive = (): ArchiveModel => ({
    task: {
      ids: [],
      entities: {},
    },
    timeTracking: {
      project: {},
      tag: {},
    },
    lastTimeTrackingFlush: 0,
  });

  const createArchiveWithTasks = (): ArchiveModel => ({
    task: {
      ids: ['task-1', 'task-2'],
      entities: {
        'task-1': { id: 'task-1', title: 'Test task 1' } as any,
        'task-2': { id: 'task-2', title: 'Test task 2' } as any,
      },
    },
    timeTracking: {
      project: {},
      tag: {},
    },
    lastTimeTrackingFlush: 0,
  });

  const createArchiveWithTimeTracking = (): ArchiveModel => ({
    task: {
      ids: [],
      entities: {},
    },
    timeTracking: {
      project: {
        'project-1': {
          '2024-01-01': { s: 3600000 },
        },
      },
      tag: {},
    },
    lastTimeTrackingFlush: Date.now(),
  });

  beforeEach(() => {
    mockArchiveStore = jasmine.createSpyObj('ArchiveStoreService', [
      'hasArchiveYoung',
      'hasArchiveOld',
      'saveArchiveYoung',
      'saveArchiveOld',
    ]);
    mockLegacyPfDb = jasmine.createSpyObj('LegacyPfDbService', [
      'databaseExists',
      'loadArchiveYoung',
      'loadArchiveOld',
    ]);

    TestBed.configureTestingModule({
      providers: [
        ArchiveMigrationService,
        { provide: ArchiveStoreService, useValue: mockArchiveStore },
        { provide: LegacyPfDbService, useValue: mockLegacyPfDb },
      ],
    });

    service = TestBed.inject(ArchiveMigrationService);
  });

  describe('migrateArchivesIfNeeded', () => {
    it('should skip migration if archives already exist in SUP_OPS', async () => {
      mockArchiveStore.hasArchiveYoung.and.resolveTo(true);
      mockArchiveStore.hasArchiveOld.and.resolveTo(true);

      const result = await service.migrateArchivesIfNeeded();

      expect(result).toBe(false);
      expect(mockLegacyPfDb.databaseExists).not.toHaveBeenCalled();
      expect(mockArchiveStore.saveArchiveYoung).not.toHaveBeenCalled();
      expect(mockArchiveStore.saveArchiveOld).not.toHaveBeenCalled();
    });

    it('should skip migration if no legacy database exists', async () => {
      mockArchiveStore.hasArchiveYoung.and.resolveTo(false);
      mockArchiveStore.hasArchiveOld.and.resolveTo(false);
      mockLegacyPfDb.databaseExists.and.resolveTo(false);

      const result = await service.migrateArchivesIfNeeded();

      expect(result).toBe(false);
      expect(mockLegacyPfDb.loadArchiveYoung).not.toHaveBeenCalled();
      expect(mockLegacyPfDb.loadArchiveOld).not.toHaveBeenCalled();
    });

    it('should migrate only archiveYoung when archiveOld already exists', async () => {
      const legacyYoung = createArchiveWithTasks();
      mockArchiveStore.hasArchiveYoung.and.resolveTo(false);
      mockArchiveStore.hasArchiveOld.and.resolveTo(true);
      mockLegacyPfDb.databaseExists.and.resolveTo(true);
      mockLegacyPfDb.loadArchiveYoung.and.resolveTo(legacyYoung);
      mockLegacyPfDb.loadArchiveOld.and.resolveTo(createEmptyArchive());
      mockArchiveStore.saveArchiveYoung.and.resolveTo();

      const result = await service.migrateArchivesIfNeeded();

      expect(result).toBe(true);
      expect(mockArchiveStore.saveArchiveYoung).toHaveBeenCalledWith(legacyYoung);
      expect(mockArchiveStore.saveArchiveOld).not.toHaveBeenCalled();
    });

    it('should migrate only archiveOld when archiveYoung already exists', async () => {
      const legacyOld = createArchiveWithTasks();
      mockArchiveStore.hasArchiveYoung.and.resolveTo(true);
      mockArchiveStore.hasArchiveOld.and.resolveTo(false);
      mockLegacyPfDb.databaseExists.and.resolveTo(true);
      mockLegacyPfDb.loadArchiveYoung.and.resolveTo(createEmptyArchive());
      mockLegacyPfDb.loadArchiveOld.and.resolveTo(legacyOld);
      mockArchiveStore.saveArchiveOld.and.resolveTo();

      const result = await service.migrateArchivesIfNeeded();

      expect(result).toBe(true);
      expect(mockArchiveStore.saveArchiveYoung).not.toHaveBeenCalled();
      expect(mockArchiveStore.saveArchiveOld).toHaveBeenCalledWith(legacyOld);
    });

    it('should migrate both archives when neither exists in SUP_OPS', async () => {
      const legacyYoung = createArchiveWithTasks();
      const legacyOld = createArchiveWithTimeTracking();
      mockArchiveStore.hasArchiveYoung.and.resolveTo(false);
      mockArchiveStore.hasArchiveOld.and.resolveTo(false);
      mockLegacyPfDb.databaseExists.and.resolveTo(true);
      mockLegacyPfDb.loadArchiveYoung.and.resolveTo(legacyYoung);
      mockLegacyPfDb.loadArchiveOld.and.resolveTo(legacyOld);
      mockArchiveStore.saveArchiveYoung.and.resolveTo();
      mockArchiveStore.saveArchiveOld.and.resolveTo();

      const result = await service.migrateArchivesIfNeeded();

      expect(result).toBe(true);
      expect(mockArchiveStore.saveArchiveYoung).toHaveBeenCalledWith(legacyYoung);
      expect(mockArchiveStore.saveArchiveOld).toHaveBeenCalledWith(legacyOld);
    });

    it('should skip saving empty archives from legacy database', async () => {
      mockArchiveStore.hasArchiveYoung.and.resolveTo(false);
      mockArchiveStore.hasArchiveOld.and.resolveTo(false);
      mockLegacyPfDb.databaseExists.and.resolveTo(true);
      mockLegacyPfDb.loadArchiveYoung.and.resolveTo(createEmptyArchive());
      mockLegacyPfDb.loadArchiveOld.and.resolveTo(createEmptyArchive());

      const result = await service.migrateArchivesIfNeeded();

      expect(result).toBe(true);
      expect(mockArchiveStore.saveArchiveYoung).not.toHaveBeenCalled();
      expect(mockArchiveStore.saveArchiveOld).not.toHaveBeenCalled();
    });

    it('should skip saving null archives from legacy database', async () => {
      mockArchiveStore.hasArchiveYoung.and.resolveTo(false);
      mockArchiveStore.hasArchiveOld.and.resolveTo(false);
      mockLegacyPfDb.databaseExists.and.resolveTo(true);
      mockLegacyPfDb.loadArchiveYoung.and.resolveTo(null as any);
      mockLegacyPfDb.loadArchiveOld.and.resolveTo(null as any);

      const result = await service.migrateArchivesIfNeeded();

      expect(result).toBe(true);
      expect(mockArchiveStore.saveArchiveYoung).not.toHaveBeenCalled();
      expect(mockArchiveStore.saveArchiveOld).not.toHaveBeenCalled();
    });
  });

  describe('_hasArchiveData (via migrateArchivesIfNeeded)', () => {
    beforeEach(() => {
      mockArchiveStore.hasArchiveYoung.and.resolveTo(false);
      mockArchiveStore.hasArchiveOld.and.resolveTo(true); // Only check young
      mockLegacyPfDb.databaseExists.and.resolveTo(true);
      mockArchiveStore.saveArchiveYoung.and.resolveTo();
    });

    it('should detect archive with task data', async () => {
      const archiveWithTasks = createArchiveWithTasks();
      mockLegacyPfDb.loadArchiveYoung.and.resolveTo(archiveWithTasks);
      mockLegacyPfDb.loadArchiveOld.and.resolveTo(createEmptyArchive());

      await service.migrateArchivesIfNeeded();

      expect(mockArchiveStore.saveArchiveYoung).toHaveBeenCalledWith(archiveWithTasks);
    });

    it('should detect archive with project time-tracking data', async () => {
      const archiveWithTimeTracking = createArchiveWithTimeTracking();
      mockLegacyPfDb.loadArchiveYoung.and.resolveTo(archiveWithTimeTracking);
      mockLegacyPfDb.loadArchiveOld.and.resolveTo(createEmptyArchive());

      await service.migrateArchivesIfNeeded();

      expect(mockArchiveStore.saveArchiveYoung).toHaveBeenCalledWith(
        archiveWithTimeTracking,
      );
    });

    it('should detect archive with tag time-tracking data', async () => {
      const archiveWithTagTimeTracking: ArchiveModel = {
        task: {
          ids: [],
          entities: {},
        },
        timeTracking: {
          project: {},
          tag: {
            'tag-1': {
              '2024-01-01': { s: 1800000 },
            },
          },
        },
        lastTimeTrackingFlush: Date.now(),
      };
      mockLegacyPfDb.loadArchiveYoung.and.resolveTo(archiveWithTagTimeTracking);
      mockLegacyPfDb.loadArchiveOld.and.resolveTo(createEmptyArchive());

      await service.migrateArchivesIfNeeded();

      expect(mockArchiveStore.saveArchiveYoung).toHaveBeenCalledWith(
        archiveWithTagTimeTracking,
      );
    });

    it('should not detect archive with empty task ids array', async () => {
      const archiveWithEmptyTasks: ArchiveModel = {
        task: {
          ids: [],
          entities: { 'task-1': {} as any }, // Has entities but no ids
        },
        timeTracking: {
          project: {},
          tag: {},
        },
        lastTimeTrackingFlush: 0,
      };
      mockLegacyPfDb.loadArchiveYoung.and.resolveTo(archiveWithEmptyTasks);
      mockLegacyPfDb.loadArchiveOld.and.resolveTo(createEmptyArchive());

      await service.migrateArchivesIfNeeded();

      expect(mockArchiveStore.saveArchiveYoung).not.toHaveBeenCalled();
    });

    it('should not detect archive with missing task property', async () => {
      const archiveWithMissingTask = {
        timeTracking: {
          project: {},
          tag: {},
        },
      } as ArchiveModel;
      mockLegacyPfDb.loadArchiveYoung.and.resolveTo(archiveWithMissingTask);
      mockLegacyPfDb.loadArchiveOld.and.resolveTo(createEmptyArchive());

      await service.migrateArchivesIfNeeded();

      expect(mockArchiveStore.saveArchiveYoung).not.toHaveBeenCalled();
    });
  });
});

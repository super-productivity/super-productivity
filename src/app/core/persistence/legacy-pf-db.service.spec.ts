import { TestBed } from '@angular/core/testing';
import { LegacyPfDbService } from './legacy-pf-db.service';

describe('LegacyPfDbService', () => {
  let service: LegacyPfDbService;
  let mockDb: {
    get: jasmine.Spy;
    put: jasmine.Spy;
    delete: jasmine.Spy;
    getAllKeys: jasmine.Spy;
    transaction: jasmine.Spy;
    close: jasmine.Spy;
  };

  beforeEach(() => {
    mockDb = {
      get: jasmine.createSpy('get'),
      put: jasmine.createSpy('put'),
      delete: jasmine.createSpy('delete'),
      getAllKeys: jasmine.createSpy('getAllKeys'),
      transaction: jasmine.createSpy('transaction'),
      close: jasmine.createSpy('close'),
    };

    TestBed.configureTestingModule({
      providers: [LegacyPfDbService],
    });
    service = TestBed.inject(LegacyPfDbService);

    // Spy on the private _openDb method to return our mock
    spyOn<any>(service, '_openDb').and.resolveTo(mockDb);
  });

  describe('load', () => {
    it('should load data from the database by key', async () => {
      const mockData = { id: 'test', value: 'data' };
      mockDb.get.and.resolveTo(mockData);

      const result = await service.load('testKey');

      expect((service as any)._openDb).toHaveBeenCalled();
      expect(mockDb.get).toHaveBeenCalledWith('main', 'testKey');
      expect(mockDb.close).toHaveBeenCalled();
      expect(result).toEqual(mockData);
    });

    it('should return null if key does not exist', async () => {
      mockDb.get.and.resolveTo(undefined);

      const result = await service.load('nonExistentKey');

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockDb.get.and.rejectWith(new Error('DB error'));

      const result = await service.load('testKey');

      expect(result).toBeNull();
    });
  });

  describe('save', () => {
    it('should save data to the database', async () => {
      const mockData = { id: 'test', value: 'data' };
      mockDb.put.and.resolveTo(undefined);

      await service.save('testKey', mockData);

      expect(mockDb.put).toHaveBeenCalledWith('main', mockData, 'testKey');
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should not throw on error', async () => {
      mockDb.put.and.rejectWith(new Error('DB error'));

      await expectAsync(service.save('testKey', {})).toBeResolved();
    });
  });

  describe('hasUsableEntityData', () => {
    it('should return true if task data exists with non-empty ids', async () => {
      mockDb.get.and.callFake((_store: string, key: string) => {
        if (key === 'task') return Promise.resolve({ ids: ['t1', 't2'], entities: {} });
        if (key === 'project') return Promise.resolve({ ids: [], entities: {} });
        if (key === 'globalConfig') return Promise.resolve(null);
        return Promise.resolve(null);
      });

      const result = await service.hasUsableEntityData();

      expect(result).toBe(true);
    });

    it('should return true if project data exists with non-empty ids', async () => {
      mockDb.get.and.callFake((_store: string, key: string) => {
        if (key === 'task') return Promise.resolve({ ids: [], entities: {} });
        if (key === 'project') return Promise.resolve({ ids: ['p1'], entities: {} });
        if (key === 'globalConfig') return Promise.resolve(null);
        return Promise.resolve(null);
      });

      const result = await service.hasUsableEntityData();

      expect(result).toBe(true);
    });

    it('should return true if globalConfig exists', async () => {
      mockDb.get.and.callFake((_store: string, key: string) => {
        if (key === 'task') return Promise.resolve(null);
        if (key === 'project') return Promise.resolve(null);
        if (key === 'globalConfig')
          return Promise.resolve({ misc: { isDarkMode: true } });
        return Promise.resolve(null);
      });

      const result = await service.hasUsableEntityData();

      expect(result).toBe(true);
    });

    it('should return false if no usable data exists', async () => {
      mockDb.get.and.callFake((_store: string, key: string) => {
        if (key === 'task') return Promise.resolve({ ids: [], entities: {} });
        if (key === 'project') return Promise.resolve(null);
        if (key === 'globalConfig') return Promise.resolve(null);
        return Promise.resolve(null);
      });

      const result = await service.hasUsableEntityData();

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      ((service as any)._openDb as jasmine.Spy).and.rejectWith(new Error('DB error'));

      const result = await service.hasUsableEntityData();

      expect(result).toBe(false);
    });
  });

  describe('loadAllEntityData', () => {
    it('should load all model keys from database', async () => {
      mockDb.get.and.callFake((_store: string, key: string) => {
        if (key === 'task')
          return Promise.resolve({ ids: ['t1'], entities: { t1: { id: 't1' } } });
        if (key === 'project')
          return Promise.resolve({ ids: ['p1'], entities: { p1: { id: 'p1' } } });
        return Promise.resolve(null);
      });

      const result = await service.loadAllEntityData();

      // Check that data was loaded correctly
      expect((result.task as any).ids).toEqual(['t1']);
      expect((result.project as any).ids).toEqual(['p1']);
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should throw on error', async () => {
      ((service as any)._openDb as jasmine.Spy).and.rejectWith(new Error('DB error'));

      await expectAsync(service.loadAllEntityData()).toBeRejectedWithError('DB error');
    });
  });

  describe('loadMetaModel', () => {
    it('should load META_MODEL from database', async () => {
      const mockMeta = { vectorClock: { client1: 5 }, lastUpdate: Date.now() };
      mockDb.get.and.resolveTo(mockMeta);

      const result = await service.loadMetaModel();

      expect(mockDb.get).toHaveBeenCalledWith('main', 'META_MODEL');
      expect(result).toEqual(mockMeta);
    });

    it('should return empty object if META_MODEL does not exist', async () => {
      mockDb.get.and.resolveTo(undefined);

      const result = await service.loadMetaModel();

      expect(result).toEqual({});
    });

    it('should return empty object on error', async () => {
      mockDb.get.and.rejectWith(new Error('DB error'));

      const result = await service.loadMetaModel();

      expect(result).toEqual({});
    });
  });

  describe('loadClientId', () => {
    it('should load CLIENT_ID from database', async () => {
      mockDb.get.and.resolveTo('client-123');

      const result = await service.loadClientId();

      expect(mockDb.get).toHaveBeenCalledWith('main', 'CLIENT_ID');
      expect(result).toBe('client-123');
    });

    it('should return null if CLIENT_ID does not exist', async () => {
      mockDb.get.and.resolveTo(undefined);

      const result = await service.loadClientId();

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockDb.get.and.rejectWith(new Error('DB error'));

      const result = await service.loadClientId();

      expect(result).toBeNull();
    });
  });

  describe('loadArchiveYoung / loadArchiveOld', () => {
    it('should load archiveYoung from database', async () => {
      const mockArchive = {
        task: { ids: ['t1'], entities: { t1: { id: 't1' } } },
        timeTracking: { ids: [], entities: {} },
        lastTimeTrackingFlush: 123,
      };
      mockDb.get.and.resolveTo(mockArchive);

      const result = await service.loadArchiveYoung();

      expect(mockDb.get).toHaveBeenCalledWith('main', 'archiveYoung');
      expect(result.task.ids).toEqual(['t1']);
      expect(result.lastTimeTrackingFlush).toBe(123);
    });

    it('should return default archive if archiveYoung does not exist', async () => {
      mockDb.get.and.resolveTo(undefined);

      const result = await service.loadArchiveYoung();

      expect(result.task).toEqual({ ids: [], entities: {} });
      expect(result.lastTimeTrackingFlush).toBe(0);
    });

    it('should load archiveOld from database', async () => {
      const mockArchive = {
        task: { ids: ['t2'], entities: { t2: { id: 't2' } } },
        timeTracking: { ids: [], entities: {} },
        lastTimeTrackingFlush: 456,
      };
      mockDb.get.and.resolveTo(mockArchive);

      const result = await service.loadArchiveOld();

      expect(mockDb.get).toHaveBeenCalledWith('main', 'archiveOld');
      expect(result.task.ids).toEqual(['t2']);
      expect(result.lastTimeTrackingFlush).toBe(456);
    });
  });

  describe('acquireMigrationLock / releaseMigrationLock', () => {
    it('should acquire lock when no existing lock', async () => {
      mockDb.get.and.resolveTo(undefined);
      mockDb.put.and.resolveTo(undefined);

      const result = await service.acquireMigrationLock();

      expect(result).toBe(true);
      expect(mockDb.put).toHaveBeenCalledWith(
        'main',
        jasmine.objectContaining({
          timestamp: jasmine.any(Number),
          tabId: jasmine.any(String),
        }),
        '_migration_lock',
      );
    });

    it('should not acquire lock when another tab holds valid lock', async () => {
      mockDb.get.and.resolveTo({
        timestamp: Date.now(), // Recent timestamp
        tabId: 'other-tab-id',
      });

      const result = await service.acquireMigrationLock();

      expect(result).toBe(false);
      expect(mockDb.put).not.toHaveBeenCalled();
    });

    it('should acquire lock when existing lock is expired', async () => {
      mockDb.get.and.resolveTo({
        timestamp: Date.now() - 120000, // 2 minutes ago (expired)
        tabId: 'other-tab-id',
      });
      mockDb.put.and.resolveTo(undefined);

      const result = await service.acquireMigrationLock();

      expect(result).toBe(true);
      expect(mockDb.put).toHaveBeenCalled();
    });

    it('should release lock when tab owns it', async () => {
      // First acquire the lock to set up the tabId
      mockDb.get.and.resolveTo(undefined);
      mockDb.put.and.resolveTo(undefined);
      await service.acquireMigrationLock();

      // Now mock the get to return a lock with this service's tabId
      const tabId = (service as any)._tabId;
      mockDb.get.and.resolveTo({
        timestamp: Date.now(),
        tabId,
      });
      mockDb.delete.and.resolveTo(undefined);

      await service.releaseMigrationLock();

      expect(mockDb.delete).toHaveBeenCalledWith('main', '_migration_lock');
    });

    it('should not release lock when another tab owns it', async () => {
      mockDb.get.and.resolveTo({
        timestamp: Date.now(),
        tabId: 'other-tab-id',
      });
      mockDb.delete.and.resolveTo(undefined);

      await service.releaseMigrationLock();

      expect(mockDb.delete).not.toHaveBeenCalled();
    });
  });

  describe('clearAll', () => {
    it('should clear all data from the database', async () => {
      const mockStore = {
        clear: jasmine.createSpy('clear').and.resolveTo(undefined),
      };
      const mockTx = {
        store: mockStore,
        done: Promise.resolve(),
      };
      mockDb.transaction.and.returnValue(mockTx);

      await service.clearAll();

      expect(mockDb.transaction).toHaveBeenCalledWith('main', 'readwrite');
      expect(mockStore.clear).toHaveBeenCalled();
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should not throw on error', async () => {
      mockDb.transaction.and.throwError(new Error('DB error'));

      await expectAsync(service.clearAll()).toBeResolved();
    });
  });

  describe('saveArchive', () => {
    it('should save archive to the database', async () => {
      const mockArchive = {
        task: { ids: ['t1'], entities: { t1: { id: 't1' } } },
        timeTracking: {},
        lastTimeTrackingFlush: 123,
      };
      mockDb.put.and.resolveTo(undefined);

      await service.saveArchive('archiveYoung', mockArchive as any);

      expect(mockDb.put).toHaveBeenCalledWith('main', mockArchive, 'archiveYoung');
    });
  });

  describe('saveMetaModel', () => {
    it('should merge with existing meta model', async () => {
      const existingMeta = { vectorClock: { client1: 3 }, lastUpdate: 1000 };
      const newMeta = { lastUpdate: 2000, lastUpdateAction: 'task.update' };
      mockDb.get.and.resolveTo(existingMeta);
      mockDb.put.and.resolveTo(undefined);

      await service.saveMetaModel(newMeta);

      expect(mockDb.put).toHaveBeenCalledWith(
        'main',
        {
          vectorClock: { client1: 3 },
          lastUpdate: 2000,
          lastUpdateAction: 'task.update',
        },
        'META_MODEL',
      );
    });

    it('should create new meta model if none exists', async () => {
      mockDb.get.and.resolveTo(undefined);
      mockDb.put.and.resolveTo(undefined);
      const newMeta = { vectorClock: { client1: 1 } };

      await service.saveMetaModel(newMeta);

      expect(mockDb.put).toHaveBeenCalledWith('main', newMeta, 'META_MODEL');
    });
  });
});

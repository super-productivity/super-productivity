/* TODO: Temporarily disabled while fixing core plugin issues
import { TestBed } from '@angular/core/testing';
import { PluginCacheService, CachedPlugin } from './plugin-cache.service';

describe('PluginCacheService', () => {
  let service: PluginCacheService;
  let mockIndexedDB: {
    open: jasmine.Spy;
    deleteDatabase: jasmine.Spy;
  };
  let mockDB: {
    transaction: jasmine.Spy;
    objectStoreNames: DOMStringList;
    createObjectStore: jasmine.Spy;
  };
  let mockTransaction: {
    objectStore: jasmine.Spy;
  };
  let mockStore: {
    put: jasmine.Spy;
    get: jasmine.Spy;
    delete: jasmine.Spy;
    getAll: jasmine.Spy;
    clear: jasmine.Spy;
  };

  beforeEach(() => {
    // Mock IndexedDB
    mockStore = {
      put: jasmine.createSpy('put'),
      get: jasmine.createSpy('get'),
      delete: jasmine.createSpy('delete'),
      getAll: jasmine.createSpy('getAll'),
      clear: jasmine.createSpy('clear'),
    };

    mockTransaction = {
      objectStore: jasmine.createSpy('objectStore').and.returnValue(mockStore),
    };

    mockDB = {
      transaction: jasmine.createSpy('transaction').and.returnValue(mockTransaction),
      objectStoreNames: {
        contains: jasmine.createSpy('contains').and.returnValue(false),
        length: 0,
        item: jasmine.createSpy('item'),
      } as DOMStringList,
      createObjectStore: jasmine.createSpy('createObjectStore'),
    };

    mockIndexedDB = {
      open: jasmine.createSpy('open'),
      deleteDatabase: jasmine.createSpy('deleteDatabase'),
    };

    // Replace global indexedDB
    (window as any).indexedDB = mockIndexedDB;

    TestBed.configureTestingModule({
      providers: [PluginCacheService],
    });

    service = TestBed.inject(PluginCacheService);
  });

  afterEach(() => {
    // Reset the cached database
    service['_db'] = null;
  });

  describe('_getDB', () => {
    it('should open database and return it', async () => {
      const mockRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: mockDB,
      };
      mockIndexedDB.open.and.returnValue(mockRequest);

      const dbPromise = service['_getDB']();

      // Trigger success callback
      mockRequest.onsuccess();

      const db = await dbPromise;
      expect(db).toBe(mockDB);
      expect(mockIndexedDB.open).toHaveBeenCalledWith('SUPPluginCache', 1);
    });

    it('should return cached database on subsequent calls', async () => {
      const mockRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: mockDB,
      };
      mockIndexedDB.open.and.returnValue(mockRequest);

      // First call
      const dbPromise1 = service['_getDB']();
      mockRequest.onsuccess();
      await dbPromise1;

      // Second call should not open again
      const db2 = await service['_getDB']();
      expect(db2).toBe(mockDB);
      expect(mockIndexedDB.open).toHaveBeenCalledTimes(1);
    });

    it('should handle database open errors', async () => {
      const mockRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: null,
      };
      mockIndexedDB.open.and.returnValue(mockRequest);

      const dbPromise = service['_getDB']();

      // Trigger error callback
      mockRequest.onerror();

      await expectAsync(dbPromise).toBeRejectedWithError('Failed to open IndexedDB');
    });

    it('should create object store on upgrade', async () => {
      const mockRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: mockDB,
      };
      mockIndexedDB.open.and.returnValue(mockRequest);

      const dbPromise = service['_getDB']();

      // Trigger upgrade callback
      const event = { target: { result: mockDB } };
      mockRequest.onupgradeneeded(event as any);

      expect(mockDB.createObjectStore).toHaveBeenCalledWith('plugins', { keyPath: 'id' });

      // Complete the operation
      mockRequest.onsuccess();
      await dbPromise;
    });

    it('should not create object store if it already exists', async () => {
      mockDB.objectStoreNames.contains = jasmine
        .createSpy('contains')
        .and.returnValue(true);

      const mockRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: mockDB,
      };
      mockIndexedDB.open.and.returnValue(mockRequest);

      const dbPromise = service['_getDB']();

      // Trigger upgrade callback
      const event = { target: { result: mockDB } };
      mockRequest.onupgradeneeded(event as any);

      expect(mockDB.createObjectStore).not.toHaveBeenCalled();

      // Complete the operation
      mockRequest.onsuccess();
      await dbPromise;
    });
  });

  describe('storePlugin', () => {
    beforeEach(() => {
      const mockRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: mockDB,
      };
      mockIndexedDB.open.and.returnValue(mockRequest);

      // Auto-resolve DB
      service['_getDB']().then(() => {});
      mockRequest.onsuccess();
    });

    it('should store a plugin with all fields', async () => {
      const putRequest = {
        onsuccess: null as any,
        onerror: null as any,
      };
      mockStore.put.and.returnValue(putRequest);

      const storePromise = service.storePlugin(
        'test-plugin',
        '{"name":"Test Plugin"}',
        'console.log("test");',
        '<html>Test</html>',
        'icon.png',
      );

      // Trigger success
      putRequest.onsuccess();

      await storePromise;

      expect(mockStore.put).toHaveBeenCalledWith({
        id: 'test-plugin',
        manifest: '{"name":"Test Plugin"}',
        code: 'console.log("test");',
        indexHtml: '<html>Test</html>',
        icon: 'icon.png',
        uploadDate: jasmine.any(Number),
      });
    });

    it('should store a plugin without optional fields', async () => {
      const putRequest = {
        onsuccess: null as any,
        onerror: null as any,
      };
      mockStore.put.and.returnValue(putRequest);

      const storePromise = service.storePlugin(
        'minimal-plugin',
        '{"name":"Minimal"}',
        'console.log("minimal");',
      );

      putRequest.onsuccess();

      await storePromise;

      expect(mockStore.put).toHaveBeenCalledWith({
        id: 'minimal-plugin',
        manifest: '{"name":"Minimal"}',
        code: 'console.log("minimal");',
        indexHtml: undefined,
        icon: undefined,
        uploadDate: jasmine.any(Number),
      });
    });

    it('should handle store errors', async () => {
      const putRequest = {
        onsuccess: null as any,
        onerror: null as any,
      };
      mockStore.put.and.returnValue(putRequest);

      const storePromise = service.storePlugin('error-plugin', '{}', '');

      putRequest.onerror();

      await expectAsync(storePromise).toBeRejectedWithError(
        'Failed to store plugin error-plugin',
      );
    });
  });

  describe('getPlugin', () => {
    beforeEach(() => {
      const mockRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: mockDB,
      };
      mockIndexedDB.open.and.returnValue(mockRequest);

      service['_getDB']().then(() => {});
      mockRequest.onsuccess();
    });

    it('should retrieve an existing plugin', async () => {
      const cachedPlugin: CachedPlugin = {
        id: 'test-plugin',
        manifest: '{"name":"Test"}',
        code: 'console.log("test");',
        indexHtml: '<html>Test</html>',
        icon: 'icon.png',
        uploadDate: Date.now(),
      };

      const getRequest = {
        onsuccess: null as any,
        onerror: null as any,
        result: cachedPlugin,
      };
      mockStore.get.and.returnValue(getRequest);

      const getPromise = service.getPlugin('test-plugin');

      getRequest.onsuccess();

      const result = await getPromise;

      expect(mockStore.get).toHaveBeenCalledWith('test-plugin');
      expect(result).toEqual(cachedPlugin);
    });

    it('should return null for non-existent plugin', async () => {
      const getRequest = {
        onsuccess: null as any,
        onerror: null as any,
        result: undefined,
      };
      mockStore.get.and.returnValue(getRequest);

      const getPromise = service.getPlugin('non-existent');

      getRequest.onsuccess();

      const result = await getPromise;

      expect(result).toBeNull();
    });

    it('should handle get errors', async () => {
      const getRequest = {
        onsuccess: null as any,
        onerror: null as any,
        result: undefined,
      };
      mockStore.get.and.returnValue(getRequest);

      const getPromise = service.getPlugin('error-plugin');

      getRequest.onerror();

      await expectAsync(getPromise).toBeRejectedWithError(
        'Failed to get plugin error-plugin',
      );
    });
  });

  describe('removePlugin', () => {
    beforeEach(() => {
      const mockRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: mockDB,
      };
      mockIndexedDB.open.and.returnValue(mockRequest);

      service['_getDB']().then(() => {});
      mockRequest.onsuccess();
    });

    it('should remove a plugin', async () => {
      const deleteRequest = {
        onsuccess: null as any,
        onerror: null as any,
      };
      mockStore.delete.and.returnValue(deleteRequest);

      const removePromise = service.removePlugin('test-plugin');

      deleteRequest.onsuccess();

      await removePromise;

      expect(mockStore.delete).toHaveBeenCalledWith('test-plugin');
    });

    it('should handle remove errors', async () => {
      const deleteRequest = {
        onsuccess: null as any,
        onerror: null as any,
      };
      mockStore.delete.and.returnValue(deleteRequest);

      const removePromise = service.removePlugin('error-plugin');

      deleteRequest.onerror();

      await expectAsync(removePromise).toBeRejectedWithError(
        'Failed to remove plugin error-plugin',
      );
    });
  });

  describe('getAllPlugins', () => {
    beforeEach(() => {
      const mockRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: mockDB,
      };
      mockIndexedDB.open.and.returnValue(mockRequest);

      service['_getDB']().then(() => {});
      mockRequest.onsuccess();
    });

    it('should retrieve all plugins', async () => {
      const plugins: CachedPlugin[] = [
        {
          id: 'plugin1',
          manifest: '{}',
          code: 'code1',
          uploadDate: Date.now(),
        },
        {
          id: 'plugin2',
          manifest: '{}',
          code: 'code2',
          indexHtml: '<html>2</html>',
          icon: 'icon2.png',
          uploadDate: Date.now(),
        },
      ];

      const getAllRequest = {
        onsuccess: null as any,
        onerror: null as any,
        result: plugins,
      };
      mockStore.getAll.and.returnValue(getAllRequest);

      const getAllPromise = service.getAllPlugins();

      getAllRequest.onsuccess();

      const result = await getAllPromise;

      expect(mockStore.getAll).toHaveBeenCalled();
      expect(result).toEqual(plugins);
    });

    it('should return empty array when no plugins exist', async () => {
      const getAllRequest = {
        onsuccess: null as any,
        onerror: null as any,
        result: [],
      };
      mockStore.getAll.and.returnValue(getAllRequest);

      const getAllPromise = service.getAllPlugins();

      getAllRequest.onsuccess();

      const result = await getAllPromise;

      expect(result).toEqual([]);
    });

    it('should handle getAll errors', async () => {
      const getAllRequest = {
        onsuccess: null as any,
        onerror: null as any,
        result: undefined,
      };
      mockStore.getAll.and.returnValue(getAllRequest);

      const getAllPromise = service.getAllPlugins();

      getAllRequest.onerror();

      await expectAsync(getAllPromise).toBeRejectedWithError('Failed to get all plugins');
    });
  });

  describe('clearCache', () => {
    beforeEach(() => {
      const mockRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: mockDB,
      };
      mockIndexedDB.open.and.returnValue(mockRequest);

      service['_getDB']().then(() => {});
      mockRequest.onsuccess();
    });

    it('should clear all plugins', async () => {
      const clearRequest = {
        onsuccess: null as any,
        onerror: null as any,
      };
      mockStore.clear.and.returnValue(clearRequest);

      const clearPromise = service.clearCache();

      clearRequest.onsuccess();

      await clearPromise;

      expect(mockStore.clear).toHaveBeenCalled();
    });

    it('should handle clear errors', async () => {
      const clearRequest = {
        onsuccess: null as any,
        onerror: null as any,
      };
      mockStore.clear.and.returnValue(clearRequest);

      const clearPromise = service.clearCache();

      clearRequest.onerror();

      await expectAsync(clearPromise).toBeRejectedWithError('Failed to clear cache');
    });
  });

  describe('transaction modes', () => {
    beforeEach(() => {
      const mockRequest = {
        onsuccess: null as any,
        onerror: null as any,
        onupgradeneeded: null as any,
        result: mockDB,
      };
      mockIndexedDB.open.and.returnValue(mockRequest);

      service['_getDB']().then(() => {});
      mockRequest.onsuccess();
    });

    it('should use readwrite mode for storePlugin', async () => {
      const putRequest = {
        onsuccess: null as any,
        onerror: null as any,
      };
      mockStore.put.and.returnValue(putRequest);

      const storePromise = service.storePlugin('test', '{}', '');
      putRequest.onsuccess();
      await storePromise;

      expect(mockDB.transaction).toHaveBeenCalledWith(['plugins'], 'readwrite');
    });

    it('should use readonly mode for getPlugin', async () => {
      const getRequest = {
        onsuccess: null as any,
        onerror: null as any,
        result: null,
      };
      mockStore.get.and.returnValue(getRequest);

      const getPromise = service.getPlugin('test');
      getRequest.onsuccess();
      await getPromise;

      expect(mockDB.transaction).toHaveBeenCalledWith(['plugins'], 'readonly');
    });

    it('should use readonly mode for getAllPlugins', async () => {
      const getAllRequest = {
        onsuccess: null as any,
        onerror: null as any,
        result: [],
      };
      mockStore.getAll.and.returnValue(getAllRequest);

      const getAllPromise = service.getAllPlugins();
      getAllRequest.onsuccess();
      await getAllPromise;

      expect(mockDB.transaction).toHaveBeenCalledWith(['plugins'], 'readonly');
    });
  });
});
*/

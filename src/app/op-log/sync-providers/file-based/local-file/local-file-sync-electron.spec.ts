import { LocalFileSyncElectron } from './local-file-sync-electron';
import { SyncCredentialStore } from '../../credential-store.service';
import { SyncProviderId } from '../../provider.const';

describe('LocalFileSyncElectron', () => {
  let instance: LocalFileSyncElectron;
  let mockEa: {
    checkDirExists: jasmine.Spy;
    pickDirectory: jasmine.Spy;
    fileSyncLoad: jasmine.Spy;
    fileSyncSave: jasmine.Spy;
    fileSyncRemove: jasmine.Spy;
    fileSyncListFiles: jasmine.Spy;
  };
  let mockPrivateCfg: jasmine.SpyObj<SyncCredentialStore<SyncProviderId.LocalFile>>;

  beforeEach(() => {
    mockEa = {
      checkDirExists: jasmine.createSpy('checkDirExists').and.resolveTo(true),
      pickDirectory: jasmine.createSpy('pickDirectory').and.resolveTo('/picked/dir'),
      fileSyncLoad: jasmine.createSpy('fileSyncLoad').and.resolveTo({ dataStr: '' }),
      fileSyncSave: jasmine.createSpy('fileSyncSave').and.resolveTo(undefined),
      fileSyncRemove: jasmine.createSpy('fileSyncRemove').and.resolveTo(undefined),
      fileSyncListFiles: jasmine.createSpy('fileSyncListFiles').and.resolveTo([]),
    };
    (window as any).ea = mockEa;

    mockPrivateCfg = jasmine.createSpyObj('SyncCredentialStore', [
      'load',
      'setComplete',
      'upsertPartial',
    ]);

    instance = new LocalFileSyncElectron();
    instance.privateCfg = mockPrivateCfg as any;
  });

  afterEach(() => {
    delete (window as any).ea;
  });

  describe('getFilePath', () => {
    it('should return correct path when folder is configured', async () => {
      mockPrivateCfg.load.and.resolveTo({ syncFolderPath: '/my/sync' });
      mockEa.checkDirExists.and.resolveTo(true);

      const result = await instance.getFilePath('data.json');

      expect(result).toBe('/my/sync/data.json');
    });

    it('should normalize target path with leading slash', async () => {
      mockPrivateCfg.load.and.resolveTo({ syncFolderPath: '/my/sync' });

      const result = await instance.getFilePath('/data.json');

      expect(result).toBe('/my/sync/data.json');
    });

    it('should open picker and use picked directory when no folder configured', async () => {
      let callCount = 0;
      mockPrivateCfg.load.and.callFake(async () => {
        callCount++;
        // First two calls: no folder (from _getFolderPath and _checkDir)
        // Third call: folder set after picker
        if (callCount <= 2) {
          return null;
        }
        return { syncFolderPath: '/picked/dir' };
      });
      mockPrivateCfg.upsertPartial.and.resolveTo(undefined);

      const result = await instance.getFilePath('data.json');

      expect(result).toBe('/picked/dir/data.json');
      expect(mockEa.pickDirectory).toHaveBeenCalledTimes(1);
    });

    it('should throw when no folder configured and picker is cancelled', async () => {
      mockPrivateCfg.load.and.resolveTo(null);
      mockEa.pickDirectory.and.resolveTo(undefined);

      await expectAsync(instance.getFilePath('data.json')).toBeRejectedWithError(
        'No sync folder path configured after directory picker',
      );
    });

    it('should not infinitely recurse when no folder is configured', async () => {
      // This is the key regression test for the infinite loop fix.
      // Before the fix, _getFolderPath() and _checkDirAndOpenPickerIfNotExists()
      // called each other endlessly when no syncFolderPath was set.
      mockPrivateCfg.load.and.resolveTo(null);
      mockEa.pickDirectory.and.resolveTo(undefined);

      await expectAsync(instance.getFilePath('data.json')).toBeRejected();

      // privateCfg.load should be called a small number of times, not hundreds
      expect(mockPrivateCfg.load.calls.count()).toBeLessThan(10);
      // pickDirectory should be called exactly once
      expect(mockEa.pickDirectory).toHaveBeenCalledTimes(1);
    });

    it('should use configured folder path without checking directory existence', async () => {
      mockPrivateCfg.load.and.resolveTo({ syncFolderPath: '/configured/dir' });

      const result = await instance.getFilePath('data.json');

      expect(result).toBe('/configured/dir/data.json');
      expect(mockEa.pickDirectory).not.toHaveBeenCalled();
      expect(mockEa.checkDirExists).not.toHaveBeenCalled();
    });
  });

  describe('pickDirectory', () => {
    it('should save picked directory to config', async () => {
      mockEa.pickDirectory.and.resolveTo('/new/dir');
      mockPrivateCfg.load.and.resolveTo(null);
      mockPrivateCfg.upsertPartial.and.resolveTo(undefined);

      await instance.pickDirectory();

      expect(mockPrivateCfg.upsertPartial).toHaveBeenCalledWith({
        syncFolderPath: '/new/dir',
      });
    });

    it('should not save when picker is cancelled', async () => {
      mockEa.pickDirectory.and.resolveTo(undefined);

      await instance.pickDirectory();

      expect(mockPrivateCfg.upsertPartial).not.toHaveBeenCalled();
    });
  });
});

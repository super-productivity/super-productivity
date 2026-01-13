import { WebdavBaseProvider } from './webdav-base-provider';
import { SyncProviderId } from '../../provider.const';
import { MissingCredentialsSPError } from '../../../core/errors/sync-errors';
import { WebdavPrivateCfg } from './webdav.model';

/**
 * Concrete implementation for testing the abstract WebdavBaseProvider
 */
class TestWebdavProvider extends WebdavBaseProvider<SyncProviderId.WebDAV> {
  readonly id = SyncProviderId.WebDAV;

  // Expose protected method for testing
  async cfgOrErrorTest(): Promise<WebdavPrivateCfg> {
    return this._cfgOrError();
  }

  // Expose protected method for testing
  getFilePathTest(targetPath: string, cfg: WebdavPrivateCfg): string {
    return this._getFilePath(targetPath, cfg);
  }
}

describe('WebdavBaseProvider', () => {
  let provider: TestWebdavProvider;

  beforeEach(() => {
    provider = new TestWebdavProvider();
  });

  describe('_cfgOrError', () => {
    it('should throw MissingCredentialsSPError when config is null', async () => {
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(null));

      await expectAsync(provider.cfgOrErrorTest()).toBeRejectedWithError(
        MissingCredentialsSPError,
        'WebDAV configuration is missing.',
      );
    });

    it('should throw MissingCredentialsSPError when config is undefined', async () => {
      spyOn(provider.privateCfg, 'load').and.returnValue(
        Promise.resolve(undefined as any),
      );

      await expectAsync(provider.cfgOrErrorTest()).toBeRejectedWithError(
        MissingCredentialsSPError,
        'WebDAV configuration is missing.',
      );
    });

    it('should throw MissingCredentialsSPError when baseUrl is missing', async () => {
      const cfg: Partial<WebdavPrivateCfg> = {
        userName: 'user',
        password: 'pass',
        encryptKey: '',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(
        Promise.resolve(cfg as WebdavPrivateCfg),
      );

      await expectAsync(provider.cfgOrErrorTest()).toBeRejectedWithError(
        MissingCredentialsSPError,
        'WebDAV base URL is not configured. Please check your sync settings.',
      );
    });

    it('should throw MissingCredentialsSPError when baseUrl is empty string', async () => {
      const cfg: WebdavPrivateCfg = {
        baseUrl: '',
        userName: 'user',
        password: 'pass',
        encryptKey: '',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(cfg));

      await expectAsync(provider.cfgOrErrorTest()).toBeRejectedWithError(
        MissingCredentialsSPError,
        'WebDAV base URL is not configured. Please check your sync settings.',
      );
    });

    it('should throw MissingCredentialsSPError when userName is missing', async () => {
      const cfg: Partial<WebdavPrivateCfg> = {
        baseUrl: 'http://example.com',
        password: 'pass',
        encryptKey: '',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(
        Promise.resolve(cfg as WebdavPrivateCfg),
      );

      await expectAsync(provider.cfgOrErrorTest()).toBeRejectedWithError(
        MissingCredentialsSPError,
        'WebDAV username is not configured. Please check your sync settings.',
      );
    });

    it('should throw MissingCredentialsSPError when userName is empty string', async () => {
      const cfg: WebdavPrivateCfg = {
        baseUrl: 'http://example.com',
        userName: '',
        password: 'pass',
        encryptKey: '',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(cfg));

      await expectAsync(provider.cfgOrErrorTest()).toBeRejectedWithError(
        MissingCredentialsSPError,
        'WebDAV username is not configured. Please check your sync settings.',
      );
    });

    it('should throw MissingCredentialsSPError when password is missing', async () => {
      const cfg: Partial<WebdavPrivateCfg> = {
        baseUrl: 'http://example.com',
        userName: 'user',
        encryptKey: '',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(
        Promise.resolve(cfg as WebdavPrivateCfg),
      );

      await expectAsync(provider.cfgOrErrorTest()).toBeRejectedWithError(
        MissingCredentialsSPError,
        'WebDAV password is not configured. Please check your sync settings.',
      );
    });

    it('should throw MissingCredentialsSPError when password is empty string', async () => {
      const cfg: WebdavPrivateCfg = {
        baseUrl: 'http://example.com',
        userName: 'user',
        password: '',
        encryptKey: '',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(cfg));

      await expectAsync(provider.cfgOrErrorTest()).toBeRejectedWithError(
        MissingCredentialsSPError,
        'WebDAV password is not configured. Please check your sync settings.',
      );
    });

    it('should return config when all required fields are present', async () => {
      const cfg: WebdavPrivateCfg = {
        baseUrl: 'http://example.com/webdav',
        userName: 'testuser',
        password: 'testpass',
        encryptKey: 'key',
        syncFolderPath: '/sync',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(cfg));

      const result = await provider.cfgOrErrorTest();

      expect(result).toEqual(cfg);
    });

    it('should return config when optional fields are missing', async () => {
      const cfg: WebdavPrivateCfg = {
        baseUrl: 'http://example.com',
        userName: 'user',
        password: 'pass',
        encryptKey: '',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(cfg));

      const result = await provider.cfgOrErrorTest();

      expect(result).toEqual(cfg);
    });
  });

  describe('_getFilePath', () => {
    it('should build path with syncFolderPath', () => {
      const cfg: WebdavPrivateCfg = {
        baseUrl: 'http://example.com',
        userName: 'user',
        password: 'pass',
        encryptKey: '',
        syncFolderPath: '/sync',
      };

      const result = provider.getFilePathTest('data.json', cfg);

      expect(result).toBe('/sync/data.json');
    });

    it('should build path without syncFolderPath', () => {
      const cfg: WebdavPrivateCfg = {
        baseUrl: 'http://example.com',
        userName: 'user',
        password: 'pass',
        encryptKey: '',
      };

      const result = provider.getFilePathTest('data.json', cfg);

      expect(result).toBe('data.json');
    });

    it('should normalize multiple slashes', () => {
      const cfg: WebdavPrivateCfg = {
        baseUrl: 'http://example.com',
        userName: 'user',
        password: 'pass',
        encryptKey: '',
        syncFolderPath: '/sync/',
      };

      const result = provider.getFilePathTest('/data.json', cfg);

      expect(result).toBe('/sync/data.json');
    });
  });

  describe('isReady', () => {
    it('should return false when config is null', async () => {
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(null));

      const result = await provider.isReady();

      expect(result).toBe(false);
    });

    it('should return false when userName is missing', async () => {
      const cfg: Partial<WebdavPrivateCfg> = {
        baseUrl: 'http://example.com',
        password: 'pass',
        syncFolderPath: '/sync',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(
        Promise.resolve(cfg as WebdavPrivateCfg),
      );

      const result = await provider.isReady();

      expect(result).toBe(false);
    });

    it('should return false when baseUrl is missing', async () => {
      const cfg: Partial<WebdavPrivateCfg> = {
        userName: 'user',
        password: 'pass',
        syncFolderPath: '/sync',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(
        Promise.resolve(cfg as WebdavPrivateCfg),
      );

      const result = await provider.isReady();

      expect(result).toBe(false);
    });

    it('should return false when password is missing', async () => {
      const cfg: Partial<WebdavPrivateCfg> = {
        baseUrl: 'http://example.com',
        userName: 'user',
        syncFolderPath: '/sync',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(
        Promise.resolve(cfg as WebdavPrivateCfg),
      );

      const result = await provider.isReady();

      expect(result).toBe(false);
    });

    it('should return false when syncFolderPath is missing', async () => {
      const cfg: Partial<WebdavPrivateCfg> = {
        baseUrl: 'http://example.com',
        userName: 'user',
        password: 'pass',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(
        Promise.resolve(cfg as WebdavPrivateCfg),
      );

      const result = await provider.isReady();

      expect(result).toBe(false);
    });

    it('should return true when all required fields are present', async () => {
      const cfg: WebdavPrivateCfg = {
        baseUrl: 'http://example.com',
        userName: 'user',
        password: 'pass',
        syncFolderPath: '/sync',
        encryptKey: '',
      };
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(cfg));

      const result = await provider.isReady();

      expect(result).toBe(true);
    });
  });
});

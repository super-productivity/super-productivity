import { ProtonDriveProvider } from './proton-drive';
import type { WebdavPrivateCfg } from '@sp/sync-providers/webdav';
import { ProtonDrivePrivateCfg } from './proton-drive.model';
import { MissingCredentialsSPError } from '../../../core/errors/sync-errors';

/**
 * Test subclass exposing the protected cfg resolver.
 */
class TestProtonDriveProvider extends ProtonDriveProvider {
  cfgOrErrorTest(): Promise<WebdavPrivateCfg> {
    return this._cfgOrError();
  }
}

describe('ProtonDriveProvider', () => {
  let provider: TestProtonDriveProvider;
  let ensureServerSpy: jasmine.Spy;

  const fullCfg: ProtonDrivePrivateCfg = {
    rcloneRemoteName: 'protondrive',
    rcloneBinaryPath: '/usr/bin/rclone',
    syncFolderPath: 'super-productivity',
    encryptKey: 'secret',
  };

  const serveInfo = {
    baseUrl: 'http://127.0.0.1:12345/',
    userName: 'genUser',
    password: 'genPass',
  };

  beforeEach(() => {
    ensureServerSpy = jasmine.createSpy('protonDriveEnsureServer');
    (window as unknown as { ea: { protonDriveEnsureServer: jasmine.Spy } }).ea = {
      protonDriveEnsureServer: ensureServerSpy,
    };
    provider = new TestProtonDriveProvider();
  });

  afterEach(() => {
    delete (window as unknown as { ea?: unknown }).ea;
  });

  it('should use the ProtonDrive provider id (distinct credential store)', () => {
    expect(provider.id as unknown as string).toBe('ProtonDrive');
  });

  describe('isReady', () => {
    it('should return false when no config is stored', async () => {
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(null));
      expect(await provider.isReady()).toBe(false);
    });

    it('should return false when the rclone remote name is missing', async () => {
      spyOn(provider.privateCfg, 'load').and.returnValue(
        Promise.resolve({ rcloneRemoteName: '', syncFolderPath: 'x' }),
      );
      expect(await provider.isReady()).toBe(false);
    });
  });

  describe('_cfgOrError', () => {
    it('should throw when config is missing', async () => {
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(null));
      await expectAsync(provider.cfgOrErrorTest()).toBeRejectedWithError(
        MissingCredentialsSPError,
      );
      expect(ensureServerSpy).not.toHaveBeenCalled();
    });

    it('should throw when the rclone remote name is missing', async () => {
      spyOn(provider.privateCfg, 'load').and.returnValue(
        Promise.resolve({ rcloneRemoteName: '', syncFolderPath: 'x' }),
      );
      await expectAsync(provider.cfgOrErrorTest()).toBeRejectedWithError(
        MissingCredentialsSPError,
      );
      expect(ensureServerSpy).not.toHaveBeenCalled();
    });

    it('should ensure the rclone server and build a WebDAV cfg from its endpoint', async () => {
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(fullCfg));
      ensureServerSpy.and.returnValue(Promise.resolve(serveInfo));

      const result = await provider.cfgOrErrorTest();

      expect(ensureServerSpy).toHaveBeenCalledWith({
        remoteName: 'protondrive',
        rcloneBinaryPath: '/usr/bin/rclone',
      });
      expect(result.baseUrl).toBe(serveInfo.baseUrl);
      expect(result.userName).toBe(serveInfo.userName);
      expect(result.password).toBe(serveInfo.password);
      // provider-specific config carries through (folder + encryption key)
      expect(result.syncFolderPath).toBe('super-productivity');
      expect(result.encryptKey).toBe('secret');
    });

    it('should propagate an error returned by the rclone bridge', async () => {
      spyOn(provider.privateCfg, 'load').and.returnValue(Promise.resolve(fullCfg));
      const bridgeErr = new Error('rclone executable not found');
      ensureServerSpy.and.returnValue(Promise.resolve(bridgeErr));

      await expectAsync(provider.cfgOrErrorTest()).toBeRejectedWith(bridgeErr);
    });
  });

  describe('clearAuthCredentials', () => {
    it('should be a no-op (Proton credentials live in rclone, not app storage)', async () => {
      const setCompleteSpy = spyOn(provider.privateCfg, 'setComplete');
      const loadSpy = spyOn(provider.privateCfg, 'load');
      await provider.clearAuthCredentials();
      expect(setCompleteSpy).not.toHaveBeenCalled();
      expect(loadSpy).not.toHaveBeenCalled();
    });
  });
});

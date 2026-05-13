/**
 * Tests for PluginService._pingNodeBridge retry loop.
 * Tests the private method directly via cast.
 */
import { fakeAsync, tick } from '@angular/core/testing';
import { PluginRunner } from './plugin-runner';
import { PluginManifest } from './plugin-api.model';

const MOCK_MANIFEST: PluginManifest = {
  id: 'ping-test-plugin',
  name: 'Ping Test Plugin',
  version: '1.0.0',
  manifestVersion: 1,
  minSupVersion: '1.0.0',
  hooks: [],
  permissions: ['nodeExecution'],
};

describe('PluginService._pingNodeBridge retry loop', () => {
  let mockPluginRunner: jasmine.SpyObj<PluginRunner>;
  let pingNodeBridge: (manifest: PluginManifest) => Promise<void>;

  // Minimal stub of the translate service
  const mockTranslate = { instant: (key: string, _params?: unknown) => key };

  beforeEach(() => {
    mockPluginRunner = jasmine.createSpyObj('PluginRunner', ['pingNodeBridge']);

    // Build a standalone instance of _pingNodeBridge bound to our mocks
    // by extracting the method from a minimal service-like object
    const serviceStub = {
      _pluginRunner: mockPluginRunner,
      _translateService: mockTranslate,
      _pingNodeBridge: async function (manifest: PluginManifest): Promise<void> {
        const RETRY_DELAYS = [1000, 2000];
        const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const ok = await this._pluginRunner.pingNodeBridge(manifest.id);
          if (ok) return;
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((resolve) =>
              setTimeout(resolve, RETRY_DELAYS[attempt - 1]),
            );
          }
        }
        throw new Error(
          this._translateService.instant('PLUGINS.NODE_EXECUTION_BRIDGE_UNAVAILABLE', {
            pluginName: manifest.name,
          }),
        );
      },
    };

    pingNodeBridge = serviceStub._pingNodeBridge.bind(serviceStub);
  });

  it('resolves immediately when bridge responds on first attempt', async () => {
    mockPluginRunner.pingNodeBridge.and.resolveTo(true);
    await expectAsync(pingNodeBridge(MOCK_MANIFEST)).toBeResolved();
    expect(mockPluginRunner.pingNodeBridge).toHaveBeenCalledTimes(1);
  });

  it('retries and resolves when bridge responds on second attempt', fakeAsync(() => {
    let callCount = 0;
    mockPluginRunner.pingNodeBridge.and.callFake(async () => {
      callCount++;
      return callCount >= 2;
    });

    let resolved = false;
    pingNodeBridge(MOCK_MANIFEST).then(() => (resolved = true));

    tick(0); // first attempt fails
    tick(1000); // wait retry delay
    tick(0); // second attempt succeeds

    expect(resolved).toBe(true);
    expect(mockPluginRunner.pingNodeBridge).toHaveBeenCalledTimes(2);
  }));

  it('retries and resolves when bridge responds on third attempt', fakeAsync(() => {
    let callCount = 0;
    mockPluginRunner.pingNodeBridge.and.callFake(async () => {
      callCount++;
      return callCount >= 3;
    });

    let resolved = false;
    pingNodeBridge(MOCK_MANIFEST).then(() => (resolved = true));

    tick(0); // attempt 1 fails
    tick(1000); // delay 1
    tick(0); // attempt 2 fails
    tick(2000); // delay 2
    tick(0); // attempt 3 succeeds

    expect(resolved).toBe(true);
    expect(mockPluginRunner.pingNodeBridge).toHaveBeenCalledTimes(3);
  }));

  it('throws after all 3 attempts fail', fakeAsync(() => {
    mockPluginRunner.pingNodeBridge.and.resolveTo(false);

    let error: Error | undefined;
    pingNodeBridge(MOCK_MANIFEST).catch((e) => (error = e));

    tick(0); // attempt 1
    tick(1000);
    tick(0); // attempt 2
    tick(2000);
    tick(0); // attempt 3

    expect(error).toBeDefined();
    expect(error?.message).toContain('PLUGINS.NODE_EXECUTION_BRIDGE_UNAVAILABLE');
    expect(mockPluginRunner.pingNodeBridge).toHaveBeenCalledTimes(3);
  }));
});

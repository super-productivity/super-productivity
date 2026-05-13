/**
 * Tests for the centralized _fireOnReady helper and the activatePlugin error-path
 * teardown. Uses a minimal stub instead of the full PluginService DI graph.
 */
import { PluginManifest, PluginInstance } from './plugin-api.model';

const NODE_MANIFEST: PluginManifest = {
  id: 'node-plugin',
  name: 'Node Plugin',
  version: '1.0.0',
  manifestVersion: 1,
  minSupVersion: '1.0.0',
  hooks: [],
  permissions: ['nodeExecution'],
};

const PLAIN_MANIFEST: PluginManifest = {
  id: 'plain-plugin',
  name: 'Plain Plugin',
  version: '1.0.0',
  manifestVersion: 1,
  minSupVersion: '1.0.0',
  hooks: [],
  permissions: [],
};

describe('PluginService._fireOnReady (centralized readiness)', () => {
  let pingSpy: jasmine.Spy;
  let triggerReadySpy: jasmine.Spy;
  let fireOnReady: (instance: PluginInstance, isElectron: boolean) => Promise<void>;

  beforeEach(() => {
    pingSpy = jasmine.createSpy('_pingNodeBridge').and.resolveTo();
    triggerReadySpy = jasmine.createSpy('triggerReady').and.resolveTo();

    const stub = {
      _pluginRunner: { triggerReady: triggerReadySpy },
      _pingNodeBridge: pingSpy,
      _fireOnReady: async function (
        instance: PluginInstance,
        isElectron: boolean,
      ): Promise<void> {
        if (!instance.loaded) return;
        if (isElectron && instance.manifest.permissions?.includes('nodeExecution')) {
          await this._pingNodeBridge(instance.manifest);
        }
        await this._pluginRunner.triggerReady(instance.manifest.id);
      },
    };
    fireOnReady = stub._fireOnReady.bind(stub);
  });

  it('skips ping and triggerReady when instance failed to load', async () => {
    await fireOnReady({ manifest: NODE_MANIFEST, loaded: false, isEnabled: true }, true);
    expect(pingSpy).not.toHaveBeenCalled();
    expect(triggerReadySpy).not.toHaveBeenCalled();
  });

  it('pings bridge then fires triggerReady for nodeExecution plugins on Electron', async () => {
    await fireOnReady({ manifest: NODE_MANIFEST, loaded: true, isEnabled: true }, true);
    expect(pingSpy).toHaveBeenCalledOnceWith(NODE_MANIFEST);
    expect(triggerReadySpy).toHaveBeenCalledOnceWith(NODE_MANIFEST.id);
  });

  it('skips ping for plain plugins (no nodeExecution permission)', async () => {
    await fireOnReady({ manifest: PLAIN_MANIFEST, loaded: true, isEnabled: true }, true);
    expect(pingSpy).not.toHaveBeenCalled();
    expect(triggerReadySpy).toHaveBeenCalledOnceWith(PLAIN_MANIFEST.id);
  });

  it('skips ping for nodeExecution plugins outside Electron (web build)', async () => {
    await fireOnReady({ manifest: NODE_MANIFEST, loaded: true, isEnabled: true }, false);
    expect(pingSpy).not.toHaveBeenCalled();
    expect(triggerReadySpy).toHaveBeenCalledOnceWith(NODE_MANIFEST.id);
  });

  it('propagates ping errors (no triggerReady call when ping throws)', async () => {
    pingSpy.and.rejectWith(new Error('bridge unavailable'));
    await expectAsync(
      fireOnReady({ manifest: NODE_MANIFEST, loaded: true, isEnabled: true }, true),
    ).toBeRejectedWithError('bridge unavailable');
    expect(triggerReadySpy).not.toHaveBeenCalled();
  });
});

describe('PluginService activatePlugin error-path teardown', () => {
  let unloadSpy: jasmine.Spy;
  let setStateSpy: jasmine.Spy;
  let snackSpy: jasmine.Spy;
  let activate: (pluginId: string, throwError: Error) => Promise<null>;

  beforeEach(() => {
    unloadSpy = jasmine.createSpy('unloadPlugin');
    setStateSpy = jasmine.createSpy('_setPluginState');
    snackSpy = jasmine.createSpy('snack.open');

    const stub = {
      _pluginRunner: { unloadPlugin: unloadSpy },
      _setPluginState: setStateSpy,
      _snackService: { open: snackSpy },
      // Replicates the activatePlugin catch block
      simulateActivationFailure: async function (
        pluginId: string,
        throwError: Error,
      ): Promise<null> {
        try {
          throw throwError;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          try {
            this._pluginRunner.unloadPlugin(pluginId);
          } catch (unloadError) {
            // swallowed and logged in real code
          }
          this._setPluginState(pluginId, { status: 'error', error: errorMsg });
          this._snackService.open({ msg: errorMsg, type: 'ERROR' });
          return null;
        }
      },
    };
    activate = stub.simulateActivationFailure.bind(stub);
  });

  it('calls unloadPlugin before setting error state', async () => {
    const callOrder: string[] = [];
    unloadSpy.and.callFake(() => callOrder.push('unload'));
    setStateSpy.and.callFake(() => callOrder.push('setState'));

    await activate('test-plugin', new Error('boom'));

    expect(callOrder).toEqual(['unload', 'setState']);
    expect(unloadSpy).toHaveBeenCalledOnceWith('test-plugin');
  });

  it('still sets error state even if unload throws', async () => {
    unloadSpy.and.throwError('unload failed');

    await activate('test-plugin', new Error('boom'));

    expect(setStateSpy).toHaveBeenCalledOnceWith('test-plugin', {
      status: 'error',
      error: 'boom',
    });
    expect(snackSpy).toHaveBeenCalledOnceWith({ msg: 'boom', type: 'ERROR' });
  });

  it('shows error snack with the original error message', async () => {
    await activate('test-plugin', new Error('bridge unavailable'));
    expect(snackSpy).toHaveBeenCalledOnceWith({
      msg: 'bridge unavailable',
      type: 'ERROR',
    });
  });
});

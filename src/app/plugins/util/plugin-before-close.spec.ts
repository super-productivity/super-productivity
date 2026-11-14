import {
  PluginAPI,
  PluginBeforeCloseHandler,
  PluginIframeMessageType,
} from '@super-productivity/plugin-api';
import { PluginBridgeService } from '../plugin-bridge.service';
import {
  createPluginApiScript,
  handlePluginMessage,
  PluginIframeConfig,
} from './plugin-iframe.util';
import { PluginBeforeCloseIframe } from './plugin-before-close-iframe';

const unwrapScript = (script: string): string => {
  const wrapped = script.trim();
  expect(wrapped.startsWith('<script>')).toBeTrue();
  expect(wrapped.endsWith('</script>')).toBeTrue();
  return wrapped.slice('<script>'.length, -'</script>'.length);
};

describe('generated iframe before-close callback', () => {
  const config: PluginIframeConfig = {
    pluginId: 'fixture',
    manifest: {
      id: 'fixture',
      name: 'Fixture',
      version: '1',
      manifestVersion: 1,
      minSupVersion: '1',
      hooks: [],
      permissions: [],
    },
    indexHtml: '',
    baseCfg: { theme: 'light', appVersion: '1', platform: 'desktop', isDev: false },
    pluginBridge: {} as PluginBridgeService,
    bridgeToken: 'fixture-token',
    bridgeGeneration: 2,
  };

  it('keeps the callback inside the iframe and acknowledges registration without waiting for exit', async () => {
    const listeners = new Map<string, (event: MessageEvent) => void>();
    const parent = { postMessage: jasmine.createSpy('postMessage') };
    const frame: {
      parent: typeof parent;
      addEventListener: (name: string, fn: (event: MessageEvent) => void) => void;
      PluginAPI?: PluginAPI;
    } = {
      parent,
      addEventListener: (name, fn) => listeners.set(name, fn),
    };
    const script = unwrapScript(createPluginApiScript(config));
    new Function('window', 'setTimeout', script)(frame, window.setTimeout);
    const callback = jasmine.createSpy('callback').and.resolveTo();
    const registration = frame.PluginAPI!.onBeforeAppClose!(callback);
    const call = parent.postMessage.calls.mostRecent().args[0];
    expect(call.args).toEqual(['IFRAME_HANDLER']);
    listeners.get('message')!({
      source: parent,
      data: {
        type: PluginIframeMessageType.API_RESPONSE,
        callId: call.callId,
        result: true,
      },
    } as unknown as MessageEvent);
    expect(await registration).toBeTrue();
    expect(callback).not.toHaveBeenCalled();
  });

  it('allows a callback to await a nested host API without deadlocking its result response', async () => {
    const listeners = new Map<string, (event: MessageEvent) => void>();
    let registered: PluginBeforeCloseHandler | null = null;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const getTasks = jasmine.createSpy('getTasks').and.resolveTo([]);
    const parent = { postMessage: jasmine.createSpy('parent postMessage') };
    const frame: {
      parent: typeof parent;
      addEventListener: (name: string, fn: (event: MessageEvent) => void) => void;
      PluginAPI?: PluginAPI;
    } = {
      parent,
      addEventListener: (name, fn) => listeners.set(name, fn),
    };
    const source = {
      postMessage: (data: unknown) =>
        listeners.get('message')!({ source: parent, data } as unknown as MessageEvent),
    } as unknown as Window;
    const bridge = new PluginBeforeCloseIframe({
      bridgeToken: config.bridgeToken,
      bridgeGeneration: config.bridgeGeneration,
      isAlive: () => true,
      register: (handler) => {
        registered = handler;
        return true;
      },
    });
    const testConfig = {
      ...config,
      beforeClose: bridge,
      boundMethods: { getTasks } as unknown as ReturnType<
        PluginBridgeService['createBoundMethods']
      >,
    };
    parent.postMessage.and.callFake((data: Record<string, unknown>) => {
      if (data.type === PluginIframeMessageType.API_CALL) {
        void handlePluginMessage({ source, data } as MessageEvent, testConfig);
      } else {
        const event = new MessageEvent('message', { data });
        Object.defineProperty(event, 'source', { value: source });
        window.dispatchEvent(event);
      }
    });
    const script = unwrapScript(createPluginApiScript(testConfig));
    new Function('window', 'setTimeout', script)(frame, window.setTimeout);
    try {
      expect(
        await frame.PluginAPI!.onBeforeAppClose!(async ({ signal }) => {
          await frame.PluginAPI!.getTasks();
          expect(signal.aborted).toBeFalse();
          await finished;
        }),
      ).toBeTrue();
      const invoke = registered as unknown as PluginBeforeCloseHandler;
      let settled = false;
      const pending = Promise.resolve(
        invoke({ deadlineAt: Date.now() + 15_000, signal: new AbortController().signal }),
      ).then(() => (settled = true));
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(getTasks).toHaveBeenCalledOnceWith();
      expect(settled).toBeFalse();
      finish();
      await pending;
      expect(settled).toBeTrue();
    } finally {
      bridge.dispose();
    }
  });
});

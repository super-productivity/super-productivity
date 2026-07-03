import {
  PluginBaseCfg,
  PluginIframeMessageType,
  PluginManifest,
} from '@super-productivity/plugin-api';
import { PluginBridgeService } from '../plugin-bridge.service';
import {
  buildPluginIframeHtml,
  createPluginApiScript,
  handlePluginMessage,
  PluginIframeConfig,
  PLUGIN_IFRAME_SANDBOX,
} from './plugin-iframe.util';

describe('handlePluginMessage()', () => {
  const createConfig = (
    pluginBridge: PluginBridgeService,
    boundMethods?: PluginIframeConfig['boundMethods'],
  ): PluginIframeConfig => ({
    pluginId: 'test-plugin',
    manifest: {
      id: 'test-plugin',
      name: 'Test Plugin',
      manifestVersion: 1,
      version: '1.0.0',
      minSupVersion: '1.0.0',
      hooks: [],
      permissions: [],
    } as PluginManifest,
    indexHtml: '',
    baseCfg: {
      theme: 'light',
      appVersion: '1.0.0',
      platform: 'web',
      isDev: false,
    } as PluginBaseCfg,
    pluginBridge,
    bridgeToken: 'test-bridge-token',
    bridgeGeneration: 4,
    boundMethods,
  });

  it('rebuilds iframe dialog button handlers and returns the selected result', async () => {
    let bridgedDialogCfg:
      | {
          buttons?: Array<Record<string, unknown>>;
        }
      | undefined;
    const sourceWindow = window;
    const postMessageSpy = spyOn(sourceWindow, 'postMessage') as jasmine.Spy;
    const pluginBridge = {
      createBoundMethods: () => ({}),
      openDialog: async (dialogCfg: { buttons?: Array<Record<string, unknown>> }) => {
        bridgedDialogCfg = dialogCfg;
        const onClick = dialogCfg.buttons?.[0].onClick as
          | (() => Promise<void>)
          | undefined;
        const clickPromise = onClick?.();
        window.dispatchEvent(
          new MessageEvent('message', {
            source: sourceWindow as unknown as MessageEventSource,
            data: {
              type: PluginIframeMessageType.DIALOG_BUTTON_RESPONSE,
              bridgeToken: 'test-bridge-token',
              bridgeGeneration: 4,
              dialogCallId: 7,
              buttonIndex: 0,
              result: undefined,
            },
          }),
        );
        await clickPromise;
        return 'Confirm';
      },
    } as unknown as PluginBridgeService;
    const config = createConfig(pluginBridge);

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          bridgeToken: 'test-bridge-token',
          bridgeGeneration: 4,
          method: 'openDialog',
          callId: 7,
          args: [
            {
              buttons: [
                {
                  label: 'Confirm',
                  __hasDialogButtonHandler: true,
                },
              ],
            },
          ],
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      config,
    );

    expect(bridgedDialogCfg?.buttons?.[0].onClick).toEqual(jasmine.any(Function));
    expect(bridgedDialogCfg?.buttons?.[0].__hasDialogButtonHandler).toBeUndefined();
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.DIALOG_BUTTON_CLICK,
        buttonIndex: 0,
        dialogCallId: 7,
      },
      { targetOrigin: '*' },
    );
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.API_RESPONSE,
        callId: 7,
        result: 'Confirm',
      },
      '*',
    );
  });

  it('reports iframe dialog button handler errors as API errors', async () => {
    const sourceWindow = window;
    const postMessageSpy = spyOn(sourceWindow, 'postMessage') as jasmine.Spy;
    const pluginBridge = {
      createBoundMethods: () => ({}),
      openDialog: async (dialogCfg: { buttons?: Array<Record<string, unknown>> }) => {
        const onClick = dialogCfg.buttons?.[0].onClick as
          | (() => Promise<void>)
          | undefined;
        const clickPromise = onClick?.();
        window.dispatchEvent(
          new MessageEvent('message', {
            source: sourceWindow as unknown as MessageEventSource,
            data: {
              type: PluginIframeMessageType.DIALOG_BUTTON_RESPONSE,
              bridgeToken: 'test-bridge-token',
              bridgeGeneration: 4,
              dialogCallId: 8,
              buttonIndex: 0,
              error: 'Button failed',
            },
          }),
        );
        await clickPromise;
      },
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          bridgeToken: 'test-bridge-token',
          bridgeGeneration: 4,
          method: 'openDialog',
          callId: 8,
          args: [
            {
              buttons: [
                {
                  label: 'Confirm',
                  __hasDialogButtonHandler: true,
                },
              ],
            },
          ],
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.API_ERROR,
        callId: 8,
        error: 'Button failed',
      },
      '*',
    );
  });

  it('ignores dialog button responses from a different iframe source', async () => {
    let dialogButtonResult: unknown;
    const sourceWindow = window;
    spyOn(sourceWindow, 'postMessage');
    const otherWindow = new MessageChannel().port1;
    const pluginBridge = {
      createBoundMethods: () => ({}),
      openDialog: async (dialogCfg: { buttons?: Array<Record<string, unknown>> }) => {
        const onClick = dialogCfg.buttons?.[0].onClick as
          | (() => Promise<unknown>)
          | undefined;
        const clickPromise = onClick?.();
        window.dispatchEvent(
          new MessageEvent('message', {
            source: otherWindow as unknown as MessageEventSource,
            data: {
              type: PluginIframeMessageType.DIALOG_BUTTON_RESPONSE,
              bridgeToken: 'test-bridge-token',
              bridgeGeneration: 3,
              dialogCallId: 10,
              buttonIndex: 0,
              result: 'spoofed',
            },
          }),
        );
        window.dispatchEvent(
          new MessageEvent('message', {
            source: sourceWindow as unknown as MessageEventSource,
            data: {
              type: PluginIframeMessageType.DIALOG_BUTTON_RESPONSE,
              bridgeToken: 'test-bridge-token',
              bridgeGeneration: 4,
              dialogCallId: 10,
              buttonIndex: 0,
              result: 'trusted',
            },
          }),
        );
        dialogButtonResult = await clickPromise;
        return 'Confirm';
      },
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          bridgeToken: 'test-bridge-token',
          bridgeGeneration: 4,
          method: 'openDialog',
          callId: 10,
          args: [
            {
              buttons: [
                {
                  label: 'Confirm',
                  __hasDialogButtonHandler: true,
                },
              ],
            },
          ],
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(dialogButtonResult).toBe('trusted');
  });

  it('routes iframe i18n API calls through plugin-bound methods', async () => {
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
    const translate = jasmine
      .createSpy('translate')
      .withArgs('DATE.YESTERDAY', { days: 1 })
      .and.returnValue('Gestern');
    const pluginBridge = {
      createBoundMethods: () => ({
        translate,
      }),
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          bridgeToken: 'test-bridge-token',
          bridgeGeneration: 4,
          method: 'translate',
          callId: 11,
          args: ['DATE.YESTERDAY', { days: 1 }],
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(translate).toHaveBeenCalledOnceWith('DATE.YESTERDAY', { days: 1 });
    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.API_RESPONSE,
        callId: 11,
        result: 'Gestern',
      },
      '*',
    );
  });

  it('routes getFocusedTask iframe API calls through plugin-bound methods', async () => {
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
    const focusedTask = { id: 'focused-task', title: 'Focused Task' };
    const getFocusedTask = jasmine.createSpy('getFocusedTask').and.resolveTo(focusedTask);
    const pluginBridge = {
      createBoundMethods: () => ({
        getFocusedTask,
      }),
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          bridgeToken: 'test-bridge-token',
          bridgeGeneration: 4,
          method: 'getFocusedTask',
          callId: 15,
          args: [],
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(getFocusedTask).toHaveBeenCalledTimes(1);
    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.API_RESPONSE,
        callId: 15,
        result: focusedTask,
      },
      '*',
    );
  });

  it('routes request iframe API calls through plugin-bound methods', async () => {
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
    const request = jasmine.createSpy('request').and.resolveTo({ ok: true });
    const pluginBridge = {
      createBoundMethods: () => ({
        request,
      }),
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          bridgeToken: 'test-bridge-token',
          bridgeGeneration: 4,
          method: 'request',
          callId: 17,
          args: ['https://example.test/api', { method: 'POST', body: { ok: true } }],
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(request).toHaveBeenCalledOnceWith('https://example.test/api', {
      method: 'POST',
      body: { ok: true },
    });
    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.API_RESPONSE,
        callId: 17,
        result: { ok: true },
      },
      '*',
    );
  });

  it('routes getSelectedTask iframe API calls through plugin-bound methods', async () => {
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
    const selectedTask = { id: 'selected-task', title: 'Selected Task' };
    const getSelectedTask = jasmine
      .createSpy('getSelectedTask')
      .and.resolveTo(selectedTask);
    const pluginBridge = {
      createBoundMethods: () => ({
        getSelectedTask,
      }),
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          bridgeToken: 'test-bridge-token',
          bridgeGeneration: 4,
          method: 'getSelectedTask',
          callId: 16,
          args: [],
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(getSelectedTask).toHaveBeenCalledTimes(1);
    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.API_RESPONSE,
        callId: 16,
        result: selectedTask,
      },
      '*',
    );
  });

  it('generates iframe code that waits for async dialog button handlers', () => {
    const script = createPluginApiScript(
      createConfig({ createBoundMethods: () => ({}) } as unknown as PluginBridgeService),
    );

    expect(script).toContain('Promise.resolve()');
    expect(script).toContain('.then(() => handler())');
    expect(script).toContain('Unknown dialog button error');
    expect(script).toContain('const bridgeToken = "test-bridge-token"');
    expect(script).toContain('const bridgeGeneration = 4');
    expect(script).toContain("getSelectedTask: () => callApi('getSelectedTask')");
    expect(script).toContain("getFocusedTask: () => callApi('getFocusedTask')");
    expect(script).toContain(
      "request: (url, options) => callApi('request', [url, options])",
    );
    expect(script).toContain(
      "registerHeaderButton: unsupportedIframeRegistration('registerHeaderButton')",
    );
  });

  // allow-same-origin is required: an opaque-origin iframe does not paint on
  // packaged file:// desktop builds and blanks every plugin UI (#8467). The
  // durable fix that restores opaque-origin isolation is an app:// scheme.
  it('runs iframe plugins with a same-origin sandbox so they render on file://', () => {
    expect(PLUGIN_IFRAME_SANDBOX).toContain('allow-scripts');
    expect(PLUGIN_IFRAME_SANDBOX).toContain('allow-same-origin');
  });

  describe('buildPluginIframeHtml()', () => {
    const pluginBridge = {
      createBoundMethods: () => ({}),
    } as unknown as PluginBridgeService;

    it('returns an inline HTML document (not a blob: URL) for srcdoc', () => {
      const html = buildPluginIframeHtml({
        ...createConfig(pluginBridge),
        indexHtml: '<html><head></head><body><div id="app"></div></body></html>',
      });
      expect(typeof html).toBe('string');
      expect(html.startsWith('blob:')).toBe(false);
      // plugin content is preserved
      expect(html).toContain('<div id="app"></div>');
    });

    it('injects the API bridge script (with the bridge token) before </body>', () => {
      const html = buildPluginIframeHtml({
        ...createConfig(pluginBridge),
        indexHtml: '<html><head></head><body></body></html>',
      });
      expect(html).toContain('const bridgeToken = "test-bridge-token"');
      expect(html).toContain('window.PluginAPI');
      // script is injected inside the body, before its closing tag
      expect(html.indexOf('window.PluginAPI')).toBeLessThan(html.indexOf('</body>'));
    });
  });

  it('rejects raw iframe calls to bridge methods outside the iframe API allowlist', async () => {
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
    const pluginBridge = {
      createBoundMethods: () => ({}),
      requestNodeExecutionGrant: jasmine.createSpy('requestNodeExecutionGrant'),
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          bridgeToken: 'test-bridge-token',
          bridgeGeneration: 4,
          method: 'requestNodeExecutionGrant',
          callId: 9,
          args: ['sync-md'],
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(
      (
        pluginBridge as unknown as {
          requestNodeExecutionGrant: jasmine.Spy;
        }
      ).requestNodeExecutionGrant,
    ).not.toHaveBeenCalled();
    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.API_ERROR,
        callId: 9,
        error: 'Unknown API method: requestNodeExecutionGrant',
      },
      '*',
    );
  });

  it('ignores iframe API calls without the bridge token', async () => {
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
    const pluginBridge = {
      createBoundMethods: () => ({}),
      getTasks: jasmine.createSpy('getTasks'),
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          method: 'getTasks',
          callId: 12,
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(
      (
        pluginBridge as unknown as {
          getTasks: jasmine.Spy;
        }
      ).getTasks,
    ).not.toHaveBeenCalled();
    expect(sourceWindow.postMessage).not.toHaveBeenCalled();
  });

  it('ignores iframe API calls from a stale bridge generation', async () => {
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
    const pluginBridge = {
      createBoundMethods: () => ({}),
      getTasks: jasmine.createSpy('getTasks'),
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          bridgeToken: 'test-bridge-token',
          bridgeGeneration: 3,
          method: 'getTasks',
          callId: 13,
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(
      (
        pluginBridge as unknown as {
          getTasks: jasmine.Spy;
        }
      ).getTasks,
    ).not.toHaveBeenCalled();
    expect(sourceWindow.postMessage).not.toHaveBeenCalled();
  });

  it('rejects raw iframe registration APIs that need callback proxying', async () => {
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
    const pluginBridge = {
      createBoundMethods: () => ({}),
      registerHeaderButton: jasmine.createSpy('registerHeaderButton'),
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          bridgeToken: 'test-bridge-token',
          bridgeGeneration: 4,
          method: 'registerHeaderButton',
          callId: 14,
          args: [{ label: 'Run' }],
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(
      (
        pluginBridge as unknown as {
          registerHeaderButton: jasmine.Spy;
        }
      ).registerHeaderButton,
    ).not.toHaveBeenCalled();
    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.API_ERROR,
        callId: 14,
        error: 'Unknown API method: registerHeaderButton',
      },
      '*',
    );
  });

  it('rejects raw iframe registerHook calls with legacy string handlers', async () => {
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
    const pluginBridge = {
      createBoundMethods: () => ({}),
      registerHook: jasmine.createSpy('registerHook'),
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.API_CALL,
          bridgeToken: 'test-bridge-token',
          bridgeGeneration: 4,
          method: 'registerHook',
          callId: 11,
          args: ['TASK_UPDATE', '() => window.__unexpectedParentHandler = true'],
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(
      (
        pluginBridge as unknown as {
          registerHook: jasmine.Spy;
        }
      ).registerHook,
    ).not.toHaveBeenCalled();
    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.API_ERROR,
        callId: 11,
        error: 'Iframe registerHook calls must use IFRAME_HANDLER',
      },
      '*',
    );
  });

  it('forwards legacy iframe plugin messages without requiring a bridge token', async () => {
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
    const pluginBridge = {
      createBoundMethods: () => ({}),
      sendMessageToPlugin: jasmine
        .createSpy('sendMessageToPlugin')
        .and.resolveTo({ ok: true }),
    } as unknown as PluginBridgeService;

    await handlePluginMessage(
      {
        data: {
          type: PluginIframeMessageType.MESSAGE,
          messageId: 'msg-1',
          message: { type: 'getConfig' },
        },
        source: sourceWindow,
      } as unknown as MessageEvent,
      createConfig(pluginBridge),
    );

    expect(
      (
        pluginBridge as unknown as {
          sendMessageToPlugin: jasmine.Spy;
        }
      ).sendMessageToPlugin,
    ).toHaveBeenCalledOnceWith('test-plugin', { type: 'getConfig' });
    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.MESSAGE_RESPONSE,
        messageId: 'msg-1',
        result: { ok: true },
      },
      '*',
    );
  });
});

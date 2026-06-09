import {
  PluginBaseCfg,
  PluginIframeMessageType,
  PluginManifest,
} from '@super-productivity/plugin-api';
import { PluginBridgeService } from '../plugin-bridge.service';
import {
  createPluginApiScript,
  handlePluginMessage,
  PluginIframeConfig,
} from './plugin-iframe.util';

describe('handlePluginMessage()', () => {
  const createConfig = (pluginBridge: PluginBridgeService): PluginIframeConfig => ({
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
    boundMethods: {} as ReturnType<
      typeof PluginBridgeService.prototype.createBoundMethods
    >,
  });

  it('rebuilds iframe dialog button handlers and returns the selected result', async () => {
    let bridgedDialogCfg:
      | {
          buttons?: Array<Record<string, unknown>>;
        }
      | undefined;
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
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
            data: {
              type: PluginIframeMessageType.DIALOG_BUTTON_RESPONSE,
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
    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.DIALOG_BUTTON_CLICK,
        buttonIndex: 0,
        dialogCallId: 7,
      },
      { targetOrigin: '*' },
    );
    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.API_RESPONSE,
        callId: 7,
        result: 'Confirm',
      },
      '*',
    );
  });

  it('reports iframe dialog button handler errors as API errors', async () => {
    const sourceWindow = jasmine.createSpyObj<{ postMessage: jasmine.Spy }>(
      'sourceWindow',
      ['postMessage'],
    );
    const pluginBridge = {
      createBoundMethods: () => ({}),
      openDialog: async (dialogCfg: { buttons?: Array<Record<string, unknown>> }) => {
        const onClick = dialogCfg.buttons?.[0].onClick as
          | (() => Promise<void>)
          | undefined;
        const clickPromise = onClick?.();
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: PluginIframeMessageType.DIALOG_BUTTON_RESPONSE,
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

    expect(sourceWindow.postMessage).toHaveBeenCalledWith(
      {
        type: PluginIframeMessageType.API_ERROR,
        callId: 8,
        error: 'Button failed',
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
  });
});

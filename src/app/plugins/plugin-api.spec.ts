import { PluginAPI } from './plugin-api';
import { PluginBaseCfg } from './plugin-api.model';
import { Log } from '../core/log';
import { BatchUpdateRequest, DialogCfg, NotifyCfg } from '@super-productivity/plugin-api';

describe('PluginAPI', () => {
  let pluginAPI: PluginAPI;
  let showIndexHtmlAsViewSpy: jasmine.Spy;
  let reInitDataSpy: jasmine.Spy;
  let dispatchActionSpy: jasmine.Spy;

  const baseCfg: PluginBaseCfg = {
    theme: 'light',
    appVersion: '1.0.0',
    platform: 'web',
    isDev: false,
  };

  beforeEach(() => {
    showIndexHtmlAsViewSpy = jasmine.createSpy('showIndexHtmlAsView');
    reInitDataSpy = jasmine.createSpy('reInitData').and.resolveTo();
    dispatchActionSpy = jasmine.createSpy('dispatchAction');

    const mockBridge = jasmine.createSpyObj('PluginBridgeService', [
      'createBoundMethods',
      'reInitData',
      'notify',
      'openDialog',
      'batchUpdateForProject',
    ]);
    mockBridge.reInitData.and.callFake(reInitDataSpy);
    mockBridge.createBoundMethods.and.returnValue({
      showIndexHtmlAsView: showIndexHtmlAsViewSpy,
      dispatchAction: dispatchActionSpy,
      persistDataSynced: jasmine.createSpy('persistDataSynced'),
      log: {
        critical: jasmine.createSpy(),
        err: jasmine.createSpy(),
        log: jasmine.createSpy(),
        info: jasmine.createSpy(),
        verbose: jasmine.createSpy(),
        debug: jasmine.createSpy(),
        error: jasmine.createSpy(),
        normal: jasmine.createSpy(),
        warn: jasmine.createSpy(),
      },
    });

    const mockI18nService = jasmine.createSpyObj('PluginI18nService', [
      'translate',
      'getCurrentLanguage',
    ]);

    pluginAPI = new PluginAPI(baseCfg, 'test-plugin', mockBridge, mockI18nService);
  });

  describe('showIndexHtmlAsView()', () => {
    it('should delegate to the bridge method', () => {
      pluginAPI.showIndexHtmlAsView();
      expect(showIndexHtmlAsViewSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispatchAction()', () => {
    beforeEach(() => Log.clearLogHistory());
    afterEach(() => Log.clearLogHistory());

    it('does not write the action payload (user content) to the exportable log', () => {
      const SECRET_TITLE = 'Plugin-dispatched secret task title 13579';

      pluginAPI.dispatchAction({
        type: '[Task] Add Task',
        task: { id: 'abc', title: SECRET_TITLE },
      });

      expect(Log.exportLogHistory()).not.toContain(SECRET_TITLE);
    });

    it('still records the action type and plugin id for diagnostics', () => {
      pluginAPI.dispatchAction({ type: '[Task] Add Task' });

      const exported = Log.exportLogHistory();
      expect(exported).toContain('[Task] Add Task');
      expect(exported).toContain('test-plugin');
    });

    it('delegates the original action to the bridge unchanged', () => {
      const action = { type: '[Task] Add Task', task: { id: 'abc' } };

      pluginAPI.dispatchAction(action);

      expect(dispatchActionSpy).toHaveBeenCalledOnceWith(action);
    });
  });

  describe('does not leak user content to the exportable log (#7619)', () => {
    beforeEach(() => Log.clearLogHistory());
    afterEach(() => Log.clearLogHistory());

    it('persistDataSynced does not log the persisted data blob', async () => {
      const SECRET = 'persisted-secret-blob-24680';

      await pluginAPI.persistDataSynced(JSON.stringify({ token: SECRET }));

      expect(Log.exportLogHistory()).not.toContain(SECRET);
    });

    it('notify does not log the notification title/body', async () => {
      const SECRET = 'notify-secret-task-name-24680';

      await pluginAPI.notify({
        title: SECRET,
        body: SECRET,
      } as unknown as NotifyCfg);

      expect(Log.exportLogHistory()).not.toContain(SECRET);
    });

    it('openDialog does not log the dialog content', async () => {
      const SECRET = 'dialog-secret-html-24680';

      await pluginAPI.openDialog({ htmlContent: SECRET } as unknown as DialogCfg);

      expect(Log.exportLogHistory()).not.toContain(SECRET);
    });

    it('batchUpdateForProject does not log task titles/notes', async () => {
      const SECRET = 'batch-secret-title-24680';

      await pluginAPI.batchUpdateForProject({
        projectId: 'p1',
        operations: [{ type: 'create', tempId: 't1', data: { title: SECRET } }],
      } as unknown as BatchUpdateRequest);

      expect(Log.exportLogHistory()).not.toContain(SECRET);
    });
  });

  describe('reInitData()', () => {
    it('should delegate to the bridge method', async () => {
      await pluginAPI.reInitData();
      expect(reInitDataSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('onReady()', () => {
    it('should register a callback via the onReadyRegister function', async () => {
      let registeredFn: (() => void | Promise<void>) | undefined;
      const mockBridge2 = jasmine.createSpyObj('PluginBridgeService', [
        'createBoundMethods',
      ]);
      mockBridge2.createBoundMethods.and.returnValue({
        log: jasmine.createSpyObj('log', ['log', 'err', 'info', 'warn', 'debug']),
      });
      const mockI18n2 = jasmine.createSpyObj('PluginI18nService', [
        'translate',
        'getCurrentLanguage',
      ]);
      const api = new PluginAPI(
        baseCfg,
        'test-plugin-2',
        mockBridge2,
        mockI18n2,
        undefined,
        (fn) => {
          registeredFn = fn;
        },
      );

      const readySpy = jasmine.createSpy('readyFn').and.resolveTo();
      api.onReady(readySpy);
      expect(registeredFn).toBeDefined();

      await registeredFn!();
      expect(readySpy).toHaveBeenCalledTimes(1);
    });

    it('should be a no-op when no onReadyRegister is provided', () => {
      // pluginAPI was constructed without onReadyRegister — should not throw
      expect(() => pluginAPI.onReady(() => {})).not.toThrow();
    });
  });
});

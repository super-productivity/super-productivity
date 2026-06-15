import { PluginAPI } from './plugin-api';
import { PluginBaseCfg } from './plugin-api.model';
import { PluginBridgeService } from './plugin-bridge.service';
import { Log } from '../core/log';
import {
  BatchUpdateRequest,
  DialogCfg,
  DialogResult,
  NotifyCfg,
} from '@super-productivity/plugin-api';

describe('PluginAPI', () => {
  let pluginAPI: PluginAPI;
  let showIndexHtmlAsViewSpy: jasmine.Spy;
  let reInitDataSpy: jasmine.Spy;
  let dispatchActionSpy: jasmine.Spy;
  let mockBridge: jasmine.SpyObj<{
    createBoundMethods: () => Record<string, unknown>;
    getAppState: () => Promise<unknown>;
    reInitData: () => Promise<void>;
    notify: () => Promise<void>;
    openDialog: (dialogCfg: DialogCfg) => Promise<DialogResult>;
    batchUpdateForProject: () => Promise<unknown>;
  }>;

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

    mockBridge = jasmine.createSpyObj('PluginBridgeService', [
      'createBoundMethods',
      'getAppState',
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
    mockBridge.getAppState.and.resolveTo({
      tasks: {},
      projects: {},
      tags: {},
      notes: {},
      taskRepeatCfgs: {},
      simpleCounters: {},
      globalConfig: { theme: 'light' },
    });

    const mockI18nService = jasmine.createSpyObj('PluginI18nService', [
      'translate',
      'getCurrentLanguage',
    ]);

    pluginAPI = new PluginAPI(
      baseCfg,
      'test-plugin',
      mockBridge as unknown as PluginBridgeService,
      mockI18nService,
    );
  });

  describe('showIndexHtmlAsView()', () => {
    it('should delegate to the bridge method', () => {
      pluginAPI.showIndexHtmlAsView();
      expect(showIndexHtmlAsViewSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('runtime API surface', () => {
    it('does not expose bridge internals as object properties', () => {
      expect(Object.getOwnPropertyNames(pluginAPI)).not.toContain('_pluginBridge');
      expect(Object.getOwnPropertyNames(pluginAPI)).not.toContain('_boundMethods');
      expect(
        (pluginAPI as unknown as { _pluginBridge?: unknown })._pluginBridge,
      ).toBeUndefined();
      expect(
        (pluginAPI as unknown as { _boundMethods?: unknown })._boundMethods,
      ).toBeUndefined();
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

  describe('openDialog()', () => {
    it('delegates to the bridge and returns the selected dialog result', async () => {
      const dialogCfg: DialogCfg = {
        htmlContent: '<p>Continue?</p>',
        buttons: [{ label: 'Continue' }],
      };
      mockBridge.openDialog.and.resolveTo('Continue');

      const result = await pluginAPI.openDialog(dialogCfg);

      expect(result).toBe('Continue');
      expect(mockBridge.openDialog).toHaveBeenCalledOnceWith(dialogCfg);
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

  describe('getAppState()', () => {
    it('should delegate to the bridge method and return the snapshot', async () => {
      const appState = await pluginAPI.getAppState();

      expect(appState).toEqual({
        tasks: {},
        projects: {},
        tags: {},
        notes: {},
        taskRepeatCfgs: {},
        simpleCounters: {},
        globalConfig: { theme: 'light' },
      });
      expect(mockBridge.getAppState).toHaveBeenCalledTimes(1);
    });
  });

  describe('lifecycle registration', () => {
    type LifecycleRegisters = NonNullable<ConstructorParameters<typeof PluginAPI>[5]>;

    const buildApiWithLifecycle = (lifecycle: LifecycleRegisters): PluginAPI => {
      const bridge = jasmine.createSpyObj('PluginBridgeService', ['createBoundMethods']);
      bridge.createBoundMethods.and.returnValue({
        log: jasmine.createSpyObj('log', ['log', 'err', 'info', 'warn', 'debug']),
      });
      const i18n = jasmine.createSpyObj('PluginI18nService', [
        'translate',
        'getCurrentLanguage',
      ]);
      return new PluginAPI(baseCfg, 'test-plugin-2', bridge, i18n, undefined, lifecycle);
    };

    it('should register an onReady callback via the lifecycle register', async () => {
      let registeredFn: (() => void | Promise<void>) | undefined;
      const api = buildApiWithLifecycle({ onReady: (fn) => (registeredFn = fn) });

      const readySpy = jasmine.createSpy('readyFn').and.resolveTo();
      api.onReady(readySpy);
      expect(registeredFn).toBeDefined();

      await registeredFn!();
      expect(readySpy).toHaveBeenCalledTimes(1);
    });

    it('should register an onUnload callback via the lifecycle register', async () => {
      let registeredFn: (() => void | Promise<void>) | undefined;
      const api = buildApiWithLifecycle({ onUnload: (fn) => (registeredFn = fn) });

      const unloadSpy = jasmine.createSpy('unloadFn').and.resolveTo();
      api.onUnload(unloadSpy);
      expect(registeredFn).toBeDefined();

      await registeredFn!();
      expect(unloadSpy).toHaveBeenCalledTimes(1);
    });

    it('should be a no-op when no lifecycle registers are provided', () => {
      // pluginAPI was constructed without lifecycle registers — should not throw
      expect(() => pluginAPI.onReady(() => {})).not.toThrow();
      expect(() => pluginAPI.onUnload(() => {})).not.toThrow();
    });
  });
});

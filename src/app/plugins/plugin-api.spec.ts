import { PluginAPI } from './plugin-api';
import { PluginBaseCfg } from './plugin-api.model';

describe('PluginAPI', () => {
  let pluginAPI: PluginAPI;
  let showIndexHtmlAsViewSpy: jasmine.Spy;
  let reInitDataSpy: jasmine.Spy;

  const baseCfg: PluginBaseCfg = {
    theme: 'light',
    appVersion: '1.0.0',
    platform: 'web',
    isDev: false,
  };

  beforeEach(() => {
    showIndexHtmlAsViewSpy = jasmine.createSpy('showIndexHtmlAsView');
    reInitDataSpy = jasmine.createSpy('reInitData').and.resolveTo();

    const mockBridge = jasmine.createSpyObj('PluginBridgeService', [
      'createBoundMethods',
      'reInitData',
    ]);
    mockBridge.reInitData.and.callFake(reInitDataSpy);
    mockBridge.createBoundMethods.and.returnValue({
      showIndexHtmlAsView: showIndexHtmlAsViewSpy,
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

  describe('reInitData()', () => {
    it('should delegate to the bridge method', async () => {
      await pluginAPI.reInitData();
      expect(reInitDataSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('onReady() / _triggerReady()', () => {
    it('should call the registered callback when _triggerReady is called', async () => {
      const readySpy = jasmine.createSpy('readyFn').and.resolveTo();
      pluginAPI.onReady(readySpy);
      await pluginAPI._triggerReady();
      expect(readySpy).toHaveBeenCalledTimes(1);
    });

    it('should not throw when _triggerReady is called with no callback registered', async () => {
      await expectAsync(pluginAPI._triggerReady()).toBeResolved();
    });

    it('should only call the most recently registered callback', async () => {
      const first = jasmine.createSpy('first');
      const second = jasmine.createSpy('second');
      pluginAPI.onReady(first);
      pluginAPI.onReady(second);
      await pluginAPI._triggerReady();
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });
});

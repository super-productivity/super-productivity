import { PluginAPI } from './plugin-api';
import { PluginBaseCfg } from './plugin-api.model';

describe('PluginAPI', () => {
  let pluginAPI: PluginAPI;
  let showIndexHtmlAsViewSpy: jasmine.Spy;

  const baseCfg: PluginBaseCfg = {
    theme: 'light',
    appVersion: '1.0.0',
    platform: 'web',
    isDev: false,
  };

  beforeEach(() => {
    showIndexHtmlAsViewSpy = jasmine.createSpy('showIndexHtmlAsView');

    const mockBridge = jasmine.createSpyObj('PluginBridgeService', [
      'createBoundMethods',
    ]);
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
});

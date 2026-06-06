import { createPluginIframeUrl } from './plugin-iframe.util';
import { PluginBridgeService } from '../plugin-bridge.service';
import { PluginIframeConfig } from './plugin-iframe.util';

describe('plugin iframe util', () => {
  it('injects PluginAPI before plugin scripts execute', async () => {
    const url = createPluginIframeUrl({
      pluginId: 'iframe-plugin',
      manifest: {
        id: 'iframe-plugin',
        name: 'Iframe Plugin',
        manifestVersion: 1,
        version: '1.0.0',
        minSupVersion: '1.0.0',
        hooks: [],
        permissions: [],
        iFrame: true,
      },
      indexHtml:
        '<!doctype html><html><head></head><body><script>window.pluginSawApi = !!window.PluginAPI;</script></body></html>',
      baseCfg: {
        theme: 'dark',
        appVersion: '1.0.0',
        platform: 'desktop',
        isDev: true,
      },
      pluginBridge: {} as PluginBridgeService,
    } satisfies PluginIframeConfig);

    try {
      const html = await fetch(url).then((res) => res.text());

      expect(html.indexOf('window.PluginAPI =')).toBeGreaterThan(-1);
      expect(html.indexOf('window.pluginSawApi')).toBeGreaterThan(-1);
      expect(html.indexOf('window.PluginAPI =')).toBeLessThan(
        html.indexOf('window.pluginSawApi'),
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  });
});

import { TestBed } from '@angular/core/testing';
import { PluginCleanupService } from './plugin-cleanup.service';

const getTrackedIframes = (
  service: PluginCleanupService,
): Map<string, HTMLIFrameElement> =>
  (service as unknown as { _pluginIframes: Map<string, HTMLIFrameElement> })
    ._pluginIframes;

describe('PluginCleanupService', () => {
  let service: PluginCleanupService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PluginCleanupService],
    });
    service = TestBed.inject(PluginCleanupService);
  });

  it('tracks registered plugin iframes', () => {
    const iframe = document.createElement('iframe');

    service.registerIframe('plugin-1', iframe);

    expect(getTrackedIframes(service).get('plugin-1')).toBe(iframe);
  });

  it('cleans up resources for a single plugin', () => {
    const iframe = document.createElement('iframe');
    service.registerIframe('plugin-1', iframe);

    service.cleanupPlugin('plugin-1');

    expect(getTrackedIframes(service).has('plugin-1')).toBe(false);
  });

  it('cleans up all tracked plugin iframes', () => {
    service.registerIframe('plugin-1', document.createElement('iframe'));
    service.registerIframe('plugin-2', document.createElement('iframe'));

    service.cleanupAll();

    expect(getTrackedIframes(service).size).toBe(0);
  });
});

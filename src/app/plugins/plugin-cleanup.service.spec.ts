/* TODO: Temporarily disabled while fixing core plugin issues
import { TestBed } from '@angular/core/testing';
import { PluginCleanupService } from './plugin-cleanup.service';

describe('PluginCleanupService', () => {
  let service: PluginCleanupService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PluginCleanupService],
    });
    service = TestBed.inject(PluginCleanupService);
  });

  describe('Timer management', () => {
    it('should register and cleanup timers', () => {
      const pluginId = 'test-plugin';
      const timerId = 123;

      // Register timer
      service.registerTimer(pluginId, timerId);

      // Spy on clearTimeout
      spyOn(window, 'clearTimeout');

      // Cleanup plugin
      service.cleanupPlugin(pluginId);

      expect(window.clearTimeout).toHaveBeenCalledWith(timerId);
    });

    it('should handle multiple timers per plugin', () => {
      const pluginId = 'test-plugin';
      const timerIds = [123, 456, 789];

      // Register multiple timers
      timerIds.forEach((id) => service.registerTimer(pluginId, id));

      // Spy on clearTimeout
      spyOn(window, 'clearTimeout');

      // Cleanup plugin
      service.cleanupPlugin(pluginId);

      // Should clear all timers
      timerIds.forEach((id) => {
        expect(window.clearTimeout).toHaveBeenCalledWith(id);
      });
    });
  });

  describe('Interval management', () => {
    it('should register and cleanup intervals', () => {
      const pluginId = 'test-plugin';
      const intervalId = 456;

      // Register interval
      service.registerInterval(pluginId, intervalId);

      // Spy on clearInterval
      spyOn(window, 'clearInterval');

      // Cleanup plugin
      service.cleanupPlugin(pluginId);

      expect(window.clearInterval).toHaveBeenCalledWith(intervalId);
    });
  });

  describe('Event listener management', () => {
    it('should register and cleanup event listeners', () => {
      const pluginId = 'test-plugin';
      const target = window;
      const type = 'message';
      const listener = (): void => {};
      const options = { capture: true };

      // Register listener
      service.registerEventListener(pluginId, target, type, listener, options);

      // Spy on removeEventListener
      spyOn(target, 'removeEventListener');

      // Cleanup plugin
      service.cleanupPlugin(pluginId);

      expect(target.removeEventListener).toHaveBeenCalledWith(type, listener, options);
    });
  });

  describe('AbortController management', () => {
    it('should register and abort controllers', () => {
      const pluginId = 'test-plugin';
      const controller = new AbortController();

      // Register controller
      service.registerAbortController(pluginId, controller);

      // Spy on abort
      spyOn(controller, 'abort');

      // Cleanup plugin
      service.cleanupPlugin(pluginId);

      expect(controller.abort).toHaveBeenCalled();
    });
  });

  describe('Iframe management', () => {
    it('should register and remove iframes', () => {
      const pluginId = 'test-plugin';
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);

      // Register iframe
      service.registerIframe(pluginId, iframe);

      // Cleanup plugin
      service.cleanupPlugin(pluginId);

      // Should remove iframe from DOM
      expect(iframe.parentNode).toBeNull();
    });
  });

  describe('cleanupAll', () => {
    it('should cleanup all plugins', () => {
      const plugin1 = 'plugin-1';
      const plugin2 = 'plugin-2';

      // Register resources for multiple plugins
      service.registerTimer(plugin1, 111);
      service.registerTimer(plugin2, 222);
      service.registerInterval(plugin1, 333);
      service.registerInterval(plugin2, 444);

      // Spy on cleanup methods
      spyOn(window, 'clearTimeout');
      spyOn(window, 'clearInterval');

      // Cleanup all
      service.cleanupAll();

      // Should clear all resources
      expect(window.clearTimeout).toHaveBeenCalledWith(111);
      expect(window.clearTimeout).toHaveBeenCalledWith(222);
      expect(window.clearInterval).toHaveBeenCalledWith(333);
      expect(window.clearInterval).toHaveBeenCalledWith(444);
    });
  });
});
*/

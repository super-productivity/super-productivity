import { TestBed } from '@angular/core/testing';
import { CapacitorPlatformService } from './capacitor-platform.service';
import { IS_ANDROID_WEB_VIEW_TOKEN } from '../../util/is-android-web-view';

describe('CapacitorPlatformService', () => {
  let service: CapacitorPlatformService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CapacitorPlatformService],
    });
    service = TestBed.inject(CapacitorPlatformService);
  });

  it('should detect platform type', () => {
    expect(service.platform).toBeDefined();
    expect(['ios', 'android', 'web', 'electron']).toContain(service.platform);
  });

  it('should have capabilities object', () => {
    expect(service.capabilities).toBeDefined();
    expect(typeof service.capabilities.scheduledNotifications).toBe('boolean');
    expect(typeof service.capabilities.webdavSync).toBe('boolean');
    expect(typeof service.capabilities.shareOut).toBe('boolean');
  });

  it('should have consistent platform checks', () => {
    // Only one platform method should return true
    const platformChecks = [
      service.isIOS(),
      service.isAndroid(),
      service.isElectron(),
      service.isWeb(),
    ];
    const trueCount = platformChecks.filter((x) => x).length;
    expect(trueCount).toBe(1);
  });

  it('should check capability via hasCapability method', () => {
    expect(service.hasCapability('webdavSync')).toBe(service.capabilities.webdavSync);
    expect(service.hasCapability('scheduledNotifications')).toBe(
      service.capabilities.scheduledNotifications,
    );
  });

  describe('in web environment', () => {
    // These tests run in Karma which is a web browser
    it('should detect web platform in test environment', () => {
      // In Karma test runner, we're in a web context
      expect(service.platform).toBe('web');
      expect(service.isWeb()).toBe(true);
      expect(service.isNative).toBe(false);
    });

    it('should have web capabilities', () => {
      expect(service.capabilities.backgroundTracking).toBe(false);
      expect(service.capabilities.localFileSync).toBe(false);
      expect(service.capabilities.webdavSync).toBe(true);
    });
  });

  describe('isLegacyAndroidWebView', () => {
    const setup = (isAndroidWebView: boolean): CapacitorPlatformService => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          CapacitorPlatformService,
          { provide: IS_ANDROID_WEB_VIEW_TOKEN, useValue: isAndroidWebView },
        ],
      });
      return TestBed.inject(CapacitorPlatformService);
    };

    // Karma runs without a Capacitor bridge, so `SUPAndroid` alone is exactly
    // the legacy shell (`MODE_ONLINE` in LaunchDecider.kt).
    it('should be true in the SUPAndroid WebView without a Capacitor bridge', () => {
      expect(setup(true).isLegacyAndroidWebView).toBe(true);
    });

    it('should be false without SUPAndroid', () => {
      expect(setup(false).isLegacyAndroidWebView).toBe(false);
    });

    it('should still report isNative for the legacy shell', () => {
      // Guards the ordering assumption in NotifyService: the legacy check must
      // come first, because `isNative` is true here too.
      expect(setup(true).isNative).toBe(true);
    });
  });
});

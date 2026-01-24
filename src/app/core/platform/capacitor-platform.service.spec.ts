import { TestBed } from '@angular/core/testing';
import { CapacitorPlatformService } from './capacitor-platform.service';

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
});

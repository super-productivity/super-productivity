import { TestBed } from '@angular/core/testing';
import { CapacitorNotificationService } from './capacitor-notification.service';
import { CapacitorPlatformService } from './capacitor-platform.service';

describe('CapacitorNotificationService', () => {
  let service: CapacitorNotificationService;
  let platformServiceSpy: jasmine.SpyObj<CapacitorPlatformService>;

  beforeEach(() => {
    // Create a spy for CapacitorPlatformService
    platformServiceSpy = jasmine.createSpyObj(
      'CapacitorPlatformService',
      ['hasCapability', 'isIOS', 'isAndroid'],
      {
        platform: 'web',
        isNative: false,
        isMobile: false,
        capabilities: {
          backgroundTracking: false,
          backgroundFocusTimer: false,
          localFileSync: false,
          homeWidget: false,
          scheduledNotifications: false,
          webdavSync: true,
          shareOut: true,
          shareIn: false,
          darkMode: true,
        },
      },
    );

    TestBed.configureTestingModule({
      providers: [
        CapacitorNotificationService,
        { provide: CapacitorPlatformService, useValue: platformServiceSpy },
      ],
    });
    service = TestBed.inject(CapacitorNotificationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('isAvailable', () => {
    it('should return false when scheduledNotifications capability is false', () => {
      expect(service.isAvailable).toBe(false);
    });

    it('should return true when scheduledNotifications capability is true', () => {
      // Create a new spy with notifications enabled
      const nativeServiceSpy = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['hasCapability'],
        {
          capabilities: {
            scheduledNotifications: true,
          },
        },
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          CapacitorNotificationService,
          { provide: CapacitorPlatformService, useValue: nativeServiceSpy },
        ],
      });
      const nativeService = TestBed.inject(CapacitorNotificationService);
      expect(nativeService.isAvailable).toBe(true);
    });
  });

  describe('requestPermissions', () => {
    it('should return false when not available', async () => {
      const result = await service.requestPermissions();
      expect(result).toBe(false);
    });
  });

  describe('checkPermissions', () => {
    it('should return false when not available', async () => {
      const result = await service.checkPermissions();
      expect(result).toBe(false);
    });
  });

  describe('ensurePermissions', () => {
    it('should return false when not available', async () => {
      const result = await service.ensurePermissions();
      expect(result).toBe(false);
    });
  });

  describe('schedule', () => {
    it('should return false when not available', async () => {
      const result = await service.schedule({
        id: 1,
        title: 'Test',
        body: 'Test body',
      });
      expect(result).toBe(false);
    });
  });

  describe('cancel', () => {
    it('should return false when not available', async () => {
      const result = await service.cancel(1);
      expect(result).toBe(false);
    });
  });

  describe('cancelMultiple', () => {
    it('should return false when not available', async () => {
      const result = await service.cancelMultiple([1, 2, 3]);
      expect(result).toBe(false);
    });

    it('should return false for empty array', async () => {
      const result = await service.cancelMultiple([]);
      expect(result).toBe(false);
    });
  });

  describe('getPending', () => {
    it('should return empty array when not available', async () => {
      const result = await service.getPending();
      expect(result).toEqual([]);
    });
  });

  describe('addActionListener', () => {
    it('should not throw when not available', async () => {
      await expectAsync(service.addActionListener(() => {})).toBeResolved();
    });
  });

  describe('removeAllListeners', () => {
    it('should not throw when not available', async () => {
      await expectAsync(service.removeAllListeners()).toBeResolved();
    });
  });
});

import { TestBed } from '@angular/core/testing';
import { CapacitorNotificationService } from './capacitor-notification.service';
import { CapacitorPlatformService } from './capacitor-platform.service';
import { LocalNotificationsWeb } from '@capacitor/local-notifications/dist/esm/web';

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

  describe('getPermissionState', () => {
    it("should return 'denied' when not available", async () => {
      const result = await service.getPermissionState();
      expect(result).toBe('denied');
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

    describe('when available', () => {
      let scheduleSpy: jasmine.Spy;
      const scheduleAt = new Date('2026-01-01T10:25:00.000Z');

      beforeEach(() => {
        spyOn(service, 'ensurePermissions').and.resolveTo(true);
        scheduleSpy = spyOn(LocalNotificationsWeb.prototype, 'schedule').and.resolveTo({
          notifications: [],
        });
        (
          Object.getOwnPropertyDescriptor(platformServiceSpy, 'capabilities')
            ?.get as jasmine.Spy
        ).and.returnValue({ scheduledNotifications: true });
      });

      it('should default to the system sound and leave foreground presentation alone', async () => {
        await service.schedule({ id: 7, title: 'T', body: 'B', scheduleAt });

        expect(scheduleSpy).toHaveBeenCalledOnceWith({
          notifications: [
            {
              id: 7,
              title: 'T',
              body: 'B',
              extra: undefined,
              sound: 'default',
              foreground: undefined,
              actionTypeId: undefined,
              schedule: { at: scheduleAt, allowWhileIdle: true },
            },
          ],
        });
      });

      it('should schedule silently and hidden in the foreground when asked', async () => {
        await service.schedule({
          id: 7,
          title: 'T',
          body: 'B',
          scheduleAt,
          sound: null,
          isShownInForeground: false,
        });

        const [notification] = scheduleSpy.calls.mostRecent().args[0].notifications;
        expect(notification.sound).toBeUndefined();
        expect(notification.foreground).toBe(false);
      });
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

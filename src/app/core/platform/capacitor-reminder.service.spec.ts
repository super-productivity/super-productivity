import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { CapacitorReminderService } from './capacitor-reminder.service';
import { CapacitorPlatformService } from './capacitor-platform.service';
import { CapacitorNotificationService } from './capacitor-notification.service';

describe('CapacitorReminderService', () => {
  let service: CapacitorReminderService;
  let platformServiceSpy: jasmine.SpyObj<CapacitorPlatformService>;
  let notificationServiceSpy: jasmine.SpyObj<CapacitorNotificationService>;

  beforeEach(() => {
    // Create spies for dependencies
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

    notificationServiceSpy = jasmine.createSpyObj('CapacitorNotificationService', [
      'ensurePermissions',
      'cancel',
      'cancelMultiple',
    ]);
    notificationServiceSpy.ensurePermissions.and.returnValue(Promise.resolve(true));
    notificationServiceSpy.cancel.and.returnValue(Promise.resolve(true));
    notificationServiceSpy.cancelMultiple.and.returnValue(Promise.resolve(true));

    TestBed.configureTestingModule({
      providers: [
        CapacitorReminderService,
        provideMockStore(),
        { provide: CapacitorPlatformService, useValue: platformServiceSpy },
        { provide: CapacitorNotificationService, useValue: notificationServiceSpy },
      ],
    });
    service = TestBed.inject(CapacitorReminderService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('isAvailable', () => {
    it('should return false when scheduledNotifications capability is false', () => {
      expect(service.isAvailable).toBe(false);
    });

    it('should return true when scheduledNotifications capability is true', () => {
      const nativePlatformSpy = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['hasCapability', 'isIOS'],
        {
          platform: 'ios',
          isNative: true,
          capabilities: {
            scheduledNotifications: true,
          },
        },
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          CapacitorReminderService,
          provideMockStore(),
          { provide: CapacitorPlatformService, useValue: nativePlatformSpy },
          { provide: CapacitorNotificationService, useValue: notificationServiceSpy },
        ],
      });
      const nativeService = TestBed.inject(CapacitorReminderService);
      expect(nativeService.isAvailable).toBe(true);
    });
  });

  describe('scheduleReminder', () => {
    it('should return false when not available', async () => {
      const result = await service.scheduleReminder({
        notificationId: 1,
        reminderId: 'task-1',
        relatedId: 'task-1',
        title: 'Test Reminder',
        reminderType: 'TASK',
        triggerAtMs: Date.now() + 60000,
      });
      expect(result).toBe(false);
    });
  });

  describe('cancelReminder', () => {
    it('should return false when not available', async () => {
      const result = await service.cancelReminder(1);
      expect(result).toBe(false);
    });
  });

  describe('cancelMultipleReminders', () => {
    it('should return false when not available', async () => {
      const result = await service.cancelMultipleReminders([1, 2, 3]);
      expect(result).toBe(false);
    });

    it('should return false for empty array', async () => {
      const result = await service.cancelMultipleReminders([]);
      expect(result).toBe(false);
    });
  });

  describe('ensurePermissions', () => {
    it('should return false when not available', async () => {
      const result = await service.ensurePermissions();
      expect(result).toBe(false);
    });
  });

  describe('with native platform', () => {
    let nativeService: CapacitorReminderService;
    let nativePlatformSpy: jasmine.SpyObj<CapacitorPlatformService>;

    beforeEach(() => {
      nativePlatformSpy = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['hasCapability', 'isIOS'],
        {
          platform: 'ios',
          isNative: true,
          isMobile: true,
          capabilities: {
            backgroundTracking: false,
            backgroundFocusTimer: false,
            localFileSync: false,
            homeWidget: false,
            scheduledNotifications: true,
            webdavSync: true,
            shareOut: true,
            shareIn: false,
            darkMode: true,
          },
        },
      );
      nativePlatformSpy.isIOS.and.returnValue(true);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          CapacitorReminderService,
          provideMockStore(),
          { provide: CapacitorPlatformService, useValue: nativePlatformSpy },
          { provide: CapacitorNotificationService, useValue: notificationServiceSpy },
        ],
      });
      nativeService = TestBed.inject(CapacitorReminderService);
    });

    it('should be available on native platform', () => {
      expect(nativeService.isAvailable).toBe(true);
    });

    it('should call notificationService.cancel when cancelling reminder', async () => {
      await nativeService.cancelReminder(123);
      expect(notificationServiceSpy.cancel).toHaveBeenCalledWith(123);
    });

    it('should call notificationService.cancelMultiple when cancelling multiple reminders', async () => {
      await nativeService.cancelMultipleReminders([1, 2, 3]);
      expect(notificationServiceSpy.cancelMultiple).toHaveBeenCalledWith([1, 2, 3]);
    });

    it('should call notificationService.ensurePermissions when ensuring permissions', async () => {
      await nativeService.ensurePermissions();
      expect(notificationServiceSpy.ensurePermissions).toHaveBeenCalled();
    });
  });
});

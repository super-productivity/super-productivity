import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { LocalNotificationsWeb } from '@capacitor/local-notifications/dist/esm/web';
import { CapacitorReminderService } from './capacitor-reminder.service';
import { CapacitorPlatformService } from './capacitor-platform.service';
import {
  CapacitorNotificationService,
  REMINDER_ACTION_TYPE_ID,
} from './capacitor-notification.service';
import { IS_ANDROID_WEB_VIEW_TOKEN } from '../../util/is-android-web-view';

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

  describe('ensureExactAlarmPermission', () => {
    it('should return true on non-Android platforms', async () => {
      const result = await service.ensureExactAlarmPermission();
      expect(result).toBe(true);
    });
  });

  describe('legacy Android WebView path (issue #7408)', () => {
    let legacyService: CapacitorReminderService;
    let checkExactAlarmSpy: jasmine.Spy;

    beforeEach(() => {
      const nativePlatformSpy = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['hasCapability', 'isIOS'],
        {
          platform: 'android',
          isNative: true,
          isMobile: true,
          capabilities: { scheduledNotifications: true },
        },
      );
      checkExactAlarmSpy = spyOn(
        LocalNotificationsWeb.prototype,
        'checkExactNotificationSetting',
      );
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          CapacitorReminderService,
          provideMockStore(),
          { provide: CapacitorPlatformService, useValue: nativePlatformSpy },
          { provide: CapacitorNotificationService, useValue: notificationServiceSpy },
          // Override the WebView discriminator via DI; `Capacitor.isNativePlatform()`
          // is naturally false in the test environment, so the legacy-path
          // condition `_isAndroidWebView && !Capacitor.isNativePlatform()` evaluates true.
          { provide: IS_ANDROID_WEB_VIEW_TOKEN, useValue: true },
        ],
      });
      legacyService = TestBed.inject(CapacitorReminderService);
    });

    it('ensurePermissions short-circuits without consulting Capacitor', async () => {
      // The whole point of issue #7408: avoid the broken Web Notifications API
      // fallback. We must NOT delegate to _notificationService here.
      const result = await legacyService.ensurePermissions();
      expect(result).toBe(true);
      expect(notificationServiceSpy.ensurePermissions).not.toHaveBeenCalled();
    });

    it('ensureExactAlarmPermission short-circuits without consulting Capacitor', async () => {
      const result = await legacyService.ensureExactAlarmPermission();
      expect(result).toBe(true);
      expect(checkExactAlarmSpy).not.toHaveBeenCalled();
    });
  });

  describe('with native platform', () => {
    let nativeService: CapacitorReminderService;
    let nativePlatformSpy: jasmine.SpyObj<CapacitorPlatformService>;
    let scheduleSpy: jasmine.Spy;

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

      scheduleSpy = spyOn(LocalNotificationsWeb.prototype, 'schedule').and.returnValue(
        Promise.resolve({ notifications: [] }),
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

    it('should include sound property when scheduling on iOS', async () => {
      await nativeService.scheduleReminder({
        notificationId: 42,
        reminderId: 'task-1',
        relatedId: 'task-1',
        title: 'Test Reminder',
        reminderType: 'TASK',
        triggerAtMs: Date.now() + 60000,
      });

      expect(scheduleSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          notifications: [
            jasmine.objectContaining({
              sound: 'default',
            }),
          ],
        }),
      );
    });

    it('should include reminder actions for explicit iOS task reminders', async () => {
      await nativeService.scheduleReminder({
        notificationId: 42,
        reminderId: 'task-1',
        relatedId: 'task-1',
        title: 'Test Reminder',
        reminderType: 'TASK',
        triggerAtMs: Date.now() + 60000,
      });

      expect(scheduleSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          notifications: [
            jasmine.objectContaining({
              actionTypeId: REMINDER_ACTION_TYPE_ID,
            }),
          ],
        }),
      );
    });

    it('should include reminder actions and metadata for explicit iOS deadline reminders', async () => {
      await nativeService.scheduleReminder({
        notificationId: 42,
        reminderId: 'task-1_deadline',
        relatedId: 'task-1',
        title: 'Test Reminder',
        reminderType: 'DEADLINE',
        triggerAtMs: Date.now() + 60000,
      });

      expect(scheduleSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          notifications: [
            jasmine.objectContaining({
              actionTypeId: REMINDER_ACTION_TYPE_ID,
              extra: jasmine.objectContaining({
                reminderId: 'task-1_deadline',
                relatedId: 'task-1',
                reminderType: 'DEADLINE',
              }),
            }),
          ],
        }),
      );
    });

    it('should not include reminder actions for due-date notifications', async () => {
      await nativeService.scheduleReminder({
        notificationId: 42,
        reminderId: 'task-1',
        relatedId: 'task-1',
        title: 'Test Reminder',
        reminderType: 'DUE_DATE',
        triggerAtMs: Date.now() + 60000,
      });

      expect(scheduleSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          notifications: [
            jasmine.objectContaining({
              actionTypeId: undefined,
            }),
          ],
        }),
      );
    });
  });
});

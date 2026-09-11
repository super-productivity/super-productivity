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
      'getPermissionState',
      'cancel',
      'cancelMultiple',
      'registerReminderActions',
    ]);
    notificationServiceSpy.ensurePermissions.and.returnValue(Promise.resolve(true));
    notificationServiceSpy.getPermissionState.and.returnValue(Promise.resolve('granted'));
    notificationServiceSpy.cancel.and.returnValue(Promise.resolve(true));
    notificationServiceSpy.cancelMultiple.and.returnValue(Promise.resolve(true));
    notificationServiceSpy.registerReminderActions.and.returnValue(Promise.resolve());

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

  describe('initialize', () => {
    // initialize() branches solely on isIOS(); other platform fields are
    // intentionally omitted to keep the mock honest about what's exercised.
    const setupPlatform = (
      platform: 'ios' | 'android' | 'web',
    ): CapacitorReminderService => {
      const platformSpy = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['hasCapability', 'isIOS'],
        { platform },
      );
      platformSpy.isIOS.and.returnValue(platform === 'ios');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          CapacitorReminderService,
          provideMockStore(),
          { provide: CapacitorPlatformService, useValue: platformSpy },
          { provide: CapacitorNotificationService, useValue: notificationServiceSpy },
        ],
      });
      return TestBed.inject(CapacitorReminderService);
    };

    it('registers reminder action types on iOS', async () => {
      const iosService = setupPlatform('ios');
      await iosService.initialize();
      expect(notificationServiceSpy.registerReminderActions).toHaveBeenCalledTimes(1);
    });

    it('does NOT request permissions eagerly on iOS (contextual prompt on first schedule)', async () => {
      const iosService = setupPlatform('ios');
      await iosService.initialize();
      expect(notificationServiceSpy.ensurePermissions).not.toHaveBeenCalled();
    });

    it('is a no-op on Android', async () => {
      const androidService = setupPlatform('android');
      await androidService.initialize();
      expect(notificationServiceSpy.registerReminderActions).not.toHaveBeenCalled();
      expect(notificationServiceSpy.ensurePermissions).not.toHaveBeenCalled();
    });

    it('is a no-op on web', async () => {
      const webService = setupPlatform('web');
      await webService.initialize();
      expect(notificationServiceSpy.registerReminderActions).not.toHaveBeenCalled();
      expect(notificationServiceSpy.ensurePermissions).not.toHaveBeenCalled();
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

  describe('requestPermissionsInBackground (#9648)', () => {
    it('does nothing when notifications are unavailable', () => {
      service.requestPermissionsInBackground();
      expect(notificationServiceSpy.ensurePermissions).not.toHaveBeenCalled();
    });

    describe('on a native (non-legacy) platform', () => {
      let nativeService: CapacitorReminderService;

      beforeEach(() => {
        const nativePlatformSpy = jasmine.createSpyObj(
          'CapacitorPlatformService',
          ['hasCapability', 'isIOS', 'isAndroid'],
          {
            platform: 'android',
            isNative: true,
            isMobile: true,
            capabilities: { scheduledNotifications: true },
          },
        );
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [
            CapacitorReminderService,
            provideMockStore(),
            { provide: CapacitorPlatformService, useValue: nativePlatformSpy },
            { provide: CapacitorNotificationService, useValue: notificationServiceSpy },
            { provide: IS_ANDROID_WEB_VIEW_TOKEN, useValue: false },
          ],
        });
        nativeService = TestBed.inject(CapacitorReminderService);
      });

      it('requests the permission when it has not been granted yet', async () => {
        notificationServiceSpy.getPermissionState.and.returnValue(
          Promise.resolve('prompt'),
        );

        await nativeService.requestPermissionsInBackground();

        expect(notificationServiceSpy.ensurePermissions).toHaveBeenCalledTimes(1);
      });

      it('resolves true when the permission was newly granted, so the caller re-posts', async () => {
        notificationServiceSpy.getPermissionState.and.returnValue(
          Promise.resolve('prompt'),
        );
        notificationServiceSpy.ensurePermissions.and.returnValue(Promise.resolve(true));

        await expectAsync(nativeService.requestPermissionsInBackground()).toBeResolvedTo(
          true,
        );
      });

      it('resolves false when already granted — nothing was suppressed, so no re-post', async () => {
        notificationServiceSpy.getPermissionState.and.returnValue(
          Promise.resolve('granted'),
        );

        await expectAsync(nativeService.requestPermissionsInBackground()).toBeResolvedTo(
          false,
        );
        expect(notificationServiceSpy.ensurePermissions).not.toHaveBeenCalled();
      });

      it('resolves false when the user denies, so the caller does not re-post', async () => {
        notificationServiceSpy.getPermissionState.and.returnValue(
          Promise.resolve('prompt'),
        );
        notificationServiceSpy.ensurePermissions.and.returnValue(Promise.resolve(false));

        await expectAsync(nativeService.requestPermissionsInBackground()).toBeResolvedTo(
          false,
        );
      });

      it('asks at most once per session so back-to-back service starts cannot stack dialogs', async () => {
        notificationServiceSpy.getPermissionState.and.returnValue(
          Promise.resolve('prompt'),
        );

        await Promise.all([
          nativeService.requestPermissionsInBackground(),
          nativeService.requestPermissionsInBackground(),
          nativeService.requestPermissionsInBackground(),
        ]);

        expect(notificationServiceSpy.ensurePermissions).toHaveBeenCalledTimes(1);
      });

      it('does not re-prompt for the rest of the session after a denial', async () => {
        notificationServiceSpy.getPermissionState.and.returnValue(
          Promise.resolve('prompt'),
        );
        notificationServiceSpy.ensurePermissions.and.returnValue(Promise.resolve(false));

        await nativeService.requestPermissionsInBackground();
        await nativeService.requestPermissionsInBackground();

        expect(notificationServiceSpy.ensurePermissions).toHaveBeenCalledTimes(1);
      });

      it('reports "newly granted" only until the request settles — later timer starts must not re-post', async () => {
        notificationServiceSpy.getPermissionState.and.returnValue(
          Promise.resolve('prompt'),
        );
        notificationServiceSpy.ensurePermissions.and.returnValue(Promise.resolve(true));

        await expectAsync(nativeService.requestPermissionsInBackground()).toBeResolvedTo(
          true,
        );
        // Notifications posted after the grant are not suppressed, so a stale
        // true here would cause a redundant re-post on every later start.
        await expectAsync(nativeService.requestPermissionsInBackground()).toBeResolvedTo(
          false,
        );
        expect(notificationServiceSpy.ensurePermissions).toHaveBeenCalledTimes(1);
      });

      it('shares the pending grant with callers that start while the dialog is still open', async () => {
        notificationServiceSpy.getPermissionState.and.returnValue(
          Promise.resolve('prompt'),
        );
        let resolveDialog!: (granted: boolean) => void;
        notificationServiceSpy.ensurePermissions.and.returnValue(
          new Promise<boolean>((resolve) => (resolveDialog = resolve)),
        );

        // Both starts happen before the user grants — both notifications were
        // suppressed, so both callers need the re-post signal.
        const first = nativeService.requestPermissionsInBackground();
        const second = nativeService.requestPermissionsInBackground();
        resolveDialog(true);

        await expectAsync(first).toBeResolvedTo(true);
        await expectAsync(second).toBeResolvedTo(true);
      });
    });
  });

  describe('getPermissionState', () => {
    it("should return 'denied' when not available, without prompting", async () => {
      const result = await service.getPermissionState();
      expect(result).toBe('denied');
      expect(notificationServiceSpy.getPermissionState).not.toHaveBeenCalled();
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

    it('requestPermissionsInBackground short-circuits without consulting Capacitor', async () => {
      // isAvailable is TRUE on the legacy shell (platform resolves to 'android'),
      // so the #7408 guards are the only thing keeping us off the broken Web
      // Notifications fallback here.
      await expectAsync(legacyService.requestPermissionsInBackground()).toBeResolvedTo(
        false,
      );
      expect(notificationServiceSpy.ensurePermissions).not.toHaveBeenCalled();
      expect(notificationServiceSpy.getPermissionState).not.toHaveBeenCalled();
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

    it("getPermissionState reports 'granted' without consulting Capacitor", async () => {
      // Same #7408 reasoning as ensurePermissions: the upfront check is broken
      // in the legacy WebView, so we trust the OS to gate at fire time.
      const result = await legacyService.getPermissionState();
      expect(result).toBe('granted');
      expect(notificationServiceSpy.getPermissionState).not.toHaveBeenCalled();
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

    it('getPermissionState delegates to notificationService (no prompt) on native', async () => {
      notificationServiceSpy.getPermissionState.and.returnValue(
        Promise.resolve('denied'),
      );
      const result = await nativeService.getPermissionState();
      expect(result).toBe('denied');
      expect(notificationServiceSpy.getPermissionState).toHaveBeenCalledTimes(1);
      expect(notificationServiceSpy.ensurePermissions).not.toHaveBeenCalled();
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

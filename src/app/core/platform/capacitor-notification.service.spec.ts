import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { LocalNotificationsWeb } from '@capacitor/local-notifications/dist/esm/web';
import { CapacitorNotificationService } from './capacitor-notification.service';
import { CapacitorPlatformService } from './capacitor-platform.service';
import { T } from '../../t.const';

const mockTranslateService = {
  instant: (key: string): string => key,
  onLangChange: new Subject<unknown>(),
};

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
        { provide: TranslateService, useValue: mockTranslateService },
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
          { provide: TranslateService, useValue: mockTranslateService },
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

  describe('registerReminderActions (localized, issue #9344)', () => {
    let availableService: CapacitorNotificationService;
    let registerActionTypesSpy: jasmine.Spy;
    let onLangChange$: Subject<unknown>;

    beforeEach(() => {
      onLangChange$ = new Subject<unknown>();
      const availablePlatformSpy = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['hasCapability', 'isIOS'],
        {
          platform: 'ios',
          isNative: true,
          capabilities: { scheduledNotifications: true },
        },
      );

      registerActionTypesSpy = spyOn(
        LocalNotificationsWeb.prototype,
        'registerActionTypes',
      ).and.returnValue(Promise.resolve());

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          // The mock's `instant` returns the key itself, so asserting on the
          // T.* constants below proves the titles went through the translator.
          {
            provide: TranslateService,
            useValue: {
              instant: (key: string): string => key,
              onLangChange: onLangChange$,
            },
          },
          CapacitorNotificationService,
          { provide: CapacitorPlatformService, useValue: availablePlatformSpy },
        ],
      });
      availableService = TestBed.inject(CapacitorNotificationService);
    });

    it('registers the action buttons with translated titles', async () => {
      await availableService.registerReminderActions();

      expect(registerActionTypesSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          types: [
            jasmine.objectContaining({
              actions: [
                jasmine.objectContaining({ title: T.F.REMINDER.N_ACTION_DONE }),
                jasmine.objectContaining({ title: T.F.REMINDER.N_ACTION_SNOOZE_10M }),
                jasmine.objectContaining({ title: T.F.REMINDER.N_ACTION_SNOOZE_1H }),
              ],
            }),
          ],
        }),
      );
    });

    it('re-registers the action types when the language changes', async () => {
      await availableService.registerReminderActions();
      expect(registerActionTypesSpy).toHaveBeenCalledTimes(1);

      onLangChange$.next({});
      // The Capacitor plugin proxy dispatches asynchronously; give the
      // re-registration a macrotask to go through.
      await new Promise((resolve) => setTimeout(resolve));
      expect(registerActionTypesSpy).toHaveBeenCalledTimes(2);
    });

    it('does not re-register on language change before the initial registration', () => {
      onLangChange$.next({});
      expect(registerActionTypesSpy).not.toHaveBeenCalled();
    });
  });
});

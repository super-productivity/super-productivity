import { TestBed } from '@angular/core/testing';
import { EffectsModule } from '@ngrx/effects';
import { provideMockStore } from '@ngrx/store/testing';
import { MobileNotificationEffects } from './mobile-notification.effects';
import { SnackService } from '../../../core/snack/snack.service';
import { CapacitorReminderService } from '../../../core/platform/capacitor-reminder.service';
import { CapacitorPlatformService } from '../../../core/platform/capacitor-platform.service';

describe('MobileNotificationEffects', () => {
  let effects: MobileNotificationEffects;
  let platformService: jasmine.SpyObj<CapacitorPlatformService>;

  describe('on non-native platform', () => {
    beforeEach(() => {
      platformService = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['isIOS', 'isAndroid'],
        {
          platform: 'web',
          isNative: false,
        },
      );

      TestBed.configureTestingModule({
        imports: [EffectsModule.forRoot([])],
        providers: [
          MobileNotificationEffects,
          provideMockStore({ initialState: {} }),
          {
            provide: SnackService,
            useValue: jasmine.createSpyObj('SnackService', ['open']),
          },
          {
            provide: CapacitorReminderService,
            useValue: jasmine.createSpyObj('CapacitorReminderService', [
              'ensurePermissions',
              'scheduleReminder',
              'cancelReminder',
            ]),
          },
          { provide: CapacitorPlatformService, useValue: platformService },
        ],
      });

      effects = TestBed.inject(MobileNotificationEffects);
    });

    it('should be created', () => {
      expect(effects).toBeTruthy();
    });

    it('should have askPermissionsIfNotGiven$ as false on non-native', () => {
      expect(effects.askPermissionsIfNotGiven$).toBe(false);
    });

    it('should have scheduleNotifications$ as false on non-native', () => {
      expect(effects.scheduleNotifications$).toBe(false);
    });
  });
});

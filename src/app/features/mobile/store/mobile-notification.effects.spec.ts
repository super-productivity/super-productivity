import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { EffectsModule } from '@ngrx/effects';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, NEVER, Observable } from 'rxjs';
import { MobileNotificationEffects } from './mobile-notification.effects';
import { SnackService } from '../../../core/snack/snack.service';
import { CapacitorReminderService } from '../../../core/platform/capacitor-reminder.service';
import { CapacitorPlatformService } from '../../../core/platform/capacitor-platform.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { ReminderConfig } from '../../config/global-config.model';
import {
  selectAllTasksWithReminder,
  selectAllTasksWithDeadlineReminder,
  selectUndoneTasksWithDueDayNoReminder,
} from '../../tasks/store/task.selectors';
import { generateNotificationId } from '../../android/android-notification-id.util';
import { Task, TaskWithReminder } from '../../tasks/task.model';

// Matches the internal DELAY_SCHEDULE in the effects file.
const EFFECT_DELAY_MS = 5000;

// Minimal shape the effect reads off GlobalConfigService.cfg$.
type TestCfg = { reminder: Partial<ReminderConfig> };

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
              'checkExactAlarmPermission',
            ]),
          },
          { provide: CapacitorPlatformService, useValue: platformService },
          {
            provide: GlobalConfigService,
            useValue: jasmine.createSpyObj('GlobalConfigService', [], {
              cfg$: NEVER,
            }),
          },
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

    it('should have scheduleDueDateNotifications$ as false on non-native', () => {
      expect(effects.scheduleDueDateNotifications$).toBe(false);
    });

    it('should have scheduleDeadlineNotifications$ as false on non-native', () => {
      expect(effects.scheduleDeadlineNotifications$).toBe(false);
    });
  });

  describe('on native platform — disableReminders gating', () => {
    let reminderServiceSpy: jasmine.SpyObj<CapacitorReminderService>;
    let cfg$: BehaviorSubject<TestCfg>;
    let store: MockStore;

    const buildCfg = (overrides: Partial<ReminderConfig> = {}): TestCfg => ({
      reminder: {
        disableReminders: false,
        notifyOnDueDate: false,
        dueDateNotificationHour: 9,
        ...overrides,
      },
    });

    beforeEach(() => {
      reminderServiceSpy = jasmine.createSpyObj('CapacitorReminderService', [
        'ensurePermissions',
        'scheduleReminder',
        'cancelReminder',
      ]);
      reminderServiceSpy.ensurePermissions.and.resolveTo(true);
      reminderServiceSpy.scheduleReminder.and.resolveTo();
      reminderServiceSpy.cancelReminder.and.resolveTo();

      cfg$ = new BehaviorSubject<TestCfg>(buildCfg());

      platformService = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['isIOS', 'isAndroid'],
        { platform: 'android', isNative: true },
      );

      TestBed.configureTestingModule({
        imports: [EffectsModule.forRoot([])],
        providers: [
          MobileNotificationEffects,
          provideMockStore({
            initialState: {},
            selectors: [
              { selector: selectAllTasksWithReminder, value: [] },
              { selector: selectAllTasksWithDeadlineReminder, value: [] },
              { selector: selectUndoneTasksWithDueDayNoReminder, value: [] },
            ],
          }),
          {
            provide: SnackService,
            useValue: jasmine.createSpyObj('SnackService', ['open']),
          },
          { provide: CapacitorReminderService, useValue: reminderServiceSpy },
          { provide: CapacitorPlatformService, useValue: platformService },
          { provide: GlobalConfigService, useValue: { cfg$: cfg$.asObservable() } },
        ],
      });

      store = TestBed.inject(MockStore);
    });

    const futureReminder = (id: string): TaskWithReminder =>
      ({
        id,
        title: `task ${id}`,
        remindAt: Date.now() + 600_000,
      }) as TaskWithReminder;

    const subscribeScheduleNotifications = (): void => {
      effects = TestBed.inject(MobileNotificationEffects);
      (effects.scheduleNotifications$ as unknown as Observable<unknown>).subscribe();
    };

    it('schedules reminders normally when disableReminders is false', fakeAsync(() => {
      store.overrideSelector(selectAllTasksWithReminder, [futureReminder('a')]);
      subscribeScheduleNotifications();

      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);
      expect(reminderServiceSpy.cancelReminder).not.toHaveBeenCalled();
    }));

    it('skips scheduling and clears tracking when disableReminders is true from the start', fakeAsync(() => {
      cfg$.next(buildCfg({ disableReminders: true }));
      store.overrideSelector(selectAllTasksWithReminder, [futureReminder('a')]);
      subscribeScheduleNotifications();

      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalled();
    }));

    it('cancels previously-scheduled reminders with correct notification IDs when disableReminders flips true', fakeAsync(() => {
      store.overrideSelector(selectAllTasksWithReminder, [
        futureReminder('a'),
        futureReminder('b'),
      ]);
      subscribeScheduleNotifications();

      tick(EFFECT_DELAY_MS + 1);
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(2);

      cfg$.next(buildCfg({ disableReminders: true }));
      tick(1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledTimes(2);
      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledWith(
        generateNotificationId('a'),
      );
      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledWith(
        generateNotificationId('b'),
      );
    }));
  });

  describe('on native platform — due-date gating', () => {
    let reminderServiceSpy: jasmine.SpyObj<CapacitorReminderService>;
    let cfg$: BehaviorSubject<TestCfg>;

    const futureDueTask = (id: string): { id: string; title: string; dueDay: string } => {
      const d = new Date(Date.now() + 86_400_000);
      const dueDay = d.toISOString().slice(0, 10);
      return { id, title: `task ${id}`, dueDay };
    };

    beforeEach(() => {
      reminderServiceSpy = jasmine.createSpyObj('CapacitorReminderService', [
        'ensurePermissions',
        'scheduleReminder',
        'cancelReminder',
      ]);
      reminderServiceSpy.ensurePermissions.and.resolveTo(true);
      reminderServiceSpy.scheduleReminder.and.resolveTo();
      reminderServiceSpy.cancelReminder.and.resolveTo();

      cfg$ = new BehaviorSubject<TestCfg>({
        reminder: {
          disableReminders: false,
          notifyOnDueDate: true,
          dueDateNotificationHour: 9,
        },
      });

      platformService = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['isIOS', 'isAndroid'],
        { platform: 'android', isNative: true },
      );

      TestBed.configureTestingModule({
        imports: [EffectsModule.forRoot([])],
        providers: [
          MobileNotificationEffects,
          provideMockStore({
            initialState: {},
            selectors: [
              { selector: selectAllTasksWithReminder, value: [] },
              { selector: selectAllTasksWithDeadlineReminder, value: [] },
              {
                selector: selectUndoneTasksWithDueDayNoReminder,
                value: [futureDueTask('x')],
              },
            ],
          }),
          {
            provide: SnackService,
            useValue: jasmine.createSpyObj('SnackService', ['open']),
          },
          { provide: CapacitorReminderService, useValue: reminderServiceSpy },
          { provide: CapacitorPlatformService, useValue: platformService },
          { provide: GlobalConfigService, useValue: { cfg$: cfg$.asObservable() } },
        ],
      });

      TestBed.inject(MockStore);
    });

    it('short-circuits due-date scheduling when disableReminders is true', fakeAsync(() => {
      cfg$.next({
        reminder: {
          disableReminders: true,
          notifyOnDueDate: true,
          dueDateNotificationHour: 9,
        },
      });

      effects = TestBed.inject(MobileNotificationEffects);
      (
        effects.scheduleDueDateNotifications$ as unknown as Observable<unknown>
      ).subscribe();

      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalled();
    }));
  });

  describe('on native platform — deadline reminders', () => {
    let reminderServiceSpy: jasmine.SpyObj<CapacitorReminderService>;
    let cfg$: BehaviorSubject<TestCfg>;
    let store: MockStore;

    const buildCfg = (overrides: Partial<ReminderConfig> = {}): TestCfg => ({
      reminder: {
        disableReminders: false,
        notifyOnDueDate: true,
        dueDateNotificationHour: 9,
        ...overrides,
      },
    });

    const futureDeadlineTask = (id: string): Task =>
      ({
        id,
        title: `task ${id}`,
        deadlineRemindAt: Date.now() + 600_000,
      }) as Task;

    const pastDeadlineTask = (id: string): Task =>
      ({
        id,
        title: `task ${id}`,
        deadlineRemindAt: Date.now() - 600_000,
      }) as Task;

    beforeEach(() => {
      reminderServiceSpy = jasmine.createSpyObj('CapacitorReminderService', [
        'ensurePermissions',
        'scheduleReminder',
        'cancelReminder',
      ]);
      reminderServiceSpy.ensurePermissions.and.resolveTo(true);
      reminderServiceSpy.scheduleReminder.and.resolveTo();
      reminderServiceSpy.cancelReminder.and.resolveTo();

      cfg$ = new BehaviorSubject<TestCfg>(buildCfg());

      platformService = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['isIOS', 'isAndroid'],
        { platform: 'ios', isNative: true },
      );
      platformService.isIOS.and.returnValue(true);

      TestBed.configureTestingModule({
        imports: [EffectsModule.forRoot([])],
        providers: [
          MobileNotificationEffects,
          provideMockStore({
            initialState: {},
            selectors: [
              { selector: selectAllTasksWithReminder, value: [] },
              {
                selector: selectAllTasksWithDeadlineReminder,
                value: [futureDeadlineTask('d1')],
              },
              { selector: selectUndoneTasksWithDueDayNoReminder, value: [] },
            ],
          }),
          {
            provide: SnackService,
            useValue: jasmine.createSpyObj('SnackService', ['open']),
          },
          { provide: CapacitorReminderService, useValue: reminderServiceSpy },
          { provide: CapacitorPlatformService, useValue: platformService },
          { provide: GlobalConfigService, useValue: { cfg$: cfg$.asObservable() } },
        ],
      });

      store = TestBed.inject(MockStore);
    });

    const subscribeDeadlineNotifications = (): void => {
      effects = TestBed.inject(MobileNotificationEffects);
      (
        effects.scheduleDeadlineNotifications$ as unknown as Observable<unknown>
      ).subscribe();
    };

    it('schedules explicit deadline reminders', fakeAsync(() => {
      subscribeDeadlineNotifications();

      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({
          notificationId: generateNotificationId('d1_deadline'),
          reminderId: 'd1_deadline',
          relatedId: 'd1',
          title: 'task d1',
          reminderType: 'DEADLINE',
        }),
      );
    }));

    it('cancels previously scheduled deadline reminders when disabled', fakeAsync(() => {
      subscribeDeadlineNotifications();

      tick(EFFECT_DELAY_MS + 1);
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);

      cfg$.next(buildCfg({ disableReminders: true }));
      tick(1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledOnceWith(
        generateNotificationId('d1_deadline'),
      );
    }));

    it('cancels deadline reminders removed from the selector result', fakeAsync(() => {
      subscribeDeadlineNotifications();

      tick(EFFECT_DELAY_MS + 1);
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);

      store.overrideSelector(selectAllTasksWithDeadlineReminder, []);
      store.refreshState();
      tick(1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledOnceWith(
        generateNotificationId('d1_deadline'),
      );
    }));

    it('cancels a tracked deadline reminder when its new timestamp is in the past', fakeAsync(() => {
      subscribeDeadlineNotifications();

      tick(EFFECT_DELAY_MS + 1);
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);

      store.overrideSelector(selectAllTasksWithDeadlineReminder, [
        pastDeadlineTask('d1'),
      ]);
      store.refreshState();
      tick(1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledOnceWith(
        generateNotificationId('d1_deadline'),
      );
    }));
  });
});

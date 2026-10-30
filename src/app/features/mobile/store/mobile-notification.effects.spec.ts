import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { EffectsModule } from '@ngrx/effects';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, NEVER, Observable, Subscription } from 'rxjs';
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
import { Task, TaskReminderOptionId, TaskWithReminder } from '../../tasks/task.model';
import { selectActiveTaskRepeatCfgs } from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getRepeatableTaskId } from '../../task-repeat-cfg/get-repeatable-task-id.util';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { LS } from '../../../core/persistence/storage-keys.const';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { DateService } from '../../../core/date/date.service';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { filter } from 'rxjs/operators';

// Matches the internal DELAY_SCHEDULE in the effects file.
const EFFECT_DELAY_MS = 5000;
// Mirrors REPEAT_RESCHEDULE_DEBOUNCE in the effects file (recurring scheduler only).
const REPEAT_DEBOUNCE_MS = 1000;
const REPEAT_SETTLE_MS = EFFECT_DELAY_MS + REPEAT_DEBOUNCE_MS;

// Minimal shape the effect reads off GlobalConfigService.cfg$.
type TestCfg = {
  reminder: Partial<ReminderConfig>;
  sync?: { isEnabled: boolean; syncProvider: SyncProviderId | null };
};

describe('MobileNotificationEffects', () => {
  let effects: MobileNotificationEffects;
  let platformService: jasmine.SpyObj<CapacitorPlatformService>;
  let isDataLoaded$: BehaviorSubject<boolean>;

  const TRACKED_ID_KEYS = [
    LS.MOBILE_ARMED_REMINDER_IDS,
    LS.MOBILE_ARMED_REPEAT_REMINDER_IDS,
    LS.MOBILE_ARMED_DUE_DATE_IDS,
    LS.MOBILE_ARMED_DEADLINE_IDS,
  ];

  // A second instance stands in for the next app run: same device storage,
  // fresh in-memory state, alarms from the previous run still armed natively.
  const startNextAppRun = (): MobileNotificationEffects =>
    TestBed.runInInjectionContext(() => new MobileNotificationEffects());

  beforeEach(() => {
    TRACKED_ID_KEYS.forEach((k) => localStorage.removeItem(k));
    isDataLoaded$ = new BehaviorSubject<boolean>(true);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: isDataLoaded$.pipe(filter(Boolean)) },
        },
      ],
    });
  });

  afterEach(() => {
    TRACKED_ID_KEYS.forEach((k) => localStorage.removeItem(k));
  });

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
              'openExactAlarmSettings',
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

  describe('on native platform — askPermissionsIfNotGiven$ (startup, #8120)', () => {
    let reminderServiceSpy: jasmine.SpyObj<CapacitorReminderService>;
    let snackServiceSpy: jasmine.SpyObj<SnackService>;

    // Mirrors DELAY_PERMISSIONS in the effects file.
    const DELAY_PERMISSIONS_MS = 2000;

    const setup = (platform: 'ios' | 'android' = 'ios'): void => {
      reminderServiceSpy = jasmine.createSpyObj('CapacitorReminderService', [
        'getPermissionState',
        'openExactAlarmSettings',
        'ensurePermissions',
        'scheduleReminder',
        'cancelReminder',
      ]);
      reminderServiceSpy.scheduleReminder.and.resolveTo();
      reminderServiceSpy.cancelReminder.and.resolveTo();

      snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);

      platformService = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['isIOS', 'isAndroid'],
        { platform, isNative: true },
      );
      platformService.isAndroid.and.returnValue(platform === 'android');

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
          { provide: SnackService, useValue: snackServiceSpy },
          { provide: CapacitorReminderService, useValue: reminderServiceSpy },
          { provide: CapacitorPlatformService, useValue: platformService },
          { provide: GlobalConfigService, useValue: { cfg$: NEVER } },
        ],
      });
      effects = TestBed.inject(MobileNotificationEffects);
    };

    const runStartup = (): void => {
      (effects.askPermissionsIfNotGiven$ as unknown as Observable<unknown>).subscribe();
      tick(DELAY_PERMISSIONS_MS + 1);
    };

    it('stays silent and does NOT prompt when permission was never requested (prompt)', fakeAsync(() => {
      setup('ios');
      reminderServiceSpy.getPermissionState.and.resolveTo('prompt');
      runStartup();

      expect(reminderServiceSpy.getPermissionState).toHaveBeenCalled();
      // The OS prompt must be deferred to the first real schedule.
      expect(reminderServiceSpy.ensurePermissions).not.toHaveBeenCalled();
      expect(reminderServiceSpy.openExactAlarmSettings).not.toHaveBeenCalled();
      expect(snackServiceSpy.open).not.toHaveBeenCalled();
    }));

    it('does not prompt for the prompt-with-rationale state either', fakeAsync(() => {
      setup('android');
      reminderServiceSpy.getPermissionState.and.resolveTo('prompt-with-rationale');
      runStartup();

      expect(reminderServiceSpy.ensurePermissions).not.toHaveBeenCalled();
      expect(snackServiceSpy.open).not.toHaveBeenCalled();
    }));

    it('warns once when permission is explicitly denied', fakeAsync(() => {
      setup('ios');
      reminderServiceSpy.getPermissionState.and.resolveTo('denied');
      runStartup();

      expect(snackServiceSpy.open).toHaveBeenCalledTimes(1);
      expect(reminderServiceSpy.openExactAlarmSettings).not.toHaveBeenCalled();
    }));

    it('never checks exact alarms at startup, even when notifications are granted', fakeAsync(() => {
      // openExactAlarmSettings() opens Android's "Alarms & reminders" settings
      // page. Sending the user there unasked is pure noise (#9648, #10684).
      setup('android');
      reminderServiceSpy.getPermissionState.and.resolveTo('granted');
      runStartup();

      expect(reminderServiceSpy.openExactAlarmSettings).not.toHaveBeenCalled();
      expect(snackServiceSpy.open).not.toHaveBeenCalled();
    }));
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
        'openExactAlarmSettings',
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
      platformService.isAndroid.and.returnValue(true);

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

    const subscribeScheduleNotifications = (): Subscription => {
      effects = TestBed.inject(MobileNotificationEffects);
      return (
        effects.scheduleNotifications$ as unknown as Observable<unknown>
      ).subscribe();
    };

    it('schedules reminders normally when disableReminders is false', fakeAsync(() => {
      store.overrideSelector(selectAllTasksWithReminder, [futureReminder('a')]);
      subscribeScheduleNotifications();

      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);
      expect(reminderServiceSpy.cancelReminder).not.toHaveBeenCalled();
    }));

    it('never opens the exact alarm settings page while scheduling (#10684)', fakeAsync(() => {
      // A denied "Alarms & reminders" permission is surfaced inline where
      // reminders are set (<exact-alarm-hint>), never by redirecting the user.
      store.overrideSelector(selectAllTasksWithReminder, [futureReminder('a')]);
      subscribeScheduleNotifications();

      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);
      expect(reminderServiceSpy.openExactAlarmSettings).not.toHaveBeenCalled();
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

    it('cancels an alarm a previous app run armed for a task completed or deleted (e.g. by sync) before this run', fakeAsync(() => {
      store.overrideSelector(selectAllTasksWithReminder, [futureReminder('a')]);
      const firstRun = subscribeScheduleNotifications();
      tick(EFFECT_DELAY_MS + 1);
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);
      // The app is killed; the change arrives before the next run.
      firstRun.unsubscribe();

      store.overrideSelector(selectAllTasksWithReminder, []);
      store.refreshState();
      const nextRun = startNextAppRun();
      reminderServiceSpy.cancelReminder.calls.reset();
      (nextRun.scheduleNotifications$ as unknown as Observable<unknown>).subscribe();
      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledWith(
        generateNotificationId('a'),
      );
    }));

    it('does not cancel alarms from a previous app run before the initial data load', fakeAsync(() => {
      store.overrideSelector(selectAllTasksWithReminder, [futureReminder('a')]);
      const firstRun = subscribeScheduleNotifications();
      tick(EFFECT_DELAY_MS + 1);
      // The app is killed; the change arrives before the next run.
      firstRun.unsubscribe();

      // Pre-hydration the store holds no tasks yet.
      store.overrideSelector(selectAllTasksWithReminder, []);
      store.refreshState();
      isDataLoaded$.next(false);
      reminderServiceSpy.cancelReminder.calls.reset();
      reminderServiceSpy.scheduleReminder.calls.reset();
      const nextRun = startNextAppRun();
      (nextRun.scheduleNotifications$ as unknown as Observable<unknown>).subscribe();
      tick(EFFECT_DELAY_MS + 1);
      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalled();

      store.overrideSelector(selectAllTasksWithReminder, [futureReminder('a')]);
      store.refreshState();
      isDataLoaded$.next(true);
      tick(1);

      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalled();
      expect(reminderServiceSpy.cancelReminder).not.toHaveBeenCalled();
    }));
  });

  describe('on native platform — due-date gating', () => {
    let reminderServiceSpy: jasmine.SpyObj<CapacitorReminderService>;
    let cfg$: BehaviorSubject<TestCfg>;

    const futureDueTask = (id: string): { id: string; title: string; dueDay: string } => {
      // Local date: the effect fires at the local hour, so a UTC date can land
      // in the past in far-east timezones.
      const dueDay = getDbDateStr(Date.now() + 86_400_000);
      return { id, title: `task ${id}`, dueDay };
    };

    beforeEach(() => {
      reminderServiceSpy = jasmine.createSpyObj('CapacitorReminderService', [
        'ensurePermissions',
        'openExactAlarmSettings',
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
      platformService.isAndroid.and.returnValue(true);

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

    it('does not schedule due-date notifications when notifyOnDueDate was never set (opt-in)', fakeAsync(() => {
      cfg$.next({ reminder: { disableReminders: false } });

      effects = TestBed.inject(MobileNotificationEffects);
      (
        effects.scheduleDueDateNotifications$ as unknown as Observable<unknown>
      ).subscribe();

      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalled();
    }));

    it('cancels due-date alarms a previous app run left armed when disabled at startup', fakeAsync(() => {
      cfg$.next({ reminder: { disableReminders: false, notifyOnDueDate: false } });

      effects = TestBed.inject(MobileNotificationEffects);
      (
        effects.scheduleDueDateNotifications$ as unknown as Observable<unknown>
      ).subscribe();

      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledWith(
        generateNotificationId('x_dueday'),
      );
    }));

    it('cancels a due-date alarm a previous app run armed for a task completed before this run', fakeAsync(() => {
      const store = TestBed.inject(MockStore);
      effects = TestBed.inject(MobileNotificationEffects);
      const firstRun = (
        effects.scheduleDueDateNotifications$ as unknown as Observable<unknown>
      ).subscribe();
      tick(EFFECT_DELAY_MS + 1);
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);
      // The app is killed; the change arrives before the next run.
      firstRun.unsubscribe();

      store.overrideSelector(selectUndoneTasksWithDueDayNoReminder, []);
      store.refreshState();
      reminderServiceSpy.cancelReminder.calls.reset();
      const nextRun = startNextAppRun();
      (
        nextRun.scheduleDueDateNotifications$ as unknown as Observable<unknown>
      ).subscribe();
      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledWith(
        generateNotificationId('x_dueday'),
      );
    }));

    describe('trigger time', () => {
      const nineAm = (): number =>
        new Date(futureDueTask('x').dueDay + 'T09:00:00').getTime();

      beforeEach(() => {
        localStorage.setItem(LS.DUE_DATE_NOTIFICATION_OFFSET_MS, '123000');
        cfg$.next({
          ...cfg$.value,
          sync: { isEnabled: true, syncProvider: SyncProviderId.SuperSync },
        });
      });
      afterEach(() => localStorage.removeItem(LS.DUE_DATE_NOTIFICATION_OFFSET_MS));

      const scheduledTriggerAtMs = (): number => {
        effects = TestBed.inject(MobileNotificationEffects);
        (
          effects.scheduleDueDateNotifications$ as unknown as Observable<unknown>
        ).subscribe();
        tick(EFFECT_DELAY_MS + 1);
        return reminderServiceSpy.scheduleReminder.calls.mostRecent().args[0].triggerAtMs;
      };

      // Every Android device fired its stale-check GET at exactly 09:00:00,
      // exhausting the SuperSync connection pool (2026-09).
      it('spreads Android due-date notifications by the per-install offset', fakeAsync(() => {
        expect(scheduledTriggerAtMs()).toBe(nineAm() + 123000);
      }));

      it('keeps due-date notifications on the hour off Android', fakeAsync(() => {
        platformService.isAndroid.and.returnValue(false);

        expect(scheduledTriggerAtMs()).toBe(nineAm());
      }));

      // Without SuperSync credentials the alarm makes no stale-check call, so
      // the offset would delay the notification for nothing.
      it('keeps due-date notifications on the hour without SuperSync', fakeAsync(() => {
        cfg$.next({
          ...cfg$.value,
          sync: { isEnabled: true, syncProvider: SyncProviderId.WebDAV },
        });

        expect(scheduledTriggerAtMs()).toBe(nineAm());
      }));

      it('keeps due-date notifications on the hour when sync is disabled', fakeAsync(() => {
        cfg$.next({
          ...cfg$.value,
          sync: { isEnabled: false, syncProvider: SyncProviderId.SuperSync },
        });

        expect(scheduledTriggerAtMs()).toBe(nineAm());
      }));
    });
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
        'openExactAlarmSettings',
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

    const subscribeDeadlineNotifications = (): Subscription => {
      effects = TestBed.inject(MobileNotificationEffects);
      return (
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

    it('schedules deadline reminders on Android too', fakeAsync(() => {
      // Without a native alarm, Android deadline reminders only fired while the
      // app was running — useless for the day/week lead-time options.
      platformService.isIOS.and.returnValue(false);
      platformService.isAndroid.and.returnValue(true);
      const win = window as { SUPAndroid?: unknown };
      const prevAndroid = win.SUPAndroid;
      win.SUPAndroid = { supportsTypedReminderActions: () => true };
      subscribeDeadlineNotifications();

      tick(EFFECT_DELAY_MS + 1);
      win.SUPAndroid = prevAndroid;

      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({
          notificationId: generateNotificationId('d1_deadline'),
          relatedId: 'd1',
          reminderType: 'DEADLINE',
        }),
      );
    }));

    it('skips Android deadline alarms when the APK lacks typed reminder actions', fakeAsync(() => {
      platformService.isIOS.and.returnValue(false);
      platformService.isAndroid.and.returnValue(true);
      subscribeDeadlineNotifications();

      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalled();
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

    it('cancels a deadline alarm a previous app run armed for a task completed before this run', fakeAsync(() => {
      const firstRun = subscribeDeadlineNotifications();
      tick(EFFECT_DELAY_MS + 1);
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);
      // The app is killed; the change arrives before the next run.
      firstRun.unsubscribe();

      store.overrideSelector(selectAllTasksWithDeadlineReminder, []);
      store.refreshState();
      reminderServiceSpy.cancelReminder.calls.reset();
      const nextRun = startNextAppRun();
      (
        nextRun.scheduleDeadlineNotifications$ as unknown as Observable<unknown>
      ).subscribe();
      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledWith(
        generateNotificationId('d1_deadline'),
      );
    }));

    it('does not cancel a deadline reminder that already fired', fakeAsync(() => {
      // On Android cancel also removes the shown notification, so a later store
      // emission must not dismiss it once its alarm time has simply passed.
      const firedTask = futureDeadlineTask('d1');
      store.overrideSelector(selectAllTasksWithDeadlineReminder, [firedTask]);
      subscribeDeadlineNotifications();
      tick(EFFECT_DELAY_MS + 1);
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);

      tick(600_001);
      store.overrideSelector(selectAllTasksWithDeadlineReminder, [{ ...firedTask }]);
      store.refreshState();
      tick(1);

      expect(reminderServiceSpy.cancelReminder).not.toHaveBeenCalled();
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

  // #7850: pre-schedule native alarms for the next occurrence of timed recurring
  // configs, so they fire even if the app is never opened on the target day.
  describe('on native platform — recurring reminders (#7850)', () => {
    let reminderServiceSpy: jasmine.SpyObj<CapacitorReminderService>;
    let cfg$: BehaviorSubject<TestCfg>;
    let store: MockStore;

    const buildCfg = (overrides: Partial<ReminderConfig> = {}): TestCfg => ({
      reminder: { disableReminders: false, ...overrides },
    });

    // A day anchored at noon, `offset` days from now — matches the effect's own
    // per-day anchoring so derived date strings / trigger times line up exactly.
    const dayAt = (offset: number): Date => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + offset);
      return d;
    };
    const dayStr = (offset: number): string => getDbDateStr(dayAt(offset).getTime());
    const triggerFor = (offset: number, clock: string): number =>
      getDateTimeFromClockString(clock, dayAt(offset).getTime());

    const mkDailyCfg = (over: Partial<TaskRepeatCfg> = {}): TaskRepeatCfg => ({
      ...DEFAULT_TASK_REPEAT_CFG,
      id: 'cfgDaily',
      title: 'Daily Standup',
      repeatCycle: 'DAILY',
      repeatEvery: 1,
      startDate: '2020-01-01',
      // today already created → the next occurrence is tomorrow
      lastTaskCreationDay: dayStr(0),
      startTime: '09:00',
      remindAt: TaskReminderOptionId.AtStart,
      ...over,
    });

    beforeEach(() => {
      reminderServiceSpy = jasmine.createSpyObj('CapacitorReminderService', [
        'ensurePermissions',
        'openExactAlarmSettings',
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
      platformService.isAndroid.and.returnValue(true);

      TestBed.configureTestingModule({
        imports: [EffectsModule.forRoot([])],
        providers: [
          MobileNotificationEffects,
          provideMockStore({
            initialState: {},
            selectors: [
              { selector: selectActiveTaskRepeatCfgs, value: [] },
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

    const subscribeRepeatReminders = (): Subscription => {
      effects = TestBed.inject(MobileNotificationEffects);
      return (
        effects.scheduleRepeatReminders$ as unknown as Observable<unknown>
      ).subscribe();
    };

    it('schedules the next occurrence of a timed daily recurring config with the same id scheduleNotifications$ would use', fakeAsync(() => {
      store.overrideSelector(selectActiveTaskRepeatCfgs, [mkDailyCfg()]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      // Deterministic id == the instance's eventual id → idempotent with
      // scheduleNotifications$ (same notificationId → alarm overwritten, not doubled).
      const expectedTaskId = getRepeatableTaskId('cfgDaily', dayStr(1));
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
        jasmine.objectContaining({
          notificationId: generateNotificationId(expectedTaskId),
          reminderId: expectedTaskId,
          relatedId: expectedTaskId,
          title: 'Daily Standup',
          reminderType: 'TASK',
          triggerAtMs: triggerFor(1, '09:00'),
        }),
      );
    }));

    it('does not schedule configs without a start time or remindAt', fakeAsync(() => {
      store.overrideSelector(selectActiveTaskRepeatCfgs, [
        mkDailyCfg({ id: 'noTime', startTime: undefined }),
        mkDailyCfg({ id: 'noRemind', remindAt: undefined }),
      ]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalled();
    }));

    it('does not pre-schedule waitForCompletion configs', fakeAsync(() => {
      store.overrideSelector(selectActiveTaskRepeatCfgs, [
        mkDailyCfg({ waitForCompletion: true }),
      ]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalled();
    }));

    it('arms every upcoming occurrence in the lookahead in one pass, so later days fire without the app running (#10781)', fakeAsync(() => {
      store.overrideSelector(selectActiveTaskRepeatCfgs, [mkDailyCfg()]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      // The effect runs once; nothing re-arms day 2+ after day 1's alarm fires
      // with the app closed, so all of them must already be armed now.
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(14);
      for (const offset of [1, 2, 3, 14]) {
        expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
          jasmine.objectContaining({
            notificationId: generateNotificationId(
              getRepeatableTaskId('cfgDaily', dayStr(offset)),
            ),
            triggerAtMs: triggerFor(offset, '09:00'),
          }),
        );
      }
    }));

    it('under the cap, gives every config its next occurrence before any config its second', fakeAsync(() => {
      // 20 daily configs (14 occurrences each) + one weekly config whose only
      // in-window hits are 6 and 13 days out. Soonest-first alone would let the
      // daily configs' day-2..6 occurrences crowd the weekly one out.
      const dailyCfgs = Array.from({ length: 20 }, (_, i) => mkDailyCfg({ id: `d${i}` }));
      const weekday = dayAt(6).getDay();
      const weekdayKey = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ][weekday] as keyof TaskRepeatCfg;
      const weeklyCfg = {
        ...mkDailyCfg({ id: 'wk', repeatCycle: 'WEEKLY' }),
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        sunday: false,
        [weekdayKey]: true,
      } as TaskRepeatCfg;
      store.overrideSelector(selectActiveTaskRepeatCfgs, [...dailyCfgs, weeklyCfg]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(32);
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
        jasmine.objectContaining({
          reminderId: getRepeatableTaskId('wk', dayStr(6)),
        }),
      );
      for (let i = 0; i < 20; i++) {
        expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
          jasmine.objectContaining({
            reminderId: getRepeatableTaskId(`d${i}`, dayStr(1)),
          }),
        );
      }
    }));

    it('uses the schedule-day id and trigger the real instance gets with a non-zero start of next day', fakeAsync(() => {
      // 4h offset: a 02:00 start belongs to the previous logical day and lands on
      // the next calendar day (#3378). Creation keys both id and time off the
      // schedule day via getRepeatDueWithTime, so the pre-scheduled alarm must too.
      TestBed.inject(DateService).setStartOfNextDayDiff(4);
      store.overrideSelector(selectActiveTaskRepeatCfgs, [
        mkDailyCfg({ startTime: '02:00' }),
      ]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
        jasmine.objectContaining({
          reminderId: getRepeatableTaskId('cfgDaily', dayStr(1)),
          triggerAtMs: triggerFor(2, '02:00'),
        }),
      );
    }));

    it('schedules a weekly config only on its weekday within the lookahead window', fakeAsync(() => {
      const weekday = dayAt(1).getDay();
      const weekdayKey = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ][weekday] as keyof TaskRepeatCfg;
      store.overrideSelector(selectActiveTaskRepeatCfgs, [
        {
          ...mkDailyCfg({ id: 'wk' }),
          repeatCycle: 'WEEKLY',
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: false,
          saturday: false,
          sunday: false,
          [weekdayKey]: true,
        } as TaskRepeatCfg,
      ]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      // Tomorrow and a week later match the chosen weekday; day 15 is outside.
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(2);
      for (const offset of [1, 8]) {
        expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
          jasmine.objectContaining({
            reminderId: getRepeatableTaskId('wk', dayStr(offset)),
            triggerAtMs: triggerFor(offset, '09:00'),
          }),
        );
      }
    }));

    it('does not pre-schedule a paused config', fakeAsync(() => {
      store.overrideSelector(selectActiveTaskRepeatCfgs, [
        mkDailyCfg({ isPaused: true }),
      ]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalled();
    }));

    it('skips occurrences in deletedInstanceDates and schedules the following one', fakeAsync(() => {
      store.overrideSelector(selectActiveTaskRepeatCfgs, [
        mkDailyCfg({ deletedInstanceDates: [dayStr(1)] }),
      ]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      const expectedTaskId = getRepeatableTaskId('cfgDaily', dayStr(2));
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
        jasmine.objectContaining({
          reminderId: expectedTaskId,
          triggerAtMs: triggerFor(2, '09:00'),
        }),
      );
      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalledWith(
        jasmine.objectContaining({
          reminderId: getRepeatableTaskId('cfgDaily', dayStr(1)),
        }),
      );
    }));

    it('skips occurrences whose trigger time has already passed', fakeAsync(() => {
      // today IS due (lastTaskCreationDay far in the past), but its 00:00 trigger
      // is already behind us → the next future occurrence (tomorrow) is scheduled.
      store.overrideSelector(selectActiveTaskRepeatCfgs, [
        mkDailyCfg({ lastTaskCreationDay: '2020-01-01', startTime: '00:00' }),
      ]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      const expectedTaskId = getRepeatableTaskId('cfgDaily', dayStr(1));
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
        jasmine.objectContaining({
          reminderId: expectedTaskId,
          triggerAtMs: triggerFor(1, '00:00'),
        }),
      );
      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalledWith(
        jasmine.objectContaining({
          reminderId: getRepeatableTaskId('cfgDaily', dayStr(0)),
        }),
      );
    }));

    it('does not schedule when disableReminders is true', fakeAsync(() => {
      cfg$.next(buildCfg({ disableReminders: true }));
      store.overrideSelector(selectActiveTaskRepeatCfgs, [mkDailyCfg()]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalled();
    }));

    it('does NOT cancel an about-to-graduate alarm during the creation dispatch burst', fakeAsync(() => {
      store.overrideSelector(selectActiveTaskRepeatCfgs, [mkDailyCfg()]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);
      const tomorrowId = getRepeatableTaskId('cfgDaily', dayStr(1));
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(14);

      // Mirror the REAL dispatch order of _getActionsForTaskRepeatCfg, all within
      // the debounce window: (1) addTask + updateTaskRepeatCfg advance the config
      // while the new task still has NO remindAt (so it is NOT yet a live reminder),
      // then (2) scheduleTaskWithTime sets remindAt. The transient state in (1) must
      // not cause tomorrow's alarm — about to be owned by scheduleNotifications$ — to
      // be cancelled. The debounce collapses the burst so only the settled state runs.
      store.overrideSelector(selectActiveTaskRepeatCfgs, [
        mkDailyCfg({ lastTaskCreationDay: dayStr(1) }),
      ]);
      store.refreshState();
      tick(REPEAT_DEBOUNCE_MS - 100); // still inside the settle window

      store.overrideSelector(selectAllTasksWithReminder, [
        {
          id: tomorrowId,
          title: 'Daily Standup',
          remindAt: triggerFor(1, '09:00'),
        } as TaskWithReminder,
      ]);
      store.refreshState();
      tick(REPEAT_DEBOUNCE_MS + 1); // settle

      expect(reminderServiceSpy.cancelReminder).not.toHaveBeenCalledWith(
        generateNotificationId(tomorrowId),
      );
    }));

    it('cancels a pre-scheduled alarm when its config is removed', fakeAsync(() => {
      store.overrideSelector(selectActiveTaskRepeatCfgs, [mkDailyCfg()]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);
      const tomorrowId = getRepeatableTaskId('cfgDaily', dayStr(1));
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(14);

      store.overrideSelector(selectActiveTaskRepeatCfgs, []);
      store.refreshState();
      tick(REPEAT_DEBOUNCE_MS + 1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledWith(
        generateNotificationId(tomorrowId),
      );
      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledWith(
        generateNotificationId(getRepeatableTaskId('cfgDaily', dayStr(14))),
      );
    }));

    it('cancels alarms a previous app run pre-scheduled for a config deleted before this run', fakeAsync(() => {
      store.overrideSelector(selectActiveTaskRepeatCfgs, [mkDailyCfg()]);
      const firstRun = subscribeRepeatReminders();
      tick(REPEAT_SETTLE_MS + 1);
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalled();
      // The app is killed; the change arrives before the next run.
      firstRun.unsubscribe();

      store.overrideSelector(selectActiveTaskRepeatCfgs, []);
      store.refreshState();
      reminderServiceSpy.cancelReminder.calls.reset();
      const nextRun = startNextAppRun();
      (nextRun.scheduleRepeatReminders$ as unknown as Observable<unknown>).subscribe();
      tick(REPEAT_SETTLE_MS + 1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledWith(
        generateNotificationId(getRepeatableTaskId('cfgDaily', dayStr(1))),
      );
    }));

    it('does not cancel a pre-scheduled alarm that already fired before its instance exists', fakeAsync(() => {
      // On Android cancel also dismisses the shown notification; instance
      // creation waits for the initial sync, so this pass can run first.
      const soon = new Date(Date.now() + 120_000);
      if (getDbDateStr(soon.getTime()) !== dayStr(0)) {
        pending('needs two minutes left in the day');
      }
      const clock = `${soon.getHours()}:${String(soon.getMinutes()).padStart(2, '0')}`;
      store.overrideSelector(selectActiveTaskRepeatCfgs, [
        mkDailyCfg({ lastTaskCreationDay: dayStr(-1), startTime: clock }),
      ]);
      const firstRun = subscribeRepeatReminders();
      tick(REPEAT_SETTLE_MS + 1);
      const todayId = getRepeatableTaskId('cfgDaily', dayStr(0));
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
        jasmine.objectContaining({ reminderId: todayId }),
      );
      firstRun.unsubscribe();

      tick(180_000);
      const nextRun = startNextAppRun();
      (nextRun.scheduleRepeatReminders$ as unknown as Observable<unknown>).subscribe();
      tick(REPEAT_SETTLE_MS + 1);

      expect(reminderServiceSpy.cancelReminder).not.toHaveBeenCalledWith(
        generateNotificationId(todayId),
      );
    }));

    it('still cancels a fired (possibly snoozed) pre-scheduled alarm once its config is deleted', fakeAsync(() => {
      // A native snooze re-arms the same id, so a deleted config's alarm can
      // still be pending although its tracked trigger time has passed.
      const soon = new Date(Date.now() + 120_000);
      if (getDbDateStr(soon.getTime()) !== dayStr(0)) {
        pending('needs two minutes left in the day');
      }
      const clock = `${soon.getHours()}:${String(soon.getMinutes()).padStart(2, '0')}`;
      store.overrideSelector(selectActiveTaskRepeatCfgs, [
        mkDailyCfg({ lastTaskCreationDay: dayStr(-1), startTime: clock }),
      ]);
      const firstRun = subscribeRepeatReminders();
      tick(REPEAT_SETTLE_MS + 1);
      firstRun.unsubscribe();

      tick(180_000);
      store.overrideSelector(selectActiveTaskRepeatCfgs, []);
      store.refreshState();
      const nextRun = startNextAppRun();
      (nextRun.scheduleRepeatReminders$ as unknown as Observable<unknown>).subscribe();
      tick(REPEAT_SETTLE_MS + 1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledWith(
        generateNotificationId(getRepeatableTaskId('cfgDaily', dayStr(0))),
      );
    }));

    it('caps pre-scheduled reminders, keeping the soonest-firing (iOS 64-pending limit)', fakeAsync(() => {
      // More configs than the cap (REPEAT_MAX_SCHEDULED = 32 in the effect),
      // each due tomorrow at a distinct clock time 30 min apart (00:00 → 19:30).
      const cfgs = Array.from({ length: 40 }, (_, i) => {
        const h = String(Math.floor(i / 2)).padStart(2, '0');
        const m = i % 2 === 0 ? '00' : '30';
        return mkDailyCfg({ id: `cfg${i}`, startTime: `${h}:${m}` });
      });
      store.overrideSelector(selectActiveTaskRepeatCfgs, cfgs);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      // Bounded to the cap, not the full 40.
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(32);
      // Soonest kept, last-within-cap kept, first-over-cap dropped.
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
        jasmine.objectContaining({ triggerAtMs: triggerFor(1, '00:00') }),
      );
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
        jasmine.objectContaining({ triggerAtMs: triggerFor(1, '15:30') }),
      );
      expect(reminderServiceSpy.scheduleReminder).not.toHaveBeenCalledWith(
        jasmine.objectContaining({ triggerAtMs: triggerFor(1, '16:00') }),
      );
    }));
  });
});

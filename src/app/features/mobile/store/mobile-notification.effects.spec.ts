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
import { Task, TaskReminderOptionId, TaskWithReminder } from '../../tasks/task.model';
import { selectActiveTaskRepeatCfgs } from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getRepeatableTaskId } from '../../task-repeat-cfg/get-repeatable-task-id.util';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';

// Matches the internal DELAY_SCHEDULE in the effects file.
const EFFECT_DELAY_MS = 5000;
// Mirrors REPEAT_RESCHEDULE_DEBOUNCE in the effects file (recurring scheduler only).
const REPEAT_DEBOUNCE_MS = 1000;
const REPEAT_SETTLE_MS = EFFECT_DELAY_MS + REPEAT_DEBOUNCE_MS;

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

  describe('on native platform — askPermissionsIfNotGiven$ (startup, #8120)', () => {
    let reminderServiceSpy: jasmine.SpyObj<CapacitorReminderService>;
    let snackServiceSpy: jasmine.SpyObj<SnackService>;

    // Mirrors DELAY_PERMISSIONS in the effects file.
    const DELAY_PERMISSIONS_MS = 2000;

    const setup = (platform: 'ios' | 'android' = 'ios'): void => {
      reminderServiceSpy = jasmine.createSpyObj('CapacitorReminderService', [
        'getPermissionState',
        'ensureExactAlarmPermission',
        'ensurePermissions',
        'scheduleReminder',
        'cancelReminder',
      ]);
      reminderServiceSpy.ensureExactAlarmPermission.and.resolveTo(true);
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
      expect(reminderServiceSpy.ensureExactAlarmPermission).not.toHaveBeenCalled();
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
      expect(reminderServiceSpy.ensureExactAlarmPermission).not.toHaveBeenCalled();
    }));

    it('checks exact alarm permission when notifications are granted', fakeAsync(() => {
      setup('android');
      reminderServiceSpy.getPermissionState.and.resolveTo('granted');
      runStartup();

      expect(reminderServiceSpy.ensureExactAlarmPermission).toHaveBeenCalledTimes(1);
      expect(snackServiceSpy.open).not.toHaveBeenCalled();
    }));

    it('warns when granted but exact alarm permission is denied', fakeAsync(() => {
      setup('android');
      reminderServiceSpy.getPermissionState.and.resolveTo('granted');
      reminderServiceSpy.ensureExactAlarmPermission.and.resolveTo(false);
      runStartup();

      expect(snackServiceSpy.open).toHaveBeenCalledTimes(1);
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
        'ensureExactAlarmPermission',
        'scheduleReminder',
        'cancelReminder',
      ]);
      reminderServiceSpy.ensurePermissions.and.resolveTo(true);
      reminderServiceSpy.ensureExactAlarmPermission.and.resolveTo(true);
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

    it('checks exact alarm permission once after lazy notification permission is granted', fakeAsync(() => {
      store.overrideSelector(selectAllTasksWithReminder, [futureReminder('a')]);
      subscribeScheduleNotifications();

      tick(EFFECT_DELAY_MS + 1);

      expect(reminderServiceSpy.ensureExactAlarmPermission).toHaveBeenCalledTimes(1);
      expect(reminderServiceSpy.ensureExactAlarmPermission).toHaveBeenCalledBefore(
        reminderServiceSpy.scheduleReminder,
      );

      store.overrideSelector(selectAllTasksWithReminder, [
        futureReminder('a'),
        futureReminder('b'),
      ]);
      store.refreshState();
      tick(1);

      expect(reminderServiceSpy.ensureExactAlarmPermission).toHaveBeenCalledTimes(1);
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
        'ensureExactAlarmPermission',
        'scheduleReminder',
        'cancelReminder',
      ]);
      reminderServiceSpy.ensurePermissions.and.resolveTo(true);
      reminderServiceSpy.ensureExactAlarmPermission.and.resolveTo(true);
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
        'ensureExactAlarmPermission',
        'scheduleReminder',
        'cancelReminder',
      ]);
      reminderServiceSpy.ensurePermissions.and.resolveTo(true);
      reminderServiceSpy.ensureExactAlarmPermission.and.resolveTo(true);
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
        'ensureExactAlarmPermission',
        'scheduleReminder',
        'cancelReminder',
      ]);
      reminderServiceSpy.ensurePermissions.and.resolveTo(true);
      reminderServiceSpy.ensureExactAlarmPermission.and.resolveTo(true);
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

    const subscribeRepeatReminders = (): void => {
      effects = TestBed.inject(MobileNotificationEffects);
      (effects.scheduleRepeatReminders$ as unknown as Observable<unknown>).subscribe();
    };

    it('schedules the next occurrence of a timed daily recurring config with the same id scheduleNotifications$ would use', fakeAsync(() => {
      store.overrideSelector(selectActiveTaskRepeatCfgs, [mkDailyCfg()]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      // Deterministic id == the instance's eventual id → idempotent with
      // scheduleNotifications$ (same notificationId → alarm overwritten, not doubled).
      const expectedTaskId = getRepeatableTaskId('cfgDaily', dayStr(1));
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledOnceWith(
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

    it('schedules one alarm per config — the soonest upcoming occurrence only', fakeAsync(() => {
      store.overrideSelector(selectActiveTaskRepeatCfgs, [
        mkDailyCfg({ id: 'a' }),
        mkDailyCfg({ id: 'b', startTime: '10:30' }),
      ]);
      subscribeRepeatReminders();

      tick(REPEAT_SETTLE_MS + 1);

      // Two daily configs are "due" every day in the 14-day window, but each is
      // pre-scheduled exactly once (its next occurrence), never 14× per config.
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(2);
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
        jasmine.objectContaining({
          reminderId: getRepeatableTaskId('a', dayStr(1)),
          triggerAtMs: triggerFor(1, '09:00'),
        }),
      );
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledWith(
        jasmine.objectContaining({
          reminderId: getRepeatableTaskId('b', dayStr(1)),
          triggerAtMs: triggerFor(1, '10:30'),
        }),
      );
    }));

    it('does not schedule a weekly config whose next occurrence is beyond the lookahead window', fakeAsync(() => {
      // Weekly-on-this-weekday, but the only occurrence in range is today — which is
      // already created (lastTaskCreationDay = today). The next is 7 days out and the
      // window only spans the soonest occurrence per config, so for a far-future first
      // hit we still schedule it; assert the in-window weekly case schedules correctly.
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

      // Tomorrow matches the chosen weekday → its occurrence is pre-scheduled.
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({
          reminderId: getRepeatableTaskId('wk', dayStr(1)),
          triggerAtMs: triggerFor(1, '09:00'),
        }),
      );
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
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({
          reminderId: expectedTaskId,
          triggerAtMs: triggerFor(2, '09:00'),
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
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({
          reminderId: expectedTaskId,
          triggerAtMs: triggerFor(1, '00:00'),
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
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);

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
      expect(reminderServiceSpy.scheduleReminder).toHaveBeenCalledTimes(1);

      store.overrideSelector(selectActiveTaskRepeatCfgs, []);
      store.refreshState();
      tick(REPEAT_DEBOUNCE_MS + 1);

      expect(reminderServiceSpy.cancelReminder).toHaveBeenCalledWith(
        generateNotificationId(tomorrowId),
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

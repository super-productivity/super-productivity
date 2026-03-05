import { fakeAsync, flush, TestBed, tick } from '@angular/core/testing';
import { EffectsModule } from '@ngrx/effects';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MobileNotificationEffects } from './mobile-notification.effects';
import { SnackService } from '../../../core/snack/snack.service';
import { CapacitorReminderService } from '../../../core/platform/capacitor-reminder.service';
import { CapacitorPlatformService } from '../../../core/platform/capacitor-platform.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskService } from '../../tasks/task.service';
import {
  selectAllTasksWithReminder,
  selectAllUndoneTasksWithDueDay,
} from '../../tasks/store/task.selectors';
import { signal } from '@angular/core';

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
          { provide: GlobalConfigService, useValue: { cfg: signal(undefined) } },
          {
            provide: TaskService,
            useValue: jasmine.createSpyObj('TaskService', ['setDone', 'focusTask']),
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
  });

  describe('scheduleNotifications$ on native platform', () => {
    let store: MockStore;
    let reminderService: jasmine.SpyObj<CapacitorReminderService>;
    const cfgSignal = signal<any>(undefined);

    beforeEach(() => {
      const nativePlatformService = jasmine.createSpyObj(
        'CapacitorPlatformService',
        ['isIOS', 'isAndroid'],
        {
          platform: 'android',
          isNative: true,
        },
      );

      reminderService = jasmine.createSpyObj('CapacitorReminderService', [
        'ensurePermissions',
        'scheduleReminder',
        'cancelReminder',
      ]);
      reminderService.ensurePermissions.and.returnValue(Promise.resolve(true));
      reminderService.scheduleReminder.and.returnValue(Promise.resolve(true));
      reminderService.cancelReminder.and.returnValue(Promise.resolve(true));

      TestBed.configureTestingModule({
        imports: [EffectsModule.forRoot([])],
        providers: [
          MobileNotificationEffects,
          provideMockStore({ initialState: {} }),
          {
            provide: SnackService,
            useValue: jasmine.createSpyObj('SnackService', ['open']),
          },
          { provide: CapacitorReminderService, useValue: reminderService },
          { provide: CapacitorPlatformService, useValue: nativePlatformService },
          { provide: GlobalConfigService, useValue: { cfg: cfgSignal } },
          {
            provide: TaskService,
            useValue: jasmine.createSpyObj('TaskService', ['setDone', 'focusTask']),
          },
        ],
      });

      store = TestBed.inject(MockStore);
    });

    it('should schedule notification for task due today when notifyOnDueDate is enabled', fakeAsync(() => {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const futureHour = Math.min(now.getHours() + 2, 23);
      const reminderTask = {
        id: 'reminder-task',
        title: 'Reminder task',
        remindAt: Date.now() + 3600000,
      };

      cfgSignal.set({
        reminder: {
          notifyOnDueDate: true,
          dueDateNotificationHour: futureHour,
          isCountdownBannerEnabled: true,
          countdownDuration: 600000,
        },
      });

      store.overrideSelector(selectAllTasksWithReminder, [reminderTask as any]);
      store.overrideSelector(selectAllUndoneTasksWithDueDay, [
        { id: 'task1', title: 'Test task', dueDay: todayStr, isDone: false } as any,
      ]);
      store.refreshState();

      const fx = TestBed.inject(MobileNotificationEffects);
      const obs = fx.scheduleNotifications$ as any;
      obs.subscribe();

      tick(5001);
      flush();

      // scheduleReminder is called for the reminder task + the due-date task
      expect(reminderService.scheduleReminder).toHaveBeenCalledTimes(2);
      const dueDateCall = reminderService.scheduleReminder.calls.mostRecent().args[0];
      expect(dueDateCall.relatedId).toBe('task1');
      expect(dueDateCall.title).toBe('Test task');
    }));

    it('should NOT schedule due-date notification when notifyOnDueDate is disabled', fakeAsync(() => {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const reminderTask = {
        id: 'reminder-task',
        title: 'Reminder task',
        remindAt: Date.now() + 3600000,
      };

      cfgSignal.set({
        reminder: {
          notifyOnDueDate: false,
          isCountdownBannerEnabled: true,
          countdownDuration: 600000,
        },
      });

      store.overrideSelector(selectAllTasksWithReminder, [reminderTask as any]);
      store.overrideSelector(selectAllUndoneTasksWithDueDay, [
        { id: 'task1', title: 'Test task', dueDay: todayStr, isDone: false } as any,
      ]);
      store.refreshState();

      const fx = TestBed.inject(MobileNotificationEffects);
      const obs = fx.scheduleNotifications$ as any;
      obs.subscribe();

      tick(5001);
      flush();

      // Only the explicit reminder task should be scheduled, not the due-date task
      expect(reminderService.scheduleReminder).toHaveBeenCalledTimes(1);
      expect(reminderService.scheduleReminder.calls.first().args[0].relatedId).toBe(
        'reminder-task',
      );
    }));

    it('should NOT schedule due-date notification for task with existing remindAt', fakeAsync(() => {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const futureHour = Math.min(now.getHours() + 2, 23);
      const reminderTask = {
        id: 'reminder-task',
        title: 'Reminder task',
        remindAt: Date.now() + 3600000,
      };

      cfgSignal.set({
        reminder: {
          notifyOnDueDate: true,
          dueDateNotificationHour: futureHour,
          isCountdownBannerEnabled: true,
          countdownDuration: 600000,
        },
      });

      store.overrideSelector(selectAllTasksWithReminder, [reminderTask as any]);
      store.overrideSelector(selectAllUndoneTasksWithDueDay, [
        {
          id: 'task1',
          title: 'Test task',
          dueDay: todayStr,
          remindAt: Date.now() + 60000,
          isDone: false,
        } as any,
      ]);
      store.refreshState();

      const fx = TestBed.inject(MobileNotificationEffects);
      const obs = fx.scheduleNotifications$ as any;
      obs.subscribe();

      tick(5001);
      flush();

      // Only the explicit reminder task should be scheduled, not the due-date task (it has remindAt)
      expect(reminderService.scheduleReminder).toHaveBeenCalledTimes(1);
      expect(reminderService.scheduleReminder.calls.first().args[0].relatedId).toBe(
        'reminder-task',
      );
    }));

    it('should NOT schedule due-date notification for task not due today', fakeAsync(() => {
      const tomorrow = new Date(Date.now() + 86400000);
      const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
      const futureHour = Math.min(new Date().getHours() + 2, 23);
      const reminderTask = {
        id: 'reminder-task',
        title: 'Reminder task',
        remindAt: Date.now() + 3600000,
      };

      cfgSignal.set({
        reminder: {
          notifyOnDueDate: true,
          dueDateNotificationHour: futureHour,
          isCountdownBannerEnabled: true,
          countdownDuration: 600000,
        },
      });

      store.overrideSelector(selectAllTasksWithReminder, [reminderTask as any]);
      store.overrideSelector(selectAllUndoneTasksWithDueDay, [
        {
          id: 'task1',
          title: 'Tomorrow task',
          dueDay: tomorrowStr,
          isDone: false,
        } as any,
      ]);
      store.refreshState();

      const fx = TestBed.inject(MobileNotificationEffects);
      const obs = fx.scheduleNotifications$ as any;
      obs.subscribe();

      tick(5001);
      flush();

      // Only the explicit reminder task should be scheduled, not the tomorrow task
      expect(reminderService.scheduleReminder).toHaveBeenCalledTimes(1);
      expect(reminderService.scheduleReminder.calls.first().args[0].relatedId).toBe(
        'reminder-task',
      );
    }));
  });
});

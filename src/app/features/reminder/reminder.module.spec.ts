import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { NEVER, Observable, of, ReplaySubject, Subject } from 'rxjs';
import { ReminderModule } from './reminder.module';
import { ReminderService } from './reminder.service';
import { SnackService } from '../../core/snack/snack.service';
import { UiHelperService } from '../ui-helper/ui-helper.service';
import { NotifyService } from '../../core/notify/notify.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { TaskService } from '../tasks/task.service';
import { SyncTriggerService } from '../../imex/sync/sync-trigger.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { GlobalConfigService } from '../config/global-config.service';
import { CapacitorReminderService } from '../../core/platform/capacitor-reminder.service';
import {
  NOTIFICATION_ACTION,
  NotificationActionEvent,
} from '../../core/platform/capacitor-notification.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { T } from 'src/app/t.const';
import { Task, TaskWithReminderData } from '../tasks/task.model';
import { DialogViewTaskRemindersComponent } from '../tasks/dialog-view-task-reminders/dialog-view-task-reminders.component';
import { DateService } from '../../core/date/date.service';
import { getRepeatableTaskId } from '../task-repeat-cfg/get-repeatable-task-id.util';

describe('ReminderModule dialog opening', () => {
  let matDialogSpy: jasmine.SpyObj<MatDialog>;
  let remindersActive$: Subject<TaskWithReminderData[]>;
  let syncDone$: Subject<void>;

  const reminder = {
    id: 'task-1',
    title: 'Task 1',
    reminderData: { remindAt: Date.now() - 1000 },
  } as TaskWithReminderData;

  beforeEach(() => {
    remindersActive$ = new Subject<TaskWithReminderData[]>();
    syncDone$ = new Subject<void>();
    matDialogSpy = jasmine.createSpyObj('MatDialog', ['open'], { openDialogs: [] });

    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['currentTaskId']);
    taskServiceSpy.currentTaskId.and.returnValue(null);

    const notifyServiceSpy = jasmine.createSpyObj('NotifyService', ['notify']);
    notifyServiceSpy.notify.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        ReminderModule,
        {
          provide: ReminderService,
          useValue: jasmine.createSpyObj(
            'ReminderService',
            ['init', 'isReminderUiSuppressed', 'suppressReminderUiAfterDismiss'],
            { onRemindersActive$: remindersActive$ },
          ),
        },
        { provide: MatDialog, useValue: matDialogSpy },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: UiHelperService,
          useValue: jasmine.createSpyObj('UiHelperService', ['focusApp']),
        },
        { provide: NotifyService, useValue: notifyServiceSpy },
        {
          provide: LayoutService,
          useValue: jasmine.createSpyObj('LayoutService', ['isShowAddTaskBar']),
        },
        { provide: TaskService, useValue: taskServiceSpy },
        {
          provide: SyncTriggerService,
          useValue: { afterInitialSyncDoneAndDataLoadedInitially$: syncDone$ },
        },
        {
          provide: SyncWrapperService,
          useValue: jasmine.createSpyObj('SyncWrapperService', ['sync']),
        },
        { provide: Store, useValue: jasmine.createSpyObj('Store', ['dispatch']) },
        { provide: GlobalConfigService, useValue: { cfg: () => ({}) } },
        {
          provide: CapacitorReminderService,
          useValue: jasmine.createSpyObj('CapacitorReminderService', ['initialize'], {
            action$: NEVER,
          }),
        },
      ],
    });
  });

  it('opens task reminder dialog as dismissable (no disableClose)', fakeAsync(() => {
    TestBed.inject(ReminderModule);

    syncDone$.next();
    tick(1000);
    remindersActive$.next([reminder]);

    expect(matDialogSpy.open).toHaveBeenCalledOnceWith(DialogViewTaskRemindersComponent, {
      restoreFocus: true,
      data: {
        reminders: [reminder],
      },
    });
  }));
});

describe('ReminderModule iOS notification actions', () => {
  let module: ReminderModule;
  let storeSpy: jasmine.SpyObj<Store>;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let syncWrapperSpy: jasmine.SpyObj<SyncWrapperService>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;

  // Fixed logical today so predicted repeatable ids in the #10077 tests are
  // deterministic.
  const TODAY_STR = '2026-09-20';

  // setDeadline enforces mutual exclusivity, so a real task only carries one
  // of deadlineDay / deadlineWithTime. The fixture mirrors the deadlineWithTime
  // case; the deadlineDay-only variant is asserted in its own test below.
  const task = {
    id: 'task-1',
    title: 'Task 1',
    isDone: false,
    dueWithTime: 123,
    deadlineWithTime: 456,
  } as Task;

  const taskWithDeadlineDay = {
    id: 'task-1',
    title: 'Task 1',
    isDone: false,
    deadlineDay: '2026-05-04',
  } as Task;

  const handleIOSNotificationAction = (event: NotificationActionEvent): Promise<void> =>
    (
      module as unknown as {
        _handleIOSNotificationAction: (event: NotificationActionEvent) => Promise<void>;
      }
    )._handleIOSNotificationAction(event);

  beforeEach(() => {
    const action$ = new Subject<NotificationActionEvent>();

    storeSpy = jasmine.createSpyObj('Store', ['dispatch']);
    taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'currentTaskId',
      'focusTask',
      'getByIdOnce$',
      'getByIdLive$',
      'setDone',
    ]);
    taskServiceSpy.currentTaskId.and.returnValue(null);
    taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

    syncWrapperSpy = jasmine.createSpyObj('SyncWrapperService', ['sync']);
    syncWrapperSpy.sync.and.resolveTo();

    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);

    TestBed.configureTestingModule({
      providers: [
        ReminderModule,
        {
          provide: ReminderService,
          useValue: jasmine.createSpyObj(
            'ReminderService',
            ['init', 'isReminderUiSuppressed', 'suppressReminderUiAfterDismiss'],
            { onRemindersActive$: NEVER },
          ),
        },
        {
          provide: MatDialog,
          useValue: jasmine.createSpyObj('MatDialog', ['open'], { openDialogs: [] }),
        },
        {
          provide: SnackService,
          useValue: snackServiceSpy,
        },
        {
          provide: UiHelperService,
          useValue: jasmine.createSpyObj('UiHelperService', ['focusApp']),
        },
        {
          provide: NotifyService,
          useValue: jasmine.createSpyObj('NotifyService', ['notify']),
        },
        {
          provide: LayoutService,
          useValue: jasmine.createSpyObj('LayoutService', ['isShowAddTaskBar']),
        },
        { provide: TaskService, useValue: taskServiceSpy },
        {
          provide: SyncTriggerService,
          useValue: { afterInitialSyncDoneAndDataLoadedInitially$: NEVER },
        },
        { provide: SyncWrapperService, useValue: syncWrapperSpy },
        { provide: Store, useValue: storeSpy },
        { provide: GlobalConfigService, useValue: { cfg: () => ({}) } },
        { provide: DateService, useValue: { todayStr: () => TODAY_STR } },
        {
          provide: CapacitorReminderService,
          useValue: jasmine.createSpyObj('CapacitorReminderService', ['initialize'], {
            action$,
          }),
        },
      ],
    });

    module = TestBed.inject(ReminderModule);
  });

  type SetDeadlinePayload = {
    type: string;
    taskId: string;
    deadlineDay?: string;
    deadlineWithTime?: number;
    deadlineRemindAt: number;
  };

  it('snoozes iOS deadline notification actions via setDeadline (with-time)', async () => {
    spyOn(Date, 'now').and.returnValue(1_000);

    await handleIOSNotificationAction({
      actionId: NOTIFICATION_ACTION.SNOOZE_10M,
      notificationId: 1,
      extra: { relatedId: 'task-1', reminderType: 'DEADLINE' },
    });

    expect(storeSpy.dispatch).toHaveBeenCalledTimes(1);
    const dispatched = storeSpy.dispatch.calls.mostRecent()
      .args[0] as unknown as SetDeadlinePayload;
    expect(dispatched.type).toBe(TaskSharedActions.setDeadline.type);
    expect(dispatched.taskId).toBe('task-1');
    expect(dispatched.deadlineWithTime).toBe(456);
    expect(dispatched.deadlineRemindAt).toBe(601_000);
    // Mutual exclusivity in the reducer — never forward deadlineDay alongside.
    expect(dispatched.deadlineDay).toBeUndefined();
  });

  it('snoozes iOS deadline notification actions via setDeadline (day-only)', async () => {
    spyOn(Date, 'now').and.returnValue(1_000);
    taskServiceSpy.getByIdOnce$.and.returnValue(of(taskWithDeadlineDay));

    await handleIOSNotificationAction({
      actionId: NOTIFICATION_ACTION.SNOOZE_10M,
      notificationId: 1,
      extra: { relatedId: 'task-1', reminderType: 'DEADLINE' },
    });

    expect(storeSpy.dispatch).toHaveBeenCalledTimes(1);
    const dispatched = storeSpy.dispatch.calls.mostRecent()
      .args[0] as unknown as SetDeadlinePayload;
    expect(dispatched.type).toBe(TaskSharedActions.setDeadline.type);
    expect(dispatched.taskId).toBe('task-1');
    expect(dispatched.deadlineDay).toBe('2026-05-04');
    expect(dispatched.deadlineRemindAt).toBe(601_000);
    expect(dispatched.deadlineWithTime).toBeUndefined();
  });

  it('keeps regular iOS task snooze behavior unchanged', async () => {
    spyOn(Date, 'now').and.returnValue(1_000);

    await handleIOSNotificationAction({
      actionId: NOTIFICATION_ACTION.SNOOZE_1H,
      notificationId: 1,
      extra: { relatedId: 'task-1', reminderType: 'TASK' },
    });

    expect(storeSpy.dispatch).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        type: TaskSharedActions.reScheduleTaskWithTime.type,
        task,
        remindAt: 3_601_000,
        dueWithTime: 123,
        isMoveToBacklog: false,
      }),
    );
  });

  it('clears deadline reminder when tapping an iOS deadline notification', async () => {
    await handleIOSNotificationAction({
      actionId: 'tap',
      notificationId: 1,
      extra: { relatedId: 'task-1', reminderType: 'DEADLINE' },
    });

    expect(storeSpy.dispatch).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        type: TaskSharedActions.clearDeadlineReminder.type,
        taskId: 'task-1',
      }),
    );
    expect(taskServiceSpy.focusTask).toHaveBeenCalledOnceWith('task-1');
  });

  it('does not dismiss regular reminders when tapping an iOS due-date notification', async () => {
    await handleIOSNotificationAction({
      actionId: 'tap',
      notificationId: 1,
      extra: { relatedId: 'task-1', reminderType: 'DUE_DATE' },
    });

    expect(storeSpy.dispatch).not.toHaveBeenCalled();
    expect(taskServiceSpy.focusTask).toHaveBeenCalledOnceWith('task-1');
  });

  // The Done action routes through the shared _handleDoneAction, which is the
  // handler the #8551 hydration gate protects: once the store is loaded the task
  // resolves and gets marked done. A missing task is only "already completed"
  // when it cannot still be created — regular ids never materialize, while
  // today's predicted repeatable instance id is waited for (see #10077 tests).
  it('marks the task done for a Done notification action', async () => {
    await handleIOSNotificationAction({
      actionId: NOTIFICATION_ACTION.DONE,
      notificationId: 1,
      extra: { relatedId: 'task-1', reminderType: 'TASK' },
    });

    expect(taskServiceSpy.setDone).toHaveBeenCalledOnceWith('task-1');
    expect(snackServiceSpy.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ msg: T.NOTIFICATION.TASK_MARKED_DONE }),
    );
  });

  it('does not setDone for a missing regular task and reports already-completed (#8551 guard)', async () => {
    taskServiceSpy.getByIdOnce$.and.returnValue(of(undefined as unknown as Task));

    await handleIOSNotificationAction({
      actionId: NOTIFICATION_ACTION.DONE,
      notificationId: 1,
      extra: { relatedId: 'task-1', reminderType: 'TASK' },
    });

    expect(taskServiceSpy.setDone).not.toHaveBeenCalled();
    expect(taskServiceSpy.getByIdLive$).not.toHaveBeenCalled();
    expect(snackServiceSpy.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ msg: T.NOTIFICATION.TASK_ALREADY_COMPLETED }),
    );
  });

  // #10077: reminders for repeatable tasks are pre-scheduled natively for a
  // predicted instance id before the task entity exists — the instance is only
  // created lazily after the strict initial-sync gate plus a 1s debounce. A
  // Done tap that beats creation must wait for the instance instead of being
  // dropped as "already completed".
  it('marks the pending repeatable instance done once it appears (#10077)', async () => {
    const predictedId = getRepeatableTaskId('cfg-1', TODAY_STR);
    taskServiceSpy.getByIdOnce$.and.returnValue(of(undefined as unknown as Task));
    const live$ = new Subject<Task>();
    taskServiceSpy.getByIdLive$.and.returnValue(live$);

    const donePromise = handleIOSNotificationAction({
      actionId: NOTIFICATION_ACTION.DONE,
      notificationId: 1,
      extra: { relatedId: predictedId, reminderType: 'TASK' },
    });
    await new Promise((resolve) => setTimeout(resolve));

    expect(taskServiceSpy.getByIdLive$).toHaveBeenCalledOnceWith(predictedId);
    expect(taskServiceSpy.setDone).not.toHaveBeenCalled();

    // The lazy instance creation lands in the store (TaskDueEffects) moments later.
    live$.next({ id: predictedId, isDone: false } as Task);
    await donePromise;

    expect(taskServiceSpy.setDone).toHaveBeenCalledOnceWith(predictedId);
    expect(snackServiceSpy.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ msg: T.NOTIFICATION.TASK_MARKED_DONE }),
    );
  });

  it('does not wait for a predicted instance id from a previous day (#10077)', async () => {
    const staleId = getRepeatableTaskId('cfg-1', '2026-09-19');
    taskServiceSpy.getByIdOnce$.and.returnValue(of(undefined as unknown as Task));

    await handleIOSNotificationAction({
      actionId: NOTIFICATION_ACTION.DONE,
      notificationId: 1,
      extra: { relatedId: staleId, reminderType: 'TASK' },
    });

    // Lazy creation only materializes the newest occurrence, so a past-day
    // instance will never appear — no bounded wait for it.
    expect(taskServiceSpy.getByIdLive$).not.toHaveBeenCalled();
    expect(taskServiceSpy.setDone).not.toHaveBeenCalled();
    expect(snackServiceSpy.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ msg: T.NOTIFICATION.TASK_ALREADY_COMPLETED }),
    );
  });

  it('gives up after the bounded wait when the repeatable instance is never created (#10077)', fakeAsync(() => {
    // 15s ceiling mirrors REPEATABLE_DONE_MAX_WAIT_MS in reminder.module.ts.
    const REPEATABLE_DONE_MAX_WAIT_MS = 15_000;
    const predictedId = getRepeatableTaskId('cfg-1', TODAY_STR);
    taskServiceSpy.getByIdOnce$.and.returnValue(of(undefined as unknown as Task));
    taskServiceSpy.getByIdLive$.and.returnValue(NEVER);

    let settled = false;
    void handleIOSNotificationAction({
      actionId: NOTIFICATION_ACTION.DONE,
      notificationId: 1,
      extra: { relatedId: predictedId, reminderType: 'TASK' },
    }).then(() => (settled = true));

    // Setup microtasks (sync + one-shot read) drain, the wait is armed.
    tick(0);
    expect(taskServiceSpy.setDone).not.toHaveBeenCalled();

    tick(REPEATABLE_DONE_MAX_WAIT_MS + 1);

    expect(settled).toBe(true);
    expect(taskServiceSpy.setDone).not.toHaveBeenCalled();
    expect(snackServiceSpy.open).toHaveBeenCalledWith(
      jasmine.objectContaining({ msg: T.NOTIFICATION.TASK_ALREADY_COMPLETED }),
    );
  }));
});

describe('ReminderModule _handleAfterDataLoaded gate (#8551)', () => {
  let module: ReminderModule;
  // ReplaySubject(1) mirrors the production gate's shareReplay(1): once it has
  // emitted, a later subscriber (i.e. a warm-resume event) gets the value
  // synchronously. A plain Subject would make post-gate events hang.
  let gate$: ReplaySubject<boolean>;

  const callHandleAfterDataLoaded = <V>(
    stream$: Observable<V>,
    handler: (val: V) => void,
  ): void =>
    (
      module as unknown as {
        _handleAfterDataLoaded: (s$: Observable<V>, h: (v: V) => void) => void;
      }
    )._handleAfterDataLoaded(stream$, handler);

  beforeEach(() => {
    gate$ = new ReplaySubject<boolean>(1);

    TestBed.configureTestingModule({
      providers: [
        ReminderModule,
        {
          provide: ReminderService,
          useValue: jasmine.createSpyObj('ReminderService', ['init'], {
            onRemindersActive$: NEVER,
          }),
        },
        {
          provide: MatDialog,
          useValue: jasmine.createSpyObj('MatDialog', ['open'], { openDialogs: [] }),
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: UiHelperService,
          useValue: jasmine.createSpyObj('UiHelperService', ['focusApp']),
        },
        {
          provide: NotifyService,
          useValue: jasmine.createSpyObj('NotifyService', ['notify']),
        },
        {
          provide: LayoutService,
          useValue: jasmine.createSpyObj('LayoutService', ['isShowAddTaskBar']),
        },
        {
          provide: TaskService,
          useValue: jasmine.createSpyObj('TaskService', ['getByIdOnce$']),
        },
        {
          provide: SyncTriggerService,
          useValue: { afterInitialSyncDoneAndDataLoadedInitially$: gate$ },
        },
        {
          provide: SyncWrapperService,
          useValue: jasmine.createSpyObj('SyncWrapperService', ['sync']),
        },
        { provide: Store, useValue: jasmine.createSpyObj('Store', ['dispatch']) },
        { provide: GlobalConfigService, useValue: { cfg: () => ({}) } },
        {
          provide: CapacitorReminderService,
          useValue: jasmine.createSpyObj('CapacitorReminderService', ['initialize'], {
            action$: NEVER,
          }),
        },
      ],
    });

    module = TestBed.inject(ReminderModule);
  });

  it('defers an event that arrives before data is loaded (cold-start race)', () => {
    const source$ = new Subject<string>();
    const handler = jasmine.createSpy('handler');

    callHandleAfterDataLoaded(source$, handler);

    // Mirrors a queued notification action replayed at cold start, before the
    // NgRx store is hydrated.
    source$.next('task-1');
    expect(handler).not.toHaveBeenCalled();

    // Data finished loading -> the buffered event is now released.
    gate$.next(true);
    expect(handler).toHaveBeenCalledOnceWith('task-1');
  });

  it('handles events immediately once data is already loaded (warm resume)', () => {
    const source$ = new Subject<string>();
    const handler = jasmine.createSpy('handler');

    callHandleAfterDataLoaded(source$, handler);
    gate$.next(true);

    source$.next('task-1');
    expect(handler).toHaveBeenCalledOnceWith('task-1');
  });

  it('preserves order for multiple events queued before data is loaded', () => {
    const source$ = new Subject<string>();
    const received: string[] = [];

    callHandleAfterDataLoaded(source$, (v: string) => received.push(v));

    source$.next('a');
    source$.next('b');
    source$.next('c');
    expect(received).toEqual([]);

    gate$.next(true);
    expect(received).toEqual(['a', 'b', 'c']);
  });
});

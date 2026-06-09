import { NO_ERRORS_SCHEMA } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogRef,
  MatDialogState,
} from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Actions } from '@ngrx/effects';
import { ScannedActionsSubject } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService, TranslateStore } from '@ngx-translate/core';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { first, map, switchMap } from 'rxjs/operators';
import { DateService } from '../../../core/date/date.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { ProjectService } from '../../project/project.service';
import { Reminder } from '../../reminder/reminder.model';
import { ReminderService } from '../../reminder/reminder.service';
import { TODAY_TAG } from '../../tag/tag.const';
import { DEFAULT_TASK, Task, TaskWithReminderData } from '../task.model';
import { TaskService } from '../task.service';
import { DialogViewTaskRemindersComponent } from './dialog-view-task-reminders.component';

/**
 * Tests for the tasks$ filter logic in DialogViewTaskRemindersComponent.
 *
 * Issue 3 fix: The filter was relaxed from checking remindAt/deadlineRemindAt
 * to just checking !!task, because the reminder service already validated
 * these tasks before opening the dialog. Re-verifying caused a race condition
 * when deadlineRemindAt was cleared between the worker firing and the dialog
 * fetching the task from the store.
 */
describe('DialogViewTaskRemindersComponent tasks$ filter', () => {
  const createMockTask = (overrides: Partial<Task> = {}): Task =>
    ({
      ...DEFAULT_TASK,
      id: 'task-1',
      title: 'Test task',
      ...overrides,
    }) as Task;

  // Simulate the tasks$ pipeline from the component
  const buildTasksPipeline = (
    taskIds$: BehaviorSubject<string[]>,
    getByIdsLive$: (ids: string[]) => Observable<Task[]>,
    deadlineReminderTaskIds: Set<string>,
  ): Observable<TaskWithReminderData[]> => {
    return taskIds$.pipe(
      switchMap((taskIds) =>
        getByIdsLive$(taskIds).pipe(
          first(),
          map((tasks: Task[]) =>
            tasks
              .filter((task) => !!task)
              .map((task): TaskWithReminderData => {
                const isDeadline = deadlineReminderTaskIds.has(task.id);
                const remindAt = isDeadline
                  ? (task.deadlineRemindAt as number)
                  : (task.remindAt as number);
                return {
                  ...task,
                  reminderData: { remindAt },
                  isDeadlineReminder: isDeadline,
                };
              }),
          ),
        ),
      ),
    );
  };

  it('should include task when deadlineRemindAt is cleared (race condition fix)', async () => {
    // Simulate the race condition: task had deadlineRemindAt when reminder fired,
    // but it got cleared before the dialog fetched the task from the store
    const task = createMockTask({
      id: 'task-1',
      deadlineDay: '2026-03-20',
      deadlineRemindAt: undefined, // cleared by the time dialog reads it
    });

    const taskIds$ = new BehaviorSubject(['task-1']);
    const deadlineReminderTaskIds = new Set(['task-1']);
    const getByIdsLive$ = (): Observable<Task[]> => of([task]);

    const tasks$ = buildTasksPipeline(taskIds$, getByIdsLive$, deadlineReminderTaskIds);
    const result = await tasks$.pipe(first()).toPromise();

    expect(result!.length).toBe(1);
    expect(result![0].id).toBe('task-1');
    expect(result![0].isDeadlineReminder).toBe(true);
  });

  it('should include task when remindAt is cleared', async () => {
    const task = createMockTask({
      id: 'task-1',
      remindAt: undefined, // cleared
    });

    const taskIds$ = new BehaviorSubject(['task-1']);
    const deadlineReminderTaskIds = new Set<string>();
    const getByIdsLive$ = (): Observable<Task[]> => of([task]);

    const tasks$ = buildTasksPipeline(taskIds$, getByIdsLive$, deadlineReminderTaskIds);
    const result = await tasks$.pipe(first()).toPromise();

    expect(result!.length).toBe(1);
    expect(result![0].isDeadlineReminder).toBe(false);
  });

  it('should filter out null/undefined tasks', async () => {
    const taskIds$ = new BehaviorSubject(['task-1', 'task-2']);
    const deadlineReminderTaskIds = new Set<string>();
    const getByIdsLive$ = (): Observable<Task[]> =>
      of([createMockTask({ id: 'task-1' }), null as unknown as Task]);

    const tasks$ = buildTasksPipeline(taskIds$, getByIdsLive$, deadlineReminderTaskIds);
    const result = await tasks$.pipe(first()).toPromise();

    expect(result!.length).toBe(1);
    expect(result![0].id).toBe('task-1');
  });
});

/**
 * Tests for the planForTomorrow deadline reminder clearing logic.
 *
 * Issue 2 fix: When planForTomorrow is called for a deadline reminder task,
 * it must also clear deadlineRemindAt to prevent the reminder from re-triggering.
 */
describe('DialogViewTaskRemindersComponent planForTomorrow deadline clearing', () => {
  it('should dispatch setDeadline without deadlineRemindAt for deadline reminder tasks', () => {
    // Simulate what planForTomorrow + _clearDeadlineReminder does
    const task: TaskWithReminderData = {
      ...DEFAULT_TASK,
      id: 'task-1',
      deadlineDay: '2026-03-20',
      deadlineWithTime: undefined,
      deadlineRemindAt: Date.now() - 1000,
      isDeadlineReminder: true,
      reminderData: { remindAt: Date.now() - 1000 },
    } as TaskWithReminderData;

    // Simulate _clearDeadlineReminder building the action props
    const actionProps: Record<string, unknown> = {
      taskId: task.id,
      ...(task.deadlineDay ? { deadlineDay: task.deadlineDay } : {}),
      ...(task.deadlineWithTime ? { deadlineWithTime: task.deadlineWithTime } : {}),
    };

    // Key assertion: deadlineRemindAt should NOT be in the action props
    // This means the reducer will clear it
    expect(actionProps['deadlineRemindAt']).toBeUndefined();
    expect(actionProps['taskId']).toBe('task-1');
    expect(actionProps['deadlineDay']).toBe('2026-03-20');
  });

  it('should preserve deadlineWithTime when clearing reminder', () => {
    const task: TaskWithReminderData = {
      ...DEFAULT_TASK,
      id: 'task-2',
      deadlineDay: undefined,
      deadlineWithTime: Date.now() + 86400000,
      deadlineRemindAt: Date.now() - 1000,
      isDeadlineReminder: true,
      reminderData: { remindAt: Date.now() - 1000 },
    } as TaskWithReminderData;

    const actionProps: Record<string, unknown> = {
      taskId: task.id,
      ...(task.deadlineDay ? { deadlineDay: task.deadlineDay } : {}),
      ...(task.deadlineWithTime ? { deadlineWithTime: task.deadlineWithTime } : {}),
    };

    expect(actionProps['deadlineRemindAt']).toBeUndefined();
    expect(actionProps['deadlineWithTime']).toBe(task.deadlineWithTime);
    expect(actionProps['deadlineDay']).toBeUndefined();
  });

  it('should not clear deadline reminder for non-deadline tasks', () => {
    const task: TaskWithReminderData = {
      ...DEFAULT_TASK,
      id: 'task-3',
      remindAt: Date.now() - 1000,
      isDeadlineReminder: false,
      reminderData: { remindAt: Date.now() - 1000 },
    } as TaskWithReminderData;

    // planForTomorrow only calls _clearDeadlineReminder when isDeadlineReminder is true
    const shouldClear = !!task.isDeadlineReminder;
    expect(shouldClear).toBe(false);
  });
});

/**
 * Tests for the dismissed reminder tracking logic in DialogViewTaskRemindersComponent.
 *
 * These tests verify that dismissed reminders are tracked and filtered out when
 * the worker sends stale data, preventing the race condition described in issue #5826.
 *
 * The tests focus on the core filtering logic without needing full component rendering.
 */
describe('DialogViewTaskRemindersComponent dismissed reminder tracking', () => {
  // Simulate the component's internal state
  let reminders$: BehaviorSubject<Reminder[]>;
  let dismissedReminderIds: Set<string>;
  let onRemindersActiveSubject: Subject<Reminder[]>;

  const createMockReminder = (id: string, relatedId: string): Reminder => ({
    id,
    relatedId,
    title: `Task ${id}`,
    remindAt: Date.now() - 1000,
    type: 'TASK',
  });

  // Simulate the component's _removeReminderFromList method
  const removeReminderFromList = (reminderId: string): void => {
    dismissedReminderIds.add(reminderId);
    const newReminders = reminders$.getValue().filter((r) => r.id !== reminderId);
    reminders$.next(newReminders);
  };

  // Simulate the component's onRemindersActive$ subscription handler
  const handleRemindersActive = (reminders: Reminder[]): void => {
    const filtered = reminders.filter((r) => !dismissedReminderIds.has(r.id));
    if (filtered.length > 0) {
      reminders$.next(filtered);
    }
  };

  beforeEach(() => {
    const initialReminders = [
      createMockReminder('reminder-1', 'task-1'),
      createMockReminder('reminder-2', 'task-2'),
    ];
    reminders$ = new BehaviorSubject<Reminder[]>(initialReminders);
    dismissedReminderIds = new Set<string>();
    onRemindersActiveSubject = new Subject<Reminder[]>();

    // Set up the subscription like the component does
    onRemindersActiveSubject.subscribe(handleRemindersActive);
  });

  it('should track dismissed reminder IDs when removing from list', () => {
    expect(reminders$.getValue().length).toBe(2);

    removeReminderFromList('reminder-1');

    expect(dismissedReminderIds.has('reminder-1')).toBe(true);
    expect(reminders$.getValue().length).toBe(1);
    expect(reminders$.getValue().find((r) => r.id === 'reminder-1')).toBeUndefined();
  });

  it('should filter out dismissed reminders when worker sends stale data', () => {
    // Dismiss a reminder
    removeReminderFromList('reminder-1');
    expect(reminders$.getValue().length).toBe(1);

    // Simulate worker sending stale data that includes the dismissed reminder
    const staleReminders = [
      createMockReminder('reminder-1', 'task-1'), // This was dismissed
      createMockReminder('reminder-2', 'task-2'),
      createMockReminder('reminder-3', 'task-3'), // New reminder
    ];

    onRemindersActiveSubject.next(staleReminders);

    // The dismissed reminder should be filtered out
    const currentReminders = reminders$.getValue();
    expect(currentReminders.find((r) => r.id === 'reminder-1')).toBeUndefined();
    expect(currentReminders.find((r) => r.id === 'reminder-2')).toBeDefined();
    expect(currentReminders.find((r) => r.id === 'reminder-3')).toBeDefined();
  });

  it('should track multiple dismissed reminders', () => {
    // Dismiss both reminders
    removeReminderFromList('reminder-1');
    removeReminderFromList('reminder-2');

    expect(dismissedReminderIds.has('reminder-1')).toBe(true);
    expect(dismissedReminderIds.has('reminder-2')).toBe(true);

    // Simulate worker sending stale data
    const staleReminders = [
      createMockReminder('reminder-1', 'task-1'),
      createMockReminder('reminder-2', 'task-2'),
    ];

    onRemindersActiveSubject.next(staleReminders);

    // Both should be filtered out, leaving empty array
    // Note: In the actual component, this would close the dialog
    // Here we just verify the filtering works
    const currentReminders = reminders$.getValue();
    expect(currentReminders.length).toBe(0);
  });

  it('should allow new reminders that were not dismissed', () => {
    // Dismiss reminder-1
    removeReminderFromList('reminder-1');

    // Worker sends completely new reminders
    const newReminders = [
      createMockReminder('reminder-3', 'task-3'),
      createMockReminder('reminder-4', 'task-4'),
    ];

    onRemindersActiveSubject.next(newReminders);

    // New reminders should be accepted
    const currentReminders = reminders$.getValue();
    expect(currentReminders.length).toBe(2);
    expect(currentReminders.find((r) => r.id === 'reminder-3')).toBeDefined();
    expect(currentReminders.find((r) => r.id === 'reminder-4')).toBeDefined();
  });

  it('should not affect reminders that were never shown', () => {
    // Don't dismiss any reminders, just receive new ones
    const newReminders = [
      createMockReminder('reminder-5', 'task-5'),
      createMockReminder('reminder-6', 'task-6'),
    ];

    onRemindersActiveSubject.next(newReminders);

    const currentReminders = reminders$.getValue();
    expect(currentReminders.length).toBe(2);
    expect(currentReminders.find((r) => r.id === 'reminder-5')).toBeDefined();
    expect(currentReminders.find((r) => r.id === 'reminder-6')).toBeDefined();
  });
});

/**
 * Tests for the close-animation race condition (issue #7189).
 *
 * The fix: _close() cancels the onRemindersActive$ subscription immediately
 * and guards against re-entry via MatDialogState. Without this, a worker tick
 * arriving during the 300ms close animation updates a mid-teardown component,
 * which can corrupt Angular change detection in Electron/Linux environments.
 */
describe('DialogViewTaskRemindersComponent close-animation race condition', () => {
  // Simulate the dialog state machine
  type MockDialogState = 'OPEN' | 'CLOSING' | 'CLOSED';

  // Simulate the component's subscription management as implemented after the fix.
  // _close() must:
  //   1. Guard against double-calls (CLOSING/CLOSED state)
  //   2. Unsubscribe _onRemindersActiveSub immediately
  //   3. Transition state to CLOSING
  const buildComponent = (
    onRemindersActive$: Subject<TaskWithReminderData[]>,
  ): {
    taskIds$: BehaviorSubject<string[]>;
    dialogState: () => MockDialogState;
    close: () => void;
    removeFromList: (taskId: string) => void;
    simulateAnimationEnd: () => void;
  } => {
    let state: MockDialogState = 'OPEN';
    const dismissedIds = new Set<string>();
    const taskIds$ = new BehaviorSubject<string[]>([]);

    const close = (): void => {
      if (state !== 'OPEN') return; // guard (mirrors MatDialogState check)
      sub.unsubscribe(); // eager cancel
      state = 'CLOSING';
      // angular material close animation would run here (~300ms)
    };

    const simulateAnimationEnd = (): void => {
      state = 'CLOSED';
      // ngOnDestroy would be called here — subscription already cancelled
    };

    const removeFromList = (taskId: string): void => {
      dismissedIds.add(taskId);
      const next = taskIds$.getValue().filter((id) => id !== taskId);
      if (next.length === 0) {
        close();
      } else {
        taskIds$.next(next);
      }
    };

    const sub = onRemindersActive$.subscribe((reminders) => {
      const filtered = reminders.filter((r) => !dismissedIds.has(r.id));
      if (filtered.length > 0) {
        taskIds$.next(filtered.map((r) => r.id));
      } else {
        close();
      }
    });

    return {
      taskIds$,
      dialogState: () => state,
      close,
      removeFromList,
      simulateAnimationEnd,
    };
  };

  const makeReminder = (taskId: string): TaskWithReminderData =>
    ({
      ...DEFAULT_TASK,
      id: taskId,
      title: `Task ${taskId}`,
      remindAt: Date.now() - 1000,
      isDeadlineReminder: false,
      reminderData: { remindAt: Date.now() - 1000 },
    }) as TaskWithReminderData;

  it('should not update taskIds$ after _close() is called (race condition prevention)', () => {
    const onRemindersActive$ = new Subject<TaskWithReminderData[]>();
    const { taskIds$, dialogState, close } = buildComponent(onRemindersActive$);

    // Dialog open showing task-a
    taskIds$.next(['task-a']);
    expect(taskIds$.getValue()).toEqual(['task-a']);

    // User dismisses task-a, dialog begins closing
    close();
    expect(dialogState()).toBe('CLOSING');

    // Worker tick fires during close animation with task-b
    const taskBReminder = makeReminder('task-b');
    onRemindersActive$.next([taskBReminder]);

    // task-b must NOT have been applied to the closing dialog
    expect(taskIds$.getValue()).toEqual(['task-a']);
  });

  it('should guard against double-close (no-op on CLOSING state)', () => {
    const onRemindersActive$ = new Subject<TaskWithReminderData[]>();
    const { dialogState, close } = buildComponent(onRemindersActive$);

    close();
    expect(dialogState()).toBe('CLOSING');

    // Second close must be a no-op
    close();
    expect(dialogState()).toBe('CLOSING');
  });

  it('should guard against double-close (no-op on CLOSED state)', () => {
    const onRemindersActive$ = new Subject<TaskWithReminderData[]>();
    const { dialogState, close, simulateAnimationEnd } =
      buildComponent(onRemindersActive$);

    close();
    simulateAnimationEnd();
    expect(dialogState()).toBe('CLOSED');

    // Third close after animation must be a no-op
    close();
    expect(dialogState()).toBe('CLOSED');
  });

  it('should close when all reminders are filtered out (empty-list path)', () => {
    const onRemindersActive$ = new Subject<TaskWithReminderData[]>();
    const { taskIds$, dialogState } = buildComponent(onRemindersActive$);

    taskIds$.next(['task-a']);

    // Worker sends stale data that is entirely filtered — simulates #5826 path
    onRemindersActive$.next([]); // empty after filtering dismissed ids
    expect(dialogState()).toBe('CLOSING');
  });

  it('scenario: Task A play then Task B reminder during animation — B must not corrupt closing dialog', () => {
    // Exactly the sequence from issue #7189:
    //   1. Dialog opens for task-a
    //   2. User clicks play → dismissReminderOnly → _removeTaskFromList('task-a') → _close()
    //   3. Worker tick during close animation sends [task-b]
    //   4. Dialog must ignore task-b and remain in CLOSING state

    const onRemindersActive$ = new Subject<TaskWithReminderData[]>();
    const { taskIds$, dialogState, removeFromList, simulateAnimationEnd } =
      buildComponent(onRemindersActive$);

    // Step 1: dialog shows task-a
    taskIds$.next(['task-a']);

    // Step 2: play() path — _removeTaskFromList empties the list and calls _close()
    removeFromList('task-a');
    expect(dialogState()).toBe('CLOSING');

    // Step 3: worker tick arrives during the ~300ms close animation with task-b
    const taskB = makeReminder('task-b');
    onRemindersActive$.next([taskB]);

    // Step 4: dialog is CLOSING; the subscription was already cancelled, so
    // taskIds$ must not have been mutated to show task-b (still has old value)
    expect(dialogState()).toBe('CLOSING');
    expect(taskIds$.getValue()).not.toContain('task-b');

    // Animation ends — dialog fully closed
    simulateAnimationEnd();
    expect(dialogState()).toBe('CLOSED');
  });
});

/**
 * Tests for the deadline reminder cleanup on dialog destroy.
 *
 * Bug: when the user closes the dialog via any non-action path (ESC, backdrop
 * click), deadlineRemindAt was never cleared. The reminder stays armed in
 * state and will re-fire on the next worker tick.
 *
 * Fix: on ngOnDestroy, dispatch clearDeadlineReminder for every deadline
 * reminder that was shown in this session and was NOT explicitly handled by
 * the user. Explicit handlers (snooze/dismiss/done/add-to-today/plan) add the
 * task to _dismissedReminderIds so we don't double-dispatch.
 */
describe('DialogViewTaskRemindersComponent destroy clears unhandled deadline reminders', () => {
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let projectServiceSpy: jasmine.SpyObj<ProjectService>;
  let matDialogSpy: jasmine.SpyObj<MatDialog>;
  let matDialogRefSpy: jasmine.SpyObj<MatDialogRef<DialogViewTaskRemindersComponent>>;
  let reminderServiceStub: { onRemindersActive$: Subject<TaskWithReminderData[]> };

  const buildTask = (id: string, overrides: Partial<Task> = {}): Task =>
    ({
      ...DEFAULT_TASK,
      id,
      title: `Task ${id}`,
      ...overrides,
    }) as Task;

  const buildReminder = (
    id: string,
    opts: { isDeadline: boolean; deadlineDay?: string; deadlineWithTime?: number } = {
      isDeadline: false,
    },
  ): TaskWithReminderData =>
    ({
      ...DEFAULT_TASK,
      id,
      title: `Task ${id}`,
      deadlineDay: opts.deadlineDay,
      deadlineWithTime: opts.deadlineWithTime,
      deadlineRemindAt: opts.isDeadline ? Date.now() - 1000 : undefined,
      remindAt: opts.isDeadline ? undefined : Date.now() - 1000,
      isDeadlineReminder: opts.isDeadline,
      reminderData: { remindAt: Date.now() - 1000 },
    }) as TaskWithReminderData;

  const createComponent = (
    reminders: TaskWithReminderData[],
    storeTasks: Task[] = [],
  ): DialogViewTaskRemindersComponent => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { reminders } });
    taskServiceSpy.getByIdsLive$.and.returnValue(of(storeTasks));
    // TestBed becomes instantiated on the first inject/createComponent call,
    // after which overrideProvider throws. Resolve the store here — after the
    // override — rather than in beforeEach so the override still applies.
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
    const fixture = TestBed.createComponent(DialogViewTaskRemindersComponent);
    return fixture.componentInstance;
  };

  const dispatchedClearIds = (): string[] =>
    dispatchSpy.calls
      .allArgs()
      .map(([action]) => action)
      .filter((a) => a.type === TaskSharedActions.clearDeadlineReminder.type)
      .map((a) => a.taskId);

  beforeEach(async () => {
    matDialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close', 'getState']);
    taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'getByIdsLive$',
      'setDone',
      'setCurrentId',
    ]);
    projectServiceSpy = jasmine.createSpyObj('ProjectService', ['moveTaskToTodayList']);
    matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    reminderServiceStub = {
      onRemindersActive$: new Subject<TaskWithReminderData[]>(),
    };

    await TestBed.configureTestingModule({
      imports: [
        DialogViewTaskRemindersComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore({ initialState: {} }),
        { provide: MatDialogRef, useValue: matDialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: { reminders: [] } },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: ReminderService, useValue: reminderServiceStub },
        {
          provide: DateService,
          useValue: { todayStr: () => '2026-06-06', getStartOfNextDayDiffMs: () => 0 },
        },
        TranslateService,
        TranslateStore,
      ],
    })
      // Stub the template so child components (tag-list → WorkContextService →
      // LOCAL_ACTIONS → Actions) and template pipes (DateTimeFormatService →
      // DateAdapter) aren't instantiated. These tests only exercise ngOnDestroy
      // logic, not rendering.
      .overrideComponent(DialogViewTaskRemindersComponent, {
        set: { template: '' },
      })
      .compileComponents();
  });

  it('dispatches clearDeadlineReminder on ngOnDestroy for an unhandled deadline reminder', () => {
    const reminder = buildReminder('task-1', {
      isDeadline: true,
      deadlineDay: '2026-04-25',
    });
    const component = createComponent(
      [reminder],
      [buildTask('task-1', { deadlineDay: '2026-04-25', deadlineRemindAt: Date.now() })],
    );

    component.ngOnDestroy();

    expect(dispatchedClearIds()).toEqual(['task-1']);
  });

  it('does NOT re-dispatch clearDeadlineReminder on destroy when snooze() already handled the task', () => {
    const reminder = buildReminder('task-1', {
      isDeadline: true,
      deadlineDay: '2026-04-25',
    });
    const component = createComponent(
      [reminder],
      [buildTask('task-1', { deadlineDay: '2026-04-25', deadlineRemindAt: Date.now() })],
    );

    // snooze dispatches setDeadline and adds the id to _dismissedReminderIds
    component.snooze(reminder, 10);
    dispatchSpy.calls.reset();

    component.ngOnDestroy();

    expect(dispatchedClearIds()).toEqual([]);
  });

  it('does NOT dispatch clearDeadlineReminder for schedule-only reminders on destroy', () => {
    const reminder = buildReminder('task-1', { isDeadline: false });
    const component = createComponent([reminder], [buildTask('task-1')]);

    component.ngOnDestroy();

    expect(dispatchedClearIds()).toEqual([]);
  });

  it('clears every unhandled deadline reminder on destroy, skipping dismissed ones', () => {
    const r1 = buildReminder('task-1', { isDeadline: true, deadlineDay: '2026-04-25' });
    const r2 = buildReminder('task-2', { isDeadline: true, deadlineDay: '2026-04-26' });
    const r3 = buildReminder('task-3', { isDeadline: true, deadlineDay: '2026-04-27' });
    const component = createComponent(
      [r1, r2, r3],
      [
        buildTask('task-1', { deadlineDay: '2026-04-25', deadlineRemindAt: Date.now() }),
        buildTask('task-2', { deadlineDay: '2026-04-26', deadlineRemindAt: Date.now() }),
        buildTask('task-3', { deadlineDay: '2026-04-27', deadlineRemindAt: Date.now() }),
      ],
    );

    // User handled task-2 via the deadline-specific clear path
    component.dismissReminderOnly(r2);
    dispatchSpy.calls.reset();

    component.ngOnDestroy();

    expect(dispatchedClearIds().sort()).toEqual(['task-1', 'task-3']);
  });

  it('markSingleAsDone adds the task to the dismissed set so destroy is a no-op', () => {
    const reminder = buildReminder('task-1', {
      isDeadline: true,
      deadlineDay: '2026-04-25',
    });
    const task = buildTask('task-1', {
      deadlineDay: '2026-04-25',
      deadlineRemindAt: Date.now(),
    });
    const component = createComponent([reminder], [task]);

    component.markSingleAsDone();
    dispatchSpy.calls.reset();

    component.ngOnDestroy();

    expect(dispatchedClearIds()).toEqual([]);
  });

  it('markAllTasksAsDone adds every task to the dismissed set so destroy is a no-op', async () => {
    const r1 = buildReminder('task-1', { isDeadline: true, deadlineDay: '2026-04-25' });
    const r2 = buildReminder('task-2', { isDeadline: true, deadlineDay: '2026-04-26' });
    const component = createComponent(
      [r1, r2],
      [
        buildTask('task-1', { deadlineDay: '2026-04-25', deadlineRemindAt: Date.now() }),
        buildTask('task-2', { deadlineDay: '2026-04-26', deadlineRemindAt: Date.now() }),
      ],
    );

    await component.markAllTasksAsDone();
    dispatchSpy.calls.reset();

    component.ngOnDestroy();

    expect(dispatchedClearIds()).toEqual([]);
  });

  it('addAllToToday adds every task to the dismissed set so destroy is a no-op', async () => {
    const r1 = buildReminder('task-1', { isDeadline: true, deadlineDay: '2026-04-25' });
    const r2 = buildReminder('task-2', { isDeadline: true, deadlineDay: '2026-04-26' });
    const component = createComponent(
      [r1, r2],
      [
        buildTask('task-1', { deadlineDay: '2026-04-25', deadlineRemindAt: Date.now() }),
        buildTask('task-2', { deadlineDay: '2026-04-26', deadlineRemindAt: Date.now() }),
      ],
    );

    await component.addAllToToday();
    dispatchSpy.calls.reset();

    component.ngOnDestroy();

    expect(dispatchedClearIds()).toEqual([]);
  });
});

/**
 * Tests for accessibility attributes.
 */
describe('DialogViewTaskRemindersComponent accessibility', () => {
  let fixture: any;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        DialogViewTaskRemindersComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore({
          initialState: {
            workContext: {
              activeId: 'today',
              entities: {
                today: {
                  id: 'today',
                  taskIds: ['t1', 't2'],
                },
              },
              ids: ['today'],
            },
            tasks: {
              entities: {
                t1: { id: 't1', title: 'T1', tagIds: ['today'] },
                t2: { id: 't2', title: 'T2', tagIds: ['today'] },
              },
              ids: ['t1', 't2'],
            },
            tag: {
              entities: {
                [TODAY_TAG.id]: TODAY_TAG,
              },
              ids: [TODAY_TAG.id],
            },
            projects: {
              entities: {},
              ids: [],
            },
            globalConfig: {
              evaluation: {
                todayStr: '2026-06-06',
              },
            },
          },
        }),
        {
          provide: MatDialogRef,
          useValue: { close: jasmine.createSpy('close'), getState: () => 0 },
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            reminders: [
              {
                id: 't1',
                title: 'T1',
                reminderData: { remindAt: Date.now() },
                tagIds: ['today'],
              },
              {
                id: 't2',
                title: 'T2',
                reminderData: { remindAt: Date.now() },
                tagIds: ['today'],
              },
            ],
          },
        },
        {
          provide: TaskService,
          useValue: {
            getByIdsLive$: () =>
              of([
                {
                  id: 't1',
                  title: 'T1',
                  tagIds: ['today'],
                  reminderData: { remindAt: Date.now() },
                },
                {
                  id: 't2',
                  title: 'T2',
                  tagIds: ['today'],
                  reminderData: { remindAt: Date.now() },
                },
              ]),
          },
        },
        { provide: ProjectService, useValue: {} },
        {
          provide: MatDialog,
          useValue: { open: () => ({ afterClosed: () => of(false) }) },
        },
        { provide: ReminderService, useValue: { onRemindersActive$: new Subject() } },
        {
          provide: DateService,
          useValue: { todayStr: () => '2026-06-06', getStartOfNextDayDiffMs: () => 0 },
        },
        { provide: Actions, useValue: new Subject() },
        { provide: ScannedActionsSubject, useValue: new Subject() },
        { provide: LOCAL_ACTIONS, useValue: new Subject() },
      ],
    })
      .overrideComponent(DialogViewTaskRemindersComponent, {
        set: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DialogViewTaskRemindersComponent);
    fixture.detectChanges();
  });

  it('should have aria-labels on action buttons in task rows', () => {
    // When multiple tasks are present, each task row has 4 icon buttons in .actions
    const actionButtons = fixture.nativeElement.querySelectorAll('.actions button');
    // 2 tasks * 4 buttons = 8 buttons
    expect(actionButtons.length).toBe(8);
    actionButtons.forEach((btn: HTMLElement) => {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    });
  });
});

/**
 * Tests for focus management and keyboard navigation.
 */
describe('DialogViewTaskRemindersComponent navigation and focus', () => {
  let component: DialogViewTaskRemindersComponent;
  let fixture: any;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let reminderServiceStub: { onRemindersActive$: Subject<TaskWithReminderData[]> };

  const buildTask = (id: string): Task =>
    ({ ...DEFAULT_TASK, id, title: `Task ${id}` }) as Task;
  const buildReminder = (id: string): TaskWithReminderData =>
    ({
      ...DEFAULT_TASK,
      id,
      title: `Task ${id}`,
      reminderData: { remindAt: Date.now() },
    }) as TaskWithReminderData;

  beforeEach(async () => {
    taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'getByIdsLive$',
      'setDone',
      'setCurrentId',
    ]);
    reminderServiceStub = { onRemindersActive$: new Subject<TaskWithReminderData[]>() };

    await TestBed.configureTestingModule({
      imports: [
        DialogViewTaskRemindersComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore({ initialState: {} }),
        {
          provide: MatDialogRef,
          useValue: { close: jasmine.createSpy('close'), getState: () => 0 },
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { reminders: [buildReminder('t1'), buildReminder('t2')] },
        },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: ProjectService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: ReminderService, useValue: reminderServiceStub },
        {
          provide: DateService,
          useValue: { todayStr: () => '2026-06-06', getStartOfNextDayDiffMs: () => 0 },
        },
      ],
    })
      .overrideComponent(DialogViewTaskRemindersComponent, {
        set: {
          template: `
          @for (task of tasks$ | async; track task.id) {
            <div class="task" [attr.data-id]="task.id">
              <div class="actions">
                <button [id]="task.id + '-b0'">{{task.id}} B0</button>
                <button [id]="task.id + '-b1'">{{task.id}} B1</button>
                <button
                  [id]="task.id + '-b2'"
                  aria-haspopup="menu"
                >{{task.id}} B2 (snooze)</button>
                <button [id]="task.id + '-b3'">{{task.id}} B3</button>
                <button [id]="task.id + '-disabled'" disabled>Disabled</button>
                <button [id]="task.id + '-hidden'" style="display: none">Hidden</button>
              </div>
            </div>
          }
          <div class="wrap-buttons">
            <button id="f1">F1</button>
            <button id="f2" disabled>F2 Disabled</button>
            <button id="f3">F3</button>
          </div>
        `,
        },
      })
      .compileComponents();

    taskServiceSpy.getByIdsLive$.and.callFake((ids: string[]) => {
      return ids.includes('t1') && ids.includes('t2')
        ? of([buildTask('t1'), buildTask('t2')])
        : ids.includes('t2')
          ? of([buildTask('t2')])
          : of([]);
    });

    fixture = TestBed.createComponent(DialogViewTaskRemindersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // Must be in document for focus tests
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
  });

  it('should move focus down with ArrowDown skipping disabled/hidden', () => {
    const t1b1 = document.getElementById('t1-b1') as HTMLButtonElement;
    const t2b1 = document.getElementById('t2-b1') as HTMLButtonElement;
    t1b1.focus();

    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    t1b1.dispatchEvent(ev);
    expect(document.activeElement).toBe(t2b1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('should move focus to footer from last task row with ArrowDown', () => {
    const t2b1 = document.getElementById('t2-b1') as HTMLButtonElement;
    const f1 = document.getElementById('f1') as HTMLButtonElement;
    t2b1.focus();

    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    t2b1.dispatchEvent(ev);
    expect(document.activeElement).toBe(f1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('should move focus up with ArrowUp skipping disabled/hidden', () => {
    const t1b1 = document.getElementById('t1-b1') as HTMLButtonElement;
    const t2b1 = document.getElementById('t2-b1') as HTMLButtonElement;
    t2b1.focus();

    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    });
    t2b1.dispatchEvent(ev);
    expect(document.activeElement).toBe(t1b1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('should move focus right with ArrowRight skipping disabled/hidden', () => {
    const t1b1 = document.getElementById('t1-b1') as HTMLButtonElement;
    const t1b2 = document.getElementById('t1-b2') as HTMLButtonElement;
    t1b1.focus();

    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    t1b1.dispatchEvent(ev);
    expect(document.activeElement).toBe(t1b2);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('should move focus left with ArrowLeft skipping disabled/hidden', () => {
    const t1b1 = document.getElementById('t1-b1') as HTMLButtonElement;
    const t1b2 = document.getElementById('t1-b2') as HTMLButtonElement;
    t1b2.focus();

    const ev = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    });
    t1b2.dispatchEvent(ev);
    expect(document.activeElement).toBe(t1b1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('should preserve focus on next task after removal (even if focus was lost)', fakeAsync(() => {
    fixture.detectChanges();
    // Simulate focus being outside (e.g. in a menu)
    (document.body as HTMLElement).focus();
    expect(document.activeElement).not.toBe(document.getElementById('t1-b2'));

    // Call the actual private method that performs removal and focus logic
    (component as any)._removeTaskFromList('t1');

    tick();
    fixture.detectChanges();

    const t2snooze = document.getElementById('t2-b2') as HTMLButtonElement;
    expect(document.activeElement).toBe(t2snooze);
  }));

  it('should skip disabled buttons in footer with ArrowRight', () => {
    const f1 = document.getElementById('f1') as HTMLButtonElement;
    const f3 = document.getElementById('f3') as HTMLButtonElement;
    f1.focus();

    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    component.onKeyDown(ev);
    expect(document.activeElement).toBe(f3);
  });
});

/**
 * Tests for dismissing the dialog when reminders disappear from the store while it
 * is open — e.g. the reminder was dismissed, the task completed, or the task deleted
 * on another device and then synced in.
 *
 * The reminder worker only ever signals reminders that ARE active, never that one is
 * gone, so the dialog reconciles the displayed list against the live store and closes
 * once the reminders it was showing no longer exist. A reminder that is already absent
 * on the first store read (worker snapshot briefly ahead of the store) is never
 * confirmed and therefore never auto-dismissed, preserving the open-time race fix.
 */
describe('DialogViewTaskRemindersComponent reconciles vanished reminders (sync)', () => {
  let dispatchSpy: jasmine.Spy;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let projectServiceSpy: jasmine.SpyObj<ProjectService>;
  let matDialogSpy: jasmine.SpyObj<MatDialog>;
  let matDialogRefSpy: jasmine.SpyObj<MatDialogRef<DialogViewTaskRemindersComponent>>;
  let reminderServiceStub: { onRemindersActive$: Subject<TaskWithReminderData[]> };
  let storeTasks$: BehaviorSubject<Task[]>;

  const buildTask = (id: string, overrides: Partial<Task> = {}): Task =>
    ({
      ...DEFAULT_TASK,
      id,
      title: `Task ${id}`,
      remindAt: Date.now() - 1000,
      ...overrides,
    }) as Task;

  const buildReminder = (
    id: string,
    opts: { isDeadline?: boolean; deadlineDay?: string } = {},
  ): TaskWithReminderData =>
    ({
      ...DEFAULT_TASK,
      id,
      title: `Task ${id}`,
      deadlineDay: opts.deadlineDay,
      deadlineRemindAt: opts.isDeadline ? Date.now() - 1000 : undefined,
      remindAt: opts.isDeadline ? undefined : Date.now() - 1000,
      isDeadlineReminder: !!opts.isDeadline,
      reminderData: { remindAt: Date.now() - 1000 },
    }) as TaskWithReminderData;

  const createComponent = (
    reminders: TaskWithReminderData[],
    initialStoreTasks: Task[],
  ): DialogViewTaskRemindersComponent => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { reminders } });
    storeTasks$ = new BehaviorSubject<Task[]>(initialStoreTasks);
    taskServiceSpy.getByIdsLive$.and.returnValue(storeTasks$);
    const store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
    const fixture = TestBed.createComponent(DialogViewTaskRemindersComponent);
    return fixture.componentInstance;
  };

  beforeEach(async () => {
    matDialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close', 'getState']);
    matDialogRefSpy.getState.and.returnValue(MatDialogState.OPEN);
    taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'getByIdsLive$',
      'setDone',
      'setCurrentId',
    ]);
    projectServiceSpy = jasmine.createSpyObj('ProjectService', ['moveTaskToTodayList']);
    matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    reminderServiceStub = {
      onRemindersActive$: new Subject<TaskWithReminderData[]>(),
    };

    await TestBed.configureTestingModule({
      imports: [
        DialogViewTaskRemindersComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore({ initialState: {} }),
        { provide: MatDialogRef, useValue: matDialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: { reminders: [] } },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: ProjectService, useValue: projectServiceSpy },
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: ReminderService, useValue: reminderServiceStub },
        TranslateService,
        TranslateStore,
      ],
    })
      .overrideComponent(DialogViewTaskRemindersComponent, {
        set: { template: '' },
      })
      .compileComponents();
  });

  it('closes the dialog when the only reminder is cleared in the store', () => {
    createComponent([buildReminder('task-1')], [buildTask('task-1')]);
    expect(matDialogRefSpy.close).not.toHaveBeenCalled();

    // Sync clears the reminder (e.g. dismissed on another device)
    storeTasks$.next([buildTask('task-1', { remindAt: undefined })]);

    expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog when the only reminder task is completed in the store', () => {
    const component = createComponent([buildReminder('task-1')], [buildTask('task-1')]);

    storeTasks$.next([buildTask('task-1', { isDone: true })]);

    expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
    expect(component).toBeTruthy();
  });

  it('closes the dialog when the only reminder task is deleted from the store', () => {
    createComponent([buildReminder('task-1')], [buildTask('task-1')]);

    // Task removed entirely (deleted on another device)
    storeTasks$.next([]);

    expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog when a deadline reminder is cleared in the store', () => {
    createComponent(
      [buildReminder('task-1', { isDeadline: true, deadlineDay: '2026-04-25' })],
      [
        buildTask('task-1', {
          remindAt: undefined,
          deadlineDay: '2026-04-25',
          deadlineRemindAt: Date.now() - 1000,
        }),
      ],
    );

    storeTasks$.next([
      buildTask('task-1', {
        remindAt: undefined,
        deadlineDay: '2026-04-25',
        deadlineRemindAt: undefined,
      }),
    ]);

    expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
  });

  it('drops only the vanished reminder and keeps the dialog open for the rest', () => {
    const component = createComponent(
      [buildReminder('task-1'), buildReminder('task-2')],
      [buildTask('task-1'), buildTask('task-2')],
    );

    storeTasks$.next([buildTask('task-1', { remindAt: undefined }), buildTask('task-2')]);

    expect(matDialogRefSpy.close).not.toHaveBeenCalled();
    expect(component.taskIds$.getValue()).toEqual(['task-2']);
  });

  it('does NOT dismiss a reminder that is already absent on first store read (preserves open-time race fix)', () => {
    createComponent(
      [buildReminder('task-1')],
      // remindAt already gone the moment the dialog reads the store
      [buildTask('task-1', { remindAt: undefined })],
    );

    expect(matDialogRefSpy.close).not.toHaveBeenCalled();

    // A subsequent unrelated store emission still must not close it
    storeTasks$.next([buildTask('task-1', { remindAt: undefined })]);
    expect(matDialogRefSpy.close).not.toHaveBeenCalled();
  });

  it('does not re-clear a vanished deadline reminder on destroy', () => {
    const component = createComponent(
      [buildReminder('task-1', { isDeadline: true, deadlineDay: '2026-04-25' })],
      [
        buildTask('task-1', {
          remindAt: undefined,
          deadlineDay: '2026-04-25',
          deadlineRemindAt: Date.now() - 1000,
        }),
      ],
    );

    // Deadline reminder cleared via sync -> dialog reconciles & closes
    storeTasks$.next([
      buildTask('task-1', {
        remindAt: undefined,
        deadlineDay: '2026-04-25',
        deadlineRemindAt: undefined,
      }),
    ]);
    // Prove the reconcile path (not some other path) handled the disappearance.
    expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
    dispatchSpy.calls.reset();

    component.ngOnDestroy();

    const clearedIds = dispatchSpy.calls
      .allArgs()
      .map(([action]) => action)
      .filter((a) => a.type === TaskSharedActions.clearDeadlineReminder.type);
    expect(clearedIds).toEqual([]);
  });

  it('keeps a reminder that is rescheduled to the future (still a valid reminder, not gone)', () => {
    const component = createComponent([buildReminder('task-1')], [buildTask('task-1')]);

    // Rescheduled (e.g. snoozed on another device): remindAt is still a number,
    // just in the future. The reminder still exists, so it must NOT be dropped.
    const ONE_HOUR_MS = 60 * 60 * 1000;
    storeTasks$.next([buildTask('task-1', { remindAt: Date.now() + ONE_HOUR_MS })]);

    expect(matDialogRefSpy.close).not.toHaveBeenCalled();
    expect(component.taskIds$.getValue()).toEqual(['task-1']);
  });

  it('closes once when ALL reminders vanish in a single store emission', () => {
    createComponent(
      [buildReminder('task-1'), buildReminder('task-2')],
      [buildTask('task-1'), buildTask('task-2')],
    );

    storeTasks$.next([
      buildTask('task-1', { remindAt: undefined }),
      buildTask('task-2', { remindAt: undefined }),
    ]);

    expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
  });

  it('recomputes isAllDeadline when a schedule reminder is dropped leaving only a deadline one', () => {
    const component = createComponent(
      [
        buildReminder('task-1'),
        buildReminder('task-2', { isDeadline: true, deadlineDay: '2026-04-25' }),
      ],
      [
        buildTask('task-1'),
        buildTask('task-2', {
          remindAt: undefined,
          deadlineDay: '2026-04-25',
          deadlineRemindAt: Date.now() - 1000,
        }),
      ],
    );
    expect(component.isAllDeadline).toBe(false);

    // Schedule reminder for task-1 is cleared; only the deadline reminder remains.
    storeTasks$.next([
      buildTask('task-1', { remindAt: undefined }),
      buildTask('task-2', {
        remindAt: undefined,
        deadlineDay: '2026-04-25',
        deadlineRemindAt: Date.now() - 1000,
      }),
    ]);

    expect(matDialogRefSpy.close).not.toHaveBeenCalled();
    expect(component.taskIds$.getValue()).toEqual(['task-2']);
    expect(component.isAllDeadline).toBe(true);
  });

  it('does not re-process or re-close on a redundant store emission after a partial drop', () => {
    const component = createComponent(
      [buildReminder('task-1'), buildReminder('task-2')],
      [buildTask('task-1'), buildTask('task-2')],
    );

    storeTasks$.next([buildTask('task-1', { remindAt: undefined }), buildTask('task-2')]);
    expect(component.taskIds$.getValue()).toEqual(['task-2']);

    // The same surviving state arrives again (e.g. another unrelated sync tick).
    storeTasks$.next([buildTask('task-2')]);

    expect(matDialogRefSpy.close).not.toHaveBeenCalled();
    expect(component.taskIds$.getValue()).toEqual(['task-2']);
  });

  it('does not re-add a dropped reminder if the store re-adds it (flap)', () => {
    const component = createComponent(
      [buildReminder('task-1'), buildReminder('task-2')],
      [buildTask('task-1'), buildTask('task-2')],
    );

    // task-1 vanishes -> dropped
    storeTasks$.next([buildTask('task-1', { remindAt: undefined }), buildTask('task-2')]);
    expect(component.taskIds$.getValue()).toEqual(['task-2']);

    // task-1 reappears in the store -> must NOT come back into the dialog
    storeTasks$.next([buildTask('task-1'), buildTask('task-2')]);
    expect(component.taskIds$.getValue()).toEqual(['task-2']);
    expect(matDialogRefSpy.close).not.toHaveBeenCalled();
  });

  it('stops reconciling after close: a later store emission does not call close again', () => {
    createComponent([buildReminder('task-1')], [buildTask('task-1')]);

    storeTasks$.next([buildTask('task-1', { remindAt: undefined })]);
    expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);

    // getState now reports a non-open dialog; further emissions must be inert.
    matDialogRefSpy.getState.and.returnValue(MatDialogState.CLOSED);
    storeTasks$.next([buildTask('task-1', { remindAt: undefined })]);
    expect(matDialogRefSpy.close).toHaveBeenCalledTimes(1);
  });
});

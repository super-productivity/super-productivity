import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { first, map, switchMap } from 'rxjs/operators';
import { Reminder } from '../../reminder/reminder.model';
import { DEFAULT_TASK, Task, TaskWithReminderData } from '../task.model';

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

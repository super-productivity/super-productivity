import { Action } from '@ngrx/store';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BatchedTimeSyncEntry } from '../../../core/util/batched-time-sync-accumulator';
import { TimeTrackingActions } from '../../../features/time-tracking/store/time-tracking.actions';
import { DEFAULT_TASK, Task, TaskState } from '../../../features/tasks/task.model';
import { TaskTimeSyncService } from '../../../features/tasks/task-time-sync.service';
import {
  initialTaskState,
  taskAdapter,
  taskReducer,
} from '../../../features/tasks/store/task.reducer';
import { updateTimeSpentForTask } from '../../../features/tasks/store/task.reducer.util';
import { AppStateSnapshot } from '../../core/types/backup.types';

type ReplayEvent =
  | { kind: 'delta'; entry: BatchedTimeSyncEntry }
  | { kind: 'replace'; taskId: string; date: string; duration: number }
  | { kind: 'delete'; taskId: string }
  | { kind: 'create'; task: Task };

interface Checkpoint {
  state: TaskState;
  durableEventCount: number;
}

const DATES = ['2026-07-13', '2026-07-14', '2026-07-15'] as const;

const createTask = (id: string, timeSpentOnDay: Record<string, number> = {}): Task =>
  ({
    ...DEFAULT_TASK,
    id,
    title: id,
    created: 1,
    projectId: 'INBOX_PROJECT',
    timeSpentOnDay,
    timeSpent: Object.values(timeSpentOnDay).reduce((total, value) => total + value, 0),
  }) as Task;

const createState = (tasks: Task[]): TaskState => ({
  ...initialTaskState,
  ids: tasks.map((task) => task.id),
  entities: Object.fromEntries(tasks.map((task) => [task.id, task])),
});

const applyReplayEvent = (state: TaskState, event: ReplayEvent): TaskState => {
  switch (event.kind) {
    case 'delta': {
      const action = {
        type: '[TimeTracking] Sync time spent',
        taskId: event.entry.id,
        date: event.entry.date,
        duration: event.entry.duration,
        meta: {
          isPersistent: true,
          isRemote: true,
          entityType: 'TASK',
          entityId: event.entry.id,
          opType: 'UPD',
        },
      };
      return taskReducer(state, action);
    }
    case 'replace':
      return state.entities[event.taskId]
        ? updateTimeSpentForTask(event.taskId, { [event.date]: event.duration }, state)
        : state;
    case 'delete':
      return taskAdapter.removeOne(event.taskId, state);
    case 'create':
      return taskAdapter.addOne(event.task, state);
  }
};

const replayFromCheckpoint = (
  checkpoint: Checkpoint,
  durableEvents: ReplayEvent[],
): TaskState =>
  durableEvents
    .slice(checkpoint.durableEventCount)
    .reduce(applyReplayEvent, checkpoint.state);

const comparableTaskTimes = (
  state: TaskState,
): Record<string, { timeSpent: number; timeSpentOnDay: Record<string, number> }> =>
  Object.fromEntries(
    (state.ids as string[]).map((id) => {
      const task = state.entities[id]!;
      return [
        id,
        {
          timeSpent: task.timeSpent,
          timeSpentOnDay: { ...task.timeSpentOnDay },
        },
      ];
    }),
  );

const createSeededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
};

describe('Task-time replay state machine integration', () => {
  let taskTimeSync: TaskTimeSyncService;
  let store: MockStore;
  let dispatchedEntries: BatchedTimeSyncEntry[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TaskTimeSyncService, provideMockStore()],
    });
    taskTimeSync = TestBed.inject(TaskTimeSyncService);
    store = TestBed.inject(MockStore);
    dispatchedEntries = [];

    spyOn(store, 'dispatch').and.callFake(((action: Action) => {
      const candidate = action as Action & {
        taskId?: unknown;
        date?: unknown;
        duration?: unknown;
      };
      if (
        candidate.type === '[TimeTracking] Sync time spent' &&
        typeof candidate.taskId === 'string' &&
        typeof candidate.date === 'string' &&
        typeof candidate.duration === 'number'
      ) {
        dispatchedEntries.push({
          id: candidate.taskId,
          date: candidate.date,
          duration: candidate.duration,
        });
      }
    }) as typeof store.dispatch);
  });

  afterEach(() => taskTimeSync.clear());

  it('keeps every durable delta exactly once across seeded snapshots, imports, and replay', () => {
    const seeds = [0x8957, 0x1badb002, 0x5eed1234, 0xc0ffee, 0xdeadbeef];

    for (const seed of seeds) {
      taskTimeSync.clear();
      dispatchedEntries = [];

      let nextTaskNumber = 3;
      let liveState = createState([
        createTask('task-1', { [DATES[0]]: 1000 }),
        createTask('task-2', { [DATES[1]]: 2000 }),
      ]);
      let acceptedState = liveState;
      let durableEvents: ReplayEvent[] = [];
      let checkpoint: Checkpoint = { state: liveState, durableEventCount: 0 };
      const random = createSeededRandom(seed);

      const persistOne = (): void => {
        const entry = dispatchedEntries.shift();
        if (!entry) return;
        const event: ReplayEvent = { kind: 'delta', entry };
        durableEvents.push(event);
        acceptedState = applyReplayEvent(acceptedState, event);
      };

      const persistAll = (): void => {
        while (dispatchedEntries.length > 0) persistOne();
      };

      const takeSnapshot = (): void => {
        const projected = taskTimeSync.projectSnapshot(
          { task: liveState } as AppStateSnapshot,
          dispatchedEntries,
        );
        checkpoint = {
          state: projected.task as TaskState,
          durableEventCount: durableEvents.length,
        };
      };

      const assertInvariant = (step: number): void => {
        const context = `seed=${seed.toString(16)}, step=${step}`;
        const projected = taskTimeSync.projectSnapshot(
          { task: liveState } as AppStateSnapshot,
          dispatchedEntries,
        ).task as TaskState;
        expect(comparableTaskTimes(projected))
          .withContext(`projected state diverged: ${context}`)
          .toEqual(comparableTaskTimes(acceptedState));
        expect(comparableTaskTimes(replayFromCheckpoint(checkpoint, durableEvents)))
          .withContext(`checkpoint replay diverged: ${context}`)
          .toEqual(comparableTaskTimes(acceptedState));
      };

      for (let step = 0; step < 120; step++) {
        const activeTaskIds = liveState.ids as string[];
        const taskId = activeTaskIds[random() % activeTaskIds.length];
        const date = DATES[random() % DATES.length];
        const eventType = random() % 10;

        switch (eventType) {
          case 0:
          case 1:
          case 2: {
            const duration = (random() % 5000) + 1;
            const task = liveState.entities[taskId]!;
            liveState = taskReducer(
              liveState,
              TimeTrackingActions.addTimeSpent({
                task,
                date,
                duration,
                isFromTrackingReminder: false,
              }),
            );
            taskTimeSync.accumulate(taskId, duration, date);
            break;
          }
          case 3:
            if (random() % 2 === 0) {
              taskTimeSync.flushOne(taskId);
            } else {
              taskTimeSync.flush();
            }
            break;
          case 4:
            persistOne();
            break;
          case 5:
            takeSnapshot();
            break;
          case 6: {
            const event: ReplayEvent = {
              kind: 'delta',
              entry: { id: taskId, date, duration: (random() % 5000) + 1 },
            };
            durableEvents.push(event);
            acceptedState = applyReplayEvent(acceptedState, event);
            liveState = applyReplayEvent(liveState, event);
            break;
          }
          case 7: {
            taskTimeSync.flushOne(taskId);
            persistAll();
            const event: ReplayEvent = {
              kind: 'replace',
              taskId,
              date,
              duration: random() % 20000,
            };
            durableEvents.push(event);
            acceptedState = applyReplayEvent(acceptedState, event);
            liveState = applyReplayEvent(liveState, event);
            break;
          }
          case 8: {
            if (random() % 2 === 0) {
              taskTimeSync.clearOne(taskId);
              persistAll();
              const deleteEvent: ReplayEvent = { kind: 'delete', taskId };
              durableEvents.push(deleteEvent);
              acceptedState = applyReplayEvent(acceptedState, deleteEvent);
              liveState = applyReplayEvent(liveState, deleteEvent);

              const newTask = createTask(`task-${nextTaskNumber++}`);
              const createEvent: ReplayEvent = { kind: 'create', task: newTask };
              durableEvents.push(createEvent);
              acceptedState = applyReplayEvent(acceptedState, createEvent);
              liveState = applyReplayEvent(liveState, createEvent);
            } else {
              taskTimeSync.flush();
              persistAll();
              checkpoint = { state: liveState, durableEventCount: 0 };
              durableEvents = [];
            }
            break;
          }
          case 9:
            if (random() % 3 === 0) {
              taskTimeSync.clear();
              dispatchedEntries = [];
              liveState = createState([
                createTask(`task-${nextTaskNumber++}`, { [date]: random() % 10000 }),
              ]);
              acceptedState = liveState;
              durableEvents = [];
              checkpoint = { state: liveState, durableEventCount: 0 };
            } else {
              liveState = replayFromCheckpoint(checkpoint, durableEvents);
              acceptedState = liveState;
              taskTimeSync.clear();
              dispatchedEntries = [];
            }
            break;
        }

        assertInvariant(step);
      }

      taskTimeSync.flush();
      persistAll();
      assertInvariant(120);
      expect(comparableTaskTimes(liveState))
        .withContext(`live state did not converge: seed=${seed.toString(16)}`)
        .toEqual(comparableTaskTimes(acceptedState));
    }
  });

  it('preserves an unflushed tracked-time delta across a snapshot hydration by flushing it into a durable op (#3)', () => {
    // Reduced repro of the sync-hydration data-loss scenario at the reducer/
    // replay level. A tracked-but-unflushed delta lives only in the live store
    // and the in-memory accumulator when a remote snapshot that never saw it
    // replaces the live store. SyncHydrationService now flush()es the accumulator
    // BEFORE loadAllData, so the delta becomes a durable op that re-applies
    // additively on replay onto the delta-less remote baseline.
    taskTimeSync.clear();
    dispatchedEntries = [];

    // 1. Live state after tracking +500ms locally (addTimeSpent already applied).
    const trackedDelta = 500;
    let liveState = createState([createTask('task-1', { [DATES[0]]: 1000 })]);
    liveState = taskReducer(
      liveState,
      TimeTrackingActions.addTimeSpent({
        task: liveState.entities['task-1']!,
        date: DATES[0],
        duration: trackedDelta,
        isFromTrackingReminder: false,
      }),
    );
    taskTimeSync.accumulate('task-1', trackedDelta, DATES[0]);
    expect(liveState.entities['task-1']!.timeSpentOnDay[DATES[0]]).toBe(1500);

    // 2. The fix: flush BEFORE hydration replaces the live store. The delta is
    // dispatched as a durable syncTimeSpent op (captured here as an entry).
    taskTimeSync.flush();
    expect(dispatchedEntries).toEqual([
      { id: 'task-1', date: DATES[0], duration: trackedDelta },
    ]);
    const durableEvents: ReplayEvent[] = dispatchedEntries.map((entry) => ({
      kind: 'delta',
      entry,
    }));

    // 3. Hydration replaces the live store with a REMOTE snapshot that never saw
    // the delta (it was never uploaded) — task-1 is back to 1000.
    const hydratedRemoteState = createState([createTask('task-1', { [DATES[0]]: 1000 })]);

    // 4. Replaying the durable op onto the hydrated baseline restores the delta.
    const afterReplay = durableEvents.reduce(applyReplayEvent, hydratedRemoteState);
    expect(afterReplay.entities['task-1']!.timeSpentOnDay[DATES[0]]).toBe(1500);
    expect(afterReplay.entities['task-1']!.timeSpent).toBe(1500);

    // Contrast: without the flush at hydration time the delta is not yet durable,
    // so replaying the (empty) durable log leaves the hydrated baseline at 1000 —
    // the silent under-count this fix closes.
    const withoutFlush = ([] as ReplayEvent[]).reduce(
      applyReplayEvent,
      hydratedRemoteState,
    );
    expect(withoutFlush.entities['task-1']!.timeSpentOnDay[DATES[0]]).toBe(1000);
  });
});

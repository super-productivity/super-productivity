import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { AppStateSnapshot } from '../../op-log/core/types/backup.types';
import { initialTaskState, taskReducer } from './store/task.reducer';
import { DEFAULT_TASK, Task, TaskState } from './task.model';
import { TaskTimeSyncService } from './task-time-sync.service';

const createTask = (id: string, overrides: Partial<Task> = {}): Task =>
  ({
    ...DEFAULT_TASK,
    id,
    title: id,
    created: 1,
    ...overrides,
  }) as Task;

describe('TaskTimeSyncService', () => {
  let service: TaskTimeSyncService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TaskTimeSyncService, provideMockStore()],
    });
    service = TestBed.inject(TaskTimeSyncService);
    store = TestBed.inject(MockStore);
    dispatchSpy = spyOn(store, 'dispatch');
  });

  it('flushes accumulated time as a delta-only persistent action', () => {
    service.accumulate('task-1', 3000, '2024-01-15');
    service.accumulate('task-1', 2000, '2024-01-15');

    service.flush();

    const action = dispatchSpy.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(action['type']).toBe('[TimeTracking] Sync time spent');
    expect(action['taskId']).toBe('task-1');
    expect(action['date']).toBe('2024-01-15');
    expect(action['duration']).toBe(5000);
    expect(action['timeSpentForDay']).toBeUndefined();
  });

  it('projects pending task time out of an op-log snapshot', () => {
    const task = createTask('task-1', {
      timeSpentOnDay: { ['2024-01-15']: 5000 },
      timeSpent: 5000,
    });
    const taskState: TaskState = {
      ...initialTaskState,
      ids: ['task-1'],
      entities: { ['task-1']: task },
    };
    const snapshot = { task: taskState } as AppStateSnapshot;
    service.accumulate('task-1', 5000, '2024-01-15');

    const projected = service.projectSnapshot(snapshot);

    expect((projected.task as TaskState).entities['task-1']!.timeSpent).toBe(0);
    expect((snapshot.task as TaskState).entities['task-1']!.timeSpent).toBe(5000);
  });

  it('reconstructs the live total from a projected snapshot plus the flushed tail op', () => {
    const task = createTask('task-1', {
      timeSpentOnDay: { ['2024-01-15']: 5000 },
      timeSpent: 5000,
    });
    const taskState: TaskState = {
      ...initialTaskState,
      ids: ['task-1'],
      entities: { ['task-1']: task },
    };
    service.accumulate('task-1', 5000, '2024-01-15');
    const projected = service.projectSnapshot({ task: taskState } as AppStateSnapshot);

    service.flush();
    const tailAction = dispatchSpy.calls.mostRecent().args[0];
    const replayedState = taskReducer(projected.task as TaskState, {
      ...tailAction,
      meta: { ...tailAction.meta, isRemote: true },
    });

    expect(replayedState.entities['task-1']!.timeSpentOnDay['2024-01-15']).toBe(5000);
    expect(replayedState.entities['task-1']!.timeSpent).toBe(5000);
  });

  it('returns the original snapshot when no task time is pending', () => {
    const snapshot = { task: initialTaskState } as AppStateSnapshot;

    expect(service.projectSnapshot(snapshot)).toBe(snapshot);
  });
});

describe('TaskTimeSyncService recordings', () => {
  let service: TaskTimeSyncService;
  let dispatchSpy: jasmine.Spy;
  const day = '2026-09-13';
  const start = Date.parse('2026-09-13T08:00:00Z');
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TaskTimeSyncService, provideMockStore()],
    });
    service = TestBed.inject(TaskTimeSyncService);
    dispatchSpy = spyOn(TestBed.inject(MockStore), 'dispatch');
  });
  it('keeps one recording across periodic flushes and starts another after pause', () => {
    service.accumulate('task', 60000, day, start + 60000);
    service.flush();
    const first = dispatchSpy.calls.mostRecent().args[0];
    service.accumulate('task', 60000, day, start + 120000);
    service.flush();
    const second = dispatchSpy.calls.mostRecent().args[0];
    expect(first.session.s).toBe(start);
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.t).toBe(120000);
    expect(second.duration).toBe(60000);
    service.endSession();
    service.accumulate('task', 60000, day, start + 240000);
    service.flush();
    expect(dispatchSpy.calls.mostRecent().args[0].session.id).not.toBe(first.session.id);
  });
  it('flushes the old logical day before starting the next day recording', () => {
    service.accumulate('task', 60000, day, start + 60000);
    service.accumulate('task', 1000, '2026-09-14', start + 86401000);
    service.flush();
    const actions = dispatchSpy.calls.allArgs().map((args) => args[0]);
    expect(actions.map((a) => a.session.d)).toEqual([day, '2026-09-14']);
    expect(actions[0].session.id).not.toBe(actions[1].session.id);
  });
  it('projects only pending totals, then reconstructs recordings and totals from the tail', () => {
    let state = {
      ...initialTaskState,
      ids: ['task'],
      entities: {
        task: createTask('task', {
          timeSpentOnDay: { [day]: 120000 },
          timeSpent: 120000,
        }),
      },
    } as TaskState;
    dispatchSpy.and.callFake((action) => {
      state = taskReducer(state, action);
    });
    service.accumulate('task', 60000, day, start + 60000);
    service.flush();
    service.accumulate('task', 60000, day, start + 120000);
    const projected = service.projectSnapshot({ task: state } as AppStateSnapshot);
    expect((projected.task as TaskState).entities['task']!.timeSessions![0].t).toBe(
      60000,
    );
    service.flush();
    const action = dispatchSpy.calls.mostRecent().args[0];
    const replayed = taskReducer(projected.task as TaskState, {
      ...action,
      meta: { ...action.meta, isRemote: true },
    });
    expect(replayed.entities['task']!.timeSpentOnDay[day]).toBe(120000);
    expect(replayed.entities['task']!.timeSessions!.length).toBe(1);
    expect(replayed.entities['task']!.timeSessions![0].t).toBe(120000);
  });
  it('refreshes an archive snapshot after flushing the final recording', () => {
    const task = createTask('task', {
      timeSpentOnDay: { [day]: 60000 },
      timeSpent: 60000,
    });
    let state = { ...initialTaskState, ids: ['task'], entities: { task } } as TaskState;
    const store = TestBed.inject(MockStore);
    store.setState({ tasks: state });
    dispatchSpy.and.callFake((action) => {
      state = taskReducer(state, action);
      store.setState({ tasks: state });
    });
    service.accumulate('task', 60000, day, start + 60000);
    const archived = service.flushTasks([{ ...task, subTasks: [] }]);
    expect(archived[0].timeSessions![0].t).toBe(60000);
    expect(archived[0].timeSpentOnDay[day]).toBe(60000);
    expect(task.timeSessions).toBeUndefined();
  });
});

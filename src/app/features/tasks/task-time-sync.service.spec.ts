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

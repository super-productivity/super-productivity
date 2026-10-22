import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { ScannedActionsSubject } from '@ngrx/store';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { bulkOperationsMetaReducer } from '../../op-log/apply/bulk-hydration.meta-reducer';
import { ActionType, Operation, OpType } from '../../op-log/core/operation.types';
import { syncTimeSpent } from '../time-tracking/store/time-tracking.actions';
import { AppStateSnapshot } from '../../op-log/core/types/backup.types';
import { initialTaskState, taskReducer } from './store/task.reducer';
import { addSubTask } from './store/task.actions';
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
      providers: [
        TaskTimeSyncService,
        ScannedActionsSubject,
        provideMockStore({ initialState: { tasks: initialTaskState } }),
      ],
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

  it('flushes inherited parent time through additive bulk replay, but not explicit time', () => {
    for (const scenario of ['local', 'bulk', 'explicit'] as const) {
      const day = '2024-01-15';
      const parent = createTask('parent', {
        timeSpent: 5000,
        timeSpentOnDay: { [day]: 5000 },
      });
      const child = createTask('child', {
        parentId: parent.id,
        ...(scenario === 'explicit'
          ? { timeSpent: 600000, timeSpentOnDay: { [day]: 600000 } }
          : {}),
      });
      const before: TaskState = {
        ...initialTaskState,
        ids: [parent.id],
        entities: { parent },
        currentTaskId: parent.id,
      };
      const actions = TestBed.inject(ScannedActionsSubject);
      const subscription = service.taskChange$.subscribe(() => service.flush());
      store.setState({ tasks: before });
      actions.next({ type: 'seed' });
      service.accumulate(parent.id, 5000, day);
      const addChild = addSubTask({ task: child, parentId: parent.id });
      const operations: Operation[] = [
        {
          id: 'add',
          clientId: 'B',
          actionType: addSubTask.type as ActionType,
          opType: OpType.Create,
          entityType: 'TASK',
          entityId: child.id,
          payload: addChild,
          vectorClock: { B: 1 },
          timestamp: 1,
          schemaVersion: 1,
        },
        {
          id: 'delta',
          clientId: 'B',
          actionType: syncTimeSpent.type as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: child.id,
          payload: syncTimeSpent({ taskId: child.id, date: day, duration: 3000 }),
          vectorClock: { B: 2 },
          timestamp: 2,
          schemaVersion: 1,
        },
      ];
      const creation =
        scenario === 'bulk' ? bulkApplyOperations({ operations }) : addChild;
      const after = bulkOperationsMetaReducer(taskReducer)(before, creation);
      store.setState({ tasks: after });
      actions.next(creation);
      const action = dispatchSpy.calls.mostRecent().args[0];
      expect(action.taskId).toBe(scenario === 'explicit' ? parent.id : child.id);
      if (scenario === 'bulk') expect(after.entities[child.id]!.timeSpent).toBe(8000);
      const receiverBefore = bulkOperationsMetaReducer(taskReducer)(
        {
          ...before,
          currentTaskId: null,
          entities: { parent: { ...parent, timeSpent: 0, timeSpentOnDay: {} } },
        },
        creation,
      );
      const receiver = taskReducer(receiverBefore, {
        ...action,
        meta: { ...action.meta, isRemote: true },
      });
      const expected =
        scenario === 'bulk' ? 8000 : scenario === 'explicit' ? 600000 : 5000;
      expect(receiver.entities[child.id]!.timeSpent).toBe(expected);
      if (scenario !== 'explicit')
        expect(receiver.entities[parent.id]!.timeSpent).toBe(expected);
      subscription.unsubscribe();
    }
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

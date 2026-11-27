import { effect, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Action, ScannedActionsSubject } from '@ngrx/store';
import { Subscription } from 'rxjs';
import { bulkApplyOperations } from '../../op-log/apply/bulk-hydration.action';
import { bulkOperationsMetaReducer } from '../../op-log/apply/bulk-hydration.meta-reducer';
import { ActionType, Operation, OpType } from '../../op-log/core/operation.types';
import { syncTimeSpent } from '../time-tracking/store/time-tracking.actions';
import { AppStateSnapshot } from '../../op-log/core/types/backup.types';
import { initialTaskState, taskReducer } from './store/task.reducer';
import {
  addSubTask,
  moveSubTask,
  setCurrentTask,
  unsetCurrentTask,
} from './store/task.actions';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
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

  describe('taskChange$', () => {
    const day = '2024-01-15';
    const parent = createTask('parent', {
      timeSpent: 5000,
      timeSpentOnDay: { [day]: 5000 },
    });
    const before: TaskState = {
      ...initialTaskState,
      ids: [parent.id],
      entities: { parent },
      currentTaskId: parent.id,
    };
    let actions: ScannedActionsSubject;
    let changes: number;
    let subscription: Subscription;

    const commit = (tasks: TaskState, action: Action): void => {
      store.setState({ tasks });
      actions.next(action);
    };

    beforeEach(() => {
      actions = TestBed.inject(ScannedActionsSubject);
      changes = 0;
      subscription = service.taskChange$.subscribe(() => {
        changes++;
        service.flush();
      });
      commit(before, { type: 'seed' });
      service.accumulate(parent.id, 5000, day);
    });

    afterEach(() => subscription.unsubscribe());

    // Adds the first subtask while the parent is current, then applies the one
    // flushed delta on a receiver that has the creation but not the pending time.
    const addFirstSubTask = (
      scenario: 'local' | 'bulk' | 'explicit',
    ): {
      flushed: { taskId: string } | undefined;
      after: TaskState;
      receiver: TaskState;
    } => {
      const child = createTask('child', {
        parentId: parent.id,
        ...(scenario === 'explicit'
          ? { timeSpent: 600000, timeSpentOnDay: { [day]: 600000 } }
          : {}),
      });
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
      commit(after, creation);

      expect(changes).toBe(1);
      expect(dispatchSpy.calls.count()).toBe(scenario === 'explicit' ? 0 : 1);
      const flushed = dispatchSpy.calls.mostRecent()?.args[0];
      const receiverBefore = bulkOperationsMetaReducer(taskReducer)(
        {
          ...before,
          currentTaskId: null,
          entities: { parent: { ...parent, timeSpent: 0, timeSpentOnDay: {} } },
        },
        creation,
      );
      const receiver = flushed
        ? taskReducer(receiverBefore, {
            ...flushed,
            meta: { ...flushed.meta, isRemote: true },
          })
        : receiverBefore;
      return { flushed, after, receiver };
    };

    it('sends pending parent time for a first subtask that inherits it', () => {
      const { flushed, receiver } = addFirstSubTask('local');

      expect(flushed!.taskId).toBe('child');
      expect(receiver.entities['child']!.timeSpent).toBe(5000);
      expect(receiver.entities['parent']!.timeSpent).toBe(5000);
    });

    it('sends pending parent time for a first subtask from a remote bulk', () => {
      const { flushed, after, receiver } = addFirstSubTask('bulk');

      expect(flushed!.taskId).toBe('child');
      expect(after.entities['child']!.timeSpent).toBe(8000);
      expect(receiver.entities['child']!.timeSpent).toBe(8000);
      expect(receiver.entities['parent']!.timeSpent).toBe(8000);
    });

    it('drops pending parent time when the first subtask has its own time', () => {
      const { flushed, after, receiver } = addFirstSubTask('explicit');

      expect(flushed).toBeUndefined();
      expect(receiver.entities['child']!.timeSpent).toBe(600000);
      expect(after.entities['parent']!.timeSpent).toBe(600000);
      expect(receiver.entities['parent']!.timeSpent).toBe(600000);
    });

    it('judges inheritance at the op position inside a remote bulk', () => {
      const existing = createTask('existing', {
        parentId: 'other-parent',
        timeSpent: 1000,
        timeSpentOnDay: { [day]: 1000 },
      });
      const otherParent = createTask('other-parent', {
        subTaskIds: [existing.id],
        timeSpent: 1000,
        timeSpentOnDay: { [day]: 1000 },
      });
      const withOther: TaskState = {
        ...before,
        ids: [parent.id, otherParent.id, existing.id],
        entities: { parent, [otherParent.id]: otherParent, existing },
      };
      commit(withOther, { type: 'seed-other' });
      const child = createTask('child', { parentId: parent.id });
      const operations: Operation[] = [
        {
          id: 'move',
          clientId: 'B',
          actionType: moveSubTask.type as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: existing.id,
          payload: moveSubTask({
            taskId: existing.id,
            srcTaskId: otherParent.id,
            targetTaskId: parent.id,
            afterTaskId: null,
          }),
          vectorClock: { B: 1 },
          timestamp: 1,
          schemaVersion: 1,
        },
        {
          id: 'add',
          clientId: 'B',
          actionType: addSubTask.type as ActionType,
          opType: OpType.Create,
          entityType: 'TASK',
          entityId: child.id,
          payload: addSubTask({ task: child, parentId: parent.id }),
          vectorClock: { B: 2 },
          timestamp: 2,
          schemaVersion: 1,
        },
      ];
      const bulk = bulkApplyOperations({ operations });
      const after = bulkOperationsMetaReducer(taskReducer)(withOther, bulk);
      // The parent already has a child when its addSubTask applies, so the new
      // subtask inherits nothing and the parent is the subtask sum.
      expect(after.entities['child']!.timeSpent).toBe(0);
      expect(after.entities['parent']!.timeSpent).toBe(1000);
      expect(after.currentTaskId).toBe(child.id);
      commit(after, bulk);

      expect(changes).toBe(1);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('drops pending time when a task is converted into a subtask of it', () => {
      const existing = createTask('existing', {
        timeSpent: 2000,
        timeSpentOnDay: { [day]: 2000 },
      });
      commit(
        { ...before, ids: [parent.id, existing.id], entities: { parent, existing } },
        { type: 'seed-existing' },
      );
      // The state handleConvertToSubTask leaves: the parent is the subtask sum.
      commit(
        {
          ...before,
          ids: [parent.id, existing.id],
          entities: {
            parent: {
              ...parent,
              subTaskIds: [existing.id],
              timeSpent: 2000,
              timeSpentOnDay: { [day]: 2000 },
            },
            existing: { ...existing, parentId: parent.id },
          },
        },
        TaskSharedActions.convertToSubTask({
          taskId: existing.id,
          targetParentId: parent.id,
          afterTaskId: null,
        }),
      );
      service.flush();

      expect(changes).toBe(0);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('keeps pending time when a first child comes back without a recalculation', () => {
      const restored = createTask('restored', { parentId: parent.id });
      // Like undoing a delete: the child returns, the parent keeps its time.
      commit(
        {
          ...before,
          ids: [parent.id, restored.id],
          entities: { parent: { ...parent, subTaskIds: [restored.id] }, restored },
        },
        { type: '[Task Shared] restoreDeletedTask' },
      );
      service.flush();

      expect(dispatchSpy).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ taskId: parent.id, duration: 5000 }),
      );
    });

    it('moves nothing when an unchecked op may have attached a child first', () => {
      const restored = createTask('restored', { parentId: parent.id });
      const child = createTask('child', { parentId: parent.id });
      const operations: Operation[] = [
        {
          id: 'restore',
          clientId: 'B',
          actionType: '[Task Shared] restoreDeletedTask' as ActionType,
          opType: OpType.Create,
          entityType: 'TASK',
          entityId: restored.id,
          payload: { task: restored },
          vectorClock: { B: 1 },
          timestamp: 1,
          schemaVersion: 1,
        },
        {
          id: 'add',
          clientId: 'B',
          actionType: addSubTask.type as ActionType,
          opType: OpType.Create,
          entityType: 'TASK',
          entityId: child.id,
          payload: addSubTask({ task: child, parentId: parent.id }),
          vectorClock: { B: 2 },
          timestamp: 2,
          schemaVersion: 1,
        },
      ];
      commit(
        {
          ...before,
          ids: [parent.id, restored.id, child.id],
          entities: {
            parent: { ...parent, subTaskIds: [restored.id, child.id], timeSpent: 0 },
            restored,
            child,
          },
          currentTaskId: child.id,
        },
        bulkApplyOperations({ operations }),
      );

      expect(changes).toBe(1);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('drops pending time when an existing task moves under the tracked task', () => {
      const existing = createTask('existing', {
        timeSpent: 2000,
        timeSpentOnDay: { [day]: 2000 },
      });
      const otherParent = createTask('other-parent', {
        subTaskIds: [existing.id],
        timeSpent: 2000,
        timeSpentOnDay: { [day]: 2000 },
      });
      const withOther: TaskState = {
        ...before,
        ids: [parent.id, otherParent.id, existing.id],
        entities: {
          parent,
          [otherParent.id]: otherParent,
          existing: { ...existing, parentId: otherParent.id },
        },
      };
      commit(withOther, { type: 'seed-other' });
      const move = moveSubTask({
        taskId: existing.id,
        srcTaskId: otherParent.id,
        targetTaskId: parent.id,
        afterTaskId: null,
      });
      const after = taskReducer(withOther, move);
      expect(after.currentTaskId).toBe(parent.id);
      expect(after.entities['parent']!.subTaskIds).toEqual([existing.id]);
      commit(after, move);
      service.flush();

      // The current task didn't change, so nothing flushed on the move, and
      // the parent's dropped batch isn't sent afterwards either.
      expect(changes).toBe(0);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('flushes pending time for the previous task on a plain switch or stop', () => {
      const other = createTask('other');
      const switched: TaskState = {
        ...before,
        ids: [parent.id, other.id],
        entities: { parent, other },
        currentTaskId: other.id,
      };

      commit(switched, setCurrentTask({ id: other.id }));
      service.accumulate(other.id, 2000, day);
      commit({ ...switched, currentTaskId: null }, unsetCurrentTask());

      expect(changes).toBe(2);
      expect(
        dispatchSpy.calls
          .allArgs()
          .map(([flushed]) => [flushed.taskId, flushed.duration]),
      ).toEqual([
        ['parent', 5000],
        ['other', 2000],
      ]);
    });

    it('does not make an effect that dispatches depend on the current task', () => {
      const trigger = signal(0);
      let runs = 0;
      TestBed.runInInjectionContext(() =>
        effect(() => {
          trigger();
          runs++;
          // Store.dispatch emits the scanned action synchronously, like this.
          actions.next({ type: 'from-effect' });
        }),
      );
      TestBed.tick();

      commit({ ...before, currentTaskId: null }, unsetCurrentTask());
      TestBed.tick();

      expect(runs).toBe(1);
    });
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

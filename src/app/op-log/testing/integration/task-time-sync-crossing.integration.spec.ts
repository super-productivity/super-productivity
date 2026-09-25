import { Action } from '@ngrx/store';
import { DEFAULT_TASK, Task, TaskState } from '../../../features/tasks/task.model';
import {
  initialTaskState,
  taskAdapter,
  taskReducer,
} from '../../../features/tasks/store/task.reducer';
import { convertOpToAction } from '../../apply/operation-converter.util';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { ActionType, OpType, Operation } from '../../core/operation.types';
import { PersistentAction } from '../../core/persistent-action.interface';
import { isDisjointMergeEligible } from '../../sync/conflict-disjoint-merge.util';

/**
 * No-pending crossing of a `syncTimeSpent` delta with a retained edit
 * (#10146): the receiver decides "apply both" vs "route through LWW" with the
 * production predicate, and this spec checks what applying both actually does
 * to task state on the two clients, in both arrival orders.
 *
 * The delta is applied through `convertOpToAction` + `taskReducer` (the real
 * remote-apply seam). The retained edit is applied as the shallow `updateOne`
 * the task CRUD reducer performs for an update.
 */
describe('Task-time sync crossing integration (#10146)', () => {
  const DAY = '2026-09-12';
  const HISTORY: Record<string, number> = {
    ['2026-09-01']: 7200000,
    ['2026-09-05']: 3600000,
    [DAY]: 7200000,
  };
  const HISTORY_TOTAL = 18000000;
  const DELTA = 60000;

  const baseState = (): TaskState => {
    const task: Task = {
      ...DEFAULT_TASK,
      id: 'task-1',
      title: 'T',
      created: 1,
      projectId: 'INBOX_PROJECT',
      timeSpentOnDay: HISTORY,
      timeSpent: HISTORY_TOTAL,
    };
    return { ...initialTaskState, ids: [task.id], entities: { [task.id]: task } };
  };

  const capturedSyncTimeSpent = (form: 'direct' | 'deferred'): Operation => {
    const actionPayload = { taskId: 'task-1', date: DAY, duration: DELTA };
    return {
      id: `time-${form}`,
      clientId: 'B',
      actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: {
        actionPayload,
        entityChanges:
          form === 'direct'
            ? new OperationCaptureService().extractEntityChanges({
                type: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
                ...actionPayload,
                meta: {
                  isPersistent: true,
                  entityType: 'TASK',
                  entityId: 'task-1',
                  opType: OpType.Update,
                },
              } as unknown as PersistentAction)
            : [],
      },
      vectorClock: { B: 1 },
      timestamp: 1000,
      schemaVersion: 1,
    };
  };

  const retainedEdit = (changes: Partial<Task>): Operation => ({
    id: 'edit',
    clientId: 'A',
    actionType: ActionType.TASK_SHARED_UPDATE,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: 'task-1',
    payload: { task: { id: 'task-1', changes } },
    vectorClock: { A: 1 },
    timestamp: 2000,
    schemaVersion: 1,
  });

  const applyDelta = (state: TaskState, deltaOp: Operation): TaskState =>
    taskReducer(state, convertOpToAction(deltaOp) as unknown as Action);

  const applyEdit = (state: TaskState, editOp: Operation): TaskState => {
    const { changes } = (editOp.payload as { task: { changes: Partial<Task> } }).task;
    return taskAdapter.updateOne({ id: 'task-1', changes }, state);
  };

  const taskOf = (state: TaskState): Task => state.entities['task-1'] as Task;

  for (const form of ['direct', 'deferred'] as const) {
    it(`applies a ${form}-form delta and a retained non-time edit in either order to the same state`, () => {
      const delta = capturedSyncTimeSpent(form);
      const edit = retainedEdit({ isDone: true });

      expect(
        isDisjointMergeEligible({
          localOps: [edit],
          remoteOps: [delta],
          payloadKey: 'task',
          entityId: 'task-1',
        }),
      ).toBe(true);

      const editThenDelta = applyDelta(applyEdit(baseState(), edit), delta);
      const deltaThenEdit = applyEdit(applyDelta(baseState(), delta), edit);

      expect(taskOf(editThenDelta)).toEqual(taskOf(deltaThenEdit));
      expect(taskOf(editThenDelta).isDone).toBe(true);
      expect(taskOf(editThenDelta).timeSpent).toBe(HISTORY_TOTAL + DELTA);
      expect(taskOf(editThenDelta).timeSpentOnDay).toEqual({
        ...HISTORY,
        [DAY]: HISTORY[DAY] + DELTA,
      });
    });

    it(`routes a ${form}-form delta crossing an absolute time write through LWW because apply-both is order-dependent`, () => {
      const delta = capturedSyncTimeSpent(form);
      const edit = retainedEdit({ timeSpentOnDay: { ...HISTORY, [DAY]: 0 } });

      expect(
        isDisjointMergeEligible({
          localOps: [edit],
          remoteOps: [delta],
          payloadKey: 'task',
          entityId: 'task-1',
        }),
      ).toBe(false);

      const editThenDelta = applyDelta(applyEdit(baseState(), edit), delta);
      const deltaThenEdit = applyEdit(applyDelta(baseState(), delta), edit);

      expect(taskOf(editThenDelta).timeSpentOnDay[DAY]).toBe(DELTA);
      expect(taskOf(deltaThenEdit).timeSpentOnDay[DAY]).toBe(0);
    });
  }

  it('keeps the outgoing syncTimeSpent payload unchanged (no task-field names on the wire)', () => {
    const { payload } = capturedSyncTimeSpent('direct');
    expect(payload).toEqual({
      actionPayload: { taskId: 'task-1', date: DAY, duration: DELTA },
      entityChanges: [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          opType: OpType.Update,
          changes: { taskId: 'task-1', date: DAY, duration: DELTA },
        },
      ],
    });
  });
});

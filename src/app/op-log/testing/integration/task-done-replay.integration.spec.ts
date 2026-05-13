import { Action, ActionReducer } from '@ngrx/store';
import { bulkOperationsMetaReducer } from '../../apply/bulk-hydration.meta-reducer';
import { bulkApplyOperations } from '../../apply/bulk-hydration.action';
import { ActionType, Operation, OpType } from '../../core/operation.types';
import { taskSharedCrudMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/task-shared-crud.reducer';
import {
  createBaseState,
  createMockTask,
} from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { RootState } from '../../../root-store/root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';
import { appStateFeatureKey } from '../../../root-store/app-state/app-state.reducer';

describe('done task operation replay', () => {
  const TASK_ID = 'task-done-yesterday';
  const ACTION_TODAY = '2024-06-14';
  const REPLAY_TODAY = '2024-06-15';
  const DONE_TIMESTAMP = new Date(2024, 5, 14, 12, 0, 0, 0).getTime();

  const createState = (): RootState => {
    const base = createBaseState();
    const task = createMockTask({
      id: TASK_ID,
      isDone: false,
      doneOn: undefined,
      dueDay: undefined,
      dueWithTime: undefined,
    });

    return {
      ...base,
      [TASK_FEATURE_NAME]: {
        ...base[TASK_FEATURE_NAME],
        ids: [TASK_ID],
        entities: { [TASK_ID]: task },
      },
      [appStateFeatureKey]: {
        ...base[appStateFeatureKey],
        todayStr: REPLAY_TODAY,
        startOfNextDayDiffMs: 0,
      },
    };
  };

  const applyOperation = (state: RootState, op: Operation): RootState => {
    const passThroughReducer: ActionReducer<RootState, Action> = (s) => s as RootState;
    const reducer = bulkOperationsMetaReducer(
      taskSharedCrudMetaReducer(passThroughReducer),
    );
    return reducer(state, bulkApplyOperations({ operations: [op] }));
  };

  it('replays completed tasks with the operation date instead of the replay date', () => {
    const op: Operation = {
      id: 'op-done-yesterday',
      actionType: ActionType.TASK_SHARED_UPDATE,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: TASK_ID,
      payload: {
        actionPayload: {
          task: { id: TASK_ID, changes: { isDone: true } },
        },
        entityChanges: [],
      },
      clientId: 'clientA',
      vectorClock: { clientA: 1 },
      timestamp: DONE_TIMESTAMP,
      schemaVersion: 1,
    };

    const result = applyOperation(createState(), op);
    const task = result[TASK_FEATURE_NAME].entities[TASK_ID] as Task;

    expect(task.isDone).toBe(true);
    expect(task.doneOn).toBe(DONE_TIMESTAMP);
    expect(task.dueDay).toBe(ACTION_TODAY);
    expect(task.dueDay).not.toBe(REPLAY_TODAY);
  });
});

import { Action, ActionReducer } from '@ngrx/store';
import { bulkOperationsMetaReducer } from '../../apply/bulk-hydration.meta-reducer';
import { bulkApplyOperations } from '../../apply/bulk-hydration.action';
import { ActionType, Operation, OpType } from '../../core/operation.types';
import { taskSharedSchedulingMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer';
import {
  createBaseState,
  createMockTask,
} from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { RootState } from '../../../root-store/root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { Task } from '../../../features/tasks/task.model';
import { Tag } from '../../../features/tag/tag.model';
import { appStateFeatureKey } from '../../../root-store/app-state/app-state.reducer';

describe('planTasksForToday operation replay', () => {
  const TASK_ID = 'task-legacy-plan-today';
  const ACTION_TODAY = '2024-06-14';
  const REPLAY_TODAY = '2024-06-15';
  const START_OF_NEXT_DAY_DIFF_MS = 4 * 60 * 60 * 1000;

  const createState = (
    taskOverrides: Partial<Task> = {},
    replayOffsetMs = 0,
  ): RootState => {
    const base = createBaseState();
    const task = createMockTask({
      id: TASK_ID,
      dueDay: undefined,
      dueWithTime: undefined,
      ...taskOverrides,
    });

    return {
      ...base,
      [TASK_FEATURE_NAME]: {
        ...base[TASK_FEATURE_NAME],
        ids: [TASK_ID],
        entities: { [TASK_ID]: task },
      },
      [TAG_FEATURE_NAME]: {
        ...base[TAG_FEATURE_NAME],
        entities: {
          ...base[TAG_FEATURE_NAME].entities,
          [TODAY_TAG.id]: {
            ...base[TAG_FEATURE_NAME].entities[TODAY_TAG.id],
            taskIds: [],
          } as Tag,
        },
      },
      [appStateFeatureKey]: {
        ...base[appStateFeatureKey],
        todayStr: REPLAY_TODAY,
        startOfNextDayDiffMs: replayOffsetMs,
      },
    };
  };

  const createPlanOp = (
    actionPayload: Record<string, unknown>,
    timestamp = new Date(2024, 5, 14, 12, 0, 0, 0).getTime(),
  ): Operation => ({
    id: 'op-plan-today',
    actionType: ActionType.TASK_SHARED_PLAN_FOR_TODAY,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: TASK_ID,
    entityIds: [TASK_ID],
    payload: {
      actionPayload,
      entityChanges: [],
    },
    clientId: 'clientA',
    vectorClock: { clientA: 1 },
    timestamp,
    schemaVersion: 1,
  });

  const applyOperation = (state: RootState, op: Operation): RootState => {
    const passThroughReducer: ActionReducer<RootState, Action> = (s) => s as RootState;
    const reducer = bulkOperationsMetaReducer(
      taskSharedSchedulingMetaReducer(passThroughReducer),
    );
    return reducer(state, bulkApplyOperations({ operations: [op] }));
  };

  it('replays legacy operations using the operation timestamp date instead of replay date', () => {
    const state = createState();
    const op = createPlanOp({
      taskIds: [TASK_ID],
      parentTaskMap: {},
    });

    const result = applyOperation(state, op);
    const task = result[TASK_FEATURE_NAME].entities[TASK_ID] as Task;
    const todayTaskIds = (result[TAG_FEATURE_NAME].entities[TODAY_TAG.id] as Tag).taskIds;

    expect(task.dueDay).toBe(ACTION_TODAY);
    expect(task.dueDay).not.toBe(REPLAY_TODAY);
    expect(todayTaskIds).toEqual([TASK_ID]);
  });

  it('replays new operations with the captured start-of-next-day offset', () => {
    const scheduledAt = new Date(2024, 5, 15, 2, 0, 0, 0).getTime();
    const state = createState({ dueWithTime: scheduledAt }, 0);
    const op = createPlanOp({
      taskIds: [TASK_ID],
      today: ACTION_TODAY,
      startOfNextDayDiffMs: START_OF_NEXT_DAY_DIFF_MS,
      parentTaskMap: {},
    });

    const result = applyOperation(state, op);
    const task = result[TASK_FEATURE_NAME].entities[TASK_ID] as Task;

    expect(task.dueDay).toBe(ACTION_TODAY);
    expect(task.dueWithTime).toBe(scheduledAt);
  });
});

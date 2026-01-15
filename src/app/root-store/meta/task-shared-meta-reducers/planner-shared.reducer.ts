import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { RootState } from '../../root-state';
import { PlannerActions } from '../../../features/planner/store/planner.actions';
import { Task } from '../../../features/tasks/task.model';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { unique } from '../../../util/unique';
import {
  ActionHandlerMap,
  filterOutTodayTag,
  getTag,
  hasInvalidTodayTag,
  updateTags,
} from './task-shared-helpers';
import {
  TASK_FEATURE_NAME,
  taskAdapter,
} from '../../../features/tasks/store/task.reducer';
import { plannerFeatureKey } from '../../../features/planner/store/planner.reducer';
import {
  ADD_TASK_PANEL_ID,
  OVERDUE_LIST_ID,
} from '../../../features/planner/planner.model';

// =============================================================================
// ACTION HANDLERS
// =============================================================================

const handleTransferTask = (
  state: RootState,
  task: Task,
  today: string,
  targetIndex: number,
  newDay: string,
  prevDay: string,
  targetTaskId?: string,
): RootState => {
  // First, update the task's dueDay and clear dueWithTime (from task.reducer)
  state = {
    ...state,
    [TASK_FEATURE_NAME]: taskAdapter.updateOne(
      {
        id: task.id,
        changes: {
          dueDay: newDay,
          dueWithTime: undefined,
        },
      },
      state[TASK_FEATURE_NAME],
    ),
  };

  // Handle planner days updates (from planner.reducer)
  const plannerState = state[plannerFeatureKey as keyof RootState] as any;
  const daysCopy = { ...plannerState.days };

  // Update previous day (remove task)
  // Note: We intentionally DO remove from planner.days[today] when transferring away,
  // so that AddTasksForTomorrowService doesn't find stale tasks in planner.days[today].
  // TODAY_TAG.taskIds handles today's task ordering, but planner.days[today] should stay consistent.
  const updatePrevDay =
    prevDay === ADD_TASK_PANEL_ID || prevDay === OVERDUE_LIST_ID || !daysCopy[prevDay];

  if (!updatePrevDay && daysCopy[prevDay]) {
    daysCopy[prevDay] = daysCopy[prevDay].filter((id: string) => id !== task.id);
  }

  // Update new day (add task)
  const updateNextDay = newDay !== ADD_TASK_PANEL_ID && newDay !== today;

  if (updateNextDay) {
    const targetDays = daysCopy[newDay] || [];
    daysCopy[newDay] = unique([
      ...targetDays.slice(0, targetIndex),
      task.id,
      ...targetDays.slice(targetIndex),
    ])
      // when moving a parent to the day, remove all sub-tasks
      .filter((id: string) => !task.subTaskIds.includes(id));
  }

  state = {
    ...state,
    [plannerFeatureKey]: {
      ...plannerState,
      days: daysCopy,
    },
  };

  // Then handle today tag updates (from tag.reducer)
  const todayTag = getTag(state, TODAY_TAG.id);
  // Get current task's tagIds from the updated state
  const currentTask = state[TASK_FEATURE_NAME].entities[task.id] as Task;
  const currentTagIds = currentTask?.tagIds || [];
  const hasTaskTodayTag = hasInvalidTodayTag(currentTagIds);

  if (prevDay === today && newDay !== today) {
    // Moving away from today - update both tag.taskIds and task.tagIds (board-style pattern)
    state = updateTags(state, [
      {
        id: TODAY_TAG.id,
        changes: {
          taskIds: todayTag.taskIds.filter((id) => id !== task.id),
        },
      },
    ]);

    // Remove TODAY from task.tagIds if present
    if (hasTaskTodayTag) {
      state = {
        ...state,
        [TASK_FEATURE_NAME]: taskAdapter.updateOne(
          {
            id: task.id,
            changes: { tagIds: filterOutTodayTag(currentTagIds) },
          },
          state[TASK_FEATURE_NAME],
        ),
      };
    }

    return state;
  }

  if (prevDay !== today && newDay === today) {
    // Moving to today - update TODAY_TAG.taskIds for ordering
    // IMPORTANT: TODAY_TAG should NEVER be in task.tagIds (virtual tag pattern)
    // Membership is determined by task.dueDay. See: docs/ai/today-tag-architecture.md
    const taskIds = [...todayTag.taskIds];
    const targetIndexToUse = targetTaskId
      ? todayTag.taskIds.findIndex((id) => id === targetTaskId)
      : targetIndex;
    taskIds.splice(targetIndexToUse, 0, task.id);

    state = updateTags(state, [
      {
        id: TODAY_TAG.id,
        changes: {
          taskIds: unique(taskIds),
        },
      },
    ]);

    // Ensure TODAY_TAG is NOT in task.tagIds (cleanup if present from legacy data)
    if (hasTaskTodayTag) {
      state = {
        ...state,
        [TASK_FEATURE_NAME]: taskAdapter.updateOne(
          {
            id: task.id,
            changes: { tagIds: filterOutTodayTag(currentTagIds) },
          },
          state[TASK_FEATURE_NAME],
        ),
      };
    }

    return state;
  }

  return state;
};

const handlePlanTaskForDay = (
  state: RootState,
  task: Task,
  day: string,
  isAddToTop: boolean,
): RootState => {
  const todayStr = getDbDateStr();
  const todayTag = getTag(state, TODAY_TAG.id);
  const currentTask = state[TASK_FEATURE_NAME].entities[task.id] as Task;
  const currentTagIds = currentTask?.tagIds || [];
  const hasTaskTodayTag = hasInvalidTodayTag(currentTagIds);

  if (day === todayStr) {
    // Adding to today - update TODAY_TAG.taskIds for ordering
    // IMPORTANT: TODAY_TAG should NEVER be in task.tagIds (virtual tag pattern)
    // Membership is determined by task.dueDay. See: docs/ai/today-tag-architecture.md
    const newTagTaskIds = unique(
      isAddToTop
        ? [task.id, ...todayTag.taskIds.filter((tid) => tid !== task.id)]
        : [...todayTag.taskIds.filter((tid) => tid !== task.id), task.id],
    );

    state = updateTags(state, [
      {
        id: todayTag.id,
        changes: {
          taskIds: newTagTaskIds,
        },
      },
    ]);

    // Ensure TODAY_TAG is NOT in task.tagIds (cleanup if present from legacy data)
    if (hasTaskTodayTag) {
      state = {
        ...state,
        [TASK_FEATURE_NAME]: taskAdapter.updateOne(
          {
            id: task.id,
            changes: { tagIds: filterOutTodayTag(currentTagIds) },
          },
          state[TASK_FEATURE_NAME],
        ),
      };
    }

    return state;
  } else if (todayTag.taskIds.includes(task.id)) {
    // Moving away from today - update both tag.taskIds and task.tagIds
    const newTagTaskIds = todayTag.taskIds.filter((id) => id !== task.id);
    state = updateTags(state, [
      {
        id: todayTag.id,
        changes: {
          taskIds: newTagTaskIds,
        },
      },
    ]);

    // Remove TODAY from task.tagIds if present
    if (hasTaskTodayTag) {
      state = {
        ...state,
        [TASK_FEATURE_NAME]: taskAdapter.updateOne(
          {
            id: task.id,
            changes: { tagIds: filterOutTodayTag(currentTagIds) },
          },
          state[TASK_FEATURE_NAME],
        ),
      };
    }

    return state;
  }

  return state;
};

const handleMoveBeforeTask = (
  state: RootState,
  fromTask: Task,
  toTaskId: string,
): RootState => {
  const todayTag = getTag(state, TODAY_TAG.id);

  if (todayTag.taskIds.includes(toTaskId)) {
    // Moving to today (target is in today list)
    // Note: TODAY_TAG is a virtual tag and should NOT be in task.tagIds
    const taskIds = todayTag.taskIds.filter((id) => id !== fromTask.id);
    const targetIndex = taskIds.indexOf(toTaskId);
    if (targetIndex === -1) {
      // Edge case: toTaskId was filtered out (e.g., moving task before itself)
      taskIds.push(fromTask.id);
    } else {
      taskIds.splice(targetIndex, 0, fromTask.id);
    }

    state = updateTags(state, [
      {
        id: todayTag.id,
        changes: {
          taskIds: unique(taskIds),
        },
      },
    ]);

    return state;
  } else if (todayTag.taskIds.includes(fromTask.id)) {
    // Moving away from today
    // Note: TODAY_TAG is a virtual tag and should NOT be in task.tagIds
    state = updateTags(state, [
      {
        id: todayTag.id,
        changes: {
          taskIds: todayTag.taskIds.filter((id) => id !== fromTask.id),
        },
      },
    ]);

    return state;
  }

  return state;
};

// =============================================================================
// META REDUCER
// =============================================================================

const createActionHandlers = (state: RootState, action: Action): ActionHandlerMap => ({
  [PlannerActions.transferTask.type]: () => {
    const { task, today, targetIndex, newDay, prevDay, targetTaskId } =
      action as ReturnType<typeof PlannerActions.transferTask>;
    return handleTransferTask(
      state,
      task,
      today,
      targetIndex,
      newDay,
      prevDay,
      targetTaskId,
    );
  },
  [PlannerActions.planTaskForDay.type]: () => {
    const { task, day, isAddToTop } = action as ReturnType<
      typeof PlannerActions.planTaskForDay
    >;
    return handlePlanTaskForDay(state, task, day, isAddToTop || false);
  },
  [PlannerActions.moveBeforeTask.type]: () => {
    const { fromTask, toTaskId } = action as ReturnType<
      typeof PlannerActions.moveBeforeTask
    >;
    return handleMoveBeforeTask(state, fromTask, toTaskId);
  },
});

export const plannerSharedMetaReducer: MetaReducer = (
  reducer: ActionReducer<any, Action>,
) => {
  return (state: unknown, action: Action) => {
    if (!state) return reducer(state, action);

    const rootState = state as RootState;
    const actionHandlers = createActionHandlers(rootState, action);
    const handler = actionHandlers[action.type];
    const updatedState = handler ? handler(rootState) : rootState;

    return reducer(updatedState, action);
  };
};

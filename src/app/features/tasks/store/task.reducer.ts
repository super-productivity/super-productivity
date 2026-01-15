import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import {
  __updateMultipleTaskSimple,
  addSubTask,
  moveSubTask,
  moveSubTaskDown,
  moveSubTaskToBottom,
  moveSubTaskToTop,
  moveSubTaskUp,
  removeTimeSpent,
  roundTimeSpentForDay,
  setCurrentTask,
  setSelectedTask,
  toggleStart,
  toggleTaskHideSubTasks,
  unsetCurrentTask,
  updateTaskUi,
} from './task.actions';
import { Task, TaskDetailTargetPanel, TaskState } from '../task.model';
import { calcTotalTimeSpent } from '../util/calc-total-time-spent';
import { addTaskRepeatCfgToTask } from '../../task-repeat-cfg/store/task-repeat-cfg.actions';
import {
  deleteTaskHelper,
  getTaskById,
  reCalcTimesForParentIfParent,
  reCalcTimeSpentForParentIfParent,
  updateTimeSpentForTask,
} from './task.reducer.util';
import { taskAdapter } from './task.adapter';
import { moveItemAfterAnchor } from '../../work-context/store/work-context-meta.helper';
import {
  arrayMoveLeft,
  arrayMoveRight,
  arrayMoveToEnd,
  arrayMoveToStart,
} from '../../../util/array-move';
import { filterOutId } from '../../../util/filter-out-id';
import {
  addTaskAttachment,
  deleteTaskAttachment,
  updateTaskAttachment,
} from '../task-attachment/task-attachment.actions';
import { Update } from '@ngrx/entity';
import { unique } from '../../../util/unique';
import { roundDurationVanilla } from '../../../util/round-duration';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { createReducer, on } from '@ngrx/store';
import { PlannerActions } from '../../planner/store/planner.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import {
  TimeTrackingActions,
  syncTimeSpent,
} from '../../time-tracking/store/time-tracking.actions';
import { TaskLog } from '../../../core/log';
import { devError } from '../../../util/dev-error';

export { taskAdapter };

export const TASK_FEATURE_NAME = 'tasks';

// REDUCER
// -------
export const initialTaskState: TaskState = taskAdapter.getInitialState({
  // TODO maybe at least move those properties to an ui property
  currentTaskId: null,
  selectedTaskId: null,
  taskDetailTargetPanel: TaskDetailTargetPanel.Default,
  lastCurrentTaskId: null,
  isDataLoaded: false,
}) as TaskState;

export const taskReducer = createReducer<TaskState>(
  initialTaskState,

  // META ACTIONS
  // ------------
  on(loadAllData, (state, { appDataComplete }) =>
    appDataComplete.task
      ? {
          ...appDataComplete.task,
          currentTaskId: null,
          selectedTaskId: null,
          lastCurrentTaskId: appDataComplete.task.currentTaskId,
          isDataLoaded: true,
        }
      : state,
  ),

  on(TaskSharedActions.deleteProject, (state, { allTaskIds }) => {
    return taskAdapter.removeMany(allTaskIds, {
      ...state,
      currentTaskId:
        state.currentTaskId && allTaskIds.includes(state.currentTaskId)
          ? null
          : state.currentTaskId,
    });
  }),

  on(TimeTrackingActions.addTimeSpent, (state, { task, date, duration }) => {
    const currentTimeSpentForTickDay =
      (task.timeSpentOnDay && +task.timeSpentOnDay[date]) || 0;
    return updateTimeSpentForTask(
      task.id,
      {
        ...task.timeSpentOnDay,
        [date]: currentTimeSpentForTickDay + duration,
      },
      state,
    );
  }),

  // Sync time spent from remote clients
  // Local: no-op (state already updated by addTimeSpent ticks)
  // Remote: apply the batched duration
  on(syncTimeSpent, (state, action) => {
    // Only apply for remote actions - local state is already up-to-date
    if (!(action.meta as PersistentActionMeta).isRemote) {
      return state;
    }

    const { taskId, date, duration } = action;
    const task = state.entities[taskId];
    if (!task) {
      TaskLog.warn(`[syncTimeSpent] Task ${taskId} not found, skipping`);
      return state;
    }

    const currentTimeSpentForDay =
      (task.timeSpentOnDay && +task.timeSpentOnDay[date]) || 0;
    return updateTimeSpentForTask(
      taskId,
      {
        ...task.timeSpentOnDay,
        [date]: currentTimeSpentForDay + duration,
      },
      state,
    );
  }),

  //--------------------------------

  // TODO check if working
  on(setCurrentTask, (state, { id }) => {
    if (id) {
      const task = getTaskById(id, state);
      const subTaskIds = task.subTaskIds;
      let taskToStartId = id;
      if (subTaskIds && subTaskIds.length) {
        const undoneTasks = subTaskIds
          .map((tid) => getTaskById(tid, state))
          .filter((ta: Task) => !ta.isDone);
        taskToStartId = undoneTasks.length ? undoneTasks[0].id : subTaskIds[0];
      }
      return {
        ...taskAdapter.updateOne(
          {
            id: taskToStartId,
            changes: { isDone: false, doneOn: undefined },
          },
          state,
        ),
        currentTaskId: taskToStartId,
        selectedTaskId: state.selectedTaskId && taskToStartId,
      };
    } else {
      return {
        ...state,
        currentTaskId: null,
      };
    }
  }),

  on(unsetCurrentTask, (state) => {
    return { ...state, currentTaskId: null, lastCurrentTaskId: state.currentTaskId };
  }),

  on(setSelectedTask, (state, { id, taskDetailTargetPanel, isSkipToggle }) => {
    if (
      state.taskDetailTargetPanel === TaskDetailTargetPanel.DONT_OPEN_PANEL &&
      taskDetailTargetPanel !== null &&
      id
    ) {
      return {
        ...state,
        taskDetailTargetPanel: TaskDetailTargetPanel.DONT_OPEN_PANEL,
        selectedTaskId: id,
      };
    }

    if (isSkipToggle) {
      return {
        ...state,
        taskDetailTargetPanel: taskDetailTargetPanel || null,
        selectedTaskId: id,
      };
    }
    return {
      ...state,
      taskDetailTargetPanel:
        !id || id === state.selectedTaskId ? null : taskDetailTargetPanel || null,
      selectedTaskId: id === state.selectedTaskId ? null : id,
    };
  }),

  // Task Actions
  // ------------
  on(__updateMultipleTaskSimple, (state, { taskUpdates }) => {
    return taskAdapter.updateMany(taskUpdates, state);
  }),

  on(updateTaskUi, (state, { task }) => {
    return taskAdapter.updateOne(task, state);
  }),

  // Bulk task updates - used for archive task batch operations
  on(TaskSharedActions.updateTasks, (state, { tasks }) => {
    return taskAdapter.updateMany(tasks, state);
  }),

  // TODO simplify
  on(toggleTaskHideSubTasks, (state, { taskId, isShowLess, isEndless }) => {
    const task = getTaskById(taskId, state);
    const subTasks = task.subTaskIds.map((id) => getTaskById(id, state));
    const doneTasksLength = subTasks.filter((t) => t.isDone).length;
    const isDoneTaskCaseNeeded = doneTasksLength && doneTasksLength < subTasks.length;
    // for easier calculations we use 0 instead of undefined for show state
    const oldVal = task._hideSubTasksMode || 0;
    let newVal: number = isShowLess ? oldVal + 1 : oldVal - 1;

    if (!isDoneTaskCaseNeeded && newVal === 1) {
      if (isShowLess) {
        newVal = 2;
      } else {
        newVal = 0;
      }
    }

    if (isEndless) {
      if (newVal < 0) {
        newVal = 2;
      } else if (newVal > 2) {
        newVal = 0;
      }
    } else {
      if (newVal < 0) {
        newVal = 0;
      } else if (newVal > 2) {
        newVal = 2;
      }
    }

    return taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          _hideSubTasksMode: newVal || undefined,
        },
      },
      state,
    );
  }),

  on(moveSubTask, (state, { taskId, srcTaskId, targetTaskId, afterTaskId }) => {
    let newState = state;
    const oldPar = getTaskById(srcTaskId, state);
    const newPar = getTaskById(targetTaskId, state);

    // for old parent remove
    newState = taskAdapter.updateOne(
      {
        id: oldPar.id,
        changes: {
          subTaskIds: oldPar.subTaskIds.filter(filterOutId(taskId)),
        },
      },
      newState,
    );
    newState = reCalcTimesForParentIfParent(oldPar.id, newState);

    // for new parent add using anchor-based positioning
    const newParSubTaskIds = (newState.entities[newPar.id] as Task).subTaskIds;
    newState = taskAdapter.updateOne(
      {
        id: newPar.id,
        changes: {
          subTaskIds: moveItemAfterAnchor(taskId, afterTaskId, newParSubTaskIds),
        },
      },
      newState,
    );
    newState = reCalcTimesForParentIfParent(newPar.id, newState);

    // change parent id for moving task
    newState = taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          parentId: newPar.id,
          projectId: newPar.projectId,
        },
      },
      newState,
    );

    return newState;
  }),

  on(moveSubTaskUp, (state, { id, parentId }) => {
    const parentTask = state.entities[parentId];
    if (!parentTask) {
      TaskLog.err(`Parent task ${parentId} not found`);
      return state;
    }
    const parentSubTaskIds = parentTask.subTaskIds;

    // Check if the subtask is actually in the parent's subtask list
    if (!parentSubTaskIds.includes(id)) {
      TaskLog.err(`Subtask ${id} not found in parent ${parentId} subtasks`);
      return state;
    }

    return taskAdapter.updateOne(
      {
        id: parentId,
        changes: {
          subTaskIds: arrayMoveLeft(parentSubTaskIds, id),
        },
      },
      state,
    );
  }),

  on(moveSubTaskDown, (state, { id, parentId }) => {
    const parentTask = state.entities[parentId];
    if (!parentTask) {
      TaskLog.err(`Parent task ${parentId} not found`);
      return state;
    }
    const parentSubTaskIds = parentTask.subTaskIds;

    // Check if the subtask is actually in the parent's subtask list
    if (!parentSubTaskIds.includes(id)) {
      TaskLog.err(`Subtask ${id} not found in parent ${parentId} subtasks`);
      return state;
    }

    return taskAdapter.updateOne(
      {
        id: parentId,
        changes: {
          subTaskIds: arrayMoveRight(parentSubTaskIds, id),
        },
      },
      state,
    );
  }),

  on(moveSubTaskToTop, (state, { id, parentId }) => {
    const parentTask = state.entities[parentId];
    if (!parentTask) {
      TaskLog.err(`Parent task ${parentId} not found`);
      return state;
    }
    const parentSubTaskIds = parentTask.subTaskIds;

    // Check if the subtask is actually in the parent's subtask list
    if (!parentSubTaskIds.includes(id)) {
      TaskLog.err(`Subtask ${id} not found in parent ${parentId} subtasks`);
      return state;
    }

    return taskAdapter.updateOne(
      {
        id: parentId,
        changes: {
          subTaskIds: arrayMoveToStart(parentSubTaskIds, id),
        },
      },
      state,
    );
  }),

  on(moveSubTaskToBottom, (state, { id, parentId }) => {
    const parentTask = state.entities[parentId];
    if (!parentTask) {
      TaskLog.err(`Parent task ${parentId} not found`);
      return state;
    }
    const parentSubTaskIds = parentTask.subTaskIds;

    // Check if the subtask is actually in the parent's subtask list
    if (!parentSubTaskIds.includes(id)) {
      TaskLog.err(`Subtask ${id} not found in parent ${parentId} subtasks`);
      return state;
    }

    return taskAdapter.updateOne(
      {
        id: parentId,
        changes: {
          subTaskIds: arrayMoveToEnd(parentSubTaskIds, id),
        },
      },
      state,
    );
  }),

  on(removeTimeSpent, (state, { id, date, duration }) => {
    const task = getTaskById(id, state);
    const currentTimeSpentForTickDay =
      (task.timeSpentOnDay && +task.timeSpentOnDay[date]) || 0;

    return updateTimeSpentForTask(
      id,
      {
        ...task.timeSpentOnDay,
        [date]: Math.max(currentTimeSpentForTickDay - duration, 0),
      },
      state,
    );
  }),

  on(addSubTask, (state, { task, parentId }) => {
    const parentTask = state.entities[parentId];
    if (!parentTask) {
      devError(`Parent task ${parentId} not found when trying to add sub task`);
      return state;
    }

    // add item1
    const stateCopy = taskAdapter.addOne(
      {
        ...task,
        // update timeSpent if first sub task and non present
        ...(parentTask.subTaskIds.length === 0 &&
        Object.keys(task.timeSpentOnDay).length === 0
          ? {
              timeSpentOnDay: parentTask.timeSpentOnDay,
              timeSpent: calcTotalTimeSpent(parentTask.timeSpentOnDay),
            }
          : {}),
        // update timeEstimate if first sub task and non present
        ...(parentTask.subTaskIds.length === 0 && !task.timeEstimate
          ? { timeEstimate: parentTask.timeEstimate }
          : {}),
        parentId,
        // should always be empty
        tagIds: [],
        // should always be the one of the parent
        projectId: parentTask.projectId,
      },
      state,
    );

    return {
      ...stateCopy,
      // update current task to new sub task if parent was current before
      ...(state.currentTaskId === parentId ? { currentTaskId: task.id } : {}),
      // also add to parent task
      entities: {
        ...stateCopy.entities,
        [parentId]: {
          ...parentTask,
          subTaskIds: [...parentTask.subTaskIds, task.id],
        },
      },
    };
  }),

  on(toggleStart, (state) => {
    if (state.currentTaskId) {
      return {
        ...state,
        lastCurrentTaskId: state.currentTaskId,
      };
    }
    return state;
  }),

  on(roundTimeSpentForDay, (state, { day, taskIds, isRoundUp, roundTo, projectId }) => {
    const isLimitToProject: boolean = !!projectId || projectId === null;

    const idsToUpdateDirectly: string[] = taskIds.filter((id) => {
      const task: Task = getTaskById(id, state);
      return (
        (task.subTaskIds.length === 0 || !!task.parentId) &&
        (!isLimitToProject || task.projectId === projectId)
      );
    });
    const subTaskIds: string[] = idsToUpdateDirectly.filter(
      (id) => !!getTaskById(id, state).parentId,
    );
    const parentTaskToReCalcIds: string[] = unique<string>(
      subTaskIds.map((id) => getTaskById(id, state).parentId as string),
    );

    const updateSubsAndMainWithoutSubs: Update<Task>[] = idsToUpdateDirectly.map((id) => {
      const spentOnDayBefore = getTaskById(id, state).timeSpentOnDay;
      const timeSpentOnDayUpdated = {
        ...spentOnDayBefore,
        [day]: roundDurationVanilla(spentOnDayBefore[day], roundTo, isRoundUp),
      };
      return {
        id,
        changes: {
          timeSpentOnDay: timeSpentOnDayUpdated,
          timeSpent: calcTotalTimeSpent(timeSpentOnDayUpdated),
        },
      };
    });

    // // update subs
    const newState = taskAdapter.updateMany(updateSubsAndMainWithoutSubs, state);
    // reCalc parents
    return parentTaskToReCalcIds.reduce(
      (acc, parentId) => reCalcTimeSpentForParentIfParent(parentId, acc),
      newState,
    );
  }),

  // TAG STUFF
  // ---------
  on(TaskSharedActions.addTagToTask, (state, { taskId, tagId }) => {
    const task = state.entities[taskId];
    if (!task) return state;
    return taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          tagIds: unique([...task.tagIds, tagId]),
        },
      },
      state,
    );
  }),

  // TASK ARCHIVE STUFF
  // ------------------
  on(TaskSharedActions.moveToArchive, (state, { tasks }) => {
    let copyState = state;
    tasks.forEach((task) => {
      copyState = deleteTaskHelper(copyState, task);
    });
    return {
      ...copyState,
    };
  }),

  // REPEAT STUFF
  // ------------
  on(addTaskRepeatCfgToTask, (state, { taskRepeatCfg, taskId }) => {
    return taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          repeatCfgId: taskRepeatCfg.id,
        },
      },
      state,
    );
  }),

  // TASK ATTACHMENTS
  // ----------------
  on(addTaskAttachment, (state, { taskId, taskAttachment }) => {
    return taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          attachments: [...getTaskById(taskId, state).attachments, taskAttachment],
        },
      },
      state,
    );
  }),

  on(updateTaskAttachment, (state, { taskId, taskAttachment }) => {
    const attachments = getTaskById(taskId, state).attachments;
    const updatedAttachments = attachments.map((attachment) =>
      attachment.id === taskAttachment.id
        ? {
            ...attachment,
            ...taskAttachment.changes,
          }
        : attachment,
    );

    return taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          attachments: updatedAttachments,
        },
      },
      state,
    );
  }),

  on(deleteTaskAttachment, (state, { taskId, id }) => {
    return taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          attachments: getTaskById(taskId, state).attachments.filter(
            (at) => at.id !== id,
          ),
        },
      },
      state,
    );
  }),

  // PLANNER STUFF
  // --------------
  // NOTE: transferTask is now handled in planner-shared.reducer.ts
  on(PlannerActions.moveBeforeTask, (state, { toTaskId, fromTask }) => {
    const targetTask = state.entities[toTaskId] as Task;
    if (!targetTask) {
      return state;
    }

    return taskAdapter.updateOne(
      {
        id: fromTask.id,
        changes: {
          dueDay: targetTask.dueDay,
          dueWithTime: undefined,
        },
      },
      state,
    );
  }),

  on(PlannerActions.planTaskForDay, (state, { task, day }) => {
    return taskAdapter.updateOne(
      {
        id: task.id,
        changes: {
          dueDay: day,
          dueWithTime: undefined,
        },
      },
      state,
    );
  }),

  on(TaskSharedActions.removeTasksFromTodayTag, (state, { taskIds }) => {
    return {
      ...state,
      // we do this to maintain the order of tasks when they are moved to overdue
      ids: [...taskIds, ...state.ids.filter((id) => !taskIds.includes(id))],
    };
  }),
);

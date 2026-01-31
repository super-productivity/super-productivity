import { createFeatureSelector, createSelector } from '@ngrx/store';
import { TASK_FEATURE_NAME } from './task.reducer';
import {
  Task,
  TaskState,
  TaskWithDueDay,
  TaskWithDueTime,
  TaskWithReminder,
  TaskWithSubTasks,
} from '../task.model';
import { taskAdapter } from './task.adapter';
import { devError } from '../../../util/dev-error';
import { TODAY_TAG } from '../../tag/tag.const';
import { IssueProvider } from '../../issue/issue.model';
import { Project } from '../../project/project.model';
import { selectAllProjects } from '../../project/store/project.selectors';
import {
  selectTagFeatureState,
  selectTodayTagTaskIds,
} from '../../tag/store/tag.reducer';
import { selectTodayStr } from '../../../root-store/app-state/app-state.selectors';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { isToday } from '../../../util/is-today.util';
const mapSubTasksToTasks = (tasksIN: Task[]): TaskWithSubTasks[] => {
  // Create a Map for O(1) lookups instead of O(n) find() calls
  const taskMap = new Map<string, Task>();
  for (const task of tasksIN) {
    // Guard against undefined tasks during sync operations
    if (task?.id) {
      taskMap.set(task.id, task);
    }
  }

  const result: TaskWithSubTasks[] = [];
  for (const task of tasksIN) {
    // Guard against undefined tasks during sync operations
    if (!task) continue;
    if (task.parentId) continue;

    if (task.subTaskIds && task.subTaskIds.length > 0) {
      const subTasks: Task[] = [];
      for (const subTaskId of task.subTaskIds) {
        const subTask = taskMap.get(subTaskId);
        if (subTask) subTasks.push(subTask);
      }
      result.push({ ...task, subTasks });
    } else {
      result.push({ ...task, subTasks: [] });
    }
  }
  return result;
};
export const mapSubTasksToTask = (
  task: Task | null,
  s: TaskState,
): TaskWithSubTasks | null => {
  if (!task) {
    return null;
  }
  return {
    ...task,
    subTasks: task.subTaskIds.map((id) => {
      const subTask = s.entities[id] as Task;
      if (!subTask) {
        devError('Task data not found for ' + id);
      }
      return subTask;
    }),
  };
};

export const flattenTasks = (tasksIN: TaskWithSubTasks[]): TaskWithSubTasks[] => {
  let flatTasks: TaskWithSubTasks[] = [];
  tasksIN.forEach((task) => {
    if (!task) {
      return;
    }
    flatTasks.push(task);
    if (task.subTasks && task.subTasks.length > 0) {
      // NOTE: in order for the model to be identical we add an empty subTasks array
      const validSubTasks = task.subTasks.filter((t) => t !== null && t !== undefined);
      flatTasks = flatTasks.concat(validSubTasks.map((t) => ({ ...t, subTasks: [] })));
    }
  });
  return flatTasks;
};

// SELECTORS
// ---------
const { selectEntities, selectAll } = taskAdapter.getSelectors();
export const selectTaskFeatureState = createFeatureSelector<TaskState>(TASK_FEATURE_NAME);
export const selectTaskEntities = createSelector(selectTaskFeatureState, selectEntities);
export const selectCurrentTaskId = createSelector(
  selectTaskFeatureState,
  (state) => state.currentTaskId,
);
export const selectIsTaskDataLoaded = createSelector(
  selectTaskFeatureState,
  (state) => state.isDataLoaded,
);
export const selectCurrentTask = createSelector(selectTaskFeatureState, (s) =>
  s.currentTaskId ? (s.entities[s.currentTaskId] as Task) : null,
);
export const selectLastCurrentTask = createSelector(selectTaskFeatureState, (s) =>
  s.lastCurrentTaskId ? (s.entities[s.lastCurrentTaskId] as Task) : null,
);

export const selectCurrentTaskOrParentWithData = createSelector(
  selectTaskFeatureState,
  (s): TaskWithSubTasks | null => {
    if (!s.currentTaskId) return null;
    const currentTask = s.entities[s.currentTaskId];
    if (!currentTask) return null;

    // If current task has a parent, return the parent with its subtasks
    if (currentTask.parentId) {
      const parentTask = s.entities[currentTask.parentId];
      if (parentTask) {
        return mapSubTasksToTask(parentTask, s);
      }
    }
    // Otherwise return the current task
    return mapSubTasksToTask(currentTask, s);
  },
);

export const selectStartableTasks = createSelector(
  selectTaskFeatureState,
  (s): Task[] => {
    return s.ids
      .map((id) => s.entities[id])
      .filter(
        (task): task is Task =>
          !!task && !task.isDone && (!!task.parentId || task.subTaskIds.length === 0),
      );
  },
);

export const selectOverdueTasks = createSelector(
  selectTaskFeatureState,
  selectTodayStr,
  (s, todayStr): Task[] => {
    const today = new Date(todayStr);
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    return s.ids
      .map((id) => s.entities[id])
      .filter(
        (task): task is Task =>
          !!task &&
          // Note: String comparison works correctly here because dueDay is in YYYY-MM-DD format
          // which is lexicographically sortable. This avoids timezone conversion issues.
          !!(
            (task.dueDay && task.dueDay < todayStr) ||
            (task.dueWithTime && task.dueWithTime < todayStart.getTime())
          ),
      );
  },
);

export const selectUndoneOverdue = createSelector(
  selectOverdueTasks,
  (overdue): Task[] => {
    return overdue.filter((t) => !t.isDone);
  },
);

// Note: Uses selectTodayTagTaskIds due to circular dependency with work-context.selectors.ts
// This selector may include stale tasks - for accurate membership use selectTodayTaskIds
export const selectOverdueTasksOnToday = createSelector(
  selectOverdueTasks,
  selectTodayTagTaskIds,
  (overdue, todayTaskIds): Task[] => {
    const todaySet = new Set(todayTaskIds);
    return overdue.filter((t) => todaySet.has(t.id));
  },
);

// Note: With the virtual TODAY_TAG architecture, overdue tasks (dueDay < today)
// can never be on today's list (dueDay === today), so we don't filter by TODAY_TAG.taskIds.
// We only filter out subtasks whose parent is also overdue (to avoid duplicates).
export const selectOverdueTasksWithSubTasks = createSelector(
  selectOverdueTasks,
  selectTaskFeatureState,
  (overdueTasks, taskState): TaskWithSubTasks[] => {
    const overdueIdSet = new Set(overdueTasks.map((task) => task.id));
    return overdueTasks
      .filter(
        (task) =>
          // Only show top-level tasks, or subtasks whose parent is not overdue
          (!task.parentId || !overdueIdSet.has(task.parentId)) && !task.isDone,
      )
      .map((task) => {
        return mapSubTasksToTask(task as Task, taskState) as TaskWithSubTasks;
      })
      .sort((a, b) => {
        // sort all chronologically
        if (a.dueWithTime && b.dueWithTime) {
          return a.dueWithTime - b.dueWithTime;
        } else if (a.dueWithTime && b.dueDay) {
          // Use dateStrToUtcDate to avoid timezone issues
          const bStartOfDueDay = dateStrToUtcDate(b.dueDay);
          bStartOfDueDay.setHours(0, 0, 0, 0);
          return a.dueWithTime - bStartOfDueDay.getTime();
        } else if (a.dueDay && b.dueWithTime) {
          // Use dateStrToUtcDate to avoid timezone issues
          const aStartOfDueDay = dateStrToUtcDate(a.dueDay);
          aStartOfDueDay.setHours(0, 0, 0, 0);
          return aStartOfDueDay.getTime() - b.dueWithTime;
        } else if (a.dueDay && b.dueDay) {
          // Note: String comparison works correctly here because dueDay is in YYYY-MM-DD format
          // which is lexicographically sortable. This avoids timezone conversion issues.
          return a.dueDay.localeCompare(b.dueDay);
        }
        return 0;
      });
  },
);

export const selectAllTasksDueAndOverdue = createSelector(
  selectTaskFeatureState,
  selectTagFeatureState,
  selectTodayStr,
  (s, tagState, todayStr): Task[] => {
    const todayTaskIdSet = new Set(tagState.entities[TODAY_TAG.id]?.taskIds);
    return s.ids
      .map((id) => s.entities[id])
      .filter(
        (task): task is Task =>
          !!task &&
          // Note: String comparison works correctly here because dueDay is in YYYY-MM-DD format
          // which is lexicographically sortable. This avoids timezone conversion issues.
          !!task.dueDay &&
          task.dueDay <= todayStr &&
          !todayTaskIdSet.has(task.id),
      );
  },
);

export const selectSelectedTaskId = createSelector(
  selectTaskFeatureState,
  (state) => state.selectedTaskId,
);
export const selectTaskDetailTargetPanel = createSelector(
  selectTaskFeatureState,
  (state: TaskState) => state.taskDetailTargetPanel,
);
export const selectSelectedTask = createSelector(
  selectTaskFeatureState,
  (s): TaskWithSubTasks | null => {
    if (!s.selectedTaskId || !s.entities[s.selectedTaskId]) {
      return null;
    }
    return mapSubTasksToTask(s.entities[s.selectedTaskId] || null, s);
  },
);

export const selectCurrentTaskParentOrCurrent = createSelector(
  selectTaskFeatureState,
  (s): Task | undefined => {
    if (!s.currentTaskId) return undefined;
    const currentTask = s.entities[s.currentTaskId];
    if (!currentTask) return undefined;

    // If current task has a parent, return the parent
    if (currentTask.parentId) {
      const parentTask = s.entities[currentTask.parentId];
      if (parentTask) return parentTask;
    }
    return currentTask;
  },
);

export const selectAllTasks = createSelector(selectTaskFeatureState, selectAll);

export const selectAllTasksWithSubTasks = createSelector(
  selectAllTasks,
  mapSubTasksToTasks,
);

// Uses virtual tag pattern to determine TODAY membership:
// A task is "in TODAY" if dueDay === today OR dueWithTime is for today
// PERF: Single-pass iteration instead of multiple passes over all tasks
export const selectLaterTodayTasksWithSubTasks = createSelector(
  selectTaskFeatureState,
  selectTodayStr,
  (taskState, todayStr): TaskWithSubTasks[] => {
    if (!todayStr) {
      return [];
    }

    const now = Date.now();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndTime = todayEnd.getTime();

    // Helper to check if task is "in TODAY" via virtual tag pattern
    // Priority: dueWithTime takes precedence over dueDay (mutual exclusivity)
    const isInToday = (task: Task): boolean => {
      if (task.dueWithTime) {
        return isToday(task.dueWithTime);
      }
      return task.dueDay === todayStr;
    };

    // Helper to check if task is scheduled for later today
    const isScheduledLaterToday = (task: Task): boolean =>
      !!task.dueWithTime && task.dueWithTime >= now && task.dueWithTime <= todayEndTime;

    // PERF: Single pass to categorize all tasks (was 2 passes before)
    const scheduledParentTasks: Task[] = [];
    const scheduledSubtasks: Task[] = [];
    const unscheduledParentsInToday: Task[] = [];

    for (const id of taskState.ids) {
      const task = taskState.entities[id];
      if (!task || task.isDone || !isInToday(task)) continue;

      if (task.parentId) {
        // Subtask - only care about scheduled ones
        if (isScheduledLaterToday(task)) {
          scheduledSubtasks.push(task);
        }
      } else {
        // Parent task - categorize by scheduled status
        if (isScheduledLaterToday(task)) {
          scheduledParentTasks.push(task);
        } else {
          unscheduledParentsInToday.push(task);
        }
      }
    }

    // Create set for O(1) lookup
    const parentIdsWithScheduledSubtasks = new Set(
      scheduledSubtasks.map((subtask) => subtask.parentId),
    );

    // Parents to include: scheduled parents OR parents with scheduled subtasks
    const parentsToInclude = [
      ...scheduledParentTasks,
      ...unscheduledParentsInToday.filter((t) =>
        parentIdsWithScheduledSubtasks.has(t.id),
      ),
    ];

    // Get IDs of parents that will be included
    const parentIdsInLaterToday = new Set(parentsToInclude.map((task) => task.id));

    // Find orphaned subtasks (scheduled subtasks whose parents are NOT in Later Today)
    const orphanedScheduledSubtasks = scheduledSubtasks.filter(
      (subtask) => !parentIdsInLaterToday.has(subtask.parentId!),
    );

    // Combine parents and orphaned subtasks
    const allTopLevelTasks = [...parentsToInclude, ...orphanedScheduledSubtasks];

    // Map to include subtasks for parents and sort by time
    // PERF: Pre-compute earliest times to avoid recalculating in sort comparator
    const tasksWithTimes = allTopLevelTasks.map((task) => {
      const taskWithSubTasks = !task.parentId
        ? (mapSubTasksToTask(task, taskState) as TaskWithSubTasks)
        : ({ ...task, subTasks: [] } as TaskWithSubTasks);

      // Pre-compute earliest scheduled time for sorting
      const earliestTime = Math.min(
        taskWithSubTasks.dueWithTime || Infinity,
        ...(taskWithSubTasks.subTasks || []).map((st) => st.dueWithTime || Infinity),
      );
      return { task: taskWithSubTasks, earliestTime };
    });

    tasksWithTimes.sort((a, b) => a.earliestTime - b.earliestTime);
    return tasksWithTimes.map((t) => t.task);
  },
);

export const selectAllDoneIds = createSelector(
  selectAllTasks,
  (tasks: Task[]): string[] => tasks.filter((t) => t?.isDone).map((t) => t.id),
);

// DYNAMIC SELECTORS
// -----------------
export const selectTaskById = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { id: string }): Task => state.entities[props.id] as Task,
);

export const selectTaskByIssueId = createSelector(
  selectAllTasks,
  (tasks: Task[], props: { issueId: string }): Task | undefined =>
    tasks.find((t) => t.issueId === props.issueId),
);

export const selectTasksById = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { ids: string[] }): Task[] =>
    props.ids
      ? props.ids.map((id) => state.entities[id]).filter((task): task is Task => !!task)
      : [],
);

export const selectTasksWithDueTimeById = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { ids: string[] }): Task[] =>
    props.ids
      ? (props.ids.map((id) => state.entities[id]) as Task[])
          // there is a short moment when the reminder is already there but the task is not
          // and there is another when a tasks get deleted
          .filter((task) => !!task?.dueWithTime)
      : [],
);

export const selectTasksWithSubTasksByIds = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { ids: string[] }): TaskWithSubTasks[] =>
    props.ids
      .map((id: string) => state.entities[id])
      .filter((task): task is Task => !!task)
      .map((task) => mapSubTasksToTask(task, state) as TaskWithSubTasks),
);

export const selectTaskByIdWithSubTaskData = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { id: string }): TaskWithSubTasks => {
    const task = state.entities[props.id];
    if (!task) {
      devError('Task data not found for ' + props.id);
    }
    return mapSubTasksToTask(task as Task, state) as TaskWithSubTasks;
  },
);

export const selectMainTasksWithoutTag = createSelector(
  selectAllTasks,
  (tasks: Task[], props: { tagId: string }): Task[] =>
    tasks.filter((task) => !task.parentId && !task.tagIds.includes(props.tagId)),
);

export const selectAllCalendarTaskEventIds = createSelector(
  selectAllTasks,
  (tasks: Task[]): string[] =>
    tasks.filter((task) => task.issueType === 'ICAL').map((t) => t.issueId as string),
);

export const selectAllCalendarIssueTasks = createSelector(
  selectAllTasks,
  (tasks: Task[]): Task[] => tasks.filter((task) => task.issueType === 'ICAL'),
);

export const selectTasksWorkedOnOrDoneFlat = createSelector(
  selectAllTasks,
  (tasks: Task[], props: { day: string }) => {
    if (!props) {
      return null;
    }

    const todayStr = props.day;
    return tasks.filter(
      (t: Task) =>
        t.isDone ||
        (t.timeSpentOnDay &&
          t.timeSpentOnDay[todayStr] &&
          t.timeSpentOnDay[todayStr] > 0),
    );
  },
);

export const selectTasksDueForDay = createSelector(
  selectAllTasks,
  (tasks: Task[], props: { day: string }): TaskWithDueDay[] => {
    return tasks.filter((task) => task.dueDay === props.day) as TaskWithDueDay[];
  },
);

export const selectTasksDueAndOverdueForDay = createSelector(
  selectAllTasks,
  (tasks: Task[], props: { day: string }): TaskWithDueDay[] => {
    return tasks.filter(
      // Note: String comparison works correctly here because dueDay is in YYYY-MM-DD format
      // which is lexicographically sortable. This avoids timezone conversion issues that occur
      // when creating Date objects from date strings.
      (task) => typeof task.dueDay === 'string' && task.dueDay <= props.day,
    ) as TaskWithDueDay[];
  },
);

export const selectTasksWithDueTimeForRange = createSelector(
  selectAllTasks,
  (tasks: Task[], props: { start: number; end: number }): TaskWithDueTime[] => {
    return tasks.filter(
      (task) =>
        typeof task.dueWithTime === 'number' &&
        task.dueWithTime >= props.start &&
        task.dueWithTime <= props.end,
    ) as TaskWithDueTime[];
  },
);

export const selectAllTasksWithDueTime = createSelector(
  selectAllTasks,
  (tasks: Task[]): TaskWithDueTime[] => {
    return tasks.filter(
      (task): task is TaskWithDueTime => !!task && typeof task.dueWithTime === 'number',
    );
  },
);

export const selectAllTasksWithDueTimeSorted = createSelector(
  selectAllTasks,
  (tasks: Task[]): TaskWithDueTime[] => {
    return tasks
      .filter(
        (task): task is TaskWithDueTime => !!task && typeof task.dueWithTime === 'number',
      )
      .sort((a, b) => a.dueWithTime - b.dueWithTime);
  },
);

export const selectAllTasksWithReminder = createSelector(
  selectAllTasks,
  (tasks: Task[]): TaskWithReminder[] => {
    return tasks.filter(
      (task) => task && typeof task.remindAt === 'number' && !task.isDone,
    ) as TaskWithReminder[];
  },
);

export const selectTasksWithDueTimeUntil = createSelector(
  selectAllTasks,
  (tasks: Task[], props: { end: number }): TaskWithDueTime[] => {
    return tasks.filter(
      (task) => typeof task.dueWithTime === 'number' && task.dueWithTime <= props.end,
    ) as TaskWithDueTime[];
  },
);

// REPEATABLE TASKS
// ----------------
export const selectAllRepeatableTaskWithSubTasks = createSelector(
  selectAllTasksWithSubTasks,
  (tasks: TaskWithSubTasks[]) => {
    return tasks.filter((task) => !!task.repeatCfgId);
  },
);

export const selectTasksByRepeatConfigId = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { repeatCfgId: string }): Task[] => {
    const ids = state.ids as string[];
    return ids
      .map((id) => state.entities[id])
      .filter((task): task is Task => !!task && task.repeatCfgId === props.repeatCfgId);
  },
);

export const selectTaskWithSubTasksByRepeatConfigId = createSelector(
  selectAllTasksWithSubTasks,
  (tasks: TaskWithSubTasks[], props: { repeatCfgId: string }) => {
    return tasks.filter((task) => task.repeatCfgId === props.repeatCfgId);
  },
);

export const selectTasksByTag = createSelector(
  selectAllTasksWithSubTasks,
  (tasks: TaskWithSubTasks[], props: { tagId: string }) => {
    return tasks.filter((task) => task.tagIds.indexOf(props.tagId) !== -1);
  },
);

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const selectAllTaskIssueIdsForIssueProvider = (issueProvider: IssueProvider) => {
  return createSelector(selectAllTasks, (tasks: Task[]): string[] => {
    return tasks
      .filter((task) => task.issueProviderId === issueProvider.id)
      .map((t) => t.issueId as string);
  });
};

export const selectAllTasksWithoutHiddenProjects = createSelector(
  selectAllTasks,
  selectAllProjects,
  (tasks: Task[], projects: Project[]): Task[] => {
    const projectMap: { [id: string]: Project } = {};
    projects.forEach((project) => {
      projectMap[project.id] = project;
    });

    return tasks.filter((task) => {
      const projectId = task.projectId;
      if (!projectId) return true;

      const project = projectMap[projectId];
      if (!project) return true;

      if (project.isHiddenFromMenu) return false;

      // if (project.backlogTaskIds && project.backlogTaskIds.includes(task.id)) {
      //   return false;
      // }

      return true;
    });
  },
);

export const selectAllTasksWithDueDay = createSelector(
  selectTaskFeatureState,
  (taskState): TaskWithDueDay[] => {
    // PERF: Iterate ids instead of Object.values() to avoid creating intermediate array
    const tasksWithDueDay: TaskWithDueDay[] = [];
    for (const id of taskState.ids) {
      const task = taskState.entities[id];
      if (task?.dueDay) {
        tasksWithDueDay.push(task as TaskWithDueDay);
      }
    }
    // Sort by dueDay (YYYY-MM-DD format is lexicographically sortable)
    return tasksWithDueDay.sort((a, b) => a.dueDay.localeCompare(b.dueDay));
  },
);

export const selectAllUndoneTasksWithDueDay = createSelector(
  selectAllTasksWithDueDay,
  (tasks): TaskWithDueDay[] => {
    return tasks.filter((task) => !task.isDone);
  },
);

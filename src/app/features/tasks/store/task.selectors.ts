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
import { isDBDateStr } from '../../../util/get-db-date-str';
import { IssueProvider, isPluginIssueProvider } from '../../issue/issue.model';
import { selectArchivedProjectIds } from '../../project/store/project.selectors';
import { selectTodayTagTaskIds } from '../../tag/store/tag.reducer';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../../root-store/app-state/app-state.selectors';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { isTodayWithOffset } from '../../../util/is-today.util';
import { getTimeConflictTaskIds } from '../util/get-time-conflict-task-ids';

export const isCalendarIssueTask = (task: Task | undefined): task is Task =>
  !!task &&
  !!task.issueType &&
  (task.issueType === 'ICAL' || isPluginIssueProvider(task.issueType));

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
  const subTasks: Task[] = [];
  for (const id of task.subTaskIds) {
    const subTask = s.entities[id];
    if (subTask) {
      subTasks.push(subTask);
    } else {
      devError('Task data not found for ' + id);
    }
  }
  return {
    ...task,
    subTasks,
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
export const selectTaskEntitiesInActiveProjects = createSelector(
  selectTaskEntities,
  selectArchivedProjectIds,
  (entities, archivedIds): Record<string, Task | undefined> =>
    archivedIds.size === 0
      ? entities
      : Object.fromEntries(
          Object.entries(entities).filter(
            ([, t]) => !t || !t.projectId || !archivedIds.has(t.projectId),
          ),
        ),
);
export const selectCurrentTaskId = createSelector(
  selectTaskFeatureState,
  (state) => state.currentTaskId,
);
export const selectIsTaskDataLoaded = createSelector(
  selectTaskFeatureState,
  (state) => state.isDataLoaded,
);
export const selectCurrentTask = createSelector(selectTaskFeatureState, (s) =>
  s.currentTaskId ? (s.entities[s.currentTaskId] ?? null) : null,
);
export const selectLastCurrentTask = createSelector(selectTaskFeatureState, (s) =>
  s.lastCurrentTaskId ? (s.entities[s.lastCurrentTaskId] ?? null) : null,
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

export const selectAllTasks = createSelector(
  selectTaskFeatureState,
  (state: TaskState): Task[] => {
    const all = selectAll(state);
    // Only filter when undefined entities exist — otherwise return the original
    // memoized array from selectAll to avoid breaking NgRx selector memoization.
    if (all.some((task) => !task)) {
      devError('selectAllTasks: found undefined entities in task state');
      return all.filter((task): task is Task => !!task);
    }
    return all;
  },
);

export const selectAllTasksWithSubTasks = createSelector(
  selectAllTasks,
  mapSubTasksToTasks,
);

export const selectAllTasksInActiveProjects = createSelector(
  selectAllTasks,
  selectArchivedProjectIds,
  // Fast path returns same `tasks` ref when no projects are archived, keeping memoization stable.
  (tasks: Task[], archivedIds: Set<string>): Task[] =>
    archivedIds.size === 0
      ? tasks
      : tasks.filter((t) => !t.projectId || !archivedIds.has(t.projectId)),
);

export const selectMapOfAllTasksInActiveProjects = createSelector(
  selectAllTasksInActiveProjects,
  (activeTasks): Map<string, Task> => new Map(activeTasks.map((t) => [t.id, t])),
);

export const selectOverdueTasks = createSelector(
  selectAllTasksInActiveProjects,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (tasks, todayStr, startOfNextDayDiffMs): Task[] => {
    const today = dateStrToUtcDate(todayStr);
    today.setHours(0, 0, 0, 0);
    // The logical start of "today" is shifted by the offset
    const todayStartMs = today.getTime() + startOfNextDayDiffMs;
    return tasks.filter(
      (task): task is Task =>
        // Note: String comparison works correctly here because dueDay is in YYYY-MM-DD format
        // which is lexicographically sortable. This avoids timezone conversion issues.
        !!(
          (task.dueDay && isDBDateStr(task.dueDay) && task.dueDay < todayStr) ||
          (task.dueWithTime && task.dueWithTime < todayStartMs)
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

export const selectUndoneOverdueDeadlineTasks = createSelector(
  selectAllTasksInActiveProjects,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (tasks, todayStr, startOfNextDayDiffMs): Task[] => {
    if (!todayStr) return [];

    const today = dateStrToUtcDate(todayStr);
    today.setHours(0, 0, 0, 0);
    const todayStartMs = today.getTime() + startOfNextDayDiffMs;
    return tasks.filter(
      (task) =>
        !task.isDone &&
        !!(
          (task.deadlineDay &&
            isDBDateStr(task.deadlineDay) &&
            task.deadlineDay < todayStr) ||
          (task.deadlineWithTime && task.deadlineWithTime < todayStartMs)
        ),
    );
  },
);

export const selectUnplannedDeadlineTasksForToday = createSelector(
  selectAllTasksInActiveProjects,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (tasks, todayStr, startOfNextDayDiffMs): Task[] => {
    if (!todayStr) return [];

    const today = dateStrToUtcDate(todayStr);
    today.setHours(0, 0, 0, 0);
    const todayStartMs = today.getTime() + startOfNextDayDiffMs;
    const oneDayMs = 24 * 60 * 60 * 1000;
    const todayEndMs = todayStartMs + oneDayMs;

    return tasks.filter(
      (task): task is Task =>
        !task.isDone &&
        // Has a date-only deadline for today (time-specific deadlines are excluded
        // because they have their own reminder mechanism via deadlineRemindAt)
        task.deadlineDay === todayStr &&
        // Not already planned for today (dueDay or dueWithTime)
        task.dueDay !== todayStr &&
        !(
          task.dueWithTime &&
          task.dueWithTime >= todayStartMs &&
          task.dueWithTime < todayEndMs
        ),
    );
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
        // Pre-compute a chronological sort key so the comparator stays allocation-free
        // (parsing dueDay inside .sort() costs O(n log n) Date objects).
        // dueWithTime takes priority over dueDay; dueDay counts as start of that day.
        // Use dateStrToUtcDate to avoid timezone issues.
        let sortKey = 0;
        if (task.dueWithTime) {
          sortKey = task.dueWithTime;
        } else if (task.dueDay) {
          const startOfDueDay = dateStrToUtcDate(task.dueDay);
          startOfDueDay.setHours(0, 0, 0, 0);
          const startOfDueDayMs = startOfDueDay.getTime();
          // A calendar-invalid dueDay (e.g. 2024-02-30 passes the lexical isDBDateStr
          // guard in selectOverdueTasks) parses to NaN, which would poison the sort
          // comparator; pin such tasks to the front instead.
          sortKey = Number.isNaN(startOfDueDayMs) ? 0 : startOfDueDayMs;
        }
        return {
          task: mapSubTasksToTask(task as Task, taskState) as TaskWithSubTasks,
          sortKey,
        };
      })
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((t) => t.task);
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

// Uses virtual tag pattern to determine TODAY membership:
// A task is "in TODAY" if dueDay === today OR dueWithTime is for today
// PERF: Single-pass iteration instead of multiple passes over all tasks
export const selectLaterTodayTasksWithSubTasks = createSelector(
  selectAllTasksInActiveProjects,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (allTasks, todayStr, startOfNextDayDiffMs): TaskWithSubTasks[] => {
    if (!todayStr) {
      return [];
    }

    const now = Date.now();
    // End of "today" with offset: last ms of todayStr + offset
    const todayDate = dateStrToUtcDate(todayStr);
    todayDate.setHours(23, 59, 59, 999);
    const todayEndTime = todayDate.getTime() + startOfNextDayDiffMs;

    // Helper to check if task is "in TODAY" via virtual tag pattern
    // Priority: dueWithTime takes precedence over dueDay (mutual exclusivity)
    const isInToday = (task: Task): boolean => {
      if (task.dueWithTime) {
        return isTodayWithOffset(task.dueWithTime, todayStr, startOfNextDayDiffMs);
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
    const subtasksByParentId: Record<string, Task[]> = {};

    for (const task of allTasks) {
      if (task.parentId) {
        if (!subtasksByParentId.hasOwnProperty(task.parentId)) {
          subtasksByParentId[task.parentId] = [];
        }

        subtasksByParentId[task.parentId].push(task);
      }

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
      const taskWithSubTasks = {
        ...task,
        subTasks: subtasksByParentId[task.id] ?? [],
      } as TaskWithSubTasks;

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
  selectAllTasksInActiveProjects,
  (tasks: Task[]): string[] => tasks.filter((t) => t?.isDone).map((t) => t.id),
);

// DYNAMIC SELECTORS
// -----------------
export const selectTaskById = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { id: string }): Task => state.entities[props.id] as Task,
);

// intentionally unfiltered: calendar banner shows "Add as Task" when undefined
// filtering archived projects would cause duplicate task creation for events already
// linked to an archived-project task
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
      return { subTasks: [] } as unknown as TaskWithSubTasks;
    }
    return mapSubTasksToTask(task, state) as TaskWithSubTasks;
  },
);

export const selectMainTasksWithoutTag = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[], props: { tagId: string }): Task[] =>
    tasks.filter(
      (task) => !!task && !task.parentId && !task.tagIds.includes(props.tagId),
    ),
);

// intentionally unfiltered: filters out calendar events already linked to a task — must include
// archived projects or those events would reappear in the schedule as "not yet added"
export const selectAllCalendarTaskEventIds = createSelector(
  selectAllTasks,
  (tasks: Task[]): string[] =>
    tasks.filter(isCalendarIssueTask).map((t) => t.issueId as string),
);

// intentionally unfiltered: explicit design choice to poll ALL calendar tasks across all projects
// (including archived) — see poll-issue-updates.effects.ts comment "poll ALL calendar tasks"
export const selectAllCalendarIssueTasks = createSelector(
  selectAllTasks,
  (tasks: Task[]): Task[] => tasks.filter(isCalendarIssueTask),
);

export const selectTasksDueForDay = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[], props: { day: string }): TaskWithDueDay[] => {
    return tasks.filter(
      (task) => !!task && task.dueDay === props.day,
    ) as TaskWithDueDay[];
  },
);

export const selectTasksDueAndOverdueForDay = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[], props: { day: string }): TaskWithDueDay[] => {
    return tasks.filter(
      // Note: String comparison works correctly here because dueDay is in YYYY-MM-DD format
      // which is lexicographically sortable. This avoids timezone conversion issues that occur
      // when creating Date objects from date strings.
      (task) => !!task && typeof task.dueDay === 'string' && task.dueDay <= props.day,
    ) as TaskWithDueDay[];
  },
);

export const selectTasksWithDueTimeForRange = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[], props: { start: number; end: number }): TaskWithDueTime[] => {
    return tasks.filter(
      (task) =>
        !!task &&
        typeof task.dueWithTime === 'number' &&
        task.dueWithTime >= props.start &&
        task.dueWithTime <= props.end,
    ) as TaskWithDueTime[];
  },
);

export const selectAllTasksWithDueTime = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[]): TaskWithDueTime[] => {
    return tasks.filter(
      (task): task is TaskWithDueTime => !!task && typeof task.dueWithTime === 'number',
    );
  },
);

export const selectAllTasksWithDueTimeSorted = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[]): TaskWithDueTime[] => {
    return tasks
      .filter(
        (task): task is TaskWithDueTime => !!task && typeof task.dueWithTime === 'number',
      )
      .sort((a, b) => a.dueWithTime - b.dueWithTime);
  },
);

export const selectTimeConflictTaskIds = createSelector(
  selectAllTasksWithDueTimeSorted,
  getTimeConflictTaskIds,
);

export const selectAllTasksWithReminder = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[]): TaskWithReminder[] => {
    return tasks.filter(
      (task) => task && typeof task.remindAt === 'number' && !task.isDone,
    ) as TaskWithReminder[];
  },
);

export const selectAllTasksWithDeadlineReminder = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[]): Task[] => {
    return tasks.filter(
      (task) => task && typeof task.deadlineRemindAt === 'number' && !task.isDone,
    );
  },
);

export const selectAllUndoneTasksWithDeadlineSorted = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[]): Task[] => {
    return tasks
      .filter(
        (task) =>
          task &&
          !task.isDone &&
          (task.deadlineDay || typeof task.deadlineWithTime === 'number'),
      )
      .sort((a, b) => {
        const aTime =
          typeof a.deadlineWithTime === 'number'
            ? a.deadlineWithTime
            : dateStrToUtcDate(a.deadlineDay!).getTime();
        const bTime =
          typeof b.deadlineWithTime === 'number'
            ? b.deadlineWithTime
            : dateStrToUtcDate(b.deadlineDay!).getTime();
        return aTime - bTime;
      });
  },
);

export const selectUndoneTasksWithDueDayNoReminder = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[]): Task[] => {
    return tasks.filter(
      (task) =>
        task &&
        !task.isDone &&
        typeof task.dueDay === 'string' &&
        task.dueDay.length > 0 &&
        typeof task.remindAt !== 'number',
    );
  },
);

export const selectTasksWithDueTimeUntil = createSelector(
  selectAllTasks,
  (tasks: Task[], props: { end: number }): TaskWithDueTime[] => {
    return tasks.filter(
      (task) =>
        !!task && typeof task.dueWithTime === 'number' && task.dueWithTime <= props.end,
    ) as TaskWithDueTime[];
  },
);

// REPEATABLE TASKS
// ----------------
export const selectAllRepeatableTaskWithSubTasks = createSelector(
  selectAllTasksWithSubTasks,
  (tasks: TaskWithSubTasks[]) => {
    return tasks.filter((task) => !!task && !!task.repeatCfgId);
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
    return tasks.filter((task) => !!task && task.repeatCfgId === props.repeatCfgId);
  },
);

export const selectTasksByTag = createSelector(
  selectAllTasksWithSubTasks,
  (tasks: TaskWithSubTasks[], props: { tagId: string }) => {
    return tasks.filter((task) => !!task && task.tagIds.indexOf(props.tagId) !== -1);
  },
);

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const selectAllTaskIssueIdsForIssueProvider = (issueProvider: IssueProvider) => {
  return createSelector(selectAllTasks, (tasks: Task[]): string[] => {
    return tasks
      .filter((task) => !!task && task.issueProviderId === issueProvider.id)
      .map((t) => t.issueId as string);
  });
};

export const selectAllUndoneTasksWithDueDay = createSelector(
  selectAllTasksInActiveProjects,
  (tasks): TaskWithDueDay[] => {
    const tasksWithDueDay = tasks.filter(
      (t): t is TaskWithDueDay => !!t.dueDay && !t.isDone,
    );
    // Sort by dueDay (YYYY-MM-DD format is lexicographically sortable)
    return tasksWithDueDay.sort((a, b) => a.dueDay.localeCompare(b.dueDay));
  },
);

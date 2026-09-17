import { createSelector } from '@ngrx/store';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import {
  selectProjectFeatureState,
  selectUnarchivedVisibleProjects,
} from '../../project/store/project.selectors';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../../root-store/app-state/app-state.selectors';
import {
  AndroidWidgetData,
  AndroidWidgetProject,
  AndroidWidgetTask,
} from '../android-widget.model';

const MAX_WIDGET_OPEN_TASKS = 20;
// Keep recent completed candidates so native can preserve locally tapped grace rows
// without allowing completed tasks to consume the 20 open-task slots.
const MAX_WIDGET_DONE_TASKS = 20;

/**
 * The instant the logical day `dayStr` stops being "today": local midnight after it,
 * plus the user's start-of-next-day offset. This is the whole of what native needs to
 * judge staleness (`now >= validUntil`), so the app's day rules never get mirrored
 * into Kotlin/Swift — see AndroidWidgetData.validUntil.
 *
 * Pure in its arguments — deliberately no Date.now(), so the selector stays
 * replay-deterministic. `new Date(y, m, d)` normalizes month/year overflow and lands
 * on LOCAL midnight, which keeps the boundary right across DST where a naive
 * +24h would drift by an hour.
 */
export const getWidgetValidUntil = (
  dayStr: string,
  startOfNextDayDiffMs: number,
): number => {
  const [year, month, day] = dayStr.split('-').map(Number);
  return new Date(year, month - 1, day + 1).getTime() + startOfNextDayDiffMs;
};

/**
 * Projects Today's tasks and the selectable active project lists into the exact
 * `widget_data` blob shape. Native only chooses between these projections; it never
 * recreates Today membership or project ordering.
 */
export const selectAndroidWidgetData = createSelector(
  selectTodayTaskIds,
  selectTaskEntities,
  selectProjectFeatureState,
  selectUnarchivedVisibleProjects,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (
    todayTaskIds,
    taskEntities,
    projectState,
    visibleProjects,
    dayStr,
    startOfNextDayDiffMs,
  ): AndroidWidgetData => {
    const tasks: AndroidWidgetTask[] = [];
    const projectColors: { [projectId: string]: string } = {};
    const toWidgetTask = (taskId: string): AndroidWidgetTask | null => {
      const task = taskEntities[taskId];
      if (!task) {
        return null;
      }
      const widgetTask: AndroidWidgetTask = {
        id: task.id,
        title: task.title,
        isDone: task.isDone,
      };
      if (task.projectId) {
        widgetTask.projectId = task.projectId;
        const color = projectState.entities[task.projectId]?.theme?.primary;
        if (color) {
          projectColors[task.projectId] = color;
        }
      }
      return widgetTask;
    };

    for (const taskId of todayTaskIds) {
      const widgetTask = toWidgetTask(taskId);
      if (widgetTask) {
        tasks.push(widgetTask);
      }
    }

    const projects: AndroidWidgetProject[] = visibleProjects.map((project) => {
      const projectTasks: AndroidWidgetTask[] = [];
      const orderedTaskIds = [
        ...(project.taskIds || []),
        ...(project.backlogTaskIds || []),
      ];
      const openTaskOrders: number[] = [];
      const doneTaskCandidates: Array<{ order: number; doneOn?: number }> = [];

      for (const [order, taskId] of orderedTaskIds.entries()) {
        const task = taskEntities[taskId];
        if (!task) {
          continue;
        }
        if (!task.isDone) {
          if (openTaskOrders.length < MAX_WIDGET_OPEN_TASKS) {
            openTaskOrders.push(order);
          }
          continue;
        }

        doneTaskCandidates.push({ order, doneOn: task.doneOn });
        doneTaskCandidates.sort((a, b) => {
          // Missing timestamps are older than any timestamped completion. For ties,
          // retain the active-list-then-backlog order deterministically.
          const aDoneOn = a.doneOn ?? Number.NEGATIVE_INFINITY;
          const bDoneOn = b.doneOn ?? Number.NEGATIVE_INFINITY;
          return bDoneOn - aDoneOn || a.order - b.order;
        });
        if (doneTaskCandidates.length > MAX_WIDGET_DONE_TASKS) {
          doneTaskCandidates.pop();
        }
      }

      const selectedTaskOrders = new Set([
        ...openTaskOrders,
        ...doneTaskCandidates.map(({ order }) => order),
      ]);
      // Keep the established project-wide order: active list first, then backlog.
      for (const [order, taskId] of orderedTaskIds.entries()) {
        if (selectedTaskOrders.has(order)) {
          const widgetTask = toWidgetTask(taskId);
          if (widgetTask) {
            projectTasks.push(widgetTask);
          }
        }
      }
      return { id: project.id, title: project.title, tasks: projectTasks };
    });

    return {
      v: 1,
      dayStr,
      validUntil: getWidgetValidUntil(dayStr, startOfNextDayDiffMs),
      tasks,
      projectColors,
      projects,
    };
  },
);

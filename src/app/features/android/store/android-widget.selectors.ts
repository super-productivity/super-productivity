import { createSelector } from '@ngrx/store';
import { Dictionary } from '@ngrx/entity';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import {
  selectCurrentTaskId,
  selectTaskEntities,
} from '../../tasks/store/task.selectors';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../../root-store/app-state/app-state.selectors';
import {
  AndroidWidgetCurrentTask,
  AndroidWidgetData,
  AndroidWidgetTask,
} from '../android-widget.model';
import { Task } from '../../tasks/task.model';
import { getDeviceLabel } from '../../tracking-presence/get-device-label.util';
import { RemoteSessionView } from '../../tracking-presence/tracking-presence.model';

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
 * The local device's own current task, in widget-blob shape, or null when nothing
 * is being tracked locally. Exported and pure so the local half of the
 * `currentTask` contract is unit-testable without a store.
 */
export const buildLocalCurrentTask = (
  currentTaskId: string | null,
  taskEntities: Dictionary<Task>,
): AndroidWidgetCurrentTask | null => {
  if (!currentTaskId) {
    return null;
  }
  const task = taskEntities[currentTaskId];
  if (!task) {
    return null;
  }
  const currentTask: AndroidWidgetCurrentTask = {
    id: task.id,
    title: task.title,
    deviceLabel: getDeviceLabel(),
    isLocal: true,
  };
  if (task.projectId) {
    currentTask.projectId = task.projectId;
  }
  return currentTask;
};

/**
 * Fallback for when nothing is tracked locally: the last-known remote
 * tracking-presence session (SuperSync only), resolved against known task
 * entities. `view` is read from TrackingPresenceService — a service signal, not
 * store state — so this is called from WidgetDataService rather than composed
 * into the createSelector below. Degrades to null (never a title-less stub) when
 * the remote task isn't known locally, is stale, or nothing is tracking.
 */
export const resolveRemoteCurrentTask = (
  view: RemoteSessionView | null,
  taskEntities: Dictionary<Task>,
): AndroidWidgetCurrentTask | null => {
  if (!view || view.isStale || view.session.payload.state !== 'tracking') {
    return null;
  }
  const remoteTaskId = view.session.payload.taskId;
  const task = remoteTaskId ? taskEntities[remoteTaskId] : undefined;
  if (!task) {
    return null;
  }
  const currentTask: AndroidWidgetCurrentTask = {
    id: task.id,
    title: task.title,
    deviceLabel: view.session.payload.deviceLabel,
    isLocal: false,
  };
  if (task.projectId) {
    currentTask.projectId = task.projectId;
  }
  return currentTask;
};

/**
 * Projects today's tasks into the exact `widget_data` blob shape, so downstream
 * consumers get referential stability from the selector memoization and cheap
 * change detection via JSON comparison in WidgetDataService.
 */
export const selectAndroidWidgetData = createSelector(
  selectTodayTaskIds,
  selectTaskEntities,
  selectProjectFeatureState,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  selectCurrentTaskId,
  (
    todayTaskIds,
    taskEntities,
    projectState,
    dayStr,
    startOfNextDayDiffMs,
    currentTaskId,
  ): AndroidWidgetData => {
    const tasks: AndroidWidgetTask[] = [];
    const projectColors: { [projectId: string]: string } = {};

    for (const taskId of todayTaskIds) {
      const task = taskEntities[taskId];
      if (!task) {
        continue;
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
      tasks.push(widgetTask);
    }

    return {
      v: 1,
      dayStr,
      validUntil: getWidgetValidUntil(dayStr, startOfNextDayDiffMs),
      tasks,
      projectColors,
      currentTask: buildLocalCurrentTask(currentTaskId, taskEntities),
    };
  },
);

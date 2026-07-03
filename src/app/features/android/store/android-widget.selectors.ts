import { createSelector } from '@ngrx/store';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { AndroidWidgetData, AndroidWidgetTask } from '../android-widget.model';

/**
 * Projects today's tasks into the exact `widget_data` blob shape, so downstream
 * consumers get referential stability from the selector memoization and cheap
 * change detection via JSON comparison in WidgetDataService.
 */
export const selectAndroidWidgetData = createSelector(
  selectTodayTaskIds,
  selectTaskEntities,
  selectProjectFeatureState,
  (todayTaskIds, taskEntities, projectState): AndroidWidgetData => {
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

    return { v: 1, tasks, projectColors };
  },
);

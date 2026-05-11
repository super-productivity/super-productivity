import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { first } from 'rxjs/operators';
import { selectTodayTaskIds } from '../work-context/store/work-context.selectors';
import { selectTaskFeatureState } from '../tasks/store/task.selectors';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import { androidInterface } from './android-interface';
import { DroidLog } from '../../core/log';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';

@Injectable({ providedIn: 'root' })
export class WidgetDataService {
  private _store = inject(Store);
  private _hydrationState = inject(HydrationStateService);

  async serialize(): Promise<void> {
    if (this._hydrationState.isApplyingRemoteOps()) {
      return;
    }

    const todayTaskIds = await this._store
      .select(selectTodayTaskIds)
      .pipe(first())
      .toPromise();
    const taskState = await this._store
      .select(selectTaskFeatureState)
      .pipe(first())
      .toPromise();
    const projectState = await this._store
      .select(selectProjectFeatureState)
      .pipe(first())
      .toPromise();

    if (!todayTaskIds || !taskState || !projectState) {
      return;
    }

    const tasks: {
      id: string;
      title: string;
      isDone: boolean;
      projectId: string | null;
    }[] = [];
    const projectIds = new Set<string>();

    for (const taskId of todayTaskIds) {
      const task = taskState.entities[taskId];
      if (!task) continue;
      tasks.push({
        id: task.id,
        title: task.title,
        isDone: task.isDone,
        projectId: task.projectId || null,
      });
      if (task.projectId) {
        projectIds.add(task.projectId);
      }
    }

    const projects: Record<string, { title: string; color: string | null }> = {};
    for (const pId of projectIds) {
      const project = projectState.entities[pId];
      if (project) {
        projects[pId] = {
          title: project.title,
          color: project.theme?.primary || null,
        };
      }
    }

    const blob = JSON.stringify({
      v: 1,
      ts: Date.now(),
      tasks,
      projects,
    });

    try {
      await androidInterface.saveToDbWrapped('widget_data', blob);
      androidInterface.updateWidget?.();
    } catch (e) {
      DroidLog.err('Failed to push widget data', e);
    }
  }
}

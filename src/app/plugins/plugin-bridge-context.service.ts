import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { DateAdapter } from '@angular/material/core';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { ActiveWorkContext, PluginDayContext } from './plugin-api.model';
import { WorkContextService } from '../features/work-context/work-context.service';
import { TaskService } from '../features/tasks/task.service';
import {
  selectTaskById,
  selectTaskEntities,
} from '../features/tasks/store/task.selectors';
import { DateService } from '../core/date/date.service';
import { T } from '../t.const';
import { toActiveWorkContext } from './util/active-work-context.util';
import { pluginAssert } from './plugin-bridge-asserts';

// A type literal, not an interface: the iframe bridge indexes bound methods
// as Record<string, unknown>, which interfaces are not assignable to.
export type PluginContextBoundMethods = {
  getActiveWorkContext: () => Promise<ActiveWorkContext | null>;
  getDayContext: () => Promise<PluginDayContext>;
  startTracking: (taskId: string) => Promise<void>;
  stopTracking: () => Promise<void>;
};

/**
 * Plugin API methods about "where and when the user is": the open work
 * context, the logical day and time tracking. Split from PluginBridgeService,
 * which is at its size cap.
 */
@Injectable({ providedIn: 'root' })
export class PluginBridgeContextService {
  private _store = inject(Store);
  private _workContextService = inject(WorkContextService);
  private _taskService = inject(TaskService);
  private _dateService = inject(DateService);
  // Resolved on use: test beds that build the bridge do not all provide one.
  private _injector = inject(Injector);
  private _translateService = inject(TranslateService);

  createBoundMethods(): PluginContextBoundMethods {
    return {
      getActiveWorkContext: () => this.getActiveWorkContext(),
      getDayContext: () => this.getDayContext(),
      startTracking: (taskId: string) => this.startTracking(taskId),
      stopTracking: () => this.stopTracking(),
    };
  }

  /**
   * Snapshot of the active work context for plugins. A context is always
   * active once the app has loaded — it stays set even on non-work-view
   * routes — so this normally resolves to that context. It resolves to
   * null only if the initial data load has not completed within the
   * timeout (e.g. a plugin calling this very early from its init hook),
   * which is preferable to a Promise that never resolves.
   */
  async getActiveWorkContext(): Promise<ActiveWorkContext | null> {
    try {
      const ctx = await firstValueFrom(
        this._workContextService.activeWorkContext$.pipe(
          // 10s is well past normal data-load time but still bounded so
          // a plugin can fall back to other behaviour instead of hanging.
          timeout({ first: 10_000 }),
        ),
      );
      return toActiveWorkContext(ctx);
    } catch {
      return null;
    }
  }

  async getDayContext(): Promise<PluginDayContext> {
    return {
      todayStr: this._dateService.todayStr(),
      startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
      firstDayOfWeek: this._injector.get(DateAdapter).getFirstDayOfWeek(),
    };
  }

  async startTracking(taskId: string): Promise<void> {
    pluginAssert.string(taskId);
    const task = await firstValueFrom(this._store.select(selectTaskById, { id: taskId }));
    if (!task) {
      throw new Error(
        this._translateService.instant(T.PLUGINS.TASK_NOT_FOUND, { taskId }),
      );
    }
    if (task.isDone) {
      throw new Error('A done task cannot be tracked. Mark it as not done first.');
    }
    // setCurrentTask falls back to the first subtask, done or not, when none is open
    if (task.subTaskIds.length) {
      const entities = await firstValueFrom(this._store.select(selectTaskEntities));
      if (!task.subTaskIds.some((id) => entities[id] && !entities[id].isDone)) {
        throw new Error('All subtasks are done. Mark one as not done first.');
      }
    }
    this._taskService.setCurrentId(taskId);
  }

  async stopTracking(): Promise<void> {
    this._taskService.setCurrentId(null);
  }
}

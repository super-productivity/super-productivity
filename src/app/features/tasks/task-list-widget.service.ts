import { effect, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { GlobalThemeService } from '../../core/theme/global-theme.service';
import { TaskWidgetSettingsService } from '../config/task-widget-settings.service';
import { selectAllTasks } from './store/task.selectors';
import { selectAllProjects } from '../project/store/project.selectors';
import { selectTodayTaskIds } from '../work-context/store/work-context.selectors';
import { getTaskListWidgetTasks } from './task-list-widget-tasks';
import { T } from '../../t.const';
import { TaskListWidgetContent } from '../../../../electron/shared-with-frontend/task-list-widget.model';

@Injectable({ providedIn: 'root' })
export class TaskListWidgetService {
  private readonly _store = inject(Store);
  private readonly _settings = inject(TaskWidgetSettingsService);
  private readonly _theme = inject(GlobalThemeService);
  private readonly _translate = inject(TranslateService);
  private readonly _tasks = this._store.selectSignal(selectAllTasks);
  private readonly _projects = this._store.selectSignal(selectAllProjects);
  private readonly _todayIds = this._store.selectSignal(selectTodayTaskIds);
  private readonly _labels = toSignal(
    this._translate.stream(Object.values(T.GCF.TASK_WIDGET.LIST)),
  );
  private _lastContent = '';

  constructor() {
    effect(() => {
      // AppComponent only initializes this service on Electron.
      if (!window.ea) return;
      if (!this._settings.settings().isTaskListEnabled) {
        this._lastContent = '';
        return;
      }
      const labels = this._labels();
      if (!labels) return;
      const keys = T.GCF.TASK_WIDGET.LIST;
      const content: TaskListWidgetContent = {
        tasks: getTaskListWidgetTasks(
          this._tasks(),
          this._projects(),
          this._todayIds(),
          this._settings.settings().taskListFilter,
        ),
        isDark: this._theme.isDarkTheme(),
        labels: {
          all: labels[keys.ALL],
          today: labels[keys.TODAY],
          empty: labels[keys.EMPTY],
          collapse: labels[keys.COLLAPSE],
          expand: labels[keys.EXPAND],
          hide: labels[keys.HIDE],
          open: labels[keys.OPEN],
        },
      };
      // Tracking ticks change task entities, but not this list's displayed fields.
      const serialized = JSON.stringify(content);
      if (serialized !== this._lastContent) {
        window.ea.updateTaskListWidget(content);
        this._lastContent = serialized;
      }
    });
  }
}

import { inject, Injectable } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { createEffect, ofType } from '@ngrx/effects';
import { createSelector, select, Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { merge, Subject } from 'rxjs';
import {
  debounceTime,
  filter,
  take,
  tap,
  throttleTime,
  withLatestFrom,
} from 'rxjs/operators';
import { IPC } from '../../../../../electron/shared-with-frontend/ipc-events.const';
import { TaskWidgetTheme } from '../../../../../electron/shared-with-frontend/task-widget-view.model';
import { CustomThemeService } from '../../../core/theme/custom-theme.service';
import { GlobalThemeService } from '../../../core/theme/global-theme.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskWidgetSettingsService } from '../../config/task-widget-settings.service';
import {
  cancelFocusSession,
  completeFocusSession,
  pauseFocusSession,
  startFocusSession,
  tick,
  unPauseFocusSession,
} from '../../focus-mode/store/focus-mode.actions';
import { selectTimer } from '../../focus-mode/store/focus-mode.selectors';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { WorkContextService } from '../../work-context/work-context.service';
import { TimeTrackingActions } from '../../time-tracking/store/time-tracking.actions';
import { TaskService } from '../task.service';
import { buildTaskWidgetView } from '../util/build-task-widget-view';
import { readTaskWidgetTheme } from '../util/read-task-widget-theme';
import { setCurrentTask, unsetCurrentTask } from './task.actions';
import { selectCurrentTask, selectLastCurrentTask } from './task.selectors';

// Pausing clears the current task but keeps the last one, which is what the
// widget shows and what its play button resumes.
const selectTaskWidgetTask = createSelector(
  selectCurrentTask,
  selectLastCurrentTask,
  (current, last) => ({
    task: current ?? (last && !last.isDone ? last : null),
    isTracking: !!current,
  }),
);

/**
 * Prepares what the desktop task widget draws. Read-only apart from the widget's
 * explicit "mark done", so nothing here reacts to remote or replayed state.
 */
@Injectable()
export class TaskWidgetEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _store$ = inject<Store<any>>(Store);
  private _taskService = inject(TaskService);
  private _globalThemeService = inject(GlobalThemeService);
  private _customThemeService = inject(CustomThemeService);
  private _workContextService = inject(WorkContextService);
  private _translateService = inject(TranslateService);
  private _taskWidgetSettingsService = inject(TaskWidgetSettingsService);

  private _viewRequest$ = new Subject<void>();
  // Theme changes reach the page's CSS a moment later, so read the colors after.
  private _themeChange$ = merge(
    toObservable(this._globalThemeService.isDarkTheme),
    toObservable(this._customThemeService.appliedThemeVersion),
    this._workContextService.currentTheme$,
  ).pipe(debounceTime(150));
  private _shownTask$ = this._store$.pipe(select(selectTaskWidgetTask));
  // Reading the theme makes a canvas, and the view goes out up to twice a second,
  // so the colors are read again only when they can have changed.
  private _theme: TaskWidgetTheme | null = null;

  constructor() {
    window.ea.on(IPC.REQUEST_CURRENT_TASK_FOR_TASK_WIDGET, () => {
      this._viewRequest$.next();
    });

    window.ea.on(IPC.TASK_WIDGET_MARK_DONE, () => {
      this._shownTask$.pipe(take(1)).subscribe(({ task }) => {
        if (task) {
          this._taskService.setDone(task.id);
        }
      });
    });
  }

  updateTaskWidgetView$ = createEffect(
    () =>
      merge(
        this._actions$.pipe(
          ofType(
            setCurrentTask,
            unsetCurrentTask,
            TimeTrackingActions.addTimeSpent,
            TaskSharedActions.updateTask,
            TaskSharedActions.deleteTask,
            startFocusSession,
            cancelFocusSession,
            pauseFocusSession,
            unPauseFocusSession,
            completeFocusSession,
            tick,
          ),
        ),
        merge(this._viewRequest$, this._themeChange$).pipe(
          tap(() => (this._theme = null)),
        ),
        this._translateService.onLangChange,
      ).pipe(
        filter(() => this._taskWidgetSettingsService.settings().isEnabled),
        // addTimeSpent and tick both fire every second during a focus session.
        throttleTime(500, undefined, { leading: true, trailing: true }),
        withLatestFrom(
          this._shownTask$,
          this._store$.pipe(select(selectTimer)),
          this._store$.pipe(select(selectProjectFeatureState)),
        ),
        tap(([, { task, isTracking }, timer, projectState]) => {
          const project = task?.projectId ? projectState.entities[task.projectId] : null;
          window.ea.updateTaskWidgetView(
            buildTaskWidgetView({
              task,
              isTracking,
              projectTitle: project?.title ?? '',
              projectColor: project?.theme.primary,
              focusTimer: timer.purpose === 'work' ? timer : null,
              isDark: this._globalThemeService.isDarkTheme(),
              theme: this._getTheme(),
              translate: (key, params) => this._translateService.instant(key, params),
            }),
          );
        }),
      ),
    { dispatch: false },
  );

  private _getTheme(): TaskWidgetTheme {
    this._theme = this._theme ?? readTaskWidgetTheme();
    return this._theme;
  }
}

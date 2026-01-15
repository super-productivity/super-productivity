import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { filter, map, tap, withLatestFrom, startWith } from 'rxjs/operators';
import { skipWhileApplyingRemoteOps } from '../../../util/skip-during-sync.operator';
import { setSelectedTask } from '../../tasks/store/task.actions';
import { TaskService } from '../../tasks/task.service';
import { BannerId } from '../../../core/banner/banner.model';
import { BannerService } from '../../../core/banner/banner.service';
import { Observable } from 'rxjs';
import { setActiveWorkContext } from './work-context.actions';
import { NavigationEnd, Router } from '@angular/router';
import { TODAY_TAG } from '../../tag/tag.const';
import { WorkContextType } from '../work-context.model';
import { WorkContextService } from '../work-context.service';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { Store } from '@ngrx/store';
import { selectActiveContextTypeAndId } from './work-context.selectors';
import { Log } from '../../../core/log';

@Injectable()
export class WorkContextEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _store$ = inject(Store);
  private _taskService = inject(TaskService);
  private _bannerService = inject(BannerService);
  private _router = inject(Router);
  private _workContextService = inject(WorkContextService);

  dismissContextScopeBannersOnContextChange: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(setActiveWorkContext),
        tap(() => {
          this._bannerService.dismiss(BannerId.JiraUnblock);
        }),
      ),
    { dispatch: false },
  );

  unselectSelectedTask$: Observable<unknown> = createEffect(() =>
    this._actions$.pipe(
      ofType(setActiveWorkContext),
      withLatestFrom(this._taskService.isTaskDataLoaded$),
      filter(([, isDataLoaded]) => isDataLoaded),
      map(() => setSelectedTask({ id: null })),
    ),
  );

  switchToTodayContextOnSpecialRoutes$: Observable<unknown> = createEffect(() =>
    this._router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this._router.url), // Handle initial page load
      // Prevent dispatching setActiveWorkContext during sync - startWith() emits
      // immediately on subscription which could interfere with sync state hydration
      skipWhileApplyingRemoteOps(),
      filter(
        (url) =>
          !!url.match(/(schedule)$/) ||
          !!url.match(/(planner)$/) ||
          !!url.match(/(boards)$/),
      ),
      withLatestFrom(this._workContextService.activeWorkContextTypeAndId$),
      filter(
        ([, currentContext]) =>
          !currentContext || currentContext.activeId !== TODAY_TAG.id,
      ),
      map(() =>
        setActiveWorkContext({
          activeId: TODAY_TAG.id,
          activeType: WorkContextType.TAG,
        }),
      ),
    ),
  );

  /**
   * Validates the active work context after data is reloaded (e.g., from sync).
   * If the active project or tag no longer exists in the new data, redirects to TODAY tag.
   * Fixes: https://github.com/super-productivity/super-productivity/issues/5859
   */
  validateContextAfterDataLoad$: Observable<unknown> = createEffect(() =>
    this._actions$.pipe(
      ofType(loadAllData),
      withLatestFrom(this._store$.select(selectActiveContextTypeAndId)),
      filter(([{ appDataComplete }, { activeType, activeId }]) => {
        if (activeType === WorkContextType.PROJECT) {
          const exists = !!appDataComplete.project?.entities?.[activeId];
          if (!exists) {
            Log.warn(
              `Active project ${activeId} not found after data load, redirecting to TODAY`,
            );
          }
          return !exists;
        }
        if (activeType === WorkContextType.TAG && activeId !== TODAY_TAG.id) {
          const exists = !!appDataComplete.tag?.entities?.[activeId];
          if (!exists) {
            Log.warn(
              `Active tag ${activeId} not found after data load, redirecting to TODAY`,
            );
          }
          return !exists;
        }
        return false;
      }),
      map(() =>
        setActiveWorkContext({
          activeId: TODAY_TAG.id,
          activeType: WorkContextType.TAG,
        }),
      ),
    ),
  );
}

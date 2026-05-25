import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { createEffect, ofType } from '@ngrx/effects';
import { EMPTY, Observable, from } from 'rxjs';
import { catchError, concatMap, filter, map, mergeMap, first, tap } from 'rxjs/operators';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskService } from '../../tasks/task.service';
import { Task } from '../../tasks/task.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../../planner/store/planner.actions';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginHttp } from '../../../plugins/issue-provider/plugin-issue-provider.model';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';
import { IssueProviderPluginType, isPluginIssueProvider } from '../../issue/issue.model';
import { IssueProviderActions } from '../../issue/store/issue-provider.actions';
import { SnackService } from '../../../core/snack/snack.service';
import { getErrorTxt } from '../../../util/get-error-text';
import { TimeBlockDeleteSidecarService } from './time-block-delete-sidecar.service';
import { IssueProviderPluginDefinition } from '../../../plugins/issue-provider/plugin-issue-provider.model';
import { selectAllTasksWithDueTimeSorted } from '../../tasks/store/task.selectors';
import { T } from '../../../t.const';
import { Log } from '../../../core/log';

interface TimeBlockContext {
  providerId: string;
  definition: IssueProviderPluginDefinition;
  config: Record<string, unknown>;
  http: PluginHttp;
}

@Injectable()
export class TimeBlockSyncEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private readonly _pluginHttpService = inject(PluginHttpService);
  private readonly _snackService = inject(SnackService);
  private readonly _deletesSidecar = inject(TimeBlockDeleteSidecarService);
  private readonly _backfilledProviderIds = new Set<string>();

  /**
   * When a task is scheduled or rescheduled, create/update the time-block event.
   */
  createOrUpdateOnSchedule$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(
          TaskSharedActions.scheduleTaskWithTime,
          TaskSharedActions.reScheduleTaskWithTime,
          TaskSharedActions.applyShortSyntax,
        ),
        map((action) => {
          if (action.type === TaskSharedActions.applyShortSyntax.type) {
            const a = action as ReturnType<typeof TaskSharedActions.applyShortSyntax>;
            if (!a.schedulingInfo?.dueWithTime) return null;
            return { taskId: a.task.id, dueWithTime: a.schedulingInfo.dueWithTime };
          }
          const a = action as ReturnType<typeof TaskSharedActions.scheduleTaskWithTime>;
          return { taskId: a.task.id, dueWithTime: a.dueWithTime };
        }),
        filter((v): v is { taskId: string; dueWithTime: number } => v !== null),
        concatMap(({ taskId, dueWithTime }) =>
          this._withTimeBlockContext$((ctx) =>
            this._taskService
              .getByIdOnce$(taskId)
              .pipe(
                concatMap((task) =>
                  from(this._upsertEvent(ctx, task, dueWithTime)).pipe(
                    catchError((err) => this._handleError(err)),
                  ),
                ),
              ),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When title or timeEstimate changes on a scheduled task, update the event.
   */
  updateOnFieldChange$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter((action) => {
          const changes = action.task.changes;
          return 'title' in changes || 'timeEstimate' in changes || 'isDone' in changes;
        }),
        concatMap((action) =>
          this._taskService.getByIdOnce$(action.task.id as string).pipe(
            filter((task) => !!task?.dueWithTime),
            concatMap((task) =>
              this._withTimeBlockContext$((ctx) =>
                from(this._upsertEvent(ctx, task, task.dueWithTime!)).pipe(
                  catchError((err) => this._handleError(err)),
                ),
              ),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When a task is unscheduled or transferred (which clears dueWithTime),
   * delete the time-block event.
   */
  deleteOnUnschedule$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.unscheduleTask, PlannerActions.transferTask),
        map((action): string | null => {
          if (action.type === TaskSharedActions.unscheduleTask.type) {
            return (action as ReturnType<typeof TaskSharedActions.unscheduleTask>).id;
          }
          // transferTask clears dueWithTime in the reducer
          const a = action as ReturnType<typeof PlannerActions.transferTask>;
          return a.task.dueWithTime ? a.task.id : null;
        }),
        filter((taskId): taskId is string => taskId !== null),
        concatMap((taskId) =>
          this._withTimeBlockContext$((ctx) =>
            from(
              ctx.definition.timeBlock!.deleteEvent(taskId, ctx.config, ctx.http),
            ).pipe(catchError((err) => this._handleError(err))),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When a single task is deleted, delete its time-block event.
   */
  deleteOnTaskDelete$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.deleteTask),
        filter(({ task }) => !!task.dueWithTime),
        concatMap(({ task }) =>
          this._withTimeBlockContext$((ctx) =>
            from(
              ctx.definition.timeBlock!.deleteEvent(task.id, ctx.config, ctx.http),
            ).pipe(catchError((err) => this._handleError(err))),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When tasks are bulk-deleted, delete their time-block events.
   * Task IDs with dueWithTime are captured by the sidecar before dispatch.
   */
  deleteOnBulkTaskDelete$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.deleteTasks),
        concatMap(() => {
          const taskIds = this._deletesSidecar.consume();
          if (!taskIds.length) return EMPTY;
          return this._withTimeBlockContext$((ctx) =>
            from(taskIds).pipe(
              concatMap((taskId) =>
                from(
                  ctx.definition.timeBlock!.deleteEvent(taskId, ctx.config, ctx.http),
                ).pipe(catchError((err) => this._handleError(err))),
              ),
            ),
          );
        }),
      ),
    { dispatch: false },
  );

  /**
   * When a provider config is updated and isAutoTimeBlock is now enabled,
   * backfill all existing tasks with dueWithTime within the sync range.
   * This ensures existing scheduled tasks appear as calendar events immediately.
   */
  backfillOnAutoTimeBlockEnabled$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(IssueProviderActions.updateIssueProvider),
        filter((action) => 'pluginConfig' in (action.issueProvider.changes ?? {})),
        concatMap((action) =>
          this._withTimeBlockContext$((ctx) => {
            if (this._backfilledProviderIds.has(ctx.providerId)) return EMPTY;

            const syncRangeWeeks =
              parseInt(
                (ctx.config as Record<string, unknown>)['syncRangeWeeks'] as string,
                10,
              ) || 2;
            const now = Date.now();
            const rangeMs = syncRangeWeeks * 7 * 24 * 60 * 60 * 1000;
            const rangeEnd = now + rangeMs;

            return this._store.select(selectAllTasksWithDueTimeSorted).pipe(
              first(),
              concatMap((tasks) => {
                const tasksInRange = tasks.filter(
                  (t) => t.dueWithTime >= now && t.dueWithTime <= rangeEnd,
                );
                if (!tasksInRange.length) {
                  this._backfilledProviderIds.add(ctx.providerId);
                  return EMPTY;
                }
                Log.log(
                  `[TimeBlock] Backfilling ${tasksInRange.length} existing scheduled tasks`,
                );
                return from(tasksInRange).pipe(
                  mergeMap(
                    (task) =>
                      from(this._upsertEvent(ctx, task, task.dueWithTime)).pipe(
                        catchError((err) => this._handleError(err)),
                      ),
                    3,
                  ),
                  // Mark as backfilled only after all upserts complete successfully
                  tap({
                    complete: () => this._backfilledProviderIds.add(ctx.providerId),
                  }),
                );
              }),
            );
          }, action.issueProvider.id as string),
        ),
      ),
    { dispatch: false },
  );

  // --- Helpers ---

  /**
   * Find an enabled plugin provider with timeBlock support and
   * isAutoTimeBlock config, create an authenticated HTTP helper, and run the callback.
   * When filterProviderId is given, only that provider is considered.
   * Returns EMPTY if no matching provider is configured.
   */
  private _withTimeBlockContext$<T>(
    fn: (ctx: TimeBlockContext) => Observable<T>,
    filterProviderId?: string,
  ): Observable<T> {
    return this._store.select(selectEnabledIssueProviders).pipe(
      first(),
      concatMap((providers) => {
        const provider = providers.find(
          (p): p is IssueProviderPluginType =>
            (!filterProviderId || p.id === filterProviderId) &&
            isPluginIssueProvider(p.issueProviderKey) &&
            !!(p as IssueProviderPluginType).pluginConfig?.['isAutoTimeBlock'],
        );
        if (!provider) return EMPTY;

        const registered = this._pluginRegistry.getProvider(provider.issueProviderKey);
        if (!registered?.definition.timeBlock) return EMPTY;

        const http = this._pluginHttpService.createHttpHelper(
          () => registered.definition.getHeaders(provider.pluginConfig),
          { allowPrivateNetwork: registered.allowPrivateNetwork },
        );
        return fn({
          providerId: provider.id,
          definition: registered.definition,
          config: provider.pluginConfig,
          http,
        });
      }),
    );
  }

  private async _upsertEvent(
    ctx: TimeBlockContext,
    task: Task,
    dueWithTime: number,
  ): Promise<void> {
    const durationMs = Math.max(task.timeEstimate - task.timeSpent, 0) || 30 * 60 * 1000;
    await ctx.definition.timeBlock!.upsertEvent(
      task.id,
      {
        title: task.title,
        dueWithTime,
        durationMs,
        isDone: task.isDone,
      },
      ctx.config,
      ctx.http,
    );
  }

  private _handleError(err: unknown): Observable<never> {
    Log.err('[TimeBlock] Failed to sync time block', err);
    this._snackService.open({
      type: 'ERROR',
      msg: T.F.CALENDARS.S.TIME_BLOCK_ERROR,
      translateParams: { errTxt: getErrorTxt(err) },
    });
    return EMPTY;
  }
}

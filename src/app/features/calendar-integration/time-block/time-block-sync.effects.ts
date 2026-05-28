import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { createEffect, ofType } from '@ngrx/effects';
import { EMPTY, Observable, from } from 'rxjs';
import {
  catchError,
  concatMap,
  debounceTime,
  filter,
  first,
  groupBy,
  map,
  mergeMap,
  tap,
} from 'rxjs/operators';
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

type TimeBlockOperation = 'upsert' | 'upsertIfScheduled' | 'delete';

interface TimeBlockQueueRequest {
  taskId: string;
  operation: TimeBlockOperation;
}

interface TimeBlockQueuedOperation {
  type: TimeBlockOperation;
  ctx?: TimeBlockContext;
}

interface TimeBlockTaskQueue {
  isRunning: boolean;
  pending: TimeBlockQueuedOperation | null;
  resolvers: Array<() => void>;
}

/**
 * Time-block writes for the same task are coalesced over this window. A single
 * user edit dispatches several actions (e.g. applyShortSyntax + updateTask);
 * without coalescing each fires its own Google Calendar write, bursting past
 * Google's per-event write rate limit. One settled edit = one write.
 */
export const COALESCE_MS = 1000;

/**
 * Cap on parallel HTTP writes across tasks. Each task's queue is already
 * serialized internally; this limits cross-task fan-out (bulk delete, backfill)
 * to stay under Google Calendar's per-user QPS while still being faster than
 * strictly sequential.
 */
const MAX_PARALLEL_TIME_BLOCK_HTTP = 3;

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
  private readonly _taskWriteQueues = new Map<string, TimeBlockTaskQueue>();

  /**
   * When a task is scheduled, rescheduled, or a synced field (title,
   * timeEstimate, isDone) changes, create/update its time-block event.
   *
   * A single user edit dispatches several of these actions in quick
   * succession (e.g. applyShortSyntax + updateTask). They are coalesced per
   * task over COALESCE_MS so one edit produces a single calendar write. The
   * latest task state is re-read after the debounce, so the write always
   * reflects the final state (and is skipped if the task is no longer
   * scheduled — the delete effects handle that case).
   */
  upsertOnTaskChange$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(
          TaskSharedActions.scheduleTaskWithTime,
          TaskSharedActions.reScheduleTaskWithTime,
          TaskSharedActions.applyShortSyntax,
          TaskSharedActions.updateTask,
        ),
        map((action): TimeBlockQueueRequest | null => {
          if (action.type === TaskSharedActions.applyShortSyntax.type) {
            const a = action as ReturnType<typeof TaskSharedActions.applyShortSyntax>;
            return a.schedulingInfo?.dueWithTime
              ? { taskId: a.task.id, operation: 'upsert' }
              : null;
          }
          if (action.type === TaskSharedActions.updateTask.type) {
            const a = action as ReturnType<typeof TaskSharedActions.updateTask>;
            const changes = a.task.changes;
            const isRelevant =
              'title' in changes || 'timeEstimate' in changes || 'isDone' in changes;
            return isRelevant
              ? { taskId: a.task.id as string, operation: 'upsertIfScheduled' }
              : null;
          }
          const a = action as ReturnType<typeof TaskSharedActions.scheduleTaskWithTime>;
          return { taskId: a.task.id, operation: 'upsert' };
        }),
        filter((request): request is TimeBlockQueueRequest => request !== null),
        concatMap((request) =>
          this._hasTimeBlockContext$().pipe(
            filter(Boolean),
            map(() => request),
          ),
        ),
        // Coalesce rapid changes to the same task; idle groups auto-complete.
        groupBy((request) => request.taskId, {
          duration: (g) => g.pipe(debounceTime(COALESCE_MS * 5)),
        }),
        mergeMap((request$) =>
          request$.pipe(
            debounceTime(COALESCE_MS),
            tap(
              ({ taskId, operation }) =>
                void this._queueTimeBlockOperation(taskId, { type: operation }),
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
        concatMap((taskId) => this._queueDeleteTimeBlock$(taskId)),
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
        concatMap(({ task }) => this._queueDeleteTimeBlock$(task.id)),
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
          return this._queueDeleteTimeBlocks$(taskIds);
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
                      from(
                        this._queueTimeBlockOperation(task.id, {
                          type: 'upsertIfScheduled',
                          ctx,
                        }),
                      ),
                    MAX_PARALLEL_TIME_BLOCK_HTTP,
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

  private _hasTimeBlockContext$(filterProviderId?: string): Observable<boolean> {
    return this._store.select(selectEnabledIssueProviders).pipe(
      first(),
      map((providers) =>
        providers.some(
          (p): p is IssueProviderPluginType =>
            (!filterProviderId || p.id === filterProviderId) &&
            isPluginIssueProvider(p.issueProviderKey) &&
            !!(p as IssueProviderPluginType).pluginConfig?.['isAutoTimeBlock'] &&
            !!this._pluginRegistry.getProvider(p.issueProviderKey)?.definition.timeBlock,
        ),
      ),
    );
  }

  private _queueTimeBlockOperation(
    taskId: string,
    operation: TimeBlockQueuedOperation,
  ): Promise<void> {
    let queue = this._taskWriteQueues.get(taskId);
    if (!queue) {
      queue = { isRunning: false, pending: null, resolvers: [] };
      this._taskWriteQueues.set(taskId, queue);
    }

    const done = new Promise<void>((resolve) => queue.resolvers.push(resolve));

    if (!(queue.pending?.type === 'delete' && operation.type === 'upsertIfScheduled')) {
      queue.pending = operation;
    }
    if (queue.isRunning) {
      return done;
    }

    queue.isRunning = true;
    void this._drainTimeBlockQueue(taskId, queue);
    return done;
  }

  private async _drainTimeBlockQueue(
    taskId: string,
    queue: TimeBlockTaskQueue,
  ): Promise<void> {
    try {
      while (queue.pending) {
        const operation = queue.pending;
        const resolvers = queue.resolvers;
        queue.pending = null;
        queue.resolvers = [];
        await this._runQueuedTimeBlockOperation(taskId, operation);
        resolvers.forEach((resolve) => resolve());
      }
    } finally {
      queue.isRunning = false;
      if (this._taskWriteQueues.get(taskId) === queue) {
        this._taskWriteQueues.delete(taskId);
      }
    }
  }

  private _runQueuedTimeBlockOperation(
    taskId: string,
    operation: TimeBlockQueuedOperation,
  ): Promise<void> {
    return new Promise((resolve) => {
      const op$ =
        operation.type === 'upsert' || operation.type === 'upsertIfScheduled'
          ? this._upsertLatestTaskOnce$(taskId, operation.ctx)
          : this._deleteTimeBlockOnce$(taskId, operation.ctx);
      op$.pipe(catchError((err) => this._handleError(err))).subscribe({
        complete: resolve,
        error: () => resolve(),
      });
    });
  }

  private _upsertLatestTaskOnce$(
    taskId: string,
    queuedCtx?: TimeBlockContext,
  ): Observable<unknown> {
    const runWithCtx = (ctx: TimeBlockContext): Observable<unknown> =>
      // Re-read the latest task when the queued write actually starts. If
      // edits arrived while a previous HTTP write was in flight, this makes
      // the trailing write reflect the final settled state.
      this._taskService
        .getByIdOnce$(taskId)
        .pipe(
          concatMap((task) =>
            task?.dueWithTime
              ? from(this._upsertEvent(ctx, task, task.dueWithTime)).pipe(
                  catchError((err) => this._handleError(err)),
                )
              : EMPTY,
          ),
        );

    return queuedCtx ? runWithCtx(queuedCtx) : this._withTimeBlockContext$(runWithCtx);
  }

  private _deleteTimeBlockOnce$(
    taskId: string,
    queuedCtx?: TimeBlockContext,
  ): Observable<unknown> {
    const runWithCtx = (ctx: TimeBlockContext): Observable<unknown> =>
      from(ctx.definition.timeBlock!.deleteEvent(taskId, ctx.config, ctx.http)).pipe(
        catchError((err) => this._handleError(err)),
      );

    return queuedCtx ? runWithCtx(queuedCtx) : this._withTimeBlockContext$(runWithCtx);
  }

  private _queueDeleteTimeBlock$(taskId: string): Observable<unknown> {
    return this._withTimeBlockContext$((ctx) => {
      void this._queueTimeBlockOperation(taskId, { type: 'delete', ctx });
      return EMPTY;
    });
  }

  private _queueDeleteTimeBlocks$(taskIds: string[]): Observable<unknown> {
    return this._withTimeBlockContext$((ctx) =>
      from(taskIds).pipe(
        mergeMap(
          (taskId) =>
            from(this._queueTimeBlockOperation(taskId, { type: 'delete', ctx })),
          MAX_PARALLEL_TIME_BLOCK_HTTP,
        ),
      ),
    );
  }

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
          config: { ...provider.pluginConfig },
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

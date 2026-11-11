import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PluginBridgeService } from '../../../plugins/plugin-bridge.service';
import { Action, Store } from '@ngrx/store';
import { createEffect, ofType } from '@ngrx/effects';
import { EMPTY, Observable, combineLatest, from } from 'rxjs';
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
import { isCompletedTask } from '../../tasks/util/is-wont-do-task';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../../planner/store/planner.actions';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';
import { IssueProviderPluginType, isPluginIssueProvider } from '../../issue/issue.model';
import { IssueProviderActions } from '../../issue/store/issue-provider.actions';
import { SnackParams } from '../../../core/snack/snack.model';
import { SnackService } from '../../../core/snack/snack.service';
import { getErrorTxt } from '../../../util/get-error-text';
import { TimeBlockDeleteSidecarService } from './time-block-delete-sidecar.service';
import { createTimeBlockContext, TimeBlockContext } from './time-block-context';
import {
  selectAllTasksWithDueTimeSorted,
  selectAllUndoneTasksWithDueDay,
} from '../../tasks/store/task.selectors';
import { DateService } from '../../../core/date/date.service';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { T } from '../../../t.const';
import { Log } from '../../../core/log';
import { shouldScopePluginOAuth } from '../../../plugins/oauth/plugin-oauth-token-key.util';

/**
 * - `upsert` / `upsertIfScheduled`: write the task's current block, if it has one.
 * - `resync` (a task's day changed): like `upsertIfScheduled`, and while all-day
 *   blocks are on (`isAutoTimeBlockAllDay`) it deletes the block of a task left
 *   with neither a time nor a day.
 * - `delete`: remove the block (while all-day blocks are on, a task left with a
 *   day gets its all-day block instead).
 */
type TimeBlockOperation = 'upsert' | 'upsertIfScheduled' | 'resync' | 'delete';

/** Well-known plugin config key: also write tasks planned for a day (no time). */
const ALL_DAY_CONFIG_KEY = 'isAutoTimeBlockAllDay';

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
  private readonly _matDialog = inject(MatDialog);
  private readonly _pluginBridge = inject(PluginBridgeService);
  private readonly _pluginHttpService = inject(PluginHttpService);
  private readonly _snackService = inject(SnackService);
  private readonly _deletesSidecar = inject(TimeBlockDeleteSidecarService);
  private readonly _dateService = inject(DateService);
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
          PlannerActions.planTaskForDay,
          PlannerActions.moveBeforeTask,
          PlannerActions.transferTask,
          TaskSharedActions.planTasksForToday,
          TaskSharedActions.addTask,
        ),
        mergeMap((action): TimeBlockQueueRequest[] => {
          if (action.type === TaskSharedActions.planTasksForToday.type) {
            const a = action as ReturnType<typeof TaskSharedActions.planTasksForToday>;
            return a.taskIds.map((taskId) => ({ taskId, operation: 'resync' }));
          }
          if (action.type === TaskSharedActions.addTask.type) {
            const a = action as ReturnType<typeof TaskSharedActions.addTask>;
            // A new task with a time gets no block on add (unchanged); one created
            // on a day (e.g. in Today) gets its all-day block.
            return a.task.dueDay && !a.task.dueWithTime
              ? [{ taskId: a.task.id, operation: 'resync' }]
              : [];
          }
          const request = this._toQueueRequest(action);
          return request ? [request] : [];
        }),
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
        filter(({ task }) => !!task.dueWithTime || !!task.dueDay),
        concatMap(({ task }) => this._queueDeleteTimeBlock$(task.id, !task.dueWithTime)),
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
          const dayOnlyTaskIds = this._deletesSidecar.consumeDayOnly();
          if (!taskIds.length && !dayOnlyTaskIds.length) return EMPTY;
          return this._queueDeleteTimeBlocks$(taskIds, dayOnlyTaskIds);
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
            const allDayBackfillKey = `${ctx.providerId}:allDay`;
            const isTimedDone = this._backfilledProviderIds.has(ctx.providerId);
            const isAllDayDue =
              this._isAllDayEnabled(ctx) &&
              !this._backfilledProviderIds.has(allDayBackfillKey);
            if (isTimedDone && !isAllDayDue) return EMPTY;

            const syncRangeWeeks =
              parseInt(
                (ctx.config as Record<string, unknown>)['syncRangeWeeks'] as string,
                10,
              ) || 2;
            const now = Date.now();
            const rangeMs = syncRangeWeeks * 7 * 24 * 60 * 60 * 1000;
            const rangeEnd = now + rangeMs;
            const todayStr = this._dateService.todayStr();
            const rangeEndDay = getDbDateStr(rangeEnd);

            return combineLatest([
              this._store.select(selectAllTasksWithDueTimeSorted),
              this._store.select(selectAllUndoneTasksWithDueDay),
            ]).pipe(
              first(),
              concatMap(([timedTasks, dayTasks]) => {
                const markDone = (): void => {
                  this._backfilledProviderIds.add(ctx.providerId);
                  if (isAllDayDue) this._backfilledProviderIds.add(allDayBackfillKey);
                };
                const tasksInRange: { id: string }[] = [
                  ...(isTimedDone
                    ? []
                    : timedTasks.filter(
                        (t) => t.dueWithTime >= now && t.dueWithTime <= rangeEnd,
                      )),
                  ...(isAllDayDue
                    ? dayTasks.filter(
                        (t) =>
                          !t.dueWithTime &&
                          t.dueDay >= todayStr &&
                          t.dueDay <= rangeEndDay,
                      )
                    : []),
                ];
                if (!tasksInRange.length) {
                  markDone();
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
                  tap({ complete: markDone }),
                );
              }),
            );
          }, action.issueProvider.id as string),
        ),
      ),
    { dispatch: false },
  );

  // --- Helpers ---

  private _toQueueRequest(action: Action): TimeBlockQueueRequest | null {
    if (action.type === TaskSharedActions.applyShortSyntax.type) {
      const a = action as ReturnType<typeof TaskSharedActions.applyShortSyntax>;
      if (a.schedulingInfo?.dueWithTime) {
        return { taskId: a.task.id, operation: 'upsert' };
      }
      return a.schedulingInfo?.day ? { taskId: a.task.id, operation: 'resync' } : null;
    }
    if (action.type === TaskSharedActions.updateTask.type) {
      const a = action as ReturnType<typeof TaskSharedActions.updateTask>;
      const changes = a.task.changes;
      if ('dueDay' in changes) {
        return { taskId: a.task.id as string, operation: 'resync' };
      }
      const isRelevant =
        'title' in changes || 'timeEstimate' in changes || 'isDone' in changes;
      return isRelevant
        ? { taskId: a.task.id as string, operation: 'upsertIfScheduled' }
        : null;
    }
    if (action.type === PlannerActions.planTaskForDay.type) {
      const a = action as ReturnType<typeof PlannerActions.planTaskForDay>;
      return { taskId: a.task.id, operation: 'resync' };
    }
    if (action.type === PlannerActions.moveBeforeTask.type) {
      const a = action as ReturnType<typeof PlannerActions.moveBeforeTask>;
      return { taskId: a.fromTask.id, operation: 'resync' };
    }
    if (action.type === PlannerActions.transferTask.type) {
      const a = action as ReturnType<typeof PlannerActions.transferTask>;
      // A timed task's transfer is handled by deleteOnUnschedule$.
      return a.task.dueWithTime ? null : { taskId: a.task.id, operation: 'resync' };
    }
    const a = action as ReturnType<typeof TaskSharedActions.scheduleTaskWithTime>;
    return { taskId: a.task.id, operation: 'upsert' };
  }

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

    // A pending delete already re-checks the task's day while all-day blocks are on.
    if (
      !(
        queue.pending?.type === 'delete' &&
        (operation.type === 'upsertIfScheduled' || operation.type === 'resync')
      )
    ) {
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
        operation.type === 'delete'
          ? this._deleteTimeBlockOnce$(taskId, operation.ctx)
          : this._upsertLatestTaskOnce$(taskId, operation.type, operation.ctx);
      op$.pipe(catchError((err) => this._handleError(err))).subscribe({
        complete: resolve,
        error: () => resolve(),
      });
    });
  }

  private _upsertLatestTaskOnce$(
    taskId: string,
    type: Exclude<TimeBlockOperation, 'delete'>,
    queuedCtx?: TimeBlockContext,
  ): Observable<unknown> {
    const runWithCtx = (ctx: TimeBlockContext): Observable<unknown> => {
      const isAllDay = this._isAllDayEnabled(ctx);
      // Re-read the latest task when the queued write actually starts. If
      // edits arrived while a previous HTTP write was in flight, this makes
      // the trailing write reflect the final settled state.
      return this._taskService.getByIdOnce$(taskId).pipe(
        concatMap((task) => {
          if (task?.dueWithTime) {
            return from(this._upsertEvent(ctx, task, task.dueWithTime)).pipe(
              catchError((err) => this._handleError(err, ctx)),
            );
          }
          if (isAllDay && task?.dueDay) {
            return from(this._upsertAllDayEvent(ctx, task, task.dueDay)).pipe(
              catchError((err) => this._handleError(err, ctx)),
            );
          }
          return isAllDay && type === 'resync' ? this._deleteEvent$(taskId, ctx) : EMPTY;
        }),
      );
    };

    return queuedCtx ? runWithCtx(queuedCtx) : this._withTimeBlockContext$(runWithCtx);
  }

  private _deleteTimeBlockOnce$(
    taskId: string,
    queuedCtx?: TimeBlockContext,
  ): Observable<unknown> {
    const runWithCtx = (ctx: TimeBlockContext): Observable<unknown> =>
      this._isAllDayEnabled(ctx)
        ? // Unscheduling can leave the task on a day (e.g. kept in Today) and a
          // planner transfer moves it to one: write the all-day block instead.
          this._taskService
            .getByIdOnce$(taskId)
            .pipe(
              concatMap((task) =>
                task && !task.dueWithTime && task.dueDay
                  ? from(this._upsertAllDayEvent(ctx, task, task.dueDay)).pipe(
                      catchError((err) => this._handleError(err, ctx)),
                    )
                  : this._deleteEvent$(taskId, ctx),
              ),
            )
        : this._deleteEvent$(taskId, ctx);

    return queuedCtx ? runWithCtx(queuedCtx) : this._withTimeBlockContext$(runWithCtx);
  }

  private _deleteEvent$(taskId: string, ctx: TimeBlockContext): Observable<unknown> {
    return from(ctx.definition.timeBlock!.deleteEvent(taskId, ctx.config, ctx.http)).pipe(
      catchError((err) => this._handleError(err, ctx)),
    );
  }

  /** `isDayOnly`: the task had a day but no time, so it only has an all-day block. */
  private _queueDeleteTimeBlock$(taskId: string, isDayOnly = false): Observable<unknown> {
    return this._withTimeBlockContext$((ctx) => {
      if (isDayOnly && !this._isAllDayEnabled(ctx)) return EMPTY;
      void this._queueTimeBlockOperation(taskId, { type: 'delete', ctx });
      return EMPTY;
    });
  }

  private _queueDeleteTimeBlocks$(
    taskIds: string[],
    dayOnlyTaskIds: string[] = [],
  ): Observable<unknown> {
    return this._withTimeBlockContext$((ctx) =>
      from([...taskIds, ...(this._isAllDayEnabled(ctx) ? dayOnlyTaskIds : [])]).pipe(
        mergeMap(
          (taskId) =>
            from(this._queueTimeBlockOperation(taskId, { type: 'delete', ctx })),
          MAX_PARALLEL_TIME_BLOCK_HTTP,
        ),
      ),
    );
  }

  private _isAllDayEnabled(ctx: TimeBlockContext): boolean {
    return (
      !!ctx.config[ALL_DAY_CONFIG_KEY] && !!ctx.definition.timeBlock?.upsertAllDayEvent
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
        const ctx = createTimeBlockContext({
          providers,
          configKey: 'isAutoTimeBlock',
          registry: this._pluginRegistry,
          httpService: this._pluginHttpService,
          filterProviderId,
        });
        return ctx ? fn(ctx) : EMPTY;
      }),
    );
  }

  private async _upsertEvent(
    ctx: TimeBlockContext,
    task: Task,
    dueWithTime: number,
  ): Promise<void> {
    // An imported task is already represented by its source calendar event.
    // Writing a second, task-id-based time block to the same provider duplicates it.
    if (task.issueId && task.issueProviderId === ctx.providerId) {
      return;
    }

    const durationMs = this._calcDurationMs(task);
    await ctx.definition.timeBlock!.upsertEvent(
      task.id,
      {
        title: task.title,
        dueWithTime,
        durationMs,
        // A won't-do task wasn't completed, so its block gets no done marker.
        isDone: isCompletedTask(task),
      },
      ctx.config,
      ctx.http,
    );
  }

  private async _upsertAllDayEvent(
    ctx: TimeBlockContext,
    task: Task,
    dueDay: string,
  ): Promise<void> {
    // Same rule as timed blocks: an imported event already represents the task.
    if (task.issueId && task.issueProviderId === ctx.providerId) {
      return;
    }
    await ctx.definition.timeBlock!.upsertAllDayEvent!(
      task.id,
      { title: task.title, dueDay, isDone: isCompletedTask(task) },
      ctx.config,
      ctx.http,
    );
  }

  /**
   * Duration of the calendar block for a task.
   *
   * - Active task: the *remaining* estimated work (`timeEstimate - timeSpent`),
   *   mirroring the in-app schedule view (planner.selectors.ts).
   * - Done task: "remaining work" is meaningless once finished, so reflect the
   *   *actual* time spent instead. Otherwise completing a task would shrink the
   *   block to a leftover sliver (estimate > spent) or collapse to 0 and hit the
   *   default (spent >= estimate) — see #7949.
   *
   * Falls back to a sensible non-zero default so the event is never zero-length.
   */
  private _calcDurationMs(task: Task): number {
    const DEFAULT_DURATION_MS = 30 * 60 * 1000;
    if (task.isDone) {
      return task.timeSpent || task.timeEstimate || DEFAULT_DURATION_MS;
    }
    return Math.max(task.timeEstimate - task.timeSpent, 0) || DEFAULT_DURATION_MS;
  }

  private async _handleError(err: unknown, ctx?: TimeBlockContext): Promise<void> {
    Log.err('[TimeBlock] Failed to sync time block', err);
    const snack: SnackParams = {
      type: 'ERROR',
      msg: T.F.CALENDARS.S.TIME_BLOCK_ERROR,
      translateParams: { errTxt: getErrorTxt(err) },
    };
    if (
      ctx &&
      this._pluginRegistry
        .getConfigFields(ctx.issueProvider.issueProviderKey)
        .some((field) => field.type === 'oauthButton') &&
      !(await this._pluginBridge.restoreAndCheckOAuthTokens(
        ctx.pluginId,
        shouldScopePluginOAuth(ctx.pluginId) ? ctx.providerId : undefined,
      ))
    ) {
      snack.actionStr = T.F.CALENDARS.S.CONNECT;
      snack.actionFn = async () => {
        // Lazy: this effect is registered at startup, and a static import would
        // pull the provider settings dialog and its form deps into the initial bundle.
        const { DialogEditIssueProviderComponent } =
          await import('../../issue/dialog-edit-issue-provider/dialog-edit-issue-provider.component');
        this._matDialog.open(DialogEditIssueProviderComponent, {
          restoreFocus: true,
          data: { issueProvider: ctx.issueProvider },
        });
      };
    }
    this._snackService.open(snack);
  }
}

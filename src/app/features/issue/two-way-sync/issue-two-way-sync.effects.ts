import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { createEffect, ofType } from '@ngrx/effects';
import { EMPTY, Observable, first, firstValueFrom, from } from 'rxjs';
import { catchError, concatMap, filter, map } from 'rxjs/operators';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskService } from '../../tasks/task.service';
import { Task } from '../../tasks/task.model';
import { IssueProviderService } from '../issue-provider.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { IssueSyncAdapterRegistryService } from './issue-sync-adapter-registry.service';
import { computePushDecisions } from './compute-push-decisions';
import { FieldMapping, FieldSyncConfig } from './issue-sync.model';
import { IssueProvider, IssueProviderKey } from '../issue.model';
import { IssueLog } from '../../../core/log';
import { HttpErrorResponse } from '@angular/common/http';
import { CaldavSyncAdapterService } from '../providers/caldav/caldav-sync-adapter.service';
import { SnackService } from '../../../core/snack/snack.service';
import {
  DeletedTaskIssueSidecarService,
  DeletedTaskIssueInfo,
} from './deleted-task-issue-sidecar.service';
import { selectEnabledIssueProviders } from '../store/issue-provider.selectors';
import { getErrorTxt } from '../../../util/get-error-text';
import { T } from '../../../t.const';
import { PlannerActions } from '../../planner/store/planner.actions';

const SYNCABLE_TASK_FIELDS: ReadonlySet<string> = new Set([
  'isDone',
  'title',
  'notes',
  'dueWithTime',
  'dueDay',
  'timeEstimate',
]);

// Lookup map to extract taskId and changes from each action type,
// replacing chained if/else with manual casts.
const ACTION_EXTRACTORS: Record<
  string,
  (action: unknown) => { taskId: string; changes: Record<string, unknown> }
> = {
  [TaskSharedActions.applyShortSyntax.type]: (action) => {
    const a = action as ReturnType<typeof TaskSharedActions.applyShortSyntax>;
    const changes: Record<string, unknown> = { ...a.taskChanges };
    if (a.schedulingInfo?.dueWithTime) {
      changes['dueWithTime'] = a.schedulingInfo.dueWithTime;
    }
    if (a.schedulingInfo?.day) {
      changes['dueDay'] = a.schedulingInfo.day;
    }
    return { taskId: a.task.id, changes };
  },
  [TaskSharedActions.scheduleTaskWithTime.type]: (action) => {
    const a = action as ReturnType<typeof TaskSharedActions.scheduleTaskWithTime>;
    return { taskId: a.task.id, changes: { dueWithTime: a.dueWithTime } };
  },
  [TaskSharedActions.reScheduleTaskWithTime.type]: (action) => {
    const a = action as ReturnType<typeof TaskSharedActions.reScheduleTaskWithTime>;
    return { taskId: a.task.id, changes: { dueWithTime: a.dueWithTime } };
  },
  [TaskSharedActions.unscheduleTask.type]: (action) => {
    const a = action as ReturnType<typeof TaskSharedActions.unscheduleTask>;
    return { taskId: a.id, changes: { dueWithTime: undefined } };
  },
  [TaskSharedActions.updateTask.type]: (action) => {
    const a = action as ReturnType<typeof TaskSharedActions.updateTask>;
    return {
      taskId: a.task.id.toString(),
      changes: a.task.changes as Partial<Task>,
    };
  },
  [PlannerActions.planTaskForDay.type]: (action) => {
    const a = action as ReturnType<typeof PlannerActions.planTaskForDay>;
    return { taskId: a.task.id, changes: { dueDay: a.day } };
  },
  [PlannerActions.transferTask.type]: (action) => {
    const a = action as ReturnType<typeof PlannerActions.transferTask>;
    return { taskId: a.task.id, changes: { dueDay: a.newDay } };
  },
};

@Injectable()
export class IssueTwoWaySyncEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _adapterRegistry = inject(IssueSyncAdapterRegistryService);
  private readonly _snackService = inject(SnackService);
  private readonly _deletedTaskIssueSidecar = inject(DeletedTaskIssueSidecarService);
  private _syncOriginatedTaskIds = new Set<string>();
  private static readonly _MAX_SYNC_ORIGINATED_IDS = 1000;

  constructor() {
    const caldavAdapter = inject(CaldavSyncAdapterService);
    this._adapterRegistry.register('CALDAV', caldavAdapter);
  }

  pushFieldsOnTaskUpdate$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(
          TaskSharedActions.updateTask,
          TaskSharedActions.applyShortSyntax,
          TaskSharedActions.scheduleTaskWithTime,
          TaskSharedActions.reScheduleTaskWithTime,
          TaskSharedActions.unscheduleTask,
          PlannerActions.planTaskForDay,
          PlannerActions.transferTask,
        ),
        map((action) => ACTION_EXTRACTORS[action.type](action)),
        filter(({ taskId, changes }) => {
          if (this._syncOriginatedTaskIds.delete(taskId)) {
            return false;
          }
          // Skip poll-originated updates that include sync bookkeeping fields
          if ('issueLastSyncedValues' in changes || 'issueWasUpdated' in changes) {
            return false;
          }
          return Object.keys(changes).some((key) => SYNCABLE_TASK_FIELDS.has(key));
        }),
        concatMap(({ taskId, changes }) =>
          this._taskService.getByIdOnce$(taskId).pipe(
            map((fullTask) => ({
              fullTask,
              changes,
            })),
          ),
        ),
        filter(({ fullTask }) => {
          if (
            !fullTask ||
            !fullTask.issueType ||
            !fullTask.issueProviderId ||
            !fullTask.issueId
          ) {
            return false;
          }
          return this._adapterRegistry.has(fullTask.issueType);
        }),
        concatMap(({ fullTask, changes }) =>
          this._pushChanges$(fullTask, changes).pipe(
            catchError((err) => {
              IssueLog.err('Two-way sync push failed', err);
              this._snackService.open({
                type: 'ERROR',
                msg: T.F.ISSUE.S.TWO_WAY_SYNC_PUSH_FAILED,
                translateParams: { errorMsg: getErrorTxt(err) },
              });
              return EMPTY;
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  deleteIssueOnTaskDelete$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.deleteTask),
        filter(
          ({ task }) => !!task.issueId && !!task.issueType && !!task.issueProviderId,
        ),
        filter(({ task }) => this._adapterRegistry.has(task.issueType!)),
        concatMap(({ task }) => this._deleteRemoteIssue$(task)),
      ),
    { dispatch: false },
  );

  deleteIssueOnBulkTaskDelete$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.deleteTasks),
        concatMap(() => {
          const issueInfos = this._deletedTaskIssueSidecar.consume();
          if (!issueInfos.length) {
            return EMPTY;
          }
          return from(issueInfos).pipe(
            filter((info) => this._adapterRegistry.has(info.issueType)),
            concatMap((info) => this._deleteRemoteIssue$(info)),
          );
        }),
      ),
    { dispatch: false },
  );

  autoCreateIssueOnTaskAdd$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.addTask),
        filter(({ task, issue }) => !task.issueId && !issue),
        filter(({ task }) => !task.parentId),
        filter(({ task }) => !!task.projectId),
        concatMap(({ task }) =>
          this._store.select(selectEnabledIssueProviders).pipe(
            first(),
            map((providers) =>
              providers.find(
                (p) =>
                  p.defaultProjectId === task.projectId && this._hasAutoCreateEnabled(p),
              ),
            ),
            filter((provider): provider is IssueProvider => !!provider),
            concatMap((provider) => {
              const adapter = this._adapterRegistry.get(provider.issueProviderKey);
              if (!adapter?.createIssue) {
                return EMPTY;
              }
              return this._issueProviderService
                .getCfgOnce$(provider.id, provider.issueProviderKey)
                .pipe(
                  concatMap((cfg) =>
                    from(adapter.createIssue!(task.title, cfg)).pipe(
                      concatMap(async ({ issueId, issueNumber, issueData }) => {
                        this._trackSyncOriginatedTask(task.id);
                        try {
                          const titlePrefix =
                            issueNumber != null ? `#${issueNumber} ` : '';
                          const syncValues = adapter.extractSyncValues(issueData);
                          this._taskService.update(task.id, {
                            issueId,
                            issueType: provider.issueProviderKey,
                            issueProviderId: provider.id,
                            issueLastUpdated: Date.now(),
                            issueWasUpdated: false,
                            issueLastSyncedValues: syncValues,
                            title: titlePrefix
                              ? `${titlePrefix}${task.title}`
                              : task.title,
                          });

                          // Push initial task values (e.g. dueWithTime from short syntax)
                          // that were set before the issue was linked
                          await this._pushInitialValues(
                            task,
                            issueId,
                            adapter,
                            cfg,
                            syncValues,
                          );
                        } catch (e) {
                          this._syncOriginatedTaskIds.delete(task.id);
                          throw e;
                        }
                      }),
                    ),
                  ),
                );
            }),
            catchError((err) => {
              IssueLog.err('Auto-create issue failed', err);
              this._snackService.open({
                type: 'ERROR',
                msg: T.F.ISSUE.S.AUTO_CREATE_FAILED,
                translateParams: { errorMsg: getErrorTxt(err) },
              });
              return EMPTY;
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  private async _pushInitialValues(
    task: Task,
    issueId: string,
    adapter: {
      getFieldMappings(): FieldMapping[];
      getSyncConfig(cfg: unknown): FieldSyncConfig;
      pushChanges(
        issueId: string,
        changes: Record<string, unknown>,
        cfg: unknown,
      ): Promise<void>;
    },
    cfg: IssueProvider,
    syncValues: Record<string, unknown>,
  ): Promise<void> {
    // Re-fetch task from the store to get post-meta-reducer values
    // (e.g. dueWithTime from short syntax parsing like @2pm)
    const currentTask = await firstValueFrom(this._taskService.getByIdOnce$(task.id));
    const fieldMappings = adapter.getFieldMappings();
    const syncConfig = adapter.getSyncConfig(cfg);
    const ctx = { issueId };
    const toPush: Record<string, unknown> = {};

    for (const mapping of fieldMappings) {
      const dir = syncConfig[mapping.taskField] ?? mapping.defaultDirection;
      if (dir !== 'pushOnly' && dir !== 'both') {
        continue;
      }
      const taskValue = currentTask[mapping.taskField as keyof Task];
      if (taskValue == null) {
        continue;
      }
      const issueValue = mapping.toIssueValue(taskValue, ctx);
      if (issueValue == null) {
        continue;
      }
      // Only push if task value differs from the created issue value
      if (issueValue !== syncValues[mapping.issueField]) {
        toPush[mapping.issueField] = issueValue;
      }
    }

    if (Object.keys(toPush).length > 0) {
      await adapter.pushChanges(issueId, toPush, cfg);
      // Update sync baseline and issueLastUpdated to prevent poll from
      // treating our own push as an external update
      const updatedSyncValues = { ...syncValues, ...toPush };
      this._trackSyncOriginatedTask(task.id);
      this._taskService.update(task.id, {
        issueLastSyncedValues: updatedSyncValues,
        issueLastUpdated: Date.now(),
      });
    }
  }

  private _hasAutoCreateEnabled(provider: IssueProvider): boolean {
    // Check for plugin providers (both plugin:* and migrated keys like GITHUB)
    const pluginCfg = (provider as { pluginConfig?: Record<string, unknown> })
      .pluginConfig;
    if (pluginCfg) {
      return !!(pluginCfg as Record<string, unknown>)?.['isAutoCreateIssues'];
    }
    return false;
  }

  private _deleteRemoteIssue$(info: DeletedTaskIssueInfo | Task): Observable<unknown> {
    if (!info.issueType || !info.issueProviderId || !info.issueId) {
      return EMPTY;
    }
    const issueType = info.issueType;
    const issueProviderId = info.issueProviderId;
    const issueId = info.issueId;
    const adapter = this._adapterRegistry.get(issueType);
    if (!adapter?.deleteIssue) {
      return EMPTY;
    }
    return this._issueProviderService
      .getCfgOnce$(issueProviderId, issueType as IssueProviderKey)
      .pipe(
        concatMap((cfg) =>
          from(adapter.deleteIssue!(issueId, cfg)).pipe(
            catchError((err) => {
              // 404/410 means the remote issue is already gone — treat as success
              // to avoid false "delete failed" toasts (e.g. when polling detects
              // a remote deletion and then deleteIssue is called on the same issue)
              const status = err instanceof HttpErrorResponse ? err.status : err?.status;
              if (status === 404 || status === 410) {
                return EMPTY;
              }
              IssueLog.err('Delete remote issue failed', err);
              this._snackService.open({
                type: 'ERROR',
                msg: T.F.ISSUE.S.DELETE_REMOTE_FAILED,
              });
              return EMPTY;
            }),
          ),
        ),
      );
  }

  private _pushChanges$(task: Task, changes: Partial<Task>): Observable<unknown> {
    if (!task.issueType || !task.issueProviderId || !task.issueId) {
      return EMPTY;
    }
    const issueType = task.issueType as IssueProviderKey;
    const issueProviderId = task.issueProviderId;
    const issueId = task.issueId;
    const adapter = this._adapterRegistry.get(issueType);
    if (!adapter) {
      return EMPTY;
    }

    return this._issueProviderService.getCfgOnce$(issueProviderId, issueType).pipe(
      concatMap(async (cfg) => {
        const fieldMappings = adapter.getFieldMappings();
        const syncConfig = adapter.getSyncConfig(cfg);

        // Early exit: check if any changed field is pushable before fetching
        const hasPushableField = fieldMappings.some((m) => {
          if (!(m.taskField in changes)) {
            return false;
          }
          const dir = syncConfig[m.taskField] ?? m.defaultDirection;
          return dir === 'pushOnly' || dir === 'both';
        });
        if (!hasPushableField) {
          return;
        }

        const freshIssue = await adapter.fetchIssue(issueId, cfg);
        const freshValues = adapter.extractSyncValues(freshIssue);
        const lastSyncedValues = task.issueLastSyncedValues ?? {};

        // Re-fetch task to get post-meta-reducer values (e.g. short syntax parsed title)
        const currentTask = await firstValueFrom(this._taskService.getByIdOnce$(task.id));
        const taskFieldChanges: Record<string, unknown> = {};
        for (const mapping of fieldMappings) {
          if (mapping.taskField in changes) {
            // Use current task value (post-parsing) not raw action value
            taskFieldChanges[mapping.taskField] =
              currentTask?.[mapping.taskField as keyof Task] ??
              changes[mapping.taskField];
          }
        }

        const parsed = parseInt(issueId, 10);
        const issueNumber = Number.isNaN(parsed) ? undefined : parsed;
        const ctx = { issueId, issueNumber };

        const decisions = computePushDecisions(
          taskFieldChanges,
          fieldMappings,
          syncConfig,
          freshValues,
          lastSyncedValues,
          ctx,
        );

        const toPush: Record<string, unknown> = {};
        for (const d of decisions) {
          if (d.action === 'push') {
            toPush[d.field] = d.issueValue;
          }
        }

        const didPush = Object.keys(toPush).length > 0;
        if (didPush) {
          await adapter.pushChanges(issueId, toPush, cfg);
        }

        // Update lastSyncedValues for ALL tracked fields from the fresh issue,
        // overriding with pushed values for fields we just pushed.
        const updatedSyncValues: Record<string, unknown> = {};
        for (const mapping of fieldMappings) {
          const pushDecision = decisions.find(
            (d) => d.field === mapping.issueField && d.action === 'push',
          );
          updatedSyncValues[mapping.issueField] = pushDecision
            ? pushDecision.issueValue
            : freshValues[mapping.issueField];
        }

        // After push, re-fetch the issue to get the provider's updated marker
        // (e.g. CalDAV etag changes on write). Fall back to Date.now() for
        // providers that don't implement getIssueLastUpdated.
        let issueLastUpdated = Date.now();
        if (didPush && adapter.getIssueLastUpdated) {
          const postPushIssue = await adapter.fetchIssue(issueId, cfg);
          issueLastUpdated = adapter.getIssueLastUpdated(postPushIssue);
        }

        // Update sync values and issueLastUpdated to prevent poll from
        // treating our own push as an external update
        this._trackSyncOriginatedTask(task.id);
        try {
          this._taskService.update(task.id, {
            issueLastSyncedValues: updatedSyncValues,
            issueLastUpdated,
          });
        } catch (e) {
          this._syncOriginatedTaskIds.delete(task.id);
          throw e;
        }
      }),
    );
  }

  private _trackSyncOriginatedTask(taskId: string): void {
    this._syncOriginatedTaskIds.add(taskId);
    if (
      this._syncOriginatedTaskIds.size > IssueTwoWaySyncEffects._MAX_SYNC_ORIGINATED_IDS
    ) {
      // Evict oldest entry (Set preserves insertion order) instead of clearing all
      const oldest = this._syncOriginatedTaskIds.values().next().value;
      if (oldest !== undefined) {
        this._syncOriginatedTaskIds.delete(oldest);
      }
    }
  }
}

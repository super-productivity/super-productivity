import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { createEffect, ofType } from '@ngrx/effects';
import { EMPTY, Observable, first, from } from 'rxjs';
import { catchError, concatMap, filter, map } from 'rxjs/operators';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskService } from '../../tasks/task.service';
import { Task } from '../../tasks/task.model';
import { IssueProviderService } from '../issue-provider.service';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { IssueSyncAdapterRegistryService } from './issue-sync-adapter-registry.service';
import { computePushDecisions } from './compute-push-decisions';
import { IssueProvider, IssueProviderKey } from '../issue.model';
import { IssueLog } from '../../../core/log';
import { CaldavSyncAdapterService } from '../providers/caldav/caldav-sync-adapter.service';
import { SnackService } from '../../../core/snack/snack.service';
import { selectEnabledIssueProviders } from '../store/issue-provider.selectors';
import { getErrorTxt } from '../../../util/get-error-text';
import { T } from '../../../t.const';

@Injectable()
export class IssueTwoWaySyncEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _adapterRegistry = inject(IssueSyncAdapterRegistryService);
  private readonly _snackService = inject(SnackService);
  private _syncOriginatedTaskIds = new Set<string>();

  constructor() {
    const caldavAdapter = inject(CaldavSyncAdapterService);
    this._adapterRegistry.register('CALDAV', caldavAdapter);
  }

  pushFieldsOnTaskUpdate$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => {
          if (this._syncOriginatedTaskIds.delete(task.id.toString())) {
            return false;
          }
          const changes = task.changes;
          // Skip poll-originated updates that include sync bookkeeping fields
          if ('issueLastSyncedValues' in changes || 'issueWasUpdated' in changes) {
            return false;
          }
          return (
            'isDone' in changes ||
            'title' in changes ||
            'notes' in changes ||
            'dueWithTime' in changes ||
            'dueDay' in changes ||
            'timeEstimate' in changes
          );
        }),
        concatMap(({ task: taskUpdate }) =>
          this._taskService.getByIdOnce$(taskUpdate.id.toString()).pipe(
            map((fullTask) => ({
              fullTask,
              changes: taskUpdate.changes,
            })),
          ),
        ),
        filter(({ fullTask }) => {
          if (!fullTask.issueType || !fullTask.issueProviderId || !fullTask.issueId) {
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
                      map(({ issueId, issueNumber, issueData }) => {
                        this._syncOriginatedTaskIds.add(task.id);
                        try {
                          const titlePrefix =
                            issueNumber != null ? `#${issueNumber} ` : `${issueId} `;
                          this._taskService.update(task.id, {
                            issueId,
                            issueType: provider.issueProviderKey,
                            issueProviderId: provider.id,
                            issueLastUpdated: Date.now(),
                            issueWasUpdated: false,
                            issueLastSyncedValues: adapter.extractSyncValues(issueData),
                            title: `${titlePrefix}${task.title}`,
                          });
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

  private _hasAutoCreateEnabled(provider: IssueProvider): boolean {
    // Check for plugin providers (both plugin:* and migrated keys like GITHUB)
    const pluginCfg = (provider as { pluginConfig?: Record<string, unknown> })
      .pluginConfig;
    if (pluginCfg) {
      return !!(pluginCfg as Record<string, unknown>)?.['isAutoCreateIssues'];
    }
    return false;
  }

  private _pushChanges$(task: Task, changes: Partial<Task>): Observable<unknown> {
    const issueType = task.issueType as IssueProviderKey;
    const adapter = this._adapterRegistry.get(issueType);
    if (!adapter) {
      return EMPTY;
    }

    return this._issueProviderService.getCfgOnce$(task.issueProviderId!, issueType).pipe(
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

        const freshIssue = await adapter.fetchIssue(task.issueId!, cfg);
        const freshValues = adapter.extractSyncValues(freshIssue);
        const lastSyncedValues = task.issueLastSyncedValues ?? {};

        const taskFieldChanges: Record<string, unknown> = {};
        for (const mapping of fieldMappings) {
          if (mapping.taskField in changes) {
            taskFieldChanges[mapping.taskField] = changes[mapping.taskField];
          }
        }

        const parsed = parseInt(task.issueId!, 10);
        const issueNumber = Number.isNaN(parsed) ? undefined : parsed;
        const ctx = { issueId: task.issueId!, issueNumber };

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
          await adapter.pushChanges(task.issueId!, toPush, cfg);
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
          const postPushIssue = await adapter.fetchIssue(task.issueId!, cfg);
          issueLastUpdated = adapter.getIssueLastUpdated(postPushIssue);
        }

        // Update sync values and issueLastUpdated to prevent poll from
        // treating our own push as an external update
        this._syncOriginatedTaskIds.add(task.id);
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
}
